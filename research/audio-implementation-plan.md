# Audio Implementation Plan — Hardening & Mobile Migration

**Date:** 2026-08-26
**Decision:** Keep the native Web Audio node graph in `src/audio/`. See
`research/audio-engine-options.md` for why no alternative engine wins.

This plan has two jobs: make the audio robust on mobile, and make sure that after the app is
in the stores we can still add a Bloom/Scalar/Drone/Melodic-style mode — or a new palette — as a
JavaScript change, without a native release.

---

## Phase 1 — Replace timer-driven timing with an audio-clock scheduler

**The defect.** Musical timing runs on main-thread timers:

- `src/audio/performer.js:718` — melodic phrase loop, `setInterval(phraseBeats * beat * 1000)`
- `src/audio/performer.js:796` — drone bed refresh, `setInterval(CYCLE * 1000)` (24 s)
- `src/audio/performer.js:797` — shimmer, `setInterval(2600)`

Mobile WebViews throttle exactly these. A 24-second drone refresh interval is far outside any
throttle guarantee — on a backgrounded or busy device the bed simply doesn't refresh on time, and
envelopes run out underneath it. Timers also drift against `ctx.currentTime`, so the drift the
`CYCLE` refresh exists to correct is partly caused by the timer doing the correcting.

**The fix.** One scheduler, the standard two-clocks pattern:

- A single `setInterval` at ~25 ms whose only job is to look ahead ~150 ms on `ctx.currentTime` and
  schedule everything falling inside that window.
- Modes stop calling `setInterval` themselves. They register a callback that answers *"what sounds
  between t0 and t1?"* — pure, testable, and unaffected by when it is asked.
- Throttling then costs scheduling headroom, not musical timing. A throttled tick that wakes late
  still schedules the same notes at the same audio-clock times.

**Why this is first.** It is the highest-value change in this document and it is a prerequisite for
Phase 2 — you cannot recover cleanly from a background/interrupt event while timing lives in
wall-clock intervals.

**Tests.** Pure logic, so it belongs in `tests/performer.test.mjs` with the existing arrangement
tests: feed a fake clock, assert the scheduled note times are identical whether ticks arrive on
time, late, or bunched.

---

## Phase 2 — Audio lifecycle layer

**The defect.** There is no `visibilitychange`, `pagehide`, or `statechange` handling anywhere in
the audio path (`src/audio/engine.js:239` resumes a suspended context on start, and that is all).

**What breaks, on both platforms:**

| Event | Current behaviour |
|---|---|
| App backgrounded | iOS WKWebView freezes the `AudioContext` after ~27 s; timers throttle; state desyncs |
| Incoming call / interruption | Context suspends, nothing releases voices, UI still shows playing |
| Headphones unplugged | Hardware sample rate can change under a live context |
| Cold start in WebView | First playback stutters while the audio route warms up |

**The fix.** A small lifecycle module owning the context:

1. On hide/suspend: stop the scheduler, release voices with a short fade, record the mode.
2. On resume: if the context is healthy, restart the scheduler and re-enter the recorded mode. If
   the sample rate changed or the context is `closed`, rebuild the graph and re-enter.
3. Emit lifecycle events so the transport UI can't show "playing" over silent audio.
4. Prime the context on first user gesture and keep a silent keep-alive path for cold start.

**Tests.** DOM-independent state transitions fit `tests/mobile.test.mjs`, which already covers
bottom-sheet state machines the same way.

---

## Phase 3 — Mode registry (the DX requirement)

**The defect.** Adding a fifth mode today means editing **seven** places across three files:

| # | Location | What it holds |
|---|---|---|
| 1 | `src/audio/performer.js` | the `async bloom()` / `scalar()` / `drone()` / `melodic()` method |
| 2 | `src/ui/app.js:301-305` | restart-mode dispatch map |
| 3 | `src/ui/app.js:1329-1332` | button click map |
| 4 | `src/ui/app.js:1365` | `aria-pressed` sync list |
| 5 | `src/ui/app.js:1850-1853` | keyboard shortcuts |
| 6 | `index.html:324-338` | four hand-written `<button>` blocks |
| 7 | `index.html:475` | the keyboard-help line |

Four of those are the same list of four strings, written four different ways. This is the thing to
fix if we want new sound features to stay cheap after launch.

**The fix.** One exported `MODES` array — the single source of truth:

```js
// src/audio/modes.js
export const MODES = [
  { id: 'bloom', label: 'Bloom', key: 'b', title: 'The chart opens like a flower…',
    schedule: bloomSchedule },
  // …
];
```

- `performer` dispatches on `MODES` instead of named methods.
- `app.js` builds the button map, `aria-pressed` sync, and key handler by iterating `MODES`.
- `index.html` gets one container; the four buttons are rendered from `MODES`.

**Result:** a new mode is *one object in one file*. That mirrors the separation already proven in
`palettes.js` (data) vs `voices.js` (renderer) — the best property of the current codebase and the
main reason we are not adopting Faust or Elementary.

**Tests.** `tests/mobile.test.mjs` already asserts app.js/index.html consistency for `MODE_QUERY`;
extend that pattern to assert every `MODES` entry has a rendered button and a bound key.

---

## Phase 4 — Native shells

Both shells stay thin. The JS engine is the audio implementation on both platforms.

**iOS (WKWebView)**
- `AVAudioSession` category `.playback`, activated **before** the WebView loads — this is the fix
  for the cold-start stutter.
- `UIBackgroundModes: audio` if audio must survive backgrounding; expect the ~27 s freeze anyway and
  treat Phase 2's rebuild-on-resume as the real answer.
- Bridge `WKScriptMessageHandler` events for background/foreground and `AVAudioSession`
  interruptions into the Phase 2 lifecycle module.

**Android (System WebView)**
- `setMediaPlaybackRequiresUserGesture(false)`.
- A foreground service with a declared `mediaPlayback` type if audio continues in background —
  Android 14+ requires the manifest declaration, a Play Console justification, and a demo video.
- Same JS bridge shape as iOS, so the lifecycle module has one interface.

**Do not** add a JavaScript interface that exposes native APIs to remote content — Play flags this,
and it would also drag us out of the OTA carve-out described below.

---

## Phase 5 — Post-deployment customizability

This is what makes the WebView architecture pay for itself.

- **Apple Guideline 2.5.2** bans downloaded code, but explicitly exempts scripts and code run by
  WebKit/JavaScriptCore, provided they don't change the app's primary purpose.
- **Google Play's** dynamic-code-loading rule carves out code running in an interpreter that doesn't
  give indirect access to Android APIs — JavaScript in a WebView.

New palettes in `palettes.js` and new modes in the Phase 3 `MODES` registry are JavaScript and
assets. **They ship over the air, without app review.** Had we moved DSP to AudioKit or Soundpipe,
every new timbre would be a native binary release.

To use this we need a versioned web-bundle update path (Capacitor Live Updates, Capgo, or a
hand-rolled equivalent) with staged rollout and rollback. Constraint: **web layer and assets only** —
the moment an update changes native behaviour, we lose the exemption.

**Note on `sw.js`.** The service worker caches the shell by a hand-bumped `CACHE_NAME` with no build
step. Inside a native shell that will fight an OTA updater for control of which bundle is live.
Decide one owner per platform before shipping — most likely: service worker for the web PWA, OTA
updater inside the apps.

---

## Sequencing

1. **Phase 1** — scheduler. Highest value, unblocks Phase 2.
2. **Phase 2** — lifecycle. Required before either store submission.
3. **Phase 3** — mode registry. Do it *before* shipping; retrofitting a registry after launch is
   harder than adding a fifth mode by hand.
4. **Phase 4** — shells.
5. **Phase 5** — OTA pipeline, validated with a trivial palette tweak before it matters.

## Out of scope, with revisit triggers

- **Faust as an additional voice type** — revisit if we want synthesis the current renderer can't
  express (physical modelling, granular). Add alongside `voices.js`; never replace palette-as-data.
- **AudioWorklet** — nothing in this plan needs it. If we ever do, device-test WKWebView first:
  failure reports run through iOS 16.x and I could not confirm current status.
- **Native DSP** — only if profiling on real devices shows a CPU ceiling. At ~10 oscillator/biquad
  voices, it will not.

## Verification still owed

Everything here is reasoned from the source and from published store policy. Before committing to
Phase 4, we need real-device measurements on both platforms: actual background freeze timing, cold
start behaviour, and drift over a 10-minute drone session.
