# iOS status — what is done and what is left

Branch `ios-ready` · updated 2026-08-28 · **the current state of AstroPitch's
App Store preparation.** (Named "overnight" because that is the run that
produced it; it is the live status document, not a session log.)

Everything in scope is done and committed, with all ten node suites and all
four browser suites green. Nothing is pushed. What remains needs a machine with
Xcode, a phone, or an Apple Developer account — jump to
**[What is left to do](#what-is-left-to-do)**.

**Related documents**

| | |
|---|---|
| Why each decision was made, with per-item status | `research/ios-app-store-plan.md` |
| App Store Connect copy, ready to paste | `research/ios-store-listing.md` |
| Build instructions, frozen settings, the JS↔native bridge | `native/ios/README.md` |
| Per-phase done/waived log, in the repo's usual shape | `outstanding.md` |

---

## Done

### Baseline
`tests/designer.test.mjs` was red on a clean tree before this session changed
anything: it asserted a disabled body drops the element/modality balance by 1,
but `caba7c8` ("element weight adjust") gave bodies weights of 4/2/1. Now
asserts against the weight the chart actually applies, so it keeps its meaning
if the weights move again.

### Phase 1 — reproducible Xcode project
- **`native/ios/AstroPitch.xcodeproj` is committed.** One target, iPhone-only,
  iOS 16.0, `SDKROOT = iphoneos`, `PRODUCT_BUNDLE_IDENTIFIER =
  com.ramramstudios.astropitch`, `GENERATE_INFOPLIST_FILE = NO` with
  `INFOPLIST_FILE` pointed at the checked-in plist.
- **`www/` is a folder reference** (`lastKnownFileType = folder`), not a group.
  A group flattens `src/audio/*.js` into the bundle root and
  `resolveEmbeddedWww()` launches to a blank screen.
- **"Sync www" run-script phase** (`"$SRCROOT/../sync-www.sh"`) sits ahead of
  Copy Bundle Resources with `alwaysOutOfDate = 1`, so a fresh clone's empty
  `www/` is filled every build rather than depending on someone remembering.
- Shared scheme committed, so Run and Archive work on a clean clone.
- UIKit / WebKit / AVFoundation / CryptoKit are resolved by the Swift importer
  from the SDK; no explicit link entries, and MediaPlayer is deliberately
  absent (Phase 3.3 is skipped).
- Verified with `plutil -lint` plus a graph walk: valid plist, 29 unique object
  ids, zero dangling references, build phases in the required order, and every
  `PBXFileReference` path resolving to a file that exists.
- **`tests/native.test.mjs`** (new): version lockstep, shell-version lockstep,
  Info.plist keys, privacy manifest, project shape, asset catalogue, the Swift
  surface, and that every module the app imports is in `sw.js`'s `SHELL_FILES`.
- `native/ios/README.md` rewritten: open the project, don't hand-build it.

### Phase 2 — Info.plist, privacy, compliance
- `UILaunchScreen` dictionary replaces the empty `UILaunchStoryboardName`.
- `UIRequiredDeviceCapabilities` (armv7) deleted.
- `ITSAppUsesNonExemptEncryption = false` added.
- `UIBackgroundModes` removed — see **Assumed**.
- **Version lockstep fixed.** `CFBundleShortVersionString` was `1.0` against
  `bundle.json`'s `1.0.0`; now `1.0.0`, and `sw.js` `CACHE_NAME` is
  `astropitch-1.0.0`. `CFBundleVersion` stays the integer `1`.
- `PrivacyInfo.xcprivacy` created: no tracking, no tracking domains, no
  collected data types, no required-reason APIs.
- `Assets.xcassets`: `LaunchBackground.colorset` (light `#f4f4f2`, dark
  `#0b0b0b`, the same two values `manifest.json` uses) and a 1024×1024 AppIcon.
- `OtaUpdater.root` sets `isExcludedFromBackup = true` in the one place every
  OTA path is built from, so no root access can return an un-excluded directory.

**On the app icon:** it is a real icon, not a placeholder — the AP monogram
downsampled from the repo's own `favicon.png` (1254², sRGB, no alpha). Output
is 1024×1024, colour type 2 (RGB, no alpha channel), which is what the App
Store requires. The source already draws its own rounded corners in near-black;
Apple applies its own mask over that and the artwork is dark anyway, so it
composites correctly. **Still worth a human look before upload** — it has never
been seen on a home screen.

### Phase 3.1 — native launch, no browser chrome
`scrollView.bounces`, `alwaysBounceVertical`, and `alwaysBounceHorizontal` all
off. Kept: `isOpaque = false`, black background,
`contentInsetAdjustmentBehavior = .never`, file-URL-only navigation with
everything else opened in Safari.

### Phase 3.2 — haptics on the designer wheel
- `hapticTicksForDrag(from, to)` (pure) and `createHapticDrag()` (stateful, one
  per drag) in `src/audio/native-bridge.js`; `notifyNativeHaptic(kind)` posts
  `{ haptic: 'impact' | 'selection' }`.
- `impact` when a body crosses a sign boundary (a multiple of 30°),
  `selection` on each whole degree. Wrap-safe across 0° in both directions. A
  degree that is also a boundary fires only the impact — two ticks at one
  longitude read as one mushy one.
- **Capped at 4 ticks per update.** The wheel already emits one `designerMove`
  per animation frame, but a flick covers a hundred degrees inside one frame,
  and queueing a hundred generator calls means ticks arriving after the finger
  has stopped. Past the cap the sign changes are kept and the degrees dropped,
  which is what the hand can still resolve.
- **Bug found and fixed while wiring this:** `postToNative` matched only the
  Android `setPlaying` / `ota` branches, so a haptic payload would have fallen
  through both without reaching the webkit handler — i.e. silently dead on the
  one platform with a Taptic engine. Covered by a test now.
- Swift: `UIImpactFeedbackGenerator(style: .light)` and
  `UISelectionFeedbackGenerator` as stored properties, re-prepared after each
  fire. Light rather than medium — at one tick per degree, medium is a rumble.
- Wired to both body drags and ASC/MC angle drags; anchored on drag start,
  released on commit and cancel.

### Phase 3.4 — chart share sheet
- New `src/ui/share.js`. The wheel is styled entirely from `styles.css`, so
  serialising the live node yields a picture that renders as nothing anywhere
  else — **baking the computed styles onto the clone is the substance here.**
  Only the ~19 properties a static SVG can act on are baked; copying whole
  computed styles across a few hundred nodes produces megabytes of layout the
  image ignores and Safari is slow to rasterise.
- Rasterised to PNG at 2× through an offscreen canvas, with the SVG passed as a
  data URL (a blob URL taints the canvas in some WebKit versions and `toBlob`
  then throws — exactly the platform this feature exists for). Falls back to
  sharing the SVG if rasterisation fails.
- Composites onto the page's own background first, or a dark-theme wheel
  arrives as invisible strokes on a light Messages bubble.
- `{ share: { type, filename, base64 } }` → `UIActivityViewController`, written
  to a per-share temp directory and cleaned up in the completion handler.
- **The filename is user-derived** (the chart label carries a birth place). It
  is slugged in JS, revalidated before posting, and reduced to
  `lastPathComponent` again in Swift — the native side owns the filesystem and
  should not take the page's word for it.
- Browser fallback: Web Share where available, otherwise a download.

### Phase 3.5 — WAV bounce (the stretch item; it landed)
- New `src/audio/bounce.js`. The engine already accepts an injected context
  (it is how `tests/audio.test.html` renders), so a bounce is a second,
  throwaway engine and performer on an `OfflineAudioContext`. **Nothing touches
  the live engine** — what is playing keeps playing while a bounce runs, and
  there is a test asserting the shared engine never acquires a context.
- **Only Bloom and Scalar.** Both schedule every voice up front against
  `engine.now` and stop. Drone and Melodic are open-ended loops on a 25 ms
  audio-clock ticker that an offline context never advances; rendering them
  means shimming the page's global `setInterval`/`setTimeout` and draining a
  queue from `ctx.suspend()`. `tests/polyphony.test.html` does exactly that
  because a test harness may own the page's globals — an app patching global
  timers underneath a live transport to produce a file is not a trade worth
  making. The loop modes throw rather than rendering wrong, and the button
  names the mode it will render instead of silently doing something else.
- 44.1 kHz 16-bit stereo PCM WAV (not float — some destinations play float WAV
  as noise). Trailing silence trimmed, 10 ms fades at both seams, samples
  clamped before scaling so a value a hair over 1.0 clips rather than wrapping
  to full-scale negative.
- Delivered through the same `deliver()` as the chart image; the only
  difference between them is the bytes.
- `tests/bounce.test.html` (new) is the check the pure tests cannot make: that
  the file **contains audio**. Every header and clipping assertion in
  `mobile.test.mjs` would pass just as well for a minute of silence. Measured:
  Bloom 18.63 s, peak 0.950, 94 % of samples above the floor; Scalar 18.48 s,
  peak 0.962, 94 %. Both start and end at digital silence, neither clips.

### Phase 6 — store listing drafted in-repo
- `research/ios-store-listing.md`: name, subtitle, promotional text,
  description, keywords, URLs, copyright, the full age-rating questionnaire
  with answers, the privacy nutrition label, the review notes, a six-frame
  screenshot shot list with captions and capture notes, and an app-preview
  suggestion. **Character counts were counted, not estimated** — name 10/30,
  subtitle 26/30, promo 147/170, description 1,997/4,000, keywords 80/100.
- `docs/privacy.html`: a real two-sentence policy page, theme-aware, no
  tracking. **Needs hosting** before submit — the field is required.

---

## Assumed (human must confirm)

**Phase 0.1, branch two — background audio.** `UIBackgroundModes: audio` is
removed and Phase 3.3 (Now Playing) skipped, on the assumption that Web Audio
dies at ~30 s when WKWebView's WebContent process suspends. That is the
long-standing WebKit behaviour (bug 203293, unfixed since iOS 13), and
declaring a background mode the app does not actually use is a Guideline 2.5.4
rejection.

**This was not measured.** No Xcode, no simulator, no device on this machine.

Confirm on a real device before the first upload. If audio *does* survive, the
decision inverts: restore `UIBackgroundModes` **and** add Now Playing /
`MPRemoteCommandCenter`, because background audio with no lock-screen transport
is itself a review smell.

`src/audio/lifecycle.js` already fades out and disposes voices on background,
so "playback pauses when you leave the app" is the shipped behaviour either way.

---

## Skipped on purpose

| | Why |
|---|---|
| Phase 3.3 Now Playing / `MPRemoteCommandCenter` | Follows from 0.1 branch two. `MediaPlayer` is not linked and a test asserts it stays that way |
| Phase 3.6 App Intents / widgets | Post-1.0; real work, not a v1.0 blocker |
| Phase 0.2 OTA | `bundle.json` `updateUrl` stays `""`. One fewer thing doing network I/O during review, and the shipped bundle is unambiguously what the reviewer sees. Turn it on in 1.0.1 |
| iPad | iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), no `~ipad` orientations key. Halves the screenshot and QA surface |
| Android | Untouched |
| Drone / Melodic bounce | See Phase 3.5 above — refused rather than rendered wrong |

---

## Blocked (needs a human or another machine)

This Mac is **macOS 12.7.6 with no Xcode**: no `xcodebuild`, no Simulator, no
device.

- **The project graph and the tests are verified; the compile is not.** Nothing
  here has been through a Swift compiler. The Swift edits are small and
  conventional, but treat the first Xcode build as the real check.
- Archive, codesign, TestFlight, upload.
- Apple Developer Program enrolment (Phase 5).
- App Store Connect record, screenshots, preview video (6.4–6.5, 7).
- Device QA (4.2–4.3): the listening pass, interruption, route change, airplane
  mode from cold launch, safe areas. `CLAUDE.md` is explicit that the automated
  suites measure level and distortion, not whether something sounds good, and
  that headless Chrome's null sink is not a phone DAC.
- Measuring background-audio survival (the 0.1 spike).
- **Manual QA of the two new UI controls.** Share and Bounce are covered by
  pure-logic tests and, for the bounce, a real offline render — but nobody has
  tapped either button in a browser, let alone on a phone.

---

## Tests

**Node — all ten green:**

```sh
node tests/performer.test.mjs && node tests/engine.test.mjs && \
node tests/mobile.test.mjs && node tests/ui-state.test.mjs && \
node tests/designer.test.mjs && node tests/palettes.test.mjs && \
node tests/ephemeris.test.mjs && node tests/synastry.test.mjs && \
node tests/ota.test.mjs && node tests/native.test.mjs
```

**Browser suites:**

| Suite | Result |
|---|---|
| `tests/audio.test.html` (1800 s) | **PASS** |
| `tests/polyphony.test.html` (2400 s) | **PASS** |
| `tests/bounce.test.html` (300 s) — new | **PASS** |
| `tests/stability.test.html` | **PASS**, but only at a raised budget — see below |

**All four pass.** Stability first timed out at the 180 s budget `CLAUDE.md`
documented, having reached "Voice and node census: 20 enter/exit cycles" with
`drops 0` and `ratio 1.000` on every check printed before the cut. Re-run at
600 s it finished clean: polyphony never exceeded 24/24 across five
hide/show, interrupt/resume and rebuild cycles, and the live node count stayed
flat (baseline 26, max 28, slack 8). Not a regression — this work touches none
of `engine.js`, `voices.js`, `performer.js`, `scheduler.js`, `palettes.js`, or
`tuning.js`, the suite's entire subject. The 180 s figure was simply optimistic
for this machine; `CLAUDE.md` now says 600.

`CLAUDE.md` has been updated with `tests/native.test.mjs` and
`tests/bounce.test.html`.

---

## What is left to do

In order. Items 1–3 unblock everything else.

1. **Enrol in the Apple Developer Program** if not already — $99/yr, and it is
   the longest-lead item. Individual avoids the D-U-N-S dependency entirely.
   Enable 2FA on the Apple ID first. Nothing else is blocked by this, so start
   it before the rest of this list.
2. **Open `native/ios/AstroPitch.xcodeproj` in Xcode 26 and Run.** This is the
   first time the Swift will have seen a compiler. Confirm the app launches to
   the wheel with no manual copy step — the run-script phase should populate
   `www/` on its own.
3. **Confirm background audio dies on a real device.** Start Drone, lock the
   screen, time how long `AudioContext.currentTime` keeps advancing. If it
   survives, reopen the Phase 0.1 decision (restore `UIBackgroundModes`, add
   Phase 3.3) before uploading.
4. **Look at the app icon on a home screen.** It is real artwork, not a
   placeholder, but it has never been seen at icon size on a device.
5. **Tap Share and Bounce** on a device. The bounce is verified to produce real
   audio; the share sheet and the file that comes out of it are not.
6. **Host `docs/privacy.html`** somewhere public and put the URL in App Store
   Connect. GitHub Pages on this repo gives
   `https://ramramstudios.github.io/astropitch-ai/privacy.html`.
7. **Confirm or change the bundle ID.** `com.ramramstudios.astropitch` is
   frozen in the project and can never change after the first upload. Change it
   now if a different domain is owned.
8. **Create the App Store Connect record**, answer the age questionnaire (the
   answers are in `research/ios-store-listing.md`; it gates submission), and
   set the privacy label to Data Not Collected.
9. **Capture screenshots** — the six-frame shot list with captions is in the
    listing draft. 6.9" iPhone, 1320 × 2868, RGB, no alpha.
10. **TestFlight**, then the device QA matrix in Phase 4.2 of the plan:
    listening pass on all four modes and both palettes, interruption, route
    change, airplane mode from cold launch, safe areas, cold-start stutter.
11. **Submit**, with the review notes from the listing draft pasted verbatim.
    They are the highest-leverage text in the submission.
