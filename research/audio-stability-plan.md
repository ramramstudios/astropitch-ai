# Audio Stability Plan — Reliable Output, Not Better Mastering

**Date:** 2026-08-26
**Goal:** reliable, stable audio output.
**Scope:** what makes the sound *arrive intact* on a real device. Not tone, not loudness, not
"does the dense bloom sound good" — those are downstream of this and are parked at the end.

This is a companion to `research/audio-implementation-plan.md` (timing, lifecycle, mobile shells),
whose phases are landed. It deliberately supersedes the distortion-reduction plan that preceded it:
that plan proposed eight phases of mastering-chain work, and the argument for reordering is in
"Why not the mastering chain first" below.

---

## What is already measured — do not rebuild it

Anyone starting here will be tempted to build instrumentation that exists. It exists:

- **Pre-master tap and per-stage bypass.** `engine.stages` (`src/audio/engine.js:419`) names every
  master stage so a test can defeat one at a time; `tests/polyphony.test.html:114-120` already taps
  straight off `master`, bypassing glue/saturator/limiter/ceiling.
- **Dual-block residual.** Both 128- and 2048-sample residuals are computed and logged side by side
  (`tests/polyphony.test.html:287-293`). The block-length reasoning is in CLAUDE.md and is correct.
- **Staging-defeat A/B.** `{ loadRef: Infinity }` renders the same material with the polyphony gain
  stage disabled (`tests/polyphony.test.html:350-355`).
- **Saturator drive ablation**, with the measured drive-vs-residual table recorded in the source
  comment at `src/audio/engine.js:49-64`.
- **Crest factor, solo vs burst** (`tests/audio.test.html:305-309`).
- **Pre-saturator headroom**, asserted at `worst < SAT_HEADROOM * 0.6`
  (`tests/polyphony.test.html:299`) and `staged.pre < SAT_HEADROOM * 0.5`
  (`tests/audio.test.html:519`).

Note the last one especially. Those assertions are **green today**. Any plan whose acceptance
criterion is "pre-saturator peak stays under 0.6 × SAT_HEADROOM" is proposing a criterion the
suite already enforces, and it cannot tell an improvement from a no-op.

---

## What is not measured, and why it decides this plan

Every render in both browser suites goes through `OfflineAudioContext`
(`tests/audio.test.html:61`, `tests/polyphony.test.html:101`). An `OfflineAudioContext` renders as
fast or as slow as the machine allows and **cannot underrun by construction**. It has no audio
device, no render deadline, and no callback that can arrive late.

So the current apparatus — which is genuinely good at what it does — is structurally incapable of
observing:

- buffer underruns and the crackle they produce, which is what most listeners actually call
  "distortion" on a phone;
- CPU exhaustion under worst-case polyphony (24 voices, unison stacks, a convolver, two sends);
- node accumulation over a long session;
- anything that differs at a sample rate other than 48 kHz — the only rate either suite uses;
- output-device changes mid-session (wired to Bluetooth), which can silently move the context to a
  different sample rate or a different latency class.

That is the gap. Phases 1–3 close it. Phase 4 adds the four offline metrics that are genuinely
missing. Phase 5 calibrates the one model that is currently guessed at. Phase 6 is a stop rule.

---

## Phase 1 — A realtime stability harness

**The defect.** There is no test that runs the graph against a clock it can fall behind. Every
claim the suites make is about arithmetic, not about delivery.

**The fix.** A new page, `tests/stability.test.html`, driven by the existing runner
(`tests/run-browser.mjs`) but built on a **realtime `AudioContext`** rather than an offline one. It
runs each transport mode for a fixed wall-clock stretch under worst-case load and reports:

- **Underrun ratio and render load.** Chrome exposes `AudioContext.renderCapacity` with
  `averageLoad`, `peakLoad`, and `underrunRatio`. Feature-detect it; where present it is the
  direct answer and no inference is needed.
- **Dropped render quanta.** As complement and fallback, a test-only `AudioWorkletProcessor` that
  records `currentFrame` on every `process()` call. The frame counter advances by exactly one
  quantum per call on a healthy graph; any larger jump is a starved render. This gives a count and
  a timeline, not just a ratio, so a dropout can be located against what the transport was doing.
  The worklet is *test-only* — it does not go in `src/audio/`, so the mobile AudioWorklet risk
  noted in `research/audio-implementation-plan.md` does not apply to it.
- **Clock drift.** `ctx.currentTime` against `performance.now()` across the run. A context that
  stalls, gets throttled, or is rebuilt shows up here even when no quantum is formally dropped.

**Worst case is the point.** Run it at the polyphony cap (24, enforced at `engine.test.mjs`'s
"sounding polyphony is capped"), with reverb and delay sends live, in the densest mode, plus a
deliberate main-thread stressor in one variant — a busy loop on the main thread — to prove the
audio path survives a janky UI rather than only a quiet one.

**Honest limit, state it in the file header.** Headless Chrome runs against a null audio sink at a
timer-driven realtime cadence. That catches CPU overload, graph stalls, and main-thread-induced
starvation. It does **not** reproduce a specific device's driver behaviour, and it never will.
Device dropouts remain a manual-QA item, like the listening checks CLAUDE.md already requires.

**Acceptance.** Zero dropped quanta and `underrunRatio == 0` across every mode at the polyphony
cap on an unloaded machine; under the main-thread stressor, a recorded budget rather than zero —
whatever the first honest run measures, written into the file as the number to regress against.
Peak render load recorded per mode so a future palette or mode can be seen to cost something.

**Why this is first.** It is the only phase that measures the stated goal. Everything else in this
document is either supporting it or waiting on it.

---

## Phase 2 — Sample-rate parity

**The defect.** 48 kHz is hardcoded in every render in both suites. Real output runs at whatever
the device gives: 44.1 kHz is common, and a Bluetooth route can force something else again. Nothing
in the codebase is knowingly rate-dependent, which is exactly why an accidental dependency would go
unnoticed.

Two places have real exposure. `createImpulseResponse` builds its tail from `ctx.sampleRate`
(`src/audio/engine.js:164`), so the IR is regenerated per rate and could easily differ in length or
brightness rather than only in resolution. And `WaveShaper.oversample` ('4x' on the saturator,
'2x' on the ceiling) resamples relative to the context rate, so the two nonlinearities are not
operating on identical bandwidth at 44.1 kHz as at 48 kHz.

**The fix.** Parameterise the rate in the offline harnesses instead of hardcoding it, and add a
parity check: render the same fixture at 44100 and 48000 and compare peak, RMS, band energy, and
the 128-sample residual. Small differences are expected and fine; the test asserts they stay small
and, more importantly, makes any future divergence visible.

**Acceptance.** Peak and RMS within a tight tolerance across rates; residual difference under a
recorded bound; no assertion in the existing suites that only passes at 48 kHz.

**Dependency.** None. Can run alongside Phase 1.

---

## Phase 3 — Node and voice census over a long session

**The defect.** Voice teardown has two paths: `onended` on a lifetime source, and a
`setTimeout` backstop (`src/audio/voices.js:585` and `:646`). Background tabs and mobile WebViews
throttle timers — that is the premise of the whole lifecycle module. If the `onended` path ever
fails to fire for a class of voice, the timer covers it *only while the page is foregrounded*, and
the failure mode is silent accumulation: the tab gets slowly heavier and eventually crackles. The
graph comment at `src/audio/engine.js:15` names this exact hazard; nothing tests for it.

**The fix.** A long-run census inside the Phase 1 harness:

- `engine.voices` is a `Set` (`src/audio/engine.js:661-673`), so live-voice count is directly
  readable. Assert it returns to zero after a transport stops and its tails have run out, and that
  it never exceeds the cap while running.
- Count node creation and disconnection by wrapping the `create*` factories on the test context.
  This is a harness-side instrument; no production code changes. Assert the live count is flat
  across repeated mode entry and exit, rather than climbing per cycle.
- Cycle the lifecycle transitions during the run — background/foreground and interrupt/resume via
  `lifecycleStep`'s actions, including the `rebuild` path — and re-check both counts after. A leak
  that only appears after a rebuild is the one most likely to reach a user, since the lifecycle
  module rebuilds on a bad route.

**Acceptance.** Live voices return to zero after every stop; node count flat across at least twenty
enter/exit cycles and across at least five background/foreground and interrupt/resume cycles.

**Dependency.** Phase 1's realtime page. The census is meaningless offline, where teardown timers
do not run against a real clock.

---

## Phase 4 — The four offline metrics that are actually missing

Everything the previous plan called "Phase 0" already exists except four things. They are cheap and
they belong in the existing suites, not in a phase of their own.

1. **Per-stage residual.** Extend the existing tap so the residual can be taken after glue, after
   the saturator, and after the limiter, not only pre-master and at the output. This is the one
   instrument that can attribute new dirt to a stage rather than to the chain.
2. **Compressor gain reduction telemetry.** Read `glue.reduction` and `limiter.reduction`
   periodically during a render and report min/max/distribution per mode. Feature-detect —
   `reduction` readback is not uniformly reliable across engines, so the test skips rather than
   fails where it reads as a constant.
3. **Band energy.** Split each dense render into <120 Hz, 120–400 Hz, and >4 kHz and report the
   three numbers. Separates low-end pile-up from high-end grit, which peak and RMS cannot.
4. **True-peak estimate.** 4× oversample the offline buffer and take the maximum. The sample-peak
   checks (`tests/audio.test.html:159`, `:203`) do not see intersample peaks, and a converter does.

**Acceptance.** All four report on every dense fixture. Only #4 gets an assertion at first — true
peak below full scale. The other three are *reporting* instruments in this phase; turning a reading
into a threshold without knowing the normal range is how a suite acquires a flaky test.

**Dependency.** None, but do it after Phases 1–3 so the reliability work is not delayed by it.

---

## Phase 5 — Calibrate the load model instead of guessing at it

**The defect.** The polyphony gain stage projects load from summed voice peaks
(`amplitudeAt`, `src/audio/voices.js:657-662`). That model has two errors pointing in **opposite
directions**, and this matters because it is the reason the obvious fix is wrong:

- It **under-counts layering.** Sub, unison octaves, and noise all sum into `oscMix`
  (`src/audio/voices.js:301-303`, `:346-357`, `:418-429`), but `this.peak` (`:463`) tracks the amp
  envelope only. A three-octave unison Sun voice with a sub is louder than its `peak` claims.
  The source comment at `:462` already acknowledges the envelope is not the whole story — it
  accounts for the gate term and stops there.
- It **over-counts coherence.** Summing peaks assumes every voice adds in phase. Uncorrelated
  voices sum closer to √n. Across 24 voices that is a large overestimate.

These partially cancel. Correcting the first by adding weights for sub and unison count — the
obvious move — without addressing the second produces over-ducking: a mix that gets quieter under
density and sounds like the problem was fixed because it is less loud. CLAUDE.md's existing RMS
guard exists precisely to catch that trick, and it would.

**The fix.** Measure instead of weighting. Render each palette × element × modality voice solo,
record its actual peak, and compare against the `voice.peak` the load model would have used. That
table is the calibration: it says exactly which voice constructions are misestimated and by how
much. Then fit the correction to the table, and separately measure coherent-vs-incoherent summing
by rendering n voices together and comparing the real sum against n × mean peak for a few n.

Roughly twenty lines of harness for the first table, and it settles both errors at once rather
than trading one for the other.

**Acceptance.** A recorded table, committed as a comment beside the load constants the way the
saturator's drive table is (`src/audio/engine.js:49-64`). A model change only if the table shows
an error large enough to matter, and only with the polyphony suite re-run and the RMS guard green.

**Dependency.** Phase 4's true-peak metric, so the solo peaks are true peaks.

---

## Phase 6 — The stop rule

After Phases 1–5, **stop**. Do not proceed into low-end trimming, glue retuning, sidechain
detectors, multiband dynamics, or removing limiter stages.

Reopen the mastering chain only when a specific listening complaint survives all of the above and
arrives with numbers attached: which mode, which chart, which stage the per-stage residual blames,
and what the band energy and GR telemetry say. At that point the diagnosis is the plan, and it will
be a paragraph rather than eight phases.

---

## Why not the mastering chain first

Three reasons, all of them checkable in the tree today.

**The diagnosis is already recorded, and it points away from the compressors.**
`src/audio/engine.js:49-64` documents the measurement: the buzz was saturator intermodulation, with
a drive-vs-residual table, and a control experiment showing that turning the whole mix down 3 dB
moved the residual only 1.9 dB against the 11 dB the drive change bought. The same comment states
that compressor gain moves over milliseconds and is heard as level rather than as dirt. A plan
whose largest phase retunes glue is arguing with a measurement rather than with a symptom.

**The instrument cannot validate the change.** The 128-sample residual block was chosen
*specifically to remove compressor gain riding from the measurement* — that is what the CLAUDE.md
note is about, and why the same render measures 12 dB apart at the two block lengths. Accepting a
glue retune on "residual no worse" therefore proves nothing: the metric is blind to the thing being
changed by design. Compressor changes need the 2048-block number, the GR telemetry from Phase 4, or
listening — not the residual.

**Removing safety stages is the wrong direction for this goal.** Dropping the limiter because its
gain reduction reads near zero removes a backstop that costs nothing when idle and bounds the
output when something upstream misbehaves. Under a reliability objective, a stage that usually does
nothing is a stage that is doing its job.

One technical correction worth keeping, in case a sidechained detector is ever revisited: it does
**not** require an `AudioWorklet`. `signal → WaveShaper(abs) → lowpass biquad → WaveShaper(map) →
GainNode.gain`, with the gain's own `value` at 0, is a native level follower — AudioParams accept
node connections. The mobile Worklet risk is not a reason to avoid it. The recorded diagnosis is.

---

## Working discipline

Every constant this document touches has its measured value written into a comment beside it. That
convention is the reason the saturator regression was findable, and it is not optional:

- One variable at a time.
- Re-run `node tests/engine.test.mjs`, then the browser suites
  (`node tests/run-browser.mjs tests/audio.test.html 1800`,
  `node tests/run-browser.mjs tests/polyphony.test.html 2400`, and the new stability page).
- Write the new number into the comment next to the constant, with what it replaced.
- Never widen `SAT_HEADROOM` or `CEILING_HEADROOM` to make a test pass. The header at
  `src/audio/engine.js:32-36` says why: the tightness is what caught a 9 dB level regression.
- Never accept a metric improvement that came with a materially lower RMS.

---

## Unknowns and assumptions

1. **Headless realtime fidelity.** Chrome's null sink runs the render thread on a timer. Whether
   its underrun behaviour resembles a real device closely enough to be a useful regression signal
   is the main open question in Phase 1. If it proves too quiet to be informative, the fallback is
   to keep the clock-drift and render-load numbers as the regression signal and demote underrun
   counting to manual device QA.
2. **`renderCapacity` availability.** Chrome-only, and it is the runner's browser, so this is a
   convenience rather than a dependency — the worklet frame counter covers the same ground.
3. **`reduction` readback.** May read as a constant depending on engine and context type, which is
   why Phase 4 makes it a skip-if-unavailable reporting instrument, not an assertion.
4. **Rate exposure is unproven.** Phase 2 assumes the IR generator and the oversampled shapers are
   the likeliest rate-dependent spots. If parity comes back clean at both rates, that phase closes
   as a permanent guard rather than a fix.
5. **The load-model errors may cancel closely enough to leave alone.** Phase 5 is allowed to
   conclude "measured, within tolerance, no change" and that is a successful outcome, not a
   failed one.
6. **Prior fidelity work may already be sufficient.** `SAT_DRIVE = 0.55` took 11 dB of residual.
   No current complaint has been reproduced against the present tree. Phase 6 exists because the
   honest answer may be that there is nothing left to fix in the chain.
