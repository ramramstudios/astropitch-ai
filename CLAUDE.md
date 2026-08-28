# Claude Code Guidelines for astropitch-ai

## Commits

**IMPORTANT: Never automatically write commit messages or run `git commit` without explicit user request.**

Always ask the user if they want to commit changes, and if so, have them provide or approve the commit message. Do not assume you should commit work when a task completes.

- Exception: If a CLAUDE.md or .claude/settings.json explicitly authorizes auto-commit behavior with a specific message template, follow that config instead.

## Tests

- `node tests/performer.test.mjs` — run arrangement/scheduling tests (no audio needed)
- `node tests/engine.test.mjs` — polyphony gain staging and voice-stealing arithmetic (no audio needed)
- `node tests/mobile.test.mjs` — pure-logic checks for mobile mode: pinch/pan view math, bottom-sheet state transitions, the app.js/index.html MODE_QUERY consistency check, and the DOM-free parts of the chart-image and WAV exports
- `node tests/native.test.mjs` — the iOS shell's hand-coupled facts: the three copies of the version string, the two copies of the shell version, the Info.plist keys, the privacy manifest, and the committed Xcode project's shape. Text and plist assertions only — it cannot tell you whether the project compiles, which needs Xcode
- `tests/audio.test.html` — OfflineAudioContext render tests
- `tests/polyphony.test.html` — what a transport sounds like once it has been *left running*, which one-shot renders miss. Drives the real `melodic()`/`drone()` with the timer functions swapped for the audio clock. Kept on its own page because audio.test.html already renders ~460 scenes and the two together exhaust the headless renderer
- `tests/stability.test.html` — realtime `AudioContext`: dropped render quanta, `renderCapacity` load/underrun, and clock drift, at the polyphony cap. An offline render cannot observe any of this. Headless Chrome uses a null sink, so device dropouts remain manual QA.
- `tests/bounce.test.html` — the WAV bounce actually renders audio. `tests/mobile.test.mjs` covers the pure parts (header, clipping, trim/fade, which modes are refused), none of which can tell a working render from a minute of silence. Deliberately small — two renders — since the other two pages already exhaust the headless renderer between them

Browser suites run headless and exit non-zero on failure:

- `node tests/run-browser.mjs tests/audio.test.html 1800`
- `node tests/run-browser.mjs tests/polyphony.test.html 2400`
- `node tests/run-browser.mjs tests/stability.test.html 180`
- `node tests/run-browser.mjs tests/bounce.test.html 300`

The timeout argument is in seconds and these are slow — the polyphony page renders about four minutes of audio. It needs Chrome or Chromium installed.

Manual listening QA is still required for audio features: the suites measure level and distortion, not whether something sounds good. The same is true for mobile-mode CSS/layout behavior, actual pointer/touch event wiring, and the service worker/offline path — tests/mobile.test.mjs only covers the DOM-independent logic those features are built on.

### Measuring distortion

Both audio suites compare a loud render against the same render 18 dB down, gain-matching each block by least squares before differencing. **The block length decides what is measured.** At 2048 samples one fitted gain cannot follow a limiter, so ordinary gain riding lands in the residual and hides everything else; at 128 samples the fit tracks the compressors and what remains is waveform distortion. Measured at 2048, deleting the saturator outright moved the number by 0.2 dB — measured at 128, by 12 dB. Use the short block for any claim about distortion.
