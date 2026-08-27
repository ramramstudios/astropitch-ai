# Audio stability plan — outstanding work

Companion log for `research/audio-stability-plan.md`. Updated when a phase lands on `audio`.
"Waived" means an acceptance check, validator, or suite the phase called for that this run did not complete, with why.

---

## Already on `audio` before this run

### Phase 1 — Realtime stability harness — **done** (`02cc2e8`)

Realtime `AudioContext` page at `tests/stability.test.html`, worklet frame counter, clock-drift / realtime-ratio, main-thread stressor. Acceptance was adapted to what headless Chrome actually does (`renderCapacity` gone; null sink runs slow rather than dropping quanta). Device driver dropouts remain manual QA, as the plan stated.

---

## This run

### Phase 2 — Sample-rate parity — **done** (`e905966`)

**Completed**

- Offline helpers in `tests/audio.test.html` and `tests/polyphony.test.html` take a sample rate instead of hardcoding 48000. Time→sample math uses the buffer's rate.
- Parity fixture: the same 16-voice dense scene at 44100 and 48000, asserting peak, RMS, four-band energy, and 128-sample residual against recorded bounds.
- IR duration asserted equal (3.6 s) at both rates; `stages.convolver` exposed for that.
- IR and voice noise hashed from time so the comparison is rate, not two different `Math.random` sequences of different length.
- Chrome paths on the headless runner include `/usr/bin/google-chrome-stable` and `/usr/local/bin/google-chrome`.

**Measured** (dense(16) × 8 s): Δ peak 0.05 dB, Δ RMS 0.54 dB, Δ residual 1.05 dB, max band Δ 0.011.

**Waived**

- Haiku review of the diff. Allowed Task models in this environment do not include Haiku; not substituted.
- Re-running the full offline suites (`tests/audio.test.html`, `tests/polyphony.test.html`) after the hashed IR/noise change. A dedicated parity probe confirmed the numbers; `tests/engine.test.mjs` and `tests/performer.test.mjs` passed.
- Running every existing assertion at 44.1 kHz. Helpers are parameterised so they *can*; the default remains 48 kHz. Only the dedicated fixture is compared across rates.
- `tests/performer.test.mjs` / `tests/palettes.test.mjs` fake contexts still say 48000. Those are not offline renders.

### Phase 3 — Node and voice census over a long session — **done** (this commit)

**Completed**

- Census on `tests/stability.test.html`: wrap `BaseAudioContext` `create*` factories (harness-only), assert `engine.voices` returns to 0 after stop once tails have run out, never above the cap, live node count flat across 20 bloom enter/exit cycles and 5 hide/show, interrupt/resume, and rebuild cycles.
- Production fix the census found: the voice VCA was never on `Voice.nodes`, so `dispose()` leaked one `GainNode` per voice (~10 nodes per bloom cycle).
- Production fix the lifecycle census found: `onended` does not fire on a suspended context, and `release()` will not shorten a tail that has already started. `AudioEngine.disposeAll()` runs after the suspend fade so a backgrounded page does not keep fading voices.

**Measured** (2026-08-27, headless Chrome): enter/exit rest live-nodes 26 × 20. After first keep-alive, lifecycle rest 28. Peak active 24/24. `tests/stability.test.html` green in ~296 s.

**Waived**

- Haiku review. Same reason as Phase 2.
- Full offline suites still not re-run after the VCA/`disposeAll` changes. Those paths are not what the census measures; `tests/engine.test.mjs` and `tests/mobile.test.mjs` passed.

---

## Remaining phases

### Phase 4 — Four missing offline metrics — **done** (this commit)

**Completed**

- Per-stage 128-sample residual after glue, saturator (post-makeup), limiter, and output. Reporting only.
- Compressor `reduction` sampled on the audio clock during an offline render; skip if constant. On this Chrome it varies (instrument present).
- Band energy for <120 Hz, 120–400 Hz, 400 Hz–4 kHz, >4 kHz. Reporting only. The three numbers the plan named are logged explicitly.
- 4× cubic true-peak estimate; asserted below full scale.

**Measured** (dense(16) × 8 s): glue −59.7 dB, saturator −51.1 dB, limiter −50.9 dB, output −50.7 dB; true peak 0.900; bands 2.6% / 81.0% / 16.3% / 0.08%.

**Waived**

- Haiku review.
- Full `tests/audio.test.html` (the ~460-scene matrix). The new section was measured with a dedicated probe that uses the same helpers and fixture. The 144×palette loop was not re-run.

### Phase 5 — Calibrate the load model — **not started**

Solo peak vs `voice.peak` table; coherent vs incoherent sum. Model change only if the error is large enough; "measured, no change" is a valid close.

### Phase 6 — Stop rule — **not started**

Do not retune the mastering chain. Close the plan unless a listening complaint arrives with numbers (mode, chart, stage, bands, GR).

---

## Standing waivers (not phase-specific)

- Device-level underruns and listening QA (CLAUDE.md). Headless null sink is not a phone DAC.
- Haiku as a per-phase validator, until that model is actually available to the agent.
- Full `tests/audio.test.html` (1800 s) and `tests/polyphony.test.html` (2400 s) not re-run in this session after Phase 2/3 production audio changes.
