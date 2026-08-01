/**
 * The AstroPitch ontology.
 *
 * The mapping begins with a simple correspondence: the zodiac has 12 signs of
 * 30 degrees, and an octave has 12 semitones. Walking chromatically from Aries
 * (A, 440 Hz) to Pisces (G#, 830.61 Hz) makes the mapping exact and lossless:
 *
 *     30 degrees of ecliptic longitude == 1 semitone
 *     one trip around the zodiac       == one octave
 *
 * Everything else follows from that. Sign sets pitch. Element is the material
 * the tone is made of. House is the gesture that plays it. Modality is the
 * phrasing. Planet picks register and role in the mix. Aspects, being angular
 * distances, become intervals for free.
 */

// ---------------------------------------------------------------------------
// Elements — the material: waveform stack, harmonic content, texture
// ---------------------------------------------------------------------------

export const ELEMENTS = {
  fire: {
    name: 'Fire',
    texture: 'dense, driven, every harmonic present',
    hue: 14,
    color: '#ff7a4d',
    glow: 'rgba(255, 122, 77, 0.55)',
    quality:
      'Three sawtooths beating against each other, driven into soft clipping. '
      + 'Every harmonic present, and more of them the harder you push it. Cracks on the attack.',
  },
  earth: {
    name: 'Earth',
    texture: 'low-order, wooden, sub-heavy',
    hue: 96,
    color: '#8fbf6a',
    glow: 'rgba(143, 191, 106, 0.5)',
    quality:
      'Triangles and sines over a strong sub, everything above the fourth partial rolled away, '
      + 'with a narrow box resonance sitting on top. Thuds rather than cracks.',
  },
  air: {
    name: 'Air',
    texture: 'hollow, breathy, very wide',
    hue: 196,
    color: '#7fd3f0',
    glow: 'rgba(127, 211, 240, 0.5)',
    quality:
      'Hollow odd harmonics from narrow pulses, an octave doubling, and a column of '
      + 'band-passed breath that tracks the pitch. Thin on purpose, and very wide.',
  },
  water: {
    name: 'Water',
    texture: 'detuned, drifting, never still',
    hue: 265,
    color: '#a98cf0',
    glow: 'rgba(169, 140, 240, 0.5)',
    quality:
      'Sine cores that refuse to hold still: heavy detune, independent slow drift on the '
      + 'filter, and low-index FM keeping the spectrum sliding. Long tails.',
  },
};

// ---------------------------------------------------------------------------
// Modalities — the envelope shape
// ---------------------------------------------------------------------------

export const MODALITIES = {
  cardinal: {
    name: 'Cardinal',
    quality: 'Initiating — strikes and moves on',
    envelope: { attack: 0.006, decay: 0.55, sustain: 0.38, release: 1.6, vibrato: 0.0 },
  },
  fixed: {
    name: 'Fixed',
    quality: 'Sustaining — holds its ground',
    envelope: { attack: 0.09, decay: 0.9, sustain: 0.82, release: 3.2, vibrato: 0.15 },
  },
  mutable: {
    name: 'Mutable',
    quality: 'Changing — never settles',
    envelope: { attack: 0.035, decay: 0.7, sustain: 0.58, release: 2.4, vibrato: 0.75 },
  },
};

// ---------------------------------------------------------------------------
// Signs — pitch. Index 0 (Aries) is A; each subsequent sign is one semitone up.
//
// Glyphs carry U+FE0E (VARIATION SELECTOR-15). Without it the zodiac range
// U+2648..U+2653 has emoji presentation by default, so the browser draws a
// colour emoji that ignores `fill` — the signs lose their element colour and
// turn into purple boxes.
// ---------------------------------------------------------------------------

export const SIGNS = [
  { name: 'Aries',       glyph: '♈\uFE0E', pitch: 'A',     element: 'fire',  modality: 'cardinal', ruler: 'Mars',    keyword: 'the spark' },
  { name: 'Taurus',      glyph: '♉\uFE0E', pitch: 'A♯/B♭', element: 'earth', modality: 'fixed',    ruler: 'Venus',   keyword: 'the body' },
  { name: 'Gemini',      glyph: '♊\uFE0E', pitch: 'B',     element: 'air',   modality: 'mutable',  ruler: 'Mercury', keyword: 'the signal' },
  { name: 'Cancer',      glyph: '♋\uFE0E', pitch: 'C',     element: 'water', modality: 'cardinal', ruler: 'Moon',    keyword: 'the shell' },
  { name: 'Leo',         glyph: '♌\uFE0E', pitch: 'C♯/D♭', element: 'fire',  modality: 'fixed',    ruler: 'Sun',     keyword: 'the stage' },
  { name: 'Virgo',       glyph: '♍\uFE0E', pitch: 'D',     element: 'earth', modality: 'mutable',  ruler: 'Mercury', keyword: 'the craft' },
  { name: 'Libra',       glyph: '♎\uFE0E', pitch: 'D♯/E♭', element: 'air',   modality: 'cardinal', ruler: 'Venus',   keyword: 'the mirror' },
  { name: 'Scorpio',     glyph: '♏\uFE0E', pitch: 'E',     element: 'water', modality: 'fixed',    ruler: 'Pluto',   keyword: 'the depth' },
  { name: 'Sagittarius', glyph: '♐\uFE0E', pitch: 'F',     element: 'fire',  modality: 'mutable',  ruler: 'Jupiter', keyword: 'the arrow' },
  { name: 'Capricorn',   glyph: '♑\uFE0E', pitch: 'F♯/G♭', element: 'earth', modality: 'cardinal', ruler: 'Saturn',  keyword: 'the climb' },
  { name: 'Aquarius',    glyph: '♒\uFE0E', pitch: 'G',     element: 'air',   modality: 'fixed',    ruler: 'Uranus',  keyword: 'the current' },
  { name: 'Pisces',      glyph: '♓\uFE0E', pitch: 'G♯/A♭', element: 'water', modality: 'mutable',  ruler: 'Neptune', keyword: 'the dissolve' },
];

// ---------------------------------------------------------------------------
// Houses — timbre. Each archetype is translated into a synthesis recipe in
// audio/voices.js.
// ---------------------------------------------------------------------------

export const HOUSES = [
  { n: 1,  meaning: 'ego, sense of self',                   timbre: 'Naked and forward — a voice with nothing in front of it' },
  { n: 2,  meaning: 'material possessions and security',    timbre: 'Struck and physical — something with mass behind it' },
  { n: 3,  meaning: 'local community, communication',       timbre: 'Quick and articulate — consonants, not vowels' },
  { n: 4,  meaning: 'home and family',                      timbre: 'Wooden and warm — heard through a wall' },
  { n: 5,  meaning: 'creativity and romance',               timbre: 'Singing — vibrato, portamento, a little showy' },
  { n: 6,  meaning: 'day jobs, routines, health',           timbre: 'Measured and gated — running to a clock' },
  { n: 7,  meaning: 'partnerships',                         timbre: 'Doubled — two voices agreeing, slightly apart' },
  { n: 8,  meaning: 'death, sex, transformation',           timbre: 'Growling — sub-weight and a slow opening' },
  { n: 9,  meaning: 'travel, philosophy',                   timbre: 'Distant and wide — a long horizon' },
  { n: 10, meaning: 'public image, career, legacy',         timbre: 'Brass — declarative, front of stage' },
  { n: 11, meaning: 'humanity, technology',                 timbre: 'Metallic and inharmonic — a machine bell' },
  { n: 12, meaning: 'collective unconscious, psychic ability', timbre: 'Dissolved — arrives before it begins' },
];

// ---------------------------------------------------------------------------
// Bodies — register and role in the mix. Sun, Moon, and Ascendant are the
// loudest three voices.
// ---------------------------------------------------------------------------

export const BODIES = [
  { key: 'asc',     name: 'Ascendant', glyph: 'Asc', octave:  0, gain: 1.00, role: 'The voice you are heard in', angle: true },
  { key: 'sun',     name: 'Sun',       glyph: '☉\uFE0E', octave:  0, gain: 1.00, role: 'The fundamental' },
  { key: 'moon',    name: 'Moon',      glyph: '☽\uFE0E', octave: -1, gain: 0.92, role: 'The body beneath the tone' },
  { key: 'mercury', name: 'Mercury',   glyph: '☿\uFE0E', octave:  1, gain: 0.55, role: 'The fast upper partial' },
  { key: 'venus',   name: 'Venus',     glyph: '♀\uFE0E', octave:  0, gain: 0.70, role: 'The consonance' },
  { key: 'mars',    name: 'Mars',      glyph: '♂\uFE0E', octave: -1, gain: 0.68, role: 'The transient' },
  { key: 'jupiter', name: 'Jupiter',   glyph: '♃\uFE0E', octave:  0, gain: 0.62, role: 'The room it expands into' },
  { key: 'saturn',  name: 'Saturn',    glyph: '♄\uFE0E', octave: -2, gain: 0.72, role: 'The structural bass' },
  { key: 'uranus',  name: 'Uranus',    glyph: '♅\uFE0E', octave:  1, gain: 0.40, role: 'The interruption' },
  { key: 'neptune', name: 'Neptune',   glyph: '♆\uFE0E', octave:  0, gain: 0.42, role: 'The wash' },
  { key: 'pluto',   name: 'Pluto',     glyph: '♇\uFE0E', octave: -2, gain: 0.46, role: 'The drone under everything' },
  { key: 'mc',      name: 'Midheaven', glyph: 'MC',  octave:  0, gain: 0.55, role: 'The pitch you aim at', angle: true },
];

export const BODY_BY_KEY = Object.fromEntries(BODIES.map((b) => [b.key, b]));

/** Bodies that sound by default (Midheaven is an angle, not a voice). */
export const SOUNDING_BODIES = BODIES.filter((b) => b.key !== 'mc').map((b) => b.key);

// ---------------------------------------------------------------------------
// Aspects — which are intervals, because 30 degrees is a semitone.
//
// Sextile and quincunx use stand-ins. Their proper codepoints (U+26B9 and
// U+26BB, in the astrological block) are absent from the symbol fonts shipped
// on macOS, Windows and the Noto set alike, so they render as tofu everywhere.
// A six-pointed star for the sextile at least means "one sixth of the circle".
// ---------------------------------------------------------------------------

export const ASPECTS = [
  { name: 'Conjunction', glyph: '☌', angle: 0,   orb: 8, semitones: 0,  interval: 'unison',        consonance: 1.0,  color: '#f2e8c9' },
  { name: 'Sextile',     glyph: '✶', angle: 60,  orb: 5, semitones: 2,  interval: 'major second',  consonance: 0.55, color: '#7fd3f0' },
  { name: 'Square',      glyph: '□', angle: 90,  orb: 7, semitones: 3,  interval: 'minor third',   consonance: 0.35, color: '#ff7a4d' },
  { name: 'Trine',       glyph: '△', angle: 120, orb: 7, semitones: 4,  interval: 'major third',   consonance: 0.9,  color: '#8fbf6a' },
  { name: 'Quincunx',    glyph: '⋔', angle: 150, orb: 3, semitones: 5,  interval: 'perfect fourth',consonance: 0.5,  color: '#8d8fae' },
  { name: 'Opposition',  glyph: '☍', angle: 180, orb: 8, semitones: 6,  interval: 'tritone',       consonance: 0.15, color: '#e0567c' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const norm360 = (d) => ((d % 360) + 360) % 360;

/** Shortest angular separation between two longitudes, 0..180. */
export function separation(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

export const signIndexOf = (lon) => Math.floor(norm360(lon) / 30) % 12;
export const degreeInSign = (lon) => norm360(lon) % 30;

/** "14°22' Aries" */
export function formatLongitude(lon, { glyph = false } = {}) {
  const idx = signIndexOf(lon);
  const deg = degreeInSign(lon);
  const d = Math.floor(deg);
  const m = Math.floor((deg - d) * 60);
  const sign = SIGNS[idx];
  const label = glyph ? sign.glyph : sign.name;
  return `${d}°${String(m).padStart(2, '0')}' ${label}`;
}

/** Whole-sign house for a longitude, given the rising sign index. */
export function wholeSignHouse(lon, ascSignIndex) {
  return ((signIndexOf(lon) - ascSignIndex + 12) % 12) + 1;
}

/** Which house a longitude falls in, given 12 cusp longitudes. */
export function houseFromCusps(lon, cusps) {
  const L = norm360(lon);
  for (let i = 0; i < 12; i++) {
    const start = norm360(cusps[i]);
    const end = norm360(cusps[(i + 1) % 12]);
    const span = norm360(end - start);
    if (norm360(L - start) < span) return i + 1;
  }
  return 1;
}

/** Find the aspect (if any) between two longitudes. */
export function aspectBetween(lonA, lonB) {
  const sep = separation(lonA, lonB);
  for (const aspect of ASPECTS) {
    const delta = Math.abs(sep - aspect.angle);
    if (delta <= aspect.orb) {
      return { ...aspect, exactness: 1 - delta / aspect.orb, orbDelta: delta, separation: sep };
    }
  }
  return null;
}
