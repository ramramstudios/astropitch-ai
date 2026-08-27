# Phase 5 — OTA web-bundle updates

Hand-rolled equivalent of Capacitor Live Updates / Capgo, sized for the thin
native shells. **Web layer and assets only** — never ship native behaviour
changes through this path (Apple 2.5.2 / Play dynamic-code carve-outs).

## Ownership

| Surface | Bundle owner |
|---|---|
| Browser PWA | Service worker (`sw.js`, hand-bumped `CACHE_NAME`) |
| iOS / Android shells | This OTA updater (`OtaUpdater` + `src/ota/`) |

`index.html` already skips SW registration when `__astropitchNativeShell` is set.

## Manifest shape

```json
{
  "schemaVersion": 1,
  "bundleVersion": "1.0.1",
  "minShellVersion": 1,
  "channel": "stable",
  "rollout": 25,
  "baseUrl": "https://updates.example.com/bundles/1.0.1/",
  "files": [
    { "path": "index.html", "sha256": "…" },
    { "path": "src/audio/palettes.js", "sha256": "…" }
  ]
}
```

- `rollout` — 0–100. Sticky device bucket (`astropitch.ota.deviceId`) must be `< rollout`.
- `minShellVersion` — bump only when the native bridge protocol changes; clients with an older shell skip the update.
- `channel` — must match `bundle.json`'s `channel` (default `stable`).

## Pack + publish

```sh
# From repo root — packs www assets into native/ota/dist/<version>/
sh native/ota/pack-bundle.sh 1.0.1 native/ota/dist/1.0.1 \
  https://updates.example.com/bundles/1.0.1/

# Host the directory at baseUrl. Point clients at the channel manifest:
# set updateUrl in the *embedded* bundle.json (or a stable pointer URL) to
# https://updates.example.com/stable.json
# where stable.json is a copy of (or redirect to) the latest manifest.
```

Embedded `bundle.json` at the repo root stamps the shipped version. Leave
`updateUrl` empty until you have a host; the JS client no-ops without it.

## Client flow

1. `startOtaCheck` runs from `app.js` only inside a native shell.
2. Loads local `bundle.json`, fetches `updateUrl`.
3. `shouldApplyUpdate` (pure policy) gates on channel, shell version, semver, rollout.
4. On apply: posts `{ ota: 'apply', manifest }` to the shell.
5. Native downloads each file, verifies SHA-256, atomically swaps
   `ota/versions/<ver>/`, reloads the WebView.
6. Rollback: `{ ota: 'rollback' }` restores `previous` or the embedded `www/`.

## Validate with a trivial palette tweak

Prove the pipeline before it matters:

```sh
sh native/ota/validate-palette-tweak.sh
```

That script packs `1.0.0`, applies a one-line palette blurb change, packs
`1.0.1`, and asserts the policy chooses apply. Host `dist/1.0.1/` + set
`updateUrl` on a device build to watch the shell reload onto the tweak.
