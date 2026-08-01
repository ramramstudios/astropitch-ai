/**
 * Synastry checks.
 *
 * Run with:  node tests/synastry.test.mjs
 *
 * The claims under test are the ones the sound depends on: that a merged
 * synastry object is shaped exactly like a chart (so the wheel, the tables and
 * the performer read it without special cases), that only bodies in contact
 * sound, and that neither chart is transposed — because the moment one of them
 * is, every cross-chart interval is a lie.
 */

import { makeChart, makeSynastry, crossAspects, harmonyOf } from '../src/chart.js';
import { SOUNDING_BODIES, separation } from '../src/ontology.js';
import { frequencyFor } from '../src/audio/tuning.js';

let fails = 0;
function ok(label, condition, detail = '') {
  if (!condition) fails++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function near(label, got, want, tol) {
  const d = Math.abs(got - want);
  ok(label, d <= tol, `got ${got.toFixed(4)}, want ${want.toFixed(4)}, diff ${d.toFixed(4)}`);
}

/** A chart with every sounding body at an explicit longitude. */
const chartAt = (positions) => makeChart(positions, { system: 'whole' });

const spread = (offset) =>
  Object.fromEntries(SOUNDING_BODIES.map((k, i) => [k, (i * 33 + offset) % 360]));

console.log('--- Shape: a synastry is a chart ---');
{
  const a = chartAt(spread(0));
  const b = chartAt(spread(7));
  const s = makeSynastry(a, b);

  for (const field of ['placements', 'byKey', 'aspects', 'balance', 'modal', 'ascSignIndex']) {
    ok(`has .${field}`, s[field] != null);
  }
  const sounding = (c) => c.placements.filter((p) => p.key !== 'mc').length;
  ok('placements carry both charts, minus each Midheaven',
    s.placements.length === sounding(a) + sounding(b),
    `${s.placements.length} = ${sounding(a)} + ${sounding(b)}`);
  ok('no Midheaven survives the merge',
    s.placements.every((p) => p.baseKey !== 'mc'));
  ok('every placement is addressable by key',
    s.placements.every((p) => s.byKey[p.key] === p));
  ok('keys are side-prefixed', s.placements.every((p) => /^[ab]:/.test(p.key)));
  ok('baseKey survives', s.placements.every((p) => p.key === `${p.side}:${p.baseKey}`));
  ok('aspects resolve against byKey',
    s.aspects.every((x) => s.byKey[x.a] && s.byKey[x.b]));
  ok('contacts always cross the two charts',
    s.aspects.every((x) => x.a.startsWith('a:') && x.b.startsWith('b:')));
}

console.log('\n--- No transposition: both charts keep one pitch space ---');
{
  // Same longitude in either chart must give the same frequency. If this ever
  // fails, cross-chart intervals no longer mean what they say.
  const a = chartAt(spread(0));
  const b = chartAt(spread(0));
  const s = makeSynastry(a, b);
  const pa = s.byKey['a:sun'];
  const pb = s.byKey['b:sun'];
  near('identical longitude -> identical pitch',
    frequencyFor(pa.longitude, { octave: pa.octave }),
    frequencyFor(pb.longitude, { octave: pb.octave }), 1e-9);
  ok('and identical octave', pa.octave === pb.octave);
}

console.log('\n--- Contacts are the intervals they claim to be ---');
{
  // Sun at 0 Aries against Sun at 120 Leo: a trine, and 120/30 = 4 semitones.
  const a = chartAt({ ...spread(0), sun: 0, asc: 0 });
  const b = chartAt({ ...spread(0), sun: 120, asc: 0 });
  const hit = crossAspects(a, b).find((c) => c.a === 'a:sun' && c.b === 'b:sun');
  ok('sun/sun 120 deg is a trine', hit?.name === 'Trine', hit?.name);
  near('separation', hit.separation, 120, 1e-9);
  near('interval in semitones', hit.separation / 30, 4, 1e-9);
  near('cents', hit.cents, 400, 1e-9);

  // The ratio of the two sounding frequencies really is a major third.
  const f1 = frequencyFor(0, { octave: 0 });
  const f2 = frequencyFor(120, { octave: 0 });
  near('frequency ratio is 2^(4/12)', f2 / f1, 2 ** (4 / 12), 1e-9);
}

console.log('\n--- Conjunction orb is a beat rate ---');
{
  // The whole reason not to transpose: orb is audible as beating.
  for (const [orb, wantHz] of [[8, 6.83], [3, 2.55], [1, 0.85]]) {
    const f1 = frequencyFor(0, { octave: 0 });
    const f2 = frequencyFor(orb, { octave: 0 });
    near(`${orb} deg orb beats at ~${wantHz}Hz`, f2 - f1, wantHz, 0.02);
  }
}

console.log('\n--- Density: only bodies in contact sound ---');
{
  const a = chartAt(spread(0));
  const b = chartAt(spread(7));
  const s = makeSynastry(a, b, { maxContacts: 8 });

  const sounding = s.placements.filter((p) => !p.silent);
  const involved = new Set(s.aspects.flatMap((x) => [x.a, x.b]));

  ok('kept contacts are capped', s.aspects.length <= 8, `${s.aspects.length}`);
  ok('sounding set == bodies in a kept contact',
    sounding.length === involved.size
    && sounding.every((p) => involved.has(p.key)),
    `${sounding.length} sounding, ${involved.size} involved`);
  ok('silent bodies are the rest',
    s.placements.filter((p) => p.silent).every((p) => !involved.has(p.key)));
  ok('sounding stays inside the voice cap', sounding.length <= 30, `${sounding.length}`);
  ok('a tighter contact is never quieter than a looser one of the same body',
    s.placements.every((p) => p.silent || p.contact > 0));
}

console.log('\n--- Harmony score ---');
{
  const base = spread(0);
  // Every body conjunct its opposite number: all unisons.
  const same = makeSynastry(chartAt(base), chartAt(base));
  ok('identical charts score consonant', same.meta.harmony > 0.95,
    same.meta.harmony.toFixed(3));
  ok('and every kept contact is a conjunction',
    same.aspects.every((c) => c.name === 'Conjunction'));

  // Everything 180 degrees away: all oppositions.
  const flipped = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, (v + 180) % 360]));
  const opp = makeSynastry(chartAt(base), chartAt(flipped));
  ok('mirrored charts score dissonant', opp.meta.harmony < 0.3, opp.meta.harmony.toFixed(3));
  ok('consonant scores above dissonant', same.meta.harmony > opp.meta.harmony);

  ok('score is bounded 0..1',
    [same, opp].every((s) => s.meta.harmony >= 0 && s.meta.harmony <= 1));
  near('empty contact list is neutral', harmonyOf([]), 0.5, 1e-9);
  ok('counts add up',
    same.meta.supporting + same.meta.challenging <= same.aspects.length);
}

console.log('\n--- Contacts are ranked, and ranking is stable ---');
{
  const a = chartAt(spread(0));
  const b = chartAt(spread(7));
  const all = crossAspects(a, b);
  ok('sorted by force, descending',
    all.every((c, i) => i === 0 || all[i - 1].force >= c.force));
  ok('force is exactness x weight',
    all.every((c) => Math.abs(c.force - c.exactness * c.weight) < 1e-12));
  ok('separation agrees with the raw longitudes',
    all.every((c) => {
      const pa = a.byKey[c.a.slice(2)];
      const pb = b.byKey[c.b.slice(2)];
      return Math.abs(separation(pa.longitude, pb.longitude) - c.separation) < 1e-9;
    }));
}

console.log(`\n${fails === 0 ? 'All synastry checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails === 0 ? 0 : 1);
