/* GENERATED from gameforge/src/device.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/**
 * Device helpers every neon game needs: touch capability, orientation, safe-area insets,
 * adaptive render quality, and best-score persistence.
 */

/**
 * Touch UI on when the device has ANY touch input — not when the *primary* pointer is coarse.
 * iPadOS with a Bluetooth mouse reports pointer:fine and hides ontouchstart, yet the screen
 * still takes touches; keying the UI off the primary pointer removed the button bar (bug
 * reported 2026-10-29). Re-checked live, and latched by the first real touch / pen event.
 */
export class TouchDetector {
  private v: boolean;
  constructor() {
    const anyCoarse = matchMedia('(any-pointer: coarse)');
    this.v = navigator.maxTouchPoints > 0 || anyCoarse.matches || 'ontouchstart' in window;
    anyCoarse.addEventListener?.('change', () => {
      this.v = this.v || anyCoarse.matches;
    });
  }
  get value(): boolean {
    return this.v;
  }
  /** Call from pointerdown: a non-mouse pointer proves the screen takes touches. */
  observe(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') this.v = true;
  }
}

export const isPortrait = (w: number, h: number) => h > w * 1.05;
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Insets {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** A hidden element padded with env(safe-area-inset-*) (see style.css #safe-probe), because
 *  env() is CSS-only. Returns insets in canvas pixels. */
export function createSafeProbe(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'safe-probe';
  document.body.appendChild(el);
  return el;
}
export function readInsets(probe: HTMLElement, scale: number): Insets {
  const cs = getComputedStyle(probe);
  const px = (v: string) => (parseFloat(v) || 0) * scale;
  return { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
}

/** Canvas pixels per CSS pixel: device ratio capped at 2 and at a 2560 px long side, times quality. */
export function renderScale(quality: number): number {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  return Math.min(dpr, 2560 / Math.max(innerWidth, innerHeight)) * quality;
}

/** Drops render resolution in steps when < 42 fps is sustained (~2 s); the HUD shows it. */
export class AdaptiveQuality {
  quality = 1;
  private slow = 0;
  /** Returns true when the quality changed (the caller resizes its canvases). */
  tick(dtRaw: number): boolean {
    if (document.hidden || dtRaw > 0.25) return false;
    this.slow = dtRaw > 1 / 42 ? this.slow + 1 : Math.max(0, this.slow - 2);
    if (this.slow > 120 && this.quality > 0.55) {
      this.quality = Math.round(this.quality * 0.8 * 100) / 100;
      this.slow = 0;
      console.warn(`[quality] sustained low fps, render scale → ${this.quality}`);
      return true;
    }
    return false;
  }
}

/** localStorage number with logged degradation (private mode / disabled storage). */
export function loadNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch (e) {
    console.warn(`[store] localStorage unavailable, ${key} not persisted`, e);
    return 0;
  }
}
export function saveNumber(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch (e) {
    console.warn(`[store] could not persist ${key}`, e);
  }
}
/** JSON variant for small save games; corrupt data is logged and replaced by `fallback`. */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    console.warn(`[store] ${key} unreadable, starting fresh`, e);
    return fallback;
  }
}
export function saveJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    console.warn(`[store] could not persist ${key}`, e);
  }
}
