/**
 * Background starfield. Slow parallax rotation about the centre of the chart,
 * with the brightness of the field following the output level so the page
 * breathes with the sound.
 */

export class Starfield {
  constructor(canvas, { count = 260 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    this.count = count;
    this.angle = 0;
    this.level = 0;
    this.resize();
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

    const maxR = Math.hypot(w, h) / 2;
    this.stars = Array.from({ length: this.count }, () => ({
      r: Math.sqrt(Math.random()) * maxR,
      a: Math.random() * Math.PI * 2,
      size: Math.random() ** 2.4 * 1.7 + 0.35,
      hue: Math.random() < 0.14 ? 30 + Math.random() * 30 : 220 + Math.random() * 50,
      twinkle: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.9,
    }));
  }

  draw(dt, level = 0) {
    const { ctx, w, h } = this;
    this.angle += dt * 0.006;
    this.level += (level - this.level) * 0.12;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const boost = 1 + this.level * 2.4;

    for (const s of this.stars) {
      s.twinkle += dt * 1.4 * s.speed;
      const a = s.a + this.angle * s.speed;
      const x = cx + s.r * Math.cos(a);
      const y = cy + s.r * Math.sin(a) * 0.92;
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;

      const alpha = (0.22 + 0.5 * (0.5 + 0.5 * Math.sin(s.twinkle))) * boost;
      ctx.beginPath();
      ctx.arc(x, y, s.size * (1 + this.level * 0.7), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 70%, ${72 + this.level * 18}%, ${Math.min(1, alpha)})`;
      ctx.fill();
    }
  }
}
