/* GENERATED from gameforge/src/particles.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Pooled additive particles in world (cell) units, drawn with pre-rendered glow sprites. */

export const PALETTE = ['#00f0ff', '#ff2bd6', '#8a5cff', '#ffcf3a', '#ffffff', '#ff2a4d', '#3dff9a', '#ff8a1f'] as const;
export const enum C {
  Cyan = 0,
  Magenta = 1,
  Violet = 2,
  Gold = 3,
  White = 4,
  Red = 5,
  Lime = 6,
  Orange = 7,
}

const SPRITE = 64;

export class Particles {
  readonly cap: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly size: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly color: Uint8Array;
  private readonly streak: Uint8Array;
  private count = 0;
  private readonly sprites: HTMLCanvasElement[];

  constructor(cap = 6000) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.color = new Uint8Array(cap);
    this.streak = new Uint8Array(cap);
    this.sprites = PALETTE.map((col) => {
      const c = document.createElement('canvas');
      c.width = c.height = SPRITE;
      const g = c.getContext('2d');
      if (!g) throw new Error('2d context unavailable for sprite');
      const grd = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.18, col);
      grd.addColorStop(0.45, col + '55');
      grd.addColorStop(1, col + '00');
      g.fillStyle = grd;
      g.fillRect(0, 0, SPRITE, SPRITE);
      return c;
    });
  }

  get alive(): number {
    return this.count;
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: number, opts?: { drag?: number; grav?: number; streak?: boolean }): void {
    if (this.count >= this.cap) return; // pool full: drop silently is intended — cosmetic only
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.color[i] = color;
    this.drag[i] = opts?.drag ?? 2.5;
    this.grav[i] = opts?.grav ?? 0;
    this.streak[i] = opts?.streak ? 1 : 0;
  }

  burst(x: number, y: number, n: number, speed: number, colors: readonly number[], life = 0.8, size = 0.5, streak = true): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.9);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.7), size * (0.5 + Math.random()), colors[k % colors.length], { streak });
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  clear(): void {
    this.count = 0;
  }

  /** `sx, sy, s`: world→screen transform (screen = world * s + offset). */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.max[i];
      const px = ox + this.x[i] * s;
      const py = oy + this.y[i] * s;
      const r = this.size[i] * s * (0.4 + 0.6 * t);
      ctx.globalAlpha = Math.min(1, t * 1.6);
      if (this.streak[i]) {
        const k = 0.05 * s;
        ctx.strokeStyle = PALETTE[this.color[i]];
        ctx.lineWidth = Math.max(1, r * 0.35);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - this.vx[i] * k, py - this.vy[i] * k);
        ctx.stroke();
      }
      ctx.drawImage(this.sprites[this.color[i]], px - r, py - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private kill(i: number): void {
    const j = --this.count;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.size[i] = this.size[j];
    this.drag[i] = this.drag[j];
    this.grav[i] = this.grav[j];
    this.color[i] = this.color[j];
    this.streak[i] = this.streak[j];
  }
}

/**
 * Photosensitivity guard (WCAG 2.3.1: no more than 3 flashes per second). Every
 * full-screen luminance pulse goes through here; beyond the budget it is attenuated.
 */
export class FlashGuard {
  private stamps: number[] = [];
  constructor(private readonly reduced: boolean) {}
  allow(now: number, strength: number): number {
    this.stamps = this.stamps.filter((t) => now - t < 1);
    const scale = this.reduced ? 0.25 : 1;
    if (strength < 0.15) return strength * scale;
    if (this.stamps.length >= 3) return Math.min(strength, 0.1) * scale;
    this.stamps.push(now);
    return strength * scale;
  }
}
