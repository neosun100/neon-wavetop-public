/* GENERATED from gameforge/src/shell.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
import { AdaptiveQuality, createSafeProbe, type Insets, isPortrait, prefersReducedMotion, readInsets, renderScale, TouchDetector } from './device';
import { clamp, Spring } from './ease';
import { FlashGuard } from './particles';
import { Post, type PostParams, type Shock } from './post';
import type { Synth } from './synth';
import { type Button, drawAudioGate, drawBanner, drawButtons, drawMenu, drawPause, type MenuItem, menuLayout } from './ui';

/**
 * The app frame every neon game shares: canvases + WebGL2 post (with a visible FX LITE
 * fallback), resize / safe-area / adaptive quality, the audio gate, menu, pause, touch buttons,
 * banners, camera kicks (zoom, shake, aberration, glitch, flash through FlashGuard, shockwaves),
 * scanline wipe transitions, one Pointer-Events input path, and the `window.__neon` contract the
 * shared e2e reads (buttons, s.auto, state, paused, speedIdx, speedCount, W, H, u).
 *
 * A game subclasses it and supplies only what is its own: menu items, start / update / draw,
 * its touch buttons and its game input. Extracted when the fourth and fifth games started
 * (NEON SERPENT, STACK and CASCADE each carried a copy of this frame in main.ts).
 */

export interface ShellConfig {
  brand: { words: [string, string]; sub: [string, string] };
  /** AI speeds; `rate` multiplies game time */
  speeds: ReadonlyArray<{ rate: number; label: string }>;
  defaultSpeed: number;
  /** menu hint line under the items (best scores etc.) */
  bestLine: () => string;
  /** unit size divisors: portrait min(W/a, H/b), landscape min(W/c, H/d) */
  unit?: [number, number, number, number];
}

export interface SessionLike {
  auto: boolean;
}

export abstract class NeonShell<S extends SessionLike = SessionLike> {
  readonly view: HTMLCanvasElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly post: Post | null;
  readonly guard: FlashGuard;
  readonly aq = new AdaptiveQuality();
  readonly touch = new TouchDetector();
  readonly reducedMotion = prefersReducedMotion();
  readonly params = new URLSearchParams(location.search);
  private readonly safeProbe: HTMLDivElement;
  W = 0;
  H = 0;
  u = 16;
  safe: Insets = { t: 0, r: 0, b: 0, l: 0 };
  /** 'menu' and 'play' are the shell's; games may add their own states */
  state = 'menu';
  stateT = 0;
  abstract s: S;
  speedIdx: number;
  readonly speedCount: number;
  paused = false;
  showFps = false;
  audioGate = true;
  buttons: Button[] = [];
  now = 0;
  fps = 60;
  /** draw time per frame, ms (EMA) — read by perf checks */
  drawMs = 0;
  // camera + post state
  readonly zoom = new Spring(1, 1, 160, 14);
  shake = 0;
  aberr = 0;
  glitch = 0;
  flash: [number, number, number] = [0, 0, 0];
  readonly hue = new Spring(0, 0, 8, 6);
  banner: { text: string; sub: string; t0: number; color: string } | null = null;
  private shocks: Array<{ x: number; y: number; t0: number; strength: number }> = [];
  private wipeT0 = -10;
  private wipeAction: (() => void) | null = null;
  private menuSel = 0;
  private readonly menuSpring = new Spring(0, 0, 220, 24);
  private menuEnterT = 0;
  private last = 0;
  private pressed: { id: string; t: number } | null = null;
  private down: { x: number; y: number } | null = null;

  constructor(
    readonly synth: Synth,
    readonly cfg: ShellConfig,
  ) {
    this.guard = new FlashGuard(this.reducedMotion);
    this.speedCount = cfg.speeds.length;
    this.speedIdx = clamp(Number(this.params.get('speed') ?? cfg.defaultSpeed), 0, cfg.speeds.length - 1);
    this.view = document.createElement('canvas');
    this.view.id = 'view';
    document.body.appendChild(this.view);
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
    let post: Post | null = null;
    try {
      post = new Post(this.view);
    } catch (e) {
      // degrade visibly: games show "FX LITE" so a missing GPU path is never mistaken for the real thing
      console.warn('[post] WebGL2 post-processing disabled, falling back to plain 2D:', e);
      this.view.remove();
      this.canvas.id = 'view';
      document.body.appendChild(this.canvas);
    }
    this.post = post;
    this.safeProbe = createSafeProbe();
  }

  /** Call at the end of the subclass constructor (after `s` exists). */
  protected boot(): void {
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    visualViewport?.addEventListener('resize', () => this.resize());
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('pointerdown', (e) => this.pDown(e));
    addEventListener('pointermove', (e) => this.pMove(e));
    addEventListener('pointerup', (e) => this.pUp(e));
    addEventListener('pointercancel', () => {
      this.down = null;
      this.onPointerCancel();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state !== 'menu') this.paused = true;
    });
    void this.synth.preloadTracks(`${import.meta.env.BASE_URL}bgm/`);
    (window as unknown as { __neon: unknown }).__neon = this;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ───────────── hooks a game implements ─────────────

  abstract menuItems(): MenuItem[];
  /** items 0 and 1 start a game (AI, manual); the rest are settings adjusted left / right */
  abstract startFromMenu(auto: boolean): void;
  adjustMenu(_i: number, _d: number): void {}
  abstract update(dt: number): void;
  /** background, board, HUD (everything except buttons, menu, banner, pause) */
  abstract drawScene(ctx: CanvasRenderingContext2D, beat: number): void;
  /** touch button row(s): [id, label, active] — ids 'ai', 'speed', 'pause', 'menu' are handled by the shell */
  touchButtons(): Array<Array<[string, string, boolean]>> {
    return [];
  }
  onButton(_id: string): void {}
  abstract toggleAuto(): void;
  /** back to the menu with a fresh attract session */
  abstract toMenu(): void;
  /** game keys (after the shell handled audio, mute, fps, menu, escape, pause, AI, speeds) */
  onKey(_k: string, _e: KeyboardEvent): void {}
  /** pointer in canvas pixels; `tap` = released close to where it went down */
  onPointerDown(_x: number, _y: number, _e: PointerEvent): void {}
  onPointerMove(_x: number, _y: number, _e: PointerEvent): void {}
  onPointerUp(_x: number, _y: number, _tap: boolean, _e: PointerEvent): void {}
  onPointerCancel(): void {}
  /** per-game post tuning (bloom knee, saturation …) merged over the defaults */
  postParams(): Partial<PostParams> {
    return {};
  }
  get speed(): number {
    return this.cfg.speeds[this.speedIdx].rate;
  }

  // ───────────── helpers for games ─────────────

  get portrait(): boolean {
    return isPortrait(this.W, this.H);
  }
  setState(st: string): void {
    this.state = st;
    this.stateT = this.now;
    this.paused = false;
    if (st === 'menu') {
      this.menuEnterT = this.now;
      this.synth.setScene('menu');
    }
  }
  transition(action: () => void): void {
    this.wipeT0 = this.now;
    this.wipeAction = action;
  }
  /** Shockwave at a canvas pixel. */
  shock(x: number, y: number, strength: number): void {
    this.shocks.push({ x: x / this.W, y: 1 - y / this.H, t0: this.now, strength });
    if (this.shocks.length > 6) this.shocks.shift();
  }
  /** Full-screen tint, limited by FlashGuard (≤ 3 strong flashes / s). */
  flashKick(r: number, g: number, b: number, strength: number): void {
    const k = this.guard.allow(this.now, strength);
    this.flash = [Math.max(this.flash[0], r * k), Math.max(this.flash[1], g * k), Math.max(this.flash[2], b * k)];
  }
  say(text: string, sub: string, color: string): void {
    this.banner = { text, sub, t0: this.now, color };
  }
  setSpeed(i: number): void {
    this.speedIdx = (i + this.speedCount) % this.speedCount;
  }

  // ───────────── frame ─────────────

  resize(): void {
    const scale = renderScale(this.aq.quality);
    this.W = Math.round(innerWidth * scale);
    this.H = Math.round(innerHeight * scale);
    for (const c of [this.view, this.canvas]) {
      c.width = this.W;
      c.height = this.H;
      c.style.width = `${innerWidth}px`;
      c.style.height = `${innerHeight}px`;
    }
    const [a, b, c, d] = this.cfg.unit ?? [26, 46, 50, 30];
    this.u = this.portrait ? Math.max(9 * scale, Math.min(this.W / a, this.H / b)) : Math.max(9 * scale, Math.min(this.W / c, this.H / d));
    this.safe = readInsets(this.safeProbe, scale);
    this.post?.resize(this.W, this.H);
  }

  private frame(t: number): void {
    const dtRaw = this.last ? (t - this.last) / 1000 : 1 / 60;
    this.last = t;
    const dt = Math.min(0.05, dtRaw);
    this.fps += (1 / Math.max(dtRaw, 1e-3) - this.fps) * 0.05;
    if (this.aq.tick(dtRaw)) this.resize();
    this.now += dt;
    if (this.wipeAction && this.now - this.wipeT0 > 0.42) {
      const a = this.wipeAction;
      this.wipeAction = null;
      a();
    }
    this.update(dt);
    this.zoom.step(dt);
    this.shake *= Math.exp(-dt * 9);
    this.aberr *= Math.exp(-dt * 5);
    this.glitch *= Math.exp(-dt * 2.2);
    this.flash = this.flash.map((v) => v * Math.exp(-dt * 6)) as [number, number, number];
    this.menuSpring.step(dt);
    this.hue.step(dt);
    const t0 = performance.now();
    this.draw();
    this.drawMs += (performance.now() - t0 - this.drawMs) * 0.05;
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private draw(): void {
    const { ctx, W, H, u } = this;
    ctx.clearRect(0, 0, W, H);
    if (!this.post) {
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, W, H);
    }
    const beat = this.synth.beat();
    this.drawScene(ctx, beat);
    this.buttons = this.layoutButtons();
    if (this.pressed && this.now - this.pressed.t > 0.15) this.pressed = null;
    drawButtons(ctx, this.buttons, u, this.pressed?.id ?? null);
    if (this.state === 'menu') {
      const items = this.menuItems();
      drawMenu(ctx, W, H, u, this.now, items, this.menuSel, this.menuSpring.value, this.cfg.bestLine(), this.menuEnterT, this.portrait, this.touch.value, this.cfg.brand);
      if (this.audioGate) drawAudioGate(ctx, W, H, u, this.now, this.touch.value, menuLayout(W, H, u, this.portrait, items.length).gateY);
    } else if (this.audioGate) drawAudioGate(ctx, W, H, u, this.now, this.touch.value, 'corner');
    if (this.banner) drawBanner(ctx, W, H, u, this.banner.text, this.banner.sub, this.now - this.banner.t0, this.banner.color);
    if (this.paused) drawPause(ctx, W, H, u, this.now);
    if (this.post) {
      this.shocks = this.shocks.filter((sh) => this.now - sh.t0 < 0.9);
      const shocks: Shock[] = this.shocks.map((sh) => ({ x: sh.x, y: sh.y, age: (this.now - sh.t0) / 0.9, strength: sh.strength }));
      const wipe = this.now - this.wipeT0 < 0.85 ? (this.now - this.wipeT0) / 0.85 : 0;
      this.post.render(this.canvas, {
        time: this.now,
        shocks,
        aberration: 0.0012 + this.aberr + (this.reducedMotion ? 0 : this.glitch * 0.004),
        glitch: this.reducedMotion ? 0 : this.glitch,
        bloom: 1.05,
        persistence: 0,
        vignette: 0.9,
        wipe,
        flash: this.flash,
        beat,
        hue: this.hue.value,
        ...this.postParams(),
      });
    }
  }

  private layoutButtons(): Button[] {
    if (!this.touch.value || this.state === 'menu') return [];
    const rows = this.touchButtons();
    if (!rows.length) return [];
    const u = this.u;
    const rowW = Math.min(this.W - this.safe.l - this.safe.r - u, u * 24);
    const gap = u * 0.25;
    const bh = u * 1.8;
    const x0 = (this.W - rowW) / 2;
    const y0 = this.H - this.safe.b - bh * rows.length - gap * (rows.length - 1) - u * 0.4;
    const out: Button[] = [];
    rows.forEach((row, ri) => {
      const bw = (rowW - gap * (row.length - 1)) / row.length;
      row.forEach(([id, label, active], i) => out.push({ id, label, active, x: x0 + i * (bw + gap), y: y0 + ri * (bh + gap), w: bw, h: bh }));
    });
    return out;
  }

  /** Bottom of the play area above the touch buttons (canvas px). */
  get footH(): number {
    const rows = this.touch.value && this.state !== 'menu' ? this.touchButtons().length : 0;
    return rows ? rows * this.u * 1.8 + (rows - 1) * this.u * 0.25 + this.u * 0.8 : this.u * 0.8;
  }

  // ───────────── input ─────────────

  private gesture(): boolean {
    this.synth.unlock();
    if (!this.audioGate) return false;
    this.audioGate = false;
    return this.state === 'menu';
  }

  private key(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowdown', 'arrowup', ' ', 'tab'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (this.gesture()) return;
    if (k === 'm') return this.synth.setMuted(!this.synth.muted);
    if (k === 'f') {
      this.showFps = !this.showFps;
      return;
    }
    if (this.state === 'menu') {
      if (k === 'arrowup' || k === 'w') this.moveMenu(-1);
      else if (k === 'arrowdown' || k === 's') this.moveMenu(1);
      else if (k === 'arrowleft' || k === 'a') this.adjust(-1);
      else if (k === 'arrowright' || k === 'd') this.adjust(1);
      else if (k === 'enter' || k === ' ') this.activate();
      return;
    }
    if (k === 'escape') return this.transition(() => this.toMenu());
    if (k === 'p') {
      this.paused = !this.paused;
      return;
    }
    if (k === 't' || k === 'tab') return this.toggleAuto();
    if (k >= '1' && k <= String(Math.min(9, this.speedCount))) return this.setSpeed(Number(k) - 1);
    this.onKey(k, e);
  }

  private scaled(e: PointerEvent): [number, number] {
    const k = this.W / innerWidth;
    return [e.clientX * k, e.clientY * k];
  }

  private pDown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    this.touch.observe(e);
    const [x, y] = this.scaled(e);
    this.down = { x, y };
    if (this.state !== 'menu' && !this.paused) this.onPointerDown(x, y, e);
  }

  private pMove(e: PointerEvent): void {
    if (!e.isPrimary) return;
    const [x, y] = this.scaled(e);
    if (this.state === 'menu') {
      if (!this.down) {
        const i = this.menuIndexAt(y);
        if (i >= 0 && i !== this.menuSel) this.moveMenu(i - this.menuSel);
      }
      return;
    }
    if (!this.paused) this.onPointerMove(x, y, e);
  }

  /** Every tap or click lands here, whatever the pointer type. */
  private pUp(e: PointerEvent): void {
    if (!e.isPrimary) return;
    const d = this.down;
    this.down = null;
    if (this.gesture()) return; // the first tap only unlocks audio (pointerup counts as a gesture on iOS)
    const [x, y] = this.scaled(e);
    const tap = !d || Math.hypot(x - d.x, y - d.y) < this.u * 0.6;
    if (this.state === 'menu') {
      const i = this.menuIndexAt(y);
      if (!tap || i < 0) return;
      if (i !== this.menuSel) this.moveMenu(i - this.menuSel);
      if (i >= 2) this.adjust(x > this.W / 2 ? 1 : -1);
      else this.activate();
      return;
    }
    if (tap && this.hitButton(x, y)) return;
    if (this.paused) {
      if (tap) this.paused = false;
      return;
    }
    this.onPointerUp(x, y, tap, e);
  }

  private hitButton(x: number, y: number): boolean {
    const b = this.buttons.find((bb) => x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h);
    if (!b) return false;
    this.pressed = { id: b.id, t: this.now };
    if (b.id === 'pause') this.paused = !this.paused;
    else if (b.id === 'ai') this.toggleAuto();
    else if (b.id === 'speed') this.setSpeed(this.speedIdx + 1);
    else if (b.id === 'menu') this.transition(() => this.toMenu());
    else this.onButton(b.id);
    return true;
  }

  private menuIndexAt(y: number): number {
    const n = this.menuItems().length;
    const { y0, ih, gap } = menuLayout(this.W, this.H, this.u, this.portrait, n);
    const i = Math.floor((y - y0) / (ih + gap));
    return i >= 0 && i < n && y - y0 - i * (ih + gap) <= ih ? i : -1;
  }

  private moveMenu(d: number): void {
    const n = this.menuItems().length;
    this.menuSel = (this.menuSel + d + n) % n;
    this.menuSpring.target = this.menuSel;
    this.synth.blip(d > 0);
  }

  private adjust(d: number): void {
    if (this.menuSel < 2) return;
    this.adjustMenu(this.menuSel, d);
    this.synth.blip(d > 0);
  }

  private activate(): void {
    if (this.menuSel > 1) return this.adjust(1);
    this.synth.select();
    const auto = this.menuSel === 0;
    this.transition(() => this.startFromMenu(auto));
  }
}
