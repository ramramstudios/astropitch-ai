/**
 * Three independent axes compose into one voice:
 *
 *   ELEMENT  sets timbre       — oscillator stack, harmonic content, noise,
 *                                resonant body, and drift.
 *   HOUSE    sets gesture      — how that timbre gets played: struck, bowed,
 *                                gated, doubled, blurred, sung.
 *   MODALITY sets articulation — how long the gesture lasts and how much it
 *                                moves while it lasts.
 *
 * So Fire always sounds like fire and the 2nd house always sounds struck, but
 * fire-struck (Aries in the 2nd) and water-struck (Cancer in the 2nd) are
 * different instruments. 12 x 12 x 3 combinations, none of them samples.
 *
 * The timbre and gesture tables themselves live in palettes.js. This file is
 * the renderer: it knows how to turn one of those specs into a graph, and it is
 * the same renderer whichever palette supplied the numbers.
 */

import { MODALITIES } from '../ontology.js';
import { getPalette } from './palettes.js';

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

/**
 * Wavetable cache.
 *
 * A partial may specify `harmonics` — an explicit list of overtone amplitudes —
 * instead of one of the four built-in oscillator types. PeriodicWave objects are
 * immutable and shareable, and building one per note would be wasteful, so they
 * are cached per context and per spectrum.
 */
const periodicWaves = new WeakMap();
function periodicWave(ctx, harmonics) {
  let byShape = periodicWaves.get(ctx);
  if (!byShape) {
    byShape = new Map();
    periodicWaves.set(ctx, byShape);
  }
  const key = harmonics.join(',');
  let wave = byShape.get(key);
  if (!wave) {
    // Index 0 is the DC term and must stay silent; harmonic k lives at index k.
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    for (let k = 0; k < harmonics.length; k++) imag[k + 1] = harmonics[k];
    // Normalisation keeps peak amplitude comparable to the built-in types, so a
    // partial's `gain` means the same thing whichever kind of source it is.
    wave = ctx.createPeriodicWave(real, imag);
    byShape.set(key, wave);
  }
  return wave;
}

export function buildVoiceSpec({ element, house, modality, palette }) {
  const { materials, gestures } = getPalette(palette);
  const material = materials[element] ?? materials.fire;
  const gesture = gestures[house] ?? gestures[1];
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

/**
 * Value of a piecewise exponential envelope at `time`.
 *
 * `points` is [[time, value], ...] ascending, mirroring the ramps actually
 * scheduled on the param — so this computes what the param *will* read at a
 * future time, which `AudioParam.value` cannot: that reports the envelope now.
 */
export function envelopeAt(points, time) {
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    if (time >= t1) continue;
    // The shape exponentialRampToValueAtTime interpolates.
    return v0 * (v1 / v0) ** ((time - t0) / (t1 - t0));
  }
  return points[points.length - 1][1];
}

let voiceSerial = 0;

export class Voice {
  /**
   * @param {AudioEngine} engine
   * @param {object} spec       from buildVoiceSpec
   * @param {object} opts       { freq, time, duration, gain, pan, detune, reverbMul, delayMul, panDrift }
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
    // What the engine's gain staging reads: the amplitude this voice asks for,
    // when it starts asking, and the window over which it stops. `peak` is set
    // once the envelope is known; the fade bounds are set by `release`.
    this.peak = 0;
    this.fadeFrom = null;
    this.fadeUntil = null;
    // The designer needs one voice that can follow a body around the wheel.
    // Keep the AudioParams that are defined by pitch together so retuning is a
    // small automation change, rather than repeatedly destroying and creating
    // a whole synthesis graph while the pointer is moving.
    this.pitchTargets = [];
    this.pitchControls = null;
    // The source whose ending defines the voice's lifetime. It must be one that
    // is never stopped early — the gate oscillator finishes mid-note, so hanging
    // teardown off "the last source in the array" would cut the note short.
    this.lifetimeSource = null;
    this._build(opts);
  }

  _build({
    freq, time, duration = null, gain = 1, pan = 0, detune = 0,
    reverbMul = 1, delayMul = 1, panDrift = null, unisonOctaves = null,
  }) {
    const { ctx } = this.engine;
    const t0 = Math.max(time ?? ctx.currentTime, ctx.currentTime);
    const { material, gesture, amp, vibrato } = this.spec;
    this.t0 = t0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * this.spec.width));
    this.panner = panner;

    // Most bodies stay fixed at their chart-derived position. A body may add a
    // very slow orbit here without changing the chart position itself.
    if (panDrift?.depth > 0 && panDrift?.rate > 0) {
      const drift = ctx.createOscillator();
      drift.type = 'sine';
      drift.frequency.value = panDrift.rate;
      const driftAmt = ctx.createGain();
      driftAmt.gain.value = Math.min(0.95, panDrift.depth);
      drift.connect(driftAmt);
      driftAmt.connect(panner.pan);
      drift.start(t0);
      this.sources.push(drift);
      this.nodes.push(driftAmt);
    }

    const vca = ctx.createGain();
    vca.gain.value = 0.0001;
    vca.connect(panner);
    this.vca = vca;

    const reverbSend = Math.min(1, this.spec.send.reverb * reverbMul);
    const delaySend = Math.min(1, this.spec.send.delay * delayMul);
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - 0.4 * reverbSend;
    panner.connect(dryGain);
    dryGain.connect(this.engine.dryBus);

    if (reverbSend > 0.001) {
      const rs = ctx.createGain();
      rs.gain.value = reverbSend * 0.55;
      panner.connect(rs);
      rs.connect(this.engine.reverbSend);
      this.nodes.push(rs);
    }
    if (delaySend > 0.001) {
      const ds = ctx.createGain();
      ds.gain.value = delaySend * 0.4;
      panner.connect(ds);
      ds.connect(this.engine.delaySend);
      this.nodes.push(ds);
    }
    this.nodes.push(panner, dryGain);

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

    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 2400;
    tilt.gain.value = material.tilt;
    tilt.connect(chainHead);
    this.nodes.push(tilt);

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

    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = clampF(freq * material.body.ratio);
    body.Q.value = material.body.Q;
    body.gain.value = material.body.gain;
    body.connect(filter);
    this.nodes.push(body);

    // Filters normally receive a one-shot envelope. During a live designer
    // audition their settled values track the note as well, so high and low
    // positions retain the intended spectral balance while the pitch glides.
    this.pitchControls = {
      clampF,
      body,
      filter,
      noiseFilter: null,
      material,
      gesture,
    };

    const oscMix = ctx.createGain();
    oscMix.gain.value = 0.28;
    oscMix.connect(body);
    this.nodes.push(oscMix);

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

    // A voice normally sounds at one octave (octMul 1). A body voiced in
    // unison across several octaves — the Sun — repeats the whole stack once
    // per offset, each at its own frequency multiple, so the same pitch class
    // sounds simultaneously several registers apart.
    const octaves = unisonOctaves ?? [0];

    for (const oct of octaves) {
      const octMul = 2 ** oct;
      const octFreq = freq * octMul;

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
          // A partial is either one of the four built-in spectra or an explicit
          // overtone series. `setPeriodicWave` supersedes `type`, so it is one or
          // the other, never both.
          if (p.harmonics) osc.setPeriodicWave(periodicWave(ctx, p.harmonics));
          else osc.type = p.type;
          osc.detune.value = p.detune + detune + layer.detuneOffset;
          if (gesture.glide > 0) {
            osc.frequency.setValueAtTime(octFreq * 0.79, start);
            osc.frequency.exponentialRampToValueAtTime(octFreq, start + gesture.glide);
          } else {
            osc.frequency.setValueAtTime(octFreq, start);
          }
          this.pitchTargets.push({ param: osc.frequency, ratio: octMul });
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
            mod.frequency.setValueAtTime(octFreq * this.spec.fm.ratio, start);
            const modGain = ctx.createGain();
            const peak = octFreq * this.spec.fm.index;
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
            this.pitchTargets.push({ param: mod.frequency, ratio: octMul * this.spec.fm.ratio });
          }
        }

        // Sub-oscillator, an octave down from this layer's register.
        if (this.spec.sub > 0.01) {
          const sub = ctx.createOscillator();
          sub.type = 'sine';
          sub.frequency.setValueAtTime(octFreq / 2, start);
          const sg = ctx.createGain();
          sg.gain.value = this.spec.sub;
          sub.connect(sg);
          sg.connect(layerOut);
          sub.start(start);
          this.sources.push(sub);
          this.nodes.push(sg);
          this.pitchTargets.push({ param: sub.frequency, ratio: octMul * 0.5 });
        }
      }
    }

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
      const noiseFloor = Math.max(0.0001, noise.gain * (noise.tracks ? 0.35 : 0.001));
      this.noiseEnvelope = [[t0, 0.0001], [t0 + 0.004, noise.gain], [t0 + noise.decay, noiseFloor]];
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(noise.gain, t0 + 0.004);
      // A long decay keeps Air breathing; a short one is a strike.
      ng.gain.exponentialRampToValueAtTime(noiseFloor, t0 + noise.decay);
      src.connect(nf);
      nf.connect(ng);
      ng.connect(oscMix);
      src.start(t0);
      this.sources.push(src);
      this.nodes.push(nf, ng);
      this.noiseGain = ng;
      if (noise.tracks) this.pitchControls.noiseFilter = nf;
    }

    const peak = Math.max(0.0002, gain);
    // A gated gesture adds its depth on top of the envelope rather than
    // carving into it, so the loudest this voice gets is more than `peak`.
    this.peak = peak * (1 + (gesture.gate ? gesture.gate.depth * 0.5 * amp.sustain : 0));
    const g = vca.gain;
    // Kept so a release scheduled ahead of the note can work out where the
    // envelope will be when it arrives. Mirrors the ramps written just below.
    this.ampEnvelope = [
      [t0, 0.0001],
      [t0 + amp.attack, peak],
      [t0 + amp.attack + amp.decay, Math.max(0.0002, peak * amp.sustain)],
    ];
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + amp.attack);
    g.exponentialRampToValueAtTime(
      Math.max(0.0002, peak * amp.sustain),
      t0 + amp.attack + amp.decay
    );

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

  /**
   * Glide an already-sounding voice to a new fundamental. This is intentionally
   * used only by the Designer's held audition: a normal placement still gets
   * its complete one-shot gesture and envelope.
   */
  retune({ freq, pan = null, time = null } = {}) {
    if (this.released || !Number.isFinite(freq) || freq <= 0) return;
    const { ctx } = this.engine;
    const t = Math.max(time ?? ctx.currentTime, ctx.currentTime);

    for (const { param, ratio } of this.pitchTargets) {
      this._smooth(param, freq * ratio, t);
    }

    const controls = this.pitchControls;
    if (controls) {
      const { clampF, material, gesture, body, filter, noiseFilter } = controls;
      const settled = clampF(
        freq * material.cutoffMul * gesture.filter.start * (1 + gesture.filter.env * 0.6)
      );
      this._smooth(filter.frequency, settled, t);
      this._smooth(body.frequency, clampF(freq * material.body.ratio), t);
      if (noiseFilter) this._smooth(noiseFilter.frequency, clampF(freq * material.noise.freq), t);
    }

    if (pan != null && this.panner) {
      this._smooth(this.panner.pan, Math.max(-1, Math.min(1, pan * this.spec.width)), t);
    }
  }

  /** Avoid audible zippering while keeping a drag responsive at pointer rate. */
  _smooth(param, value, time) {
    if (!param || !Number.isFinite(value)) return;
    // `cancelAndHoldAtTime` preserves the exact in-flight value. Older Safari
    // lacks it, but cancelling then setting a short target is still click-free
    // enough for a gesture-rate control.
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
    else param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, 0.018);
  }

  /** Schedule the release. Idempotent — the earliest call wins. */
  release(at, overrideRelease = null) {
    const { ctx } = this.engine;
    const t = Math.max(at ?? ctx.currentTime, this.t0 + 0.01);
    if (this.released && this.releaseAt <= t) return;

    this.released = true;
    this.releaseAt = t;
    const rel = overrideRelease ?? this.spec.amp.release;
    this.fadeFrom = t;
    this.fadeUntil = t + rel;
    const g = this.vca.gain;

    // Hold whatever the envelope will have reached *at t*, then fall from
    // there. Reading `g.value` instead would sample the envelope now, and a
    // release is very often scheduled before the note has even started — a
    // fixed duration schedules one at construction — which put a step down to
    // near-silence at the release instead of a ramp down from the sustain.
    this._holdAt(g, t, Math.max(0.0002, envelopeAt(this.ampEnvelope, t)));
    g.exponentialRampToValueAtTime(0.0001, t + rel);
    g.linearRampToValueAtTime(0, t + rel + 0.03);

    if (this.noiseGain) {
      this._holdAt(this.noiseGain.gain, t, Math.max(0.0001, envelopeAt(this.noiseEnvelope, t)));
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
    const cleanup = () => this.dispose();
    if (this.lifetimeSource) this.lifetimeSource.onended = cleanup;
    // Belt and braces: if the ended event never arrives (a suspended context,
    // a tab in the background), reclaim the nodes on a timer anyway.
    if (this._cleanupTimer) clearTimeout(this._cleanupTimer);
    this._cleanupTimer = setTimeout(cleanup, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 250);

    // The engine budgets headroom from when voices fade, so it has to be told
    // that this one now does. A release scheduled after registration — a bloom
    // holds its whole chord, then releases it — is the common case.
    this.engine.refreshGainStaging?.(this);
  }

  /**
   * Pin an AudioParam to the value its automation reaches at `time`, so a ramp
   * scheduled from there continues the envelope rather than stepping off it.
   *
   * `value` is that point on the envelope, worked out from the ramps that were
   * scheduled. Safari before 14.1 has no cancelAndHoldAtTime, and there it is
   * the only correct answer — sampling `param.value` there would reintroduce
   * exactly the step this method exists to avoid.
   */
  _holdAt(param, time, value) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(time);
      // An exponential ramp cannot start from zero, and a finished envelope
      // ends there. The computed value keeps the ramp legal and inaudible.
      if (param.value <= 0) param.setValueAtTime(value, time);
    } else {
      param.cancelScheduledValues(time);
      param.setValueAtTime(value, time);
    }
  }

  steal(at, fade = 0.12) {
    if (this.stolen) return;
    this.stolen = true;
    // A voice that has not started costs nothing to drop — but only if it is
    // really dropped. `release` cannot put its ramp before t0 + 0.01, so going
    // through it lets the note start, reach full level (an attack can be 2 ms)
    // and then fade: a ~100 ms blip in place of a note nobody would have
    // missed. Stopping the sources before they run is the actual free option.
    if (at < this.t0) this._drop();
    else this.release(at, fade);
  }

  _drop() {
    const { ctx } = this.engine;
    this.released = true;
    this.releaseAt = this.t0;
    // Nothing of it will sound, so it asks the gain staging for nothing.
    this.peak = 0;
    this.vca.gain.cancelScheduledValues(this.t0);
    this.vca.gain.setValueAtTime(0, this.t0);
    // Every source starts at or after t0, and a source told to stop before it
    // starts never produces output.
    for (const s of this.sources) {
      try {
        s.stop(this.t0);
      } catch {
        /* already stopped */
      }
    }
    const cleanup = () => this.dispose();
    if (this.lifetimeSource) this.lifetimeSource.onended = cleanup;
    if (this._cleanupTimer) clearTimeout(this._cleanupTimer);
    this._cleanupTimer = setTimeout(cleanup, Math.max(0, (this.t0 - ctx.currentTime) * 1000) + 250);
    this.engine.refreshGainStaging?.(this);
  }

  /**
   * What this voice contributes to the engine's load at a given time.
   *
   * Amplitude, not presence: a voice still waiting for its start time is not
   * competing for headroom yet, and one most of the way through its release is
   * no longer asking for what it held at full sustain.
   */
  amplitudeAt(t) {
    if (t < this.t0) return 0;
    if (this.fadeFrom == null || t <= this.fadeFrom) return this.peak;
    if (t >= this.fadeUntil) return 0;
    return this.peak * (1 - (t - this.fadeFrom) / (this.fadeUntil - this.fadeFrom));
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
