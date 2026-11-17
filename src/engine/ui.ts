/* GENERATED from gameforge/src/ui.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
import { clamp, easeOutBack, easeOutCubic } from './ease';

/** Neon UI kit shared by every game of the series: panels, touch buttons, menu, banner,
 *  pause and audio-gate overlays. Game-specific HUDs live in each game. */

export const FONT = '"JetBrains Mono","SF Mono",Menlo,Consolas,monospace,"PingFang SC","Hiragino Sans GB","Microsoft YaHei"';
export const font = (px: number, weight = 700) => `${weight} ${Math.round(px)}px ${FONT}`;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A touch button: hit rect, id and label (drawn by drawButtons, hit-tested by the game). */
export interface Button extends Rect {
  id: string;
  label: string;
  active?: boolean;
}

export function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxW: number, weight = 700): number {
  let s = size;
  ctx.font = font(s, weight);
  while (s > 6 && ctx.measureText(text).width > maxW) {
    s *= 0.92;
    ctx.font = font(s, weight);
  }
  return s;
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent = '#00f0ff'): void {
  const c = Math.min(14, h * 0.25);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + c);
  ctx.closePath();
  ctx.fillStyle = 'rgba(6,10,28,0.72)';
  ctx.fill();
  ctx.strokeStyle = accent + '88';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x + c, y - 1, Math.min(48, w * 0.3), 2);
  ctx.restore();
}

export function drawButtons(ctx: CanvasRenderingContext2D, buttons: Button[], u: number, pressed: string | null): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of buttons) {
    const hot = b.id === pressed;
    ctx.fillStyle = hot ? 'rgba(0,240,255,0.35)' : b.active ? 'rgba(0,240,255,0.16)' : 'rgba(8,14,36,0.7)';
    ctx.strokeStyle = b.active || hot ? '#00f0ff' : 'rgba(125,249,255,0.35)';
    ctx.lineWidth = 1.5;
    const c = Math.min(b.h * 0.3, u * 0.4);
    ctx.beginPath();
    ctx.moveTo(b.x + c, b.y);
    ctx.lineTo(b.x + b.w, b.y);
    ctx.lineTo(b.x + b.w, b.y + b.h - c);
    ctx.lineTo(b.x + b.w - c, b.y + b.h);
    ctx.lineTo(b.x, b.y + b.h);
    ctx.lineTo(b.x, b.y + c);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    fitFont(ctx, b.label, u * 0.5, b.w - u * 0.3, 800);
    ctx.fillStyle = b.active || hot ? '#ffffff' : 'rgba(210,225,255,0.85)';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }
  ctx.restore();
}

export interface MenuItem {
  label: string;
  sub: string;
  value?: string;
}

/** Menu geometry: title, audio-gate slot, item rows, footer. Shared by drawing and hit-testing so taps always land on
 *  what is drawn. `n` = number of items (the rows are placed in the height the title leaves, 90 F8). */
export interface MenuGeom {
  x0: number;
  y0: number;
  iw: number;
  ih: number;
  gap: number;
  /** title font size, first title line's centre y, subtitle centre y */
  size: number;
  ty0: number;
  subY: number;
  /** centre y of the audio-gate box: a slot of its own between the subtitle and the first row */
  gateY: number;
  /** hint line baseline (the best line sits u·0.75 under it) */
  footY: number;
}

/** MenuLimits: every proportion of the menu in one place (units of u unless noted). */
export const MenuLimits = {
  gateH: 2.1,
  /** subtitle → gate box, gate box → first row */
  gateGapTop: 0.9,
  gateGapBottom: 0.7,
  /** bottom margin kept free for the hint + best lines */
  foot: 3.0,
  gapMin: 0.45,
  /** portrait spreads spare height into taller rows and wider gaps up to these (phones are tall: 84 F8 left ≈ 35 %
   *  of the screen empty under the rows) */
  ihMaxPortrait: 2.8,
  gapMaxPortrait: 1.4,
  /** share of the height the rows cannot use that goes above them (the rest sits over the footer) */
  slackAbove: 0.35,
  /** a list longer than the leftover height (K13: chess's 11 rows overflowed 1280×800) compresses: gaps down to
   *  gapTight, rows down to ihMin (text scales with the row), then the title rises to titleTopMin × its size */
  gapTight: 0.15,
  ihMin: 1.15,
  titleTopMin: 0.62,
} as const;

export function menuLayout(W: number, H: number, u: number, portrait: boolean, n: number): MenuGeom {
  const L = MenuLimits;
  const size = portrait ? Math.min(u * 4.4, W / 5.4) : Math.min(u * 3.6, W / 9);
  const g = menuAt(W, H, u, portrait, n, H * (portrait ? 0.15 : 0.26), size);
  if (g.fits) return g.geom;
  // too many rows for the leftover height: lift the title (never off the screen), then lay out again compressed
  return menuAt(W, H, u, portrait, n, Math.max(size * L.titleTopMin, H * (portrait ? 0.15 : 0.26) - (g.need - g.avail)), size).geom;
}

function menuAt(W: number, H: number, u: number, portrait: boolean, n: number, ty0: number, size: number): { geom: MenuGeom; fits: boolean; need: number; avail: number } {
  const L = MenuLimits;
  const iw = Math.min(W * (portrait ? 0.9 : 0.8), u * 22);
  let ih = u * (portrait ? 2.2 : 1.9);
  const subY = ty0 + (portrait ? size * 1.02 : 0) + size * 0.85;
  const gateY = subY + u * (L.gateGapTop + L.gateH / 2);
  const top = gateY + u * (L.gateH / 2 + L.gateGapBottom);
  const bottom = H - u * L.foot;
  const avail = bottom - top;
  let gap = u * L.gapMin;
  if (portrait && n > 1) {
    const spare = avail - n * ih - (n - 1) * gap;
    if (spare > 0) ih = Math.min(u * L.ihMaxPortrait, ih + (spare * 0.4) / n);
    gap = Math.min(u * L.gapMaxPortrait, Math.max(gap, (avail - n * ih) / (n - 1)));
  }
  const need = n * ih + (n - 1) * gap;
  if (need > avail && n > 1) {
    gap = Math.min(gap, u * L.gapTight);
    ih = Math.max(u * L.ihMin, Math.min(ih, (avail - (n - 1) * gap) / n));
  }
  const block = n * ih + (n - 1) * gap;
  // in the leftover band, nearer the gate than the footer; a screen too short for the block starts at the band top
  // (never over the title)
  const y0 = top + Math.max(0, (avail - block) * L.slackAbove);
  const footY = Math.max(y0 + block + gap + u * 0.9, H - u * 2.2);
  return { geom: { x0: W / 2 - iw / 2, y0, iw, ih, gap, size, ty0, subY, gateY, footY }, fits: block <= avail, need: block, avail };
}

export function drawMenu(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  u: number,
  t: number,
  items: MenuItem[],
  sel: number,
  selY: number,
  best: string,
  enterT: number,
  portrait: boolean,
  touch: boolean,
  /** Title words (the first glows cyan, the second magenta) and the subtitle [portrait, landscape]. */
  brand: { words: [string, string]; sub: [string, string] },
): void {
  ctx.save();
  // dim the attract-mode game behind
  ctx.fillStyle = 'rgba(2,3,12,0.55)';
  ctx.fillRect(0, 0, W, H);

  // title: letters drop in with stagger, then float. Portrait stacks the two words.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const age = t - enterT;
  const lines = portrait ? [brand.words[0], brand.words[1]] : [`${brand.words[0]} ${brand.words[1]}`];
  const g = menuLayout(W, H, u, portrait, items.length);
  const { size, ty0, subY } = g;
  let idx = 0;
  lines.forEach((title, li) => {
    ctx.font = font(size, 900);
    let x = W / 2 - ctx.measureText(title).width / 2;
    const ty = ty0 + li * size * 1.02;
    for (let i = 0; i < title.length; i++, idx++) {
      const ch = title[i];
      const cw = ctx.measureText(ch).width;
      const k = clamp((age - idx * 0.05) / 0.6);
      const drop = (1 - easeOutBack(k)) * -size * 1.4;
      const float = Math.sin(t * 2 + idx * 0.5) * size * 0.04;
      const neon = li === 0 && (portrait || i < brand.words[0].length);
      ctx.globalAlpha = k;
      ctx.fillStyle = neon ? '#7df9ff' : '#ff4fe0';
      ctx.fillText(ch, x + cw / 2, ty + drop + float);
      ctx.globalAlpha = k * 0.35; // chromatic ghost
      ctx.fillStyle = neon ? '#ff2bd6' : '#00f0ff';
      ctx.fillText(ch, x + cw / 2 + size * 0.03, ty + drop + float + size * 0.02);
      x += cw;
    }
    if (!portrait) idx = 0;
  });
  ctx.globalAlpha = 1;
  const subK = clamp((age - 0.7) / 0.8);
  const sub = portrait ? brand.sub[0] : brand.sub[1];
  fitFont(ctx, sub, u * 0.85, W * 0.92, 700);
  ctx.fillStyle = 'rgba(220,235,255,0.85)';
  ctx.fillText(sub.slice(0, Math.floor(sub.length * subK)) + (subK < 1 && Math.floor(t * 8) % 2 ? '▌' : ''), W / 2, subY);

  // items, with a spring-driven sliding selection bar
  const { x0, y0, iw, ih, gap } = g;
  // rows that grew into a tall phone's spare height carry proportionally larger text (legibility, 90 F8)
  const ts = ih / (u * (portrait ? 2.2 : 1.9));
  const by = y0 + selY * (ih + gap);
  const bar = ctx.createLinearGradient(x0, 0, x0 + iw, 0);
  bar.addColorStop(0, 'rgba(0,240,255,0.30)');
  bar.addColorStop(1, 'rgba(255,43,214,0.12)');
  ctx.fillStyle = bar;
  ctx.fillRect(x0, by, iw, ih);
  ctx.fillStyle = '#00f0ff';
  ctx.fillRect(x0, by, u * 0.18, ih);
  ctx.textBaseline = 'alphabetic';
  items.forEach((it, i) => {
    const k = easeOutCubic(clamp((age - 0.9 - i * 0.08) / 0.5));
    const y = y0 + i * (ih + gap);
    const tx = x0 + u * 0.8 + (1 - k) * u * 3;
    const valueW = it.value ? iw * 0.42 : 0;
    ctx.globalAlpha = k;
    ctx.textAlign = 'left';
    fitFont(ctx, it.label, u * 0.82 * ts, iw - u * 1.6 - valueW, 800);
    ctx.fillStyle = i === sel ? '#ffffff' : 'rgba(200,215,255,0.75)';
    ctx.fillText(it.label, tx, y + ih * 0.45);
    fitFont(ctx, it.sub, u * 0.42 * ts, iw - u * 1.6, 600);
    ctx.fillStyle = 'rgba(150,180,255,0.6)';
    ctx.fillText(it.sub, tx, y + ih * 0.8);
    if (it.value) {
      ctx.textAlign = 'right';
      const v = i === sel ? `◀ ${it.value} ▶` : it.value;
      fitFont(ctx, v, u * 0.75 * ts, valueW, 800);
      ctx.fillStyle = i === sel ? '#ffcf3a' : 'rgba(255,207,58,0.6)';
      ctx.fillText(v, x0 + iw - u * 0.8, y + ih * 0.5);
    }
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  const hint = touch ? '点按开始 · 点选项左/右侧调整' : '↑↓ 选择 · ←→ 调整 · ENTER 开始';
  fitFont(ctx, hint, u * 0.45, W * 0.92, 500);
  ctx.fillStyle = 'rgba(180,200,255,0.5)';
  ctx.fillText(hint, W / 2, g.footY);
  fitFont(ctx, best, u * 0.42, W * 0.92, 500);
  ctx.fillText(best, W / 2, g.footY + u * 0.75);
  ctx.restore();
}

export function drawBanner(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, text: string, sub: string, age: number, color: string): void {
  if (age < 0 || age > 1.8) return;
  const inK = easeOutCubic(clamp(age / 0.35));
  const outK = clamp((age - 1.3) / 0.5);
  ctx.save();
  ctx.globalAlpha = 1 - outK;
  const y = H * 0.42;
  const bh = u * 3.2 * inK;
  ctx.fillStyle = 'rgba(4,6,20,0.65)';
  ctx.fillRect(0, y - bh / 2, W, bh);
  ctx.fillStyle = color;
  ctx.fillRect(0, y - bh / 2, W * inK, 2);
  ctx.fillRect(W * (1 - inK), y + bh / 2 - 2, W * inK, 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(u * 1.7, 900);
  ctx.fillStyle = color;
  const slide = (1 - inK) * W * 0.3 + outK * -W * 0.3;
  ctx.fillText(text, W / 2 + slide, y - u * 0.3);
  ctx.font = font(u * 0.55, 700);
  ctx.fillStyle = '#e6f0ff';
  ctx.fillText(sub, W / 2 - slide, y + u * 0.9);
  ctx.restore();
}

export function drawPause(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, t: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(2,3,12,0.5)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(u * 2, 900);
  ctx.fillStyle = `rgba(125,249,255,${0.7 + 0.3 * Math.sin(t * 4)})`;
  ctx.fillText('PAUSED', W / 2, H / 2);
  ctx.font = font(u * 0.55, 600);
  ctx.fillStyle = 'rgba(220,230,255,0.7)';
  ctx.fillText('SPACE / 点按屏幕 继续', W / 2, H / 2 + u * 1.6);
  ctx.restore();
}

/**
 * Audio unlock gate. Browsers block sound until a user gesture, so the menu would
 * otherwise be silent. `'corner'` = small non-blocking chip (used when a demo link
 * jumps straight into a game); a number = the box centre y, i.e. the menu's own gate slot
 * (`menuLayout(...).gateY`) so the box never sits on a menu row (84 F8: it covered START / SPEED).
 */
export function drawAudioGate(ctx: CanvasRenderingContext2D, W: number, _H: number, u: number, t: number, touch: boolean, at: 'corner' | number): void {
  const corner = at === 'corner';
  const label = touch ? '点击屏幕 开启声音' : '按任意键 / 点击 开启声音';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (corner) {
    ctx.font = font(u * 0.45, 700);
    const w = ctx.measureText(`🔇 ${label}`).width + u;
    ctx.fillStyle = 'rgba(6,10,28,0.8)';
    ctx.fillRect(W - w - u * 0.5, u * 0.5, w, u * 1.1);
    ctx.fillStyle = '#ffcf3a';
    ctx.fillText(`🔇 ${label}`, W - w / 2 - u * 0.5, u * 1.05);
    ctx.restore();
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const y = at as number;
  const bw = Math.min(W * 0.86, u * 16);
  const bh = u * MenuLimits.gateH;
  ctx.fillStyle = `rgba(0,240,255,${0.1 + 0.12 * pulse})`;
  ctx.fillRect(W / 2 - bw / 2, y - bh / 2, bw, bh);
  ctx.strokeStyle = `rgba(0,240,255,${0.5 + 0.5 * pulse})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - bw / 2, y - bh / 2, bw, bh);
  // equaliser bars as an "audio" glyph
  for (let i = 0; i < 5; i++) {
    const hgt = u * (0.3 + 0.5 * Math.abs(Math.sin(t * 6 + i * 1.3)));
    ctx.fillStyle = '#7df9ff';
    ctx.fillRect(W / 2 - bw / 2 + u * (0.8 + i * 0.32), y - hgt / 2, u * 0.18, hgt);
  }
  ctx.font = font(u * 0.72, 900);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('TAP TO START', W / 2 + u * 0.9, y - u * 0.35);
  ctx.font = font(u * 0.42, 700);
  ctx.fillStyle = 'rgba(200,230,255,0.85)';
  ctx.fillText(label, W / 2 + u * 0.9, y + u * 0.45);
  ctx.restore();
}
