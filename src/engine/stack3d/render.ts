/* GENERATED from gameforge/src/stack3d/render.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Stack3D kit — a small software renderer.
 *
 *  Everything is drawn into one low-resolution Uint32 pixel buffer that the page shows scaled up with hard pixels:
 *    · the ground is a column of stacked layers per map pixel (a height and a material), drawn front to back with
 *      a per-column horizon — a voxel-space heightfield, no polygons;
 *    · clouds are stacks floating at one altitude, and cast shadows;
 *    · models are sprite stacks (`./model`) turned to any yaw / roll / pitch;
 *    · everything else (gates, pickups, shots, sparks) is a primitive depth-tested against the world.
 *  One `StackCamera` covers the flat overhead view and the perspective chase view (`./camera`).
 *  Colours are palette entries; alpha is an ordered dither. DOM-free: the page wraps `bytes` in an ImageData. */
import type { StackCamera } from './camera';
import { BAYER, clamp, grade, hash8, mix, pack, type Rgb, type TimeOfDay } from './math';
import { poseAxes, type ModelPalette, type Pose, type StackSprite } from './model';
import { biomeEmissive, BIOME_TOP, BIOMES, CLOUD_K, HMAX, MAT_LAMP, MAT_SIDE, MAT_TOP, TONES, WATER_MATS, type StackWorld } from './world';

/** Tunables that have one home (rules: no scattered magic numbers). */
export const RenderLimits = {
  /** how far the chase view sees at altitude 0, world px (+3 per px of altitude) */
  viewDist: 1500,
  /** where the haze starts (+2 per px of altitude) */
  fogStart: 300,
  /** shades of haze between there and the horizon: stepped, so distance stays on-palette */
  fogSteps: 10,
  /** bands in the sky gradient */
  skyBands: 8,
  /** hard stop for the depth march (a degenerate camera must not hang the frame) */
  maxDepthSteps: 4000,
} as const;

export interface ShadowCaster {
  sprite: StackSprite;
  pose: Pose;
}

/** An engine nozzle on a sprite: across offset from the centre line, height in slices, position along, radius. */
export interface Nozzle {
  a: number;
  y: number;
  k: number;
  r: number;
}

export interface Plumes {
  nozzles: readonly Nozzle[];
  /** flame length in model voxels (0 = off) */
  length: number;
  /** width factor at the nozzle */
  wide: number;
  /** −1..1: the plume trails round the inside of a turn */
  bend: number;
  /** climb / dive arc */
  arch: number;
  /** 0..1: hotter (whiter) under thrust */
  heat: number;
  /** seen from behind, the flames sit in front of the whole tail */
  behind: boolean;
}

const NMAT = MAT_TOP.length;
const EPS = 1e-5;

export class StackRenderer {
  W = 0;
  H = 0;
  fb = new Uint32Array(0);
  bytes = new Uint8ClampedArray(0);
  /** per pixel: how deep into the view the world is, so it can hide whatever is behind it */
  zbuf = new Float32Array(0);
  /** 0..1 */
  cloudCover = 0.45;
  readonly cloudAlt: number;
  /** the tallest thing in the world */
  readonly ztop: number;
  tod: TimeOfDay = 'day';
  /** shadow offset per px of height (the sun's direction on the map) */
  sunX = 0.5;
  sunY = 0.32;
  readonly flamePal = new Uint32Array(6);
  hazeCol = 0;

  private mask = new Uint8Array(0);
  private colY = new Int32Array(0);
  private readonly rowNow: Int32Array;
  private readonly rowPrev: Int32Array;
  /** [(biome * TONES + tone) * NMAT + material] */
  private readonly topLit = new Uint32Array(NMAT * TONES * BIOMES);
  /** [biome * NMAT + material] */
  private readonly topShade = new Uint32Array(NMAT * BIOMES);
  private readonly sideLit = new Uint32Array(NMAT * BIOMES);
  private readonly sideShade = new Uint32Array(NMAT * BIOMES);
  private readonly cloudTop = new Uint32Array(CLOUD_K);
  private readonly cloudSide = new Uint32Array(CLOUD_K);
  private readonly skyPal = new Uint32Array(RenderLimits.skyBands);
  private cloudUnder = 0;
  private sunCol = 0;
  private sunGlow = 0;
  private sparkA = 0;
  private sparkB = 0;
  private foamCol = 0;
  private readonly shX = new Float64Array(4);
  private readonly shY = new Float64Array(4);
  private readonly shC = new Float64Array(4);
  private readonly shS = new Float64Array(4);
  private readonly shIA = new Float64Array(4);
  private readonly shIB = new Float64Array(4);
  private readonly shR = new Float64Array(4);
  private order = new Int32Array(0);
  private orderKey = new Float64Array(0);
  private readonly offX = new Float32Array(64);
  private readonly offY = new Float32Array(64);

  constructor(readonly world: StackWorld, opts: { cloudAlt?: number } = {}) {
    // clouds never start below the tallest terrain: the column loop draws them as a separate stack above it
    this.cloudAlt = Math.max(HMAX, Math.round(opts.cloudAlt ?? HMAX));
    this.ztop = this.cloudAlt + CLOUD_K;
    this.rowNow = new Int32Array(this.ztop + 2);
    this.rowPrev = new Int32Array(this.ztop + 2);
    this.setTimeOfDay('day');
  }

  resize(w: number, h: number): void {
    this.W = Math.max(8, w | 0);
    this.H = Math.max(8, h | 0);
    const buf = new ArrayBuffer(this.W * this.H * 4);
    this.fb = new Uint32Array(buf);
    this.bytes = new Uint8ClampedArray(buf);
    this.zbuf = new Float32Array(this.W * this.H);
    this.mask = new Uint8Array(this.W * this.H);
    this.colY = new Int32Array(this.W);
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.tod = tod;
    const P = (c: Rgb): number => pack(c[0], c[1], c[2]);
    for (let bi = 0; bi < BIOMES; bi++) {
      const over = BIOME_TOP[bi];
      for (let m = 0; m < NMAT; m++) {
        const own = over !== null && m < over.length;
        const rawTop: Rgb = own ? over[m] : MAT_TOP[m];
        const rawSide: Rgb = own ? [rawTop[0] * 0.7, rawTop[1] * 0.7, rawTop[2] * 0.74] : MAT_SIDE[m];
        // a lamp or a lava vent makes its own light: not graded by the time of day, not dimmed by a shadow
        const glow = m === MAT_LAMP || biomeEmissive(bi, m);
        const tt: Rgb = glow ? rawTop : grade(rawTop, tod, 1);
        const ss: Rgb = glow ? rawSide : grade(rawSide, tod, 1);
        const k = bi * TONES * NMAT + m;
        this.topLit[k] = P(tt);
        this.topLit[k + NMAT] = pack(tt[0] * 1.1 + 14, tt[1] * 1.1 + 14, tt[2] * 1.08 + 10); // rim
        this.topLit[k + 2 * NMAT] = glow ? P(tt) : pack(tt[0] * 0.74, tt[1] * 0.78, tt[2] * 0.88); // nook
        this.topLit[k + 3 * NMAT] = pack(tt[0] * 0.94, tt[1] * 0.95, tt[2] * 0.96); // tile
        this.sideLit[bi * NMAT + m] = P(ss);
        // shadow is cooler, not just darker: blue keeps more than red
        this.topShade[bi * NMAT + m] = glow ? P(tt) : pack(tt[0] * 0.62, tt[1] * 0.67, tt[2] * 0.8);
        this.sideShade[bi * NMAT + m] = glow ? P(ss) : pack(ss[0] * 0.62, ss[1] * 0.67, ss[2] * 0.8);
      }
    }
    const ca = tod === 'night' ? 0.72 : 1;
    for (let k = 0; k < CLOUD_K; k++) {
      const f = k / (CLOUD_K - 1);
      const ft = Math.min(1, k / 2);
      this.cloudTop[k] = P(grade([218 + 37 * ft, 230 + 25 * ft, 247 + 8 * ft], tod, ca));
      this.cloudSide[k] = P(grade([158 + 44 * f, 182 + 36 * f, 222 + 18 * f], tod, ca));
    }
    this.cloudUnder = P(grade([138, 160, 200], tod, ca));
    const pick = (day: Rgb, sunset: Rgb, night: Rgb): number => P(tod === 'sunset' ? sunset : tod === 'night' ? night : day);
    this.sparkA = pick([120, 190, 236], [255, 170, 110], [70, 110, 190]);
    this.sparkB = pick([236, 250, 255], [255, 226, 170], [170, 200, 240]);
    this.foamCol = pick([240, 252, 255], [255, 226, 214], [110, 140, 200]);
    const flames: Rgb[] = [[255, 252, 224], [255, 224, 120], [255, 164, 44], [246, 96, 20], [176, 48, 26], [96, 34, 40]];
    for (let i = 0; i < 6; i++) this.flamePal[i] = P(flames[i]);
    // sky: from the horizon up
    const skyA: Rgb = tod === 'sunset' ? [255, 198, 132] : tod === 'night' ? [36, 56, 110] : [198, 232, 250];
    const skyM: Rgb = tod === 'sunset' ? [238, 122, 130] : tod === 'night' ? [18, 28, 70] : [122, 190, 240];
    const skyB: Rgb = tod === 'sunset' ? [84, 68, 150] : tod === 'night' ? [7, 10, 34] : [62, 142, 222];
    const NS = RenderLimits.skyBands;
    for (let i = 0; i < NS; i++) {
      const f = i / (NS - 1);
      const a = f < 0.5 ? skyA : skyM;
      const b = f < 0.5 ? skyM : skyB;
      const g = f < 0.5 ? f * 2 : f * 2 - 1;
      this.skyPal[i] = pack(a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g);
    }
    this.hazeCol = pick([188, 224, 246], [250, 182, 134], [28, 44, 92]);
    this.sunCol = tod === 'night' ? pack(232, 238, 255) : pack(255, 244, 200);
    this.sunGlow = tod === 'night' ? pack(70, 96, 160) : pack(255, 222, 150);
    if (tod === 'sunset') { this.sunX = 0.95; this.sunY = 0.5; } else if (tod === 'night') { this.sunX = 0.3; this.sunY = 0.42; } else { this.sunX = 0.5; this.sunY = 0.32; }
  }

  /** The islands and clouds, from the nearest ground to the farthest. Every ground pixel is a column: its wall is
   *  drawn where the column starts and its top where it ends, and a pixel that is taken stays taken (near wins),
   *  so overdraw is ~0 and the per-column horizon (`colY`) culls everything hidden behind a hill. */
  drawWorld(cam: StackCamera, time: number, casters: readonly ShadowCaster[] = []): void {
    const { W, H, fb: _fb, zbuf: _zb, colY: _cy, rowNow, rowPrev, world, cloudAlt: CA, ztop: ZT } = this;
    _fb.fill(0);
    _zb.fill(1e9);
    _cy.fill(H);
    const c = cam.cos;
    const s = cam.sin;
    const q = cam.q;
    const S = cam.scale;
    const tn = cam.tan;
    const Cx = cam.cx;
    const Cy = cam.cy;
    const A = cam.alt;
    const N = world.n;
    const NM = world.mask;
    const NSH = world.shift;
    const NC = world.nc;
    const NCM = world.cmask;
    const NCSH = world.cshift;
    const bx = cam.x - Math.floor(cam.x / N) * N + N * 2;
    const by = cam.y - Math.floor(cam.y / N) * N + N * 2;
    const rankMax = Math.round(clamp(this.cloudCover, 0, 1) * 16);
    const cloudsOn = rankMax > 0;
    // clouds drift; their shadows fall where the sun puts them
    const cdx = (time * 7) % NC;
    const cdy = (time * 3) % NC;
    const sx = this.sunX;
    const sy = this.sunY;
    const csx = sx * CA - cdx + NC;
    const csy = sy * CA - cdy + NC;
    const tW1 = ((time * 6) | 0) & 1023;
    const tW2 = ((time * 4) | 0) & 1023;
    const tF = (time * 36) | 0;
    // model shadows: the footprint, slid along the sun direction by the caster's height
    const nSh = Math.min(casters.length, 4);
    // (scratch arrays are members: a frame allocates nothing, so the collector never interrupts one)
    const { shX, shY, shC, shS, shIA, shIB, shR } = this;
    for (let j = 0; j < nSh; j++) {
      const p = casters[j].pose;
      shX[j] = bx + (p.x - cam.x) + sx * p.z;
      shY[j] = by + (p.y - cam.y) + sy * p.z;
      shC[j] = Math.cos(p.yaw);
      shS[j] = Math.sin(p.yaw);
      // a banked wing casts a narrower shadow
      shIA[j] = 1 / (Math.max(0.3, Math.abs(Math.cos(p.roll))) * p.scale);
      shIB[j] = 1 / p.scale;
      shR[j] = casters[j].sprite.model.l * 0.75 * p.scale + 3;
    }
    const _h = world.height;
    const _m = world.mat;
    const _cn = world.cloud;
    const _nz = world.noise;
    const _tn = world.tone;
    const _bi = world.biome;
    const { topLit, topShade, sideLit, sideShade, cloudTop, cloudSide, cloudUnder, foamCol, sparkA, sparkB, hazeCol } = this;

    // start where the tallest thing sits on the bottom row; stop when the sea leaves the top of the frame, or at
    // the view distance once there is a horizon (an eye down among the hills starts right in front of itself)
    const below = H - Cy;
    const nearest = q > 0 ? -0.85 / q : -1e9;
    const camHigh = q > 0 ? A + tn / q : 1e9;
    const dn = S * tn + q * below;
    let v = camHigh > ZT + 1 && dn > 1e-6 ? Math.max(nearest, (S * (A - ZT) - below) / dn - 2) : nearest;
    const viewDist = RenderLimits.viewDist + 3 * A;
    const fogStart = RenderLimits.fogStart + 2 * A;
    const above = Cy + 2;
    let vEnd = viewDist;
    if (S * tn > q * above) vEnd = Math.min(viewDist, (S * A + above) / (S * tn - q * above));
    let den = 1 + q * v;
    let m = S / den;
    let R = Cy - m * (tn * v - A) + EPS;
    for (let z = 0; z <= ZT; z++) rowNow[z] = Math.floor(R - m * z);
    const rowsK = S * (tn + q * A);
    const FS = RenderLimits.fogSteps;
    for (let guard = 0; v < vEnd && guard < RenderLimits.maxDepthSteps; guard++) {
      // one step deeper: about one screen row of sea, never coarser than a few pixels across (so the far field
      // costs the same per row as the near field: the level of detail falls out of the step size)
      let dv = (den * den) / rowsK;
      const cap = (2.5 * den) / S;
      if (dv > cap) dv = cap;
      if (dv < 0.5) dv = 0.5;
      v += dv;
      den = 1 + q * v;
      m = S / den;
      R = Cy - m * (tn * v - A) + EPS;
      for (let z = 0; z <= ZT; z++) {
        rowPrev[z] = rowNow[z];
        rowNow[z] = Math.floor(R - m * z);
      }
      const inv = den / S;
      const ax = c * inv;
      const ay = -s * inv;
      let wx = bx - Cx * ax - v * s;
      let wy = by - Cx * ay - v * c;
      let fog = 0;
      if (q > 0 && v > fogStart) {
        const f = (v - fogStart) / (viewDist - fogStart);
        fog = Math.min(256, ((Math.sqrt(f) * FS + 0.5) | 0) * (256 / FS)) | 0;
      }
      const fine = inv < 1.8;
      for (let px = 0; px < W; px++, wx += ax, wy += ay) {
        if (cloudsOn) {
          const cv = _cn[((((wy - cdy + NC) | 0) & NCM) << NCSH) | (((wx - cdx + NC) | 0) & NCM)];
          if (cv !== 0 && cv >> 4 < rankMax) {
            const tk = cv & 15;
            let y0 = rowNow[CA + tk - 1];
            let y1 = rowPrev[CA + tk - 1];
            if (y0 < 0) y0 = 0;
            if (y1 > H) y1 = H;
            if (y0 < y1) {
              const col = fog > 0 ? mix(cloudTop[tk - 1], hazeCol, fog) : cloudTop[tk - 1];
              for (let y = y0, o = y0 * W + px; y < y1; y++, o += W) {
                // the thinnest rim is a checker, so the cloud edge is soft
                if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue;
                _fb[o] = col;
                _zb[o] = v;
              }
            }
            // its underside, when the eye is below the clouds
            let u0 = rowPrev[CA];
            let u1 = rowNow[CA];
            if (u0 < u1) {
              if (u0 < 0) u0 = 0;
              if (u1 > H) u1 = H;
              const col = fog > 0 ? mix(cloudUnder, hazeCol, fog) : cloudUnder;
              for (let y = u0, o = u0 * W + px; y < u1; y++, o += W) {
                if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue;
                _fb[o] = col;
                _zb[o] = v;
              }
            }
            for (let k = tk - 2; k >= 0; k--) {
              let ya = rowPrev[CA + k + 1];
              let yb = rowPrev[CA + k];
              if (ya < 0) ya = 0;
              if (yb > H) yb = H;
              if (ya >= yb) continue;
              const col = fog > 0 ? mix(cloudSide[k], hazeCol, fog) : cloudSide[k];
              for (let y = ya, o = ya * W + px; y < yb; y++, o += W) {
                if (_fb[o] === 0) { _fb[o] = col; _zb[o] = v; }
              }
            }
          }
        }
        const gx = wx | 0;
        const gy = wy | 0;
        const idx = ((gy & NM) << NSH) | (gx & NM);
        const h = _h[idx];
        let cY = _cy[px];
        const yT = rowNow[h];
        let yR = rowPrev[h];
        if (yT >= cY && yR >= cY) continue;
        const mat = _m[idx];
        let shade = 0;
        if (cloudsOn) {
          const sv = _cn[((((gy + csy) | 0) & NCM) << NCSH) | (((gx + csx) | 0) & NCM)];
          if ((sv & 15) > 1 && sv >> 4 < rankMax) shade = 1;
        }
        for (let j = 0; shade === 0 && j < nSh; j++) {
          const dx = gx - shX[j] + sx * h;
          const dy = gy - shY[j] + sy * h;
          const reach = shR[j];
          if (dx > -reach && dx < reach && dy > -reach && dy < reach) {
            const sp = casters[j].sprite;
            const i = Math.floor((dx * shC[j] + dy * shS[j]) * shIA[j] + sp.model.w / 2);
            const k = Math.floor(sp.pivotK - (dx * shS[j] - dy * shC[j]) * shIB[j] + 0.5);
            if (i >= 0 && i < sp.model.w && k >= 0 && k < sp.model.l && sp.footprint[k * sp.model.w + i] === 1) shade = 1;
          }
        }
        let top: number;
        let side: number;
        const bio = _bi[idx];
        const bm = bio * NMAT + mat;
        if (mat < WATER_MATS) {
          top = shade ? topShade[bm] : topLit[bio * TONES * NMAT + mat];
          if (mat === 3) {
            // surf: foam that comes and goes
            if (((_nz[((gy & 255) << 8) | (gx & 255)] + tF) & 255) < 120) top = shade ? topShade[bio * NMAT + 2] : foamCol;
          } else if (shade === 0 && fine) {
            // sparkle: two noise fields sliding against each other
            const n1 = _nz[((gy & 255) << 8) | (((gx + tW1) >> 2) & 255)];
            if (n1 > 243 && _nz[(((gy + 91) & 255) << 8) | (((gx + 1024 - tW2) >> 2) & 255)] > 128) top = n1 > 252 ? sparkB : sparkA;
          }
          side = top;
        } else {
          top = shade ? topShade[bm] : topLit[(bio * TONES + _tn[idx]) * NMAT + mat];
          side = shade ? sideShade[bm] : sideLit[bm];
        }
        if (fog > 0) {
          top = mix(top, hazeCol, fog);
          side = mix(side, hazeCol, fog);
        }
        // the wall of this column, where it starts …
        if (yR < cY) {
          if (yR < 0) yR = 0;
          for (let y = yR, o = yR * W + px; y < cY; y++, o += W) {
            if (_fb[o] === 0) { _fb[o] = side; _zb[o] = v; }
          }
          cY = yR;
        }
        // … and its top, up to where it ends (unless the eye is below it)
        if (yT < cY) {
          const y0 = yT < 0 ? 0 : yT;
          for (let y = y0, o = y0 * W + px; y < cY; y++, o += W) {
            if (_fb[o] === 0) { _fb[o] = top; _zb[o] = v; }
          }
          cY = yT;
        }
        _cy[px] = cY;
      }
    }
  }

  /** Whatever the ground left empty: sky above the horizon, haze below it. A no-op in the flat view. */
  drawSky(cam: StackCamera): void {
    if (cam.q <= 1e-7) return;
    const { W, H, fb: _fb, tod, skyPal, sunCol, sunGlow, hazeCol } = this;
    const horizon = cam.horizon;
    const hz = horizon > H ? H : Math.floor(horizon);
    const focal = cam.scale / cam.q;
    const NS = RenderLimits.skyBands;
    // sun or moon, low over the horizon, opposite the shadows
    if (hz > 0 && tod !== 'day') {
      const sl = Math.hypot(this.sunX, this.sunY) || 1;
      const dx = -this.sunX / sl;
      const dy = -this.sunY / sl;
      const du = dx * cam.cos - dy * cam.sin;
      const dv = -(dx * cam.sin + dy * cam.cos);
      if (dv > 0.2) {
        const rad = tod === 'sunset' ? W * 0.05 : W * 0.022;
        const cxs = cam.cx + (focal * du) / dv;
        const cys = horizon - (focal * (tod === 'sunset' ? 0.12 : 0.3)) / dv;
        const reach = rad * 1.9;
        const xa = Math.max(0, Math.floor(cxs - reach));
        const xb = Math.min(W - 1, Math.ceil(cxs + reach));
        const ya = Math.max(0, Math.floor(cys - reach));
        const yb = Math.min(hz - 1, Math.ceil(cys + reach));
        for (let y = ya; y <= yb; y++) {
          for (let x = xa; x <= xb; x++) {
            const o = y * W + x;
            if (_fb[o] !== 0) continue;
            const d = Math.hypot(x - cxs, y - cys) / rad;
            if (d < 1) _fb[o] = sunCol;
            else if (d < 1.9 && (1.9 - d) * 14 > BAYER[((y & 3) << 2) | (x & 3)]) _fb[o] = sunGlow;
          }
        }
      }
    }
    const span = H * 0.75;
    const starOff = ((cam.yaw * focal) | 0) & 4095;
    const stars = tod === 'night';
    for (let y = 0; y < H; y++) {
      let o = y * W;
      if (y < hz) {
        const t = ((hz - y) / span) * (NS - 1);
        for (let x = 0; x < W; x++, o++) {
          if (_fb[o] !== 0) continue;
          let b = t | 0;
          // bands meet in a dither, not a line
          const edge = (t - b - 0.7) * 3.4;
          if (edge > 0 && edge * 16 > BAYER[((y & 3) << 2) | (x & 3)]) b++;
          if (b >= NS) b = NS - 1;
          _fb[o] = stars && b > 1 && hash8(((x + starOff) & 4095) * 73 + y * 9973) < 2 ? sunCol : skyPal[b];
        }
      } else {
        for (let x = 0; x < W; x++, o++) if (_fb[o] === 0) _fb[o] = hazeCol;
      }
    }
  }

  /** A sprite stack at a pose, hidden by whatever world is in front of it, with a 1 px outline so it reads over
   *  any ground. Optional engine plumes are sliced the same way, so they stack with the model. */
  drawSprite(cam: StackCamera, sp: StackSprite, pal: ModelPalette, pose: Pose, time: number, plumes?: Plumes, alpha = 1): void {
    // alpha < 1 draws a ghost: an ordered dither of the model, no outline (a rival, a replay)
    const solid = alpha >= 1;
    const a16 = alpha * 16;
    const { W, H, fb: _fb, zbuf: _zb, mask: _mk, offX, offY, flamePal } = this;
    const c = cam.cos;
    const s = cam.sin;
    const q = cam.q;
    const S = cam.scale;
    const tn = cam.tan;
    const ax = poseAxes(pose);
    const sc = pose.scale;
    const JH = sp.model.h;
    // the model's own axes in view space, per voxel: across the screen (U), into it (V), up (W)
    const rU = (ax.rx * c - ax.ry * s) * sc;
    const rV = -(ax.rx * s + ax.ry * c) * sc;
    const rW = ax.rz * sc;
    const fU = (ax.fx * c - ax.fy * s) * sc;
    const fV = -(ax.fx * s + ax.fy * c) * sc;
    const fW = ax.fz * sc;
    const uU = (ax.ux * c - ax.uy * s) * sc;
    const uV = -(ax.ux * s + ax.uy * c) * sc;
    const uW = ax.uz * sc;
    const dx = pose.x - cam.x;
    const dy = pose.y - cam.y;
    const cU = dx * c - dy * s;
    const cV = -(dx * s + dy * c);
    const cW = pose.z - cam.alt;
    const den0 = 1 + q * cV;
    if (den0 < 0.2) return;
    const m0 = S / den0;
    const cx = cam.cx + m0 * cU;
    const cy = cam.cy - m0 * (cW + tn * cV);
    const far = sp.model.l * sc * m0 + 40;
    if (cx < -far || cy < -far - H || cx > W + far || cy > H + far) return;
    const prx = m0 * rU;
    const pry = -m0 * (rW + tn * rV);
    const pfx = m0 * fU;
    const pfy = -m0 * (fW + tn * fV);
    // light: which way each half of the model faces the sun (three tones, chosen per half — no per-voxel maths)
    const lx = -this.sunX;
    const ly = -this.sunY;
    const lz = 1.1;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const night = this.tod === 'night';
    const litAt = night ? 0.74 : 0.9;
    const dimAt = night ? 0.4 : 0.66;
    const tone = (side: number): Uint32Array => {
      const nx = ax.ux + side * 0.4 * ax.rx;
      const ny = ax.uy + side * 0.4 * ax.ry;
      const nz = ax.uz + side * 0.4 * ax.rz;
      const b = (nx * lx + ny * ly + nz * lz) / (ll * Math.sqrt(nx * nx + ny * ny + nz * nz));
      return b > litAt ? pal.lit : b < dimAt ? pal.dim : pal.base;
    };
    const palL = tone(-1);
    const palR = tone(1);
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    // several samples per voxel, more the larger it is drawn, so a turned slice has no pin-holes
    const big = (sc * S) / Math.max(0.2, den0 - q * sp.model.l * 0.6 * sc);
    const ns = clamp(Math.ceil(big * 2 - 0.24), 2, 8);
    for (let i = 0; i < ns; i++) {
      for (let k = 0; k < ns; k++) {
        const oi = (i + 0.5) / ns - 0.5;
        const ok = (k + 0.5) / ns - 0.5;
        offX[i * ns + k] = oi * prx + ok * pfx;
        offY[i * ns + k] = oi * pry + ok * pfy;
      }
    }
    const nOff = ns * ns;
    // slices are drawn from the one farthest from eye level to the nearest, so nearer ones cover
    const eye = q < 1e-6 ? (tn * uW - uV >= 0 ? 1e9 : -1e9) : (-cU * uU + (-1 / q - cV) * uV + (tn / q - cW) * uW) / (sc * sc);
    if (this.order.length < JH) { this.order = new Int32Array(JH); this.orderKey = new Float64Array(JH); }
    const order = this.order;
    const key = this.orderKey;
    for (let y = 0; y < JH; y++) { order[y] = y; key[y] = Math.abs(y - sp.pivotY - eye); }
    // insertion sort, farthest first (a dozen slices: no closure, no garbage)
    for (let i = 1; i < JH; i++) {
      const y = order[i];
      let k = i - 1;
      while (k >= 0 && key[order[k]] < key[y]) { order[k + 1] = order[k]; k--; }
      order[k + 1] = y;
    }

    const flameLen = plumes ? plumes.length * (0.82 + 0.18 * Math.sin(time * 47) * Math.sin(time * 31)) : 0;
    const flames = (y: number, bU: number, bV: number, bW: number): void => {
      if (!plumes || flameLen <= 0.5) return;
      for (let e = 0; e < plumes.nozzles.length; e++) {
        const nz = plumes.nozzles[e];
        const dyv = (y + 0.5 - nz.y) / (nz.r * 1.25);
        if (dyv <= -1 || dyv >= 1) continue;
        const prof = Math.sqrt(1 - dyv * dyv);
        for (let t = 0; t < flameLen; t += 0.5) {
          const u = t / flameLen;
          const rad = nz.r * plumes.wide * Math.pow(1 - u, 0.75) * prof * (0.9 + 0.2 * Math.sin(t * 1.9 - time * 40 + e * 2));
          if (rad < 0.2) continue;
          const b = sp.pivotK - nz.k - t;
          const curl = (t * t) / flameLen;
          const swing = plumes.bend * curl;
          const lift = plumes.arch * curl;
          for (let a = -rad; a <= rad; a += 0.5) {
            const aa = nz.a + a + swing;
            const V = bV + aa * rV + b * fV + lift * uV;
            const den = 1 + q * V;
            if (den < 0.2) continue;
            const m = S / den;
            const heat = u * 0.9 + (Math.abs(a) / (rad + 0.01)) * 0.55 + Math.abs(dyv) * 0.3 - 0.16 * plumes.heat;
            const col = flamePal[heat < 0.28 ? 0 : heat < 0.5 ? 1 : heat < 0.75 ? 2 : heat < 1.0 ? 3 : heat < 1.25 ? 4 : 5];
            const fx = Math.round(cam.cx + m * (bU + aa * rU + b * fU + lift * uU));
            const fy = Math.round(cam.cy - m * (bW + aa * rW + b * fW + lift * uW + tn * V));
            const size = Math.max(1, Math.ceil(m * sc * 0.55));
            for (let yy = fy; yy < fy + size; yy++) {
              for (let xx = fx; xx < fx + size; xx++) {
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const at = yy * W + xx;
                if (_zb[at] < V - 1) continue;
                _fb[at] = col;
                _mk[at] = 2; // flame: never outlined
              }
            }
            if (fx < x0) x0 = fx;
            if (fx + size > x1) x1 = fx + size;
            if (fy < y0) y0 = fy;
            if (fy + size > y1) y1 = fy + size;
          }
        }
      }
    };
    for (let n = 0; n < JH; n++) {
      const y = order[n];
      const cnt = sp.c[y].length;
      const hgt = y - sp.pivotY;
      const bU = cU + hgt * uU;
      const bV = cV + hgt * uV;
      const bW = cW + hgt * uW;
      const A = sp.a[y];
      const B = sp.b[y];
      const C = sp.c[y];
      for (let v = 0; v < cnt; v++) {
        const a = A[v];
        const b = B[v];
        const V = bV + a * rV + b * fV;
        const den = 1 + q * V;
        if (den < 0.2) continue;
        const m = S / den;
        const col = a < 0 ? palL[C[v]] : palR[C[v]];
        const px = cam.cx + m * (bU + a * rU + b * fU);
        const py = cam.cy - m * (bW + a * rW + b * fW + tn * V);
        const k = m / m0;
        let x = 0;
        let yy = 0;
        for (let o = 0; o < nOff; o++) {
          x = Math.round(px + offX[o] * k);
          yy = Math.round(py + offY[o] * k);
          if (x < 0 || yy < 0 || x >= W || yy >= H) continue;
          const at = yy * W + x;
          if (_zb[at] < V - 1) continue; // a hill or a cloud is in front
          if (!solid && a16 <= BAYER[((yy & 3) << 2) | (x & 3)]) continue;
          _fb[at] = col;
          _mk[at] = solid ? 1 : 2;
        }
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (yy < y0) y0 = yy;
        if (yy > y1) y1 = yy;
      }
      if (plumes && !plumes.behind) flames(y, bU, bV, bW);
    }
    if (plumes && plumes.behind) {
      for (let y = 0; y < JH; y++) {
        const hgt = y - sp.pivotY;
        flames(y, cU + hgt * uU, cV + hgt * uV, cW + hgt * uW);
      }
    }
    if (x1 < 0) return;
    x0 = Math.max(1, x0 - 4);
    y0 = Math.max(1, y0 - 4);
    x1 = Math.min(W - 2, x1 + 4);
    y1 = Math.min(H - 2, y1 + 4);
    for (let yy = y0; yy <= y1; yy++) {
      let o = yy * W + x0;
      for (let x = x0; x <= x1; x++, o++) {
        if (_mk[o] === 0 && ((_mk[o - 1] | _mk[o + 1] | _mk[o - W] | _mk[o + W]) & 1) === 1 && _zb[o] >= cV - 2) _fb[o] = pal.outline;
      }
    }
    for (let yy = y0 - 1; yy <= y1 + 1; yy++) _mk.fill(0, yy * W + x0 - 1, yy * W + x1 + 2);
  }

  /** Copy `sheet`'s picture into this frame turned by `roll` about (W / 2, pivotY): the cockpit's rolling horizon.
   *  `sheet` must be large enough for the roll (see `cockpitSheet`); anything outside it is left black. */
  turnFrom(sheet: StackRenderer, roll: number, pivotY: number): void {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const hw = sheet.W >> 1;
    const hh = sheet.H >> 1;
    const cx = this.W >> 1;
    const { fb } = this;
    const src = sheet.fb;
    const sw = sheet.W;
    const sh = sheet.H;
    for (let y = 0; y < this.H; y++) {
      const dy = y - pivotY;
      let sx = hw - c * cx - s * dy + 0.5;
      let sy = hh - s * cx + c * dy + 0.5;
      let o = y * this.W;
      for (let x = 0; x < this.W; x++, o++, sx += c, sy += s) {
        const ix = sx | 0;
        const iy = sy | 0;
        fb[o] = ix >= 0 && iy >= 0 && ix < sw && iy < sh ? src[iy * sw + ix] : 0xff000000;
      }
    }
  }

  // ── primitives, all in frame pixels and depth-tested against the world (`v` = depth into the view) ──

  /** A filled square with its top-left corner at (x, y). */
  plot(x: number, y: number, size: number, col: number, v: number): void {
    const { W, H, fb, zbuf } = this;
    for (let yy = y; yy < y + size; yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = x; xx < x + size; xx++) {
        if (xx < 0 || xx >= W) continue;
        const at = yy * W + xx;
        if (zbuf[at] >= v - 1) fb[at] = col;
      }
    }
  }

  /** A filled disc; `hi` / `lo` (optional) shade it as a ball lit from the upper left. */
  disc(cx: number, cy: number, rad: number, col: number, v: number, hi = col, lo = col): void {
    const { W, H, fb, zbuf } = this;
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(W - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(H - 1, Math.ceil(cy + rad));
    const inv = 1 / (rad * rad);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x - cx;
        const ddy = y - cy;
        const d2 = (ddx * ddx + ddy * ddy) * inv;
        if (d2 > 1) continue;
        const at = y * W + x;
        if (zbuf[at] < v - 1) continue;
        const l = (ddx + ddy) / rad;
        fb[at] = l < -0.55 ? hi : l > 0.6 ? lo : col;
      }
    }
  }

  /** A soft round puff blended over the picture (smoke, spray): the one place the kit blends instead of dithers. */
  puff(cx: number, cy: number, rad: number, col: number, alpha: number, v: number): void {
    const { W, H, fb, zbuf } = this;
    if (rad > 60 || alpha <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(W - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(H - 1, Math.ceil(cy + rad));
    const inv = 1 / (rad * rad);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) * inv;
        if (d2 > 1) continue;
        const at = y * W + x;
        if (zbuf[at] < v - 1) continue;
        fb[at] = mix(fb[at], col, (alpha * (1 - d2 * 0.7) * 256) | 0);
      }
    }
  }

  /** A line with dithered alpha (0..1). */
  line(xa: number, ya: number, xb: number, yb: number, col: number, alpha: number, thick: number, v: number): void {
    const { W, H, fb, zbuf } = this;
    const span = Math.max(Math.abs(xb - xa), Math.abs(yb - ya));
    if (span > 2 * (W + H)) return;
    const steps = Math.max(1, Math.ceil(span));
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(xa + ((xb - xa) * k) / steps);
      const y = Math.round(ya + ((yb - ya) * k) / steps);
      for (let yy = y; yy < y + thick; yy++) {
        for (let xx = x; xx < x + thick; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const at = yy * W + xx;
          if (zbuf[at] < v - 1) continue;
          if (alpha * 16 > BAYER[((yy & 3) << 2) | (xx & 3)]) fb[at] = col;
        }
      }
    }
  }

  /** A world-space segment through the camera (trails, tracers); skipped when either end is behind the eye. */
  segment(cam: StackCamera, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, alpha: number): void {
    if (!cam.project(x0, y0, z0)) return;
    const ax = cam.sx;
    const ay = cam.sy;
    if (!cam.project(x1, y1, z1)) return;
    this.line(ax, ay, cam.sx, cam.sy, col, alpha, cam.sm > 2.4 ? 2 : 1, cam.sv);
  }
}
