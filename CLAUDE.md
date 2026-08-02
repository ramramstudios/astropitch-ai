# Claude Code Guidelines for astropitch-ai

## Commits

**IMPORTANT: Never automatically write commit messages or run `git commit` without explicit user request.**

Always ask the user if they want to commit changes, and if so, have them provide or approve the commit message. Do not assume you should commit work when a task completes.

- Exception: If a CLAUDE.md or .claude/settings.json explicitly authorizes auto-commit behavior with a specific message template, follow that config instead.

## Tests

- `node tests/performer.test.mjs` — run arrangement/scheduling tests (no audio needed)
- `tests/audio.test.html` — open in browser with dev server for OfflineAudioContext render tests

Manual listening QA required for audio features; no headless test runner is currently configured.
