# Claude Code Guidelines for astropitch-ai

## Commits

**IMPORTANT: Never automatically write commit messages or run `git commit` without explicit user request.**

Always ask the user if they want to commit changes, and if so, have them provide or approve the commit message. Do not assume you should commit work when a task completes.

- Exception: If a CLAUDE.md or .claude/settings.json explicitly authorizes auto-commit behavior with a specific message template, follow that config instead.

## Tests

- `node tests/performer.test.mjs` — run arrangement/scheduling tests (no audio needed)
- `node tests/engine.test.mjs` — polyphony gain staging and voice-stealing arithmetic (no audio needed)
- `node tests/mobile.test.mjs` — pure-logic checks for mobile mode: pinch/pan view math, bottom-sheet state transitions, and the app.js/index.html MODE_QUERY consistency check
- `tests/audio.test.html` — OfflineAudioContext render tests
- `tests/polyphony.test.html` — what a transport sounds like once it has been *left running*, which one-shot renders miss. Drives the real `melodic()`/`drone()` with the timer functions swapped for the audio clock. Kept on its own page because audio.test.html already renders ~460 scenes and the two together exhaust the headless renderer

Both browser suites run headless and exit non-zero on failure:

- `node tests/run-browser.mjs tests/audio.test.html 1800`
- `node tests/run-browser.mjs tests/polyphony.test.html 2400`

The timeout argument is in seconds and these are slow — the polyphony page renders about four minutes of audio. It needs Chrome or Chromium installed.

Manual listening QA is still required for audio features: the suites measure level and distortion, not whether something sounds good. The same is true for mobile-mode CSS/layout behavior, actual pointer/touch event wiring, and the service worker/offline path — tests/mobile.test.mjs only covers the DOM-independent logic those features are built on.

### Measuring distortion

Both audio suites compare a loud render against the same render 18 dB down, gain-matching each block by least squares before differencing. **The block length decides what is measured.** At 2048 samples one fitted gain cannot follow a limiter, so ordinary gain riding lands in the residual and hides everything else; at 128 samples the fit tracks the compressors and what remains is waveform distortion. Measured at 2048, deleting the saturator outright moved the number by 0.2 dB — measured at 128, by 12 dB. Use the short block for any claim about distortion.
