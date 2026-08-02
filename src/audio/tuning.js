/**
 * Longitude to frequency.
 *
 * The zodiac is a chromatic octave: the centre of Aries is A, and every 30
 * degrees is one semitone. That makes the mapping continuous, so a planet at
 * 14 degrees 22 minutes of Aries is not "an A" but an A just below centre.
 * Equal
 * temperament preserves that continuity; the historical temperaments quantise
 * to the sign, which is a different and audible claim about what a sign is.
 */

export const TEMPERAMENTS = {
  equal: {
    name: 'Equal',
    continuous: true,
    blurb: 'Twelve equal-tempered sign tones. Enable Microtonal pitch for degree-by-degree glide.',
  },
  just: {
    name: 'Just',
    continuous: false,
    blurb: '5-limit ratios on Aries. Signs lock to pure intervals; degrees round off.',
    ratios: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
  },
  pythagorean: {
    name: 'Pythagorean',
    continuous: false,
    blurb: 'Stacked pure fifths from Aries. Wide thirds, singing fifths.',
    ratios: [
      1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3,
      729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128,
    ],
  },
};

const norm360 = (d) => ((d % 360) + 360) % 360;
const SIGN_CENTRE = 15;

/**
 * @param {number} longitude ecliptic longitude in degrees, Aries 0 == A
 * @param {object} opts
 * @param {number} opts.octave   octave transposition, 0 == the A above middle C
 * @param {number} opts.refA     reference pitch for A, Hz
 * @param {string} opts.temperament key of TEMPERAMENTS
 * @param {boolean} opts.microtones whether equal temperament glides within signs
 */
export function frequencyFor(longitude, {
  octave = 0, refA = 432, temperament = 'equal', microtones = true,
} = {}) {
  const lon = norm360(longitude);
  const t = TEMPERAMENTS[temperament] ?? TEMPERAMENTS.equal;
  const base = refA * 2 ** octave;
  // Equal temperament can be heard two ways: continuously across the full
  // wheel, with each sign's named note at its centre, or as twelve exact
  // pitches that hold until a sign cusp.
  if (t.continuous && !microtones) {
    const signIndex = Math.floor(lon / 30) % 12;
    return base * 2 ** (signIndex / 12);
  }
  if (t.continuous) return base * 2 ** ((lon - SIGN_CENTRE) / 360);
  const signIndex = Math.floor(lon / 30) % 12;
  return base * t.ratios[signIndex];
}

/** Cents away from the nearest equal-tempered semitone. */
export function centsOffset(longitude) {
  const semis = (norm360(longitude) - SIGN_CENTRE) / 30;
  const frac = semis - Math.round(semis);
  return frac * 100;
}

/** Pretty name for the nearest note, e.g. "A+29c". */
export function pitchLabel(longitude) {
  const NAMES = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];
  const semis = (norm360(longitude) - SIGN_CENTRE) / 30;
  const nearest = Math.round(semis) % 12;
  const cents = centsOffset(longitude);
  const sign = cents >= 0 ? '+' : '−';
  return `${NAMES[nearest]}${Math.abs(cents) < 0.5 ? '' : ` ${sign}${Math.abs(cents).toFixed(0)}c`}`;
}
