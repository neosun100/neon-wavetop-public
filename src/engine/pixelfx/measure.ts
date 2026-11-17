/* GENERATED from gameforge/src/pixelfx/measure.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Offline measurement of a vendored effect, shared by tests (T-V3..V6) and tools/pfx-sheet.ts.
 *  Node-safe: touches no DOM. Not imported by game code (tree-shaken if it were). */
import { clearFrame, createFrame, createFx, Painter, type Frame, type FxInstance, type Ramp } from './vendor/core/index.js';
import type { PfxSpec } from './spec';
import { RAMPS } from './ramps';

/** light luma above which an art pixel counts as lit (05 §2.6) */
export const LIT_LUMA = 0.15;

export const lumaOf = (v: number) => (0.299 * (v & 255) + 0.587 * ((v >>> 8) & 255) + 0.114 * ((v >>> 16) & 255)) / 255;

export function litCount(f: Frame): number {
  let n = 0;
  for (let i = 0; i < f.light.length; i++) if (f.light[i] && lumaOf(f.light[i]) > LIT_LUMA) n++;
  return n;
}
export function nonZero(buf: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i]) n++;
  return n;
}
/** FNV-1a over both buffers: bit-identical frames ⇔ equal hash (for our purposes). */
export function frameHash(f: Frame): number {
  let h = 0x811c9dc5;
  for (const buf of [f.color, f.light])
    for (let i = 0; i < buf.length; i++) {
      h ^= buf[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  return h;
}

export interface Sandbox {
  frame: Frame;
  inst: FxInstance;
  /** margin around meta.size so spill is visible */
  pad: number;
}
/** One effect alone in a frame of its meta.size (+pad), placed at its origin, as the layer would create it. */
export function sandbox(spec: PfxSpec, o: { seed?: number; palette?: Ramp; accent?: Ramp; light?: number; pad?: number; opts?: Record<string, unknown> } = {}): Sandbox {
  const m = spec.mod.meta, pad = o.pad ?? 16;
  const frame = createFrame(m.size[0] + 2 * pad, m.size[1] + 2 * pad);
  const opts: Record<string, unknown> = {
    ...spec.opts,
    ...o.opts,
    seed: o.seed ?? 1,
    palette: o.palette ?? RAMPS.CYAN,
    light: o.light ?? 1,
    x: m.origin[0] + pad,
    y: m.origin[1] + pad,
  };
  if (o.accent && spec.accentKey) opts[spec.accentKey] = o.accent;
  return { frame, inst: createFx(spec.mod, opts), pad };
}

/** Draws t = 0 (the hero frame), then steps at `dt` until t ≥ until, calling visit after every draw. */
export function run(sb: Sandbox, dt: number, until: number, visit: (t: number, f: Frame) => void): void {
  const draw = (t: number) => {
    clearFrame(sb.frame);
    sb.inst.draw(sb.frame);
    visit(t, sb.frame);
  };
  draw(0);
  for (let k = 1; k * dt < until + 1e-9; k++) {
    sb.inst.update(dt);
    draw(k * dt);
  }
}

/** Peak lit art px over the effect's life (seed 1, CYAN, light 1): the number PfxSpec.litPx must match. */
export function peakLit(spec: PfxSpec, seed = 1): number {
  const sb = sandbox(spec, { seed });
  let mx = 0;
  run(sb, 1 / 30, spec.mod.meta.duration + 0.4, (_, f) => (mx = Math.max(mx, litCount(f))));
  return mx;
}

/** Peak painter writes (put + add + blendPx calls) per frame over the effect's life: the deterministic cost
 *  proxy PfxSpec.writes must match (max over seeds). Wraps Painter.prototype for the duration of the call only. */
export function peakWrites(spec: PfxSpec, seeds: readonly number[] = [1, 2, 3, 7]): number {
  const P = Painter.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const keys = ['put', 'add', 'blendPx'], orig = keys.map((k) => P[k]);
  let n = 0, mx = 0;
  keys.forEach((k, i) => {
    P[k] = function (this: unknown, ...a: unknown[]) {
      n++;
      return orig[i].apply(this, a);
    };
  });
  try {
    for (const seed of seeds)
      run(sandbox(spec, { seed }), 1 / 30, spec.mod.meta.duration + 0.4, () => {
        mx = Math.max(mx, n);
        n = 0;
      });
  } finally {
    keys.forEach((k, i) => (P[k] = orig[i]));
  }
  return mx;
}

/** Lit art px as the player sees it: light luma × gain > LIT_LUMA (the blit multiplies light by lightGain). */
export function shownLit(f: Frame, gain: number): number {
  let n = 0;
  for (let i = 0; i < f.light.length; i++) if (f.light[i] && lumaOf(f.light[i]) * gain > LIT_LUMA) n++;
  return n;
}
