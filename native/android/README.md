# AstroPitch Android shell (System WebView)

Thin host for the static web app. Audio runs entirely in JS.

## Setup

1. From the repo root: `sh native/sync-www.sh`
2. Open `native/android` in Android Studio and sync Gradle.
3. Run on a device or emulator.

`MainActivity` sets `mediaPlaybackRequiresUserGesture(false)` and loads
`file:///android_asset/www/index.html`. While transport is playing, JS calls
`AstroPitchShell.setPlaying(true)` and the activity starts
`MediaPlaybackService` (`foregroundServiceType=mediaPlayback`).

## Bridge

Native → JS: `window.__astropitchNative.dispatch({ type: 'background'|'foreground'|'interrupt' })`

JS → native:
- `AstroPitchShell.setPlaying(boolean)` — mediaPlayback FGS
- `AstroPitchShell.ota(json)` — apply / rollback web bundles

No other native APIs are exposed to page content. OTA requires the `INTERNET`
permission (declared in the manifest) and HTTPS hosts (`usesCleartextTraffic=false`).

## Store note

Shipping the mediaPlayback FGS to Play requires a Console justification and a
demo video (Android 14+).
