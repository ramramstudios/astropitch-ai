# iOS overnight status
Updated: 2026-08-28 (session in progress)

## Done

**Baseline** — `tests/designer.test.mjs` asserted a disabled body drops the
element/modality balance by 1, but `caba7c8` gave bodies weights (4/2/1). Red on
a clean tree before this session touched anything; now asserts against the
weight the chart applies.

**Phase 1 — reproducible Xcode project**
- `native/ios/AstroPitch.xcodeproj` committed. One target, iPhone-only,
  iOS 16.0, `SDKROOT = iphoneos`, `com.ramramstudios.astropitch`,
  `GENERATE_INFOPLIST_FILE = NO` pointed at the checked-in `Info.plist`.
- `www/` is a folder reference (`lastKnownFileType = folder`), so
  `resolveEmbeddedWww()` still finds `src/` underneath instead of a flattened
  bundle root.
- "Sync www" run-script phase (`"$SRCROOT/../sync-www.sh"`) sits ahead of Copy
  Bundle Resources with `alwaysOutOfDate = 1`.
- Shared scheme committed so Run/Archive work on a fresh clone.
- Verified with `plutil -lint` + a graph walk: valid plist, 29 unique object
  ids, no dangling references, phases in the right order.
- `tests/native.test.mjs` — version lockstep, shell-version lockstep, plist
  keys, privacy manifest, project shape, assets, Swift surface.
- `native/ios/README.md` rewritten: open the project, don't hand-build it.

**Phase 2 — Info.plist, privacy, compliance**
- `UILaunchScreen` dict replaces the empty `UILaunchStoryboardName`.
- `UIRequiredDeviceCapabilities` (armv7) deleted.
- `ITSAppUsesNonExemptEncryption = false` added.
- `UIBackgroundModes` removed (see Assumed).
- `CFBundleShortVersionString` 1.0 → **1.0.0**; `sw.js` `CACHE_NAME` →
  `astropitch-1.0.0`. All three version copies now agree and are tested.
- `PrivacyInfo.xcprivacy` created: no tracking, no collected types, no
  required-reason APIs.
- `Assets.xcassets`: `LaunchBackground.colorset` (light `#f4f4f2`, dark
  `#0b0b0b`, matching `manifest.json`) and a **real** 1024×1024 AppIcon
  downsampled from the repo's `favicon.png` (1254², RGB, no alpha). Not a
  placeholder — but a human should still look at it before upload.
- `OtaUpdater.root` sets `isExcludedFromBackup = true` in the one place every
  OTA path is built from.

**Phase 3.1 — native surface**
- `scrollView.bounces` / `alwaysBounceVertical` / `alwaysBounceHorizontal` off.
- Kept: `isOpaque = false`, black background,
  `contentInsetAdjustmentBehavior = .never`, file-URL-only navigation.

**Phase 3.2 — haptics**
- `hapticTicksForDrag(from, to)` and `createHapticDrag()` in
  `src/audio/native-bridge.js`; `notifyNativeHaptic(kind)` posts
  `{ haptic: 'impact' | 'selection' }`.
- `impact` on a sign boundary (multiple of 30°), `selection` on each whole
  degree. Wrap-safe across 0°. A degree that is also a boundary fires only the
  impact.
- Capped at 4 ticks per frame; past the cap the sign changes are kept and the
  degrees dropped, so a flick does not queue haptics that outlive the gesture.
- `postToNative` no longer lets the Android `setPlaying` / `ota` branches
  swallow a haptic payload.
- Swift: prepared `UIImpactFeedbackGenerator(.light)` and
  `UISelectionFeedbackGenerator` as stored properties, re-prepared after each
  fire. Light rather than medium — at one per degree, medium is a rumble.
- Wired to `designerMove` / `designerAngleMove`, anchored on drag start,
  released on commit and cancel, for both body and ASC/MC drags.
- Tests in `tests/mobile.test.mjs` cover the pure crossing math, the stateful
  driver, the payload shape, the Android fall-through, and the app.js wiring.

## Assumed (human must confirm)
- **Phase 0.1, branch two.** Background audio is assumed to die at ~30 s on
  WKWebView (the long-standing WebContent-suspension behaviour), so
  `UIBackgroundModes: audio` is removed and Phase 3.3 (Now Playing) is skipped.
  **This was not measured** — no Xcode, no simulator, no device on this machine.
  Confirm on a real device before the first upload. If audio does survive, the
  decision inverts: restore the background mode *and* add Now Playing, because
  background audio with no lock-screen transport is itself a review smell.

## Skipped on purpose
- Phase 3.3 Now Playing / `MPRemoteCommandCenter` — follows from 0.1 branch two.
  `MediaPlayer` is deliberately not linked, and a test asserts that.
- Phase 3.6 App Intents / widgets — post-1.0.
- Phase 0.2 — `bundle.json` `updateUrl` stays `""`. One fewer thing doing
  network I/O during review; turn OTA on in 1.0.1.
- iPad — iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), no `~ipad` orientations key.
- Android is untouched.

## Blocked (needs human / other machine)
- Anything requiring Xcode: build, archive, codesign, Simulator, TestFlight.
  This machine is macOS 12.7.6 with no Xcode installed. The project graph and
  the tests are verified; **the compile is not**.
- Apple Developer Program enrolment, App Store Connect record, upload,
  screenshots, preview video, device QA (Phases 4.2–4.3, 5, 6.4–6.5, 7).
- Measuring background-audio survival (Phase 0.1 spike).

## Tests
- node tests: all ten green — performer, engine, mobile, ui-state, designer,
  palettes, ephemeris, synastry, ota, native.
- browser suites: not started yet.

## Morning checklist
- (written at the end of the session)
