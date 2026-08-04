/**
 * The chart wheel.
 *
 * Drawn the traditional way: Ascendant on the left at nine o'clock, longitude
 * increasing counter-clockwise. Aspect lines are chords across the middle,
 * which is the picture of the whole argument — a chord between two planets is
 * both an angle and an interval.
 */

import { SIGNS, ELEMENTS, ASPECTS, norm360 } from '../ontology.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 1000;
const C = SIZE / 2;

// The ASC/MC/DSC/IC labels sit outside the rim, so the viewBox is padded past
// the drawing box or they get clipped at the four compass points.
const PAD = 46;
const VIEW_MIN = -PAD;
const VIEW_SIZE = SIZE + PAD * 2;

const R = {
  rim: 486,
  signOuter: 470,
  signInner: 402,
  signName: 448,
  glyph: 418,
  houseOuter: 402,
  houseInner: 330,
  tick: 402,
  planet: 366,
  planetTick: 330,
  hub: 300,
  scope: 196,
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export class Wheel {
  constructor(container) {
    this.container = container;
    this.chart = null;
    this.rotation = 0;
    this.handlers = {};
    this.aspectFocusKey = null;
    this.angleFocusKey = null;
    this.selectedAspectKey = null;
    this.designer = false;
    this.drag = null;
    this.ignoreAngleClickUntil = 0;
    // While a body is being dragged the wheel stops turning under it. The
    // Ascendant sets the rotation, so without this the one marker you are
    // holding is the one that cannot follow the pointer.
    this.rotationLock = null;
    this.scopePalette = [this._scopeColor('air')];

    // Mobile-only pinch/pan state. Kept separate from `this.drag` (designer
    // dragging a body) so the two gestures never fight over the same pointer.
    this.interactionMode = 'desktop';
    this.view = { scale: 1, x: 0, y: 0 };
    this._pointers = new Map();
    this._pan = null;
    this._pinch = null;
    this._viewFrame = 0;
    this._lastEmptyTapAt = 0;

    this.svg = el('svg', {
      viewBox: `${VIEW_MIN} ${VIEW_MIN} ${VIEW_SIZE} ${VIEW_SIZE}`,
      class: 'wheel-svg',
      role: 'img',
      'aria-label': 'Natal chart wheel',
    });

    this.layers = {};
    for (const name of ['rings', 'signs', 'houses', 'ticks', 'aspects', 'planets', 'labels']) {
      this.layers[name] = el('g', { class: `layer-${name}` });
      this.svg.appendChild(this.layers[name]);
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wheel-scope';
    this.ctx2d = this.canvas.getContext('2d');

    // The svg and canvas pan/zoom together as one unit on mobile, via a CSS
    // transform on this wrapper. getScreenCTM() on the svg composites that
    // ancestor transform automatically, so every existing hit-test (signs,
    // planets, designer dragging) keeps working with no coordinate changes.
    this.viewport = document.createElement('div');
    this.viewport.className = 'wheel-viewport';
    this.viewport.appendChild(this.svg);
    this.viewport.appendChild(this.canvas);
    container.appendChild(this.viewport);

    // The pointer is captured by the SVG root rather than the marker, because
    // the marker is destroyed and rebuilt on every frame of the drag.
    this.svg.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.svg.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.svg.addEventListener('pointercancel', () => this._cancelDrag());
    this.svg.addEventListener('lostpointercapture', () => this._cancelDrag());
    this.svg.addEventListener('pointerdown', (e) => this._onViewPointerDown(e));
    this.svg.addEventListener('pointermove', (e) => this._onViewPointerMove(e));
    this.svg.addEventListener('pointerup', (e) => this._onViewPointerUp(e));
    this.svg.addEventListener('pointercancel', (e) => this._onViewPointerUp(e));
    this.svg.addEventListener('click', (e) => {
      if (e.target === this.svg) {
        this.clearAspectFocus();
        this._emit('clearFocus');
      }
      // The hub ring is painted (var(--wheel-hub-fill)), so a tap there hits
      // that circle, not the bare svg — it still reads as "empty" for the
      // reset gesture even though it fails the stricter clearFocus check above.
      if (this.interactionMode === 'mobile' && this.view.scale > 1.001
        && (e.target === this.svg || e.target.closest('.layer-rings'))) {
        const now = performance.now();
        if (now - this._lastEmptyTapAt < 350) this._resetView();
        this._lastEmptyTapAt = now;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._cancelDrag();
    });

    this._drawStaticRings();
  }

  /** Pinch-zoom and pan are mobile-only; desktop keeps its existing behaviour. */
  setInteractionMode(mode) {
    this.interactionMode = mode;
    this.svg.classList.toggle('is-zoomable', mode === 'mobile');
    if (mode !== 'mobile') this._resetView();
  }

  _resetView() {
    this.view = { scale: 1, x: 0, y: 0 };
    this._pointers.clear();
    this._pan = null;
    this._pinch = null;
    this.viewport.classList.remove('is-zoomed', 'is-panning');
    this._applyView();
  }

  _applyView() {
    const { scale, x, y } = this.view;
    this.viewport.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  /** Content can be panned until its own edge reaches the container's edge, no further. */
  _clampView() {
    const size = this.container.getBoundingClientRect().width || 1;
    const maxOffset = size * (this.view.scale - 1);
    this.view.x = Math.min(0, Math.max(-maxOffset, this.view.x));
    this.view.y = Math.min(0, Math.max(-maxOffset, this.view.y));
  }

  _setView(scale, x, y) {
    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    this.view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    this.view.x = x;
    this.view.y = y;
    this._clampView();
    this.viewport.classList.toggle('is-zoomed', this.view.scale > 1.001);
    if (this._viewFrame) return;
    this._viewFrame = requestAnimationFrame(() => {
      this._viewFrame = 0;
      this._applyView();
    });
  }

  _onViewPointerDown(e) {
    if (this.interactionMode !== 'mobile') return;
    // A designer drag on a body or angle owns its pointer exclusively.
    if (this.drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 2) {
      this._pan = null;
      const [a, b] = this._pointers.values();
      this._pinch = {
        dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
    } else if (this._pointers.size === 1) {
      // Could still be a tap on a sign, planet, or aspect — no pointer
      // capture yet, so native click keeps working until this crosses the
      // movement threshold in _onViewPointerMove below.
      this._pan = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        moved: false,
      };
    }
  }

  _onViewPointerMove(e) {
    if (this.drag || !this._pointers.has(e.pointerId)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pinch && this._pointers.size >= 2) {
      const [a, b] = this._pointers.values();
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // Keep the content point under the pinch's midpoint stationary as the
      // scale changes, the same way a native pinch-to-zoom feels.
      const localX = (this._pinch.midX - this.view.x) / this.view.scale;
      const localY = (this._pinch.midY - this.view.y) / this.view.scale;
      const scale = this.view.scale * (dist / this._pinch.dist);
      this._setView(scale, midX - localX * scale, midY - localY * scale);
      this._pinch = { dist, midX, midY };
      return;
    }

    const pan = this._pan;
    if (!pan || e.pointerId !== pan.pointerId) return;
    if (!pan.moved) {
      const travelled = Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY);
      if (travelled < 6) return;
      pan.moved = true;
      this.svg.setPointerCapture(e.pointerId);
      this.viewport.classList.add('is-panning');
    }
    const dx = e.clientX - pan.lastX;
    const dy = e.clientY - pan.lastY;
    pan.lastX = e.clientX;
    pan.lastY = e.clientY;
    this._setView(this.view.scale, this.view.x + dx, this.view.y + dy);
  }

  _onViewPointerUp(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const wasPinching = this._pointers.size >= 2;
    this._pointers.delete(e.pointerId);

    if (wasPinching && this._pointers.size === 1) {
      // One finger of a pinch lifted — keep panning with the finger still down.
      this._pinch = null;
      const [[remainingId, remainingPos]] = this._pointers;
      this._pan = {
        pointerId: remainingId,
        startX: remainingPos.x, startY: remainingPos.y,
        lastX: remainingPos.x, lastY: remainingPos.y,
        moved: true,
      };
      this.svg.setPointerCapture(remainingId);
      return;
    }

    if (this._pointers.size === 0) {
      this._pinch = null;
      if (this._pan?.moved) {
        if (this.svg.hasPointerCapture?.(this._pan.pointerId)) this.svg.releasePointerCapture(this._pan.pointerId);
        this.viewport.classList.remove('is-panning');
      }
      this._pan = null;
    }
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  _emit(event, ...args) {
    this.handlers[event]?.(...args);
  }

  _scopeColor(element) {
    const hex = ELEMENTS[element]?.color ?? '#7fd3f0';
    const value = hex.replace('#', '');
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    };
  }

  setScopeTone(elements) {
    const tones = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
    if (tones.length) this.scopePalette = tones.slice(0, 2).map((element) => this._scopeColor(element));
  }

  _angle(longitude) {
    return ((180 + (norm360(longitude) - this.rotation)) * Math.PI) / 180;
  }

  _point(longitude, radius) {
    const a = this._angle(longitude);
    return [C + radius * Math.cos(a), C - radius * Math.sin(a)];
  }

  _arcPath(rInner, rOuter, lonStart, lonEnd) {
    const [x1, y1] = this._point(lonStart, rOuter);
    const [x2, y2] = this._point(lonEnd, rOuter);
    const [x3, y3] = this._point(lonEnd, rInner);
    const [x4, y4] = this._point(lonStart, rInner);
    const large = norm360(lonEnd - lonStart) > 180 ? 1 : 0;
    // Longitude increases counter-clockwise on screen, so sweep is 0.
    return [
      `M ${x1} ${y1}`,
      `A ${rOuter} ${rOuter} 0 ${large} 0 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${rInner} ${rInner} 0 ${large} 1 ${x4} ${y4}`,
      'Z',
    ].join(' ');
  }

  _drawStaticRings() {
    const g = this.layers.rings;
    g.replaceChildren(
      el('circle', { cx: C, cy: C, r: R.rim, class: 'ring ring-rim' }),
      el('circle', { cx: C, cy: C, r: R.signOuter, class: 'ring' }),
      el('circle', { cx: C, cy: C, r: R.signInner, class: 'ring' }),
      el('circle', { cx: C, cy: C, r: R.houseInner, class: 'ring' }),
      el('circle', { cx: C, cy: C, r: R.hub, class: 'ring ring-hub' })
    );
  }

  render(chart) {
    this.chart = chart;
    // Put the rising sign on the left the way a printed chart does.
    this.rotation = this.rotationLock ?? (chart.cusps ? chart.cusps[0] : 0);
    this._drawStaticRings();
    this._drawSigns();
    this._drawHouses();
    this._drawTicks();
    this._drawAspects();
    this._drawPlanets();
  }

  /**
   * Redraw only what a moved body changes. The rings, signs and ticks are fixed
   * to the rotation, which is frozen for the length of a drag, so they can be
   * left alone and the whole thing keeps up with the pointer.
   */
  renderLive(chart) {
    this.chart = chart;
    this._drawHouses();
    this._drawAspects();
    this._drawPlanets();
  }

  setDesignerMode(enabled) {
    this.designer = !!enabled;
    if (!this.designer) this._endDrag();
    this.svg.classList.toggle('is-designing', this.designer);
  }

  /** Focus the aspect network of one placement; repeating the key clears it. */
  toggleAspectFocus(key) {
    this.angleFocusKey = null;
    this.aspectFocusKey = this.aspectFocusKey === key ? null : key;
    this._drawAspects();
    this._drawPlanets();
    return this.aspectFocusKey;
  }

  clearAspectFocus() {
    const hadFocus = !!this.aspectFocusKey;
    const hadAngleFocus = !!this.angleFocusKey;
    const hadSelection = !!this.selectedAspectKey;
    this.aspectFocusKey = null;
    this.angleFocusKey = null;
    this.selectedAspectKey = null;
    if (!hadFocus && !hadAngleFocus && !hadSelection) return;
    if (hadAngleFocus) this._drawHouses();
    this._drawAspects();
    if (hadFocus || hadAngleFocus) this._drawPlanets();
  }

  /** Only one cardinal direction is expanded at a time to keep the wheel legible. */
  toggleAngleFocus(key) {
    this.aspectFocusKey = null;
    this.angleFocusKey = this.angleFocusKey === key ? null : key;
    this.selectedAspectKey = null;
    this._drawHouses();
    this._drawAspects();
    this._drawPlanets();
    return this.angleFocusKey;
  }

  _aspectKey(asp) {
    return `${asp.a}-${asp.b}`;
  }

  /** Keep a clicked chord visible until another chord or the empty wheel is clicked. */
  toggleAspectSelection(asp) {
    const key = this._aspectKey(asp);
    this.selectedAspectKey = this.selectedAspectKey === key ? null : key;
    this._drawAspects();
    return this.selectedAspectKey;
  }

  _drawSigns() {
    const g = this.layers.signs;
    const nodes = [];
    for (let i = 0; i < 12; i++) {
      const sign = SIGNS[i];
      const start = i * 30;
      const element = ELEMENTS[sign.element];

      const sector = el('path', {
        d: this._arcPath(R.signInner, R.signOuter, start, start + 30),
        class: `sign-sector element-${sign.element}`,
        'data-sign': i,
        tabindex: 0,
        role: 'button',
        'aria-label': `${sign.name}, ${sign.pitch}, ${element.name}`,
      });
      sector.addEventListener('click', () => this._emit('sign', i));
      sector.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._emit('sign', i);
        }
      });
      sector.addEventListener('mouseenter', () => this._emit('hoverSign', i));
      sector.addEventListener('mouseleave', () => this._emit('hoverSign', null));
      nodes.push(sector);

      const midpoint = start + 15;
      const [nx, ny] = this._point(midpoint, R.signName);
      const radialAngle = 180 + (norm360(midpoint) - this.rotation);
      let tangentAngle = 90 - radialAngle;
      const normalizedTangent = norm360(tangentAngle);
      if (normalizedTangent > 90 && normalizedTangent < 270) tangentAngle += 180;
      nodes.push(
        el('text', {
          x: nx, y: ny,
          class: 'sign-name',
          transform: `rotate(${tangentAngle} ${nx} ${ny})`,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'pointer-events': 'none',
        }, sign.name.toUpperCase())
      );

      const [gx, gy] = this._point(midpoint, R.glyph);
      nodes.push(
        el('text', {
          x: gx, y: gy,
          class: 'sign-glyph',
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'pointer-events': 'none',
        }, sign.glyph)
      );

      const [lx1, ly1] = this._point(start, R.signInner);
      const [lx2, ly2] = this._point(start, R.signOuter);
      nodes.push(el('line', { x1: lx1, y1: ly1, x2: lx2, y2: ly2, class: 'sign-divider' }));
    }
    g.replaceChildren(...nodes);
  }

  _drawHouses() {
    const g = this.layers.houses;
    const cusps = this.chart.cusps;
    if (!cusps) {
      g.replaceChildren();
      return;
    }
    const nodes = [];
    for (let i = 0; i < 12; i++) {
      const lon = cusps[i];
      const isAngle = i === 0 || i === 3 || i === 6 || i === 9;
      const [x1, y1] = this._point(lon, isAngle ? R.hub : R.houseInner);
      const [x2, y2] = this._point(lon, R.houseOuter);
      nodes.push(
        el('line', {
          x1, y1, x2, y2,
          class: `cusp-line${isAngle ? ' cusp-angle' : ''}`,
        })
      );

      const span = norm360(cusps[(i + 1) % 12] - lon);
      const [nx, ny] = this._point(lon + span / 2, (R.houseOuter + R.houseInner) / 2);
      nodes.push(
        el('text', {
          x: nx, y: ny,
          class: 'house-number',
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        }, String(i + 1))
      );
    }

    const angleLabels = [[cusps[0], 'asc', 'ASC'], [cusps[9], 'mc', 'MC'], [cusps[6], 'dsc', 'DSC'], [cusps[3], 'ic', 'IC']];
    for (const [lon, key, name] of angleLabels) {
      const [x, y] = this._point(lon, R.rim + 16);
      const interactive = el('g', {
        class: `angle-control${this.designer ? ' is-draggable' : ''}${this.angleFocusKey === key ? ' is-aspect-focus' : ''}`,
        tabindex: 0,
        role: 'button',
        'aria-label': `${name}. Click to hear its aspects${this.designer ? '; drag to rotate the sky' : ''}.`,
      });
      interactive.addEventListener('click', () => {
        if (performance.now() < this.ignoreAngleClickUntil) return;
        this._emit('angle', key);
      });
      interactive.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._emit('angle', key);
        }
      });
      if (this.designer) {
        // Pointer capture moves pointer-up to the SVG root, so this ordinary
        // click is the reliable path for a tap on a direction label.
        interactive.addEventListener('pointerdown', (e) => {
          if (e.button != null && e.button !== 0) return;
          this._startDrag(e, { key, longitude: lon, kind: 'angle' });
          // Designer captures the pointer on the SVG, which can swallow the
          // subsequent click. Select the directional network here; once the
          // gesture crosses the drag threshold its pitched preview takes over.
          this.ignoreAngleClickUntil = performance.now() + 500;
          this._emit('angle', key);
        });
      }
      interactive.append(
        el('circle', { cx: x, cy: y, r: 23, class: 'angle-grab' }),
        el('text', {
          x, y,
          class: 'angle-label',
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'pointer-events': 'none',
        }, name)
      );
      nodes.push(interactive);
    }
    g.replaceChildren(...nodes);
  }

  _drawTicks() {
    const g = this.layers.ticks;
    const nodes = [];
    for (let d = 0; d < 360; d += 1) {
      const major = d % 10 === 0;
      const mid = d % 5 === 0;
      if (!mid && d % 1 !== 0) continue;
      const len = major ? 13 : mid ? 8 : 4;
      const [x1, y1] = this._point(d, R.tick);
      const [x2, y2] = this._point(d, R.tick - len);
      nodes.push(
        el('line', {
          x1, y1, x2, y2,
          class: `degree-tick${major ? ' major' : mid ? ' mid' : ''}`,
        })
      );
    }
    g.replaceChildren(...nodes);
  }

  _drawAspects() {
    const g = this.layers.aspects;
    const nodes = [];
    // A selected direction owns the aspect layer. Showing its contacts over
    // the complete natal web made the click look like it had done nothing,
    // especially when several lines crossed at the same hub points.
    const aspects = this.angleFocusKey
      ? this.chart.angleAspects.filter((asp) => asp.a === this.angleFocusKey)
      : this.chart.aspects;
    for (const asp of aspects) {
      const a = this.chart.byKey[asp.a] ?? this.chart.anglePoints?.[asp.a];
      const b = this.chart.byKey[asp.b] ?? this.chart.anglePoints?.[asp.b];
      if (!a || !b) continue;
      // Directional contacts terminate at the focused point inside the wheel;
      // outer ASC/MC/DSC/IC labels are controls, not aspect endpoints.
      const [x1, y1] = this._point(a.longitude, R.hub);
      const [x2, y2] = this._point(b.longitude, R.hub);

      const related = asp.a === this.angleFocusKey
        || (!this.aspectFocusKey
        || asp.a === this.aspectFocusKey
        || asp.b === this.aspectFocusKey);
      const selected = this.selectedAspectKey === this._aspectKey(asp);
      const gradientId = 'selected-aspect-gradient';

      if (selected) {
        // The chord inherits its endpoints' elemental tones, making a shared
        // element a solid line and a cross-element contact a directional blend.
        nodes.push(el('linearGradient', {
          id: gradientId,
          gradientUnits: 'userSpaceOnUse',
          x1, y1, x2, y2,
        }, [
          el('stop', { offset: '0%', 'stop-color': ELEMENTS[a.element]?.color ?? asp.color }),
          el('stop', { offset: '100%', 'stop-color': ELEMENTS[b.element]?.color ?? asp.color }),
        ]));
      }
      const line = el('line', {
        x1, y1, x2, y2,
        class: `aspect-line aspect-${asp.name.toLowerCase()}`
          + (asp.a === this.angleFocusKey ? ' is-directional' : '')
          + (related ? ' is-related' : ' is-dimmed')
          + (selected ? ' is-selected' : ''),
        stroke: asp.color,
        'stroke-opacity': (0.2 + asp.exactness * 0.6).toFixed(3),
        'stroke-width': (1 + asp.exactness * 2.4).toFixed(2),
        'data-aspect': this._aspectKey(asp),
        ...(selected ? {
          style: `--aspect-selection-stroke: url(#${gradientId}); `
            + `--aspect-selection-glow: ${ELEMENTS[a.element]?.glow ?? 'rgba(255, 255, 255, 0.45)'}`,
        } : {}),
      });
      const hit = el('line', { x1, y1, x2, y2, class: 'aspect-hit' });
      hit.addEventListener('click', () => {
        this.toggleAspectSelection(asp);
        this._emit('aspect', asp);
      });
      hit.addEventListener('mouseenter', () => {
        line.classList.add('is-hot');
        this._emit('hoverAspect', asp);
      });
      hit.addEventListener('mouseleave', () => {
        line.classList.remove('is-hot');
        this._emit('hoverAspect', null);
      });
      nodes.push(line, hit);
    }
    g.replaceChildren(...nodes);
  }

  /** Spread markers that would otherwise land on top of each other. */
  _layout(placements) {
    const items = placements
      .map((p) => ({ p, lon: norm360(p.longitude), shown: norm360(p.longitude), ring: 0 }))
      .sort((a, b) => a.lon - b.lon);
    if (items.length < 2) return items;

    const MIN = 7.5;
    for (let pass = 0; pass < 60; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        const cur = items[i];
        const next = items[(i + 1) % items.length];
        const gap = norm360(next.shown - cur.shown);
        if (gap < MIN) {
          const push = (MIN - gap) / 2;
          cur.shown = norm360(cur.shown - push);
          next.shown = norm360(next.shown + push);
          moved = true;
        }
      }
      if (!moved) break;
    }
    // ASC and MC are the chart's fixed directional references. Planets may
    // spread to remain legible, but these markers must stay on the same radial
    // line as their outer labels and focused aspect points.
    for (const item of items) {
      if (item.p.isAngle) item.shown = item.lon;
    }
    // Anything still crowded gets pushed to an inner ring.
    for (let i = 1; i < items.length; i++) {
      if (norm360(items[i].shown - items[i - 1].shown) < MIN * 0.85) {
        items[i].ring = (items[i - 1].ring + 1) % 2;
      }
    }
    return items;
  }

  // -------------------------------------------------------------------------
  // Designer dragging
  //
  // Angular position only: however far the pointer wanders toward or away from
  // the centre, the body stays on its ring and only its longitude changes.
  // -------------------------------------------------------------------------

  /** Screen coordinates -> longitude, with the wheel's rotation undone. */
  _longitudeAt(event) {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    // SVG y grows downward; the angle maths in _point assumes it grows up.
    const deg = (Math.atan2(C - p.y, p.x - C) * 180) / Math.PI;
    return norm360(deg - 180 + this.rotation);
  }

  _startDrag(event, placement) {
    if (this.drag) return;
    event.preventDefault();
    this.svg.setPointerCapture(event.pointerId);
    this.rotationLock = this.rotation;
    this.drag = {
      key: placement.key,
      kind: placement.kind ?? 'body',
      pointerId: event.pointerId,
      startLon: placement.longitude,
      lon: placement.longitude,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      frame: 0,
    };
    this._emit(placement.kind === 'angle' ? 'designerAnglePress' : 'designerPress', placement.key, placement.longitude);
  }

  _onPointerMove(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    // A tap that trembles is still a tap. Past the threshold it is a drag, and
    // the click that would otherwise audition the body is suppressed.
    if (!drag.moved) {
      const dist = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
      if (dist < 3) return;
      const lon = this._longitudeAt(event);
      if (lon == null) return;
      drag.moved = true;
      drag.lon = lon;
      this.svg.classList.add('is-dragging');
      this._emit(drag.kind === 'angle' ? 'designerAngleDragStart' : 'designerDragStart', drag.key, lon, drag.startLon);
    } else {
      const lon = this._longitudeAt(event);
      if (lon == null) return;
      drag.lon = lon;
    }
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (!this.drag) return;
      this.drag.frame = 0;
      this._emit(this.drag.kind === 'angle' ? 'designerAngleMove' : 'designerMove', this.drag.key, this.drag.lon);
    });
  }

  _onPointerUp(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this._endDrag();
    if (drag.moved) {
      if (drag.kind === 'angle') this.ignoreAngleClickUntil = performance.now() + 250;
      this._emit(drag.kind === 'angle' ? 'designerAngleCommit' : 'designerCommit', drag.key, drag.lon);
    } else if (drag.kind !== 'angle') {
      this._emit('body', drag.key);
    }
  }

  _cancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    this._endDrag();
    if (drag.moved) this._emit(drag.kind === 'angle' ? 'designerAngleCancel' : 'designerCancel', drag.key, drag.startLon);
  }

  _endDrag() {
    const drag = this.drag;
    this.drag = null;
    this.rotationLock = null;
    this.svg.classList.remove('is-dragging');
    if (!drag) return;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    if (this.svg.hasPointerCapture?.(drag.pointerId)) this.svg.releasePointerCapture(drag.pointerId);
  }

  _drawPlanets() {
    const g = this.layers.planets;
    const nodes = [];
    this.markers = {};

    // ASC and MC are already represented by the four directional axes. Keeping
    // them in the planet layer duplicated their labels inside the wheel.
    const placements = this.chart.placements.filter((p) => !p.isAngle);
    for (const item of this._layout(placements)) {
      const { p, shown, ring } = item;
      const radius = R.planet - ring * 44;

      // A pointer from the true degree on the ring to the drawn glyph.
      const [tx1, ty1] = this._point(p.longitude, R.planetTick);
      const [tx2, ty2] = this._point(p.longitude, R.planetTick - 10);
      const [gx, gy] = this._point(shown, radius);
      const tone = ELEMENTS[p.element]?.color ?? '#7fd3f0';

      // In an overlay, the second chart's markers are outlined rather than
      // filled, and anything that touches nothing in the other chart is dimmed
      // to show it is present but not sounding.
      // Angles are where the chart is anchored and the Midheaven is derived
      // from the Ascendant, so neither the MC nor a body that is switched off
      // takes a drag.
      const draggable = this.designer && !p.silent && p.key !== 'mc';
      const held = this.drag?.moved && this.drag.key === p.key;

      const group = el('g', {
        class: `planet element-${p.element}`
          + (p.side ? ` side-${p.side}` : '')
          + (p.silent ? ' is-silent' : '')
          + (draggable ? ' is-draggable' : '')
          + (held ? ' is-held' : '')
          + (this.aspectFocusKey === p.key ? ' is-aspect-focus' : ''),
        style: `--planet-tone: ${tone}`,
        'data-body': p.key,
        tabindex: 0,
        role: 'button',
        'aria-label': `${p.name}${p.side ? `, chart ${p.side.toUpperCase()}` : ''} at ${p.label}, house ${p.house}`
          + (draggable ? '. Drag to move it.' : ''),
      });
      // A draggable body auditions from the pointer sequence instead, so that a
      // drag ending over its own marker does not also play it.
      if (!draggable) group.addEventListener('click', () => this._emit('body', p.key));
      group.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._emit('body', p.key);
        }
      });
      group.addEventListener('mouseenter', () => this._emit('hoverBody', p.key));
      group.addEventListener('mouseleave', () => this._emit('hoverBody', null));
      if (draggable) {
        group.addEventListener('pointerdown', (e) => {
          if (e.button != null && e.button !== 0) return;
          this._startDrag(e, p);
        });
        // Makes the whole marker grabbable rather than just the disc — the orb
        // and the glyph both take themselves out of hit testing. Kept to the
        // halo's own radius: any larger and in a stellium you are reliably
        // grabbing the neighbour rather than the planet you aimed at.
        group.appendChild(el('circle', { cx: gx, cy: gy, r: 22, class: 'planet-grab' }));
      }

      group.appendChild(el('line', { x1: tx1, y1: ty1, x2: tx2, y2: ty2, class: 'planet-pointer' }));
      group.appendChild(el('line', { x1: tx2, y1: ty2, x2: gx, y2: gy, class: 'planet-leader' }));
      group.appendChild(el('circle', { cx: gx, cy: gy, r: 21, class: 'planet-halo' }));
      group.appendChild(el('circle', { cx: gx, cy: gy, r: 17, class: 'planet-disc' }));
      group.appendChild(el('circle', { cx: gx, cy: gy, r: 17, class: 'planet-orb' }));
      // "Asc"/"MC" are words, not glyphs, and will not fit at glyph size.
      const isWord = p.glyph.replace(/︎/g, '').length > 1;
      group.appendChild(
        el('text', {
          x: gx, y: gy + 1,
          class: `planet-glyph${isWord ? ' is-word' : ''}`,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        }, p.glyph)
      );
      if (p.retrograde) {
        group.appendChild(
          el('text', {
            x: gx + 20, y: gy - 15,
            class: 'planet-retro',
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          }, '℞')
        );
      }

      nodes.push(group);
      this.markers[p.key] = group;
    }
    g.replaceChildren(...nodes);
  }

  /** Flash a body when it sounds. */
  pulse(key) {
    const marker = this.markers?.[key];
    if (!marker) return;
    marker.classList.remove('is-sounding');
    // Force a reflow so the animation restarts on repeat triggers.
    void marker.getBoundingClientRect();
    marker.classList.add('is-sounding');
    setTimeout(() => marker.classList.remove('is-sounding'), 1400);
  }

  pulseSign(index) {
    const sector = this.layers.signs.querySelector(`[data-sign="${index}"]`);
    if (!sector) return;
    sector.classList.remove('is-sounding');
    void sector.getBoundingClientRect();
    sector.classList.add('is-sounding');
    setTimeout(() => sector.classList.remove('is-sounding'), 1200);
  }

  highlightBody(key) {
    for (const [k, node] of Object.entries(this.markers ?? {})) {
      node.classList.toggle('is-hot', k === key);
    }
  }

  resizeScope() {
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = Math.max(1, Math.round(rect.width));
    this.canvas.width = css * dpr;
    this.canvas.height = css * dpr;
    this.canvas.style.width = `${css}px`;
    this.canvas.style.height = `${css}px`;
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssSize = css;
  }

  drawScope(waveform, level) {
    const ctx = this.ctx2d;
    const size = this._cssSize || 0;
    if (!size) return;
    ctx.clearRect(0, 0, size, size);
    if (!waveform) return;

    const scale = size / VIEW_SIZE;
    const cx = (C - VIEW_MIN) * scale;
    const cy = (C - VIEW_MIN) * scale;
    const base = R.scope * scale;
    // Peaks must stay inside the hub or the trace swamps the aspect chords.
    const gain = base * 0.42;

    const colorAt = (opacity) => {
      if (this.scopePalette.length === 1) {
        const { r, g, b } = this.scopePalette[0];
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
      const gradient = ctx.createLinearGradient(cx - base, cy, cx + base, cy);
      this.scopePalette.forEach(({ r, g, b }, i, colors) => {
        gradient.addColorStop(i / (colors.length - 1), `rgba(${r}, ${g}, ${b}, ${opacity})`);
      });
      return gradient;
    };

    for (const pass of [0, 1, 2]) {
      ctx.beginPath();
      const N = 360;
      for (let i = 0; i <= N; i++) {
        const frac = i / N;
        const idx = Math.floor(frac * (waveform.length - 1));
        const sample = waveform[idx];
        const r = base + sample * gain;
        const a = frac * Math.PI * 2 - Math.PI / 2;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (pass === 0) {
        ctx.strokeStyle = colorAt(Math.min(0.72, 0.3 + level * 4));
        ctx.lineWidth = 24 * scale * (1 + level * 2.5);
        ctx.filter = `blur(${13 * scale}px)`;
      } else if (pass === 1) {
        ctx.strokeStyle = colorAt(Math.min(0.92, 0.58 + level * 3));
        ctx.lineWidth = 8 * scale * (1 + level * 1.5);
        ctx.filter = `blur(${4 * scale}px)`;
      } else {
        ctx.strokeStyle = colorAt(Math.min(1, 0.9 + level));
        ctx.lineWidth = 2.5 * scale;
        ctx.filter = 'none';
      }
      ctx.stroke();
    }
    ctx.filter = 'none';
  }
}

export const ASPECT_LEGEND = ASPECTS;
