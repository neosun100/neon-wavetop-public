/* GENERATED from gameforge/src/juice.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Juice: hit-stop, quantised shake, reaction springs, after-images and kick budgets (design 05 §3).
 *
 *  Our own code, modelled on the ideas in pixelfx core/act.js (which adapts Hollow Crown, MIT) — it imports
 *  nothing from pixelfx and copies no code, so it ships even if the pixel runtime does not.
 *  Presentation only: it changes how wall time maps to sim ticks (a freeze is simDt = 0), never a tick's
 *  inputs or outputs, so simulation determinism holds by construction. src/core / src/ai must not import it. */
import { Spring } from './ease';

/** Every threshold in one place, pinned by tests/juice.test.ts. */
export const JuiceLimits = {
  /** s, one freeze (pixelfx check.mjs flags > 0.3 s as a stall; we run faster games) */
  freezeMax: 0.12,
  /** s, priority 2 (failed / finish) */
  freezeTerminal: 0.25,
  /** s of freeze in any 1 s window (non-terminal) */
  freezeWindow: 0.15,
  /** s between the end of one freeze and the start of the next (non-terminal) */
  freezeGap: 0.25,
  /** AI ×1 freezes the sim for this fraction of the base (the effects still hold the full base) */
  autoSimK: 0.6,
  /** AI rate above which the sim is never frozen, and above which nothing is */
  simFreezeMaxRate: 1,
  fxFreezeMaxRate: 4,
  /** zoom kicks: at most this many per second, each at most kickMax */
  kickPerSec: 2,
  kickMax: 0.5,
  hueMax: 0.5,
  shakeHz: 30,
  shakeAmpMax: 0.6,
  ghostHz: 30,
  ghostLife: 0.16,
  ghostMax: 5,
} as const;

export type Priority = 0 | 1 | 2;

/** One event's acting, as data (the counterpart of pixelfx act.hits[]). */
export interface JuiceCue {
  /** base s; HitStop trims it by rate and budget */
  readonly freeze?: number;
  readonly priority?: Priority;
  /** amp in game units (u), dur in s, optional unit direction */
  readonly shake?: { readonly amp: number; readonly dur: number; readonly dir?: readonly [number, number] };
  /** released on thaw ("hold → spring out") */
  readonly zoom?: number;
  /** a TARGET on the hue map, not a += (APEX's unbounded hue drift, report 04 §2.2) */
  readonly hue?: number;
  /** through the host's FlashGuard; keeps decaying through a freeze (a frozen full-screen flash is a grey screen) */
  readonly flash?: readonly [number, number, number, number];
}

export interface ClockSplit {
  /** dt for the sim accumulator (0 while sim-frozen) */
  simDt: number;
  /** dt for effects, particles, PixelLayer.step, ghosts, camera follow (0 while fx-frozen) */
  fxDt: number;
  /** wall dt: shake, flash decay, post time, BGM, UI */
  realDt: number;
  /** this frame thawed (queued zoom/hue are released) */
  released: boolean;
}

/** Hit-stop. Overlapping requests take the MAX, never the sum (act.js:267). Budgeted per freeze, per 1 s
 *  window and by a gap; scaled down with AI speed (design 05 §3.3). Keeps its own wall clock (advanced by
 *  split), so it is deterministic for a given dt sequence. */
export class HitStop {
  private t = 0;
  private simLeft = 0;
  private fxLeft = 0;
  private lastEnd = -Infinity;
  /** freezes that may still overlap a 1 s window: [start, end) in HitStop time */
  private ledger: { s: number; e: number; terminal: boolean }[] = [];
  constructor(private readonly limits = JuiceLimits) {}

  get frozen(): boolean {
    return this.fxLeft > 0;
  }
  get simFrozen(): boolean {
    return this.simLeft > 0;
  }
  get time(): number {
    return this.t;
  }

  /** Returns the approved fx freeze in s (0 = refused by rate or budget). */
  request(base: number, rate: number, auto: boolean, priority: Priority = 1): number {
    const L = this.limits, terminal = priority === 2;
    // rate scaling first: at high AI speed the show gives way to throughput
    let sim: number, fx: number;
    if (!auto || rate <= 1) {
      fx = base;
      sim = auto ? base * L.autoSimK : base;
    } else if (rate <= L.fxFreezeMaxRate) {
      fx = base / rate;
      sim = 0;
    } else return 0;
    const cap = terminal ? L.freezeTerminal : L.freezeMax;
    fx = Math.min(fx, cap);
    sim = Math.min(sim, cap);
    if (fx <= 0) return 0;
    const merging = this.fxLeft > 0;
    if (!terminal) {
      if (!merging && this.t - this.lastEnd < L.freezeGap) return 0;
      // window budget: every non-terminal freeze that ends inside the last second counts IN FULL (the open one
      // included). Conservative: the true frozen time in any 1 s window is ≤ this sum (tests T-J1).
      let used = 0;
      for (const q of this.ledger) if (!q.terminal && q.e > this.t - 1) used += q.e - q.s;
      fx = this.fxLeft + Math.min(Math.max(0, fx - this.fxLeft), Math.max(0, L.freezeWindow - used));
    }
    // merge: the max of what is left and what is asked — never the sum — and one contiguous freeze never
    // runs longer than its cap, however many hits land inside it
    const open = merging ? this.ledger[this.ledger.length - 1] : undefined;
    if (open) fx = Math.min(fx, open.s + cap - this.t);
    if (fx <= this.fxLeft) return this.fxLeft;
    const end = this.t + fx;
    if (open) {
      open.e = end;
      // a terminal hit merged into a normal freeze makes the whole run terminal: its time (up to 0.25 s) is not
      // charged to the 0.15 s normal window, which would otherwise deny every normal freeze for ~1 s after a
      // fail / finish (review F11). The run's cap above already switched to freezeTerminal.
      if (terminal) open.terminal = true;
    } else this.ledger.push({ s: this.t, e: end, terminal });
    this.ledger = this.ledger.filter((q) => q.e > this.t - 1);
    this.fxLeft = fx;
    this.simLeft = Math.max(this.simLeft, Math.min(sim, fx));
    return fx;
  }

  /** Call once per display frame with the wall dt. */
  split(dt: number): ClockSplit {
    const wasFrozen = this.fxLeft > 0;
    const fxHold = Math.min(dt, this.fxLeft), simHold = Math.min(dt, this.simLeft);
    this.fxLeft -= fxHold;
    this.simLeft -= simHold;
    if (this.fxLeft < 1e-9) this.fxLeft = 0;
    if (this.simLeft < 1e-9) this.simLeft = 0;
    this.t += dt;
    const released = wasFrozen && this.fxLeft === 0;
    if (released) this.lastEnd = this.t - (dt - fxHold);
    // the frozen part is dropped, never banked: no catch-up burst of ticks on thaw (T-J2). At AI ×2-4 the
    // sim keeps running while the effects hold (simLeft = 0), so throughput is untouched.
    return { simDt: dt - simHold, fxDt: dt - fxHold, realDt: dt, released };
  }
}

/** Fixed-duration, linearly decaying, 30 Hz-quantised, deterministic shake (act.js idea). A weaker hit never
 *  shortens or weakens a stronger one still running. Runs on wall time, so it keeps going during a freeze. */
export class Shake {
  private t = 0;
  private amp = 0;
  private dur = 0;
  private t0 = 0;
  private dir: readonly [number, number] | null = null;
  constructor(private readonly limits = JuiceLimits) {}

  add(amp: number, dur: number, dir?: readonly [number, number]): void {
    amp = Math.min(Math.abs(amp), this.limits.shakeAmpMax);
    if (amp <= 0 || dur <= 0) return;
    if (this.left() >= amp) return;
    this.amp = amp;
    this.dur = dur;
    this.t0 = this.t;
    this.dir = dir ?? null;
  }
  step(realDt: number): void {
    this.t += realDt;
  }
  /** amplitude left at the current quantised step */
  private left(): number {
    if (this.dur <= 0) return 0;
    const q = Math.floor((this.t - this.t0) * this.limits.shakeHz + 1e-6) / this.limits.shakeHz;
    return this.amp * Math.max(0, 1 - q / this.dur);
  }
  /** [dx, dy] in u; changes at most shakeHz times per second, independent of the display rate. */
  offset(): readonly [number, number] {
    const k = this.left();
    if (k <= 0) return [0, 0];
    const f = Math.floor((this.t - this.t0) * this.limits.shakeHz + 1e-6);
    // cos on the main axis: step 0 is a full kick along the blow (the hit frame), not a zero crossing
    const a = Math.cos(f * 2.4) * k, b = Math.sin(f * 3.7) * k * 0.7;
    if (!this.dir) return [a, b];
    // along the blow, with a little cross-motion so it does not read as a slide
    const [dx, dy] = this.dir;
    return [dx * a - dy * b * 0.25, dy * a + dx * b * 0.25];
  }
}

/** Under-damped, clamped reaction spring (pixelfx Target: k = 60, c = 3.4, ±0.4 rad). Car yaw on a wall hit,
 *  boss recoil. Value rests at 0; push() kicks the velocity. */
export class Wobble extends Spring {
  constructor(k = 60, damping = 3.4, readonly clampAbs = 0.4) {
    super(0, 0, k, damping);
  }
  push(v: number): void {
    this.kick(v);
  }
  override step(dt: number): number {
    super.step(dt);
    if (Math.abs(this.value) > this.clampAbs) {
      this.value = Math.sign(this.value) * this.clampAbs;
      this.velocity = 0;
    }
    return this.value;
  }
}

/** Discrete after-images: small samples (pose, position) taken at 30 Hz, drawn by the game as THIN
 *  WIREFRAMES before the body, never filled (a large additive area is haze). */
export class Ghosts<T> {
  private acc = 0;
  private readonly list: { s: T; age: number }[] = [];
  constructor(private readonly hz = JuiceLimits.ghostHz, private readonly life = JuiceLimits.ghostLife, private readonly max = JuiceLimits.ghostMax) {}
  sample(fxDt: number, on: boolean, take: () => T): void {
    for (const g of this.list) g.age += fxDt;
    while (this.list.length && this.list[0].age >= this.life) this.list.shift();
    if (!on) return;
    this.acc += fxDt;
    if (this.acc >= 1 / this.hz) {
      this.acc %= 1 / this.hz;
      this.list.push({ s: take(), age: 0 });
      if (this.list.length > this.max) this.list.shift();
    }
  }
  /** k: 0.5 → 0 with age (oldest first) */
  each(draw: (s: T, k: number) => void): void {
    for (const g of this.list) draw(g.s, 0.5 * (1 - g.age / this.life));
  }
  get size(): number {
    return this.list.length;
  }
  clear(): void {
    this.list.length = 0;
  }
}

/** Rate limiter for kicks: at most perSec takes in any 1 s, each clamped to ±maxValue. 0 = no budget left. */
export class Budget {
  private stamps: number[] = [];
  constructor(private readonly perSec: number, private readonly maxValue: number) {}
  take(now: number, v: number, perSec = this.perSec): number {
    this.stamps = this.stamps.filter((t) => now - t < 1);
    if (this.stamps.length >= Math.min(perSec, this.perSec) || v === 0) return 0;
    this.stamps.push(now);
    return Math.max(-this.maxValue, Math.min(this.maxValue, v));
  }
}

/** What Juice drives on the host (NeonShell fits this: zoom/hue Springs, flashKick through its guard). */
export interface JuiceHost {
  readonly reducedMotion: boolean;
  readonly zoom: Spring;
  readonly hue: Spring;
  flashKick(r: number, g: number, b: number, strength: number): void;
}

/** Facade: games call cue() on events and split() once per frame; the rest follows the rate table 05 §3.3. */
export class Juice {
  readonly stop: HitStop;
  readonly shake: Shake;
  private readonly kicks: Budget;
  private queued: { zoom: number; hue: number | null } = { zoom: 0, hue: null };
  private rate = 1;

  constructor(private readonly host: JuiceHost, private readonly limits = JuiceLimits) {
    this.stop = new HitStop(limits);
    this.shake = new Shake(limits);
    this.kicks = new Budget(limits.kickPerSec, limits.kickMax);
  }

  cue(c: JuiceCue, rate: number, auto: boolean): void {
    this.rate = auto ? Math.max(1, rate) : 1;
    const r = this.rate, reduced = this.host.reducedMotion;
    if (c.freeze) this.stop.request(c.freeze, r, auto, c.priority ?? 1);
    if (c.shake && !reduced) {
      const k = r >= 8 ? 0.5 : r >= 2 ? 0.75 : 1;
      // at ≥ ×8 the direction is kept (it still tells where the blow came from)
      this.shake.add(c.shake.amp * k, c.shake.dur, c.shake.dir);
    }
    if (c.flash) this.host.flashKick(c.flash[0], c.flash[1], c.flash[2], c.flash[3]);
    if (!reduced && r < 8 && c.zoom) this.queued.zoom += c.zoom;
    if (c.hue !== undefined) this.queued.hue = c.hue;
    if (!this.stop.frozen) this.release();
  }

  split(dt: number): ClockSplit {
    const c = this.stop.split(dt);
    this.shake.step(c.realDt);
    if (c.released || !this.stop.frozen) this.release();
    return c;
  }

  private release(): void {
    const q = this.queued;
    if (q.zoom) {
      // AI ×2-4: 1 kick/s (design 05 §3.3); ≥ ×8 kicks are never queued
      const v = this.kicks.take(this.stop.time, q.zoom, this.rate >= 2 ? 1 : this.limits.kickPerSec);
      if (v) this.host.zoom.kick(v);
    }
    if (q.hue !== null) this.host.hue.target = Math.max(-this.limits.hueMax, Math.min(this.limits.hueMax, q.hue));
    this.queued = { zoom: 0, hue: null };
  }
}
