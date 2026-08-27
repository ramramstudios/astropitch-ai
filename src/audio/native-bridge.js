/**
 * Shared JS ↔ native shell bridge for Phase 4.
 *
 * Both shells (iOS WKWebView, Android System WebView) stay thin — all audio
 * still runs in this JS engine. Native code only:
 *   1. Configures the platform audio session / WebView playback flags
 *   2. Posts lifecycle events into this module
 *
 * Event shape (identical on both platforms):
 *   { type: 'background' | 'foreground' | 'interrupt' }
 *
 * Native injects events by evaluating:
 *   window.__astropitchNative.dispatch({ type: 'background' })
 *
 * Optional JS → native (playing state only — never exposes native APIs):
 *   iOS:     window.webkit.messageHandlers.astropitch.postMessage({ playing: true })
 *   Android: window.AstroPitchShell.setPlaying(true)
 *
 * See research/audio-implementation-plan.md Phase 4.
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
  if (!win) return false;
  const flag = !!playing;
  try {
    if (win.AstroPitchShell && typeof win.AstroPitchShell.setPlaying === 'function') {
      win.AstroPitchShell.setPlaying(flag);
      return true;
    }
  } catch { /* shell gone */ }
  try {
    const handler = win.webkit?.messageHandlers?.astropitch;
    if (handler && typeof handler.postMessage === 'function') {
      handler.postMessage({ playing: flag });
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
