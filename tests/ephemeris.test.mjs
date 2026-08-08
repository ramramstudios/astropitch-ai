/**
 * Ephemeris checks against published reference values.
 *
 * Run with:  node tests/ephemeris.test.mjs
 *
 * Reference data comes from Meeus, "Astronomical Algorithms" 2nd ed. (the
 * worked examples are given to more digits than we need) and from JPL Horizons
 * for the planets.
 */

import {
  julianDay, centuriesSinceJ2000, sunLongitude, moonLongitude, planetLongitude,
  angles, houseCusps, computeSky, obliquity, greenwichMeanSiderealTime,
} from '../src/ephemeris.js';

let fails = 0;
function check(label, got, want, tol, unit = 'deg') {
  const d = Math.abs(got - want);
  const ok = d <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(42)} got ${got.toFixed(5)}  want ${want.toFixed(5)}  diff ${d.toFixed(5)} ${unit} (tol ${tol})`);
}

console.log('--- Julian Day (Meeus ch.7 examples) ---');
check('1957 Oct 4.81 (Sputnik)', julianDay(1957, 10, 4.81), 2436116.31, 1e-6, 'd');
check('2000 Jan 1.5', julianDay(2000, 1, 1.5), 2451545.0, 1e-6, 'd');
check('1987 Jan 27.0', julianDay(1987, 1, 27.0), 2446822.5, 1e-6, 'd');
check('1988 Jun 19.5', julianDay(1988, 6, 19.5), 2447332.0, 1e-6, 'd');

console.log('\n--- Obliquity (Meeus example 22.a: 1987 Apr 10) ---');
check('eps mean', obliquity(centuriesSinceJ2000(julianDay(1987, 4, 10.0))), 23.44094629, 1e-5);

console.log('\n--- GMST (Meeus example 12.a: 1987 Apr 10, 0h UT) ---');
check('GMST deg', greenwichMeanSiderealTime(julianDay(1987, 4, 10.0)), 197.693195, 1e-4);

console.log('\n--- Sun ---');
// Meeus example 25.b gives apparent longitude 199.90988 for 1992 Oct 13.0 TD.
check('1992 Oct 13.0 apparent lon', sunLongitude(centuriesSinceJ2000(julianDay(1992, 10, 13.0))), 199.90988, 0.001);
// Apparent longitude of the Sun at J2000.0
check('J2000.0 apparent lon', sunLongitude(0), 280.3724, 0.002);

console.log('\n--- Moon (Meeus example 47.a: 1992 Apr 12.0 TD) ---');
check('lon', moonLongitude(centuriesSinceJ2000(julianDay(1992, 4, 12.0))), 133.162655, 0.002);

console.log('\n--- Planets vs JPL Horizons geocentric ecliptic-of-date lon, 2000-01-01 00:00 TT ---');
{
  const T = centuriesSinceJ2000(julianDay(2000, 1, 1.0));
  // Reference values, apparent geocentric ecliptic longitude of date (deg).
  const want = {
    mercury: 271.1, venus: 241.0, mars: 327.9, jupiter: 25.2,
    saturn: 40.4, uranus: 314.8, neptune: 303.2, pluto: 251.4,
  };
  for (const [k, v] of Object.entries(want)) {
    check(k, planetLongitude(k, T), v, 1.0);
  }
}

console.log('\n--- Angles: 0h sidereal at the equator ---');
{
  // RAMC = 0 => MC at 0 Aries, Asc at 0 Cancer (90 deg) for lat 0.
  const jd = julianDay(2000, 1, 1.0);
  const gmst = greenwichMeanSiderealTime(jd);
  const a = angles(jd, 0, -gmst); // choose a longitude that makes RAMC 0
  check('RAMC', a.ramc, 0, 1e-6);
  check('MC', a.mc, 0, 1e-6);
  check('Asc', a.asc, 90, 1e-6);
}
{
  // RAMC = 90 at the equator => MC 90 (0 Cancer), Asc 180 (0 Libra)
  const jd = julianDay(2000, 1, 1.0);
  const gmst = greenwichMeanSiderealTime(jd);
  const a = angles(jd, 0, 90 - gmst);
  check('RAMC=90 -> MC', a.mc, 90, 1e-6);
  check('RAMC=90 -> Asc', a.asc, 180, 1e-6);
}
{
  // MC must stay near the RAMC's half of the sky, not flip to the IC.
  const jd = julianDay(2000, 1, 1.0);
  const gmst = greenwichMeanSiderealTime(jd);
  for (const ramcWant of [0, 45, 100, 179, 181, 260, 300, 359]) {
    const a = angles(jd, 40, ramcWant - gmst);
    const diff = Math.abs(((a.mc - ramcWant + 540) % 360) - 180);
    if (diff > 90) { console.log(`FAIL  MC flipped for RAMC=${ramcWant}: mc=${a.mc.toFixed(2)}`); fails++; }
  }
  console.log('PASS  MC never flips to the IC across the circle');
}

console.log('\n--- Placidus sanity ---');
{
  const jd = julianDay(2000, 1, 1.0);
  const gmst = greenwichMeanSiderealTime(jd);
  // At the equator all declinations give AD = 0, so Placidus degenerates to
  // equal 30-degree steps in right ascension.
  const a = angles(jd, 0, -gmst);
  const { cusps, system } = houseCusps('placidus', a, 0);
  console.log('  equator cusps:', cusps.map((c) => c.toFixed(2)).join(', '), `[${system}]`);
  check('cusp1 == asc', cusps[0], a.asc, 1e-6);
  check('cusp10 == mc', cusps[9], a.mc, 1e-6);

  // Mid latitude: cusps must advance monotonically around the circle.
  const b = angles(jd, 51.5, 0);
  const r = houseCusps('placidus', b, 51.5);
  console.log('  london cusps:', r.cusps.map((c) => c.toFixed(2)).join(', '), `[${r.system}]`);
  let mono = true;
  for (let i = 0; i < 12; i++) {
    const span = ((r.cusps[(i + 1) % 12] - r.cusps[i]) % 360 + 360) % 360;
    if (span <= 0 || span >= 180) mono = false;
  }
  console.log(`  ${mono ? 'PASS' : 'FAIL'}  cusps advance monotonically`);
  if (!mono) fails++;

  // Polar fallback
  const c = angles(jd, 78, 15);
  const rp = houseCusps('placidus', c, 78);
  console.log(`  ${rp.system === 'porphyry' ? 'PASS' : 'FAIL'}  lat 78 falls back to ${rp.system}`);
  if (rp.system !== 'porphyry') fails++;
}

console.log('\n--- Real chart: Bob Dylan, 1941-05-24 21:05 CST, Duluth ---');
{
  // Birth record: 1941-05-24 at 21:05 CST in Duluth, MN (46.78, -92.10).
  // The Sun should be in Gemini.
  const sky = computeSky(
    { year: 1941, month: 5, day: 24, hour: 21, minute: 5, utcOffset: -6 },
    { latitude: 46.78, longitude: -92.10, houseSystem: 'whole' }
  );
  const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
  const fmt = (l) => `${(l % 30).toFixed(2)}° ${SIGNS[Math.floor(l / 30)]}`;
  for (const [k, v] of Object.entries(sky.positions)) console.log(`  ${k.padEnd(8)} ${fmt(v)}`);
  const sunSign = SIGNS[Math.floor(sky.positions.sun / 30)];
  const moonSign = SIGNS[Math.floor(sky.positions.moon / 30)];
  const ascSign = SIGNS[Math.floor(sky.positions.asc / 30)];
  console.log(`  ${sunSign === 'Gemini' ? 'PASS' : 'FAIL'}  Sun in Gemini (Bob Dylan)`);
  console.log(`  ${moonSign === 'Taurus' ? 'PASS' : 'FAIL'}  Moon in Taurus (Bob Dylan)`);
  console.log(`  ${ascSign === 'Sagittarius' ? 'PASS' : 'FAIL'}  Asc in Sagittarius (Bob Dylan)`);
  if (sunSign !== 'Gemini') fails++;
  if (moonSign !== 'Taurus') fails++;
  if (ascSign !== 'Sagittarius') fails++;
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
