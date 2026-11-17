/* GENERATED from gameforge/src/stack3d/world.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Stack3D kit — the world: one height and one material per ground pixel, on a power-of-two map that wraps, plus a
 *  cloud layer (a thickness per cell). Everything derives from the seed (`../rng`), so a world is reproducible and a
 *  simulation that reads `groundAt` stays deterministic. DOM-free. */
import { mulberry32, type Rng } from '../rng';
import { cos, sin } from '../trig';
import { clamp, hash8, type Rgb } from './math';

/** Tallest terrain stack, trees included: a renderer sizes its per-height tables from this. */
export const HMAX = 40;
/** Cloud stack height (layers). */
export const CLOUD_K = 8;

/** Materials. 0 deep · 1 mid · 2 shallow · 3 surf · 4 sand · 5 sand speck · 6 grass · 7 grass dark · 8 grass light
 *  · 9 tree top · 10 tree · 11 tree edge · 12 rock · 13 rock dark · 14 rock light · 15 snow · 16 snow shade
 *  · 17–20 built things (below).
 *  Indices < 4 are water (height 0, animated by the renderer). */
export const MAT_TOP: readonly Rgb[] = [
  [36, 104, 180], [44, 124, 198], [66, 160, 216], [104, 204, 214],
  [238, 220, 164], [222, 200, 140],
  [96, 178, 52], [70, 148, 44], [134, 206, 76],
  [70, 158, 64], [42, 122, 54], [28, 92, 46],
  [146, 140, 134], [118, 112, 110], [178, 172, 162],
  [246, 250, 255], [214, 226, 244],
  [196, 62, 54], [150, 112, 70], [214, 64, 56], [255, 226, 120],
];
/** The wall of a column is darker than its top: that single contrast is what makes the stack read as relief. */
export const MAT_SIDE: readonly Rgb[] = [
  [36, 104, 180], [44, 124, 198], [66, 160, 216], [104, 204, 214],
  [204, 180, 122], [204, 180, 122],
  [56, 120, 44], [50, 108, 42], [60, 128, 46],
  [24, 78, 42], [22, 72, 40], [20, 64, 38],
  [96, 90, 92], [86, 82, 86], [104, 98, 98],
  [186, 202, 228], [176, 192, 220],
  [236, 226, 204], [112, 80, 52], [240, 240, 236], [255, 196, 80],
];
export const WATER_MATS = 4;
/** Built things: 17 house (red roof over pale walls) · 18 pier planks · 19 lighthouse (red cap, white tower) · 20 lamp. */
export const MAT_HOUSE = 17;
export const MAT_PIER = 18;
export const MAT_TOWER = 19;
export const MAT_LAMP = 20;
/** Per-pixel tone of a column top: 0 plain · 1 rim (an edge that faces the light) · 2 nook (in the lee of a taller
 *  neighbour) · 3 tile (the darker square of a 4 px checker). Baked once: it is what makes terraces read as blocks. */
export const TONES = 4;

/** Biomes: the same 17 ground materials in another palette and another terrain shape.
 *  0 verdant (the default) · 1 red mesa · 2 frost · 3 volcanic · 4 autumn harbour. */
export const BIOMES = 5;
/** Top colours per biome for materials 0–16 (built things keep theirs); null = as the default table. The wall of a
 *  column is the top darkened, as in the default. */
export const BIOME_TOP: ReadonlyArray<ReadonlyArray<Rgb> | null> = [
  null,
  [ // red mesa: turquoise shallows, ochre flats, cactus green, red rock, cream caps
    [24, 96, 150], [30, 124, 166], [56, 170, 180], [150, 220, 204], [232, 196, 140], [210, 170, 112],
    [214, 150, 84], [190, 124, 66], [236, 176, 104], [86, 150, 70], [60, 120, 58], [44, 92, 48],
    [188, 92, 60], [156, 70, 48], [214, 118, 76], [244, 220, 176], [218, 190, 150],
  ],
  [ // frost: steel sea, pale shore, snowfields, dark pines, blue ice, white peaks
    [34, 70, 120], [44, 90, 140], [84, 136, 176], [176, 214, 232], [214, 226, 236], [190, 206, 222],
    [226, 236, 246], [200, 214, 232], [244, 250, 255], [44, 96, 84], [30, 74, 68], [22, 56, 54],
    [140, 176, 210], [112, 148, 190], [176, 208, 234], [250, 252, 255], [214, 228, 246],
  ],
  [ // volcanic: dark sea, black sand, ash, charred trees, basalt, glowing vents
    [30, 40, 84], [40, 52, 100], [62, 80, 124], [120, 130, 160], [70, 64, 66], [54, 50, 54],
    [86, 82, 78], [66, 62, 62], [106, 100, 92], [70, 56, 48], [52, 42, 38], [38, 30, 30],
    [58, 54, 60], [42, 40, 46], [80, 74, 80], [255, 150, 40], [230, 84, 24],
  ],
  [ // autumn harbour: green-grey sea, warm sand, gold grass, red and orange woods
    [30, 92, 130], [40, 112, 148], [70, 150, 170], [150, 210, 206], [236, 210, 160], [216, 188, 136],
    [196, 172, 70], [170, 144, 56], [222, 198, 92], [226, 110, 40], [196, 70, 34], [150, 46, 30],
    [150, 136, 124], [120, 108, 104], [180, 166, 150], [246, 244, 236], [216, 214, 210],
  ],
];
/** materials that make their own light in a biome (not graded by the time of day, never in shadow tone) */
export const biomeEmissive = (biome: number, mat: number): boolean => biome === 3 && mat >= 15 && mat <= 16;

export interface WorldOpts {
  /** map side in pixels, a power of two (default 2048) */
  size?: number;
  /** share of the map that is land, 0.02..0.9 (default 0.33) */
  land?: number;
  /** true: the map is divided into the five biomes (default false: all verdant, as every existing world) */
  biomes?: boolean;
  seed?: number;
  /** cloud map side, a power of two (default 1024) */
  cloudSize?: number;
}

export interface StackWorld {
  n: number;
  mask: number;
  shift: number;
  height: Uint8Array;
  mat: Uint8Array;
  /** tone of each column top (see TONES) */
  tone: Uint8Array;
  /** biome of each ground pixel (all 0 unless the world was built with `biomes`) */
  biome: Uint8Array;
  nc: number;
  cmask: number;
  cshift: number;
  /** (rank << 4) | thickness: a cloud shows when its rank is under the cover setting, so cover adds whole clouds */
  cloud: Uint8Array;
  /** 256 × 256 bytes of noise for water sparkle and foam */
  noise: Uint8Array;
  /** a start over open water next to land */
  spawnX: number;
  spawnY: number;
}

export const groundAt = (w: StackWorld, x: number, y: number): number => w.height[(((y | 0) & w.mask) << w.shift) | ((x | 0) & w.mask)];
export const matAt = (w: StackWorld, x: number, y: number): number => w.mat[(((y | 0) & w.mask) << w.shift) | ((x | 0) & w.mask)];

/** The tallest ground in a disc (sampled): what a gate, a pickup or a camera has to clear. */
export function groundMax(w: StackWorld, x: number, y: number, r: number): number {
  let top = groundAt(w, x, y);
  for (let ring = 1; ring <= 2; ring++) {
    for (let a = 0; a < 8; a++) {
      const h = groundAt(w, x + cos(a * 0.7854) * r * ring * 0.5, y + sin(a * 0.7854) * r * ring * 0.5);
      if (h > top) top = h;
    }
  }
  return top;
}

function log2(n: number, what: string): number {
  const s = Math.round(Math.log2(n));
  if (n < 64 || 1 << s !== n) {
    throw new Error(JSON.stringify({ error: 'size_not_power_of_two', message: `${what} must be a power of two ≥ 64 (the map wraps with a bit mask)`, actual: n, min: 64 }));
  }
  return s;
}

/** Tileable value noise, one octave added into `field`. */
function addOctave(field: Float32Array, n: number, cell: number, amp: number, rnd: Rng): void {
  const P = n / cell;
  const lat = new Float32Array(P * P);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const x0 = new Int32Array(n);
  const x1 = new Int32Array(n);
  const tx = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const g = x / cell;
    const i = Math.floor(g);
    const f = g - i;
    x0[x] = i % P;
    x1[x] = (i + 1) % P;
    tx[x] = f * f * (3 - 2 * f);
  }
  for (let y = 0; y < n; y++) {
    const ra = x0[y] * P;
    const rb = x1[y] * P;
    const ty = tx[y];
    const row = y * n;
    for (let x = 0; x < n; x++) {
      const a0 = lat[ra + x0[x]];
      const b0 = lat[rb + x0[x]];
      const va = a0 + (lat[ra + x1[x]] - a0) * tx[x];
      const vb = b0 + (lat[rb + x1[x]] - b0) * tx[x];
      field[row + x] += amp * (va + (vb - va) * ty);
    }
  }
}

/** An archipelago: terraced islands (grass → rock → snow), forests, beaches, and clusters of cloud puffs. */
export function buildIslands(opts: WorldOpts = {}): StackWorld {
  const n = opts.size ?? 2048;
  const nc = opts.cloudSize ?? 1024;
  const shift = log2(n, 'size');
  const cshift = log2(nc, 'cloudSize');
  const mask = n - 1;
  const cmask = nc - 1;
  const w: StackWorld = {
    n, mask, shift, height: new Uint8Array(n * n), mat: new Uint8Array(n * n), tone: new Uint8Array(n * n), biome: new Uint8Array(n * n),
    nc, cmask, cshift, cloud: new Uint8Array(nc * nc), noise: new Uint8Array(65536), spawnX: n / 2, spawnY: n / 2,
  };
  const rnd = mulberry32(((opts.seed ?? 7) | 0) * 7919 + 13);
  for (let i = 0; i < w.noise.length; i++) w.noise[i] = (rnd() * 256) | 0;

  // elevation: six octaves; the feature size is fixed in pixels, so a smaller map has fewer islands, not smaller ones
  const E = new Float32Array(n * n);
  const amps = [0.55, 1, 0.5, 0.25, 0.11, 0.05];
  for (let o = 0, cell = Math.min(512, n / 2); o < amps.length && cell >= 4; o++, cell /= 2) addOctave(E, n, cell, amps[o], rnd);
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < E.length; i++) {
    if (E[i] < mn) mn = E[i];
    if (E[i] > mx) mx = E[i];
  }
  const kk = 1 / (mx - mn || 1);
  for (let i = 0; i < E.length; i++) E[i] = (E[i] - mn) * kk;

  // sea level from the wanted share of land (a histogram, so `land` means what it says on every seed)
  const bins = new Uint32Array(1024);
  for (let o = 0; o < E.length; o++) bins[(E[o] * 1023) | 0]++;
  const target = (1 - clamp(opts.land ?? 0.33, 0.02, 0.9)) * E.length;
  let acc = 0;
  let sea = 1;
  for (let b = 0; b < 1024; b++) {
    acc += bins[b];
    if (acc >= target) { sea = (b + 1) / 1023; break; }
  }
  // biomes: two slow noise fields pick one of five regions; a per-pixel jitter dithers the borders
  if (opts.biomes) {
    const brnd = mulberry32(((opts.seed ?? 7) | 0) * 104729 + 71);
    const A = new Float32Array(n * n);
    const B = new Float32Array(n * n);
    addOctave(A, n, n / 4, 1, brnd);
    addOctave(A, n, n / 16, 0.3, brnd);
    addOctave(B, n, n / 4, 1, brnd);
    addOctave(B, n, n / 16, 0.3, brnd);
    // split each field at its own median (from a sample): a 4 × 4 lattice is far from centred on 0.5, and a fixed
    // threshold left one biome with 0.4 % of the map
    const mid = (f: Float32Array): number => {
      const sample: number[] = [];
      for (let o = 0; o < f.length; o += 97) sample.push(f[o]);
      sample.sort((x, y) => x - y);
      return sample[sample.length >> 1];
    };
    const ma = mid(A);
    const mb = mid(B);
    for (let o = 0; o < A.length; o++) {
      const j = (hash8(o * 7 + 3) - 128) * 0.0008;
      const a = A[o] - ma + j;
      const b = B[o] - mb + j;
      // a 2 × 2 split, with the verdant biome kept as a band along one border
      w.biome[o] = Math.abs(a) < 0.07 ? 0 : a < 0 ? (b < 0 ? 1 : 2) : b < 0 ? 3 : 4;
    }
  }
  const SAND = 0.012;
  const span = Math.max(0.05, 1 - sea - SAND);

  for (let y = 0; y < n; y++) {
    const row = y << shift;
    const rowNW = ((y - 2) & mask) << shift;
    const rowSE = ((y + 2) & mask) << shift;
    for (let x = 0; x < n; x++) {
      const o = row | x;
      const hs = hash8(o);
      const d = E[o] - sea;
      if (d < 0) {
        const dd = -d + (hs - 128) * 0.00004;
        w.mat[o] = dd > 0.07 ? 0 : dd > 0.03 ? 1 : dd > 0.008 ? 2 : 3;
        continue;
      }
      if (d < SAND) {
        w.mat[o] = hs < 34 ? 5 : 4;
        continue;
      }
      const bio = w.biome[o];
      // each biome reshapes the same relief: mesas are flat-topped steps, frost is low with sharp peaks, volcanoes
      // are steep cones
      let hr = (d - SAND) / span;
      if (bio === 1) hr = hr < 0.12 ? hr : hr < 0.5 ? 0.42 : 0.74;
      else if (bio === 2) hr = hr < 0.55 ? hr * 0.45 : 0.25 + (hr - 0.55) * 1.66;
      else if (bio === 3) hr = Math.min(0.999, hr * 1.35);
      // terraces: 8 grass levels (2 px each), 4 rock levels and the snow cap (3 px each). Flat steps with hard
      // edges are what the column renderer draws best — a smooth slope would be noise at this resolution.
      let lv = hr < 0.5 ? 1 + ((hr * 16) | 0) : hr < 0.78 ? 9 + (((hr - 0.5) / 0.07) | 0) : 13 + (((hr - 0.78) / 0.09) | 0);
      if (lv > 15) lv = 15;
      w.height[o] = lv <= 8 ? lv * 2 : 16 + (lv - 8) * 3;
      // baked light: the slope towards the sun picks the light or dark tone of the material
      const g = E[rowNW | ((x - 2) & mask)] - E[rowSE | ((x + 2) & mask)];
      const lit = g < -0.007;
      const shaded = g > 0.007;
      // a volcano's summit is a crater: it sinks, and its floor is the glowing vent
      if (bio === 3 && lv >= 14) w.height[o] -= 4;
      if (lv >= 13) w.mat[o] = shaded ? 16 : 15;
      else if (lv >= 9) w.mat[o] = lit ? 14 : shaded ? 13 : hs < 26 ? 13 : 12;
      else w.mat[o] = lit ? 8 : shaded ? 7 : hs < 22 ? 7 : hs > 240 ? 8 : 6;
    }
  }

  // forests: little cones of leaves on the grass
  for (let gy = 0; gy < n; gy += 5) {
    for (let gx = 0; gx < n; gx += 5) {
      const hs = hash8(gy * 977 + gx * 131 + 7);
      const cx = (gx + (hs & 3)) & mask;
      const cy = (gy + ((hs >> 2) & 3)) & mask;
      const o = (cy << shift) | cx;
      const m = w.mat[o];
      if (m < 6 || m > 8) continue;
      const h0 = w.height[o];
      if (h0 > 14) continue;
      const f = E[(((cy + 613) & mask) << shift) | ((n - 1 - cx + 911) & mask)];
      const pr = (f - sea) * 30;
      if (pr <= 0 || pr * 255 < hash8(o + 99)) continue;
      // woods are a verdant and harbour thing: a mesa keeps a few cacti, ash a few charred trunks, frost some pines
      // (the first open-map screenshot showed a red mesa buried under forest)
      const keep = [256, 30, 110, 40, 256][w.biome[o]]; // 256: never thinned (hash8 is 0..255)
      if (hash8(o * 3 + 17) >= keep) continue;
      const r = 2 + ((hs >> 4) & 1);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > r + 0.3) continue;
          const oo = (((cy + dy) & mask) << shift) | ((cx + dx) & mask);
          if (w.mat[oo] < WATER_MATS) continue;
          const nh = h0 + 1 + Math.round((1 - dist / (r + 0.5)) * (r + 1));
          if (nh > w.height[oo]) {
            w.height[oo] = Math.min(HMAX, nh);
            w.mat[oo] = dist < 1.1 ? 9 : dist < r - 0.5 ? 10 : 11;
          }
        }
      }
    }
  }

  // built things: hamlets of block houses on low grass, lighthouses and piers on the shore
  const at = (x: number, y: number): number => ((y & mask) << shift) | (x & mask);
  const flat = (x: number, y: number, r: number, lo: number, hi: number): number => {
    const h0 = w.height[at(x, y)];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const o = at(x + dx, y + dy);
      if (w.height[o] !== h0 || w.mat[o] < lo || w.mat[o] > hi) return -1;
    }
    return h0;
  };
  const area = (n * n) / (2048 * 2048);
  for (let v = 0; v < Math.round(240 * area); v++) {
    const vx = (rnd() * n) | 0;
    const vy = (rnd() * n) | 0;
    const houses = 3 + ((rnd() * 6) | 0);
    for (let k = 0; k < houses; k++) {
      const hx = vx + (((rnd() - 0.5) * 44) | 0);
      const hy = vy + (((rnd() - 0.5) * 44) | 0);
      const h0 = flat(hx, hy, 2, 6, 8);
      if (h0 < 2 || h0 > 14) continue;
      const wide = rnd() < 0.5;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if ((wide ? dy : dx) === 2 || (wide ? dy : dx) === -2) continue; // 5 × 3 footprint
        const o = at(hx + dx, hy + dy);
        // a ridge along the long side: the roof is two steps
        w.height[o] = h0 + 4 + ((wide ? dy : dx) === 0 ? 2 : 0);
        w.mat[o] = MAT_HOUSE;
      }
    }
  }
  // beaches are a thin band: sample until enough spots are found (bounded, so a map with no beach still ends)
  for (let v = 0, placed = 0; v < Math.round(40000 * area) && placed < Math.round(110 * area); v++) {
    const lx = (rnd() * n) | 0;
    const ly = (rnd() * n) | 0;
    if (w.mat[at(lx, ly)] !== 4) continue; // on a beach
    placed++;
    // one beach spot in five gets a lighthouse (more read as a fence of white pillars from the chase view)
    if (rnd() < 0.2) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const o = at(lx + dx, ly + dy);
        w.height[o] = 17;
        w.mat[o] = MAT_TOWER;
      }
      w.height[at(lx, ly)] = 20;
      w.mat[at(lx, ly)] = MAT_LAMP;
    } else {
      // a pier walks out over the nearest water
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (w.mat[at(lx + dx * 6, ly + dy * 6)] >= WATER_MATS) continue;
        for (let t = 1; t <= 16; t++) for (let s2 = 0; s2 < 2; s2++) {
          const o = at(lx + dx * t + dy * s2, ly + dy * t + dx * s2);
          if (w.mat[o] >= WATER_MATS && w.mat[o] !== 4 && w.mat[o] !== 5) break;
          w.height[o] = 1;
          w.mat[o] = MAT_PIER;
        }
        break;
      }
    }
  }

  // tones: light falls from the north-west (shadows are cast to +x, +y)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = (y << shift) | x;
      if (w.mat[o] < WATER_MATS) continue;
      const h = w.height[o];
      const hw = w.height[at(x - 1, y)];
      const hn = w.height[at(x, y - 1)];
      if (hw > h || hn > h) w.tone[o] = 2;
      else if (hw < h || hn < h) w.tone[o] = 1;
      // the checker is a ground texture: on rock and snow it read as noise in the first screenshots
      else if (w.mat[o] <= 8 && (((x >> 2) + (y >> 2)) & 1) === 1) w.tone[o] = 3;
    }
  }

  // a start over open water next to land
  let best = -1;
  for (let tries = 0; tries < 400; tries++) {
    const x = (rnd() * n) | 0;
    const y = (rnd() * n) | 0;
    if (w.mat[(y << shift) | x] > 2) continue;
    let near = 0;
    for (let a = 0; a < 8; a++) {
      if (matAt(w, x + cos(a * 0.785) * 120, y + sin(a * 0.785) * 120) >= WATER_MATS) near++;
    }
    if (near > best && near <= 5) { best = near; w.spawnX = x; w.spawnY = y; }
  }

  // clouds: clusters of round puffs
  const count = Math.round(200 * ((nc * nc) / (1024 * 1024)));
  for (let i = 0; i < count; i++) {
    const rank = i & 15;
    const cx = rnd() * nc;
    const cy = rnd() * nc;
    const sc = 0.6 + rnd() * rnd() * 1.25;
    const ang = 0.35 + (rnd() - 0.5) * 1.3;
    const len = (12 + rnd() * 24) * sc;
    const puffs = 4 + ((rnd() * 7) | 0);
    for (let q = 0; q < puffs; q++) {
      const t = (q / (puffs - 1)) * 2 - 1;
      const pxc = cx + cos(ang) * t * len + (rnd() - 0.5) * 9 * sc;
      const pyc = cy + sin(ang) * t * len + (rnd() - 0.5) * 9 * sc;
      const r = (6 + rnd() * 8) * sc * (1 - 0.45 * Math.abs(t));
      const maxT = clamp(Math.round(r * 0.6), 2, CLOUD_K);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d2 = (dx * dx + dy * dy) / (r * r);
          if (d2 > 1) continue;
          const tk = Math.max(1, Math.round(Math.sqrt(1 - d2) * maxT));
          const oo = (((Math.round(pyc) + dy) & cmask) << cshift) | ((Math.round(pxc) + dx) & cmask);
          if (tk > (w.cloud[oo] & 15)) w.cloud[oo] = (rank << 4) | tk;
        }
      }
    }
  }
  return w;
}
