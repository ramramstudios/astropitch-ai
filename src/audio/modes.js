/**
 * Transport modes — the single source of truth.
 *
 * Adding a mode means adding one object here. The performer dispatches on
 * `MODES`; the UI builds buttons, aria-pressed sync, keyboard shortcuts, and
 * the help line by iterating the same list. That mirrors palettes.js (data)
 * vs voices.js (renderer): arrangement lives here, voice construction stays
 * in the performer.
 */

// Melodic mode: a tonal line built only from the pitch classes present in the
// chart. See `melodicSchedule` for the composition itself; these are its pure
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

/**
 * The chart as a chord that assembles from its solar centre: the Sun, then
 * the inner planets, then the Moon as the personal threshold, and finally
 * the outer bodies. Everything holds, then releases together.
 *
 * With two charts overlaid the same order runs, but each body is immediately
 * followed by its opposite number — so Sun lands against Sun, and you hear
 * the contact as an interval rather than as two unrelated events.
 */
export async function bloomSchedule(performer) {
  await performer._begin('bloom');
  const ORDER = ['sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  const placements = performer._sounding();
  const detunes = performer._detuneMap(placements);

  // The Sun arrives at once; the inner planets move quickly, then the
  // personal threshold and slower bodies have room to settle underneath.
  const gaps = { sun: 0, mercury: 0.75, venus: 0.55, moon: 0.95, mars: 0.55, jupiter: 0.6, saturn: 0.7, uranus: 0.55, neptune: 0.7, pluto: 0.8 };

  const baseOf = (p) => p.baseKey ?? p.key;
  const ordered = placements
    .slice()
    .sort((x, y) => ORDER.indexOf(baseOf(x)) - ORDER.indexOf(baseOf(y))
      || String(x.side ?? '').localeCompare(String(y.side ?? '')));

  const start = performer.engine.now + 0.08;
  let t = start;
  let prevBase = null;
  const voices = [];

  for (const p of ordered) {
    const base = baseOf(p);
    // A body's counterpart arrives almost on top of it; a new body waits.
    t += base === prevBase ? 0.2 : (gaps[base] ?? 0.6);
    prevBase = base;
    voices.push(performer._voiceFor(p, { time: t, detune: detunes[p.key] }));
    performer._emitAt({ type: 'note', key: p.key }, t);
  }

  const hold = t + 3.4;
  for (const v of voices) v.release(hold);
  performer._endAt('bloom', hold + 2.4);
}

/**
 * Walk the zodiac from the Ascendant and sound each body as you pass it.
 * Note length comes from modality: cardinal strikes, fixed holds, mutable
 * sits in between and wavers.
 */
export async function scalarSchedule(performer) {
  await performer._begin('scalar');
  // The walk's start line is the house-1 cusp, not the rising sign's
  // boundary: those match for whole sign, but equal and the quadrant
  // systems put the Ascendant's exact degree ahead of it, and a body
  // between the two would otherwise sound before the chart has risen.
  const asc = performer.chart.cusps?.[0] ?? performer.chart.ascSignIndex * 30;
  const placements = performer._sounding().slice().sort((a, b) =>
    ((a.longitude - asc + 360) % 360) - ((b.longitude - asc + 360) % 360));

  const lengths = { cardinal: 0.55, fixed: 1.35, mutable: 0.9 };
  const start = performer.engine.now + 0.08;
  let t = start;

  for (const p of placements) {
    const dur = lengths[p.modality] * (120 / performer.tempo);
    performer._voiceFor(p, { time: t, duration: dur * 0.92, gainMul: 1.5 });
    performer._emitAt({ type: 'note', key: p.key }, t);
    t += dur;
  }

  // Buffer past the last note's nominal end for the slowest (fixed) release.
  performer._endAt('scalar', t + 3.6);
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
export async function melodicSchedule(performer) {
  await performer._begin('melodic');
  const placements = performer._sounding();

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
  const beat = 60 / performer.tempo;
  const origin = performer.engine.now + MELODIC_LEAD;

  performer.scheduler.start((t0, t1) => {
    if (performer.mode !== 'melodic') return;
    for (const ev of melodicOnsets(t0, t1, { origin, notes, beat })) {
      const placement = placementForNote(notes, ev.index, ev.phrase, byPc);
      const dur = ev.beats * beat;
      performer._voiceFor(placement, {
        time: ev.time,
        duration: dur * 0.9,
        // Quiet outer bodies are atmosphere in a chord; as the sole voice of
        // a melodic line they need to be heard as clearly as the Sun is.
        gainMul: Math.min(1.8, 1 / placement.gain),
        octaveShift: REGISTER - placement.octave,
      });
      performer._emitAt({ type: 'note', key: placement.key }, ev.time);
    }
  });
}

/**
 * Generative sustain. The anchors hold indefinitely while the remaining
 * bodies surface and sink, chosen by how tightly they aspect something else —
 * so a chart with exact aspects is a busy drone and a chart without them is
 * a still one.
 */
export async function droneSchedule(performer) {
  await performer._begin('drone');
  const placements = performer._sounding();
  const detunes = performer._detuneMap(placements);
  const baseOf = (p) => p.baseKey ?? p.key;

  // Two charts overlaid already put two of everything in the bed, so the
  // anchors drop to just the lights to leave the same room.
  const anchorBases = performer.chart.meta?.synastry
    ? ['sun', 'moon']
    : ['sun', 'moon', 'saturn'];
  const anchorSet = new Set(anchorBases);
  const anchorPlacements = placements.filter((p) => anchorSet.has(baseOf(p)));
  const anchorKeys = new Set(anchorPlacements.map((p) => p.key));
  const floating = placements.filter((p) => !anchorKeys.has(p.key));

  const activity = {};
  for (const p of placements) activity[p.key] = 0.25;
  for (const asp of performer.chart.aspects) {
    activity[asp.a] = (activity[asp.a] ?? 0) + asp.exactness;
    activity[asp.b] = (activity[asp.b] ?? 0) + asp.exactness;
  }

  const origin = performer.engine.now;
  const beds = new Map();
  const gainMul = 0.85 / Math.sqrt(anchorPlacements.length * 0.5);
  const weights = floating.map((p) => activity[p.key] ?? 0.25);

  performer.scheduler.start((t0, t1) => {
    if (performer.mode !== 'drone') return;
    for (const ev of droneEvents(t0, t1, {
      origin,
      nAnchors: anchorPlacements.length,
      shimmer: floating.length > 0,
    })) {
      if (ev.type === 'anchor') {
        const p = anchorPlacements[ev.index];
        const v = performer._voiceFor(p, {
          time: ev.time,
          gainMul,
          detune: detunes[p.key],
        });
        const cycle = beds.get(ev.cycle) ?? [];
        cycle.push(v);
        beds.set(ev.cycle, cycle);
        performer._emitAt({ type: 'note', key: p.key }, ev.time);
      } else if (ev.type === 'releaseBed') {
        const prev = beds.get(ev.cycle - 1);
        if (prev) {
          for (const v of prev) v.release(ev.time);
          beds.delete(ev.cycle - 1);
        }
      } else if (ev.type === 'shimmer') {
        const pick = pickWeighted(floating, weights);
        const octaveShift = Math.random() < 0.25 ? 1 : 0;
        performer._voiceFor(pick, {
          time: ev.time,
          duration: 2 + Math.random() * 4,
          gainMul: 0.75,
          detune: detunes[pick.key],
          octaveShift,
        });
        performer._emitAt({ type: 'note', key: pick.key }, ev.time);
      }
    }
  });
}

/** Button id for a mode — kept stable so CSS (#bloomBtn) and tests keep working. */
export function modeButtonId(mode) {
  return `${typeof mode === 'string' ? mode : mode.id}Btn`;
}

export const MODES = [
  {
    id: 'bloom',
    label: 'Bloom',
    sub: 'chart as chord',
    key: 'b',
    title: 'The chart opens like a flower, petal by petal outward from the Sun to Pluto. Click again to stop.',
    schedule: bloomSchedule,
  },
  {
    id: 'scalar',
    label: 'Scalar',
    sub: 'walk the wheel',
    key: 's',
    title: 'Walk the zodiac from the Ascendant. Click again to stop.',
    schedule: scalarSchedule,
  },
  {
    id: 'drone',
    label: 'Drone',
    sub: 'generative',
    key: 'd',
    title: 'Generative sustain driven by your aspects. Click again to stop.',
    schedule: droneSchedule,
  },
  {
    id: 'melodic',
    label: 'Melodic',
    sub: 'chart as tune',
    key: 'm',
    title: "A tonal melody built only from the chart's own notes, looping like Drone. Click again to stop.",
    schedule: melodicSchedule,
  },
];

export const DEFAULT_MODE_ID = MODES[0].id;

export function modeById(id) {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
