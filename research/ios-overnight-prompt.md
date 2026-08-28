# Overnight run: finish every feasible item in `research/ios-app-store-plan.md`

You are Claude Code, running unattended overnight on the AstroPitch repo until either the in-scope work is done or you run out of usage. Do not wait for a human. Do not ask clarifying questions. Decide, implement, test, commit, update the status log, and continue.

Read `research/ios-app-store-plan.md` in full, then this file, then the existing native/JS sources, then start Phase 1. Do not re-litigate decisions the plan already made.

## Authorization (overrides `CLAUDE.md` for this session only)

`CLAUDE.md` says not to commit without asking. **This session is the ask.** After each completed phase (and after any fix that restores green tests), create a git commit with a concise message that says why, not what. Do not `git push`. Do not amend. Do not skip hooks. Do not commit secrets. Do not update git config.

Write progress continuously to `research/ios-overnight-status.md` so a human can see what landed if the session dies.

## Machine limits — do not block on these

This Mac is macOS 12.7.6 (Monterey). There is **no Xcode**, no `xcodebuild`, no Simulator, no device. You cannot archive, codesign, run TestFlight, or measure background audio on a phone.

That does **not** mean skip the Xcode project. Generate a valid committed `.xcodeproj` a machine with Xcode 26 can open. Verify structure with file inspection and tests, not with `xcodebuild`. Record the SDK/archive gap in the status log as human follow-up.

## Decisions already made — do not reverse them

1. **Phase 0.1 — assume branch two.** Background audio dies at ~30s on WKWebView. For v1.0: **remove `UIBackgroundModes: audio`**. Do **not** implement Now Playing / `MPRemoteCommandCenter` (Phase 3.3). `src/audio/lifecycle.js` already fades out and `disposeAll()`s on background; that is the intended v1.0 behaviour. Log Phase 0.1 as **assumed, not measured** — a human must confirm on device before first upload.
2. **Phase 0.2 — leave `bundle.json` `"updateUrl": ""`.** Do not invent an OTA host.
3. **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`). No iPad screenshots, no iPad-specific orientations key.
4. **Deployment target iOS 16.0.** Bundle ID: `com.ramramstudios.astropitch` (GitHub org is `ramramstudios`). Freeze it in the project and the status log. A human can change it before first upload if they own a different domain; do not bikeshed.
5. **Version lockstep:** `CFBundleShortVersionString`, `bundle.json` `bundleVersion`, and `sw.js` `CACHE_NAME` must agree. Use **`1.0.0`**. Set `CACHE_NAME` to `astropitch-1.0.0`. `CFBundleVersion` (build) stays an integer, start at `1`.
6. **No new permissions, no tracking, no network from page JS.** Privacy nutrition label is Data Not Collected.

## Out of scope — do not attempt, do not stall

- Apple Developer Program enrolment (Phase 5)
- App Store Connect record, upload, screenshots of a running device, preview video (Phases 6.4–6.5, 7)
- TestFlight / real-device QA (Phase 4.2–4.3)
- Measuring background-audio survival (Phase 0.1 spike)
- Phase 3.3 Now Playing
- Phase 3.6 App Intents / widgets
- Android
- Push, deep links, IAP, login, remote-URL wrappers
- Rewriting the audio engine into AVAudioEngine
- Changing how the web app sounds

Draft store copy **in the repo** (see Phase 6 below). Do not try to click App Store Connect.

## In scope — complete all of this

Work in this order. Do not start a later phase until the earlier one is committed and its tests pass.

### Phase 1 — Reproducible Xcode project

Today `native/ios/README.md` tells a human to hand-create a project. There is no `.xcodeproj`. Fix that.

**1.1** Create and commit `native/ios/AstroPitch.xcodeproj`.

- iOS App, Swift, no storyboard, no SwiftUI. `@main` is already on `AppDelegate`.
- Sources already in the repo: `AppDelegate.swift`, `WebViewController.swift`, `OtaUpdater.swift`, `Info.plist`.
- PRODUCT_BUNDLE_IDENTIFIER = `com.ramramstudios.astropitch`
- IPHONEOS_DEPLOYMENT_TARGET = 16.0
- TARGETED_DEVICE_FAMILY = 1 (iPhone)
- SDKROOT = iphoneos (Xcode 26 on the build machine will pick the iOS 26 SDK)
- Generate Info.plist from the file in `AstroPitch/Info.plist` (`GENERATE_INFO_PLIST_FILE = NO`, `INFOPLIST_FILE` pointed at that file)
- Prefer a checked-in `project.yml` plus generated `.xcodeproj` if you add XcodeGen as a documented optional tool — but a fresh clone must open the `.xcodeproj` with **no extra install**. The `.xcodeproj` is the source of truth that must be committed.
- UUID hygiene: unique IDs, correct PBXFileReference / PBXBuildFile / PBXSourcesBuildPhase / PBXResourcesBuildPhase / PBXFrameworksBuildPhase (UIKit, WebKit, AVFoundation, CryptoKit). Do not add MediaPlayer (that is 3.3, skipped).

**1.2** `www/` as a **folder reference** (blue folder, `PBXFileSystemSynchronizedRootGroup` or equivalent last-known Xcode folder-reference form — **not** a yellow group that flattens paths). `WebViewController.resolveEmbeddedWww()` needs `www/index.html` with `src/` underneath. `native/ios/AstroPitch/www/**` stays gitignored except `.gitkeep`. The folder reference still has to exist in the project.

**1.3** Run Script build phase **ahead of** Copy Bundle Resources:

```sh
"$SRCROOT/../sync-www.sh"
```

Uncheck / disable "based on dependency analysis" (`alwaysOutOfDate = 1` in the script phase). `sync-www.sh` already lives at `native/sync-www.sh` and copies the web bundle into `AstroPitch/www`.

**1.4** New `tests/native.test.mjs` in the existing `ok()` / `fails` style (see `tests/mobile.test.mjs` and `tests/ota.test.mjs`):

- `bundle.json` `bundleVersion` equals Info.plist `CFBundleShortVersionString`
- `OtaUpdater.shellVersion` equals the `__astropitchShellVersion` injected in `WebViewController` (both currently 1)
- Info.plist parses as XML and contains the Phase 2 keys: `UILaunchScreen` (and **not** empty `UILaunchStoryboardName`), no `armv7`, `ITSAppUsesNonExemptEncryption` = false, **no** `UIBackgroundModes`, `LSRequiresIPhoneOS`
- `PrivacyInfo.xcprivacy` exists and has `NSPrivacyTracking` false, empty collected-data and accessed-API arrays
- `project.pbxproj` exists; the iOS target is iPhone-only; the sync-www run-script phase is present
- `bundle.json` `updateUrl` is `""`

Wire `tests/native.test.mjs` so a human can run `node tests/native.test.mjs`. Do not add a test runner or package.json if the repo does not already have one.

**1.5** Rewrite `native/ios/README.md`: open the project, do not hand-build it. Note the Xcode 26 / iOS 26 SDK upload requirement, iPhone-only, bundle id, and that `www/` is produced by the run-script phase.

Acceptance of this phase: a human with Xcode 26 can `git clone`, open the project, Run, and get the wheel with no manual copy steps. You cannot prove the Run; you can prove the project graph and the tests.

### Phase 2 — Info.plist, privacy, compliance

Exact edits from the plan. Do all of them.

**2.1** Replace empty `UILaunchStoryboardName` with:

```xml
<key>UILaunchScreen</key>
<dict>
    <key>UIColorName</key>
    <string>LaunchBackground</string>
</dict>
```

Add `native/ios/AstroPitch/Assets.xcassets` to the target:

- `LaunchBackground.colorset` — light `#f4f4f2`, dark `#0b0b0b` (same as `manifest.json` `background_color` / `theme_color`)
- AppIcon 1024×1024. Rasterize from existing `favicon.svg` / `icon-512.png` if present (no rounded-rect mask; App Store does that). Source must be PNG, no alpha if Apple still rejects alpha on the 1024 marketing icon — follow current App Store icon rules. If you cannot produce a 1024 from existing assets, generate a solid `#0b0b0b` 1024 as a placeholder and flag it in the status log as needing the real icon before upload.

**2.2** Change `UIRequiredDeviceCapabilities` from `armv7` to `arm64`, or delete the key. Deleting is fine.

**2.3** Add `ITSAppUsesNonExemptEncryption` = false.

**2.4** Create `native/ios/AstroPitch/PrivacyInfo.xcprivacy` exactly as the plan specifies (no tracking, no collected types, no required-reason APIs). Add it to the target.

**2.5** iPhone-only, already decided. Do not add a `~ipad` orientations key.

**2.6** In `OtaUpdater.swift`, after creating the `ota/` directory, set `isExcludedFromBackup = true` on that URL via `URLResourceValues`. Do it in one place so every root access gets a directory that is already excluded.

### Phase 3 — Native surface (v1.0 minimum + share if time)

**3.1** In `WebViewController.swift`: `webView.scrollView.bounces = false` (and `alwaysBounceVertical` / `alwaysBounceHorizontal` false). Keep existing: `isOpaque = false`, black background, `contentInsetAdjustmentBehavior = .never`, file-URL-only navigation with everything else opened in Safari.

**3.2 Haptics — highest-value item, do not skip.**

Existing bridge: JS → native `webkit.messageHandlers.astropitch.postMessage(...)`. Today the Swift handler ignores non-OTA bodies (playing-state ack). Extend it.

- JS: add `notifyNativeHaptic(kind)` in `src/audio/native-bridge.js` alongside `notifyNativePlaying()`. Payload `{ haptic: 'impact' | 'selection' }`. No-op outside a native shell. Extend `postToNative` so a haptic payload is not swallowed by the Android `setPlaying` / `ota` branches.
- Swift: on `{ haptic: 'impact' }` fire `UIImpactFeedbackGenerator` (medium, or light if medium feels heavy for a wheel tick — pick one and use it consistently). On `{ haptic: 'selection' }` fire `UISelectionFeedbackGenerator`. Prepare generators once; do not allocate per tick.
- App: fire from Designer drag in `src/ui/wheel.js` / `src/ui/app.js`:
  - `'impact'` when a dragged body **crosses a sign boundary** (longitude crosses a multiple of 30°)
  - `'selection'` on each **whole-degree** step while dragging (longitude's floor changes)
  - Same for ASC/MC (and DSC/IC if they drag) angle drags
- Throttle so a fast flick cannot enqueue hundreds of impacts in one frame; one haptic per crossed boundary / per whole degree is correct, not per pointermove.
- Add unit tests for the boundary/degree crossing helpers (pure functions). Do not require a WebView to test the math.
- No new Info.plist permission. Haptics do not need one.

**3.4 Chart share sheet.** `wheel.js` already renders SVG. Add an export path:

- Serialise the current chart SVG, rasterise to PNG in JS (`Image` + canvas is fine; SVG blob is a fallback).
- New bridge message `{ share: { type: 'image/png', filename: string, base64: string } }` (or equivalent structured payload the Swift side can decode). Keep it in `native-bridge.js`.
- Swift: decode, write a temp file, present `UIActivityViewController` from `WebViewController`.
- UI: a Share control that is obvious on mobile (`data-mode="mobile"`) and does not clutter desktop. Use it to share the current wheel image. Filename from the chart name if one exists.
- Tests: the rasterise helper and the payload shape, without presenting UIKit.

**3.5 WAV bounce — stretch, only after 3.1, 3.2, and 3.4 are committed and tests pass.** `tests/audio.test.html` already renders through `OfflineAudioContext`. If you reach this: add a "bounce to WAV" action that offline-renders the current arrangement, encodes WAV, and hands it to the same share sheet. If it threatens to destabilise the engine or the overnight clock, **stop and log it as not done** rather than shipping a half-wired render. Do not change voice/palette/performer behaviour to make the bounce easier.

Skip 3.3 and 3.6.

### Phase 4.1 — Tests you can run here

After the engineering phases, run:

```sh
node tests/performer.test.mjs && node tests/engine.test.mjs && \
node tests/mobile.test.mjs && node tests/ui-state.test.mjs && \
node tests/designer.test.mjs && node tests/palettes.test.mjs && \
node tests/ephemeris.test.mjs && node tests/synastry.test.mjs && \
node tests/ota.test.mjs && node tests/native.test.mjs
```

Fix anything you broke. These are the contract.

**Do not start** the headless browser suites (`audio.test.html`, `polyphony.test.html`, `stability.test.html`) until every node test above is green **and** Phases 1–3.2 (and 3.4 if you did it) are committed. They are slow (budget ~1 hour+). If they fail for reasons unrelated to this work (null sink, Chrome missing), log the failure and do not burn the rest of the night retrying them. If Chrome is missing, skip and log.

### Phase 6 — Store listing, drafted in-repo (not uploaded)

Create `research/ios-store-listing.md` containing copy a human can paste into App Store Connect:

- App name (≤30): prefer `AstroPitch`
- Subtitle (≤30): `Your natal chart, as sound` (plan's suggestion; keep if it fits)
- Promotional text (≤170)
- Description (≤4000): adapt README "The idea"; 30° = 1 semitone is the hook; make the offline-instrument case without saying "website wrapper"
- Keywords (≤100 chars total, comma-separated, no spaces): lean synthesis, not horoscope-spam. Plan's seed: `synthesizer,ambient,generative,drone,microtonal,432,sonification,natal,ephemeris`
- Support URL: `https://github.com/ramramstudios/astropitch-ai`
- Copyright: `2026 Ram Ram Studios` unless the repo/README names a person; then use that
- Age rating answers aimed at **4+**, with the medical/wellness question answered honestly: astrology is not a health claim. List the questionnaire answers you would give.
- Privacy nutrition label: **Data Not Collected** everywhere, consistent with `PrivacyInfo.xcprivacy`
- Review notes: use the plan's 7.2 text (the airplane-mode / 144 voices paragraph). Explicitly: no demo account needed.
- Screenshot shot list (the six frames in 6.4) with captions, so a human can capture them on device. You cannot capture them.

Also add `docs/privacy.html` — a real two-sentence privacy policy page (computed on device, nothing transmitted, nothing stored off-device). Support URL can stay GitHub; privacy policy URL needs this file hosted. Note in the status log that the human must put this URL somewhere public (GitHub Pages, or the repo `docs/` URL if Pages is on) before submit.

Do not invent health claims, accounts, or analytics in any metadata.

### Docs that must stay true

- `native/ios/README.md` rewritten (Phase 1.5)
- `native/ios/AstroPitch/Info.plist` matches Phase 2
- Status log lists every plan item as **done / assumed / skipped / blocked**, with the reason

## Working rules

- Match existing style. This repo is small, explicit, and allergic to frameworks. No SwiftUI, no CocoaPods, no SPM packages you do not need, no Capacitor, no extra native dependencies.
- Do not refactor the audio engine, performer, palettes, or ephemeris "while you are here."
- Do not expand Android.
- If a test you did not write is red, you broke it — fix it before continuing.
- If you are stuck on pbxproj XML for more than one serious attempt, simplify: one target, one Info.plist, folder reference, run script, asset catalog, four Swift/plist/privacy files. A boring project that opens beats a clever one that does not.
- Never idle. If a stretch item is risky, skip it, log it, start the next in-scope item.
- When in-scope work is complete, run the node tests one last time, update the status log with a "human morning checklist," and stop. The morning checklist must include: enrol in Apple Developer Program if not done; confirm background-audio death on a real device; open the project in Xcode 26; replace placeholder app icon if you used one; host `docs/privacy.html`; create the ASC record; screenshots; TestFlight.

## Status log format (`research/ios-overnight-status.md`)

Keep this file updated as you go, not at the end:

```
# iOS overnight status
Updated: <ISO time>

## Done
- …

## Assumed (human must confirm)
- Phase 0.1 branch two (UIBackgroundModes removed, 3.3 skipped)

## Skipped on purpose
- …

## Blocked (needs human / other machine)
- Xcode 26 archive, device QA, enrolment, ASC upload

## Tests
- node tests: …
- browser suites: …

## Morning checklist
- …
```
