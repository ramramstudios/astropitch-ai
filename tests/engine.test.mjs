/**
 * Polyphony gain staging and voice stealing.
 *
 * Run with:  node tests/engine.test.mjs
 *
 * The engine's answer to "too many tones at once" is arithmetic, and the
 * arithmetic runs without an AudioContext: how much amplitude is scheduled to
 * sound at a given moment, what bus gain that has earned, and which voice
 * costs least to give up when the cap is reached. That is what this file
 * covers. What it actually sounds like — that the gain lands on the buses in
 * time, that nothing clips, that a steal is not audible as a click — is
 * tests/audio.test.html, in a browser.
 */

import { AudioEngine } from '../src/audio/engine.js';
import { Voice, envelopeAt } from '../src/audio/voices.js';

let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// A voice, reduced to what the engine reads off it. `amplitudeAt` is the real
// method, so the load model here is the one the app runs.
let serial = 0;
const voice = ({ t0 = 0, peak = 0.2, fadeFrom = null, fadeUntil = null } = {}) => ({
  id: serial++, t0, peak, fadeFrom, fadeUntil, stolen: false, stealFade: null,
  amplitudeAt(t) { return Voice.prototype.amplitudeAt.call(this, t); },
  steal(at, fade) { this.stolen = true; this.stealFade = fade; this.fadeFrom = at; this.fadeUntil = at + fade; },
});

const engineWith = (...voices) => {
  const e = new AudioEngine();
  for (const v of voices) e.voices.add(v);
  return e;
};

// ---------------------------------------------------------------------------

console.log('--- a voice contributes amplitude, not presence ---');
{
  const v = voice({ t0: 1, peak: 0.4, fadeFrom: 3, fadeUntil: 4 });
  ok('silent before its start time', v.amplitudeAt(0.9) === 0);
  ok('full from its start time', v.amplitudeAt(1) === 0.4);
  ok('still full while it sustains', v.amplitudeAt(2.9) === 0.4);
  ok('half way down half way through its release', Math.abs(v.amplitudeAt(3.5) - 0.2) < 1e-9, `${v.amplitudeAt(3.5)}`);
  ok('gone once the release has finished', v.amplitudeAt(4) === 0);
  ok('still gone later', v.amplitudeAt(90) === 0);

  const held = voice({ t0: 0, peak: 0.3 });
  ok('a voice with no scheduled release holds its whole share', held.amplitudeAt(500) === 0.3);
}

console.log('\n--- load is summed over what is actually sounding ---');
{
  const e = engineWith(
    voice({ t0: 0, peak: 0.2, fadeFrom: 2, fadeUntil: 3 }),
    voice({ t0: 5, peak: 0.5 }),
  );
  ok('a voice scheduled for later is not in the way yet', Math.abs(e.loadAt(0) - 0.2) < 1e-9, `${e.loadAt(0)}`);
  ok('both count once both have started', Math.abs(e.loadAt(5) - 0.5) < 1e-9, `${e.loadAt(5)}`);
  ok('an empty engine has no load', engineWith().loadAt(0) === 0);
}

console.log('\n--- the bus gain a load has earned ---');
{
  const e = new AudioEngine();
  const sum = (load) => load * e.gainForLoad(load);

  ok('a single voice inside the reference is untouched', e.gainForLoad(e.loadRef * 0.5) === 1);
  ok('the reference load itself is untouched', e.gainForLoad(e.loadRef) === 1);
  ok('nothing is boosted', e.gainForLoad(50) <= 1 && e.gainForLoad(0) === 1);

  let bounded = true;
  let worst = 0;
  for (let load = 0.01; load < 60; load += 0.01) {
    worst = Math.max(worst, sum(load));
    if (sum(load) > e.loadCeiling + 1e-9) bounded = false;
  }
  // Bounded at all is the claim here. What that bound turns into at the
  // saturator's input depends on the voices' own gain structure and on the
  // master chain, so the level that actually arrives there is measured in
  // tests/audio.test.html rather than asserted from this side.
  ok('the in-phase worst case never passes the ceiling', bounded,
    `worst ${worst.toFixed(3)} vs ${e.loadCeiling}`);
  ok('the curve is continuous at the reference',
    Math.abs(sum(e.loadRef) - sum(e.loadRef + 1e-6)) < 1e-4);

  // The property that keeps it musical rather than merely safe. Voices in a
  // chord are near enough uncorrelated that what a listener hears is the RMS,
  // sqrt(n) * a — so an exponent of exactly 0.5 would cancel that growth
  // dead and make a full chart no louder than one note. This is the test that
  // catches it: a render at loadExp 0.5 went 0.247 -> 0.181 -> 0.092 as
  // voices were added, which the in-phase sum above is quite happy with.
  const perceived = (n, a = 0.2) => Math.sqrt(n) * n * a * e.gainForLoad(n * a) / n;
  const heard = [1, 2, 4, 8, 16, 24].map((n) => perceived(n));
  let louder = true;
  for (let i = 1; i < heard.length; i++) if (heard[i] <= heard[i - 1]) louder = false;
  ok('every voice added makes the mix audibly bigger', louder,
    heard.map((x) => x.toFixed(3)).join(' -> '));
  ok('a full chart is meaningfully louder than one note',
    heard[heard.length - 1] > heard[0] * 1.4,
    `${(heard[heard.length - 1] / heard[0]).toFixed(2)}x`);
  ok('but not unboundedly so',
    heard[heard.length - 1] < heard[0] * 4,
    `${(heard[heard.length - 1] / heard[0]).toFixed(2)}x`);

  // The old rule attenuated only the arriving voice, by the count it found.
  // Ten voices that each gave up 1/sqrt(n) still summed to about five.
  const oldSum = (n) => { let s = 0; for (let k = 1; k <= n; k++) s += 1 / Math.sqrt(k); return s; };
  ok('bounded where the old per-voice rule was not',
    sum(e.loadRef * 24) < e.loadRef * oldSum(24),
    `${sum(e.loadRef * 24).toFixed(2)} vs ${(e.loadRef * oldSum(24)).toFixed(2)}`);
}

console.log('\n--- the load curve is written ahead of the voices ---');
{
  const e = engineWith(
    voice({ t0: 0, peak: 0.2, fadeFrom: 4, fadeUntil: 5 }),
    voice({ t0: 2, peak: 0.2, fadeFrom: 4, fadeUntil: 5 }),
  );
  const points = e._loadBreakpoints(0);
  ok('every moment the load changes is a breakpoint',
    [0, 2, 4, 5].every((t) => points.includes(t)), points.map((p) => p.toFixed(2)).join(','));
  ok('a breakpoint in the past is not scheduled',
    points.every((t) => t >= 0) && e._loadBreakpoints(3).every((t) => t >= 3),
    e._loadBreakpoints(3).map((p) => p.toFixed(2)).join(','));

  // A release lets go over its whole span, so sampling only its ends reads
  // the load as near-full for the entire tail and pins the bus down over it.
  const inside = points.filter((t) => t > 4 && t < 5);
  ok('a release is sampled inside its fade, not just at the ends',
    inside.length >= 2, `${inside.length} points between 4 and 5`);
  const long = engineWith(voice({ t0: 0, peak: 0.2, fadeFrom: 0, fadeUntil: 20 }));
  ok('a long release does not schedule an unbounded number of points',
    long._loadBreakpoints(0).length <= 12, `${long._loadBreakpoints(0).length} points`);

  const far = engineWith(voice({ t0: 0, peak: 0.2, fadeFrom: 1e6, fadeUntil: 2e6 }));
  ok('the horizon keeps an open-ended voice from scheduling forever',
    far._loadBreakpoints(0).length === 1, `${far._loadBreakpoints(0).length} points`);
}

console.log('\n--- a voice that never starts asks for nothing ---');
{
  // release() cannot schedule its ramp before t0 + 0.01, which is long enough
  // for a 2 ms attack to reach full level — so a pending voice put through it
  // is heard as a ~100 ms blip. steal has to drop it outright instead.
  const dispatch = (at, t0) => {
    const calls = [];
    const fake = {
      stolen: false, t0,
      _drop() { calls.push('drop'); },
      release(a) { calls.push(`release@${a}`); },
    };
    Voice.prototype.steal.call(fake, at, 0.06);
    return calls[0];
  };
  ok('stealing a voice that has not started drops it', dispatch(0, 5) === 'drop', dispatch(0, 5));
  ok('stealing a sounding voice releases it', dispatch(5, 0) === 'release@5', dispatch(5, 0));
  ok('a voice already stolen is left alone', dispatch(0, 5) !== undefined && (() => {
    const calls = [];
    const fake = { stolen: true, t0: 5, _drop() { calls.push('drop'); }, release() { calls.push('release'); } };
    Voice.prototype.steal.call(fake, 0, 0.06);
    return calls.length === 0;
  })());

  // And a dropped voice asks the staging for nothing from then on.
  const dropped = voice({ t0: 5, peak: 0.4 });
  dropped.peak = 0;
  const e = engineWith(dropped, voice({ t0: 5, peak: 0.4 }));
  ok('a dropped voice is no load, before or after its start time',
    e.loadAt(0) === 0 && Math.abs(e.loadAt(5) - 0.4) < 1e-9 && Math.abs(e.loadAt(99) - 0.4) < 1e-9,
    `${e.loadAt(0)} / ${e.loadAt(5)} — only the voice that still sounds`);
}

console.log('\n--- the envelope can be read ahead of the note ---');
{
  const env = [[1, 0.0001], [1.1, 0.5], [1.6, 0.2]];
  ok('before the note, the envelope floor', envelopeAt(env, 0) === 0.0001);
  ok('at the start, the envelope floor', envelopeAt(env, 1) === 0.0001);
  ok('at the peak of the attack', Math.abs(envelopeAt(env, 1.1) - 0.5) < 1e-9);
  ok('at the end of the decay', Math.abs(envelopeAt(env, 1.6) - 0.2) < 1e-9);
  ok('holding at the sustain afterwards', Math.abs(envelopeAt(env, 40) - 0.2) < 1e-9);
  // Exponential, not linear: the midpoint of the decay is the geometric mean.
  ok('interpolates the way an exponential ramp does',
    Math.abs(envelopeAt(env, 1.35) - Math.sqrt(0.5 * 0.2)) < 1e-9,
    `${envelopeAt(env, 1.35).toFixed(5)} vs ${Math.sqrt(0.5 * 0.2).toFixed(5)}`);
  ok('rises through the attack rather than sitting at the floor',
    envelopeAt(env, 1.05) > 0.001 && envelopeAt(env, 1.05) < 0.5,
    `${envelopeAt(env, 1.05).toFixed(5)}`);
}

console.log('\n--- which voice costs least to give up ---');
{
  const sounding = voice({ t0: 0, peak: 0.5 });
  const quiet = voice({ t0: 0, peak: 0.1 });
  const releasing = voice({ t0: 0, peak: 0.5, fadeFrom: 0, fadeUntil: 4 });
  const pending = voice({ t0: 10, peak: 0.5 });
  const later = voice({ t0: 20, peak: 0.5 });

  ok('a voice that has not started yet goes before one that has',
    engineWith(sounding, pending)._stealCandidate() === pending);
  ok('and of two that have not started, the one furthest out',
    engineWith(pending, later)._stealCandidate() === later);
  ok('a fading voice goes before a sustaining one',
    engineWith(sounding, releasing)._stealCandidate() === releasing);
  ok('among sustaining voices, the quietest',
    engineWith(sounding, quiet)._stealCandidate() === quiet);
  ok('an already stolen voice is not stolen twice',
    engineWith(Object.assign(voice({ peak: 0.01 }), { stolen: true }), sounding)._stealCandidate() === sounding);
  ok('nothing to steal from an empty engine', engineWith()._stealCandidate() === null);
}

console.log('\n--- the cap is enforced, gracefully ---');
{
  const e = new AudioEngine();
  const made = [];
  for (let i = 0; i < 90; i++) {
    const v = voice({ t0: 0.5, peak: 0.2 });
    made.push(v);
    e.register(v);
  }
  ok('sounding polyphony is capped', e.activeVoiceCount() === e.maxVoices,
    `${e.activeVoiceCount()} of ${e.maxVoices}`);
  ok('the voices kept are the ones asked for first',
    made.slice(0, e.maxVoices).every((v) => !v.stolen), 'earliest requests survive');
  ok('nothing audible was cut: every steal was of a voice yet to start',
    made.filter((v) => v.stolen).every((v) => v.stealFade === e.stealFade),
    'all faded at the base rate');

  // A sustaining voice, by contrast, has to be let down rather than cut.
  const live = new AudioEngine();
  live.maxVoices = 2;
  const loud = voice({ t0: -1, peak: live.loadRef });
  live.register(loud);
  live.register(voice({ t0: -1, peak: live.loadRef }));
  live.register(voice({ t0: -1, peak: live.loadRef }));
  ok('a sounding voice is faded, not cut', loud.stolen && loud.stealFade > live.stealFade,
    `faded over ${loud.stealFade}s vs a ${live.stealFade}s cut`);
}

console.log('\n--- no context, no crash ---');
{
  const e = new AudioEngine();
  const v = voice({ t0: 0, peak: 0.2 });
  e.register(v);
  e.refreshGainStaging(v);
  e.unregister(v);
  // Refreshing for a voice the engine has already let go must not reach for
  // params that may not exist: a voice's cleanup timer can fire after a stop.
  e.refreshGainStaging(v);
  ok('registering, refreshing and unregistering all survive a null graph', e.voices.size === 0);
}

console.log(fails === 0 ? '\nALL ENGINE TESTS PASSED' : `\n${fails} ENGINE TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
