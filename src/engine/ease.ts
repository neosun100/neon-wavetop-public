/* GENERATED from gameforge/src/ease.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
export const easeOutBack = (t: number, s = 1.70158) => {
  const u = clamp(t) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
export const easeOutElastic = (t: number) => {
  const x = clamp(t);
  if (x === 0 || x === 1) return x;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

/** Critically-damped-ish spring for camera / UI motion (anticipation + follow-through). */
export class Spring {
  velocity = 0;
  constructor(
    public value: number,
    public target = value,
    private readonly k = 180,
    private readonly damping = 22,
  ) {}
  step(dt: number): number {
    const h = Math.min(dt, 1 / 30);
    const a = this.k * (this.target - this.value) - this.damping * this.velocity;
    this.velocity += a * h;
    this.value += this.velocity * h;
    return this.value;
  }
  kick(v: number): void {
    this.velocity += v;
  }
}

/** Angle lerp along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
