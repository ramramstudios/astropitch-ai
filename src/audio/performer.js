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

  /**
   * Nudge bodies that land on nearly the same pitch so they beat instead of
   * cancel.
   *
   * Only ever within one chart. Across two charts the beating *is* the
   * information — the orb of a cross-chart conjunction is what you hear as the
   * beat rate — and 7 cents of arbitrary detune is worth about 2° of orb, so
   * applying this across sides would drown the signal in noise that means
   * nothing.
   */
  _detuneMap(placements) {
    const map = {};
    const seen = [];
    for (const p of placements) {
      const semis = p.longitude / 30 + p.octave * 12;
      const collision = seen.find((s) => s.side === p.side && Math.abs(s.semis - semis) < 1.2);
      map[p.key] = collision == null ? 0 : (seen.length % 2 ? 7 : -7);
      seen.push({ semis, side: p.side });
    }
    return map;
  }

  /** Bodies that actually sound: not the Midheaven, and not the untouched. */
  _sounding() {
    if (!this.chart) return [];
    return this.chart.placements.filter((p) => p.key !== 'mc' && !p.silent);
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
   * The chart as a chord that assembles from its solar centre: the Sun, then
   * the inner planets, then the Moon and Ascendant as the personal threshold,
   * and finally the outer bodies. Everything holds, then releases together.
   *
   * With two charts overlaid the same order runs, but each body is immediately
   * followed by its opposite number — so Sun lands against Sun, and you hear
   * the contact as an interval rather than as two unrelated events.
   */
  async bloom() {
    await this._begin('bloom');
    const ORDER = ['sun', 'mercury', 'venus', 'moon', 'asc', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const placements = this._sounding();
    const detunes = this._detuneMap(placements);

    // The Sun arrives at once; the inner planets move quickly, then the
    // personal threshold and slower bodies have room to settle underneath.
    const gaps = { sun: 0, mercury: 0.75, venus: 0.55, moon: 0.95, asc: 0.7, mars: 0.55, jupiter: 0.6, saturn: 0.7, uranus: 0.55, neptune: 0.7, pluto: 0.8 };

    const baseOf = (p) => p.baseKey ?? p.key;
    const ordered = placements
      .slice()
      .sort((x, y) => ORDER.indexOf(baseOf(x)) - ORDER.indexOf(baseOf(y))
        || String(x.side ?? '').localeCompare(String(y.side ?? '')));

    const start = this.engine.now + 0.08;
    let t = start;
    let count = 0;
    let prevBase = null;
    const voices = [];

    for (const p of ordered) {
      const base = baseOf(p);
      // A body's counterpart arrives almost on top of it; a new body waits.
      t += base === prevBase ? 0.2 : (gaps[base] ?? 0.6);
      prevBase = base;
      count++;
      // Keep the sum under control as the chord thickens.
      const headroom = 1 / Math.sqrt(Math.max(1, count * 0.55));
      voices.push(this._voiceFor(p, { time: t, gainMul: headroom * 1.35, detune: detunes[p.key] }));
      this._emitAt({ type: 'note', key: p.key }, t);
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
    const asc = this.chart.byKey.asc ?? this.chart.byKey['a:asc'];
    if (asc) {
      this._voiceFor(asc, { time: t + 0.2, duration: 3.0, gainMul: 1.5, octaveShift: 1 });
      this._emitAt({ type: 'note', key: asc.key }, t + 0.2);
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
    const baseOf = (p) => p.baseKey ?? p.key;

    // Two charts overlaid already put two of everything in the bed, so the
    // anchors drop to the lights and the angle to leave the same room.
    const anchorBases = this.chart.meta?.synastry
      ? ['asc', 'sun', 'moon']
      : ['asc', 'sun', 'moon', 'saturn', 'pluto'];
    const anchorSet = new Set(anchorBases);
    const anchorPlacements = placements.filter((p) => anchorSet.has(baseOf(p)));
    const anchorKeys = new Set(anchorPlacements.map((p) => p.key));
    const floating = placements.filter((p) => !anchorKeys.has(p.key));

    // How active each body is, from the aspects it makes.
    const activity = {};
    for (const p of placements) activity[p.key] = 0.25;
    for (const asp of this.chart.aspects) {
      activity[asp.a] = (activity[asp.a] ?? 0) + asp.exactness;
      activity[asp.b] = (activity[asp.b] ?? 0) + asp.exactness;
    }

    const startAnchors = (at) => {
      const voices = [];
      anchorPlacements.forEach((p, i) => {
        const v = this._voiceFor(p, {
          time: at + i * 0.9,
          gainMul: 0.85 / Math.sqrt(anchorPlacements.length * 0.5),
          detune: detunes[p.key],
        });
        voices.push(v);
        this._emitAt({ type: 'note', key: p.key }, at + i * 0.9);
      });
      return voices;
    };

    let bed = startAnchors(this.engine.now + 0.08);
    // Refresh the bed periodically: envelopes are finite and drift accumulates.
    const CYCLE = 24;

    const tick = () => {
      if (this.mode !== 'drone') return;
      const now = this.engine.now;
      const next = startAnchors(now + 0.5);
      for (const v of bed) v.release(now + 2.2);
      bed = next;
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
