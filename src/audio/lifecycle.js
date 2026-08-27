/**
 * Audio lifecycle: visibility, interruptions, and cold-start priming.
 *
 * Musical timing lives on the audio clock (see scheduler.js). This module
 * owns the *other* clock — when the page is allowed to make sound at all.
 * Without it, a backgrounded WKWebView freezes the context while the UI still
 * shows "playing", and an incoming call leaves voices dangling.
 *
 * The state machine itself is pure (`lifecycleStep`) so the transitions can
 * be tested without a document or an AudioContext. `AudioLifecycle` is the
 * thin coordinator that applies those actions to the engine and performer.
 *
 * Native shells (Phase 4) call `handleBackground` / `handleForeground`
 * / `handleInterruption` through `src/audio/native-bridge.js` rather than
 * inventing a second path.
 */

export const SUSPEND_FADE = 0.08;

export const LIFECYCLE_STATES = Object.freeze({
  idle: 'idle',
  playing: 'playing',
  suspended: 'suspended',
});

/**
 * Pure transition. Given the current phase/recorded mode and an event, return
 * the next phase, the mode to remember, and the side-effect actions to run.
 *
 * Actions:
 *   stop-audio     — stop the scheduler and fade out live voices
 *   resume-context — ctx.resume() when the graph is still healthy
 *   rebuild        — tear down and rebuild the graph (closed / bad route)
 *   reenter        — start the recorded transport mode again
 *   emit-suspended — tell the UI audio is no longer audible
 *   emit-resumed   — tell the UI audio is audible again
 */
export function lifecycleStep(state, event, info = {}) {
  const phase = state?.phase ?? LIFECYCLE_STATES.idle;
  const recordedMode = state?.recordedMode ?? null;
  const mode = info.mode ?? null;
  const needsRebuild = !!info.needsRebuild;

  switch (event) {
    case 'play':
      return {
        phase: LIFECYCLE_STATES.playing,
        recordedMode: mode,
        actions: [],
      };

    case 'stop':
    case 'end':
      // A user stop (or a finite mode finishing) clears any resume intent.
      return {
        phase: LIFECYCLE_STATES.idle,
        recordedMode: null,
        actions: [],
      };

    case 'hide':
    case 'interrupt': {
      if (phase !== LIFECYCLE_STATES.playing) {
        return { phase, recordedMode, actions: [] };
      }
      const keep = mode ?? recordedMode;
      if (!keep) {
        return {
          phase: LIFECYCLE_STATES.idle,
          recordedMode: null,
          actions: ['stop-audio'],
        };
      }
      return {
        phase: LIFECYCLE_STATES.suspended,
        recordedMode: keep,
        actions: ['stop-audio', 'emit-suspended'],
      };
    }

    case 'show': {
      if (phase !== LIFECYCLE_STATES.suspended || !recordedMode) {
        if (phase === LIFECYCLE_STATES.suspended) {
          return {
            phase: LIFECYCLE_STATES.idle,
            recordedMode: null,
            actions: needsRebuild ? ['rebuild'] : ['resume-context'],
          };
        }
        return { phase, recordedMode, actions: [] };
      }
      return {
        phase: LIFECYCLE_STATES.playing,
        recordedMode,
        actions: [
          needsRebuild ? 'rebuild' : 'resume-context',
          'reenter',
          'emit-resumed',
        ],
      };
    }

    default:
      return { phase, recordedMode, actions: [] };
  }
}

export class AudioLifecycle {
  /**
   * @param {object} opts
   * @param {import('./engine.js').AudioEngine} opts.engine
   * @param {import('./performer.js').Performer} opts.performer
   * @param {(mode: string) => (void|Promise<void>)} opts.reenter
   *   Restart a recorded transport mode after resume.
   * @param {() => boolean} [opts.isHidden]
   *   Override for tests; defaults to `document.visibilityState === 'hidden'`.
   */
  constructor({ engine, performer, reenter, isHidden = null } = {}) {
    this.engine = engine;
    this.performer = performer;
    this._reenter = reenter;
    this._isHidden = isHidden;
    this._phase = LIFECYCLE_STATES.idle;
    this._recordedMode = null;
    this._listeners = new Set();
    this._attached = false;
    this._primed = false;
    this._applying = false;
    this._unsubscribers = [];
    this._contextUnsub = null;
  }

  get phase() {
    return this._phase;
  }

  get recordedMode() {
    return this._recordedMode;
  }

  onEvent(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this._listeners) fn(event);
  }

  /**
   * Subscribe to page visibility and first-gesture priming.
   * Safe to call once; no-ops without a document (Node tests).
   */
  attach(target = typeof window !== 'undefined' ? window : null) {
    if (this._attached || !target || typeof document === 'undefined') return;
    this._attached = true;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.handleBackground();
      else this.handleForeground();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this._unsubscribers.push(() => document.removeEventListener('visibilitychange', onVisibility));

    const onPageHide = () => this.handleBackground();
    target.addEventListener('pagehide', onPageHide);
    this._unsubscribers.push(() => target.removeEventListener('pagehide', onPageHide));

    const primeOnce = () => { void this.prime(); };
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(type, primeOnce, { once: true, passive: true });
      this._unsubscribers.push(() => document.removeEventListener(type, primeOnce));
    }

    // Track transport start/stop so hide knows whether there is a mode to restore.
    const off = this.performer.onEvent((event) => {
      if (this._applying) return;
      if (event.type === 'start') {
        this._apply(lifecycleStep(this._snapshot(), 'play', { mode: event.mode }));
        this._watchContext();
      } else if (event.type === 'stop' || event.type === 'end') {
        this._apply(lifecycleStep(this._snapshot(), event.type));
      }
    });
    this._unsubscribers.push(off);
  }

  detach() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers.length = 0;
    if (this._contextUnsub) {
      this._contextUnsub();
      this._contextUnsub = null;
    }
    this._attached = false;
  }

  /** Warm the audio route on the first user gesture (cold-start stutter). */
  async prime() {
    if (this._primed) return;
    this._primed = true;
    await this.engine.start();
    this.engine.ensureKeepAlive();
    this._watchContext();
  }

  /** Page backgrounded or WebView told us we left the foreground. */
  handleBackground() {
    return this._dispatch('hide');
  }

  /** Page visible again / WebView foregrounded. */
  handleForeground() {
    return this._dispatch('show');
  }

  /** Phone call or other audio session interruption. */
  handleInterruption() {
    return this._dispatch('interrupt');
  }

  _snapshot() {
    return { phase: this._phase, recordedMode: this._recordedMode };
  }

  _hidden() {
    if (this._isHidden) return this._isHidden();
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  async _dispatch(event) {
    const info = {
      mode: this.performer.mode,
      needsRebuild: this.engine.needsRebuild?.() ?? false,
    };
    const next = lifecycleStep(this._snapshot(), event, info);
    await this._apply(next);
  }

  async _apply(next) {
    this._phase = next.phase;
    this._recordedMode = next.recordedMode;
    this._applying = true;
    try {
      for (const action of next.actions) {
        switch (action) {
          case 'stop-audio':
            this.performer.stop({ fade: SUSPEND_FADE, emit: false });
            this.engine.releaseAll?.(SUSPEND_FADE);
            await new Promise((r) => setTimeout(r, SUSPEND_FADE * 1000 + 40));
            this.engine.disposeAll?.();
            if (typeof this.engine.suspend === 'function') {
              try { await this.engine.suspend(); } catch { /* already closed */ }
            }
            break;
          case 'resume-context':
            await this.engine.start();
            this.engine.ensureKeepAlive?.();
            break;
          case 'rebuild':
            this.performer.stop({ fade: 0, emit: false });
            await this.engine.rebuild();
            this.engine.ensureKeepAlive?.();
            this._watchContext();
            break;
          case 'reenter':
            if (this._recordedMode && this._reenter) {
              await this._reenter(this._recordedMode);
            }
            break;
          case 'emit-suspended':
            this._emit({ type: 'suspended', mode: this._recordedMode });
            break;
          case 'emit-resumed':
            this._emit({ type: 'resumed', mode: this._recordedMode });
            break;
          default:
            break;
        }
      }
    } finally {
      this._applying = false;
    }
  }

  _watchContext() {
    if (this._contextUnsub) {
      this._contextUnsub();
      this._contextUnsub = null;
    }
    const ctx = this.engine.ctx;
    if (!ctx || typeof ctx.addEventListener !== 'function') return;

    const onState = () => {
      if (this._applying) return;
      // An interruption can suspend the context without a visibilitychange.
      if ((ctx.state === 'suspended' || ctx.state === 'interrupted')
          && this._phase === LIFECYCLE_STATES.playing
          && !this._hidden()) {
        void this.handleInterruption();
      }
    };
    ctx.addEventListener('statechange', onState);
    this._contextUnsub = () => ctx.removeEventListener('statechange', onState);
  }
}
