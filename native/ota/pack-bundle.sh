#!/bin/sh
# Pack a versioned web bundle + OTA manifest for Phase 5.
#
# Usage (from repo root):
#   sh native/ota/pack-bundle.sh [version] [outdir] [baseUrl]
#
# Example:
#   sh native/ota/pack-bundle.sh 1.0.1 native/ota/dist/1.0.1 \
#     https://updates.example.com/bundles/1.0.1/
#
# Then host `outdir/` at `baseUrl` and publish `outdir/manifest.json`
# (or a channel pointer that redirects to it) as the clients' updateUrl.
set -e

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-}"
OUTDIR="${2:-}"
BASE_URL="${3:-}"

if [ -z "$VERSION" ]; then
  VERSION="$(node -e "console.log(require('$ROOT/bundle.json').bundleVersion)" 2>/dev/null || echo "1.0.0")"
  # Auto-bump patch when packing from the current stamp.
  VERSION="$(node -e "
    const p='$VERSION'.split('.').map(Number);
    while (p.length < 3) p.push(0);
    p[2] += 1;
    console.log(p.join('.'));
  ")"
fi

if [ -z "$OUTDIR" ]; then
  OUTDIR="$ROOT/native/ota/dist/$VERSION"
fi

if [ -z "$BASE_URL" ]; then
  BASE_URL="./"
fi

# Ensure trailing slash on baseUrl for the manifest.
case "$BASE_URL" in
  */) ;;
  *) BASE_URL="$BASE_URL/" ;;
esac

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

# Same exclusions as native/sync-www.sh — web layer and assets only.
rsync -a \
  --exclude '.git' \
  --exclude 'native' \
  --exclude 'research' \
  --exclude 'tests' \
  --exclude 'docs' \
  --exclude 'TEMP-*' \
  --exclude 'CLAUDE.md' \
  --exclude '.DS_Store' \
  --exclude 'node_modules' \
  --exclude 'bundle.json' \
  "$ROOT/" "$OUTDIR/"

# Stamp the packaged bundle with the new version. Leave updateUrl empty in the
# artifact — the channel pointer / hosting config supplies the live manifest URL.
export OUTDIR VERSION BASE_URL
node <<'EOF'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const outdir = process.env.OUTDIR;
const version = process.env.VERSION;
const baseUrl = process.env.BASE_URL;

const bundle = {
  bundleVersion: version,
  shellVersion: 1,
  channel: 'stable',
  updateUrl: '',
};
fs.writeFileSync(path.join(outdir, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');

function walk(dir, rel = '') {
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.' || name === '..' || name === 'manifest.json') continue;
    const full = path.join(dir, name);
    const child = rel ? rel + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) entries.push(...walk(full, child));
    else if (st.isFile()) entries.push(child);
  }
  return entries;
}

const files = walk(outdir).map((p) => {
  const buf = fs.readFileSync(path.join(outdir, p));
  return {
    path: p,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
});

const manifest = {
  schemaVersion: 1,
  bundleVersion: version,
  minShellVersion: 1,
  channel: 'stable',
  rollout: 100,
  baseUrl,
  files,
};
fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('packed ' + files.length + ' files → ' + outdir);
console.log('bundleVersion ' + version);
console.log('manifest ' + path.join(outdir, 'manifest.json'));
EOF
