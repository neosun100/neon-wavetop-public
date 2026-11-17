/* GENERATED from gameforge/src/pixelfx/layer.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** PixelLayer: the bridge between game events and vendored pixelfx effects (design 05 §2.3).
 *
 *  Render-only. It never reads or writes simulation state; it is stepped by presentation (fx) time, which
 *  Juice freezes during hit-stop, never by the sim clock. One shared art frame for the whole screen at an
 *  integer scale, two passes (back / front), both buffers added with 'lighter' (design 05 §1.3 rule 2:
 *  paint is additive too, so dark outline / soot pixels can never punch holes in neon lines, and the
 *  near-black low ramp steps add nothing instead of drawing grey dither).
 *
 *  Every refusal is counted in stats.dropped by reason — degradation is visible, never silent.
 *
 *  SpawnResult and stats are PRESENTATION ONLY: they depend on the wall-clock governor (performance.now) and on
 *  the caller's `now`, so the same replay gives different results on a slow and a fast machine. They must never
 *  feed the sim, the AI or the score (games' tests/engine.test.ts checks that src/core and src/ai import neither
 *  juice nor pixelfx). */
import { clearFrame, createFrame, createFx, type Frame, type FxInstance, type FxOptions, type Ramp } from './vendor/core/index.js';
import type { PfxClass, PfxSpec } from './spec';

/** The narrow slice of particles.ts FlashGuard this needs (the game passes its shell.guard). */
export interface FlashGate {
  allow(now: number, strength: number): number;
}

export const PixelLimits = {
  /** CSS px per art px. Integer only: a fractional nearest upscale turns the Bayer dither into grey mush. */
  artPx: 2,
  /** fixed effect step (Hz), like pixelfx gallery/app.js; createFx sub-steps to 1/120 inside */
  stepHz: 30,
  /** s of fx time banked at most (a stalled tab must not replay seconds of effects at once) */
  accMax: 0.25,
  maxLive: 12,
  /** two bigs at once is where the bench p95 doubles and frame max reaches 20-30 ms (05 §2.6) */
  maxByClass: { small: 10, medium: 2, big: 1 },
  /** Σ litPx·light over live effects, art px (≈2.9 % of a 1280×800 screen at artPx 2) */
  lightPxFrame: 7_500,
  /** below this light a non-terminal spawn is refused ('light'), not shown as an invisible ghost */
  minLight: 0.25,
  /** global gain on the light blit (report 03 §8: 0.4-0.6, our bloom already haloes the white cores) */
  lightGain: 0.5,
  /** subtracted from shown light (0..255, after gain): the wide faint glow skirts read as a flat teal fog disc
   *  through bloom (Phase-0 sheets, 06-prototype.md); cores and lines are far above it. Soft (subtract), not a cut. */
  lightFloor: 22,
  /** deterministic cost ceiling, painter writes per frame. Enforced at spawn as Σ PfxSpec.writes (each live
   *  effect's measured PEAK) ≤ this, so the actual per-frame writes can never exceed it. Count caps alone do
   *  not bound cost: T-V7 measured 187 k writes at the count caps (parries cost 2× hit-sparks, 2 mediums). */
  writesFrame: 150_000,
  /** EMA of layer ms above which, sustained for governorHold s, the governor sheds load */
  governorMs: 3,
  governorHold: 0.5,
  /** art px around the frame; anchors outside are not drawn (glows are not pre-clipped) */
  cullMargin: 48,
} as const;

type Limits = {
  readonly [K in keyof typeof PixelLimits]: (typeof PixelLimits)[K] extends number ? number : { readonly [C in PfxClass]: number };
};

/** 'reduced': reduced motion shows small effects only · 'off': the layer is off (big-endian host) */
export type SpawnResult = 'ok' | 'rate' | 'cap' | 'light' | 'governor' | 'culled' | 'reduced' | 'off';
export type DropReason = Exclude<SpawnResult, 'ok'>;
/** world → CSS px, owned by the game view (shake/zoom included or not, the game's choice) */
export interface PfxCamera {
  toCss(wx: number, wy: number): readonly [number, number];
}
export interface SpawnReq {
  spec: PfxSpec;
  /** world coords */
  x: number;
  y: number;
  /** from the event (e.g. tick·64 + index) — never Math.random */
  seed: number;
  palette: Ramp;
  accent?: Ramp;
  angle?: number;
  flip?: boolean;
  /** 0..1 before the light budget and FlashGuard */
  light?: number;
  /** 2 = terminal / show moment: may evict a lower-priority one of the same class */
  priority?: 0 | 1 | 2;
  /** live world anchor (car, ship); null ⇒ the effect is stopped and fades where it was */
  follow?: () => readonly [number, number] | null;
  layer?: 'front' | 'back';
  /** effect-own options (aim, cross…), over the spec's defaults */
  opts?: Record<string, unknown>;
}
export interface PfxStats {
  /** effects holding a slot (what the caps count) */
  live: number;
  byClass: Record<PfxClass, number>;
  /** effects evicted by a priority-2 spawn: still drawn while they fade (≤ 0.3 s), no longer holding a slot */
  leaving: number;
  dropped: Record<DropReason, number>;
  /** Σ litPx·light over live effects */
  lightPx: number;
  /** EMA of measured step+render ms (browser) */
  ms: number;
  /** false ⇒ the layer is off (big-endian host); the debug HUD shows "pfx: off" */
  on: boolean;
  governed: boolean;
}

interface Live {
  inst: FxInstance;
  spec: PfxSpec;
  light: number;
  priority: number;
  wx: number;
  wy: number;
  follow?: () => readonly [number, number] | null;
  pass: 'front' | 'back';
  /** evicted by a priority-2 spawn and fading: drawn and charged to the cost and light budgets, but no slot */
  leaving?: boolean;
}

const isLittleEndian = () => new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/*! pixelfx (MIT License) Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez - https://github.com/patch-gg/pixelfx
 *  Effects adapted from Sprite Fusion (https://www.spritefusion.com), Copyright (c) 2026 Hugo Duprez, MIT License.
 *  Juice timing ideas (hit-stop, shake) from Hollow Crown, Copyright (c) 2026 rehan-remade, MIT License.
 *  Full text: licenses/pixelfx/LICENSE.txt and licenses/pixelfx/NOTICE.md, served with this game. */
// ^ The legal comment sits on the class every game that plays an effect keeps: rollup drops comments of
//   modules with no kept statement (a barrel like core/index.js), esbuild/vite keep a /*! on a kept one.
//   tests/bundle.test.ts T-L3 checks both bundlers. The vendored files' own // attributions are minified away.
export class PixelLayer {
  readonly limits: Limits;
  lightGain: number;
  readonly stats: PfxStats;
  private readonly live: Live[] = [];
  private readonly last = new Map<string, number>();
  private readonly guard: FlashGate;
  private readonly reduced: boolean;
  private frame: Frame | null = null;
  /** device px per art px (integer) and CSS px per art px */
  private devScale = 2;
  private cssPerArt = 2;
  private acc = 0;
  private rate = 1;
  private overSince: number | null = null;
  private lastBig = -Infinity;
  private cam: PfxCamera | null = null;
  private imgs: { c32: Uint32Array<ArrayBuffer>; l32: Uint32Array<ArrayBuffer>; color: ImageData; light: ImageData; cc: HTMLCanvasElement; cl: HTMLCanvasElement } | null = null;

  constructor(o: { guard: FlashGate; reduced: boolean; limits?: Partial<Limits>; littleEndian?: () => boolean }) {
    this.guard = o.guard;
    this.reduced = o.reduced;
    this.limits = { ...PixelLimits, ...o.limits } as Limits;
    this.lightGain = this.limits.lightGain;
    const on = (o.littleEndian ?? isLittleEndian)();
    this.stats = {
      live: 0,
      byClass: { small: 0, medium: 0, big: 0 },
      leaving: 0,
      dropped: { rate: 0, cap: 0, light: 0, governor: 0, culled: 0, reduced: 0, off: 0 },
      lightPx: 0,
      ms: 0,
      on,
      governed: false,
    };
  }

  /** (Re)allocates the shared art frame. renderScale = device px per CSS px. */
  resize(cssW: number, cssH: number, renderScale: number): void {
    this.devScale = Math.max(1, Math.round(this.limits.artPx * renderScale));
    this.cssPerArt = this.devScale / renderScale;
    this.frame = createFrame(Math.ceil(cssW / this.cssPerArt), Math.ceil(cssH / this.cssPerArt));
    this.imgs = null; // rebuilt lazily in blit (ImageData length must equal 4·w·h)
  }
  get artFrame(): Frame | null {
    return this.frame;
  }

  /** AI speed multiplier (manual = 1). Effects always run in wall time; at high rate they get rarer, not faster. */
  setRate(rate: number): void {
    this.rate = Math.max(1, rate);
  }
  setCamera(cam: PfxCamera): void {
    this.cam = cam;
  }

  spawn(req: SpawnReq, now: number): SpawnResult {
    if (!this.stats.on) return this.drop('off');
    const prio = req.priority ?? 1;
    let spec = req.spec;
    // design 05 §3.3: at AI ≥ ×8 a medium falls back to its small cousin; reduced motion shows small only
    if ((this.rate >= 8 || this.reduced) && spec.cls === 'medium' && spec.fallback) spec = spec.fallback;
    if (this.reduced && spec.cls !== 'small') return this.drop('reduced');
    const gap = this.gapFor(spec);
    const prev = this.last.get(spec.id);
    if (prev !== undefined && now - prev < gap) return this.drop('rate');
    if (spec.cls === 'big' && this.rate >= 8 && (prio < 2 || now - this.lastBig < 1.0)) return this.drop('rate');
    if (this.cam && this.frame && this.outside(this.cam.toCss(req.x, req.y))) return this.drop('culled');
    if (this.stats.governed && spec.cls === 'big' && prio < 2) return this.drop('governor');
    const evict = this.makeRoom(spec, prio);
    if (!evict) return this.drop('cap');

    // light budget, O(live): the room left over what is already lit
    const room = (this.limits.lightPxFrame - this.sumLight()) / spec.litPx;
    // O(1) early exit, and it must stay BEFORE guard.allow(): a spawn refused for light must not use up one of
    // the shell's 3 flashes per second (the FlashGuard is shared). Pinned by the test "F9 …".
    if (room < this.limits.minLight && prio < 2) return this.drop('light');
    let want = (req.light ?? 1) * (this.reduced ? 0.5 : 1);
    if (spec.heroFlash) want *= this.guard.allow(now, spec.heroFlash) / spec.heroFlash;
    const light = Math.min(want, room);
    if (light <= 0 || (light < this.limits.minLight && prio < 2)) return this.drop('light');

    for (const l of evict) {
      l.leaving = true;
      l.inst.stop(); // fades over 0.3 s (createFx FADE): a show moment never makes the screen pop
    }
    const opts: FxOptions = { ...spec.opts, ...req.opts, seed: req.seed, palette: req.palette, light, angle: req.angle ?? 0, flip: !!req.flip };
    if (req.accent && spec.accentKey) opts[spec.accentKey] = req.accent;
    this.live.push({ inst: createFx(spec.mod, opts), spec, light, priority: prio, wx: req.x, wy: req.y, follow: req.follow, pass: req.layer ?? 'front' });
    this.last.set(spec.id, now);
    if (spec.cls === 'big') this.lastBig = now;
    this.count();
    return 'ok';
  }

  /** Fixed 1/stepHz steps from presentation time; pass 0 while frozen. */
  step(fxDt: number): void {
    const h = 1 / this.limits.stepHz;
    this.acc = Math.min(this.acc + Math.max(0, fxDt), this.limits.accMax);
    // at high rate the lingering tails are cut (stop() dissolves over 0.3 s inside createFx)
    const maxAge = this.rate >= 8 || this.reduced ? 0.5 : this.rate >= 2 ? 0.8 : Infinity;
    while (this.acc >= h - 1e-9) {
      this.acc -= h;
      for (const l of this.live) l.inst.update(h);
      if (maxAge < Infinity) this.trim(maxAge);
      for (let i = this.live.length - 1; i >= 0; i--) if (this.live[i].inst.done()) this.live.splice(i, 1);
    }
    this.count();
  }

  /** Stop every effect older than maxAge s (its fade still plays). */
  trim(maxAge: number): void {
    for (const l of this.live) if (l.inst.t > maxAge) l.inst.stop();
  }
  clear(): void {
    this.live.length = 0;
    this.count();
  }

  /** Pure raster into the shared art frame (node-testable). Returns false when there is nothing to blit. */
  rasterize(cam: PfxCamera, which: 'back' | 'front' | 'both' = 'both'): boolean {
    this.cam = cam;
    const f = this.frame;
    if (!f || !this.stats.on) return false;
    clearFrame(f);
    let any = false;
    for (const l of this.live) {
      if (which !== 'both' && l.pass !== which) continue;
      if (l.follow) {
        const p = l.follow();
        if (p) [l.wx, l.wy] = p;
        else l.inst.stop();
      }
      const [cx, cy] = cam.toCss(l.wx, l.wy);
      if (this.outside([cx, cy])) continue;
      const o = l.inst.options;
      o.x = Math.round(cx / this.cssPerArt);
      o.y = Math.round(cy / this.cssPerArt) + (l.spec.topDown?.dy ?? 0);
      o.light = l.light;
      l.inst.draw(f);
      any = true;
    }
    return any;
  }

  /** rasterize + zero-copy putImageData + nearest integer upscale, both buffers 'lighter'. Browser only. */
  render(ctx: CanvasRenderingContext2D, cam: PfxCamera, which: 'back' | 'front' | 'both' = 'both'): void {
    const t0 = performance.now();
    if (this.rasterize(cam, which)) this.blit(ctx);
    this.noteCost(performance.now() - t0, t0 / 1000);
  }

  /** Governor input (render() feeds it; tests feed a fake clock). */
  noteCost(ms: number, now: number): void {
    this.stats.ms = this.stats.ms * 0.9 + ms * 0.1;
    if (this.stats.ms > this.limits.governorMs) {
      this.overSince ??= now;
      if (now - this.overSince >= this.limits.governorHold) this.stats.governed = true;
    } else {
      this.overSince = null;
      // hysteresis: recover only well under the threshold, so it does not flap every frame
      if (this.stats.ms < this.limits.governorMs * 0.7) this.stats.governed = false;
    }
  }

  private blit(ctx: CanvasRenderingContext2D): void {
    const f = this.frame!;
    if (!this.imgs) {
      const mk = () => Object.assign(document.createElement('canvas'), { width: f.w, height: f.h });
      const c32 = new Uint32Array(f.w * f.h), l32 = new Uint32Array(f.w * f.h);
      this.imgs = {
        c32, l32,
        color: new ImageData(new Uint8ClampedArray(c32.buffer), f.w, f.h),
        light: new ImageData(new Uint8ClampedArray(l32.buffer), f.w, f.h),
        cc: mk(),
        cl: mk(),
      };
    }
    const { c32, l32, color, light, cc, cl } = this.imgs;
    toAdditive(f.color, c32, 1, 0);
    toAdditive(f.light, l32, this.lightGain, this.limits.lightFloor);
    cc.getContext('2d')!.putImageData(color, 0, 0);
    cl.getContext('2d')!.putImageData(light, 0, 0);
    const W = f.w * this.devScale, H = f.h * this.devScale;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // art pixels stay put on screen: no shake/zoom resampling
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(cc, 0, 0, W, H);
    ctx.drawImage(cl, 0, 0, W, H);
    ctx.restore();
  }

  private gapFor(spec: PfxSpec): number {
    if (spec.cls !== 'small') return spec.minGap;
    if (this.rate >= 8) return Math.max(0.25, spec.minGap);
    if (this.rate >= 2) return spec.minGap * Math.sqrt(this.rate);
    return spec.minGap;
  }
  private capFor(cls: PfxClass): number {
    let cap = this.limits.maxByClass[cls];
    if (cls === 'small') {
      if (this.rate >= 8) cap = Math.min(cap, 4);
      if (this.stats.governed) cap = Math.max(1, Math.floor(cap / 2));
    }
    return cap;
  }
  /** The effects to evict so this spawn fits ([] = it fits as is), or null = it cannot fit. Pure: nothing is
   *  changed here, so a refused spawn leaves the screen exactly as it was (review F1: the old version spliced
   *  bystanders out first and then refused). Priority 2 may evict the oldest lower-priority effects OF ITS OWN
   *  CLASS only (design 05 §2.3), and a priority-2 big may also evict the oldest priority-2 big. Evicted effects fade and stay charged to the cost budget while they do, so
   *  eviction frees a slot, not cost: the writesFrame guarantee holds every frame. */
  private makeRoom(spec: PfxSpec, prio: number): Live[] | null {
    let sameClass = 0, slots = 0;
    for (const l of this.live)
      if (!l.leaving) {
        slots++;
        if (l.spec.cls === spec.cls) sameClass++;
      }
    if (this.sumCost() + spec.writes > this.limits.writesFrame) return null;
    const cap = this.capFor(spec.cls), fits = () => sameClass < cap && slots < this.limits.maxLive;
    if (fits()) return [];
    if (prio < 2) return null;
    const evict: Live[] = [];
    for (const l of this.live) {
      if (fits()) break;
      if (l.leaving || l.priority >= 2 || l.spec.cls !== spec.cls) continue;
      evict.push(l);
      sameClass--;
      slots--;
    }
    // Bigs only: when the big cap is still held by an older priority-2 big, the newer show moment replaces it
    // (Replace, never stack). GRAZE: a Surge inside a live phase implosion used to play without its explosion.
    // Same fade as above (stop(), leaving, still charged to cost and light). Mediums and smalls keep the old
    // rule: a priority-2 effect of those classes never displaces another priority-2 one.
    if (spec.cls === 'big')
      for (const l of this.live) {
        if (fits()) break;
        if (l.leaving || l.spec.cls !== 'big' || l.priority < 2) continue;
        evict.push(l);
        sameClass--;
        slots--;
      }
    return fits() ? evict : null;
  }
  private sumCost(): number {
    let s = 0;
    for (const l of this.live) s += l.spec.writes;
    return s;
  }
  private outside([cx, cy]: readonly [number, number]): boolean {
    const f = this.frame;
    if (!f) return false;
    const m = this.limits.cullMargin, x = cx / this.cssPerArt, y = cy / this.cssPerArt;
    return x < -m || y < -m || x > f.w + m || y > f.h + m;
  }
  private sumLight(): number {
    let s = 0;
    for (const l of this.live) s += l.spec.litPx * l.light;
    return s;
  }
  private drop(r: DropReason): SpawnResult {
    this.stats.dropped[r]++;
    this.count(); // O(live); stats must be true after every call, refusals included
    return r;
  }
  private count(): void {
    const b = this.stats.byClass;
    b.small = b.medium = b.big = 0;
    let leaving = 0;
    for (const l of this.live) {
      if (l.leaving) leaving++;
      else b[l.spec.cls]++;
    }
    this.stats.live = this.live.length - leaving;
    this.stats.leaving = leaving;
    this.stats.lightPx = this.sumLight();
  }
}

/** Re-encodes a pixelfx buffer for an additive blit onto a TRANSPARENT scene canvas (the games' Post composites
 *  that canvas over its nebula by alpha). pixelfx writes alpha 255 on every touched pixel (painter.js:63), so a
 *  faint glow skirt or a near-black ramp step became an OPAQUE near-black disc that hid the nebula — the dark
 *  halo seen round every effect in the first Phase-0 sheets. Here alpha = brightest channel and RGB is
 *  un-premultiplied, so after the canvas premultiplies, the pixel adds exactly rgb·gain and covers nothing.
 *  `floor` is subtracted from the brightest channel (fog skirts go to 0 smoothly). Pure; exported for tests. */
export function toAdditive(src: Uint32Array, dst: Uint32Array, gain: number, floor: number): void {
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (!v) {
      dst[i] = 0;
      continue;
    }
    const r = (v & 255) * gain, g = ((v >>> 8) & 255) * gain, b = ((v >>> 16) & 255) * gain;
    const m0 = r > g ? (r > b ? r : b) : g > b ? g : b;
    // soft floor: subtract, do not cut — a hard threshold leaves a flat-edged disc where the skirt was
    const m = m0 - floor;
    if (m < 1) {
      dst[i] = 0;
      continue;
    }
    const k = 255 / m0; // hue kept: channels scaled to the brightest = 255, alpha carries the (reduced) level
    dst[i] = ((m | 0) << 24) | (Math.min(255, b * k) << 16) | (Math.min(255, g * k) << 8) | Math.min(255, r * k);
  }
}
