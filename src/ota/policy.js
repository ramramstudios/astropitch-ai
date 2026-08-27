/**
 * Pure decision logic for Phase 5 web-bundle OTA updates.
 *
 * Native shells own the live bundle; the PWA keeps using the service worker.
 * Updates are web assets only — never native binaries — so they stay inside
 * Apple 2.5.2 / Play dynamic-code carve-outs.
 */

/** @typedef {{ bundleVersion: string, shellVersion?: number, channel?: string }} LocalBundle */
/**
 * @typedef {{
 *   schemaVersion: number,
 *   bundleVersion: string,
 *   minShellVersion?: number,
 *   channel?: string,
 *   rollout?: number,
 *   baseUrl: string,
 *   files: Array<{ path: string, sha256: string }>,
 * }} OtaManifest
 */

/**
 * Compare dotted numeric versions (1.0.0, 1.0.10, 2). Non-numeric segments
 * compare as 0. Returns -1 / 0 / 1.
 */
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map((p) => parseInt(p, 10) || 0);
  const pb = String(b ?? '').split('.').map((p) => parseInt(p, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/**
 * Sticky 0–99 bucket from a device id. Same id always lands in the same
 * bucket so staged rollouts don't flicker on/off across launches.
 */
export function rolloutBucket(deviceId) {
  const s = String(deviceId ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/**
 * Validate / normalize a remote manifest. Returns null if unusable.
 * @param {unknown} raw
 * @returns {OtaManifest | null}
 */
export function parseManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (m.schemaVersion !== 1) return null;
  if (typeof m.bundleVersion !== 'string' || !m.bundleVersion) return null;
  if (typeof m.baseUrl !== 'string' || !m.baseUrl) return null;
  if (!Array.isArray(m.files) || m.files.length === 0) return null;
  for (const f of m.files) {
    if (!f || typeof f !== 'object') return null;
    if (typeof f.path !== 'string' || !f.path) return null;
    if (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(f.sha256)) return null;
    // Reject path escape attempts before native ever sees them.
    if (f.path.includes('..') || f.path.startsWith('/') || f.path.includes('\\')) return null;
  }
  const rollout = m.rollout == null ? 100 : Number(m.rollout);
  if (!Number.isFinite(rollout) || rollout < 0 || rollout > 100) return null;
  const minShell = m.minShellVersion == null ? 1 : Number(m.minShellVersion);
  if (!Number.isFinite(minShell) || minShell < 1) return null;
  return {
    schemaVersion: 1,
    bundleVersion: m.bundleVersion,
    minShellVersion: minShell,
    channel: typeof m.channel === 'string' ? m.channel : 'stable',
    rollout,
    baseUrl: m.baseUrl.endsWith('/') ? m.baseUrl : `${m.baseUrl}/`,
    files: m.files.map((f) => ({
      path: f.path,
      sha256: String(f.sha256).toLowerCase(),
    })),
  };
}

/**
 * @typedef {{
 *   apply: boolean,
 *   reason: string,
 *   manifest?: OtaManifest,
 * }} OtaDecision
 */

/**
 * Decide whether the shell should download and swap to `manifest`.
 *
 * @param {object} args
 * @param {LocalBundle} args.local
 * @param {OtaManifest} args.manifest
 * @param {number} [args.shellVersion]  Native shell API version (injected).
 * @param {string} args.deviceId        Sticky id for rollout bucketing.
 * @param {string} [args.channel]       Client channel; default local.channel or 'stable'.
 * @returns {OtaDecision}
 */
export function shouldApplyUpdate({
  local,
  manifest,
  shellVersion = 1,
  deviceId,
  channel,
} = {}) {
  if (!local || typeof local.bundleVersion !== 'string') {
    return { apply: false, reason: 'missing-local' };
  }
  if (!manifest) return { apply: false, reason: 'missing-manifest' };

  const wantChannel = channel || local.channel || 'stable';
  if ((manifest.channel || 'stable') !== wantChannel) {
    return { apply: false, reason: 'channel-mismatch', manifest };
  }

  if (shellVersion < (manifest.minShellVersion || 1)) {
    return { apply: false, reason: 'shell-too-old', manifest };
  }

  if (compareVersions(manifest.bundleVersion, local.bundleVersion) <= 0) {
    return { apply: false, reason: 'not-newer', manifest };
  }

  const bucket = rolloutBucket(deviceId);
  if (bucket >= (manifest.rollout ?? 100)) {
    return { apply: false, reason: 'rollout-hold', manifest };
  }

  return { apply: true, reason: 'newer', manifest };
}
