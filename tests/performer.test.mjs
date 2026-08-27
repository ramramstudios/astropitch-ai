/**
 * These test what the Performer *schedules*, not what it sounds like — voice
 * construction is stubbed out, so this runs without an AudioContext. The
 * audible behaviour is covered by tests/audio.test.html in a browser.
 *
 * The claim that matters most here is the detune one. Within a chart, bodies
 * that land on nearly the same pitch get nudged apart so they beat instead of
 * cancelling. Across two charts that nudge must never happen, because there the
 * beating is the signal: a cross-chart conjunction beats at a rate set by its
 * orb, and 7 cents of arbitrary detune is worth about 2 degrees of orb.
 *
 * Looping modes (drone, melodic) are timed on the audio clock. The tests below
 * feed a fake clock and check that the scheduled note times do not move when
 * ticks arrive late or bunched — the whole point of the lookahead scheduler.
 */

import { Performer, melodicOnsets, droneEvents, placementForNote, DRONE_CYCLE, DRONE_STAGGER, DRONE_FIRST_LEAD, DRONE_REFRESH_LEAD, DRONE_RELEASE_LAG, DRONE_SHIMMER, DRONE_SHIMMER_LEAD, DRONE_FIRST_SHIMMER, MELODIC_LEAD } from '../src/audio/performer.js';
import { AudioScheduler, LOOKAHEAD, TICK_INTERVAL, MAX_CATCH_UP } from '../src/audio/scheduler.js';
import { makeChart, makeSynastry, designChart } from '../src/chart.js';
import { SOUNDING_BODIES, BODY_BY_KEY } from '../src/ontology.js';
import { frequencyFor } from '../src/audio/tuning.js';

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

const manualTimers = {
  setInterval: () => 1,
  clearInterval: () => {},
};

function makeClock() {
  const clock = { t: 0 };
  const eng = {
    get now() { return clock.t; },
    start: async () => {},
    setDelayTime() {},
    register() {},
    unregister() {},
    ctx: { get currentTime() { return clock.t; }, sampleRate: 48000 },
  };
  const scheduler = new AudioScheduler({
    now: () => clock.t,
    setInterval: manualTimers.setInterval,
    clearInterval: manualTimers.clearInterval,
  });
  return { clock, engine: eng, scheduler };
}

function pump(ctx, until, step = TICK_INTERVAL) {
  while (ctx.clock.t + 1e-12 < until) {
    ctx.clock.t = Math.min(until, +(ctx.clock.t + step).toFixed(10));
    ctx.scheduler.tick();
  }
}

function stamp(notes) {
  return notes.map((v) => `${v.key}@${v.time.toFixed(6)}`).join('|');
}

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
  const ctx = makeClock();
  const p = new Performer(ctx.engine, { scheduler: ctx.scheduler });
  p.setChart(chart);
  await p[mode]();
  if (p.scheduler.running) {
    // Drone: first bed only (last of three anchors at 1.88s; first shimmer
    // is at 2.65s). Melodic: long enough for a full phrase at 120 BPM.
    pump(ctx, mode === 'drone' ? 2.1 : 40);
  }
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

console.log('\n--- sign-locked equal temperament ---');
{
  const aries = frequencyFor(14.99, { microtones: false });
  const taurus = frequencyFor(30.01, { microtones: false });
  ok('holds Aries at A until the cusp', Math.abs(aries - 432) < 1e-9, `${aries.toFixed(3)} Hz`);
  ok('jumps to A-sharp immediately after the cusp', Math.abs(taurus - 432 * 2 ** (1 / 12)) < 1e-9, `${taurus.toFixed(3)} Hz`);
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
    Math.abs(retunes[0].freq - 432 * 2 ** (BODY_BY_KEY.venus.octave + 120 / 360)) < 1e-9,
    `${retunes[0].freq.toFixed(3)} Hz`);
  ok('updates its wheel-derived pan', Math.abs(retunes[0].pan - Math.sin((120 * Math.PI) / 180) * 0.8) < 1e-9);
  ok('releases on drop', releases.length === 1);
}

console.log('\n--- designer audition: sign changes replace the held voice ---');
{
  const starts = [];
  const releases = [];
  const p = new Performer(engine);
  p.setChart(A);
  p._voiceFor = (placement) => {
    starts.push(placement);
    return {
      released: false,
      retune() {},
      release: (at, fade) => releases.push({ at, fade }),
    };
  };

  await p.beginDesignerPreview('venus');
  const before = A.byKey.venus;
  const moved = {
    ...before,
    longitude: (before.longitude + 30) % 360,
    signIndex: (before.signIndex + 1) % 12,
    element: 'water',
    modality: 'fixed',
  };
  p.updateDesignerPreview('venus', moved);

  ok('starts a replacement voice for the new sign', starts.length === 2);
  ok('releases the preceding sign voice in a short crossfade', releases.length === 1 && releases[0].fade === 0.08);
  p.endDesignerPreview('venus');
}

console.log('\n--- click-burst dedup: same key chokes the previous voice ---');
{
  const releases = [];
  const created = [];
  const engine2 = { ...engine, now: 0 };
  const p = new Performer(engine2);
  p.setChart(A);

  p._voiceFor = (placement) => {
    const v = {
      key: placement.key,
      released: true,
      release: (at, fade) => releases.push({ key: placement.key, at, fade }),
    };
    created.push(v);
    return v;
  };

  await p.playPlacement('venus');
  await p.playPlacement('venus');
  await p.playPlacement('venus');

  ok('three rapid clicks on the same body create three voices', created.length === 3);
  ok('but choke (release early) the two preceding ones', releases.length === 2 && releases.every(r => Math.abs(r.fade - 0.05) < 1e-9));
  ok('the current voice for that key is still stored', p._choked.get('p:venus') === created[2]);

  releases.length = 0;
  await p.playPlacement('mars');
  await p.playPlacement('sun');
  ok('clicking different bodies chokes nothing', releases.length === 0);
}

console.log('\n--- click-burst dedup: retrigger releases even if already scheduled ---');
{
  const releases = [];
  const engine2 = { ...engine, now: 0.5 };
  const p = new Performer(engine2);
  p.setChart(A);

  const v1 = {
    key: 'venus',
    released: true,
    releaseAt: 3.0,
  };
  v1.release = function(at, fade) {
    releases.push({ at, fade, earlier: at < v1.releaseAt });
  };
  p._choked.set('p:venus', v1);

  const v2 = {
    key: 'venus',
    released: false,
    release() {},
  };
  p._voiceFor = () => v2;

  await p.playPlacement('venus');

  ok('retrigger calls release on prior voice even though released is already true', releases.length === 1);
  ok('retrigger pulls the release time earlier', releases[0].earlier === true);
  ok('retrigger uses CHOKE_FADE (0.05)', Math.abs(releases[0].fade - 0.05) < 1e-9);
}

console.log('--- bloom: one chart unfolds from the solar centre ---');
{
  const out = await run(A, 'bloom');
  const expectedOrder = ['sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  ok('sounds every enabled body', out.length === A.placements.filter((x) => !x.silent).length, `${out.length}`);
  ok('reveals bodies from Sun outward', out.map((v) => v.key).join(',') === expectedOrder.join(','),
    out.map((v) => v.key).join(', '));
  ok('times strictly increase', out.every((v, i) => i === 0 || v.time > out[i - 1].time));
}

console.log('\n--- ASC/MC never sound as chord tones, enabled or not ---');
{
  // Explicitly switching ASC/MC "on" (the Designer/Basic per-body switch)
  // still only controls their weight in the aspects and elemental balance.
  // They stay directional references, never bloom/scalar/drone/melodic
  // voices, and never a bare tone from the placements table either.
  const angles = designChart(chartAt({ ...spread(0), mc: 350 }), {
    asc: { enabled: true },
    mc: { enabled: true },
  });
  const bloomOut = await run(angles, 'bloom');
  ok('an enabled ASC/MC still do not join the bloom',
    !bloomOut.some((v) => v.key === 'asc' || v.key === 'mc'));

  const droneOut = await run(angles, 'drone');
  ok('an enabled ASC/MC still do not join the drone',
    !droneOut.some((v) => v.key === 'asc' || v.key === 'mc'));

  const scalarOut = await run(angles, 'scalar');
  ok('an enabled ASC/MC still do not join the scalar walk',
    !scalarOut.some((v) => v.key === 'asc' || v.key === 'mc'));

  const melodicOut = await run(angles, 'melodic');
  ok('an enabled ASC/MC still do not join the melody',
    !melodicOut.some((v) => v.key === 'asc' || v.key === 'mc'));

  const p = new Performer(engine);
  p.setChart(angles);
  log.length = 0;
  await p.playPlacement('asc');
  ok('clicking an enabled ASC in the placements table stays silent', log.length === 0);
}

console.log('\n--- a directional handle plays its connected aspect network ---');
{
  const contacts = A.angleAspects.filter((a) => a.a === 'asc');
  const out = await run(A, 'bloom');
  const p = new Performer(engine);
  p.setChart(A);
  log.length = 0;
  await p.playDirectionalAspects(contacts, { mode: 'scalar' });
  p.stop();
  ok('every directional contact schedules both sides', log.length === contacts.length * 2,
    `${log.length} voices for ${contacts.length} contacts`);
  // Keep the pre-existing bloom output live in the fixture so this test does
  // not accidentally make the expected arrangement depend on angle contacts.
  ok('regular bloom remains planetary by default', !out.some((v) => v.key === 'asc'));
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
  // nudge leaked across sides, every active voice would be pushed apart and the
  // conjunctions would beat at a rate that means nothing.
  const same = makeSynastry(chartAt(spread(0)), chartAt(spread(0)));
  const active = same.placements.filter((p) => !p.silent);
  const merged = p._detuneMap(active);

  // Synastry silences whichever bodies miss the top contacts, which is a
  // property of the aspects, not of detuning — so "alone" has to be recomputed
  // over that same sounding subset (in chart order) rather than every body,
  // or a silenced body dropping out of one side's "seen" list would look like
  // a cross-side leak when it is really just a different set of inputs.
  for (const side of ['a', 'b']) {
    const sidePlacements = active.filter((x) => x.side === side);
    const keys = sidePlacements.map((x) => x.key);
    const got = new Set([...nudged(merged, keys)].map((k) => same.byKey[k].baseKey));

    const baseKeys = new Set(sidePlacements.map((x) => x.baseKey));
    const aloneSubset = A.placements.filter((x) => !x.silent && baseKeys.has(x.key));
    const aloneMap = p._detuneMap(aloneSubset);
    const want = nudged(aloneMap, Object.keys(aloneMap));

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
  ok('two charts anchor on the lights only by default',
    [...bases].every((b) => ['sun', 'moon'].includes(b)), [...bases].join(','));
  ok('no silent body in the bed', out.every((v) => !syn.byKey[v.key].silent));

  const single = await run(A, 'drone');
  const singleBases = new Set(single.map((v) => baseOf(A, v.key)));
  ok('one chart keeps its three body anchors',
    singleBases.size === 3 && [...singleBases].every((b) => ['sun', 'moon', 'saturn'].includes(b)),
    [...singleBases].join(','));
}

console.log('\n--- scalar: does not close on a silent ascendant ---');
{
  const out = await run(syn, 'scalar');
  ok('sounds only bodies in contact', out.every((v) => !syn.byKey[v.key].silent));
  ok('silent subject ascendant is not scheduled', !out.some((v) => v.key === 'a:asc'));

  const single = await run(A, 'scalar');
  ok('one chart does not close on its silent ascendant', !single.some((v) => v.key === 'asc'));
}

console.log('\n--- scalar: the walk starts at the exact Ascendant, not its sign boundary ---');
{
  // Equal houses put the 1st cusp at the Ascendant's precise degree, ahead of
  // where its sign began. A body sitting between the two has technically not
  // risen yet, so the walk must not treat it as the first thing past the Asc.
  const asc = 200; // 20 degrees into Libra (sign start 180)
  const justBeforeAsc = 190; // in Libra, but behind the actual Ascendant
  const justAfterAsc = 210; // in Libra, just past the actual Ascendant
  const cusps = Array.from({ length: 12 }, (_, i) => (asc + i * 30) % 360);
  const chart = makeChart({ asc, sun: justBeforeAsc, moon: justAfterAsc }, { cusps, system: 'equal' });

  const out = await run(chart, 'scalar');
  const order = out.map((v) => v.key);
  ok('the body just past the Ascendant sounds first',
    order[0] === 'moon', order.join(', '));
  ok('the body just short of the Ascendant sounds last, having not risen yet',
    order[order.length - 1] === 'sun', order.join(', '));
}

console.log('\n--- melodic: constrained to the chart\'s own notes, and covers every body ---');
{
  const out = await run(A, 'melodic');
  const sounding = A.placements.filter((p) => !p.silent && !p.isAngle);
  const soundingPcs = new Set(sounding.map((p) => p.signIndex));

  ok('never invents a pitch class the chart does not have',
    out.every((v) => soundingPcs.has(A.byKey[v.key].signIndex)));

  const usedKeys = new Set(out.map((v) => v.key));
  ok('every sounding body is heard at least once', sounding.every((p) => usedKeys.has(p.key)),
    `missing: ${sounding.filter((p) => !usedKeys.has(p.key)).map((p) => p.key).join(',') || 'none'}`);

  ok('times strictly increase within the phrase', out.every((v, i) => i === 0 || v.time > out[i - 1].time));
}

console.log('\n--- melodic: repeats its phrase on an open-ended loop, like drone ---');
{
  const ctx = makeClock();
  const p = new Performer(ctx.engine, { scheduler: ctx.scheduler });
  p.setChart(A);
  await p.melodic();
  ok('arms the audio-clock scheduler rather than ending after one pass', p.scheduler.running);
  p.stop();
  ok('stop() clears the scheduler', !p.scheduler.running);
}

console.log('\n--- melodic: a chart with nothing sounding stays silent, without spinning a timer ---');
{
  const silent = designChart(A, Object.fromEntries(SOUNDING_BODIES.map((k) => [k, { enabled: false }])));
  const out = await run(silent, 'melodic');
  ok('schedules nothing', out.length === 0);

  const ctx = makeClock();
  const p = new Performer(ctx.engine, { scheduler: ctx.scheduler });
  p.setChart(silent);
  await p.melodic();
  ok('does not arm a loop with nothing to repeat', !p.scheduler.running);
  p.stop();
}

console.log('\n--- scheduler: windows cover the same notes whether ticks are on time, late, or bunched ---');
{
  const period = 0.2;
  const collect = (times, until) => {
    const hits = [];
    const clock = { t: 0 };
    const s = new AudioScheduler({
      now: () => clock.t,
      setInterval: manualTimers.setInterval,
      clearInterval: manualTimers.clearInterval,
    });
    s.start((t0, t1) => {
      const startN = Math.max(0, Math.ceil((t0 / period) - 1e-12));
      for (let n = startN; ; n++) {
        const t = n * period;
        if (t >= t1) break;
        if (t >= t0) hits.push(t);
      }
    });
    for (const t of times) {
      clock.t = t;
      s.tick();
    }
    if (clock.t < until) {
      clock.t = until;
      s.tick();
    }
    s.stop();
    return hits;
  };

  const until = 4;
  const onTime = [];
  for (let t = TICK_INTERVAL; t <= until + 1e-12; t = +(t + TICK_INTERVAL).toFixed(10)) onTime.push(t);
  const late = [];
  for (let t = 0.2; t <= until + 1e-12; t = +(t + 0.2).toFixed(10)) late.push(t);
  const bunched = [];
  for (let t = 0.18; t <= until + 1e-12; t = +(t + 0.35).toFixed(10)) {
    bunched.push(t, +(t + 0.001).toFixed(10), +(t + 0.002).toFixed(10));
  }

  const a = collect(onTime, until);
  const b = collect(late, until);
  const c = collect(bunched, until);
  const expected = [];
  for (let n = 0; n * period < until + LOOKAHEAD; n++) expected.push(n * period);

  ok('on-time ticks schedule every pulse in the horizon',
    a.length === expected.length && a.every((t, i) => Math.abs(t - expected[i]) < 1e-9),
    `${a.length} vs ${expected.length}`);
  ok('late ticks schedule the same pulse times',
    b.length === a.length && b.every((t, i) => Math.abs(t - a[i]) < 1e-9),
    `${b.length} vs ${a.length}`);
  ok('bunched ticks schedule the same pulse times',
    c.length === a.length && c.every((t, i) => Math.abs(t - a[i]) < 1e-9));

  const seen = new Map();
  for (const t of c) seen.set(t, (seen.get(t) ?? 0) + 1);
  ok('bunched ticks never double-schedule a pulse', [...seen.values()].every((n) => n === 1));
}

console.log('\n--- scheduler: a late first tick still fills from the last horizon, not from now ---');
{
  const windows = [];
  const clock = { t: 0 };
  const s = new AudioScheduler({
    now: () => clock.t,
    lookAhead: LOOKAHEAD,
    setInterval: manualTimers.setInterval,
    clearInterval: manualTimers.clearInterval,
  });
  s.start((t0, t1) => windows.push([t0, t1]));
  clock.t = 0.4;
  s.tick();
  s.stop();
  ok('the opening window starts at t=0, not after the late wake',
    windows[0][0] === 0 && Math.abs(windows[0][1] - LOOKAHEAD) < 1e-9,
    `${windows[0]}`);
  ok('the late tick extends that window rather than leaving a hole',
    Math.abs(windows[1][0] - LOOKAHEAD) < 1e-9 && Math.abs(windows[1][1] - (0.4 + LOOKAHEAD)) < 1e-9,
    `${windows[1]}`);
}

console.log('\n--- scheduler: a stall drops the backlog instead of compressing it ---');
{
  const windows = [];
  const clock = { t: 0 };
  const s = new AudioScheduler({
    now: () => clock.t,
    lookAhead: LOOKAHEAD,
    maxCatchUp: MAX_CATCH_UP,
    setInterval: manualTimers.setInterval,
    clearInterval: manualTimers.clearInterval,
  });
  s.start((t0, t1) => windows.push([t0, t1]));
  const stall = 24;
  clock.t = stall;
  s.tick();
  s.stop();
  ok('the wake window starts at now, not at the pre-stall horizon',
    Math.abs(windows[1][0] - stall) < 1e-9 && Math.abs(windows[1][1] - (stall + LOOKAHEAD)) < 1e-9,
    `${windows[1]}`);
  ok('its width is the look-ahead, not the stall',
    Math.abs((windows[1][1] - windows[1][0]) - LOOKAHEAD) < 1e-9);
}

console.log('\n--- looping modes: a 24s stall does not dump past-due notes ---');
{
  const stallAt = 24.45; // drone's first refresh voice is at 24.5
  for (const mode of ['melodic', 'drone']) {
    log.length = 0;
    const ctx = makeClock();
    const p = new Performer(ctx.engine, { scheduler: ctx.scheduler });
    p.setChart(A);
    await p[mode]();
    const before = log.length;
    ctx.clock.t = stallAt;
    ctx.scheduler.tick();
    const added = log.slice(before);
    p.stop();
    ok(`${mode}: nothing scheduled on wake is already in the past`,
      added.every((v) => v.time >= stallAt - 1e-9),
      added.map((v) => v.time.toFixed(2)).join(',') || 'none');
    ok(`${mode}: the wake window stays look-ahead-wide, not stall-wide`,
      added.every((v) => v.time < stallAt + LOOKAHEAD + 1e-9)
      && added.length < 8,
      `${added.length} notes`);
  }
}

console.log('\n--- melodicOnsets / droneEvents: the same events from any partition of the timeline ---');
{
  const notes = [
    { pc: 0, beats: 1 },
    { pc: 2, beats: 0.5 },
    { pc: 4, beats: 0.5 },
    { pc: 7, beats: 1.25 },
  ];
  const spec = { origin: MELODIC_LEAD, notes, beat: 0.5 };
  const flatten = (windows, fn) => windows.flatMap(([t0, t1]) => fn(t0, t1));
  const keyMel = (e) => `${e.phrase}:${e.index}@${e.time.toFixed(6)}`;
  const wholeMel = melodicOnsets(0, 12, spec).map(keyMel);
  const splitMel = flatten([[0, 0.15], [0.15, 0.7], [0.7, 3.1], [3.1, 12]], (t0, t1) => melodicOnsets(t0, t1, spec)).map(keyMel);
  ok('melodic onsets do not depend on how the look-ahead is sliced',
    wholeMel.join('|') === splitMel.join('|'),
    `${wholeMel.length} vs ${splitMel.length}`);

  const byPc = new Map([[0, ['sun', 'mercury', 'venus']]]);
  const rotating = [{ pc: 0, beats: 1 }, { pc: 0, beats: 1 }];
  ok('bodies that share a pitch class rotate within the phrase',
    placementForNote(rotating, 0, 0, byPc) === 'sun'
    && placementForNote(rotating, 1, 0, byPc) === 'mercury');
  ok('and the next restatement continues that rotation',
    placementForNote(rotating, 0, 1, byPc) === 'venus'
    && placementForNote(rotating, 1, 1, byPc) === 'sun');

  const droneSpec = { origin: 0, nAnchors: 3, shimmer: true };
  const keyDrone = (e) => `${e.type}:${e.cycle ?? e.k}:${e.index ?? ''}@${e.time.toFixed(6)}`;
  const wholeDrone = droneEvents(0, 30, droneSpec).map(keyDrone);
  const splitDrone = flatten(
    [[0, 0.15], [0.15, 2], [2, 3.1], [3.1, 24.4], [24.4, 27], [27, 30]],
    (t0, t1) => droneEvents(t0, t1, droneSpec),
  ).map(keyDrone);
  ok('drone events do not depend on how the look-ahead is sliced',
    wholeDrone.join('|') === splitDrone.join('|'),
    `${wholeDrone.length} vs ${splitDrone.length}`);

  const refresh = droneEvents(24, 27, { origin: 0, nAnchors: 3, shimmer: false });
  ok('the first refresh starts a new bed at origin + 24.5',
    refresh.some((e) => e.type === 'anchor' && e.cycle === 1 && e.index === 0
      && Math.abs(e.time - (DRONE_CYCLE + DRONE_REFRESH_LEAD)) < 1e-9));
  ok('and releases the previous bed at origin + 26.2',
    refresh.some((e) => e.type === 'releaseBed' && e.cycle === 1
      && Math.abs(e.time - (DRONE_CYCLE + DRONE_RELEASE_LAG)) < 1e-9));
  ok('the opening bed is staggered from origin + 80ms',
    Math.abs(droneEvents(0, 0.1, droneSpec)[0].time - DRONE_FIRST_LEAD) < 1e-9);
  const shimmers = droneEvents(0, 6, droneSpec).filter((e) => e.type === 'shimmer');
  ok('shimmers land on the 2.6s grid plus the extra at 3s',
    shimmers.some((e) => Math.abs(e.time - (DRONE_SHIMMER + DRONE_SHIMMER_LEAD)) < 1e-9)
    && shimmers.some((e) => Math.abs(e.time - (DRONE_FIRST_SHIMMER + DRONE_SHIMMER_LEAD)) < 1e-9),
    shimmers.map((e) => e.time.toFixed(2)).join(','));
}

console.log('\n--- looping modes: scheduled note times do not depend on when ticks arrive ---');
{
  const realRandom = Math.random;
  const seed = () => {
    let s = 20260807;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };

  const collect = async (mode, times, until) => {
    seed();
    log.length = 0;
    const ctx = makeClock();
    const p = new Performer(ctx.engine, { scheduler: ctx.scheduler });
    p.setChart(A);
    await p[mode]();
    for (const t of times) {
      ctx.clock.t = t;
      ctx.scheduler.tick();
    }
    if (ctx.clock.t < until) {
      ctx.clock.t = until;
      ctx.scheduler.tick();
    }
    const out = log.map((v) => ({ key: v.key, time: v.time }));
    p.stop();
    return out;
  };

  const until = 8;
  const onTime = [];
  for (let t = TICK_INTERVAL; t <= until + 1e-12; t = +(t + TICK_INTERVAL).toFixed(10)) onTime.push(t);
  const late = [];
  for (let t = 0.22; t <= until + 1e-12; t = +(t + 0.22).toFixed(10)) late.push(t);
  const bunched = [];
  for (let t = 0.16; t <= until + 1e-12; t = +(t + 0.37).toFixed(10)) {
    bunched.push(t, +(t + 0.001).toFixed(10), +(t + 0.003).toFixed(10));
  }

  try {
    for (const mode of ['melodic', 'drone']) {
      const a = await collect(mode, onTime, until);
      const b = await collect(mode, late, until);
      const c = await collect(mode, bunched, until);
      ok(`${mode}: late ticks schedule the same notes at the same times`,
        stamp(a) === stamp(b),
        a.length === b.length ? `${a.length} notes` : `${a.length} vs ${b.length}`);
      ok(`${mode}: bunched ticks schedule the same notes at the same times`,
        stamp(a) === stamp(c));
      ok(`${mode}: a note lands in the first look-ahead window`,
        a.length > 0 && a[0].time < LOOKAHEAD);
    }
  } finally {
    Math.random = realRandom;
  }
}

console.log('\n--- drone: the scheduler is what keeps the bed refreshing ---');
{
  log.length = 0;
  const ctx = makeClock();
  const p = new Performer(ctx.engine, { scheduler: ctx.scheduler });
  p.setChart(A);
  await p.drone();
  ok('drone arms the audio-clock scheduler', p.scheduler.running);
  const first = log.slice();
  pump(ctx, DRONE_CYCLE + DRONE_REFRESH_LEAD + DRONE_STAGGER * 2 + 0.05);
  const later = log.slice(first.length);
  ok('on-time ticks over a 24s run still place the refresh on the audio-clock grid',
    later.some((v) => Math.abs(v.time - (DRONE_CYCLE + DRONE_REFRESH_LEAD)) < 1e-9),
    later.map((v) => v.time.toFixed(2)).join(','));
  p.stop();
  ok('stop() clears the drone scheduler', !p.scheduler.running);
}

console.log(`\n${fails === 0 ? 'All arrangement checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
