# AstroPitch iOS shell (WKWebView)

Thin host for the static web app. All audio runs in JS; native code only
configures the audio session, forwards lifecycle events, and swaps OTA bundles.

`AstroPitch.xcodeproj` is committed and is the source of truth. **Do not
hand-create a project** — open this one.

## Build

```sh
git clone …
open native/ios/AstroPitch.xcodeproj
```

Select the `AstroPitch` scheme and Run. There are no manual copy steps: a
"Sync www" run-script phase invokes `native/sync-www.sh` ahead of Copy Bundle
Resources on every build, so `AstroPitch/www` is always the current web app.
That directory is gitignored (only `.gitkeep` is committed) — a fresh clone
starts empty and the build phase fills it. The phase deliberately has
dependency analysis turned off; shipping a stale `www/` is a Guideline 2.1
rejection and is the easiest way to waste a review cycle here.

`www` is in the project as a **folder reference** (blue folder), not a group. A
group would flatten `src/audio/*.js` into the bundle root and
`WebViewController.resolveEmbeddedWww()` would launch to a blank screen.

## Frozen decisions

| | |
|---|---|
| Bundle identifier | `com.ramramstudios.astropitch` — cannot change after first upload |
| Deployment target | iOS 16.0 |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`). No iPad screenshots, no `~ipad` orientations key |
| Version | `1.0.0` / build `1` |

**Uploads require Xcode 26 / the iOS 26 SDK** (mandatory for all App Store
uploads since 28 April 2026). The deployment target stays 16.0 — the SDK
requirement is about what you build *against*, not what it runs on.

Three copies of the version string have to agree: `CFBundleShortVersionString`
in `Info.plist`, `bundleVersion` in `bundle.json`, and the suffix of
`CACHE_NAME` in `sw.js`. `node tests/native.test.mjs` holds them together,
along with the Info.plist keys and the project shape.

## No background audio

`UIBackgroundModes` is deliberately absent. Web Audio in WKWebView stops when
the WebContent process suspends, and declaring a background mode the app does
not actually use is a Guideline 2.5.4 rejection. `src/audio/lifecycle.js` fades
out and disposes voices on background; playback pausing when you leave the app
is the intended v1.0 behaviour. Real background audio means moving the
mastering chain into AVAudioEngine, which is a rewrite, not a flag.

**This is assumed, not measured** — see `research/ios-overnight-status.md`. A
human must confirm the ~30 s death on a real device before the first upload.

## Sources

- `AppDelegate.swift` — activates `AVAudioSession` `.playback` before the
  WebView loads, so the route is warm and the first note does not stutter
- `WebViewController.swift` — WKWebView, interruption bridge, haptics, share sheet
- `OtaUpdater.swift` — versioned web-bundle download / verify / swap / rollback
- `Info.plist`, `PrivacyInfo.xcprivacy`, `Assets.xcassets`

## Bridge

Native → JS:

```js
window.__astropitchNative.dispatch({ type: 'background' | 'foreground' | 'interrupt' })
```

JS → native, via `webkit.messageHandlers.astropitch.postMessage(…)`:

```js
{ playing: boolean }
{ ota: 'apply', manifest } | { ota: 'rollback' }
{ haptic: 'impact' | 'selection' }
{ share: { type, filename, base64 } }
```

No AVFoundation or filesystem APIs are exposed to the page.
