/**
 * Phase 5 OTA policy + client wiring checks (no network / no native shell).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  compareVersions,
  parseManifest,
  rolloutBucket,
  shouldApplyUpdate,
} from '../src/ota/policy.js';
import { startOtaCheck } from '../src/ota/client.js';
import {
  isNativeShell,
  requestNativeOtaApply,
  requestNativeOtaRollback,
} from '../src/audio/native-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fails = 0;
function ok(label, cond, detail = '') {
  if (cond) console.log(`  ok — ${label}`);
  else {
    fails += 1;
    console.log(`  FAIL — ${label}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('\n--- ota policy: version compare ---');
{
  ok('equal versions', compareVersions('1.0.0', '1.0.0') === 0);
  ok('patch newer', compareVersions('1.0.1', '1.0.0') === 1);
  ok('patch older', compareVersions('1.0.0', '1.0.1') === -1);
  ok('minor vs patch', compareVersions('1.1.0', '1.0.99') === 1);
  ok('uneven length', compareVersions('2', '1.9.9') === 1);
}

console.log('\n--- ota policy: rollout bucket is sticky ---');
{
  const a = rolloutBucket('device-alpha');
  const b = rolloutBucket('device-alpha');
  const c = rolloutBucket('device-beta');
  ok('same id → same bucket', a === b);
  ok('bucket in 0..99', a >= 0 && a < 100);
  ok('distinct ids can differ', typeof c === 'number');
}

console.log('\n--- ota policy: parseManifest ---');
{
  const good = parseManifest({
    schemaVersion: 1,
    bundleVersion: '1.0.1',
    baseUrl: 'https://example.com/b/1.0.1',
    files: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
  });
  ok('accepts valid manifest', !!good && good.baseUrl.endsWith('/'));
  ok('defaults rollout to 100', good.rollout === 100);
  ok('rejects path escape', parseManifest({
    schemaVersion: 1,
    bundleVersion: '1',
    baseUrl: 'https://x/',
    files: [{ path: '../etc/passwd', sha256: 'a'.repeat(64) }],
  }) === null);
  ok('rejects bad hash', parseManifest({
    schemaVersion: 1,
    bundleVersion: '1',
    baseUrl: 'https://x/',
    files: [{ path: 'a.js', sha256: 'nope' }],
  }) === null);
  ok('rejects wrong schema', parseManifest({
    schemaVersion: 2,
    bundleVersion: '1',
    baseUrl: 'https://x/',
    files: [{ path: 'a.js', sha256: 'a'.repeat(64) }],
  }) === null);
}

console.log('\n--- ota policy: shouldApplyUpdate ---');
{
  const local = { bundleVersion: '1.0.0', channel: 'stable', shellVersion: 1 };
  const manifest = parseManifest({
    schemaVersion: 1,
    bundleVersion: '1.0.1',
    minShellVersion: 1,
    channel: 'stable',
    rollout: 100,
    baseUrl: 'https://example.com/1.0.1/',
    files: [{ path: 'index.html', sha256: 'b'.repeat(64) }],
  });

  ok('applies newer on full rollout',
    shouldApplyUpdate({ local, manifest, shellVersion: 1, deviceId: 'any' }).apply === true);

  ok('skips same version',
    shouldApplyUpdate({
      local,
      manifest: { ...manifest, bundleVersion: '1.0.0' },
      shellVersion: 1,
      deviceId: 'any',
    }).reason === 'not-newer');

  ok('skips older shell',
    shouldApplyUpdate({
      local,
      manifest: { ...manifest, minShellVersion: 2 },
      shellVersion: 1,
      deviceId: 'any',
    }).reason === 'shell-too-old');

  ok('skips channel mismatch',
    shouldApplyUpdate({
      local,
      manifest: { ...manifest, channel: 'beta' },
      shellVersion: 1,
      deviceId: 'any',
    }).reason === 'channel-mismatch');

  // Force a hold: find an id whose bucket is >= 10 for rollout 10.
  let held = null;
  for (let i = 0; i < 500; i++) {
    const id = `hold-${i}`;
    if (rolloutBucket(id) >= 10) {
      held = shouldApplyUpdate({
        local,
        manifest: { ...manifest, rollout: 10 },
        shellVersion: 1,
        deviceId: id,
      });
      break;
    }
  }
  ok('rollout hold when bucket >= rollout', held && held.reason === 'rollout-hold');
}

console.log('\n--- ota client: no-ops outside native shell ---');
async function testClient() {
  const r = await startOtaCheck({ window: {}, fetch: async () => { throw new Error('no'); } });
  ok('not-native-shell', r.checked === false && r.error === 'not-native-shell');

  let posted = null;
  const win = {
    __astropitchNativeShell: true,
    __astropitchShellVersion: 1,
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
    },
    AstroPitchShell: {
      setPlaying() {},
      ota(raw) { posted = JSON.parse(raw); },
    },
  };
  ok('isNativeShell', isNativeShell(win));

  const local = { bundleVersion: '1.0.0', channel: 'stable', shellVersion: 1, updateUrl: 'https://u/m.json' };
  const remote = {
    schemaVersion: 1,
    bundleVersion: '1.0.2',
    minShellVersion: 1,
    channel: 'stable',
    rollout: 100,
    baseUrl: 'https://u/1.0.2/',
    files: [{ path: 'index.html', sha256: 'c'.repeat(64) }],
  };
  const fetchFn = async (url) => {
    if (String(url).includes('bundle.json')) {
      return { ok: true, json: async () => local };
    }
    return { ok: true, json: async () => remote };
  };
  const result = await startOtaCheck({ window: win, fetch: fetchFn, bundlePath: 'bundle.json' });
  ok('checked remote', result.checked === true && result.decision?.apply === true);
  ok('posted ota apply to shell', posted?.ota === 'apply' && posted?.manifest?.bundleVersion === '1.0.2');

  posted = null;
  ok('requestNativeOtaApply helper', requestNativeOtaApply(remote, win) === true && posted?.ota === 'apply');
  posted = null;
  ok('requestNativeOtaRollback helper', requestNativeOtaRollback(win) === true && posted?.ota === 'rollback');
}
await testClient();

console.log('\n--- ota: app wiring + ownership ---');
{
  const appSrc = readFileSync(join(__dirname, '../src/ui/app.js'), 'utf8');
  const htmlSrc = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const bundle = JSON.parse(readFileSync(join(__dirname, '../bundle.json'), 'utf8'));
  ok('app.js imports startOtaCheck', appSrc.includes("from '../ota/client.js'"));
  ok('app.js calls startOtaCheck', appSrc.includes('startOtaCheck({ window })'));
  ok('PWA still skips SW in native shell', htmlSrc.includes('!window.__astropitchNativeShell'));
  ok('bundle.json has bundleVersion', typeof bundle.bundleVersion === 'string');
  ok('bridge exports OTA helpers',
    readFileSync(join(__dirname, '../src/audio/native-bridge.js'), 'utf8').includes('requestNativeOtaApply'));
}

console.log(`\n${fails === 0 ? 'All ota checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
