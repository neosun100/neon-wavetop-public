/* GENERATED from gameforge/src/stack3d/math.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Stack3D kit — small shared maths. DOM-free and deterministic (integer hashes, no Math.random, no clock). */

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** An angle folded into (−π, π]. */
export function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** 8-bit integer hash of an integer (per-cell dither, speckle, stars): bit-identical in every JS engine. */
export function hash8(o: number): number {
  let h = Math.imul(o ^ (o >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h >>> 24) & 255;
}

const c255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** An opaque pixel as the little-endian uint32 an ImageData buffer holds (0xAABBGGRR). 0 means "nothing drawn". */
export function pack(r: number, g: number, b: number): number {
  return ((255 << 24) | (c255(b) << 16) | (c255(g) << 8) | c255(r)) >>> 0;
}

/** `fg` over `bg`, k in 0..256. */
export function mix(bg: number, fg: number, k: number): number {
  const r = ((bg & 255) * (256 - k) + (fg & 255) * k) >> 8;
  const g = (((bg >> 8) & 255) * (256 - k) + ((fg >> 8) & 255) * k) >> 8;
  const b = (((bg >> 16) & 255) * (256 - k) + ((fg >> 16) & 255) * k) >> 8;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** 4×4 ordered dither thresholds (0..15): alpha in a palette-only picture is a dither, never a blend. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export type Rgb = readonly [number, number, number];
export type TimeOfDay = 'day' | 'sunset' | 'night';

/** Colour grading per time of day (amount 0..1): one palette, three moods. */
export function grade(c: Rgb, tod: TimeOfDay, amount: number): Rgb {
  if (tod === 'day' || amount <= 0) return c;
  let r: number, g: number, b: number;
  if (tod === 'sunset') {
    r = 0.95 * c[0] + 0.1 * c[1] + 12;
    g = 0.72 * c[1] + 0.05 * c[0] + 4;
    b = 0.7 * c[2] + 0.08 * c[0] + 10;
  } else {
    r = 0.22 * c[0] + 2;
    g = 0.3 * c[1] + 6;
    b = 0.5 * c[2] + 22;
  }
  return [c[0] + (r - c[0]) * amount, c[1] + (g - c[1]) * amount, c[2] + (b - c[2]) * amount];
}
