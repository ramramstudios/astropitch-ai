/**
 * Arrangement.
 *
 * A natal chart is up to eleven bodies scattered across a chromatic octave. Play
 * them all at one pitch level and you get a tone cluster, which is honest but
 * unlistenable. Four things keep it musical:
 *
 *   1. Register. Each body has a fixed octave (Pluto two down, Mercury one up),
 *      so a chromatic cluster in longitude is spread over five octaves in pitch.
 *   2. Entry. Voices arrive in an order that means something, not all at once.
 *   3. Balance. The Sun, Moon and Ascendant are loud; the outer planets are
 *      atmosphere. Low voices get trimmed because bass carries more energy.
 *   4. Space. Pan follows position on the wheel, so the chart's geometry is
 *      audible as a stereo image.
 */

import { buildVoiceSpec, Voice } from './voices.js';
import { frequencyFor } from './tuning.js';
import { SIGNS } from '../ontology.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Bass costs more headroom than treble; trim it back toward parity. */
function loudnessTrim(freq) {
  if (freq >= 220) return 1;
  return clamp(0.45 + (freq / 220) * 0.55, 0.4, 1);
}

export class Performer {
  constructor(engine) {
    this.engine = engine;
    this.chart = null;
    this.tuning = { refA: 440, temperament: 'equal' };
    this.tempo = 0.5; // seconds per step
    this.mode = null;
    this.active = [];
    this.timers = [];
    this.loopHandle = null;
    this.listeners = new Set();
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this.listeners) fn(event);
  }

  /** Fire a UI event at an audio-clock time. */
  _emitAt(event, time) {
    const delay = Math.max(0, (time - this.engine.now) * 1000);
    this.timers.push(setTimeout(() => this._emit(event), delay));
  }

  setChart(chart) {
    this.chart = chart;
  }

  setTuning(tuning) {
    Object.assign(this.tuning, tuning);
  }

  setTempo(seconds) {
    this.tempo = seconds;
    this.engine.setDelayTime(seconds);
  }

  // -------------------------------------------------------------------------
  // Voice construction
  // -------------------------------------------------------------------------

  /**
   * @param {object} p       placement from the chart
   * @param {object} o       { time, duration, gainMul, detune, octaveShift }
   */
  _voiceFor(p, { time, duration = null, gainMul = 1, detune = 0, octaveShift = 0 } = {}) {
    const spec = buildVoiceSpec({
      element: p.element,
      house: p.house,
      modality: p.modality,
    });
    const freq = frequencyFor(p.longitude, {
      octave: p.octave + octaveShift,
      refA: this.tuning.refA,
      temperament: this.tuning.temperament,
    });
    // Position on the wheel becomes position in the stereo field.
    const pan = Math.sin((p.longitude * Math.PI) / 180) * 0.8;
    const gain = 0.22 * p.gain * gainMul * loudnessTrim(freq);

    const voice = new Voice(this.engine, spec, { freq, time, duration, gain, pan, detune });
    this.active.push(voice);
    return voice;
  }

  /** Nudge bodies that land on nearly the same pitch so they beat instead of cancel. */
  _detuneMap(placements) {
    const map = {};
    const seen = [];
    for (const p of placements) {
      const semis = p.longitude / 30 + p.octave * 12;
      const collision = seen.find((s) => Math.abs(s - semis) < 1.2);
      map[p.key] = collision == null ? 0 : (seen.length % 2 ? 7 : -7);
      seen.push(semis);
    }
    return map;
  }

  _sounding() {
    if (!this.chart) return [];
    return this.chart.placements.filter((p) => p.key !== 'mc');
  }

  // -------------------------------------------------------------------------
  // Public playback
  // -------------------------------------------------------------------------

  /** One placement, on its own. */
  async playPlacement(key, { duration = 2.4 } = {}) {
    await this.engine.start();
    const p = this.chart?.byKey?.[key];
    if (!p) return;
    const t = this.engine.now + 0.02;
    this._voiceFor(p, { time: t, duration, gainMul: 1.5 });
    this._emit({ type: 'note', key, time: t });
  }

  /** A bare sign, for exploring the wheel without a chart loaded. */
  async playSign(signIndex, { house = 1, octave = 0, duration = 2.2 } = {}) {
    await this.engine.start();
    const sign = SIGNS[signIndex];
    const longitude = signIndex * 30 + 15;
    const p = {
      key: `sign-${signIndex}`,
      element: sign.element,
      modality: sign.modality,
      house,
      longitude,
      octave,
      gain: 1,
    };
    const t = this.engine.now + 0.02;
    this._voiceFor(p, { time: t, duration, gainMul: 1.6 });
    this._emit({ type: 'sign', signIndex, time: t });
  }

  /** Two bodies together, so you can hear an aspect as the interval it is. */
  async playAspect(aspect, { duration = 3.2 } = {}) {
    await this.engine.start();
    const a = this.chart?.byKey?.[aspect.a];
    const b = this.chart?.byKey?.[aspect.b];
    if (!a || !b) return;
    const t = this.engine.now + 0.02;
    // Same octave for both, otherwise the interval is not what you hear.
    this._voiceFor(a, { time: t, duration, gainMul: 1.3, octaveShift: -a.octave });
    this._voiceFor(b, { time: t + 0.06, duration, gainMul: 1.3, octaveShift: -b.octave });
    this._emit({ type: 'aspect', aspect, time: t });
  }

  /**
   * The chart as a chord that assembles itself: rising sign first, because it
   * is the voice you are heard in, then the lights, then the planets in order
   * of speed. Everything holds, then releases together.
   */
  async bloom() {
    await this._begin('bloom');
    const order = ['asc', 'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const placements = this._sounding();
    const detunes = this._detuneMap(placements);
    const byKey = Object.fromEntries(placements.map((p) => [p.key, p]));

    // Slower for the anchors, quicker through the inner planets, slowing again
    // for the outers as they settle underneath.
    const gaps = { asc: 0, sun: 1.15, moon: 0.95, mercury: 0.75, venus: 0.55, mars: 0.55, jupiter: 0.6, saturn: 0.7, uranus: 0.55, neptune: 0.7, pluto: 0.8 };

    const start = this.engine.now + 0.08;
    let t = start;
    let count = 0;
    const voices = [];

    for (const key of order) {
      const p = byKey[key];
      if (!p) continue;
      t += gaps[key] ?? 0.6;
      count++;
      // Keep the sum under control as the chord thickens.
      const headroom = 1 / Math.sqrt(Math.max(1, count * 0.55));
      voices.push(this._voiceFor(p, { time: t, gainMul: headroom * 1.35, detune: detunes[key] }));
      this._emitAt({ type: 'note', key }, t);
    }

    const hold = t + 3.4;
    for (const v of voices) v.release(hold);
    this._emitAt({ type: 'end' }, hold + 2.4);
    this.timers.push(setTimeout(() => { if (this.mode === 'bloom') this.mode = null; }, (hold + 2.4 - this.engine.now) * 1000));
  }

  /**
   * Walk the zodiac from the Ascendant and sound each body as you pass it.
   * Note length comes from modality: cardinal strikes, fixed holds, mutable
   * sits in between and wavers.
   */
  async sequence() {
    await this._begin('sequence');
    const placements = this._sounding().slice().sort((a, b) => {
      const asc = this.chart.ascSignIndex * 30;
      return ((a.longitude - asc + 360) % 360) - ((b.longitude - asc + 360) % 360);
    });

    const lengths = { cardinal: 0.55, fixed: 1.35, mutable: 0.9 };
    const start = this.engine.now + 0.08;
    let t = start;

    for (const p of placements) {
      const dur = lengths[p.modality] * (this.tempo / 0.5);
      this._voiceFor(p, { time: t, duration: dur * 0.92, gainMul: 1.5 });
      this._emitAt({ type: 'note', key: p.key }, t);
      t += dur;
    }

    // Land on the Ascendant an octave up, to close the circle.
    const asc = this.chart.byKey.asc;
    if (asc) {
      this._voiceFor(asc, { time: t + 0.2, duration: 3.0, gainMul: 1.5, octaveShift: 1 });
      this._emitAt({ type: 'note', key: 'asc' }, t + 0.2);
    }
    this._emitAt({ type: 'end' }, t + 4.0);
    this.timers.push(setTimeout(() => { if (this.mode === 'sequence') this.mode = null; }, (t + 4.0 - this.engine.now) * 1000));
  }

  /**
   * Generative sustain. The anchors hold indefinitely while the remaining
   * bodies surface and sink, chosen by how tightly they aspect something else —
   * so a chart with exact aspects is a busy drone and a chart without them is
   * a still one.
   */
  async drone() {
    await this._begin('drone');
    const placements = this._sounding();
    const detunes = this._detuneMap(placements);
    const byKey = Object.fromEntries(placements.map((p) => [p.key, p]));

    const anchorKeys = ['asc', 'sun', 'moon', 'saturn', 'pluto'].filter((k) => byKey[k]);
    const floating = placements.filter((p) => !anchorKeys.includes(p.key));

    // How active each body is, from the aspects it makes.
    const activity = {};
    for (const p of placements) activity[p.key] = 0.25;
    for (const asp of this.chart.aspects) {
      activity[asp.a] = (activity[asp.a] ?? 0) + asp.exactness;
      activity[asp.b] = (activity[asp.b] ?? 0) + asp.exactness;
    }

    const startAnchors = (at) => {
      const voices = [];
      anchorKeys.forEach((key, i) => {
        const v = this._voiceFor(byKey[key], {
          time: at + i * 0.9,
          gainMul: 0.85 / Math.sqrt(anchorKeys.length * 0.5),
          detune: detunes[key],
        });
        voices.push(v);
        this._emitAt({ type: 'note', key }, at + i * 0.9);
      });
      return voices;
    };

    let anchors = startAnchors(this.engine.now + 0.08);
    // Refresh the bed periodically: envelopes are finite and drift accumulates.
    const CYCLE = 24;

    const tick = () => {
      if (this.mode !== 'drone') return;
      const now = this.engine.now;
      const next = startAnchors(now + 0.5);
      for (const v of anchors) v.release(now + 2.2);
      anchors = next;
    };

    const shimmer = () => {
      if (this.mode !== 'drone' || floating.length === 0) return;
      const weights = floating.map((p) => activity[p.key] ?? 0.25);
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let pick = floating[0];
      for (let i = 0; i < floating.length; i++) {
        r -= weights[i];
        if (r <= 0) { pick = floating[i]; break; }
      }
      const t = this.engine.now + 0.05;
      const octaveShift = Math.random() < 0.25 ? 1 : 0;
      this._voiceFor(pick, { time: t, duration: 2 + Math.random() * 4, gainMul: 0.75, detune: detunes[pick.key], octaveShift });
      this._emitAt({ type: 'note', key: pick.key }, t);
    };

    this.loopHandle = setInterval(tick, CYCLE * 1000);
    this.shimmerHandle = setInterval(shimmer, 2600);
    setTimeout(shimmer, 3000);
  }

  async _begin(mode) {
    await this.engine.start();
    this.stop({ fade: 0.4 });
    this.mode = mode;
    this._emit({ type: 'start', mode });
  }

  stop({ fade = 0.35 } = {}) {
    this.mode = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    if (this.loopHandle) clearInterval(this.loopHandle);
    if (this.shimmerHandle) clearInterval(this.shimmerHandle);
    this.loopHandle = null;
    this.shimmerHandle = null;

    const now = this.engine.now;
    for (const v of this.active) {
      if (!v.released) v.release(now, fade);
    }
    this.active.length = 0;
    this._emit({ type: 'stop' });
  }
}
