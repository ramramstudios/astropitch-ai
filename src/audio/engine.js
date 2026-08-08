/**
 * The audio engine.
 *
 * One graph, built once, reused for the life of the page:
 *
 *   voices -> dryBus --------------------------\
 *          -> reverbSend -> preDelay -> IR -> damp -> \
 *          -> delaySend  -> ping-pong -> lowpass ---> mixBus -> master
 *                                                                 |
 *      glue -> saturator -> air -> lowCut -> limiter -> ceiling -> analyser -> out
 *
 * mixBus and the two sends are also the polyphony gain stage: their gain is
 * automation written ahead of the voices, from the summed amplitude of
 * everything scheduled to sound. See _scheduleGainStaging.
 *
 * The previous version built a fresh PolySynth *and* a fresh Reverb/Distortion/
 * Chorus on every single click and never disposed any of them, so CPU climbed
 * until the tab crackled. Nothing here is allocated per click except the
 * oscillators and gains for a single note, which are stopped and disconnected
 * when they finish.
 */

/**
 * How much input range each WaveShaper's curve is written across.
 *
 * A WaveShaper clamps its input to [-1, 1] *before* the curve lookup, so a
 * curve written across exactly full scale answers anything hotter with a hard
 * clipped square — the harshest possible response to the one condition a
 * saturator exists to handle gracefully. Writing the curve across a wider
 * domain and scaling the signal into it by the same factor leaves the transfer
 * function unchanged below full scale — same curve, same resolution, same
 * sample points — and simply continues it above, so the clamp only bites at
 * +12 dB. Both curves are sized to keep that resolution, so the width is
 * bought with table memory and nothing else; a full chart drives the
 * saturator to about +5 dB, which is where the rest of the margin goes.
 */
export const SAT_HEADROOM = 4;
export const CEILING_HEADROOM = 4;

function saturationCurve(amount = 1.6, headroom = 1, n = 8192) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Index i stands for an input signal of x * headroom.
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * headroom * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * Final ceiling. Linear below the knee, asymptotic above it.
 *
 * A DynamicsCompressor limiter has a finite attack, so fast transients slip a
 * fraction of a decibel past its threshold — measured at 1.012 with a full
 * chart sustaining. This curve makes overshoot arithmetically impossible
 * rather than merely unlikely: its output cannot exceed `ceiling` for any
 * input at all, and across the whole extended domain it approaches that
 * ceiling smoothly instead of flat-topping onto it.
 */
function ceilingCurve(n = 8192, knee = 0.82, ceiling = 0.995, headroom = 1) {
  const curve = new Float32Array(n);
  const shape = (a) => (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  // Normalise on the far end of the domain, so signals below the knee pass at
  // unity rather than being quietly lifted the 0.3 dB that normalising on a
  // full-scale input costs.
  const scale = ceiling / shape(headroom);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * headroom;
    curve[i] = Math.sign(x) * shape(Math.abs(x)) * scale;
  }
  return curve;
}

// --- polyphony gain staging -------------------------------------------------

/** Summed voice amplitude that still passes at unity gain. */
const LOAD_REF = 0.34;
/** How the buses give way above it: the sum grows as load ** (1 - LOAD_EXP). */
const LOAD_EXP = 0.4;
/** Hard cap on the projected sum, whatever the curve above asks for. */
const LOAD_CEILING = 2.2;
/**
 * Extra give from the sends, on top of what they already get.
 *
 * A dense chord wants proportionally less wash than a single note, but the
 * reverb and delay returns feed mixBus, so they are already carrying the bus
 * gain once by the time they are heard. Only the difference belongs here: the
 * wet path ends up at `gain ** (1 + SEND_EXP)` overall. Setting this to the
 * whole ratio instead ducks the wash twice and empties the room out.
 */
const SEND_EXP = 0.3;
/** Backing off has to beat the note that caused it; coming back can amble. */
const DUCK_ATTACK = 0.012;
const DUCK_RELEASE = 0.28;
/** Start the ramp fractionally before the voice that needs it. */
const DUCK_LOOKAHEAD = 0.02;
/** Two load changes closer together than this are written as one. */
const DUCK_QUANTUM = 0.02;
/** How far ahead the load curve is worth writing out. */
const STAGING_HORIZON = 30;
/** Longest gap between samples taken inside a voice's fade. */
const FADE_RESOLUTION = 0.4;
/** However long the fade, no more samples than this across it. */
const FADE_SAMPLES_MAX = 8;

/**
 * A synthetic stereo impulse response.
 *
 * Sparse early reflections, then a noise tail whose brightness falls as it
 * decays (real rooms absorb highs faster than lows). The two channels are
 * generated independently, which is what makes the tail sound wide rather than
 * like a mono blob in the middle of your head.
 */
function createImpulseResponse(ctx, { seconds = 3.6, decay = 1.9, damping = 0.86 } = {}) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;

    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const progress = i / length;
      // Density build-up: a room takes a few milliseconds to go diffuse.
      const build = Math.min(1, t / 0.028);
      const env = build * Math.exp(-decay * t) * (1 - progress) ** 1.7;
      const white = Math.random() * 2 - 1;
      // One-pole lowpass whose coefficient shrinks over time -> darkening tail.
      const coeff = 0.06 + damping * (1 - progress) ** 1.4;
      lp += (white - lp) * coeff;
      data[i] = lp * env;
    }

    // Early reflections, offset per channel so the stereo image opens up.
    const taps = 14;
    for (let k = 0; k < taps; k++) {
      const t = 0.005 + (k / taps) ** 1.5 * 0.075 + (ch ? 0.0031 : 0);
      const idx = Math.floor(t * rate);
      if (idx < length) {
        data[idx] += (Math.random() < 0.5 ? -1 : 1) * 0.55 * (1 - k / taps) ** 1.2;
      }
    }
  }

  // Normalise so reverb amount is independent of the random tail's peak.
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] /= peak;
    }
  }

  return buffer;
}

export class AudioEngine {
  /**
   * @param {object} [opts]
   * @param {BaseAudioContext} [opts.context] Supply an OfflineAudioContext to
   *   render the whole graph to a buffer and measure it. Used by the audio
   *   tests; the app leaves this out and gets a live context.
   */
  constructor({ context = null } = {}) {
    this.ctx = null;
    this.ready = false;
    this.voices = new Set();
    this.maxVoices = 24;
    this.stealFade = 0.06;
    this.loadRef = LOAD_REF;
    this.loadExp = LOAD_EXP;
    this.loadCeiling = LOAD_CEILING;
    this.sendExp = SEND_EXP;
    this._analyserData = null;
    this._providedContext = context;
    if (context) {
      this._build(context);
      this.ready = true;
    }
  }

  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ready = true;
    return this.ctx;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  _build(provided = null) {
    const ctx = provided ?? new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
    });
    this.ctx = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    analyser.connect(ctx.destination);
    this.analyser = analyser;
    this._analyserData = new Float32Array(analyser.fftSize);

    // Hard ceiling: the last thing before the converter.
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = ceilingCurve(8192, 0.82, 0.995, CEILING_HEADROOM);
    ceiling.oversample = '2x';
    ceiling.connect(analyser);

    // Scale into the extended domain the curve was written across.
    const ceilingTrim = ctx.createGain();
    ceilingTrim.gain.value = 1 / CEILING_HEADROOM;
    ceilingTrim.connect(ceiling);

    // Fast brickwall so the ceiling stage almost never has to do anything.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    limiter.connect(ceilingTrim);

    // Broad tone shaping: trim the rumble, lift a little air.
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 28;
    lowCut.Q.value = 0.7;
    lowCut.connect(limiter);

    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 7200;
    air.gain.value = 2.2;
    air.connect(lowCut);

    const saturator = ctx.createWaveShaper();
    saturator.curve = saturationCurve(1.5, SAT_HEADROOM);
    saturator.oversample = '4x';
    saturator.connect(air);

    const satTrim = ctx.createGain();
    satTrim.gain.value = 1 / SAT_HEADROOM;
    satTrim.connect(saturator);

    // Gentle glue, not pumping.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 14;
    glue.ratio.value = 2.4;
    glue.attack.value = 0.02;
    glue.release.value = 0.3;
    glue.connect(satTrim);

    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(glue);
    this.master = master;

    const mixBus = ctx.createGain();
    mixBus.connect(master);
    this.mixBus = mixBus;

    const dryBus = ctx.createGain();
    dryBus.connect(mixBus);
    this.dryBus = dryBus;

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    const preDelay = ctx.createDelay(0.5);
    preDelay.delayTime.value = 0.022;
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = createImpulseResponse(ctx);
    const reverbDamp = ctx.createBiquadFilter();
    reverbDamp.type = 'lowpass';
    reverbDamp.frequency.value = 5200;
    reverbDamp.Q.value = 0.5;
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.9;

    reverbSend.connect(preDelay);
    preDelay.connect(convolver);
    convolver.connect(reverbDamp);
    reverbDamp.connect(reverbReturn);
    reverbReturn.connect(mixBus);
    this.reverbSend = reverbSend;
    this.reverbReturn = reverbReturn;

    const delaySend = ctx.createGain();
    delaySend.gain.value = 1;
    const delayL = ctx.createDelay(2);
    const delayR = ctx.createDelay(2);
    delayL.delayTime.value = 0.375;
    delayR.delayTime.value = 0.5;
    // Lowpass in the feedback loop: repeats get darker instead of shriller.
    const fbDamp = ctx.createBiquadFilter();
    fbDamp.type = 'lowpass';
    fbDamp.frequency.value = 2600;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.75;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.75;
    const delayReturn = ctx.createGain();
    delayReturn.gain.value = 0.55;

    delaySend.connect(delayL);
    delayL.connect(panL);
    delayL.connect(delayR);
    delayR.connect(panR);
    delayR.connect(fbDamp);
    fbDamp.connect(feedback);
    feedback.connect(delayL);
    panL.connect(delayReturn);
    panR.connect(delayReturn);
    delayReturn.connect(mixBus);
    this.delaySend = delaySend;
    this.delayReturn = delayReturn;
    this.delayTimes = [delayL.delayTime, delayR.delayTime];
  }

  setVolume(v) {
    if (!this.ctx) return;
    // Perceptual taper, and a ramp so the slider never zippers.
    this.master.gain.setTargetAtTime(0.95 * v * v, this.ctx.currentTime, 0.02);
  }

  setDelayTime(seconds) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.delayTimes[0].setTargetAtTime(seconds * 0.75, t, 0.05);
    this.delayTimes[1].setTargetAtTime(seconds, t, 0.05);
  }

  /**
   * Voices that still occupy a polyphony slot.
   *
   * A voice may have a release scheduled far in the future, but it still owns
   * live nodes and will still sound until then. `released` cannot be used here:
   * it means "a release has been scheduled", not "the voice has ended".
   */
  activeVoiceCount() {
    let n = 0;
    for (const v of this.voices) if (!v.stolen) n++;
    return n;
  }

  /**
   * Summed voice amplitude at a given moment.
   *
   * This — not a voice *count* — is what the gain staging below runs on. A
   * count says a chart's Pluto costs the same headroom as its Sun, that a
   * voice scheduled four seconds from now is already in the way, and that one
   * two thirds of the way through its release still needs its whole slot.
   * None of that is true, and each of them is a way for the real sum to walk
   * past whatever a count-based rule thought it had budgeted.
   */
  loadAt(t) {
    let sum = 0;
    for (const v of this.voices) sum += v.amplitudeAt?.(t) ?? 0;
    return sum;
  }

  /**
   * The bus gain a given load has earned.
   *
   * Two different sums matter here, and the exponent has to satisfy both.
   *
   * What the chain has to survive is the worst case, where voices line up in
   * phase and amplitudes add: that grows as `load ** (1 - loadExp)`. What a
   * listener actually hears is the far commoner uncorrelated case, where n
   * voices of amplitude a make an RMS of `sqrt(n) * a` — so the perceived
   * level grows as `sqrt(load) * gain`. That second sum is why the obvious
   * choice is wrong: at loadExp 0.5, the equal-power law, the two exactly
   * cancel and a sixteen-voice chord comes out no louder than a single note,
   * which is safe and completely lifeless. Below 0.5 the ensemble grows
   * again; 0.4 puts a full chart about 4 dB over one voice while holding the
   * in-phase worst case inside what the saturator's curve is written across.
   *
   * The second term is the backstop for the case the curve is too generous
   * about — a burst far denser or louder than a chart can ask for. It caps
   * the projected sum outright, and in normal use it never binds.
   */
  gainForLoad(load) {
    if (!(load > this.loadRef)) return 1;
    return Math.min((this.loadRef / load) ** this.loadExp, this.loadCeiling / load);
  }

  /** Every moment between now and the horizon at which the load changes. */
  _loadBreakpoints(now) {
    const times = new Set([now]);
    const add = (t) => {
      if (t != null && t > now && t < now + STAGING_HORIZON) times.add(t);
    };
    for (const v of this.voices) {
      add(v.t0);
      if (v.fadeFrom == null) continue;
      // A release lets go gradually, so the load has to be sampled *inside*
      // the fade and not only at its ends. Taking the ends alone reads the
      // load as still near full for the whole of a five-second tail, holding
      // the bus down over the decay it was supposed to be following.
      const span = v.fadeUntil - v.fadeFrom;
      const steps = Math.max(1, Math.min(FADE_SAMPLES_MAX, Math.ceil(span / FADE_RESOLUTION)));
      for (let k = 0; k <= steps; k++) add(v.fadeFrom + (span * k) / steps);
    }
    return [...times].sort((a, b) => a - b);
  }

  /**
   * Write the bus gain automation out to the end of what is already scheduled.
   *
   * Voices are built ahead of time — a bloom hands the engine all ten before
   * the first one sounds, and every voice with a fixed duration knows when it
   * will release before it has made a sound. A gain stage that only reacted to
   * what is audible *now* would have to choose between ducking the opening
   * note for a chord that has not arrived and not ducking at all. So instead
   * the load curve is evaluated wherever it changes and written into the
   * params in advance, and rewritten whenever a voice joins, releases or ends.
   */
  _scheduleGainStaging() {
    if (!this.ctx) return;
    const now = this.now;
    const points = [];

    for (const at of this._loadBreakpoints(now)) {
      // Sample just past the breakpoint: at a voice's own start time it is the
      // load it is about to add that the ramp has to answer for.
      const gain = this.gainForLoad(this.loadAt(at + 1e-4));
      const when = Math.max(now, at - DUCK_LOOKAHEAD);
      const last = points[points.length - 1];
      // Two changes inside one quantum become one, taking the safer of them.
      if (last && when - last.when < DUCK_QUANTUM) last.gain = Math.min(last.gain, gain);
      else points.push({ when, gain });
    }

    for (const [param, exponent] of [
      [this.mixBus.gain, 1],
      [this.reverbSend.gain, this.sendExp],
      [this.delaySend.gain, this.sendExp],
    ]) {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else param.cancelScheduledValues(now);
      let previous = param.value;
      for (const { when, gain } of points) {
        const target = exponent === 1 ? gain : gain ** exponent;
        // Asymmetric, for the same reason a compressor is: getting out of the
        // way late is audible as distortion, coming back early as pumping.
        param.setTargetAtTime(target, when, target < previous ? DUCK_ATTACK : DUCK_RELEASE);
        previous = target;
      }
    }
  }

  /** Re-derive the gain staging after a voice's schedule changed. */
  refreshGainStaging(voice = null) {
    if (voice && !this.voices.has(voice)) return;
    this._scheduleGainStaging();
  }

  /**
   * Reclaim polyphony slots once the cap is exceeded.
   *
   * Which voice goes matters more than how fast it goes. Anything scheduled
   * but not yet audible can be dropped for nothing, so those go first, latest
   * first — that is the note the arrangement has committed to least. Then
   * whatever is already fading, nearest silence first. Only when everything is
   * genuinely sounding does a live voice get taken, and then the quietest one,
   * over a fade scaled to how loud it actually is. A flat 60 ms cut on a
   * sustaining bass note is the part of the old cap you could hear.
   */
  _reclaimSlots() {
    let guard = this.voices.size;
    while (this.activeVoiceCount() > this.maxVoices && guard-- > 0) {
      const victim = this._stealCandidate();
      if (!victim) break;
      const level = Math.min(1, victim.amplitudeAt(this.now) / this.loadRef);
      victim.steal(this.now, this.stealFade * (1 + 3 * level));
    }
  }

  _stealCandidate() {
    const t = this.now;
    let best = null;
    for (const v of this.voices) {
      if (!v.stolen && (best === null || this._cheaperToSteal(v, best, t))) best = v;
    }
    return best;
  }

  /** Would taking `v`'s slot cost less than taking `other`'s? */
  _cheaperToSteal(v, other, t) {
    const tier = (x) => (t < x.t0 ? 0 : x.fadeFrom != null && t >= x.fadeFrom ? 1 : 2);
    const difference = tier(v) - tier(other);
    if (difference !== 0) return difference < 0;
    // Nothing audible yet: give up whichever is scheduled furthest out, and
    // between two scheduled together, whichever was asked for last.
    if (tier(v) === 0) return (v.t0 - other.t0 || v.id - other.id) > 0;
    // Otherwise the quietest, and among equals the one sounding longest.
    return (v.amplitudeAt(t) - other.amplitudeAt(t) || v.t0 - other.t0 || v.id - other.id) < 0;
  }

  register(voice) {
    this.voices.add(voice);
    // A voice stays in the set until its nodes are torn down. In particular,
    // `released` can mean a release scheduled seconds from now, so it is not
    // a signal that the voice has stopped consuming a polyphony slot.
    this._reclaimSlots();
    this._scheduleGainStaging();
  }

  unregister(voice) {
    this.voices.delete(voice);
    this._scheduleGainStaging();
  }

  releaseAll(fade = 0.25) {
    const t = this.now;
    for (const v of Array.from(this.voices)) {
      if (v.release) v.release(t, fade);
    }
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this._analyserData);
    let sum = 0;
    for (let i = 0; i < this._analyserData.length; i++) {
      sum += this._analyserData[i] * this._analyserData[i];
    }
    return Math.sqrt(sum / this._analyserData.length);
  }

  waveform() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this._analyserData);
    return this._analyserData;
  }
}

export const engine = new AudioEngine();
