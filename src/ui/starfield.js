/**
 * A quiet technical-paper backdrop. The old coloured starfield made the
 * interface feel like a game; this construction grid lets the chart read like
 * a printed astronomical diagram and only darkens slightly with the audio.
 */
export class Starfield {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
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
  }

  draw(_dt, level = 0) {
    const { ctx, w, h } = this;
    this.level += (level - this.level) * 0.08;
    ctx.clearRect(0, 0, w, h);

    const vx = w * 0.62;
    const vy = h * 0.48;
    const maxR = Math.hypot(w, h);
    const alpha = 0.045 + Math.min(0.025, this.level * 0.16);

    ctx.save();
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.lineWidth = 1;

    // Ruled-paper horizontals.
    for (let y = -20; y < h + 40; y += 72) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    // Radial construction lines, as if the natal wheel continued off page.
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx + Math.cos(angle) * maxR, vy + Math.sin(angle) * maxR);
      ctx.stroke();
    }

    // A few broad drafting circles keep the geometry visible around the wheel.
    for (let radius = 180; radius < maxR; radius += 220) {
      ctx.beginPath();
      ctx.arc(vx, vy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}
