/**
 * One graph is built once and reused for the life of the page:
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
 * Only a note's oscillators and gains may be allocated per click, and they must
 * be stopped and disconnected when finished. Rebuilding shared effects per
 * click accumulates live nodes until the tab crackles.
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
 * sample points — and simply continues it above, so the clamp bites at +6 dB
 * (saturator) and +12 dB (ceiling) instead of at 0. Both curves are sized to
 * keep that resolution, so the width costs table memory and nothing else.
 *
 * This is a backstop, not headroom to spend. Widening it does not make a hot
 * signal clean, only less catastrophically dirty. Keeping SAT_HEADROOM tight
 * is deliberate: it makes the render tests fail when the staging lets too much
 * through, which is how a 9 dB level regression got caught.
 */
export const SAT_HEADROOM = 2;
export const CEILING_HEADROOM = 4;

/**
 * How hard the saturator's tanh is driven.
 *
 * In terms of the signal reaching the stage the transfer function is
 * `tanh(s * drive) / tanh(drive)`, whose slope at the origin is
 * `drive / tanh(drive)`. At the 1.5 this used to run at that slope is 1.66,
 * so the stage was quietly supplying +4.4 dB of level, and at the peaks the
 * mix actually reaches it was taking about 3 dB back out again — per sample.
 *
 * Per-sample gain reduction across a dense polyphonic mix is intermodulation:
 * every pair of partials breeding sum and difference tones that belong to no
 * note being played. That is the buzz. It is not the compressors, whose gain
 * moves over milliseconds and is heard as level rather than as dirt.
 *
 * Measured on a running melodic line, fitting the linear reference in 128
 * sample blocks so that compressor gain riding is separated from waveform
 * distortion, the residual against drive — at matched loudness throughout:
 *
 *     drive   1.5     1.0     0.85    0.7     0.55    0.4
 *     resid  -29.2   -34.3   -36.7   -37.6   -40.2   -41.2 dB
 *
 * Turning the whole mix down 3 dB instead, with the curve left alone, moved
 * it only from -29.2 to -31.1: this is the curve's doing and not the level's.
 * 0.55 takes 11 dB of it while still bending the waveform audibly; below that
 * the curve is nearly a straight line and there is little left to win.
 */
const SAT_DRIVE = 0.55;
/** The drive whose small-signal gain the stage is held to, so this stays loudness-neutral. */
const SAT_REFERENCE_DRIVE = 1.5;
const smallSignalGain = (drive) => drive / Math.tanh(drive);
/**
 * Makeup for the level a softer curve no longer supplies.
 *
 * Exactly the small-signal gain the old curve had, so changing SAT_DRIVE moves
 * how much the waveform is bent and nothing else. Making the mix quieter is
 * not what fixed this and must not be smuggled in here.
 */
const SAT_MAKEUP = smallSignalGain(SAT_REFERENCE_DRIVE) / smallSignalGain(SAT_DRIVE);

export function saturationCurve(amount = SAT_DRIVE, headroom = 1, n = 4096) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Index i stands for an input signal of x * headroom.
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * headroom * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * What the saturator stage does to a signal of amplitude `s`, makeup included.
 * Exported so the drive can be regression-tested without an AudioContext.
 */
export function saturatorResponse(s, drive = SAT_DRIVE, makeup = SAT_MAKEUP) {
  return (Math.tanh(s * drive) / Math.tanh(drive)) * makeup;
}

export { SAT_DRIVE, SAT_MAKEUP };

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

/** Summed voice amplitude that still passes at unity gain. */
const LOAD_REF = 0.34;
/** How the buses give way above it: the sum grows as load ** (1 - LOAD_EXP). */
const LOAD_EXP = 0.65;
/** Hard cap on the projected sum, whatever the curve above asks for. */
const LOAD_CEILING = 1.1;
/**
 * How much harder the sends give way than the dry bus.
 *
 * The reverb and delay returns feed mixBus, so the wet path carries the bus
 * gain twice over: `gain ** (1 + SEND_EXP)`. That looks like a mistake and is
 * not one. Both effects are integrators — a 3.6 s tail and a feedback delay
 * accumulate whatever they are fed — so the send is the only place their
 * level can actually be governed, and a dense passage wants proportionally
 * less wash anyway. Backing this off to compensate for the double count put
 * three times more signal into the saturator on a running transport.
 */
const SEND_EXP = 1.5;
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
 * Unit-interval noise from a tick and a salt, independent of call order.
 *
 * The IR and the voice noise buffer used to draw Math.random once per sample.
 * At 44.1 kHz that is fewer draws than at 48 kHz, so a seeded comparison of
 * two rates was comparing two different rooms. Hashing the physical time
 * (and channel) gives the same noise field at any rate; each context just
 * samples it at its own resolution.
 */
function unitNoise(tick, salt) {
  let x = Math.imul((tick + 1) | 0, 0x9E3779B1) ^ Math.imul((salt + 1) | 0, 0x85EBCA77);
  x = Math.imul(x ^ (x >>> 16), 0x7FEB352D);
  x = Math.imul(x ^ (x >>> 15), 0x846CA68B);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Canonical rate of the noise field the IR samples. */
const IR_NOISE_RATE = 48000;

/**
 * A synthetic stereo impulse response.
 *
 * Sparse early reflections, then a noise tail whose brightness falls as it
 * decays (real rooms absorb highs faster than lows). The two channels are
 * generated independently, which is what makes the tail sound wide rather than
 * like a mono blob in the middle of your head.
 *
 * Duration is `floor(rate * seconds) / rate`, so the tail lasts the same time
 * at 44.1 kHz as at 48 kHz — only the resolution changes. The parity check in
 * tests/audio.test.html asserts that. The one-pole coeff is per-sample rather
 * than per-second, which is the other rate-exposed spot: a future edit that
 * forgets to go through `t = i / rate` will show up as a brightness shift.
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
      const white = unitNoise(Math.floor(t * IR_NOISE_RATE), ch) * 2 - 1;
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
        const sign = unitNoise(k, ch + 2) < 0.5 ? -1 : 1;
        data[idx] += sign * 0.55 * (1 - k / taps) ** 1.2;
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
    this._sampleRate = null;
    this._keepAlive = null;
    if (context) {
      this._build(context);
      this.ready = true;
    }
  }

  async start() {
    if (!this.ctx || this.ctx.state === 'closed') this._build();
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
      await this.ctx.resume();
    }
    this.ready = true;
    return this.ctx;
  }

  /**
   * Park the context while the page is hidden. Live contexts only — an
   * OfflineAudioContext supplied for tests has no suspend to speak of.
   */
  async suspend() {
    if (!this.ctx || this._providedContext) return;
    if (this.ctx.state === 'running') await this.ctx.suspend();
  }

  /**
   * Whether the live graph has to be torn down and rebuilt before sound can
   * continue. A closed context, a Safari `interrupted` state that will not
   * resume cleanly, or a sample-rate change under a live context (headphones
   * unplugged on some platforms) all qualify.
   */
  needsRebuild() {
    if (this._providedContext) return false;
    if (!this.ctx || this.ctx.state === 'closed') return true;
    if (this._sampleRate != null && this.ctx.sampleRate !== this._sampleRate) return true;
    return false;
  }

  /**
   * Tear down the current graph and build a fresh one. Voices owned by the
   * old context are dropped without release — their nodes are already dead.
   * Used by the lifecycle layer after an interrupt that closed the context
   * or changed the hardware sample rate.
   */
  async rebuild() {
    if (this._providedContext) return this.ctx;
    this._stopKeepAlive();
    this.voices.clear();
    const prev = this.ctx;
    if (prev && prev.state !== 'closed') {
      try { await prev.close(); } catch { /* already shutting down */ }
    }
    this.ctx = null;
    this.ready = false;
    this.analyser = null;
    this.master = null;
    this.mixBus = null;
    this.dryBus = null;
    this.reverbSend = null;
    this.reverbReturn = null;
    this.delaySend = null;
    this.delayReturn = null;
    this.delayTimes = null;
    this.stages = null;
    this._build();
    await this.start();
    return this.ctx;
  }

  /**
   * Silent looping buffer so the audio route stays warm after the first
   * gesture. Cheap, and the fix for the cold-start stutter that otherwise
   * lands on the first real note in a WebView.
   */
  ensureKeepAlive() {
    if (!this.ctx || this._providedContext || this._keepAlive) return;
    if (typeof this.ctx.createBuffer !== 'function') return;
    const buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    try {
      src.start();
    } catch {
      return;
    }
    this._keepAlive = { src, gain };
  }

  _stopKeepAlive() {
    if (!this._keepAlive) return;
    try { this._keepAlive.src.stop(); } catch { /* already stopped */ }
    try { this._keepAlive.src.disconnect(); } catch { /* */ }
    try { this._keepAlive.gain.disconnect(); } catch { /* */ }
    this._keepAlive = null;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : this._sampleRate;
  }

  _build(provided = null) {
    const ctx = provided ?? new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
    });
    this.ctx = ctx;
    this._sampleRate = ctx.sampleRate;

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

    // Puts back the level the softer curve no longer supplies, linearly, so
    // the loudness comes from a gain and the character comes from the curve.
    const satMakeup = ctx.createGain();
    satMakeup.gain.value = SAT_MAKEUP;
    satMakeup.connect(air);

    const saturator = ctx.createWaveShaper();
    saturator.curve = saturationCurve(SAT_DRIVE, SAT_HEADROOM);
    saturator.oversample = '4x';
    saturator.connect(satMakeup);

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

    // Named so a test can bypass one stage at a time and hear which one is
    // responsible for an artifact. Nothing in the app reads this.
    this.stages = { glue, satTrim, saturator, satMakeup, air, lowCut, limiter, ceilingTrim, ceiling, analyser };

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
    this.stages.convolver = convolver;

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
   * Constant-sum limiting (`loadRef / load`) would make a ten-voice chord
   * exactly as loud as a single note: safe, and lifeless. Letting the sum
   * grow as `load ** (1 - loadExp)` instead keeps an ensemble bigger than one
   * voice while bounding it. The second term is the backstop for a burst
   * denser or louder than a chart can ask for: it caps the projected sum
   * outright, and in normal use it does not bind.
   *
   * loadExp is deliberately high. There is an argument for lowering it — n
   * uncorrelated voices are heard as `sqrt(n) * a`, so anything at or above
   * 0.5 stops the ensemble growing with density, and 0.65 lets it shrink a
   * little. That argument is real but it is worth less than the headroom it
   * costs: at 0.4 a running melodic line drove the saturator to 2.05 where
   * this drives it to 0.69, and the difference is plainly audible as
   * distortion. The master chain's compressor supplies the loudness. This
   * stage's job is to hand it something clean, so it errs toward quiet.
   */
  gainForLoad(load) {
    if (!(load > this.loadRef)) return 1;
    return Math.min((this.loadRef / load) ** this.loadExp, this.loadCeiling / load);
  }

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
