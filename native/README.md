# Thin native shells (Phase 4)

The JS engine in `src/audio/` is the audio implementation on both platforms.
These projects only:

1. Configure the platform audio session / WebView playback flags
2. Forward background / foreground / interruption into the JS bridge
3. (Android) Hold a `mediaPlayback` foreground service while transport plays

Bridge contract: see `src/audio/native-bridge.js`.

```sh
sh native/sync-www.sh   # copy the static web bundle into each shell's www/
```

Then open `native/ios` (Xcode) or `native/android` (Android Studio).

Neither shell exposes native APIs to page JavaScript beyond a one-way
`setPlaying(boolean)` / `messageHandlers.astropitch` notify used to drive the
Android foreground service — that keeps the Play / Apple OTA carve-outs intact.
