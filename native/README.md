# Thin native shells (Phase 4) + OTA (Phase 5)

The JS engine in `src/audio/` is the audio implementation on both platforms.
These projects only:

1. Configure the platform audio session / WebView playback flags
2. Forward background / foreground / interruption into the JS bridge
3. (Android) Hold a `mediaPlayback` foreground service while transport plays
4. Download / verify / swap versioned web bundles (OTA)

Bridge contract: see `src/audio/native-bridge.js`.
OTA: see `native/ota/README.md`.

```sh
sh native/sync-www.sh          # copy the static web bundle into each shell's www/
sh native/ota/pack-bundle.sh   # build a versioned OTA artifact + manifest
```

Then open `native/ios` (Xcode) or `native/android` (Android Studio).

**Bundle ownership:** service worker for the browser PWA; OTA updater inside
the apps. Neither shell exposes native device APIs to page JavaScript beyond
`setPlaying` / OTA apply-rollback — that keeps the Play / Apple OTA carve-outs
intact.
