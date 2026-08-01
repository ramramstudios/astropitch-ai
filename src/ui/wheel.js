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
    this.scopePalette = [this._scopeColor('air')];

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

    container.appendChild(this.svg);
    container.appendChild(this.canvas);

    this._drawStaticRings();
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

  /** Use one element hue for a voice, or a two-colour field for an aspect. */
  setScopeTone(elements) {
    const tones = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
    if (tones.length) this.scopePalette = tones.slice(0, 2).map((element) => this._scopeColor(element));
  }

  /** Screen angle in radians for an ecliptic longitude. */
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
    this.rotation = chart.cusps ? chart.cusps[0] : 0;
    this._drawStaticRings();
    this._drawSigns();
    this._drawHouses();
    this._drawTicks();
    this._drawAspects();
    this._drawPlanets();
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

      // House number, centred in its own span.
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

    // Angle labels outside the rim.
    const angleLabels = [[cusps[0], 'ASC'], [cusps[9], 'MC'], [cusps[6], 'DSC'], [cusps[3], 'IC']];
    for (const [lon, name] of angleLabels) {
      const [x, y] = this._point(lon, R.rim + 16);
      nodes.push(
        el('text', {
          x, y,
          class: 'angle-label',
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        }, name)
      );
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
    for (const asp of this.chart.aspects) {
      const a = this.chart.byKey[asp.a];
      const b = this.chart.byKey[asp.b];
      if (!a || !b) continue;
      const [x1, y1] = this._point(a.longitude, R.hub);
      const [x2, y2] = this._point(b.longitude, R.hub);

      const line = el('line', {
        x1, y1, x2, y2,
        class: `aspect-line aspect-${asp.name.toLowerCase()}`,
        stroke: asp.color,
        'stroke-opacity': (0.2 + asp.exactness * 0.6).toFixed(3),
        'stroke-width': (1 + asp.exactness * 2.4).toFixed(2),
        'data-aspect': `${asp.a}-${asp.b}`,
      });
      const hit = el('line', { x1, y1, x2, y2, class: 'aspect-hit' });
      hit.addEventListener('click', () => this._emit('aspect', asp));
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
    // Anything still crowded gets pushed to an inner ring.
    for (let i = 1; i < items.length; i++) {
      if (norm360(items[i].shown - items[i - 1].shown) < MIN * 0.85) {
        items[i].ring = (items[i - 1].ring + 1) % 2;
      }
    }
    return items;
  }

  _drawPlanets() {
    const g = this.layers.planets;
    const nodes = [];
    this.markers = {};

    const placements = this.chart.placements.filter((p) => p.key !== 'mc');
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
      const group = el('g', {
        class: `planet element-${p.element}`
          + (p.side ? ` side-${p.side}` : '')
          + (p.silent ? ' is-silent' : ''),
        style: `--planet-tone: ${tone}`,
        'data-body': p.key,
        tabindex: 0,
        role: 'button',
        'aria-label': `${p.name}${p.side ? `, chart ${p.side.toUpperCase()}` : ''} at ${p.label}, house ${p.house}`,
      });
      group.addEventListener('click', () => this._emit('body', p.key));
      group.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._emit('body', p.key);
        }
      });
      group.addEventListener('mouseenter', () => this._emit('hoverBody', p.key));
      group.addEventListener('mouseleave', () => this._emit('hoverBody', null));

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

  // -------------------------------------------------------------------------
  // Circular oscilloscope in the hub
  // -------------------------------------------------------------------------

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

    // The canvas covers the same box as the padded viewBox, so map through it.
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

    // A broad colour bloom, a tighter halo, and a bright technical core.
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
