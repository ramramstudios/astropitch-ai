/**
 * Arrangement.
 *
 * A natal chart has ten planetary bodies scattered across a chromatic octave.
 * ASC, MC, DSC and IC are directional reference points, not voices — they are
 * never scheduled by bloom, sequence, drone, or melodic (see `_sounding`).
 * They are only heard on demand, via a click on the wheel that auditions the aspect
 * network attached to that direction (`playDirectionalAspects`). Playing all
 * ten planets at one pitch level gets a tone cluster, which is honest but
 * unlistenable. Four things keep it musical:
 *
 *   1. Register. Each body's octave follows its physical size: the Sun
 *      anchors the bottom, doubled in unison three octaves apart, and each
 *      smaller body sits a register higher, up to Pluto at the top — so a
 *      chromatic cluster in longitude is spread across six octave registers.
 *   2. Entry. Voices arrive in an order that means something, not all at once.
 *   3. Balance. The Sun and Moon are loud; the outer planets are
 *      atmosphere. Low voices get trimmed because bass carries more energy.
 *   4. Space. Pan follows position on the wheel, so the chart's geometry is
 *      audible as a stereo image.
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

// ---------------------------------------------------------------------------
// Melodic mode: a tonal line built only from the pitch classes present in the
// chart. See `melodic()` for the composition itself; these are its pure
// scale-degree helpers, kept free of the engine so they stay easy to reason
// about (and to test) in isolation.
// ---------------------------------------------------------------------------

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 11];

/**
 * Find the tonic and scale (major, natural minor, or harmonic minor — the
 * one with a proper leading tone, since a raised 7th is what makes the 7-1
 * pull audible) that best accounts for the chart's own pitch classes. The
 * chart is never bent to fit the scale; the scale is chosen to fit the
 * chart, then only ever used to name the notes that are already there.
 */
function fitScale(pcs) {
  const pcSet = new Set(pcs);
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const steps of [MAJOR_STEPS, MINOR_STEPS, HARMONIC_MINOR_STEPS]) {
      const scalePcs = steps.map((s) => (tonic + s) % 12);
      const covered = scalePcs.filter((pc) => pcSet.has(pc)).length;
      // Reward a scale whose own tonic and fifth are bodies the chart
      // actually placed there — a tonal centre the chart argues for itself,
      // not one merely compatible with it.
      const score = covered * 10
        + (pcSet.has(tonic) ? 4 : 0)
        + (pcSet.has((tonic + 7) % 12) ? 2 : 0);
      if (!best || score > best.score) best = { tonic, steps, score };
    }
  }
  return best;
}

/**
 * Sort the chart's pitch classes into scale degrees (0-6, i.e. 1st-7th) the
 * chosen scale actually has bodies on, and the leftover pitch classes the
 * scale does not explain — the out-of-key placements, kept as chromatic
 * colour rather than dropped.
 */
function degreesFor(pcs, scale) {
  const byDegree = new Map();
  scale.steps.forEach((step, degree) => {
    const pc = (scale.tonic + step) % 12;
    if (pcs.includes(pc)) byDegree.set(degree, pc);
  });
  const present = [...byDegree.keys()].sort((a, b) => a - b);
  const inScale = new Set(byDegree.values());
  const chromatic = pcs.filter((pc) => !inScale.has(pc));
  return { byDegree, present, chromatic };
}

const circularDegreeDist = (a, b) => {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
};

/** The present scale degree closest to a target degree, wrapping at the octave. */
function nearestPresentDegree(target, present) {
  return present.reduce((best, d) => (
    circularDegreeDist(d, target) < circularDegreeDist(best, target) ? d : best
  ));
}

/** Which scale degree a chromatic pitch class sits closest to, by semitone. */
function nearestDegreeBySemitone(pc, scale) {
  let best = 0;
  let bestDist = Infinity;
  scale.steps.forEach((step, degree) => {
    const spc = (scale.tonic + step) % 12;
    const dist = Math.min((pc - spc + 12) % 12, (spc - pc + 12) % 12);
    if (dist < bestDist) { bestDist = dist; best = degree; }
  });
  return best;
}

/**
 * A short motif, stated in scale-degree deltas from wherever it starts. The
 * elemental balance of the chart decides its character: earth and water
 * charts get a stepwise, "scalar" shape (their motion is grounded, adjacent);
 * fire and air charts get an "angular" one built from skips and leaps.
 */
function pickMotif(scalar) {
  const scalarShapes = [[0, 1, 1], [0, 1, -1, 1], [0, -1, 1, 1], [0, 1, 2]];
  const angularShapes = [[0, 2, -1, 2], [0, -3, 1, 2], [0, 4, -2], [0, 3, -2, 1]];
  const shapes = scalar ? scalarShapes : angularShapes;
  return shapes[Math.floor(Math.random() * shapes.length)];
}

/**
 * Walk the motif as a classical melodic sequence — restating it, transposed,
 * on each of the chart's present degrees in turn — then snap every note the
 * motif reaches back onto a degree the chart actually has a body on. Scalar
 * charts sweep the degrees in an arch (up, then back down); angular charts
 * jump between the extremes, so the leaps between phrases match the leaps
 * within them.
 */
function buildDegreeWalk(present, scalar) {
  if (present.length === 1) return [present[0], present[0], present[0]];

  const motif = pickMotif(scalar);
  let anchors;
  if (scalar) {
    anchors = [...present, ...present.slice(0, -1).reverse()];
  } else {
    anchors = [];
    let lo = 0;
    let hi = present.length - 1;
    while (lo <= hi) {
      anchors.push(present[lo++]);
      if (lo <= hi) anchors.push(present[hi--]);
    }
  }

  const walk = [];
  for (const anchor of anchors) {
    for (const delta of motif) {
      const target = ((anchor + delta) % 7 + 7) % 7;
      walk.push(nearestPresentDegree(target, present));
    }
  }
  return walk;
}

/**
 * Assemble the full phrase: the motif sequence, then whichever present
 * degrees it never touched (so every body sounds at least once), then the
 * cadence — a 4-3 resolution and a 7-1 resolution, each only if the chart
 * actually has bodies on both scale degrees involved. Chromatic (out-of-key)
 * bodies are threaded in as an appoggiatura just before their nearest
 * in-scale neighbour, the conventional way to spend an out-of-key tone.
 */
function buildMelody(present, chromatic, scale, byDegree, scalar) {
  const notes = buildDegreeWalk(present, scalar)
    .map((degree) => ({ pc: byDegree.get(degree), degree, kind: 'motif' }));

  const touched = new Set(notes.map((n) => n.degree));
  for (const degree of present) {
    if (!touched.has(degree)) notes.push({ pc: byDegree.get(degree), degree, kind: 'coverage' });
  }

  if (present.includes(3) && present.includes(2)) {
    notes.push({ pc: byDegree.get(3), degree: 3, kind: 'cadence' });
    notes.push({ pc: byDegree.get(2), degree: 2, kind: 'cadence' });
  }
  if (present.includes(6) && present.includes(0)) {
    notes.push({ pc: byDegree.get(6), degree: 6, kind: 'cadence' });
    notes.push({ pc: byDegree.get(0), degree: 0, kind: 'cadence' });
  }

  for (const pc of chromatic) {
    const targetDegree = nearestPresentDegree(nearestDegreeBySemitone(pc, scale), present);
    const chromaticNote = { pc, degree: null, kind: 'chromatic' };
    const idx = notes.findIndex((n) => n.degree === targetDegree);
    if (idx === -1) notes.push(chromaticNote, { pc: byDegree.get(targetDegree), degree: targetDegree, kind: 'coverage' });
    else notes.splice(idx, 0, chromaticNote);
  }

  return notes;
}

const MELODIC_NOTE_BEATS = { motif: 0.5, coverage: 0.55, chromatic: 0.3, cadence: 0.85 };

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
    // A body voiced in unison across several octaves (the Sun) trims each
    // octave layer's share so the stack lands at the same overall loudness as
    // one.
    const unisonOctaves = bodyVoice.unisonOctaves ?? null;
    const unisonTrim = unisonOctaves ? 1 / Math.sqrt(unisonOctaves.length) : 1;
    const gain = 0.22 * p.gain * gainMul * headroom * unisonTrim * loudnessTrim(freq);

    const voice = new Voice(this.engine, spec, {
      freq, time, duration, gain, pan, detune,
      reverbMul: bodyVoice.reverbMul,
      delayMul: bodyVoice.delayMul,
      panDrift: bodyVoice.panDrift,
      unisonOctaves,
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

  /**
   * The ten planetary voices only. ASC/MC are directional reference points —
   * heard only via a click on the wheel and its connected aspects
   * (playDirectionalAspects, off `chart.anglePoints`), never as chord tones
   * in bloom, sequence, or drone.
   */
  _sounding() {
    if (!this.chart) return [];
    return this.chart.placements.filter((p) => !p.silent && !p.isAngle);
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
    // ASC/MC are directional references, not voices — the placements table can
    // still list and click them, but only a directional aspect audition
    // (playDirectionalAspects) should ever sound them.
    if (!p || p.silent || p.isAngle) return;
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
   * the inner planets, then the Moon as the personal threshold, and finally
   * the outer bodies. Everything holds, then releases together.
   *
   * With two charts overlaid the same order runs, but each body is immediately
   * followed by its opposite number — so Sun lands against Sun, and you hear
   * the contact as an interval rather than as two unrelated events.
   */
  async bloom() {
    await this._begin('bloom');
    const ORDER = ['sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const placements = this._sounding();
    const detunes = this._detuneMap(placements);

    // The Sun arrives at once; the inner planets move quickly, then the
    // personal threshold and slower bodies have room to settle underneath.
    const gaps = { sun: 0, mercury: 0.75, venus: 0.55, moon: 0.95, mars: 0.55, jupiter: 0.6, saturn: 0.7, uranus: 0.55, neptune: 0.7, pluto: 0.8 };

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
    // The walk's start line is the house-1 cusp, not the rising sign's
    // boundary: those match for whole sign, but equal and the quadrant
    // systems put the Ascendant's exact degree ahead of it, and a body
    // between the two would otherwise sound before the chart has risen.
    const asc = this.chart.cusps?.[0] ?? this.chart.ascSignIndex * 30;
    const placements = this._sounding().slice().sort((a, b) =>
      ((a.longitude - asc + 360) % 360) - ((b.longitude - asc + 360) % 360));

    const lengths = { cardinal: 0.55, fixed: 1.35, mutable: 0.9 };
    const start = this.engine.now + 0.08;
    let t = start;

    for (const p of placements) {
      const dur = lengths[p.modality] * (120 / this.tempo);
      this._voiceFor(p, { time: t, duration: dur * 0.92, gainMul: 1.5 });
      this._emitAt({ type: 'note', key: p.key }, t);
      t += dur;
    }

    // Buffer past the last note's nominal end for the slowest (fixed) release.
    this._endAt('sequence', t + 3.6);
  }

  /**
   * A tonal melody, constrained to only the pitch classes the chart actually
   * places — no note is invented to fill out the scale. `fitScale` finds the
   * major/minor key those pitch classes best argue for, `buildMelody` turns
   * that into one phrase (a motif, sequenced across the chart's degrees, a
   * pass to catch any note the motif skipped, and a 4-3/7-1 cadence wherever
   * the chart has the bodies for it), and this method just keeps replaying
   * that phrase — the way a good motif is repeated rather than replaced —
   * until stop(), the same open-ended loop as drone().
   */
  async melodic() {
    await this._begin('melodic');
    const placements = this._sounding();

    const byPc = new Map();
    for (const p of placements) {
      if (!byPc.has(p.signIndex)) byPc.set(p.signIndex, []);
      byPc.get(p.signIndex).push(p);
    }
    const pcs = [...byPc.keys()];

    const notes = [];
    if (pcs.length) {
      const scale = fitScale(pcs);
      const { byDegree, present, chromatic } = degreesFor(pcs, scale);
      const earthy = placements.filter((p) => p.element === 'earth' || p.element === 'water').length;
      const fiery = placements.filter((p) => p.element === 'fire' || p.element === 'air').length;
      notes.push(...buildMelody(present, chromatic, scale, byDegree, earthy >= fiery));
    }

    // A single sustained register, like a lead line rather than the ensemble's
    // full spread of registers — each body keeps its own timbre, just not its
    // own octave.
    const REGISTER = 0;
    const beat = 60 / this.tempo;
    const rotation = new Map();
    const nextPlacement = (pc) => {
      const list = byPc.get(pc);
      const i = rotation.get(pc) ?? 0;
      rotation.set(pc, (i + 1) % list.length);
      return list[i];
    };

    const playPhrase = (startTime) => {
      let t = startTime;
      for (const note of notes) {
        const placement = nextPlacement(note.pc);
        const dur = MELODIC_NOTE_BEATS[note.kind] * beat;
        this._voiceFor(placement, {
          time: t,
          duration: dur * 0.9,
          // Quiet outer bodies are atmosphere in a chord; as the sole voice of
          // a melodic line they need to be heard as clearly as the Sun is.
          gainMul: Math.min(1.8, 1 / placement.gain),
          octaveShift: REGISTER - placement.octave,
          solo: true,
        });
        this._emitAt({ type: 'note', key: placement.key }, t);
        t += dur;
      }
      return t;
    };

    const phraseBeats = notes.reduce((sum, n) => sum + MELODIC_NOTE_BEATS[n.kind], 0);
    playPhrase(this.engine.now + 0.08);
    if (phraseBeats > 0) {
      this.loopHandle = setInterval(() => {
        if (this.mode !== 'melodic') return;
        playPhrase(this.engine.now + 0.05);
      }, phraseBeats * beat * 1000);
    }
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
    // anchors drop to just the lights to leave the same room.
    const anchorBases = this.chart.meta?.synastry
      ? ['sun', 'moon']
      : ['sun', 'moon', 'saturn'];
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
