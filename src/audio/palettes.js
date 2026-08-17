/**
 * A palette is two tables:
 *
 *   materials  one entry per ELEMENT  (fire / earth / air / water)
 *   gestures   one entry per HOUSE    (1..12)
 *
 * The renderer in voices.js reads these and builds a graph. Nothing about the
 * chart, the scheduler, the sign/house/modality mapping, or the master chain
 * changes when the palette changes — only what the voices are made of.
 *
 * MODALITIES stay in ontology.js on purpose. Cardinal/fixed/mutable is a claim
 * about articulation that holds regardless of timbre, and each palette's gestures
 * already scale those envelopes through `ampMul`.
 *
 * Adding a palette means adding a table here. It does not mean adding a
 * dependency: everything below is data for the existing renderer.
 */

// The four built-in oscillator types are four fixed spectra. `createPeriodicWave`
// takes an arbitrary list of harmonic amplitudes, so a partial can specify the
// exact shape of its overtone series instead of picking the nearest preset.
// A partial with `harmonics` uses a wavetable; one with `type` uses a built-in.
/** Every harmonic, amplitude falling as 1/k^rolloff. Higher rolloff = darker. */
function series(count, rolloff, { skipEven = false, skipOdd = false } = {}) {
  const h = [];
  for (let k = 1; k <= count; k++) {
    const drop = (skipEven && k % 2 === 0) || (skipOdd && k > 1 && k % 2 === 1);
    h.push(drop ? 0 : 1 / k ** rolloff);
  }
  return h;
}

/** An explicit set of harmonics, everything else silent. Used for struck bars. */
function sparse(spec, count = 16) {
  const h = new Array(count).fill(0);
  for (const [k, amp] of Object.entries(spec)) {
    if (k - 1 < count) h[k - 1] = amp;
  }
  return h;
}

// Subtractive, physical, and deliberately not pretty. Each element is built from
// what it would be made of: fire burns, earth thuds, air breathes, water slides.

const astropitchMaterials = {
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

const astropitchGestures = {
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

// Same semantics, different physics. Where AstroPitch reaches for a saw and a
// filter, this reaches for a specified overtone series: amplitudes fall smoothly,
// noise is mostly gone, and drive is nearly absent. The point is that a
// sign-locked chord — twelve semitones of chromatic cluster spread over five
// octaves — should be pleasant on first listen rather than merely legible.
//
// Body ratios stay OFF the harmonic grid. A body is a formant — a fixed physical
// resonance — not a pitch, so there is nothing to be consonant with. Put the peak
// on an integer ratio and it lands squarely on a partial that is already there
// and boosts it by the filter's full gain; the ratios below sit between partials
// so the resonance colours the tone instead of amplifying one line of it.
//
// And the sends have to be set against the master chain, not by taste. A smooth
// spectrum is louder than a rough one at equal peak — 1/k^2 amplitudes are close
// to a sine, so the crest factor is low and the wave delivers more energy per
// unit of headroom than a saw does. Reverb compounds it, because a send returns
// sustained, diffuse, low-crest energy that raises RMS without raising peak.
//
// That matters because the master chain normalises: its glue compressor gives
// back most of any per-voice gain cut, so a palette cannot be made to sit right
// by turning it down. Measured, a 30% cut in voice gain moved master RMS by
// about 4%, while a 30% cut in send level moved it by 8% and brought time spent
// above the soft-clip ceiling from +39% to +2% against the original palette.
// The sends below are the result of that sweep, not of taste.
const harmonicMaterials = {
  // Brass, not fire. A full series that rolls off steeply enough to stay warm,
  // with a fifth above doubling the fundamental instead of a detuned saw.
  fire: {
    partials: [
      { harmonics: series(14, 1.35), detune: 0, gain: 1.0 },
      { harmonics: series(8, 1.7), detune: 4, gain: 0.42 },
      { harmonics: sparse({ 1: 1, 3: 0.5 }), detune: -4, gain: 0.26 },
    ],
    sub: 0.14,
    noise: { gain: 0.10, decay: 0.035, filter: 'bandpass', freq: 2600, Q: 1.1 },
    body: { ratio: 2.82, Q: 1.6, gain: 3.4 },
    tilt: 1.2,
    drive: 0.16,
    cutoffMul: 6.0,
    resonance: 1.4,
    drift: { rate: 0, depth: 0 },
    send: { reverb: 0.21, delay: 0.11 },
    width: 0.4,
  },

  // A struck bar. Sparse harmonics with a strong 4th and 10th — the marimba
  // recipe — over an octave sub, and no noise beyond the mallet contact.
  earth: {
    partials: [
      { harmonics: sparse({ 1: 1, 4: 0.42, 10: 0.14 }), detune: 0, gain: 1.0 },
      { harmonics: series(5, 2.2), detune: 3, gain: 0.5 },
      { type: 'sine', detune: -5, gain: 0.3 },
    ],
    sub: 0.4,
    noise: { gain: 0.16, decay: 0.02, filter: 'bandpass', freq: 1500, Q: 2.2 },
    body: { ratio: 2.38, Q: 2.6, gain: 4.0 },
    tilt: -3.0,
    drive: 0.06,
    cutoffMul: 4.0,
    resonance: 1.2,
    drift: { rate: 0, depth: 0 },
    send: { reverb: 0.17, delay: 0.06 },
    width: 0.28,
  },

  // Glass. Odd harmonics only, spaced wide and rolling off fast, so it rings
  // clear rather than hollow. The breath layer is quieter and sits under it.
  air: {
    partials: [
      { harmonics: series(13, 1.5, { skipEven: true }), detune: 0, gain: 0.85 },
      { harmonics: sparse({ 1: 1, 2: 0.3, 5: 0.18 }), detune: 5, gain: 0.4 },
      { type: 'sine', detune: -1200, gain: 0.22 },
    ],
    sub: 0.06,
    noise: { gain: 0.16, decay: 1.2, filter: 'bandpass', freq: 4.0, Q: 2.4, tracks: true },
    body: { ratio: 3.35, Q: 1.4, gain: 2.6 },
    tilt: 2.4,
    drive: 0.03,
    cutoffMul: 7.0,
    resonance: 1.3,
    drift: { rate: 0.1, depth: 0.04 },
    fm: { ratio: 2.0, index: 0.9, decay: 1.6 },
    send: { reverb: 0.31, delay: 0.24 },
    width: 0.85,
  },

  // A soft pad. Amplitudes fall as 1/k^2, which is about as smooth as an
  // overtone series gets, and the drift is halved so it floats without seasick.
  water: {
    partials: [
      { harmonics: series(10, 2.0), detune: 0, gain: 1.0 },
      { harmonics: series(6, 2.4), detune: 7, gain: 0.6 },
      { type: 'sine', detune: -9, gain: 0.5 },
    ],
    sub: 0.3,
    noise: { gain: 0.05, decay: 0.6, filter: 'lowpass', freq: 1100, Q: 0.8 },
    body: { ratio: 1.5, Q: 1.8, gain: 2.4 },
    tilt: -1.0,
    drive: 0.03,
    cutoffMul: 4.5,
    resonance: 1.6,
    drift: { rate: 0.14, depth: 0.11 },
    fm: { ratio: 2.0, index: 0.35, decay: 3.4 },
    send: { reverb: 0.41, delay: 0.17 },
    width: 0.66,
  },
};

// Gestures keep their meaning — the 2nd is still struck, the 5th still sings —
// but the extremes come in. Filter envelopes travel less, gates cut shallower,
// and releases run longer so overlapping voices blend instead of colliding.
const harmonicGestures = {
  // 1st — ego. Present and unadorned, but not as bone-dry as the original.
  1: G({
    ampMul: { attack: 0.6, decay: 1.0, sustain: 1.05, release: 1.1 },
    filter: { start: 1.6, env: 0.3, attack: 0.008, decay: 0.45, qMul: 0.7 },
    send: { reverb: 0.5, delay: 0.35 },
    widthMul: 0.55,
  }),

  // 2nd — possessions. Struck, and allowed to ring out rather than being cut.
  2: G({
    ampMul: { attack: 0.06, decay: 0.85, sustain: 0.05, release: 1.4 },
    filter: { start: 2.2, env: 1.0, attack: 0.003, decay: 0.5, qMul: 1.1 },
    noiseMul: 1.5,
    subMul: 1.3,
    send: { reverb: 0.85, delay: 0.4 },
  }),

  // 3rd — communication. Still articulate, but the flutter is a tremolo now
  // rather than a chop, and the transient is softer.
  3: G({
    ampMul: { attack: 0.12, decay: 0.6, sustain: 0.45, release: 0.8 },
    filter: { start: 2.4, env: 0.8, attack: 0.005, decay: 0.22, qMul: 1.2 },
    noiseMul: 1.5,
    gate: { rate: 9, depth: 0.3, cycles: 6 },
    send: { reverb: 0.75, delay: 1.4 },
  }),

  // 4th — home. Muffled and close, with the sub carrying the warmth.
  4: G({
    ampMul: { attack: 2.4, decay: 1.2, sustain: 1.0, release: 1.5 },
    filter: { start: 0.5, env: 0.25, attack: 0.15, decay: 1.1, qMul: 0.6 },
    noiseMul: 0.3,
    subMul: 1.5,
    send: { reverb: 0.9, delay: 0.3 },
    widthMul: 0.6,
  }),

  // 5th — creativity. Sung. A shorter scoop, because a wavetable holds its
  // shape through a glide and a long one draws attention to itself.
  5: G({
    ampMul: { attack: 2.8, decay: 1.1, sustain: 1.1, release: 1.4 },
    filter: { start: 0.85, env: 0.8, attack: 0.3, decay: 1.4, qMul: 1.1 },
    glide: 0.14,
    vibrato: { rate: 5.0, depth: 16, delay: 0.4 },
    send: { reverb: 1.0, delay: 0.7 },
  }),

  // 6th — routine. The clock still runs, but it pulses instead of gating.
  6: G({
    ampMul: { attack: 0.2, decay: 0.7, sustain: 0.8, release: 0.8 },
    filter: { start: 1.6, env: 0.4, attack: 0.006, decay: 0.25, qMul: 1.2 },
    gate: { rate: 6, depth: 0.5, cycles: Infinity },
    send: { reverb: 0.55, delay: 0.5 },
    widthMul: 0.45,
  }),

  // 7th — partnership. A wider, slower pair: further apart in space, closer
  // together in tuning, so the two read as one instrument doubled.
  7: G({
    ampMul: { attack: 1.5, decay: 1.0, sustain: 1.0, release: 1.4 },
    filter: { start: 1.2, env: 0.45, attack: 0.06, decay: 0.85, qMul: 0.9 },
    double: { detune: 6, delay: 0.08, pan: 0.75, gain: 0.9 },
    send: { reverb: 1.0, delay: 0.5 },
    widthMul: 1.35,
  }),

  // 8th — transformation. Still opens from nearly closed over a long arc, but
  // the drive stays modest — the change is spectral, not distortion.
  8: G({
    ampMul: { attack: 1.8, decay: 1.4, sustain: 1.0, release: 1.7 },
    filter: { start: 0.3, env: 2.0, attack: 1.5, decay: 3.0, qMul: 1.6 },
    driveMul: 1.6,
    subMul: 1.8,
    noiseMul: 0.4,
    send: { reverb: 1.0, delay: 0.6 },
  }),

  // 9th — travel. Distant and wide.
  9: G({
    ampMul: { attack: 2.4, decay: 1.3, sustain: 0.95, release: 2.0 },
    filter: { start: 1.3, env: 0.5, attack: 0.55, decay: 1.6, qMul: 0.8 },
    noiseMul: 0.4,
    send: { reverb: 2.0, delay: 1.5 },
    widthMul: 1.6,
  }),

  // 10th — career. The brass overshoot survives intact; it is the one gesture
  // that was already consonant.
  10: G({
    ampMul: { attack: 0.8, decay: 0.9, sustain: 1.0, release: 1.1 },
    filter: { start: 0.6, env: 2.6, attack: 0.1, decay: 0.55, qMul: 1.0 },
    driveMul: 1.3,
    send: { reverb: 0.7, delay: 0.35 },
    widthMul: 0.75,
  }),

  // 11th — technology. A bell, but cast at 2:1 — inharmonic enough to shimmer,
  // harmonic enough to belong to the chord underneath it.
  11: G({
    ampMul: { attack: 0.05, decay: 2.0, sustain: 0.1, release: 2.8 },
    filter: { start: 3.0, env: 0.35, attack: 0.003, decay: 1.4, qMul: 0.7 },
    fm: { ratio: 2.0, index: 3.2, decay: 1.4 },
    noiseMul: 0.25,
    send: { reverb: 1.4, delay: 1.2 },
    widthMul: 1.2,
  }),

  // 12th — the unconscious. The long swell, with a gentler glide.
  12: G({
    ampMul: { attack: 8.0, decay: 1.6, sustain: 0.85, release: 3.0 },
    filter: { start: 0.6, env: 1.0, attack: 1.8, decay: 3.0, qMul: 0.9 },
    noiseMul: 0.5,
    glide: 0.3,
    send: { reverb: 2.5, delay: 1.4 },
    widthMul: 1.5,
  }),
};

export const PALETTES = {
  astropitch: {
    id: 'astropitch',
    name: 'Bright',
    blurb: 'Brighter, rougher voices with more noise, drive, and punch.',
    materials: astropitchMaterials,
    gestures: astropitchGestures,
  },
  harmonic: {
    id: 'harmonic',
    name: 'Warm',
    blurb: 'Smoother overtone-based voices with less noise and softer gestures.',
    materials: harmonicMaterials,
    gestures: harmonicGestures,
  },
};

export const DEFAULT_PALETTE = 'harmonic';

export const PALETTE_IDS = Object.keys(PALETTES);

export function getPalette(id) {
  return PALETTES[id] ?? PALETTES[DEFAULT_PALETTE];
}
