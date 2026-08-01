/**
 * The audio engine.
 *
 * One graph, built once, reused for the life of the page:
 *
 *   voices -> dryBus --------------------------\
 *          -> reverbSend -> preDelay -> IR -> damp -> \
 *          -> delaySend  -> ping-pong -> lowpass ---> mixBus
 *                                                       |
 *              glue compressor -> saturator -> tilt -> limiter -> analyser -> out
 *
 * The previous version built a fresh PolySynth *and* a fresh Reverb/Distortion/
 * Chorus on every single click and never disposed any of them, so CPU climbed
 * until the tab crackled. Nothing here is allocated per click except the
 * oscillators and gains for a single note, which are stopped and disconnected
 * when they finish.
 */

function saturationCurve(amount = 1.6, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * Final ceiling. Linear below the knee, asymptotic above it.
 *
 * A DynamicsCompressor limiter has a finite attack, so fast transients slip a
 * fraction of a decibel past its threshold — measured at 1.012 with a full
 * chart sustaining. A WaveShaper clamps its input to [-1, 1] before the curve
 * lookup, so whatever arrives, the output cannot exceed the curve's endpoint.
 * That makes overshoot arithmetically impossible rather than merely unlikely.
 */
function ceilingCurve(n = 8192, knee = 0.82, ceiling = 0.995) {
  const curve = new Float32Array(n);
  const shape = (a) => (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  const scale = ceiling / shape(1);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.sign(x) * shape(Math.abs(x)) * scale;
  }
  return curve;
}

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
    this.maxVoices = 30;
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
    ceiling.curve = ceilingCurve();
    ceiling.oversample = '2x';
    ceiling.connect(analyser);

    // Fast brickwall so the ceiling stage almost never has to do anything.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    limiter.connect(ceiling);

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
    saturator.curve = saturationCurve(1.5);
    saturator.oversample = '4x';
    saturator.connect(air);

    // Gentle glue, not pumping.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 14;
    glue.ratio.value = 2.4;
    glue.attack.value = 0.02;
    glue.release.value = 0.3;
    glue.connect(saturator);

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

  register(voice) {
    this.voices.add(voice);
    // A voice stays in the set until its nodes are torn down. In particular,
    // `released` can mean a release scheduled seconds from now, so it is not
    // a signal that the voice has stopped consuming a polyphony slot.
    while (this.activeVoiceCount() > this.maxVoices) {
      let oldest = null;
      for (const v of this.voices) {
        if (!v.stolen) { oldest = v; break; }
      }
      if (!oldest) break;
      oldest.steal(this.now, 0.12);
    }
  }

  unregister(voice) {
    this.voices.delete(voice);
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
