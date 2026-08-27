/**
 * A Tale of Two Clocks.
 *
 * Musical time lives on `AudioContext.currentTime`. Waking up does not: the
 * browser will only run JS on a wall-clock timer, and mobile WebViews throttle
 * those — a 24-second `setInterval` is a hope, not a schedule. The answer is
 * one short timer whose only job is to look a little way ahead on the audio
 * clock and ask a callback, "what sounds between t0 and t1?"
 *
 * A tick that arrives late does not move the notes. It just gets a wider
 * window. The same onsets are scheduled at the same `currentTime` values
 * whether ticks come on time, late, or bunched — up to `MAX_CATCH_UP`. A
 * stall wider than that (Chrome's background timer is ~1/min) drops the
 * backlog and resumes in the present, rather than compressing history into
 * one instant.
 */

export const LOOKAHEAD = 0.15;
export const TICK_INTERVAL = 0.025;
/** Longer than a janky frame; shorter than a background throttle. */
export const MAX_CATCH_UP = 1;

export class AudioScheduler {
  constructor({
    now,
    lookAhead = LOOKAHEAD,
    interval = TICK_INTERVAL,
    maxCatchUp = MAX_CATCH_UP,
    setInterval: setIntervalFn = (fn, ms) => setInterval(fn, ms),
    clearInterval: clearIntervalFn = (id) => clearInterval(id),
  } = {}) {
    this._now = now;
    this.lookAhead = lookAhead;
    this.interval = interval;
    this.maxCatchUp = maxCatchUp;
    this._setInterval = setIntervalFn;
    this._clearInterval = clearIntervalFn;
    this._callback = null;
    this._timer = null;
    this._horizon = null;
  }

  get running() {
    return this._timer != null;
  }

  start(callback) {
    this.stop();
    this._callback = callback;
    this._horizon = null;
    this._timer = this._setInterval(() => this.tick(), this.interval * 1000);
    this.tick();
  }

  stop() {
    if (this._timer != null) this._clearInterval(this._timer);
    this._timer = null;
    this._callback = null;
    this._horizon = null;
  }

  /**
   * Schedule everything in `[horizon, now + lookAhead)`. A late or bunched
   * tick grows the window to catch up. A stall past `maxCatchUp` skips the
   * missed span and continues from `now` — generative modes should not dump
   * a minute of history through the voice stealer.
   */
  tick() {
    if (!this._callback) return;
    const now = this._now();
    const t1 = now + this.lookAhead;
    let t0 = this._horizon ?? now;
    if (now - t0 > this.maxCatchUp) t0 = now;
    if (t1 <= t0) return;
    this._callback(t0, t1);
    this._horizon = t1;
  }
}
