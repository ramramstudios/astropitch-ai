/**
 * Arrangement.
 *
 * A natal chart has ten planetary bodies scattered across a chromatic octave.
 * ASC and MC can be added as optional voices. Play
 * them all at one pitch level and you get a tone cluster, which is honest but
 * unlistenable. Four things keep it musical:
 *
 *   1. Register. Each body has a fixed octave (Saturn two down, Pluto and
 *      Mercury one up),
 *      so a chromatic cluster in longitude is spread across four octave registers.
 *   2. Entry. Voices arrive in an order that means something, not all at once.
 *   3. Balance. The Sun and Moon are loud; the outer planets are
 *      atmosphere. Low voices get trimmed because bass carries more energy.
 *   4. Space. Pan follows position on the wheel, so the chart's geometry is
 *      audible as a stereo image.
 *
 * TODO: Turn ASC/MC into an optional non-pitch effect (for example, a wah-like
 *       filter or phase motion) instead of direct tonal voices.
 */

import { buildVoiceSpec, Voice } from './voices.js';
import { DEFAULT_PALETTE } from './palettes.js';
import { frequencyFor } from './tuning.js';
import { SIGNS } from '../ontology.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const CHOKE_FADE = 0.05;

/** Bass costs more headroom than treble; trim it back toward parity. */
function loudnessTrim(freq) {
  if (freq >= 220) return 1;
  return clamp(0.45 + (freq / 220) * 0.55, 0.4, 1);
}

export class Performer {
  constructor(engine) {
    this.engine = engine;
    this.chart = null;
    this.tuning = { refA: 432, temperament: 'equal', microtones: false };
    this.palette = DEFAULT_PALETTE;
    this.tempo = 120;
    this.mode = null;
    this.active = [];
    this.timers = [];
    this.loopHandle = null;
    this.listeners = new Set();
    this.designerPreview = null;
    this._choked = new Map();
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this.listeners) fn(event);
  }

  _emitAt(event, time) {
    const delay = Math.max(0, (time - this.engine.now) * 1000);
    this.timers.push(setTimeout(() => this._emit(event), delay));
  }

  /** End a finite transport pass before telling the UI that it has ended. */
  _endAt(mode, time) {
    const delay = Math.max(0, (time - this.engine.now) * 1000);
    this.timers.push(setTimeout(() => {
      if (this.mode !== mode) return;
      this.mode = null;
      this._emit({ type: 'end' });
    }, delay));
  }

  setChart(chart) {
    this.chart = chart;
    this._choked.clear();
  }

  setTuning(tuning) {
    Object.assign(this.tuning, tuning);
  }

  /**
   * Swap the synthesis palette.
   *
   * A palette only decides how the next voice gets built, so anything already
   * sounding keeps its old timbre until it ends. Releasing the live voices makes
   * the change audible immediately rather than at the next transport event.
   */
  setPalette(id) {
    if (id === this.palette) return;
    this.palette = id;
    this.endDesignerPreview();
    this.engine.releaseAll(0.18);
  }

  setTempo(bpm) {
    this.tempo = bpm;
    this.engine.setDelayTime(60 / bpm);
  }

  /**
   * @param {object} p       placement from the chart
   * @param {object} o       { time, duration, gainMul, detune, octaveShift }
   */
  _voiceFor(p, { time, duration = null, gainMul = 1, detune = 0, octaveShift = 0, solo = false } = {}) {
    const spec = buildVoiceSpec({
      element: p.element,
      house: p.house,
      modality: p.modality,
      palette: this.palette,
    });
    const freq = frequencyFor(p.longitude, {
      octave: p.octave + octaveShift,
      refA: this.tuning.refA,
      temperament: this.tuning.temperament,
      microtones: this.tuning.microtones,
    });
    const bodyVoice = p.voice ?? {};
    const pan = this._panFor(p);
    // Equal-power headroom: however many voices are already sounding, from
    // whichever playback path put them there, each new one yields enough gain
    // to keep the sum in check. A lone voice is unaffected (n=1); ten together
    // each give up about two thirds.
    const headroom = solo ? 1 : 1 / Math.sqrt(this.engine.activeVoiceCount() + 1);
    const gain = 0.22 * p.gain * gainMul * headroom * loudnessTrim(freq);

    const voice = new Voice(this.engine, spec, {
      freq, time, duration, gain, pan, detune,
      reverbMul: bodyVoice.reverbMul,
      delayMul: bodyVoice.delayMul,
      panDrift: bodyVoice.panDrift,
    });
    this.active.push(voice);
    return voice;
  }

  _retrigger(groupKey, voiceOrVoices) {
    const prev = this._choked.get(groupKey);
    if (prev) {
      const now = this.engine.now;
      for (const v of Array.isArray(prev) ? prev : [prev]) {
        if (v) v.release(now, CHOKE_FADE);
      }
    }
    this._choked.set(groupKey, voiceOrVoices);
  }

  _panFor(placement, longitude = placement.longitude) {
    const bodyVoice = placement.voice ?? {};
    const driftDepth = Math.min(0.95, bodyVoice.panDrift?.depth ?? 0);
    // Leave room at the edge of the stereo field for a body's optional pan
    // orbit, rather than allowing an AudioParam sum beyond its legal range.
    return Math.sin((longitude * Math.PI) / 180)
      * 0.8 * (bodyVoice.panWidth ?? 1) * (1 - driftDepth);
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

  _sounding() {
    if (!this.chart) return [];
    return this.chart.placements.filter((p) => !p.silent);
  }

  _placement(key) {
    return this.chart?.byKey?.[key] ?? this.chart?.anglePoints?.[key] ?? null;
  }

  _direction(key) {
    return this.chart?.anglePoints?.[key] ?? this._placement(key);
  }

  async playPlacement(key, { duration = 2.4 } = {}) {
    await this.engine.start();
    const p = this._placement(key);
    if (!p || p.silent) return;
    const t = this.engine.now + 0.02;
    const voice = this._voiceFor(p, { time: t, duration, gainMul: 1.5 });
    this._retrigger(`p:${key}`, voice);
    this._emit({ type: 'note', key, time: t });
  }

  /**
   * Wake Web Audio during the pointer-down gesture. Browsers are stricter
   * about starting audio from a move event than from a press, even though the
   * sound itself does not begin until the drag threshold is crossed.
   */
  prepareDesignerPreview() {
    return this.engine.start();
  }

  /** Start a held, single-body audition for Designer dragging. */
  async beginDesignerPreview(key, longitude = null) {
    const placement = this._direction(key);
    if (!placement || placement.silent) return;

    // A moving body is its own audition. Stop an existing transport pass so
    // it does not mask the pitch being explored.
    this.stop({ fade: 0.08 });
    const preview = {
      key,
      longitude: Number.isFinite(longitude) ? longitude : placement.longitude,
      voice: null,
      timbre: null,
    };
    this.designerPreview = preview;

    await this.engine.start();
    // The user may have released or switched modes while AudioContext resumed.
    if (this.designerPreview !== preview) return;

    const current = this._direction(key);
    if (!current || current.silent) {
      this.designerPreview = null;
      return;
    }
    const t = this.engine.now + 0.01;
    preview.timbre = this._designerTimbre(current);
    preview.voice = this._voiceFor(
      { ...current, longitude: preview.longitude },
      { time: t, gainMul: 1.2, solo: true }
    );
    this._emit({ type: 'note', key, time: t });
  }

  /** Sign supplies timbre and articulation; the current house supplies gesture. */
  _designerTimbre(placement) {
    // The index deliberately participates too: each sign crossing gets a
    // fresh articulation, even when two neighbouring signs share an element
    // or modality.
    return [placement.signIndex, placement.element, placement.modality, placement.house].join(':');
  }

  /** Retune the held Designer audition, changing its voice at a sign boundary. */
  updateDesignerPreview(key, next) {
    const preview = this.designerPreview;
    const placement = typeof next === 'object' ? next : this._placement(key);
    const longitude = typeof next === 'object' ? next.longitude : next;
    if (!preview || preview.key !== key || !Number.isFinite(longitude)) return;
    preview.longitude = longitude;
    if (!placement || !preview.voice?.retune) return;

    const time = this.engine.now + 0.004;
    const timbre = this._designerTimbre(placement);
    if (timbre !== preview.timbre) {
      // An element/modality change means a different oscillator and envelope
      // recipe, which cannot be retuned in-place. Crossfade into a fresh held
      // voice so the drag remains continuous while the sign changes character.
      preview.voice.release(time, 0.08);
      preview.voice = this._voiceFor(
        { ...placement, longitude },
        { time, gainMul: 1.2, solo: true }
      );
      preview.timbre = timbre;
      return;
    }

    const freq = frequencyFor(longitude, {
      octave: placement.octave,
      refA: this.tuning.refA,
      temperament: this.tuning.temperament,
      microtones: this.tuning.microtones,
    });
    const pan = this._panFor(placement, longitude);
    preview.voice.retune({ freq, pan, time });
  }

  /** Release the held Designer audition when the pointer ends or is cancelled. */
  endDesignerPreview(key = null, { fade = 0.16 } = {}) {
    const preview = this.designerPreview;
    if (!preview || (key != null && preview.key !== key)) return;
    this.designerPreview = null;
    if (preview.voice && !preview.voice.released) {
      preview.voice.release(this.engine.now + 0.01, fade);
    }
  }

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
    const voice = this._voiceFor(p, { time: t, duration, gainMul: 1.6 });
    this._retrigger(`s:${signIndex}`, voice);
    this._emit({ type: 'sign', signIndex, time: t });
  }

  async playAspect(aspect, { duration = 3.2 } = {}) {
    await this.engine.start();
    const a = this._direction(aspect.a);
    const b = this._direction(aspect.b);
    if (!a || !b) return;
    const t = this.engine.now + 0.02;
    // Same octave for both, otherwise the interval is not what you hear.
    const voiceA = this._voiceFor(a, { time: t, duration, gainMul: 1.3, octaveShift: -a.octave });
    const voiceB = this._voiceFor(b, { time: t + 0.06, duration, gainMul: 1.3, octaveShift: -b.octave });
    this._retrigger(`a:${aspect.a}:${aspect.b}`, [voiceA, voiceB]);
    this._emit({ type: 'aspect', aspect, time: t });
  }

  /**
   * Audition every contact attached to one directional handle. The selected
   * transport shapes their arrival, while each contact still keeps its own
   * interval rather than becoming a generic chord.
   */
  async playDirectionalAspects(aspects, { mode = 'bloom' } = {}) {
    if (!aspects.length) return;
    await this._begin(mode);
    const ordered = aspects.slice().sort(mode === 'sequence'
      ? (a, b) => this._direction(a.b).longitude - this._direction(b.b).longitude
      : (a, b) => b.exactness - a.exactness);
    const start = this.engine.now + 0.08;
    const step = mode === 'sequence' ? 1.05 : mode === 'drone' ? 0.18 : 0.58;
    const duration = mode === 'drone' ? 7.5 : mode === 'sequence' ? 1.25 : 3.4;
    let t = start;
    const voices = [];
    for (const aspect of ordered) {
      const a = this._direction(aspect.a);
      const b = this._direction(aspect.b);
      if (!a || !b) continue;
      voices.push(
        this._voiceFor(a, { time: t, duration, gainMul: 0.72, octaveShift: -a.octave }),
        this._voiceFor(b, { time: t + 0.06, duration, gainMul: 0.72, octaveShift: -b.octave })
      );
      this._emitAt({ type: 'aspect', aspect }, t);
      t += step;
    }
    const release = t + duration;
    for (const voice of voices) voice.release(release);
    this._endAt(mode, release + 0.4);
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
    const ORDER = ['sun', 'mercury', 'venus', 'moon', 'asc', 'mc', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const placements = this._sounding();
    const detunes = this._detuneMap(placements);

    // The Sun arrives at once; the inner planets move quickly, then the
    // personal threshold and slower bodies have room to settle underneath.
    const gaps = { sun: 0, mercury: 0.75, venus: 0.55, moon: 0.95, asc: 0.7, mc: 0.35, mars: 0.55, jupiter: 0.6, saturn: 0.7, uranus: 0.55, neptune: 0.7, pluto: 0.8 };

    const baseOf = (p) => p.baseKey ?? p.key;
    const ordered = placements
      .slice()
      .sort((x, y) => ORDER.indexOf(baseOf(x)) - ORDER.indexOf(baseOf(y))
        || String(x.side ?? '').localeCompare(String(y.side ?? '')));

    const start = this.engine.now + 0.08;
    let t = start;
    let prevBase = null;
    const voices = [];

    for (const p of ordered) {
      const base = baseOf(p);
      // A body's counterpart arrives almost on top of it; a new body waits.
      t += base === prevBase ? 0.2 : (gaps[base] ?? 0.6);
      prevBase = base;
      // _voiceFor applies its own headroom as the chord thickens.
      voices.push(this._voiceFor(p, { time: t, detune: detunes[p.key] }));
      this._emitAt({ type: 'note', key: p.key }, t);
    }

    const hold = t + 3.4;
    for (const v of voices) v.release(hold);
    this._endAt('bloom', hold + 2.4);
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
      const dur = lengths[p.modality] * (120 / this.tempo);
      this._voiceFor(p, { time: t, duration: dur * 0.92, gainMul: 1.5 });
      this._emitAt({ type: 'note', key: p.key }, t);
      t += dur;
    }

    // Land on the Ascendant an octave up, to close the circle.
    const asc = this.chart.byKey.asc ?? this.chart.byKey['a:asc'];
    if (asc && !asc.silent) {
      this._voiceFor(asc, { time: t + 0.2, duration: 3.0, gainMul: 1.5, octaveShift: 1 });
      this._emitAt({ type: 'note', key: asc.key }, t + 0.2);
    }
    this._endAt('sequence', t + 4.0);
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
      : ['asc', 'sun', 'moon', 'saturn'];
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
    // Replacing one transport mode with another should leave the new button
    // active throughout the handoff; the public stop action still notifies UI.
    this.stop({ fade: 0.4, emit: false });
    this.mode = mode;
    this._emit({ type: 'start', mode });
  }

  stop({ fade = 0.35, emit = true } = {}) {
    this.mode = null;
    // A preview can still be awaiting AudioContext startup. Clearing this
    // token prevents it from creating a voice after a drop, Escape, or redraw.
    this.designerPreview = null;
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
    this._choked.clear();
    if (emit) this._emit({ type: 'stop' });
  }
}
