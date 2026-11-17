/* GENERATED from gameforge/src/pixelfx/vendor/core/index.d.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// neon-engine, hand-written (NOT upstream): types for the slim barrel core/index.js, abridged to what
// src/pixelfx/*.ts, tools and tests use. The JS is pixelfx (MIT, see ../LICENSE); facts cited are from
// its source at the pinned commit (PROVENANCE.json).

/** 0xAABBGGRR: a colour laid out like ImageData bytes on a little-endian machine (core/color.js:1-6). */
export type Color = number;
/** Dark → bright; hex strings or colour numbers. Effects fit() it to their own length at create(). */
export type Ramp = readonly (string | Color)[];

/** w × h art pixels whose top-left is (ox, oy). `color` = opaque pixels, `light` = additive glow. */
export interface Frame {
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
  readonly color: Uint32Array<ArrayBuffer>;
  readonly light: Uint32Array<ArrayBuffer>;
}

export interface FxMeta {
  readonly name: string;
  readonly desc: string;
  readonly tags?: readonly string[];
  readonly size: readonly [number, number];
  readonly origin: readonly [number, number];
  readonly duration: number;
  readonly loop?: boolean;
  readonly fps?: number;
  readonly bg?: string;
  readonly actor?: number | boolean;
  readonly options?: Readonly<Record<string, unknown>>;
}

/** What an effect's create() returns. */
export interface FxImpl {
  update?(dt: number, o: FxOptions): void;
  draw(p: Painter, t: number, o: FxOptions): void;
  drawBack?(p: Painter, t: number, o: FxOptions): void;
}

/** createFx options: placement + light + the effect's own options. Mutable: x/y/light are re-read every draw (core/fx.js:71-74). */
export interface FxOptions {
  x?: number;
  y?: number;
  flip?: boolean;
  angle?: number;
  seed?: number;
  palette?: Ramp;
  light?: number;
  [k: string]: unknown;
}

export interface FxModule {
  readonly meta: FxMeta;
  create?(o: FxOptions): FxImpl;
}

/** A live instance (core/fx.js:51-97). */
export interface FxInstance {
  readonly meta: FxMeta;
  readonly options: FxOptions;
  readonly t: number;
  update(dt: number): void;
  draw(frame: Frame, layer?: 'back' | 'front'): void;
  stop(): void;
  done(): boolean;
}

export class Painter {
  constructor(frame: Frame);
  fade: number;
  lightK: number;
  layer: 'back' | 'front';
  reset(): this;
  place(x: number, y: number, flip?: boolean, angle?: number): this;
  put(sx: number, sy: number, c: Color, a?: number): void;
  add(sx: number, sy: number, c: Color, k?: number): void;
  blendPx(sx: number, sy: number, c: Color, a: number): void;
}

export interface Glyph {
  readonly w: number;
  readonly rows: readonly (readonly (0 | 1 | boolean | number)[])[];
}
export const FONTS: { readonly mini: { readonly h: number; readonly glyphs: Readonly<Record<string, Glyph>> }; readonly big: { readonly h: number; readonly glyphs: Readonly<Record<string, Glyph>> } };
export function textWidth(str: string, font?: 'mini' | 'big'): number;

export function createFrame(w: number, h: number, ox?: number, oy?: number): Frame;
export function clearFrame(f: Frame): Frame;
export function createFx(mod: FxModule, o?: FxOptions): FxInstance;
export function painterFor(frame: Frame): Painter;
export function hex(h: string | Color): Color;
export function luma(c: Color): number;
export function fit(r: Ramp, n: number): Color[];
