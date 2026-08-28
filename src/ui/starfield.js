/**
 * A quiet construction grid keeps the chart legible as a printed astronomical
 * diagram and only darkens slightly with the audio.
 *
 * Radial lines take their origin from the wheel element's current
 * getBoundingClientRect() — that rect is the only source for the convergence
 * point. The origin is never a viewport fraction or a hardcoded pixel pair:
 * the wheel is pushed around by the controls panel, the transport bar, full-screen, and
 * the mobile sheet, and the grid has to follow it there.
 */

/** Convert a DOMRect (or lookalike) into the construction-grid origin. */
export function originFromRect(rect) {
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  return {
    x: (rect?.left ?? 0) + width / 2,
    y: (rect?.top ?? 0) + height / 2,
    radius: Math.min(width, height) / 2,
  };
}

/** Distance from (x, y) to the farthest corner of a w×h box. */
export function farthestCorner(w, h, x, y) {
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(w - x, y),
    Math.hypot(x, h - y),
    Math.hypot(w - x, h - y),
  );
}

export class Starfield {
  constructor(canvas, wheelEl) {
    this.canvas = canvas;
    this.wheelEl = wheelEl;
    this.ctx = canvas.getContext('2d');
    this.level = 0;
    this.origin = { x: 0, y: 0, radius: 0 };
    Object.defineProperty(this.canvas, 'wheelOrigin', {
      configurable: true,
      enumerable: false,
      get: () => this.origin,
    });
    this.resize();
    this._observe();
  }

  /**
   * Re-read the wheel's visual centre. Called from the draw loop so CSS
   * transitions, sheet drags, and pinch-pan transforms stay in lockstep
   * rather than snapping after they finish; observers catch the same
   * changes for anything that does not already run through draw().
   */
  measure() {
    const el = this.wheelEl;
    if (!el) return this.origin;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return this.origin;
    this.origin = originFromRect(rect);
    return this.origin;
  }

  _observe() {
    const sync = () => this.measure();
    const wheelEl = this.wheelEl;
    if (!wheelEl) return;

    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(sync);
      this._ro.observe(wheelEl);
      const holder = wheelEl.closest?.('.wheel-holder');
      if (holder && holder !== wheelEl) this._ro.observe(holder);
      const stage = document.getElementById('stage');
      if (stage) this._ro.observe(stage);
    }

    if (typeof MutationObserver === 'function') {
      this._mo = new MutationObserver(sync);
      this._mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-mode', 'style'],
      });
      this._mo.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      const stage = document.getElementById('stage');
      if (stage) {
        this._mo.observe(stage, { attributes: true, attributeFilter: ['class', 'style'] });
      }
      // Pinch/pan writes transform on the viewport wrapper; that does not
      // change the layout box ResizeObserver watches.
      const viewport = wheelEl.closest?.('.wheel-viewport') ?? wheelEl.parentElement;
      if (viewport) {
        this._mo.observe(viewport, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }

    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, { passive: true });
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.measure();
  }

  draw(_dt, level = 0) {
    const { ctx, w, h } = this;
    this.level += (level - this.level) * 0.08;
    ctx.clearRect(0, 0, w, h);

    const { x: vx, y: vy, radius } = this.measure();
    const maxR = farthestCorner(w, h, vx, vy) + 8;
    const alpha = 0.045 + Math.min(0.025, this.level * 0.16);

    ctx.save();
    // Keep the construction grid in the foreground colour so it remains a
    // quiet line on either side of the monochrome theme switch.
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ink || '#0b0b0b';
    ctx.lineWidth = 1;

    for (let y = -20; y < h + 40; y += 72) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    // Radial construction lines, as if the natal wheel continued off page.
    // They stop well short of the chart: rings and spokes drawn behind a ring
    // and spoke diagram read as a second wheel and fight the one you are using.
    // No radius yet means the wheel has not laid out — drawing from (0,0)
    // would pin the grid to the viewport corner until the first measure.
    if (radius > 0) {
      const clear = radius;
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(vx + Math.cos(angle) * clear, vy + Math.sin(angle) * clear);
        ctx.lineTo(vx + Math.cos(angle) * maxR, vy + Math.sin(angle) * maxR);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
