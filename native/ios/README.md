# AstroPitch iOS shell (WKWebView)

Thin host for the static web app. Audio runs entirely in JS.

## Setup

1. From the repo root: `sh native/sync-www.sh`
2. Create an Xcode iOS App project (Swift, Storyboard-free / no SwiftUI).
3. Set the bundle identifier, then replace generated sources with the files in
   `AstroPitch/`:
   - `AppDelegate.swift` — activates `AVAudioSession` `.playback` before load
   - `WebViewController.swift` — WKWebView + interruption bridge
   - `OtaUpdater.swift` — versioned web-bundle download / swap / rollback
   - `Info.plist` — includes `UIBackgroundModes: audio`
4. Add the synced `AstroPitch/www` folder to the app target as a folder reference
   (blue folder) so `loadFileURL` can read `index.html` and `src/`.
5. Build & run on a device.

## Bridge

Native → JS: `window.__astropitchNative.dispatch({ type: 'background'|'foreground'|'interrupt' })`

JS → native: `webkit.messageHandlers.astropitch.postMessage({ playing })`
or `{ ota: 'apply'|'rollback', ... }` (no AVFoundation / filesystem APIs exposed)

Add `OtaUpdater.swift` to the app target alongside the other AstroPitch sources.
