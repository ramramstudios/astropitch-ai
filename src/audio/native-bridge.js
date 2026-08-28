/**
 * Shared JS ↔ native shell bridge for Phase 4 + Phase 5 OTA.
 *
 * Both shells (iOS WKWebView, Android System WebView) stay thin — all audio
 * still runs in this JS engine. Native code only:
 *   1. Configures the platform audio session / WebView playback flags
 *   2. Posts lifecycle events into this module
 *   3. Downloads / verifies / swaps versioned web bundles (OTA)
 *
 * Event shape (identical on both platforms):
 *   { type: 'background' | 'foreground' | 'interrupt' }
 *
 * Native injects events by evaluating:
 *   window.__astropitchNative.dispatch({ type: 'background' })
 *
 * Optional JS → native (never exposes device APIs to the page):
 *   iOS:     window.webkit.messageHandlers.astropitch.postMessage(...)
 *   Android: window.AstroPitchShell.setPlaying(true)
 *            window.AstroPitchShell.ota(JSON.stringify(msg))
 *
 * Message shapes:
 *   { playing: boolean }
 *   { ota: 'apply', manifest: object }
 *   { ota: 'rollback' }
 *   { haptic: 'impact' | 'selection' }
 *
 * See research/audio-implementation-plan.md Phases 4–5.
 */

export const NATIVE_EVENT = 'astropitch:native';

export const NATIVE_EVENT_TYPES = Object.freeze({
  background: 'background',
  foreground: 'foreground',
  interrupt: 'interrupt',
});

/**
 * True when a native shell has marked the page (injected before modules load)
 * or when platform message-handler hooks are present.
 */
export function isNativeShell(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  if (win.__astropitchNativeShell === true) return true;
  if (win.AstroPitchShell && typeof win.AstroPitchShell.setPlaying === 'function') return true;
  try {
    return !!win.webkit?.messageHandlers?.astropitch;
  } catch {
    return false;
  }
}

/**
 * Normalize a raw native payload into a known event type, or null.
 * Accepts `{ type }`, a bare string, or a CustomEvent whose detail holds either.
 */
export function parseNativeEvent(raw) {
  const value = raw && typeof raw === 'object' && 'detail' in raw && raw.detail != null
    ? raw.detail
    : raw;
  const type = typeof value === 'string'
    ? value
    : (value && typeof value === 'object' ? value.type : null);
  if (type === NATIVE_EVENT_TYPES.background
      || type === NATIVE_EVENT_TYPES.foreground
      || type === NATIVE_EVENT_TYPES.interrupt) {
    return type;
  }
  return null;
}

/**
 * Forward a parsed native event onto the Phase 2 lifecycle module.
 * Returns the handler promise, or null if the type was unknown / no lifecycle.
 */
export function dispatchNativeToLifecycle(lifecycle, raw) {
  if (!lifecycle) return null;
  const type = parseNativeEvent(raw);
  if (!type) return null;
  if (type === NATIVE_EVENT_TYPES.background) return lifecycle.handleBackground();
  if (type === NATIVE_EVENT_TYPES.foreground) return lifecycle.handleForeground();
  return lifecycle.handleInterruption();
}

/**
 * Tell the native shell whether transport audio is currently intended to play.
 * Used by Android to start/stop the mediaPlayback foreground service.
 * No-ops in the browser PWA.
 */
export function notifyNativePlaying(playing, win = typeof window !== 'undefined' ? window : null) {
  return postToNative({ playing: !!playing }, win);
}

export const HAPTIC_KINDS = Object.freeze({
  /** A body crossing a sign boundary — the event worth feeling. */
  impact: 'impact',
  /** A whole-degree step while dragging — the fine detent. */
  selection: 'selection',
});

/**
 * Ask the shell for one haptic tick. No-ops in the browser PWA, where there is
 * nothing to ask; `navigator.vibrate` is deliberately not a fallback, since a
 * buzz per degree is not the same gesture as a Taptic detent.
 */
export function notifyNativeHaptic(kind, win = typeof window !== 'undefined' ? window : null) {
  if (kind !== HAPTIC_KINDS.impact && kind !== HAPTIC_KINDS.selection) return false;
  return postToNative({ haptic: kind }, win);
}

/** A dragged body crosses a sign boundary every 30°. */
const SIGN_DEGREES = 30;

/**
 * The most ticks one drag update may ask for. A flick can cover a hundred
 * degrees between two animation frames, and queueing a hundred generator calls
 * for a gesture the hand felt as one sweep is worse than dropping most of
 * them: the queue outlives the movement and the tick arrives after the finger
 * has stopped. Above this the motion is too fast to resolve individually, so
 * report the boundaries and let the degrees go.
 */
const MAX_TICKS_PER_UPDATE = 4;

/**
 * Which haptics a drag from `from` to `to` earns, in the order they should
 * fire. Pure so the crossing arithmetic can be tested without a WebView.
 *
 * Wrap-safe: the drag is measured the short way round, so 359° → 1° is two
 * degrees forward over one boundary, not 358° backwards.
 *
 * A whole degree that is also a sign boundary yields only the impact — the
 * sign change is the larger event, and firing both at one longitude reads as
 * one mushy tick rather than two.
 *
 * @param {number} from previous longitude in degrees
 * @param {number} to current longitude in degrees
 * @returns {string[]} haptic kinds, possibly empty
 */
export function hapticTicksForDrag(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const delta = shortestDelta(from, to);
  if (delta === 0) return [];

  // Every whole degree strictly between the two longitudes, in travel order.
  const crossed = [];
  if (delta > 0) {
    for (let d = Math.floor(from) + 1; d <= from + delta; d += 1) crossed.push(d);
  } else {
    for (let d = Math.ceil(from) - 1; d >= from + delta; d -= 1) crossed.push(d);
  }
  if (crossed.length === 0) return [];

  const kinds = crossed.map((d) => (norm360(d) % SIGN_DEGREES === 0
    ? HAPTIC_KINDS.impact
    : HAPTIC_KINDS.selection));

  if (kinds.length <= MAX_TICKS_PER_UPDATE) return kinds;

  // Past the cap the individual degrees are no longer resolvable by hand, but
  // a sign change still is. Drop selections first and keep every impact, so a
  // flick across four signs still feels like four signs.
  const impacts = kinds.filter((k) => k === HAPTIC_KINDS.impact);
  if (impacts.length >= MAX_TICKS_PER_UPDATE) return impacts.slice(0, MAX_TICKS_PER_UPDATE);
  return [
    ...impacts,
    ...kinds.filter((k) => k === HAPTIC_KINDS.selection).slice(0, MAX_TICKS_PER_UPDATE - impacts.length),
  ];
}

/** Signed short-way-round difference in degrees, in (-180, 180]. */
function shortestDelta(from, to) {
  const raw = ((to - from) % 360 + 540) % 360 - 180;
  return raw === -180 ? 180 : raw;
}

function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Stateful driver for one drag: feed it each new longitude and it fires the
 * ticks earned since the last one. Keeps the per-drag "where was it" out of
 * the UI, and gives the throttle somewhere to live.
 *
 * @param {object} [opts]
 * @param {Window} [opts.window]
 * @param {(kind: string) => void} [opts.send] injection point for tests
 */
export function createHapticDrag({
  window: win = typeof window !== 'undefined' ? window : null,
  send = (kind) => notifyNativeHaptic(kind, win),
} = {}) {
  let last = null;
  return {
    /** Begin (or restart) a drag at `longitude` without firing anything. */
    start(longitude) {
      last = Number.isFinite(longitude) ? longitude : null;
    },
    /** Advance to `longitude`; returns the kinds fired. */
    move(longitude) {
      if (!Number.isFinite(longitude)) return [];
      if (last == null) { last = longitude; return []; }
      const ticks = hapticTicksForDrag(last, longitude);
      last = longitude;
      for (const kind of ticks) send(kind);
      return ticks;
    },
    end() {
      last = null;
    },
  };
}

/**
 * Ask the shell to download, hash-verify, and atomically swap to a new web
 * bundle described by `manifest`. No-ops outside a native shell.
 */
export function requestNativeOtaApply(manifest, win = typeof window !== 'undefined' ? window : null) {
  if (!manifest) return false;
  return postToNative({ ota: 'apply', manifest }, win);
}

/** Ask the shell to revert to the previous (or embedded) web bundle and reload. */
export function requestNativeOtaRollback(win = typeof window !== 'undefined' ? window : null) {
  return postToNative({ ota: 'rollback' }, win);
}

/**
 * Deliver a structured message to the native shell.
 * Android prefers a dedicated `ota(string)` entry for large manifests so the
 * playing-state channel stays a simple boolean.
 */
function postToNative(payload, win) {
  if (!win || !payload || typeof payload !== 'object') return false;
  try {
    // Android's shell only exposes setPlaying / ota, so anything else has to
    // fall through to the webkit handler rather than being matched here.
    if (payload.ota != null
        && win.AstroPitchShell
        && typeof win.AstroPitchShell.ota === 'function') {
      win.AstroPitchShell.ota(JSON.stringify(payload));
      return true;
    }
    if (payload.playing != null
        && win.AstroPitchShell
        && typeof win.AstroPitchShell.setPlaying === 'function') {
      win.AstroPitchShell.setPlaying(!!payload.playing);
      return true;
    }
  } catch { /* shell gone */ }
  try {
    const handler = win.webkit?.messageHandlers?.astropitch;
    if (handler && typeof handler.postMessage === 'function') {
      handler.postMessage(payload);
      return true;
    }
  } catch { /* shell gone */ }
  return false;
}

/**
 * Install the receive side of the bridge and wire playing-state notifications.
 * Safe to call once; no-ops without a window.
 *
 * @param {import('./lifecycle.js').AudioLifecycle} lifecycle
 * @param {object} [opts]
 * @param {Window} [opts.window]
 * @param {import('./performer.js').Performer} [opts.performer]
 *   When provided, start/stop/end events sync `setPlaying` to the shell.
 * @returns {() => void} unsubscribe
 */
export function attachNativeBridge(lifecycle, {
  window: win = typeof window !== 'undefined' ? window : null,
  performer = null,
} = {}) {
  if (!win || !lifecycle) return () => {};

  const host = win.__astropitchNative || (win.__astropitchNative = {});
  const unsubscribers = [];

  const onDispatch = (raw) => dispatchNativeToLifecycle(lifecycle, raw);
  host.dispatch = onDispatch;

  const onCustom = (event) => onDispatch(event);
  win.addEventListener(NATIVE_EVENT, onCustom);
  unsubscribers.push(() => win.removeEventListener(NATIVE_EVENT, onCustom));

  if (performer && typeof performer.onEvent === 'function') {
    const off = performer.onEvent((event) => {
      if (event.type === 'start') notifyNativePlaying(true, win);
      else if (event.type === 'stop' || event.type === 'end') notifyNativePlaying(false, win);
    });
    unsubscribers.push(off);
  }

  return () => {
    for (const unsub of unsubscribers) unsub();
    if (host.dispatch === onDispatch) delete host.dispatch;
  };
}
