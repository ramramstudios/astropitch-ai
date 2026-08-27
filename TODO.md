# Outstanding work

Single home for open work. The audio implementation and stability plans that
used to live in `research/` are done — their phases landed on `audio` and the
measured constants they produced live as source comments (`src/audio/engine.js`,
`src/audio/scheduler.js`, `src/ota/policy.js`, etc.), so the planning docs
themselves were deleted rather than kept as history.

## Feature TODOs

- [ ] **Full-screen mode.** An option that hides all chrome — controls rail,
  transport bar, tabs — so the wheel is the only thing on screen. For display
  use and for anyone who wants to just watch the chart, not the app around it.

## Manual QA owed

Automated suites measure state and levels, not perceived correctness or real
device behavior. These are known gaps, not regressions:

- **Device audio dropouts.** `tests/stability.test.html` runs a realtime
  `AudioContext` against headless Chrome's null sink, which does not reproduce
  a specific device's driver behaviour. Real underruns remain a listening check.
- **Native lifecycle on real hardware.** iOS background freeze (~27s WKWebView
  timeout), cold start audio-route warm-up, Bluetooth route changes mid-session,
  and drift over a long (~10 min) drone session — reasoned about in code, not
  yet measured on a device.
- **OTA apply/rollback on a device build.** `tests/ota.test.mjs` covers the
  policy logic; actually hosting a manifest and watching a native shell
  download/verify/swap/rollback a bundle has not been done.
- **Cross-browser audio quality.** Chromium-family browsers (Chrome, Brave) are
  the only engines with automated coverage (`tests/run-browser.mjs` only looks
  for Chrome/Chromium binaries). Firefox's Gecko/cubeb backend and its
  compressor/waveshaper implementations are untested here and have been
  reported to sound different (more "breakup") than Chromium on the same
  material — not something this codebase can fix, since there's no
  browser-specific code path today, but worth remembering if it comes up again.
- **UI-state smoke pass.** Partner-form defaults, overlay eligibility, the
  longitude accessible name, and tuning/volume persistence all have green
  automated coverage (`tests/ui-state.test.mjs`, `tests/overlay.test.html`,
  `tests/audio-preferences.test.html`); a manual pass on refresh/tab switching/
  audio start/keyboard focus has not been redone since.
