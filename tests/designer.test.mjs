/**
 * Designer checks.
 *
 * Run with:  node tests/designer.test.mjs
 *
 * The claim the whole feature rests on is that a designed chart is an ordinary
 * chart. If it is, the wheel, the tables and the performer need no special case
 * for it, and the only new things worth pinning are that a moved body carries
 * all of its derived data with it, that a body switched off stops counting for
 * anything you can hear, and that moving the Ascendant turns the houses.
 */

import { makeChart, chartFromSigns, designChart, DESIGNABLE_BODIES } from '../src/chart.js';
import { Performer } from '../src/audio/performer.js';
import { SOUNDING_BODIES, SIGNS, signIndexOf, separation } from '../src/ontology.js';
import { frequencyFor } from '../src/audio/tuning.js';

let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const chartAt = (positions, system = 'whole') => {
  const asc = positions.asc ?? 0;
  const start = system === 'whole' ? signIndexOf(asc) * 30 : asc;
  return makeChart(positions, {
    cusps: Array.from({ length: 12 }, (_, i) => (start + i * 30) % 360),
    system,
  });
};

const spread = (off) => Object.fromEntries(
  [...SOUNDING_BODIES, 'mc'].map((k, i) => [k, (i * 33 + off) % 360])
);

const base = chartAt(spread(0));

console.log('--- shape: a designed chart is an ordinary chart ---');
{
  const designed = designChart(base, { mars: { longitude: 200 } });
  ok('keys match a cast chart',
    JSON.stringify(Object.keys(base).sort()) === JSON.stringify(Object.keys(designed).sort()),
    Object.keys(designed).sort().join(', '));
  ok('every body survives', designed.placements.length === base.placements.length);
  ok('placement fields match a cast one',
    JSON.stringify(Object.keys(base.byKey.venus).sort())
      === JSON.stringify(Object.keys(designed.byKey.venus).sort()));
  ok('marked as designed', designed.meta.designer === true);
  ok('an empty design is the chart it started from',
    designChart(base, {}).placements.every((p, i) => p.longitude === base.placements[i].longitude));
}

console.log('--- sign-only charts can leave bodies unknown ---');
{
  const partial = chartFromSigns({ asc: null, sun: 0, moon: null, venus: 6 });
  ok('only known bodies are placed',
    JSON.stringify(partial.placements.map((p) => p.key)) === JSON.stringify(['sun', 'venus']),
    partial.placements.map((p) => p.key).join(', '));
  ok('an unknown Ascendant does not become Aries', !partial.byKey.asc);
  ok('unknown Ascendant keeps the house ring on Aries', partial.cusps[0] === 0);
}

console.log('--- moving a body rebuilds everything derived from it ---');
{
  // 14°30\' Scorpio: fixed water, in the 3rd house from an Ascendant in Aries.
  const designed = designChart(base, { mars: { longitude: 224.5 } });
  const p = designed.byKey.mars;
  const sign = SIGNS[7];

  ok('longitude taken', p.longitude === 224.5);
  ok('sign follows', p.sign.name === 'Scorpio', p.sign.name);
  ok('degree in sign follows', Math.abs(p.degree - 14.5) < 1e-9, String(p.degree));
  ok('label follows', p.label === "14°30' Scorpio", p.label);
  ok('element follows', p.element === sign.element, p.element);
  ok('modality follows', p.modality === sign.modality, p.modality);
  ok('house follows', p.house === 8, String(p.house));
  ok('pitch follows the exact degree from the centre of its sign',
    p.pitch === 'E −2c' && Math.abs(p.cents + 1.667) < 0.01, `${p.pitch} ${p.cents.toFixed(2)}c`);
  ok('the sounded frequency follows the new longitude',
    Math.abs(frequencyFor(p.longitude, { octave: 0, refA: 440, temperament: 'equal' })
      - 440 * 2 ** ((224.5 - 15) / 360)) < 1e-9);

  // Register, weight and role belong to the body, not to where it sits.
  ok('octave, gain and role are untouched',
    p.octave === base.byKey.mars.octave
    && p.gain === base.byKey.mars.gain
    && p.role === base.byKey.mars.role
    && p.glyph === base.byKey.mars.glyph);
}

console.log('--- the source chart is never touched ---');
{
  const before = JSON.stringify(base.placements.map((p) => p.longitude));
  designChart(base, { sun: { longitude: 12 }, moon: { enabled: false } });
  ok('longitudes unchanged', JSON.stringify(base.placements.map((p) => p.longitude)) === before);
  ok('only chart angles are silent by default',
    base.placements.every((p) => p.silent === (p.key === 'asc' || p.key === 'mc')));
}

console.log('--- aspects track the moved body, including across the seam ---');
{
  // Sun at 2°, Mars at 358°: four degrees apart the short way round, which is a
  // conjunction. Naive subtraction would call it 356° and find nothing.
  const seam = designChart(chartAt(spread(0)), {
    sun: { longitude: 2 },
    mars: { longitude: 358 },
  });
  const pair = seam.aspects.find((a) => (a.a === 'sun' && a.b === 'mars') || (a.a === 'mars' && a.b === 'sun'));
  ok('finds the conjunction over 0°', pair?.name === 'Conjunction', pair?.name ?? 'none');
  ok('separation is the short way round', Math.abs(pair.separation - 4) < 1e-9, String(pair?.separation));
  ok('orb matches the separation', Math.abs(pair.orbDelta - 4) < 1e-9);
  ok('separation helper agrees', Math.abs(separation(2, 358) - 4) < 1e-9);

  // Walk the same body out of orb and the aspect must go with it. 45° is in no
  // aspect's window: wide of the sextile, short of the square.
  const away = designChart(chartAt(spread(0)), { sun: { longitude: 2 }, mars: { longitude: 47 } });
  ok('drops the aspect once out of orb',
    !away.aspects.some((a) => [a.a, a.b].includes('mars') && [a.a, a.b].includes('sun')));
}

console.log('--- switching a body off takes it out of everything audible ---');
{
  const designed = designChart(base, { jupiter: { enabled: false } });
  const p = designed.byKey.jupiter;

  ok('still listed and still positioned', !!p && p.longitude === base.byKey.jupiter.longitude);
  ok('marked silent', p.silent === true);
  ok('casts no aspects', !designed.aspects.some((a) => a.a === 'jupiter' || a.b === 'jupiter'));
  ok('other aspects survive', designed.aspects.length > 0);
  ok('drops out of the elemental balance',
    designed.balance[p.element] === base.balance[p.element] - 1,
    `${designed.balance[p.element]} vs ${base.balance[p.element]}`);
  ok('drops out of the modal balance',
    designed.modal[p.modality] === base.modal[p.modality] - 1);
  ok('switching it back on restores it',
    designChart(base, { jupiter: { enabled: true } }).byKey.jupiter.silent === false);
}

console.log('--- a silent body is not scheduled ---');
{
  const log = [];
  Performer.prototype._voiceFor = function stub(p, o = {}) {
    log.push(p.key);
    return { release() {}, released: false };
  };

  const designed = designChart(base, { jupiter: { enabled: false }, uranus: { enabled: false } });
  const performer = new Performer({
    now: 0,
    start: async () => {},
    setDelayTime() {},
    activeVoiceCount: () => 0,
  });
  performer.setChart(designed);

  for (const mode of ['bloom', 'sequence']) {
    log.length = 0;
    await performer[mode]();
    performer.stop();
    ok(`${mode} omits the bodies that are off`,
      !log.includes('jupiter') && !log.includes('uranus'), log.join(', '));
    ok(`${mode} still plays every enabled body`,
      new Set(log).size === designed.placements.filter((p) => !p.silent).length, `${new Set(log).size} distinct`);
  }
}

console.log('--- chart angles are opt-in voices ---');
{
  const defaults = chartAt({ ...spread(0), mc: 30 });
  const optedIn = designChart(defaults, { asc: { enabled: true }, mc: { enabled: true } });
  ok('ASC and MC are silent by default', defaults.byKey.asc.silent && defaults.byKey.mc.silent);
  ok('ASC and MC can be enabled together', !optedIn.byKey.asc.silent && !optedIn.byKey.mc.silent);
  ok('enabled angles participate in aspects',
    optedIn.aspects.some((a) => a.a === 'mc' || a.b === 'mc'));
  ok('all four directions are available as separate interaction points',
    ['asc', 'mc', 'dsc', 'ic'].every((key) => defaults.anglePoints[key]));
  const directional = chartAt({ ...spread(0), mc: 30, sun: 180 });
  ok('directional aspects do not depend on angle voices being enabled',
    directional.angleAspects.some((a) => a.a === 'dsc' && a.b === 'sun'));
  const complementary = makeChart({ asc: 0, mc: 0, mercury: 126 });
  ok('IC keeps the complementary MC trine as a sextile',
    complementary.angleAspects.some((a) => a.a === 'mc' && a.b === 'mercury' && a.name === 'Trine')
    && complementary.angleAspects.some((a) => a.a === 'ic' && a.b === 'mercury' && a.name === 'Sextile'));
}

console.log('--- moving the Ascendant turns the house ring with it ---');
{
  // Ascendant from 0° Aries to 5° Taurus. Whole Sign starts the first house at
  // the new rising sign, while Equal preserves the exact angle.
  const designed = designChart(base, { asc: { longitude: 35 } });
  ok('first cusp is the new rising sign', designed.cusps[0] === 30, String(designed.cusps[0]));
  ok('ascSignIndex follows', designed.ascSignIndex === 1);
  ok('the Ascendant is still in the 1st house', designed.byKey.asc.house === 1);
  ok('the Midheaven follows the angle',
    designed.byKey.mc.longitude === (base.byKey.mc.longitude + 35) % 360,
    String(designed.byKey.mc.longitude));

  const moved = designed.placements.filter((p) => p.key !== 'mc' && p.key !== 'asc')
    .some((p) => p.house !== base.byKey[p.key].house);
  ok('bodies are rehoused', moved);

  // Equal houses hang off the exact degree of the angle rather than its sign.
  const equal = designChart(chartAt(spread(0), 'equal'), { asc: { longitude: 35 } });
  ok('equal houses start at the exact angle', equal.cusps[0] === 35, String(equal.cusps[0]));
  ok('equal houses stay 30° apart', equal.cusps.every((c, i) => c === (35 + i * 30) % 360));

  // A quadrant system has no closed form without the birth data behind it, so
  // its unequal spacing is carried round rather than recomputed.
  const quadrant = makeChart(spread(0), {
    cusps: [0, 22, 51, 90, 118, 149, 180, 202, 231, 270, 298, 329],
    system: 'placidus',
  });
  const turned = designChart(quadrant, { asc: { longitude: 40 } });
  ok('quadrant cusps rotate rigidly',
    turned.cusps.every((c, i) => c === (quadrant.cusps[i] + 40) % 360),
    turned.cusps.join(','));
  ok('quadrant spacing is preserved',
    turned.cusps.every((c, i) => {
      const span = (turned.cusps[(i + 1) % 12] - c + 360) % 360;
      const was = (quadrant.cusps[(i + 1) % 12] - quadrant.cusps[i] + 360) % 360;
      return Math.abs(span - was) < 1e-9;
    }));
}

console.log('--- every designable body can be placed and silenced ---');
{
  ok('the eleven sounding bodies are designable',
    DESIGNABLE_BODIES.length === 11 && !DESIGNABLE_BODIES.includes('mc'),
    DESIGNABLE_BODIES.join(', '));

  const design = Object.fromEntries(
    DESIGNABLE_BODIES.map((key, i) => [key, { longitude: i * 7.5 }])
  );
  const designed = designChart(chartFromSigns({ asc: 0 }), design);
  ok('all eleven land where they were put',
    DESIGNABLE_BODIES.every((key, i) => designed.byKey[key].longitude === i * 7.5));

  const allOff = designChart(base, Object.fromEntries(
    DESIGNABLE_BODIES.map((key) => [key, { enabled: false }])
  ));
  ok('a chart with everything off has no aspects', allOff.aspects.length === 0);
  ok('a chart with everything off has an empty balance',
    Object.values(allOff.balance).every((v) => v === 0));
  ok('a chart with everything off still draws every body',
    allOff.placements.length === base.placements.length);
  // The angles still have to mean something, or the wheel has nothing to hang on.
  ok('the house ring survives everything being off', allOff.cusps.length === 12);
}

console.log(fails === 0 ? '\nAll designer checks passed.' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
