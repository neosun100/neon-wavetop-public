/* GENERATED from gameforge/src/stack3d/model.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Stack3D kit — a sprite-stack model: `h` horizontal slices of `w × l` palette indices (0 = empty), slice 0 at the
 *  bottom. Drawn one slice per pixel of height and turned to any angle, a stack reads as a solid object without a
 *  mesh, a texture or a depth sort beyond "far slice first". DOM-free. */
import { grade, pack, type Rgb, type TimeOfDay } from './math';

export interface StackModel {
  w: number;
  l: number;
  h: number;
  /** slices[y][k * w + i]: i across (left → right), k along (front → back), y up */
  slices: Uint8Array[];
}

/** A model from a function of the voxel position (how a game authors its own craft: no art files). */
export function buildModel(w: number, l: number, h: number, at: (i: number, k: number, y: number) => number): StackModel {
  const slices: Uint8Array[] = [];
  for (let y = 0; y < h; y++) {
    const s = new Uint8Array(w * l);
    for (let k = 0; k < l; k++) for (let i = 0; i < w; i++) s[k * w + i] = at(i, k, y) & 255;
    slices.push(s);
  }
  return { w, l, h, slices };
}

/** Run-length form, (count, index) byte pairs over all slices bottom-up → base64. Runs are split at 255. */
export function encodeRle(m: StackModel): string {
  let bin = '';
  let run = 0;
  let cur = -1;
  const flush = (): void => {
    if (run > 0) bin += String.fromCharCode(run, cur);
  };
  for (const s of m.slices) {
    for (let o = 0; o < s.length; o++) {
      if (s[o] === cur && run < 255) run++;
      else {
        flush();
        cur = s[o];
        run = 1;
      }
    }
  }
  flush();
  return btoa(bin);
}

export function decodeRle(b64: string, w: number, l: number, h: number): StackModel {
  const bin = atob(b64);
  const flat = new Uint8Array(w * l * h);
  let o = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const n = bin.charCodeAt(i);
    flat.fill(bin.charCodeAt(i + 1), o, o + n);
    o += n;
  }
  // a truncated or mis-sized string would otherwise draw a silently cropped model
  if (o !== flat.length) {
    throw new Error(JSON.stringify({ error: 'model_size_mismatch', message: 'RLE data does not fill w × l × h voxels', actual: o, expected: flat.length }));
  }
  const slices: Uint8Array[] = [];
  for (let y = 0; y < h; y++) slices.push(flat.subarray(y * w * l, (y + 1) * w * l));
  return { w, l, h, slices };
}

/** A model prepared for drawing: per slice, the filled voxels as (across, along, index) relative to the pivot. */
export interface StackSprite {
  model: StackModel;
  /** pivot along the length (voxels from the front) and the pivot slice */
  pivotK: number;
  pivotY: number;
  a: Float32Array[];
  b: Float32Array[];
  c: Uint8Array[];
  /** 1 where any slice has a voxel: the shape of the shadow it casts */
  footprint: Uint8Array;
}

export function makeSprite(model: StackModel, pivotK: number, pivotY: number): StackSprite {
  const { w, l } = model;
  const sp: StackSprite = { model, pivotK, pivotY, a: [], b: [], c: [], footprint: new Uint8Array(w * l) };
  for (const s of model.slices) {
    let n = 0;
    for (let o = 0; o < s.length; o++) if (s[o]) n++;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    const c = new Uint8Array(n);
    let j = 0;
    for (let k = 0; k < l; k++) {
      for (let i = 0; i < w; i++) {
        const v = s[k * w + i];
        if (!v) continue;
        a[j] = i - (w - 1) / 2;
        b[j] = pivotK - k;
        c[j] = v;
        j++;
        sp.footprint[k * w + i] = 1;
      }
    }
    sp.a.push(a);
    sp.b.push(b);
    sp.c.push(c);
  }
  return sp;
}

/** Three tones per index: as painted, one tone up (faces the sun), one tone down (faces away). */
export interface ModelPalette {
  base: Uint32Array;
  lit: Uint32Array;
  dim: Uint32Array;
  outline: number;
}

/** [index, r, g, b]. Indices come in families of 16 (1–16, 17–32, …), dark → light inside a family: "one tone up"
 *  is the next index of the same family, so shading needs no arithmetic on colours and stays on-palette. */
export type PaletteRow = readonly [number, number, number, number];

export function makePalette(rows: readonly PaletteRow[], tod: TimeOfDay = 'day', emissiveFrom = 49): ModelPalette {
  const base = new Uint32Array(256);
  const amount = tod === 'sunset' ? 0.5 : tod === 'night' ? 0.16 : 0;
  for (const [idx, r, g, b] of rows) {
    // emissive families (engine glow, lamps) are not graded: they make their own light
    const c: Rgb = idx >= emissiveFrom ? [r, g, b] : grade([r, g, b], tod, amount);
    base[idx] = pack(c[0], c[1], c[2]);
  }
  const lit = new Uint32Array(256);
  const dim = new Uint32Array(256);
  for (const [idx] of rows) {
    const shaded = idx < emissiveFrom;
    lit[idx] = shaded && ((idx - 1) & 15) < 15 && base[idx + 1] ? base[idx + 1] : base[idx];
    dim[idx] = shaded && ((idx - 1) & 15) > 0 && base[idx - 1] ? base[idx - 1] : base[idx];
  }
  const oc = tod === 'night' ? ([44, 64, 118] as const) : grade([13, 15, 26], tod, 0.3);
  return { base, lit, dim, outline: pack(oc[0], oc[1], oc[2]) };
}

/** Where a model is and how it is turned. yaw 0 points up the map (−y), positive turns right; a positive roll dips
 *  the right wing; a positive pitch lifts the nose. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  pitch: number;
  scale: number;
}

/** A pose's own axes in the world (x right, y down the map, z up): right, forward, up. */
export interface Axes {
  rx: number; ry: number; rz: number;
  fx: number; fy: number; fz: number;
  ux: number; uy: number; uz: number;
  cosRoll: number;
}

export function poseAxes(p: Pose): Axes {
  const cs = Math.cos(p.yaw);
  const sn = Math.sin(p.yaw);
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  const u2x = cs * sr;
  const u2y = sn * sr;
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  return {
    rx: cs * cr, ry: sn * cr, rz: -sr,
    fx: sn * cp + u2x * sp, fy: -cs * cp + u2y * sp, fz: cr * sp,
    ux: u2x * cp - sn * sp, uy: u2y * cp + cs * sp, uz: cr * cp,
    cosRoll: cr,
  };
}

/** A model-space point (across, along from the pivot, slices above the pivot) in the world. */
export function modelPoint(p: Pose, ax: Axes, a: number, b: number, up: number, out: { x: number; y: number; z: number }): void {
  const s = p.scale;
  out.x = p.x + (a * ax.rx + b * ax.fx + up * ax.ux) * s;
  out.y = p.y + (a * ax.ry + b * ax.fy + up * ax.uy) * s;
  out.z = p.z + (a * ax.rz + b * ax.fz + up * ax.uz) * s;
}
