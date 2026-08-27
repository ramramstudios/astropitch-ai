/**
 * Phase 5 OTA client — runs only inside a native shell.
 *
 * Fetches a versioned manifest, applies the pure policy in policy.js, then
 * asks the shell to download/verify/swap web assets. Never changes native
 * behaviour; never registers when a service worker owns the PWA cache.
 */

import { isNativeShell, requestNativeOtaApply, requestNativeOtaRollback } from '../audio/native-bridge.js';
import { parseManifest, shouldApplyUpdate } from './policy.js';

const DEVICE_ID_KEY = 'astropitch.ota.deviceId';
const DEFAULT_BUNDLE_PATH = 'bundle.json';

/**
 * @param {object} [opts]
 * @param {Window} [opts.window]
 * @param {typeof fetch} [opts.fetch]
 * @param {string} [opts.bundlePath]
 * @returns {Promise<{ checked: boolean, decision?: import('./policy.js').OtaDecision, error?: string }>}
 */
export async function startOtaCheck({
  window: win = typeof window !== 'undefined' ? window : null,
  fetch: fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
  bundlePath = DEFAULT_BUNDLE_PATH,
} = {}) {
  if (!win || !isNativeShell(win)) {
    return { checked: false, error: 'not-native-shell' };
  }
  if (typeof fetchFn !== 'function') {
    return { checked: false, error: 'no-fetch' };
  }

  let local;
  try {
    const res = await fetchFn(bundlePath, { cache: 'no-store' });
    if (!res.ok) return { checked: false, error: 'local-bundle-missing' };
    local = await res.json();
  } catch (err) {
    return { checked: false, error: `local-bundle:${err && err.message ? err.message : err}` };
  }

  const updateUrl = typeof local.updateUrl === 'string' ? local.updateUrl : null;
  if (!updateUrl) return { checked: false, error: 'no-update-url' };

  let raw;
  try {
    const res = await fetchFn(updateUrl, { cache: 'no-store' });
    if (!res.ok) return { checked: false, error: `manifest-http-${res.status}` };
    raw = await res.json();
  } catch (err) {
    return { checked: false, error: `manifest:${err && err.message ? err.message : err}` };
  }

  const manifest = parseManifest(raw);
  if (!manifest) return { checked: false, error: 'manifest-invalid' };

  const shellVersion = Number(win.__astropitchShellVersion) || Number(local.shellVersion) || 1;
  const deviceId = ensureDeviceId(win);
  const decision = shouldApplyUpdate({
    local,
    manifest,
    shellVersion,
    deviceId,
    channel: local.channel,
  });

  if (decision.apply) {
    const ok = requestNativeOtaApply(manifest, win);
    if (!ok) return { checked: true, decision, error: 'native-apply-unavailable' };
  }

  return { checked: true, decision };
}

/** Ask the shell to revert to the previous (or embedded) web bundle and reload. */
export function rollbackOta(win = typeof window !== 'undefined' ? window : null) {
  return requestNativeOtaRollback(win);
}

function ensureDeviceId(win) {
  try {
    const store = win.localStorage;
    let id = store.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (win.crypto && typeof win.crypto.randomUUID === 'function')
        ? win.crypto.randomUUID()
        : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      store.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `ephemeral-${Date.now()}`;
  }
}
