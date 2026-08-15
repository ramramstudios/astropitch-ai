/**
 * A small, dependency-free ephemeris.
 *
 * Accurate enough for astrology (sub-degree for every body), not for navigation.
 * Sources:
 *   - Sun:     Meeus, "Astronomical Algorithms" 2nd ed., ch. 25 (low accuracy)
 *   - Moon:    Meeus ch. 47, full periodic-term table for longitude
 *   - Planets: JPL "Keplerian Elements for Approximate Positions of the Major
 *              Planets", valid 1800-2050 (~0.5 degree worst case for Pluto)
 *   - Houses:  Placidus by semi-arc division, with whole-sign and equal as
 *              alternatives and Porphyry as the polar fallback.
 *
 * All longitudes are returned as tropical (equinox of date) geocentric ecliptic
 * longitude in degrees, which is what astrology uses.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);
const tan = (d) => Math.tan(d * DEG);
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) * RAD;
const atan2 = (y, x) => Math.atan2(y, x) * RAD;

export const norm360 = (d) => ((d % 360) + 360) % 360;
const norm180 = (d) => {
  const x = norm360(d);
  return x > 180 ? x - 360 : x;
};

/**
 * Julian Day from a UTC calendar date. Month is 1-12. `day` may be fractional.
 * Meeus ch. 7.
 */
export function julianDay(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  // Gregorian calendar only; AstroPitch does not need Julian-calendar dates.
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

/**
 * Julian Day for a local birth moment.
 * @param {object} b - { year, month, day, hour, minute, utcOffset } where
 *   utcOffset is hours east of Greenwich (e.g. -5 for US Eastern Standard Time).
 */
export function julianDayFromBirth({ year, month, day, hour = 0, minute = 0, utcOffset = 0 }) {
  const dayFraction = (hour + minute / 60 - utcOffset) / 24;
  return julianDay(year, month, day + dayFraction);
}

export const centuriesSinceJ2000 = (jd) => (jd - 2451545.0) / 36525;

/**
 * Approximate TT - UT1 in seconds (Espenak & Meeus polynomials, abridged).
 * Matters only for the Moon, which moves ~0.5 arcmin per minute of time.
 */
export function deltaT(year) {
  if (year >= 2005 && year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (year >= 1986 && year < 2005) {
    const t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t * t * t
      + 0.000651814 * t * t * t * t + 0.00002373599 * t * t * t * t * t;
  }
  if (year >= 1961 && year < 1986) {
    const t = year - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718;
  }
  if (year >= 1941 && year < 1961) {
    const t = year - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + (t * t * t) / 2547;
  }
  if (year >= 1920 && year < 1941) {
    const t = year - 1920;
    return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t * t * t;
  }
  if (year >= 1900 && year < 1920) {
    const t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t * t * t - 0.000197 * t * t * t * t;
  }
  if (year >= 2050) return 62.92 + 0.32217 * 50 + 0.005589 * 2500;
  return 0;
}

/** Mean obliquity of the ecliptic, degrees. Meeus 22.2. */
export function obliquity(T) {
  return 23.43929111
    - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
}

/** Greenwich mean sidereal time in degrees. Meeus 12.4. */
export function greenwichMeanSiderealTime(jd) {
  const T = centuriesSinceJ2000(jd);
  return norm360(
    280.46061837
      + 360.98564736629 * (jd - 2451545.0)
      + 0.000387933 * T * T
      - (T * T * T) / 38710000
  );
}

export function sunLongitude(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const trueLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  // Apparent longitude: nutation in longitude + aberration.
  return norm360(trueLon - 0.00569 - 0.00478 * sin(omega));
}

// [D, M, M', F, coefficient in 1e-6 degrees]
const MOON_TERMS = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665],
  [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236], [0, 1, 2, 0, -2120],
  [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110],
  [3, 0, -1, 0, -892], [2, 1, 1, 0, -810], [4, -1, -2, 0, 759],
  [0, 2, -1, 0, -713], [2, 2, -1, 0, -700], [2, 1, -2, 0, 691],
  [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
  [4, -1, 0, 0, 520], [1, 0, -2, 0, -487], [2, 1, 0, -2, -399],
  [0, 0, 2, -2, -381], [1, 1, 1, 0, 351], [3, 0, -2, 0, -340],
  [4, 0, -3, 0, 330], [2, -1, 2, 0, 327], [0, 2, 1, 0, -323],
  [1, 1, -1, 0, 299], [2, 0, 3, 0, 294],
];

export function moonLongitude(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
    + (T ** 3) / 538841 - (T ** 4) / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
    + (T ** 3) / 545868 - (T ** 4) / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + (T ** 3) / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
    + (T ** 3) / 69699 - (T ** 4) / 14712000;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
    - (T ** 3) / 3526000 + (T ** 4) / 863310000;

  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.290 * T;

  // Eccentricity correction on terms involving the Sun's mean anomaly.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sumL = 0;
  for (const [d, m, mp, f, coeff] of MOON_TERMS) {
    const arg = d * D + m * M + mp * Mp + f * F;
    let c = coeff;
    if (m === 1 || m === -1) c *= E;
    else if (m === 2 || m === -2) c *= E * E;
    sumL += c * sin(arg);
  }

  // Additive terms from Venus, Jupiter and the flattening of the Earth.
  sumL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);

  return norm360(Lp + sumL / 1e6);
}

// [a (au), e, I (deg), L (deg), longPeri (deg), longNode (deg)] and per-century rates.
const PLANET_ELEMENTS = {
  mercury: {
    el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  venus: {
    el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  },
  earth: {
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  mars: {
    el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  jupiter: {
    el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  uranus: {
    el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  neptune: {
    el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
  pluto: {
    el: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    rate: [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  },
};

function solveKepler(M, e) {
  const Mdeg = norm180(M);
  const eStar = RAD * e; // e expressed in degrees, per the JPL cookbook
  let E = Mdeg + eStar * sin(Mdeg);
  for (let i = 0; i < 40; i++) {
    const dM = Mdeg - (E - eStar * sin(E));
    const dE = dM / (1 - e * cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

function heliocentric(name, T) {
  const { el, rate } = PLANET_ELEMENTS[name];
  const a = el[0] + rate[0] * T;
  const e = el[1] + rate[1] * T;
  const I = el[2] + rate[2] * T;
  const L = el[3] + rate[3] * T;
  const peri = el[4] + rate[4] * T;
  const node = el[5] + rate[5] * T;

  const argPeri = peri - node;
  const M = L - peri;
  const E = solveKepler(M, e);

  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);

  const cw = cos(argPeri);
  const sw = sin(argPeri);
  const cn = cos(node);
  const sn = sin(node);
  const ci = cos(I);
  const si = sin(I);

  return {
    x: (cw * cn - sw * sn * ci) * xv + (-sw * cn - cw * sn * ci) * yv,
    y: (cw * sn + sw * cn * ci) * xv + (-sw * sn + cw * cn * ci) * yv,
    z: sw * si * xv + cw * si * yv,
  };
}

function precession(T) {
  return (5029.0966 * T + 1.11113 * T * T) / 3600;
}

export function planetLongitude(name, T) {
  const p = heliocentric(name, T);
  const earth = heliocentric('earth', T);
  const x = p.x - earth.x;
  const y = p.y - earth.y;
  return norm360(atan2(y, x) + precession(T));
}

/**
 * Ascendant and Midheaven.
 * @param {number} jd  Julian Day (UT)
 * @param {number} lat geographic latitude, degrees north
 * @param {number} lon geographic longitude, degrees east
 */
export function angles(jd, lat, lon) {
  const T = centuriesSinceJ2000(jd);
  const eps = obliquity(T);
  const ramc = norm360(greenwichMeanSiderealTime(jd) + lon);

  let mc = norm360(atan2(sin(ramc), cos(ramc) * cos(eps)));
  // The Midheaven shares a right ascension with the meridian, so it must stay
  // in the same half of the sky; atan2 alone can land on the IC.
  if (Math.abs(norm180(mc - ramc)) > 90) mc = norm360(mc + 180);

  const asc = norm360(
    atan2(cos(ramc), -(sin(ramc) * cos(eps) + tan(lat) * sin(eps)))
  );

  return { asc, mc, ramc, obliquity: eps };
}

function eclipticFromRA(ra, eps) {
  let lambda = norm360(atan2(sin(ra), cos(ra) * cos(eps)));
  if (Math.abs(norm180(lambda - ra)) > 90) lambda = norm360(lambda + 180);
  return lambda;
}

/**
 * One Placidus intermediate cusp, found by iterating on the cusp's own
 * ascensional difference. `base` is the equatorial offset from the RAMC at
 * zero declination (30, 60, 120, 150) and `f` the fraction of the semi-arc.
 */
function placidusCusp(ramc, lat, eps, base, f) {
  let ad = 0;
  let lambda = eclipticFromRA(norm360(ramc + base), eps);
  for (let i = 0; i < 60; i++) {
    const ra = norm360(ramc + base + f * ad);
    lambda = eclipticFromRA(ra, eps);
    const decl = asin(sin(eps) * sin(lambda));
    const s = tan(lat) * tan(decl);
    if (Math.abs(s) >= 1) return null; // circumpolar: no Placidus solution
    const next = asin(s);
    if (Math.abs(next - ad) < 1e-9) {
      ad = next;
      break;
    }
    ad = next;
  }
  return eclipticFromRA(norm360(ramc + base + f * ad), eps);
}

function porphyryCusps(asc, mc) {
  const q1 = norm360(asc - mc); // MC -> Asc, the 10th/11th/12th quadrant
  const q2 = norm360(mc + 180 - asc);
  return [
    asc,
    norm360(asc + q2 / 3),
    norm360(asc + (2 * q2) / 3),
    norm360(mc + 180),
    norm360(mc + 180 + q1 / 3),
    norm360(mc + 180 + (2 * q1) / 3),
    norm360(asc + 180),
    norm360(asc + 180 + q2 / 3),
    norm360(asc + 180 + (2 * q2) / 3),
    mc,
    norm360(mc + q1 / 3),
    norm360(mc + (2 * q1) / 3),
  ];
}

export const HOUSE_SYSTEMS = ['placidus', 'whole', 'equal'];

/**
 * The twelve house cusps, index 0 == 1st house.
 * @returns {{cusps: number[], system: string}} `system` reports what was
 *   actually used, which may differ from the request at extreme latitudes.
 */
export function houseCusps(system, { asc, mc, ramc, obliquity: eps }, lat) {
  if (system === 'whole') {
    const start = Math.floor(norm360(asc) / 30) * 30;
    return { cusps: Array.from({ length: 12 }, (_, i) => norm360(start + i * 30)), system: 'whole' };
  }
  if (system === 'equal') {
    return { cusps: Array.from({ length: 12 }, (_, i) => norm360(asc + i * 30)), system: 'equal' };
  }

  const c11 = placidusCusp(ramc, lat, eps, 30, 1 / 3);
  const c12 = placidusCusp(ramc, lat, eps, 60, 2 / 3);
  const c2 = placidusCusp(ramc, lat, eps, 120, 2 / 3);
  const c3 = placidusCusp(ramc, lat, eps, 150, 1 / 3);
  if (c11 == null || c12 == null || c2 == null || c3 == null) {
    return { cusps: porphyryCusps(asc, mc), system: 'porphyry' };
  }
  return {
    cusps: [
      asc, c2, c3,
      norm360(mc + 180), norm360(c11 + 180), norm360(c12 + 180),
      norm360(asc + 180), norm360(c2 + 180), norm360(c3 + 180),
      mc, c11, c12,
    ],
    system: 'placidus',
  };
}

const PLANET_KEYS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

/**
 * Every longitude AstroPitch needs for one moment and place.
 * @returns {{positions: Record<string, number>, angles: object, cusps: number[], system: string}}
 */
export function computeSky(birth, { latitude = 0, longitude = 0, houseSystem = 'whole' } = {}) {
  const jd = julianDayFromBirth(birth);
  // Planetary theories are functions of Terrestrial Time; sidereal time is UT.
  const T = centuriesSinceJ2000(jd + deltaT(birth.year) / 86400);

  const positions = { sun: sunLongitude(T), moon: moonLongitude(T) };
  for (const key of PLANET_KEYS) positions[key] = planetLongitude(key, T);

  const ang = angles(jd, latitude, longitude);
  const { cusps, system } = houseCusps(houseSystem, ang, latitude);

  positions.asc = ang.asc;
  positions.mc = ang.mc;

  return { jd, positions, angles: ang, cusps, system };
}

/**
 * Retrograde test: sample the longitude a day either side. Cheap and reliable
 * for anything slower than the Moon.
 */
export function isRetrograde(key, T) {
  if (key === 'sun' || key === 'moon' || key === 'asc' || key === 'mc') return false;
  const dT = 1 / 36525; // one day
  const before = planetLongitude(key, T - dT);
  const after = planetLongitude(key, T + dT);
  return norm180(after - before) < 0;
}
