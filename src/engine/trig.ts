/* GENERATED from gameforge/src/trig.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/**
 * Deterministic trigonometry and decay for simulations. `Math.sin` / `cos` / `atan2` / `exp` are
 * "implementation-approximated": they may differ in the last bits between JS engines (V8 vs JavaScriptCore),
 * which makes a replay recorded in Safari diverge in Node. Only + − × ÷ and sqrt are bit-identical everywhere,
 * so a sim uses these (|error| < 2e-9 on the reduced range — far below a pixel).
 * Extracted on the third copy (GRAZE, APEX, Stack3D flight); games' `tests/engine.test.ts` bans the Math forms
 * in src/core and src/ai.
 */
export const TAU = 6.283185307179586;
export const PI = 3.141592653589793;
export const HALF_PI = 1.5707963267948966;

/** sin on [-π/2, π/2]: odd Taylor series to x^13. */
function sinCore(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
}

export function sin(x: number): number {
  let r = x - Math.round(x / TAU) * TAU;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** atan on [0, 1] via one argument halving and a series; atan2 is built on it. */
function atanCore(z: number): number {
  // atan(z) = 2·atan(z / (1 + sqrt(1 + z²))) shrinks |z| ≤ 1 to ≤ tan(π/8) ≈ 0.414
  const h = z / (1 + Math.sqrt(1 + z * z));
  const h2 = h * h;
  let s = 0;
  let p = h;
  for (let k = 0; k < 14; k++) {
    s += p / (2 * k + 1);
    p *= -h2;
  }
  return 2 * s;
}

export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const a = ay <= ax ? atanCore(ay / ax) : HALF_PI - atanCore(ax / ay);
  const q = x < 0 ? PI - a : a;
  return y < 0 ? -q : q;
}

/** e^(−x) for x ≥ 0 (easing: `1 − expNeg(dt · rate)`): Taylor to degree 10 on x/16, then four squarings. x is clamped to 40
 *  (e^−40 ≈ 4e−18: nothing an easing can tell from 0). */
export function expNeg(x: number): number {
  const y = (x < 0 ? 0 : x > 40 ? 40 : x) / 16;
  let e = 1 - y * (1 - (y / 2) * (1 - (y / 3) * (1 - (y / 4) * (1 - (y / 5) * (1 - (y / 6) * (1 - (y / 7) * (1 - (y / 8) * (1 - (y / 9) * (1 - y / 10)))))))));
  e *= e;
  e *= e;
  e *= e;
  return e * e;
}

export const hypot = (x: number, y: number, z = 0): number => Math.sqrt(x * x + y * y + z * z);
