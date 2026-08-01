/**
 * Arrangement checks.
 *
 * Run with:  node tests/performer.test.mjs
 *
 * These test what the Performer *schedules*, not what it sounds like — voice
 * construction is stubbed out, so this runs without an AudioContext. The
 * audible behaviour is covered by tests/audio.test.html in a browser.
 *
 * The claim that matters most here is the detune one. Within a chart, bodies
 * that land on nearly the same pitch get nudged apart so they beat instead of
 * cancelling. Across two charts that nudge must never happen, because there the
 * beating is the signal: a cross-chart conjunction beats at a rate set by its
 * orb, and 7 cents of arbitrary detune is worth about 2 degrees of orb.
 */

import { Performer } from '../src/audio/performer.js';
import { makeChart, makeSynastry } from '../src/chart.js';
import { SOUNDING_BODIES } from '../src/ontology.js';

let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const engine = {
  now: 0,
  start: async () => {},
  setDelayTime() {},
  register() {},
  unregister() {},
  ctx: { currentTime: 0, sampleRate: 48000 },
};

// Record what gets scheduled instead of building audio nodes.
const log = [];
Performer.prototype._voiceFor = function stub(p, o = {}) {
  log.push({ key: p.key, time: o.time, detune: o.detune ?? 0 });
  return { release() {}, released: false };
};

const chartAt = (positions) => makeChart(positions, { system: 'whole' });
const spread = (off) => Object.fromEntries(SOUNDING_BODIES.map((k, i) => [k, (i * 33 + off) % 360]));

const A = chartAt(spread(0));
const B = chartAt(spread(7));
const syn = makeSynastry(A, B, { maxContacts: 8 });
const baseOf = (chart, key) => chart.byKey[key].baseKey ?? key;

async function run(chart, mode) {
  log.length = 0;
  const p = new Performer(engine);
  p.setChart(chart);
  await p[mode]();
  const out = log.slice();
  p.stop();
  return out;
}

console.log('--- tempo: BPM controls step length and echo time ---');
{
  const delayTimes = [];
  const p = new Performer({ ...engine, setDelayTime: (seconds) => delayTimes.push(seconds) });
  p.setTempo(120);
  p.setTempo(60);
  ok('120 BPM maps to a half-second beat', delayTimes[0] === 0.5, `${delayTimes[0]}s`);
  ok('60 BPM maps to a one-second beat', delayTimes[1] === 1, `${delayTimes[1]}s`);
}

console.log('\n--- designer audition: one held voice follows the dragged longitude ---');
{
  const retunes = [];
  const releases = [];
  const p = new Performer(engine);
  p.setChart(A);
  p._voiceFor = (placement) => ({
    released: false,
    retune: (opts) => retunes.push(opts),
    release: (at, fade) => releases.push({ at, fade }),
  });

  await p.beginDesignerPreview('venus', 30);
  p.updateDesignerPreview('venus', 120);
  p.endDesignerPreview('venus');

  ok('starts the body being dragged', p.designerPreview === null && retunes.length === 1);
  ok('retunes to its new longitude',
    Math.abs(retunes[0].freq - 440 * 2 ** (120 / 360)) < 1e-9,
    `${retunes[0].freq.toFixed(3)} Hz`);
  ok('updates its wheel-derived pan', Math.abs(retunes[0].pan - Math.sin((120 * Math.PI) / 180) * 0.8) < 1e-9);
  ok('releases on drop', releases.length === 1);
}

console.log('--- bloom: one chart unfolds from the solar centre ---');
{
  const out = await run(A, 'bloom');
  const expectedOrder = ['sun', 'mercury', 'venus', 'moon', 'asc', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  ok('sounds every body', out.length === A.placements.filter((x) => x.key !== 'mc').length, `${out.length}`);
  ok('reveals bodies from Sun outward', out.map((v) => v.key).join(',') === expectedOrder.join(','),
    out.map((v) => v.key).join(', '));
  ok('times strictly increase', out.every((v, i) => i === 0 || v.time > out[i - 1].time));
}

console.log('\n--- bloom: two charts pair like bodies back to back ---');
{
  const out = await run(syn, 'bloom');
  const sounding = syn.placements.filter((p) => !p.silent);
  ok('sounds only bodies in contact', out.length === sounding.length,
    `${out.length} of ${syn.placements.length}`);
  ok('never sounds a silent body', out.every((v) => !syn.byKey[v.key].silent));
  ok('times strictly increase', out.every((v, i) => i === 0 || v.time > out[i - 1].time));

  // Where both charts contribute the same body, the two must land together —
  // that adjacency is what makes the contact audible as an interval.
  const counts = {};
  for (const v of out) {
    const b = baseOf(syn, v.key);
    counts[b] = (counts[b] ?? 0) + 1;
  }
  const pairs = Object.keys(counts).filter((k) => counts[k] === 2);
  ok('both charts contribute the same body somewhere', pairs.length > 0, `${pairs.length} pairs`);
  for (const b of pairs) {
    const hits = out.map((v, i) => [v, i]).filter(([v]) => baseOf(syn, v.key) === b);
    ok(`  ${b}: adjacent in the order`, hits[1][1] - hits[0][1] === 1);
    ok(`  ${b}: lands within 0.25s`, hits[1][0].time - hits[0][0].time <= 0.25 + 1e-9,
      `${(hits[1][0].time - hits[0][0].time).toFixed(3)}s`);
  }
}

console.log('\n--- detune stays inside its own chart ---');
{
  const p = new Performer(engine);
  const nudged = (map, keys) => new Set(keys.filter((k) => map[k] !== 0));

  // Identical charts: every body sits exactly on its opposite number. If the
  // nudge leaked across sides, all eleven would be pushed apart and the
  // conjunctions would beat at a rate that means nothing.
  const same = makeSynastry(chartAt(spread(0)), chartAt(spread(0)));
  const merged = p._detuneMap(same.placements);
  const alone = p._detuneMap(A.placements.filter((x) => x.key !== 'mc'));

  for (const side of ['a', 'b']) {
    const keys = same.placements.filter((x) => x.side === side).map((x) => x.key);
    const got = new Set([...nudged(merged, keys)].map((k) => same.byKey[k].baseKey));
    const want = nudged(alone, Object.keys(alone));
    ok(`side ${side}: nudged set matches the chart alone`,
      got.size === want.size && [...want].every((k) => got.has(k)),
      `merged {${[...got]}} vs alone {${[...want]}}`);
  }

  ok('map covers every placement', syn.placements.every((x) => merged[x.key] !== undefined
    || p._detuneMap(syn.placements)[x.key] !== undefined));
}

console.log('\n--- drone: anchors resolve under prefixed keys ---');
{
  const out = await run(syn, 'drone');
  ok('a bed starts', out.length > 0, `${out.length} voices`);
  const bases = new Set(out.map((v) => baseOf(syn, v.key)));
  ok('two charts anchor on the lights and the angle only',
    [...bases].every((b) => ['asc', 'sun', 'moon'].includes(b)), [...bases].join(','));
  ok('no silent body in the bed', out.every((v) => !syn.byKey[v.key].silent));

  const single = await run(A, 'drone');
  const singleBases = new Set(single.map((v) => baseOf(A, v.key)));
  ok('one chart keeps its five anchors',
    [...singleBases].every((b) => ['asc', 'sun', 'moon', 'saturn', 'pluto'].includes(b)),
    [...singleBases].join(','));
}

console.log('\n--- sequence: closes on the subject ascendant ---');
{
  const out = await run(syn, 'sequence');
  ok('sounds only bodies in contact', out.every((v) => !syn.byKey[v.key].silent));
  ok('final voice is the subject ascendant', out.at(-1).key === 'a:asc', out.at(-1).key);

  const single = await run(A, 'sequence');
  ok('one chart still closes on its ascendant', single.at(-1).key === 'asc');
}

console.log(`\n${fails === 0 ? 'All arrangement checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
