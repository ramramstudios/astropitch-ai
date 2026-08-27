#!/bin/sh
# Copy the static web bundle into each native shell's www/ folder.
# Run from the repo root:  native/sync-www.sh
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SYNC() {
  dest="$1"
  mkdir -p "$dest"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'native' \
    --exclude 'research' \
    --exclude 'tests' \
    --exclude 'docs' \
    --exclude 'TEMP-*' \
    --exclude 'CLAUDE.md' \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    "$ROOT/" "$dest/"
  echo "synced → $dest"
}
SYNC "$ROOT/native/ios/AstroPitch/www"
SYNC "$ROOT/native/android/app/src/main/assets/www"
