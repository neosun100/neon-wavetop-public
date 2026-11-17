/* GENERATED from gameforge/src/grid.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Uniform CSR spatial grid (broadphase), generalised from NEON GRAZE v0.1's autopilot futures grid
 *  (`src/ai/autopilot.ts` `futures()` / `probe()`), so the sim's collision and the AI's futures share one
 *  implementation (GRAZE 2.0 study 02 D5).
 *
 *  Layout: the field [0, width) × [0, height) is cut into `cell`-sized cells, plus `pad` cells on every side.
 *  A point outside the padded area is clamped into the outermost cell, so nothing is ever dropped — a far-away
 *  point is only a far candidate. `build` is a counting sort: `start[c] … start[c + 1]` indexes `items`, and
 *  `items` holds the caller's point indices, in index order within each cell. Buffers are reused across builds
 *  (no allocation per tick once the capacity is reached).
 *
 *  Pure integer / float arithmetic (`Math.floor`, `min`, `max`): deterministic, allowed in `src/core`. */
export interface GridOptions {
  /** cell edge in world units (v0.1 autopilot: 32) */
  cell: number;
  /** field size the grid covers */
  width: number;
  height: number;
  /** extra cells on each side (v0.1 autopilot: 1) */
  pad?: number;
}

export class Grid {
  readonly cell: number;
  readonly pad: number;
  /** columns and rows incl. padding */
  readonly gx: number;
  readonly gy: number;
  /** CSR row pointer, length gx·gy + 1 */
  readonly start: Int32Array;
  /** point indices, valid in [0, n) */
  items: Int32Array;
  /** points in the last build */
  n = 0;
  private cells: Int32Array;
  private fill: Int32Array;

  constructor(o: GridOptions) {
    if (!(o.cell > 0) || !(o.width > 0) || !(o.height > 0)) throw new Error(`Grid: cell, width, height must be > 0 (got ${o.cell}, ${o.width}, ${o.height})`);
    this.cell = o.cell;
    this.pad = o.pad ?? 1;
    this.gx = Math.ceil(o.width / o.cell) + 2 * this.pad;
    this.gy = Math.ceil(o.height / o.cell) + 2 * this.pad;
    this.start = new Int32Array(this.gx * this.gy + 1);
    this.fill = new Int32Array(this.gx * this.gy);
    this.items = new Int32Array(64);
    this.cells = new Int32Array(64);
  }

  col(x: number): number {
    return Math.min(this.gx - 1, Math.max(0, Math.floor(x / this.cell) + this.pad));
  }
  row(y: number): number {
    return Math.min(this.gy - 1, Math.max(0, Math.floor(y / this.cell) + this.pad));
  }
  /** linear cell index of a point (clamped) */
  cellOf(x: number, y: number): number {
    return this.row(y) * this.gx + this.col(x);
  }

  /** Bucket points 0 … n−1 (counting sort). xs / ys are read, never kept. */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number = xs.length): this {
    if (n > this.items.length) {
      let cap = this.items.length;
      while (cap < n) cap *= 2;
      this.items = new Int32Array(cap);
      this.cells = new Int32Array(cap);
    }
    const { start, cells, fill, items } = this;
    const nc = this.gx * this.gy;
    start.fill(0);
    for (let i = 0; i < n; i++) start[(cells[i] = this.cellOf(xs[i], ys[i])) + 1]++;
    for (let c = 0; c < nc; c++) start[c + 1] += start[c];
    fill.set(start.subarray(0, nc));
    for (let i = 0; i < n; i++) items[fill[cells[i]]++] = i;
    this.n = n;
    return this;
  }

  /** Visit every point in the cells overlapping the rectangle [x0, x1] × [y0, y1] (row-major, index order
   *  within a cell). A superset of the points inside the rectangle: the caller does the exact test.
   *  `visit` returning `true` stops the query early. */
  rect(x0: number, y0: number, x1: number, y1: number, visit: (i: number) => boolean | void): void {
    const c0 = this.col(Math.min(x0, x1));
    const c1 = this.col(Math.max(x0, x1));
    const r0 = this.row(Math.min(y0, y1));
    const r1 = this.row(Math.max(y0, y1));
    const { start, items, gx } = this;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const k = r * gx + c;
        for (let j = start[k]; j < start[k + 1]; j++) if (visit(items[j]) === true) return;
      }
  }

  /** Points within `radius` of (x, y) are all visited (superset; exact test is the caller's). */
  query(x: number, y: number, radius: number, visit: (i: number) => boolean | void): void {
    this.rect(x - radius, y - radius, x + radius, y + radius, visit);
  }

  /** The 3×3 cells around the point's cell, clamped per axis — the v0.1 autopilot `probe` neighbourhood.
   *  Every point closer than one `cell` is visited. */
  near(x: number, y: number, visit: (i: number) => boolean | void): void {
    const cx = this.col(x);
    const cy = this.row(y);
    const { start, items, gx, gy } = this;
    for (let r = cy - 1; r <= cy + 1; r++) {
      if (r < 0 || r >= gy) continue;
      for (let c = cx - 1; c <= cx + 1; c++) {
        if (c < 0 || c >= gx) continue;
        const k = r * gx + c;
        for (let j = start[k]; j < start[k + 1]; j++) if (visit(items[j]) === true) return;
      }
    }
  }
}
