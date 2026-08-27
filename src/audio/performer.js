/**
 * Arrangement.
 *
 * A natal chart has ten planetary bodies scattered across a chromatic octave.
 * ASC, MC, DSC and IC are directional reference points, not voices — they are
 * never scheduled by bloom, scalar, drone, or melodic (see `_sounding`).
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
import { AudioScheduler } from './scheduler.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const CHOKE_FADE = 0.05;

/** Bass costs more headroom than treble; trim it back toward parity. */
function loudnessTrim(freq) {
  if (freq >= 220) return 1;
  return clamp(0.45 + (freq / 220) * 0.55, 0.4, 1);
}

// Melodic mode: a tonal line built only from the pitch classes present in the
// chart. See `melodic()` for the composition itself; these are its pure
// scale-degree helpers, kept free of the engine so they stay easy to reason
// about (and to test) in isolation.

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

function nearestPresentDegree(target, present) {
  return present.reduce((best, d) => (
    circularDegreeDist(d, target) < circularDegreeDist(best, target) ? d : best
  ));
}

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
 * A short motif, stated in scale-degree deltas from wherever it starts, each
 * delta paired with its own note value in beats — a real melody is not just
 * a pitch shape but a rhythm cell, and the two repeat together every time the
 * motif is restated. Longer values fall on the leaps, shorter ones on the
 * steps between them, the classical proportion that keeps a running line from
 * ever landing all on the same beat — the constant-eighth-note pulse that was
 * both the flattest-sounding phrasing and, since every note ends up the same
 * length, the surest way to pile overlapping voices on top of each other. The
 * elemental balance of the chart decides its character: earth and water
 * charts get a stepwise, "scalar" shape (their motion is grounded, adjacent);
 * fire and air charts get an "angular" one built from skips and leaps.
 */
function pickMotif(scalar) {
  const scalarMotifs = [
    { steps: [0, 1, 1], beats: [1, 0.5, 0.5] },
    { steps: [0, 1, -1, 1], beats: [0.75, 0.5, 0.5, 0.75] },
    { steps: [0, -1, 1, 1], beats: [0.5, 0.5, 0.5, 1] },
    { steps: [0, 1, 2], beats: [0.5, 0.5, 1] },
  ];
  const angularMotifs = [
    { steps: [0, 2, -1, 2], beats: [1, 0.5, 0.5, 1] },
    { steps: [0, -3, 1, 2], beats: [1, 0.5, 0.5, 0.75] },
    { steps: [0, 4, -2], beats: [1, 0.75, 1] },
    { steps: [0, 3, -2, 1], beats: [0.75, 0.5, 0.75, 0.5] },
  ];
  const motifs = scalar ? scalarMotifs : angularMotifs;
  return motifs[Math.floor(Math.random() * motifs.length)];
}

/**
 * Walk the motif as a classical melodic sequence — restating it, transposed,
 * on each of the chart's present degrees in turn — then snap every note the
 * motif reaches back onto a degree the chart actually has a body on. Scalar
 * charts sweep the degrees in an arch (up, then back down); angular charts
 * jump between the extremes, so the leaps between phrases match the leaps
 * within them. Each degree carries the beat value the motif gave its slot,
 * so the sequence's rhythm repeats along with its shape.
 */
function buildDegreeWalk(present, scalar) {
  if (present.length === 1) {
    return { degrees: [present[0], present[0], present[0]], beats: [1, 1, 1.5] };
  }

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

  const degrees = [];
  const beats = [];
  for (const anchor of anchors) {
    motif.steps.forEach((delta, i) => {
      const target = ((anchor + delta) % 7 + 7) % 7;
      degrees.push(nearestPresentDegree(target, present));
      beats.push(motif.beats[i]);
    });
  }
  return { degrees, beats };
}

// Beat values for the notes the motif's own rhythm cell doesn't cover: a
// coverage note is a plain aside so it gets the motif's middling value: a
// chromatic tone is a grace note so it stays brief; a cadence note is where
// the phrase actually arrives, so it gets the room a resolution needs — the
// approach note held, the resolution itself held longer still.
const COVERAGE_BEATS = 0.75;
const CHROMATIC_BEATS = 0.3;
const CADENCE_BEATS = [0.75, 1.25];

/**
 * Assemble the full phrase: the motif sequence, then whichever present
 * degrees it never touched (so every body sounds at least once), then the
 * cadence — a 4-3 resolution and a 7-1 resolution, each only if the chart
 * actually has bodies on both scale degrees involved. Chromatic (out-of-key)
 * bodies are threaded in as an appoggiatura just before their nearest
 * in-scale neighbour, the conventional way to spend an out-of-key tone.
 */
function buildMelody(present, chromatic, scale, byDegree, scalar) {
  const walk = buildDegreeWalk(present, scalar);
  const notes = walk.degrees.map((degree, i) => (
    { pc: byDegree.get(degree), degree, kind: 'motif', beats: walk.beats[i] }
  ));

  const touched = new Set(notes.map((n) => n.degree));
  for (const degree of present) {
    if (!touched.has(degree)) {
      notes.push({ pc: byDegree.get(degree), degree, kind: 'coverage', beats: COVERAGE_BEATS });
    }
  }

  if (present.includes(3) && present.includes(2)) {
    notes.push({ pc: byDegree.get(3), degree: 3, kind: 'cadence', beats: CADENCE_BEATS[0] });
    notes.push({ pc: byDegree.get(2), degree: 2, kind: 'cadence', beats: CADENCE_BEATS[1] });
  }
  if (present.includes(6) && present.includes(0)) {
    notes.push({ pc: byDegree.get(6), degree: 6, kind: 'cadence', beats: CADENCE_BEATS[0] });
    notes.push({ pc: byDegree.get(0), degree: 0, kind: 'cadence', beats: CADENCE_BEATS[1] });
  }

  for (const pc of chromatic) {
    const targetDegree = nearestPresentDegree(nearestDegreeBySemitone(pc, scale), present);
    const chromaticNote = { pc, degree: null, kind: 'chromatic', beats: CHROMATIC_BEATS };
    const idx = notes.findIndex((n) => n.degree === targetDegree);
    if (idx === -1) {
      notes.push(chromaticNote, { pc: byDegree.get(targetDegree), degree: targetDegree, kind: 'coverage', beats: COVERAGE_BEATS });
    } else notes.splice(idx, 0, chromaticNote);
  }

  return notes;
}

// Drone and melodic used to arm their own wall-clock intervals. Those are
// the timers mobile WebViews throttle, so the looping modes now answer a
// single audio-clock question — "what sounds between t0 and t1?" — and a
// lookahead ticker (see scheduler.js) is the only setInterval left.

export const DRONE_CYCLE = 24;
export const DRONE_STAGGER = 0.9;
export const DRONE_FIRST_LEAD = 0.08;
export const DRONE_REFRESH_LEAD = 0.5;
export const DRONE_RELEASE_LAG = 2.2;
export const DRONE_SHIMMER = 2.6;
export const DRONE_SHIMMER_LEAD = 0.05;
export const DRONE_FIRST_SHIMMER = 3.0;
export const MELODIC_LEAD = 0.08;

/**
 * Onsets of a repeating phrase whose start is `origin` and whose notes each
 * carry a beat value. Half-open in `[t0, t1)`, so adjacent windows neither
 * skip nor double a note.
 */
export function melodicOnsets(t0, t1, { origin, notes, beat }) {
  const period = notes.reduce((sum, n) => sum + n.beats, 0) * beat;
  if (!(period > 0) || !(t1 > t0) || notes.length === 0) return [];
  const out = [];
  let offset = 0;
  for (let i = 0; i < notes.length; i++) {
    const first = origin + offset;
    const startN = Math.max(0, Math.ceil((t0 - first) / period - 1e-12));
    for (let n = startN; ; n++) {
      const time = first + n * period;
      if (time >= t1) break;
      if (time >= t0) {
        out.push({
          index: i, time, phrase: n, pc: notes[i].pc, beats: notes[i].beats,
        });
      }
    }
    offset += notes[i].beats * beat;
  }
  out.sort((a, b) => a.time - b.time || a.index - b.index);
  return out;
}

/**
 * Which body voices this pitch class this time: walk the phrase in order,
 * cycling through the chart's bodies that share the class. Deterministic in
 * `(index, phrase)`, so a late tick that asks about the same window names
 * the same body.
 */
export function placementForNote(notes, index, phrase, byPc) {
  const pc = notes[index].pc;
  const list = byPc.get(pc);
  let before = 0;
  let perPhrase = 0;
  for (let j = 0; j < notes.length; j++) {
    if (notes[j].pc !== pc) continue;
    perPhrase++;
    if (j < index) before++;
  }
  return list[(phrase * perPhrase + before) % list.length];
}

/**
 * Anchor onsets, bed releases, and shimmer onsets for the drone in `[t0, t1)`.
 *
 * Times match the old interval layout: first bed at origin+80ms, a refresh
 * every 24s whose new bed starts 0.5s after the tick and whose old bed
 * releases 2.2s after it, a shimmer every 2.6s, and one extra shimmer at 3s.
 */
export function droneEvents(t0, t1, { origin, nAnchors, shimmer = true }) {
  if (!(t1 > t0)) return [];
  const events = [];
  const lastVoiceOffset = Math.max(0, nAnchors - 1) * DRONE_STAGGER;
  // Last event of cycle n>=1 is the later of its last staggered voice and
  // the bed release. Walk forward from the first cycle that can still land
  // in this window — starting at 0 every tick would grow with session length.
  const cycleTail = Math.max(DRONE_REFRESH_LEAD + lastVoiceOffset, DRONE_RELEASE_LAG);
  const cycle0Last = origin + DRONE_FIRST_LEAD + lastVoiceOffset;
  let minN = 0;
  if (nAnchors > 0 && cycle0Last < t0) {
    minN = Math.max(1, Math.ceil((t0 - origin - cycleTail) / DRONE_CYCLE - 1e-12));
  }
  const maxN = Math.max(
    minN,
    Math.ceil((t1 - origin - DRONE_FIRST_LEAD + lastVoiceOffset) / DRONE_CYCLE) + 1,
  );

  for (let n = minN; n <= maxN; n++) {
    if (nAnchors > 0) {
      const at = n === 0
        ? origin + DRONE_FIRST_LEAD
        : origin + n * DRONE_CYCLE + DRONE_REFRESH_LEAD;
      for (let i = 0; i < nAnchors; i++) {
        const time = at + i * DRONE_STAGGER;
        if (time >= t1) break;
        if (time >= t0) events.push({ type: 'anchor', time, cycle: n, index: i });
      }
    }
    if (nAnchors > 0 && n >= 1) {
      const releaseAt = origin + n * DRONE_CYCLE + DRONE_RELEASE_LAG;
      if (releaseAt >= t0 && releaseAt < t1) {
        events.push({ type: 'releaseBed', time: releaseAt, cycle: n });
      }
    }
  }

  if (shimmer) {
    const startK = Math.max(1, Math.ceil((t0 - origin - DRONE_SHIMMER_LEAD) / DRONE_SHIMMER - 1e-12));
    for (let k = startK; ; k++) {
      const time = origin + k * DRONE_SHIMMER + DRONE_SHIMMER_LEAD;
      if (time >= t1) break;
      if (time >= t0) events.push({ type: 'shimmer', time, k });
    }
    const extra = origin + DRONE_FIRST_SHIMMER + DRONE_SHIMMER_LEAD;
    if (extra >= t0 && extra < t1) events.push({ type: 'shimmer', time: extra, k: 'extra' });
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

function pickWeighted(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[0];
}

export class Performer {
  constructor(engine, { scheduler } = {}) {
    this.engine = engine;
    this.chart = null;
    this.tuning = { refA: 432, temperament: 'equal', microtones: false };
    this.palette = DEFAULT_PALETTE;
    this.tempo = 120;
    this.mode = null;
    this.active = [];
    this.timers = [];
    this.scheduler = scheduler ?? new AudioScheduler({ now: () => this.engine.now });
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
  _voiceFor(p, { time, duration = null, gainMul = 1, detune = 0, octaveShift = 0 } = {}) {
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
    // A body voiced in unison across several octaves (the Sun) trims each
    // octave layer's share so the stack lands at the same overall loudness as
    // one.
    const unisonOctaves = bodyVoice.unisonOctaves ?? null;
    const unisonTrim = unisonOctaves ? 1 / Math.sqrt(unisonOctaves.length) : 1;
    // Deliberately free of any headroom term. Keeping the ensemble inside the
    // master chain is the engine's job now (see AudioEngine.gainForLoad),
    // because only the engine can back off the voices that were *already*
    // sounding. Attenuating each arrival by the count it found, as this used
    // to, could only ever quieten the newcomer: the sum still grew, a chord's
    // later entries lost up to 10 dB purely by order of arrival rather than by
    // the balance `p.gain` sets, and any caller that opted out of the
    // calculation — a melodic line, a Designer preview — escaped it entirely.
    const gain = 0.22 * p.gain * gainMul * unisonTrim * loudnessTrim(freq);

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
    // The Sun is the fundamental, not a voice scattered around the wheel like
    // the rest of the ensemble — it anchors the stereo image dead center
    // regardless of its zodiacal longitude (and in an overlay, regardless of
    // side).
    if ((placement.baseKey ?? placement.key) === 'sun') return 0;
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
   * in bloom, scalar, drone, or melodic.
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
      { time: t, gainMul: 1.2 }
    );
    this._emit({ type: 'note', key, time: t });
  }

  _designerTimbre(placement) {
    // The index deliberately participates too: each sign crossing gets a
    // fresh articulation, even when two neighbouring signs share an element
    // or modality.
    return [placement.signIndex, placement.element, placement.modality, placement.house].join(':');
  }

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
        { time, gainMul: 1.2 }
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
    const ordered = aspects.slice().sort(mode === 'scalar'
      ? (a, b) => this._direction(a.b).longitude - this._direction(b.b).longitude
      : (a, b) => b.exactness - a.exactness);
    const start = this.engine.now + 0.08;
    const step = mode === 'scalar' ? 1.05 : mode === 'drone' ? 0.18 : 0.58;
    const duration = mode === 'drone' ? 7.5 : mode === 'scalar' ? 1.25 : 3.4;
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
  async scalar() {
    await this._begin('scalar');
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
    this._endAt('scalar', t + 3.6);
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

    if (!notes.length) return;

    // A single sustained register, like a lead line rather than the ensemble's
    // full spread of registers — each body keeps its own timbre, just not its
    // own octave.
    const REGISTER = 0;
    const beat = 60 / this.tempo;
    const origin = this.engine.now + MELODIC_LEAD;

    this.scheduler.start((t0, t1) => {
      if (this.mode !== 'melodic') return;
      for (const ev of melodicOnsets(t0, t1, { origin, notes, beat })) {
        const placement = placementForNote(notes, ev.index, ev.phrase, byPc);
        const dur = ev.beats * beat;
        this._voiceFor(placement, {
          time: ev.time,
          duration: dur * 0.9,
          // Quiet outer bodies are atmosphere in a chord; as the sole voice of
          // a melodic line they need to be heard as clearly as the Sun is.
          gainMul: Math.min(1.8, 1 / placement.gain),
          octaveShift: REGISTER - placement.octave,
        });
        this._emitAt({ type: 'note', key: placement.key }, ev.time);
      }
    });
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

    const activity = {};
    for (const p of placements) activity[p.key] = 0.25;
    for (const asp of this.chart.aspects) {
      activity[asp.a] = (activity[asp.a] ?? 0) + asp.exactness;
      activity[asp.b] = (activity[asp.b] ?? 0) + asp.exactness;
    }

    const origin = this.engine.now;
    const beds = new Map();
    const gainMul = 0.85 / Math.sqrt(anchorPlacements.length * 0.5);
    const weights = floating.map((p) => activity[p.key] ?? 0.25);

    this.scheduler.start((t0, t1) => {
      if (this.mode !== 'drone') return;
      for (const ev of droneEvents(t0, t1, {
        origin,
        nAnchors: anchorPlacements.length,
        shimmer: floating.length > 0,
      })) {
        if (ev.type === 'anchor') {
          const p = anchorPlacements[ev.index];
          const v = this._voiceFor(p, {
            time: ev.time,
            gainMul,
            detune: detunes[p.key],
          });
          const cycle = beds.get(ev.cycle) ?? [];
          cycle.push(v);
          beds.set(ev.cycle, cycle);
          this._emitAt({ type: 'note', key: p.key }, ev.time);
        } else if (ev.type === 'releaseBed') {
          const prev = beds.get(ev.cycle - 1);
          if (prev) {
            for (const v of prev) v.release(ev.time);
            beds.delete(ev.cycle - 1);
          }
        } else if (ev.type === 'shimmer') {
          const pick = pickWeighted(floating, weights);
          const octaveShift = Math.random() < 0.25 ? 1 : 0;
          this._voiceFor(pick, {
            time: ev.time,
            duration: 2 + Math.random() * 4,
            gainMul: 0.75,
            detune: detunes[pick.key],
            octaveShift,
          });
          this._emitAt({ type: 'note', key: pick.key }, ev.time);
        }
      }
    });
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
    this.scheduler.stop();

    const now = this.engine.now;
    for (const v of this.active) {
      if (!v.released) v.release(now, fade);
    }
    this.active.length = 0;
    this._choked.clear();
    if (emit) this._emit({ type: 'stop' });
  }
}
