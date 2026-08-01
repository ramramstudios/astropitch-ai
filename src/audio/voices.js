/**
 * Timbre synthesis.
 *
 * Three independent axes compose into one voice:
 *
 *   ELEMENT  is the material   — what the tone is physically made of: the
 *                                oscillator stack, its harmonic content, the
 *                                noise layer, the resonant body, how it drifts.
 *   HOUSE    is the gesture    — how that material gets played: struck, bowed,
 *                                gated, doubled, blurred, sung.
 *   MODALITY is the phrasing   — how long the gesture lasts and how much it
 *                                moves while it lasts.
 *
 * So Fire always sounds like fire and the 2nd house always sounds struck, but
 * fire-struck (Aries in the 2nd) and water-struck (Cancer in the 2nd) are
 * different instruments. 12 x 12 x 3 combinations, none of them samples.
 */

import { MODALITIES } from '../ontology.js';

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Slightly pink-tilted noise; pure white is thin and hissy on a transient.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.035 * w) / 1.035;
      d[i] = w * 0.72 + last * 3.6;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

const driveCurves = new Map();
function driveCurve(amount) {
  const key = amount.toFixed(2);
  let curve = driveCurves.get(key);
  if (!curve) {
    const n = 1024;
    curve = new Float32Array(n);
    const k = 1 + amount * 9;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    driveCurves.set(key, curve);
  }
  return curve;
}

export const MATERIALS = {
  // Dense, bright, every harmonic present. Saws beating against each other,
  // pushed into soft clipping so the spectrum keeps growing with level.
  fire: {
    partials: [
      { type: 'sawtooth', detune: 0, gain: 1.0 },
      { type: 'sawtooth', detune: 8, gain: 0.62 },
      { type: 'square', detune: -11, gain: 0.22 },
    ],
    sub: 0.10,
    noise: { gain: 0.30, decay: 0.05, filter: 'highpass', freq: 1800, Q: 0.7 },
    body: { ratio: 2.7, Q: 1.2, gain: 4.5 },
    tilt: 3.5,
    drive: 0.5,
    cutoffMul: 7.0,
    resonance: 3.4,
    drift: { rate: 0, depth: 0 },
    send: { reverb: 0.16, delay: 0.10 },
    width: 0.35,
  },

  // Low-order harmonics only, a wooden box resonance, and a thud rather than a
  // crack. Everything above the fourth partial is rolled away.
  earth: {
    partials: [
      { type: 'triangle', detune: 0, gain: 1.0 },
      { type: 'sine', detune: 4, gain: 0.55 },
      { type: 'triangle', detune: -6, gain: 0.34 },
    ],
    sub: 0.42,
    noise: { gain: 0.22, decay: 0.03, filter: 'lowpass', freq: 900, Q: 1.4 },
    body: { ratio: 1.6, Q: 3.2, gain: 6.5 },
    tilt: -5.5,
    drive: 0.14,
    cutoffMul: 3.0,
    resonance: 1.5,
    drift: { rate: 0, depth: 0 },
    send: { reverb: 0.11, delay: 0.04 },
    width: 0.2,
  },

  // Hollow odd harmonics from a narrow pulse, plus an audible column of breath
  // that tracks the pitch. Thin on purpose, and very wide.
  air: {
    partials: [
      { type: 'square', detune: 0, gain: 0.75 },
      { type: 'sawtooth', detune: 6, gain: 0.30 },
      { type: 'square', detune: -1202, gain: 0.26 },
    ],
    sub: 0.05,
    noise: { gain: 0.34, decay: 1.4, filter: 'bandpass', freq: 3.0, Q: 1.6, tracks: true },
    body: { ratio: 4.2, Q: 1.8, gain: 3.5 },
    tilt: 4.5,
    drive: 0.06,
    cutoffMul: 6.0,
    resonance: 2.2,
    drift: { rate: 0.12, depth: 0.06 },
    send: { reverb: 0.32, delay: 0.30 },
    width: 0.9,
  },

  // Sine cores that will not hold still: heavy detune, slow independent drift,
  // and a low-index FM wobble that keeps the spectrum sliding.
  water: {
    partials: [
      { type: 'sine', detune: 0, gain: 1.0 },
      { type: 'triangle', detune: 13, gain: 0.66 },
      { type: 'sine', detune: -15, gain: 0.66 },
    ],
    sub: 0.26,
    noise: { gain: 0.10, decay: 0.5, filter: 'lowpass', freq: 1400, Q: 0.9 },
    body: { ratio: 2.05, Q: 2.0, gain: 3.0 },
    tilt: -1.5,
    drive: 0.05,
    cutoffMul: 4.0,
    resonance: 2.6,
    drift: { rate: 0.22, depth: 0.22 },
    fm: { ratio: 1.5, index: 0.6, decay: 3.0 },
    send: { reverb: 0.5, delay: 0.2 },
    width: 0.62,
  },
};

const G = (o) => ({
  ampMul: { attack: 1, decay: 1, sustain: 1, release: 1 },
  filter: { start: 1, env: 0.6, attack: 0.01, decay: 0.6, qMul: 1 },
  noiseMul: 1,
  driveMul: 1,
  subMul: 1,
  glide: 0,
  gate: null,
  double: null,
  fm: null,
  send: { reverb: 1, delay: 1 },
  widthMul: 1,
  ...o,
});

export const GESTURES = {
  // 1st — ego. Nothing in front of the voice. Dry, immediate, unprocessed.
  1: G({
    ampMul: { attack: 0.5, decay: 1, sustain: 1.05, release: 0.9 },
    filter: { start: 1.4, env: 0.35, attack: 0.006, decay: 0.4, qMul: 0.8 },
    send: { reverb: 0.35, delay: 0.3 },
    widthMul: 0.5,
  }),

  // 2nd — possessions. Struck. Mass, then immediate decay; nothing sustains.
  2: G({
    ampMul: { attack: 0.05, decay: 0.55, sustain: 0.06, release: 0.7 },
    filter: { start: 2.6, env: 1.5, attack: 0.002, decay: 0.28, qMul: 1.4 },
    noiseMul: 1.7,
    subMul: 1.5,
    send: { reverb: 0.7, delay: 0.4 },
  }),

  // 3rd — communication. Consonants: a hard transient and a fast flutter.
  3: G({
    ampMul: { attack: 0.08, decay: 0.5, sustain: 0.35, release: 0.5 },
    filter: { start: 3.0, env: 1.1, attack: 0.003, decay: 0.16, qMul: 1.6 },
    noiseMul: 2.0,
    gate: { rate: 11, depth: 0.5, cycles: 5 },
    send: { reverb: 0.6, delay: 1.5 },
  }),

  // 4th — home. Heard through a wall: soft, muffled, close.
  4: G({
    ampMul: { attack: 2.2, decay: 1.2, sustain: 1.0, release: 1.3 },
    filter: { start: 0.45, env: 0.3, attack: 0.12, decay: 1.0, qMul: 0.7 },
    noiseMul: 0.4,
    subMul: 1.4,
    send: { reverb: 0.8, delay: 0.3 },
    widthMul: 0.6,
  }),

  // 5th — creativity. Sung: scoops up to pitch, then opens out with vibrato.
  5: G({
    ampMul: { attack: 3.0, decay: 1.1, sustain: 1.1, release: 1.2 },
    filter: { start: 0.7, env: 1.0, attack: 0.35, decay: 1.4, qMul: 1.3 },
    glide: 0.22,
    vibrato: { rate: 5.4, depth: 22, delay: 0.35 },
    send: { reverb: 1.0, delay: 0.7 },
  }),

  // 6th — routine. Runs to a clock, and the clock does not vary.
  6: G({
    ampMul: { attack: 0.12, decay: 0.6, sustain: 0.75, release: 0.5 },
    filter: { start: 1.5, env: 0.5, attack: 0.004, decay: 0.2, qMul: 1.5 },
    gate: { rate: 8, depth: 0.85, cycles: Infinity },
    send: { reverb: 0.4, delay: 0.5 },
    widthMul: 0.4,
  }),

  // 7th — partnership. Two of everything, detuned apart and panned apart, one
  // arriving a beat after the other.
  7: G({
    ampMul: { attack: 1.4, decay: 1.0, sustain: 1.0, release: 1.2 },
    filter: { start: 1.1, env: 0.5, attack: 0.05, decay: 0.8, qMul: 1.0 },
    double: { detune: 9, delay: 0.055, pan: 0.7, gain: 0.85 },
    send: { reverb: 0.9, delay: 0.5 },
    widthMul: 1.3,
  }),

  // 8th — transformation. Sub-heavy, driven, and it opens slowly from nearly
  // closed, so the timbre at the end is not the timbre at the start.
  8: G({
    ampMul: { attack: 1.6, decay: 1.4, sustain: 1.0, release: 1.5 },
    filter: { start: 0.28, env: 2.6, attack: 1.4, decay: 3.0, qMul: 2.2 },
    driveMul: 2.6,
    subMul: 2.0,
    noiseMul: 0.5,
    send: { reverb: 0.9, delay: 0.6 },
  }),

  // 9th — travel. A long horizon: distant, wide, mostly reflected sound.
  9: G({
    ampMul: { attack: 2.4, decay: 1.3, sustain: 0.95, release: 1.8 },
    filter: { start: 1.2, env: 0.6, attack: 0.5, decay: 1.6, qMul: 0.9 },
    noiseMul: 0.5,
    send: { reverb: 2.1, delay: 1.6 },
    widthMul: 1.6,
  }),

  // 10th — career. Brass: the filter overshoots on the attack and settles,
  // which is exactly what makes a horn read as a horn.
  10: G({
    ampMul: { attack: 0.7, decay: 0.9, sustain: 1.0, release: 0.9 },
    filter: { start: 0.55, env: 3.2, attack: 0.09, decay: 0.5, qMul: 1.2 },
    driveMul: 1.5,
    send: { reverb: 0.6, delay: 0.35 },
    widthMul: 0.7,
  }),

  // 11th — technology. FM at an inharmonic ratio: a bell that no physical bell
  // could be cast to make.
  11: G({
    ampMul: { attack: 0.04, decay: 1.8, sustain: 0.12, release: 2.4 },
    filter: { start: 3.5, env: 0.4, attack: 0.002, decay: 1.2, qMul: 0.8 },
    fm: { ratio: 3.47, index: 5.5, decay: 1.1 },
    noiseMul: 0.3,
    send: { reverb: 1.3, delay: 1.2 },
    widthMul: 1.2,
  }),

  // 12th — the unconscious. Arrives before it begins: a very long swell, almost
  // all of it reverb, pitch never quite fixed.
  12: G({
    ampMul: { attack: 9.0, decay: 1.6, sustain: 0.85, release: 2.6 },
    filter: { start: 0.5, env: 1.2, attack: 1.8, decay: 3.0, qMul: 1.1 },
    noiseMul: 0.6,
    glide: 0.5,
    send: { reverb: 2.6, delay: 1.4 },
    widthMul: 1.5,
  }),
};

export function buildVoiceSpec({ element, house, modality }) {
  const material = MATERIALS[element] ?? MATERIALS.fire;
  const gesture = GESTURES[house] ?? GESTURES[1];
  const phrasing = (MODALITIES[modality] ?? MODALITIES.cardinal).envelope;

  const amp = {
    attack: Math.max(0.002, phrasing.attack * gesture.ampMul.attack),
    decay: Math.max(0.02, phrasing.decay * gesture.ampMul.decay),
    sustain: Math.min(1, Math.max(0.001, phrasing.sustain * gesture.ampMul.sustain)),
    release: Math.max(0.05, phrasing.release * gesture.ampMul.release),
  };

  // Modality decides how much the voice moves; the gesture can override the
  // rate and depth outright (the 5th house sings whatever sign it is in).
  const baseVib = { rate: 4.8, depth: 9 * phrasing.vibrato, delay: 0.25 };
  const vibrato = gesture.vibrato
    ? { ...gesture.vibrato, depth: gesture.vibrato.depth * (0.45 + phrasing.vibrato) }
    : baseVib;

  return {
    material,
    gesture,
    amp,
    vibrato,
    drive: Math.min(0.95, material.drive * gesture.driveMul),
    sub: material.sub * gesture.subMul,
    noise: material.noise ? { ...material.noise, gain: material.noise.gain * gesture.noiseMul } : null,
    fm: gesture.fm ?? material.fm ?? null,
    send: {
      reverb: Math.min(1, material.send.reverb * gesture.send.reverb),
      delay: Math.min(1, material.send.delay * gesture.send.delay),
    },
    width: Math.min(1, material.width * gesture.widthMul),
  };
}

let voiceSerial = 0;

export class Voice {
  /**
   * @param {AudioEngine} engine
   * @param {object} spec       from buildVoiceSpec
   * @param {object} opts       { freq, time, duration, gain, pan, detune }
   */
  constructor(engine, spec, opts) {
    this.id = voiceSerial++;
    this.engine = engine;
    this.spec = spec;
    this.nodes = [];
    this.sources = [];
    this.released = false;
    // `released` only says that an envelope release has been scheduled. A
    // future release is still a fully live voice, so voice stealing gets its
    // own state and can free a polyphony slot immediately.
    this.stolen = false;
    this.releaseAt = null;
    // The source whose ending defines the voice's lifetime. It must be one that
    // is never stopped early — the gate oscillator finishes mid-note, so hanging
    // teardown off "the last source in the array" would cut the note short.
    this.lifetimeSource = null;
    this._build(opts);
  }

  _build({ freq, time, duration = null, gain = 1, pan = 0, detune = 0 }) {
    const { ctx } = this.engine;
    const t0 = Math.max(time ?? ctx.currentTime, ctx.currentTime);
    const { material, gesture, amp, vibrato } = this.spec;
    this.t0 = t0;

    // --- output stage ---
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * this.spec.width));

    const vca = ctx.createGain();
    vca.gain.value = 0.0001;
    vca.connect(panner);
    this.vca = vca;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - 0.4 * this.spec.send.reverb;
    panner.connect(dryGain);
    dryGain.connect(this.engine.dryBus);

    if (this.spec.send.reverb > 0.001) {
      const rs = ctx.createGain();
      rs.gain.value = this.spec.send.reverb * 0.55;
      panner.connect(rs);
      rs.connect(this.engine.reverbSend);
      this.nodes.push(rs);
    }
    if (this.spec.send.delay > 0.001) {
      const ds = ctx.createGain();
      ds.gain.value = this.spec.send.delay * 0.4;
      panner.connect(ds);
      ds.connect(this.engine.delaySend);
      this.nodes.push(ds);
    }
    this.nodes.push(panner, dryGain);

    // --- optional per-voice drive ---
    let chainHead = vca;
    if (this.spec.drive > 0.02) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(this.spec.drive);
      shaper.oversample = '2x';
      // Trim to compensate for the level a soft-clipper adds.
      const trim = ctx.createGain();
      trim.gain.value = 1 / (1 + this.spec.drive * 1.1);
      shaper.connect(trim);
      trim.connect(vca);
      chainHead = shaper;
      this.nodes.push(shaper, trim);
    }

    // --- tilt EQ: the material's spectral signature ---
    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 2400;
    tilt.gain.value = material.tilt;
    tilt.connect(chainHead);
    this.nodes.push(tilt);

    // --- main filter, with its own envelope ---
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = material.resonance * gesture.filter.qMul;
    filter.connect(tilt);
    this.filter = filter;
    this.nodes.push(filter);

    const nyquist = ctx.sampleRate / 2;
    const clampF = (f) => Math.max(40, Math.min(nyquist * 0.92, f));
    const startF = clampF(freq * material.cutoffMul * gesture.filter.start);
    const peakF = clampF(startF * (1 + gesture.filter.env * 3));
    const settleF = clampF(startF * (1 + gesture.filter.env * 0.6));

    filter.frequency.setValueAtTime(startF, t0);
    filter.frequency.exponentialRampToValueAtTime(peakF, t0 + gesture.filter.attack);
    filter.frequency.exponentialRampToValueAtTime(
      settleF,
      t0 + gesture.filter.attack + gesture.filter.decay
    );

    // --- resonant body: the material's fixed formant ---
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = clampF(freq * material.body.ratio);
    body.Q.value = material.body.Q;
    body.gain.value = material.body.gain;
    body.connect(filter);
    this.nodes.push(body);

    const oscMix = ctx.createGain();
    oscMix.gain.value = 0.28;
    oscMix.connect(body);
    this.nodes.push(oscMix);

    // --- vibrato / drift modulators ---
    let vibratoGain = null;
    if (vibrato.depth > 0.1) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = vibrato.rate;
      vibratoGain = ctx.createGain();
      vibratoGain.gain.setValueAtTime(0.0001, t0);
      vibratoGain.gain.setValueAtTime(0.0001, t0 + vibrato.delay);
      vibratoGain.gain.linearRampToValueAtTime(vibrato.depth, t0 + vibrato.delay + 0.6);
      lfo.connect(vibratoGain);
      lfo.start(t0);
      this.sources.push(lfo);
      this.nodes.push(vibratoGain);
    }

    if (material.drift.depth > 0) {
      const drift = ctx.createOscillator();
      drift.type = 'sine';
      drift.frequency.value = material.drift.rate;
      const driftAmt = ctx.createGain();
      driftAmt.gain.value = startF * material.drift.depth;
      drift.connect(driftAmt);
      driftAmt.connect(filter.frequency);
      drift.start(t0);
      this.sources.push(drift);
      this.nodes.push(driftAmt);
    }

    // --- oscillator stack ---
    const layers = [{ detuneOffset: 0, gain: 1, pan: 0, delay: 0 }];
    if (gesture.double) {
      layers[0].pan = -gesture.double.pan;
      layers.push({
        detuneOffset: gesture.double.detune,
        gain: gesture.double.gain,
        pan: gesture.double.pan,
        delay: gesture.double.delay,
      });
    }

    for (const layer of layers) {
      // A doubled gesture gets its own panner so the pair actually separates.
      let layerOut = oscMix;
      if (layer.pan !== 0) {
        const lp = ctx.createStereoPanner();
        lp.pan.value = Math.max(-1, Math.min(1, layer.pan * this.spec.width));
        const lg = ctx.createGain();
        lg.gain.value = layer.gain;
        lp.connect(lg);
        lg.connect(oscMix);
        layerOut = lp;
        this.nodes.push(lp, lg);
      }

      const start = t0 + layer.delay;

      for (const p of material.partials) {
        const osc = ctx.createOscillator();
        osc.type = p.type;
        osc.detune.value = p.detune + detune + layer.detuneOffset;
        if (gesture.glide > 0) {
          osc.frequency.setValueAtTime(freq * 0.79, start);
          osc.frequency.exponentialRampToValueAtTime(freq, start + gesture.glide);
        } else {
          osc.frequency.setValueAtTime(freq, start);
        }
        const g = ctx.createGain();
        g.gain.value = p.gain;
        osc.connect(g);
        g.connect(layerOut);
        if (vibratoGain) vibratoGain.connect(osc.detune);
        osc.start(start);
        this.sources.push(osc);
        this.nodes.push(g);
        if (!this.lifetimeSource) this.lifetimeSource = osc;

        // FM operator on the first partial only; more than that turns to mud.
        if (this.spec.fm && p === material.partials[0]) {
          const mod = ctx.createOscillator();
          mod.type = 'sine';
          mod.frequency.setValueAtTime(freq * this.spec.fm.ratio, start);
          const modGain = ctx.createGain();
          const peak = freq * this.spec.fm.index;
          modGain.gain.setValueAtTime(peak, start);
          modGain.gain.exponentialRampToValueAtTime(
            Math.max(0.001, peak * 0.02),
            start + this.spec.fm.decay
          );
          mod.connect(modGain);
          modGain.connect(osc.frequency);
          mod.start(start);
          this.sources.push(mod);
          this.nodes.push(modGain);
        }
      }

      // Sub-oscillator, an octave down.
      if (this.spec.sub > 0.01) {
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(freq / 2, start);
        const sg = ctx.createGain();
        sg.gain.value = this.spec.sub;
        sub.connect(sg);
        sg.connect(layerOut);
        sub.start(start);
        this.sources.push(sub);
        this.nodes.push(sg);
      }
    }

    // --- noise layer: attack transient, or sustained breath for Air ---
    const noise = this.spec.noise;
    if (noise && noise.gain > 0.01) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = noise.filter;
      nf.frequency.value = clampF(noise.tracks ? freq * noise.freq : noise.freq);
      nf.Q.value = noise.Q;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(noise.gain, t0 + 0.004);
      // A long decay keeps Air breathing; a short one is a strike.
      ng.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, noise.gain * (noise.tracks ? 0.35 : 0.001)),
        t0 + noise.decay
      );
      src.connect(nf);
      nf.connect(ng);
      ng.connect(oscMix);
      src.start(t0);
      this.sources.push(src);
      this.nodes.push(nf, ng);
      this.noiseGain = ng;
    }

    // --- amplitude envelope ---
    const peak = Math.max(0.0002, gain);
    const g = vca.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + amp.attack);
    g.exponentialRampToValueAtTime(
      Math.max(0.0002, peak * amp.sustain),
      t0 + amp.attack + amp.decay
    );

    // --- rhythmic gate ---
    if (gesture.gate) {
      const gateOsc = ctx.createOscillator();
      gateOsc.type = 'square';
      gateOsc.frequency.value = gesture.gate.rate;
      const gateAmt = ctx.createGain();
      gateAmt.gain.value = gesture.gate.depth * 0.5 * peak * amp.sustain;
      gateOsc.connect(gateAmt);
      gateAmt.connect(vca.gain);
      gateOsc.start(t0 + amp.attack);
      if (Number.isFinite(gesture.gate.cycles)) {
        const stop = t0 + amp.attack + gesture.gate.cycles / gesture.gate.rate;
        gateAmt.gain.setValueAtTime(gateAmt.gain.value, stop - 0.05);
        gateAmt.gain.linearRampToValueAtTime(0, stop);
        gateOsc.stop(stop + 0.02);
      }
      this.sources.push(gateOsc);
      this.nodes.push(gateAmt);
    }

    if (duration != null) this.release(t0 + duration);
    // Register after scheduling a finite duration so the engine sees the
    // voice's final lifetime before assigning its polyphony slot.
    this.engine.register(this);
  }

  /** Schedule the release. Idempotent — the earliest call wins. */
  release(at, overrideRelease = null) {
    const { ctx } = this.engine;
    const t = Math.max(at ?? ctx.currentTime, this.t0 + 0.01);
    if (this.released && this.releaseAt <= t) return;

    this.released = true;
    this.releaseAt = t;
    const rel = overrideRelease ?? this.spec.amp.release;
    const g = this.vca.gain;

    g.cancelScheduledValues(t);
    // Hold whatever the envelope had reached, then fall from there.
    g.setValueAtTime(Math.max(0.0002, g.value), t);
    g.exponentialRampToValueAtTime(0.0001, t + rel);
    g.linearRampToValueAtTime(0, t + rel + 0.03);

    if (this.noiseGain) {
      this.noiseGain.gain.cancelScheduledValues(t);
      this.noiseGain.gain.setValueAtTime(Math.max(0.0001, this.noiseGain.gain.value), t);
      this.noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + rel * 0.7);
    }

    const stopAt = t + rel + 0.08;
    for (const s of this.sources) {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    // Tear the graph down once the voice has actually finished sounding.
    const cleanup = () => this.dispose();
    if (this.lifetimeSource) this.lifetimeSource.onended = cleanup;
    // Belt and braces: if the ended event never arrives (a suspended context,
    // a tab in the background), reclaim the nodes on a timer anyway.
    if (this._cleanupTimer) clearTimeout(this._cleanupTimer);
    this._cleanupTimer = setTimeout(cleanup, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 250);
  }

  /** Release this voice early because another voice needs its polyphony slot. */
  steal(at, fade = 0.12) {
    if (this.stolen) return;
    this.stolen = true;
    this.release(at, fade);
  }

  dispose() {
    if (this._cleanupTimer) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    for (const s of this.sources) {
      try {
        s.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    this.engine.unregister(this);
  }
}
