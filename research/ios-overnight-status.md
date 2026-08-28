# iOS overnight status
Updated: 2026-08-28T00:00:00Z

## Done
- Baseline: fixed a stale assertion in `tests/designer.test.mjs`. It asserted a
  disabled body drops the element/modality balance by 1, but commit `caba7c8`
  ("element weight adjust") gave bodies weights (4/2/1). Pre-existing red on a
  clean tree; not caused by this session's work.

## Assumed (human must confirm)
- Phase 0.1 branch two: background audio dies at ~30 s on WKWebView, so
  `UIBackgroundModes: audio` is removed and Phase 3.3 (Now Playing) is skipped.
  **Not measured** — no device, no Xcode on this machine.

## Skipped on purpose
- (pending)

## Blocked (needs human / other machine)
- Xcode 26 archive, device QA, Apple Developer Program enrolment, ASC upload.
  macOS 12.7.6, no Xcode, no simulator, no device.

## Tests
- node tests: all green after the designer fix.
- browser suites: not started yet.

## Morning checklist
- (pending)
