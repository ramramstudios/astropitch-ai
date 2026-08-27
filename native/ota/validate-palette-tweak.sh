#!/bin/sh
# Prove Phase 5 OTA with a trivial palette tweak (no native binary change).
# Packs baseline 1.0.0, mutates one palette blurb, packs 1.0.1, asserts policy.
set -e

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/native/ota/dist"
BASE="$DIST/1.0.0"
NEXT="$DIST/1.0.1"
WORK="$DIST/_palette-tweak-work"

rm -rf "$DIST"
mkdir -p "$DIST"

echo "== pack baseline 1.0.0 =="
sh "$ROOT/native/ota/pack-bundle.sh" 1.0.0 "$BASE" "file://$BASE/"

echo "== apply trivial palette tweak =="
rm -rf "$WORK"
mkdir -p "$WORK"
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
  "$ROOT/" "$WORK/"

export WORK NEXT ROOT BASE
node <<'EOF'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const work = process.env.WORK;
const outdir = process.env.NEXT;
const file = path.join(work, 'src/audio/palettes.js');
const src = fs.readFileSync(file, 'utf8');
const needle = "blurb: 'Smoother overtone-based voices with less noise and softer gestures.'";
const nextBlurb = "blurb: 'Smoother overtone-based voices with less noise and softer gestures. (ota-tweak)'";
if (!src.includes(needle)) {
  console.error('palette needle not found — update validate-palette-tweak.sh');
  process.exit(1);
}
fs.writeFileSync(file, src.replace(needle, nextBlurb));
console.log('tweaked harmonic palette blurb');

const version = '1.0.1';
const baseUrl = 'file://' + outdir + '/';
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

function copyFiltered(srcDir, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (name === '.git' || name === 'native' || name === 'research' || name === 'tests'
        || name === 'docs' || name === 'node_modules' || name.startsWith('TEMP-')) continue;
    if (name === 'CLAUDE.md' || name === '.DS_Store' || name === 'bundle.json') continue;
    const from = path.join(srcDir, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyFiltered(from, to);
    else fs.copyFileSync(from, to);
  }
}
copyFiltered(work, outdir);

fs.writeFileSync(path.join(outdir, 'bundle.json'), JSON.stringify({
  bundleVersion: version,
  shellVersion: 1,
  channel: 'stable',
  updateUrl: '',
}, null, 2) + '\n');

function walk(dir, rel = '') {
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === 'manifest.json') continue;
    const full = path.join(dir, name);
    const child = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) entries.push(...walk(full, child));
    else if (st.isFile()) entries.push(child);
  }
  return entries;
}

const files = walk(outdir).map((p) => ({
  path: p,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(outdir, p))).digest('hex'),
}));

fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  bundleVersion: version,
  minShellVersion: 1,
  channel: 'stable',
  rollout: 100,
  baseUrl,
  files,
}, null, 2) + '\n');
console.log('packed tweak →', outdir, `(${files.length} files)`);
EOF

echo "== policy check =="
node --input-type=module <<EOF
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseManifest, shouldApplyUpdate } from 'file://$ROOT/src/ota/policy.js';

const local = JSON.parse(readFileSync(join('$BASE', 'bundle.json'), 'utf8'));
const manifest = parseManifest(JSON.parse(readFileSync(join('$NEXT', 'manifest.json'), 'utf8')));
if (!manifest) {
  console.error('manifest failed to parse');
  process.exit(1);
}
const decision = shouldApplyUpdate({
  local,
  manifest,
  shellVersion: 1,
  deviceId: 'validate-palette-tweak',
});
if (!decision.apply || decision.reason !== 'newer') {
  console.error('expected apply/newer, got', decision);
  process.exit(1);
}
const a = readFileSync(join('$BASE', 'src/audio/palettes.js'), 'utf8');
const b = readFileSync(join('$NEXT', 'src/audio/palettes.js'), 'utf8');
if (a === b) {
  console.error('palette files identical — tweak did not land');
  process.exit(1);
}
if (!b.includes('(ota-tweak)')) {
  console.error('tweaked blurb missing from packed palettes.js');
  process.exit(1);
}
console.log('ok: policy applies 1.0.0 → 1.0.1 after palette blurb tweak');
EOF

rm -rf "$WORK"
echo "validation passed"
