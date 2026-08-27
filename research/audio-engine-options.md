# Audio Engine Options — Research Findings

**Date:** 2026-08-26
**Question:** Should we replace the hand-rolled Web Audio engine in `src/audio/` with an
established open-source synthesis engine, ahead of an iOS/Android app-store migration?

**Answer: No.** Keep the native Web Audio node graph. Fix scheduling and lifecycle instead.

## Options evaluated

| Option | License | Verdict for this project |
|---|---|---|
| **Native Web Audio** (current) | — | **Chosen.** Identical on both WebViews, no build step, no WASM, keeps tuned master chain. |
| Tone.js | MIT | Ergonomics only; same nodes underneath. Would require re-tuning our measured saturator. |
| Elementary Audio | MIT | AudioWorklet-only, no ScriptProcessor fallback — worst exposure on our weakest target. |
| Faust + faustwasm | GPL-2/LGPL-2.1 | Best *future* add-on: dual AudioWorklet/ScriptProcessor codegen. New DSP language to learn. |
| Csound (`@csound/browser`) | LGPL-2.1 | Deepest opcode library; multi-MB WASM, far more than 10 voices needs. |
| Soundpipe / Sporth | MIT | Good C core, and shared with AudioKit — but see "three implementations" below. |
| AudioKit (Swift) | MIT | Native iOS only. Android would need a separate Oboe/AAudio port. |
| FunDSP (Rust) | MIT | Strong library, but we'd own all the WASM glue. |
| WebPd | LGPL-3 | Alpha; AudioWorklet support still in progress. |
| hvcc / Heavy | BSD-family | Mature Pd→C compiler, but Emscripten build step for a workload that doesn't need it. |
| Surge XT / Strudel | GPL-3 / AGPL-3 | Excellent references. Copyleft — we have no LICENSE file; treat as reading only. |

## Three findings

**1. The DSP is not the bottleneck.** The workload is ~10 concurrent voices of oscillators and
biquads. No modern phone strains on this. There is no CPU or fidelity ceiling that a different
engine lifts — and `engine.js` already holds measured distortion tuning, polyphony gain staging,
and voice stealing that any swap would discard.

**2. The real defects are timing and lifecycle, and no engine fixes them.** Musical timing runs on
main-thread `setInterval` (`performer.js:718`, `796-798`), which mobile WebViews throttle. There is
zero `visibilitychange`/`pagehide` handling in the audio path. Tone.js — far more mature than our
code — has an open issue titled *"iOS inconsistent after two minutes (Android — no problem)"*: the
same bug, in a library we'd be adopting as the cure.

**3. Store policy makes the WebView an asset, not a liability.** Apple's Guideline 2.5.2 bans
downloaded code but explicitly exempts scripts run by WebKit/JavaScriptCore; Google Play's
dynamic-code rule carves out JavaScript in a WebView identically. **JS audio can ship new palettes
and new modes over the air, without app review. Native DSP cannot** — every new timbre would mean a
full submission cycle. That directly serves our post-deployment customizability requirement.

## Recommendation

Keep the current engine. Replace the interval loops with an audio-clock lookahead scheduler, add a
lifecycle layer, and formalise a mode registry. Revisit **Faust** later as an *additional* voice
type — never as a replacement for the palette-as-data authoring model.

See `research/audio-implementation-plan.md`.
