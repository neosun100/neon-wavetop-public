/* GENERATED from gameforge/src/harness-fast.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/**
 * Fast tuning (opt-in; forge verify 00 §4): the bisection a game's `--tune` runs today, with fewer reference runs.
 * Nothing here is used unless a game's tune CLI asks for it; `src/harness.ts` and every game's `bisect` are untouched.
 *
 * The cold method (GRAZE `scripts/sectors.ts` `bisect`): `steps` midpoints on [lo, hi], each probe plays all N
 * reference seeds, `share >= target` ⇒ go harder (lo = mid); the probe whose share is closest to the target wins,
 * ties → the larger P. Three accelerations, each switched on separately:
 *
 *  - `early: 'exact'` — curtailment. A probe only has to decide its branch, so it stops as soon as the remaining seeds
 *    cannot change it (`curtailed`). The final pick completes only the probes that can still be the closest one
 *    (branch-and-bound). ⇒ the same P as the cold method, bit for bit (T-T1), on any data.
 *  - `early: { hyper: α }` — stop when the hypergeometric posterior of the minority branch is < α (`hyperStop`). Stated
 *    error rate = `hyperError` (exact, computed by dynamic programming, not α: the uniform prior is not calibrated at
 *    the boundary); `calibrateAlpha` picks α for a target error. The game's unchanged full `--check` still runs after
 *    every tune, so a statistical tune can give a worse P, never a false green.
 *  - `warm: { P0, r }` — bracket [P0/(1+r), P0·(1+r)] around the stored P*, doubled outward (r ← 2r+1) until it
 *    straddles the target or reaches [lo, hi]; then enough steps for the cold method's final resolution. A different
 *    probe set ⇒ not bit-identical to cold; worth it only for small data changes (00 §4.1: ≤ 20 % on its own).
 *
 * Zero imports on purpose: `scripts/verify/tune-replay.ts` loads this file under Node's type stripping (GameForge has
 * no tsx), which cannot resolve extension-less imports. Keep it that way (erasable TypeScript only, no imports).
 */

/** One probe as the cold method reports it (same shape as a game's `Probe`). `share` is x/n (exact when n = N). */
export interface Probe {
  P: number;
  share: number;
}

export interface FastProbe extends Probe {
  /** successes / seeds played / seeds of a full probe */
  x: number;
  n: number;
  N: number;
  branch: 'ge' | 'lt';
  /** what ended the branch decision: all seeds, exact curtailment, or the statistical rule */
  stop: 'full' | 'curtailed' | 'hyper';
  role: 'bisect' | 'warm';
  /** per-seed needs in seed order (only the n played) */
  needs: number[];
}

/** `(P, seeds) → needs`, one need per seed, Infinity = never cleared. Called in batches. */
export type ProbeFn = (P: number, seeds: number[]) => Promise<readonly number[]> | readonly number[];

export interface FastOptions {
  /** a seed counts as a success when need ≤ limit (the game's `share(needs, lives)`) */
  limit: number;
  /** count n (seeds 1…n) or the explicit seed list in play order */
  seeds: number | readonly number[];
  lo: number;
  hi: number;
  /** cold steps; with `warm`, the cold resolution (hi − lo) / 2^steps is kept */
  steps: number;
  warm?: { P0: number; r: number };
  early?: 'exact' | { hyper: number };
  /** seeds per ProbeFn call when `early` is set (default 4); without `early` a probe is one call of all seeds */
  batch?: number;
}

export interface FastResult {
  P: number;
  tried: FastProbe[];
  /** reference runs actually played */
  runs: number;
  /** runs the cold method plays for the same tune (steps × N) */
  coldRuns: number;
  /** any probe with share ≥ target (false = the target is unreachable on [lo, hi], as the cold method also shows) */
  reachable: boolean;
  /** bisection steps actually run (cold: steps; warm: from the bracket) */
  steps: number;
}

const range1 = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** Smallest success count k with k / N ≥ target (the cold branch `share >= target`, in the same float arithmetic);
 *  N + 1 when no count reaches it. */
export function kNeeded(N: number, target: number): number {
  for (let k = 0; k <= N; k++) if (k / N >= target) return k;
  return N + 1;
}

/** Exact curtailment: x successes in n of N seeds. 'ge' / 'lt' once the remaining N − n seeds cannot change
 *  the branch, else null. Always decides at n = N. */
export function curtailed(x: number, n: number, N: number, target: number): 'ge' | 'lt' | null {
  const K = kNeeded(N, target);
  if (x >= K) return 'ge';
  if (n - x > N - K) return 'lt';
  return null;
}

const pascal = new Map<number, number[][]>();
/** C(a, b) for a, b ≤ N as doubles (C(48, 24) ≈ 3.2e13 is exact; products are used as relative weights only). */
function comb(N: number): (a: number, b: number) => number {
  let t = pascal.get(N);
  if (!t) {
    t = [[1]];
    for (let a = 1; a <= N; a++) {
      const row = [1];
      for (let b = 1; b < a; b++) row.push(t[a - 1][b - 1] + t[a - 1][b]);
      row.push(1);
      t.push(row);
    }
    pascal.set(N, t);
  }
  const T = t;
  return (a, b) => (b < 0 || b > a ? 0 : T[a][b]);
}

/** Posterior P(S ≥ K) over the full-N success count S, uniform prior, given x successes in n seeds drawn without
 *  replacement. */
export function posteriorGe(x: number, n: number, N: number, K: number): number {
  const C = comb(N);
  let ge = 0;
  let tot = 0;
  for (let S = x; S <= x + (N - n); S++) {
    const w = C(S, x) * C(N - S, n - x);
    tot += w;
    if (S >= K) ge += w;
  }
  return ge / tot;
}

/** Statistical early stop: the exact rule first; otherwise stop when the minority branch has posterior < alpha. */
export function hyperStop(x: number, n: number, N: number, target: number, alpha: number): 'ge' | 'lt' | null {
  const c = curtailed(x, n, N, target);
  if (c) return c;
  const pge = posteriorGe(x, n, N, kNeeded(N, target));
  if (pge < alpha) return 'lt';
  if (1 - pge < alpha) return 'ge';
  return null;
}

export interface HyperErr {
  /** worst per-decision error over every true success count S, and the S where it occurs */
  worst: number;
  worstS: number;
  /** per S: P(wrong branch), expected share of the N seeds played */
  byS: Array<{ S: number; wrong: number; used: number }>;
}

/**
 * Exact error rate of the stopping rule with batches of `batch` seeds in a random order (all orders equally likely),
 * for every true count S: dynamic programming over (seeds played, successes), multivariate hypergeometric batch
 * draws. `alpha = 0` is the exact rule (error 0). This number — not α — is the stated error rate.
 */
export function hyperError(N: number, target: number, alpha: number, batch = 4): HyperErr {
  const C = comb(N);
  const K = kNeeded(N, target);
  const rule = (x: number, n: number) => (alpha > 0 ? hyperStop(x, n, N, target, alpha) : curtailed(x, n, N, target));
  const byS: HyperErr['byS'] = [];
  for (let S = 0; S <= N; S++) {
    let dist = new Map<number, number>([[0, 1]]);
    let wrong = 0;
    let used = 0;
    for (let n = 0; dist.size; ) {
      const nextDist = new Map<number, number>();
      const m = Math.min(batch, N - n);
      for (const [x, p] of dist) {
        const d = rule(x, n);
        // a sound rule decides once all N seeds are played; without this a broken rule would loop forever here
        if (!d && n >= N) throw new Error(`stopping rule undecided after all ${N} seeds (x ${x}, target ${target})`);
        if (d) {
          if ((d === 'ge') !== S >= K) wrong += p;
          used += (p * n) / N;
          continue;
        }
        const succ = S - x;
        const fail = N - S - (n - x);
        const den = C(N - n, m);
        for (let j = 0; j <= m; j++) {
          const q = (C(succ, j) * C(fail, m - j)) / den;
          if (q > 0) nextDist.set(x + j, (nextDist.get(x + j) ?? 0) + p * q);
        }
      }
      dist = nextDist;
      n += m;
    }
    byS.push({ S, wrong, used });
  }
  const w = byS.reduce((a, b) => (b.wrong > a.wrong ? b : a));
  return { worst: w.wrong, worstS: w.S, byS };
}

/** α grid searched by `calibrateAlpha`, largest first. */
export const ALPHA_GRID = [0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 5e-4, 2e-4, 1e-4, 5e-5, 2e-5, 1e-5] as const;

/** Largest α on ALPHA_GRID whose exact worst per-decision error is ≤ maxErr; 0 (= the exact rule) if none is. */
export function calibrateAlpha(N: number, target: number, maxErr: number, batch = 4): { alpha: number; worst: number } {
  for (const a of ALPHA_GRID) {
    const e = hyperError(N, target, a, batch).worst;
    if (e <= maxErr) return { alpha: a, worst: e };
  }
  return { alpha: 0, worst: 0 };
}

/**
 * Warm-start bracket around P0, clamped to [lo, hi], and the bisection steps that reach resolution `res` (the cold
 * method's (hi − lo) / 2^steps). Pure; `bisectFast` probes the ends and widens with r ← 2r + 1.
 */
export function warmBracket(P0: number, r: number, lo: number, hi: number, res: number): { lo: number; hi: number; steps: number } {
  if (!(P0 > 0) || !(r >= 0) || !(res > 0)) throw new Error(`warmBracket: need P0 > 0, r ≥ 0, res > 0 (got P0 ${P0}, r ${r}, res ${res})`);
  const a = Math.max(lo, Math.min(hi, P0 / (1 + r)));
  const b = Math.min(hi, Math.max(lo, P0 * (1 + r)));
  return { lo: a, hi: b, steps: stepsFor(b - a, res) };
}

const stepsFor = (width: number, res: number) => (width <= res ? 0 : Math.ceil(Math.log2(width / res)));

/** Distance bounds of a probe's final share from the target, before it is complete. */
function bounds(p: FastProbe, target: number): { dmin: number; dmax: number } {
  const a = p.x / p.N;
  const b = (p.x + p.N - p.n) / p.N;
  const da = Math.abs(a - target);
  const db = Math.abs(b - target);
  return { dmin: target >= a && target <= b ? 0 : Math.min(da, db), dmax: Math.max(da, db) };
}

/** The cold method's pick on complete probes: closest share to the target, ties → larger P. */
const closest = (ps: FastProbe[], target: number) => [...ps].sort((a, b) => Math.abs(a.share - target) - Math.abs(b.share - target) || b.P - a.P)[0];

export async function bisectFast(shareAt: ProbeFn, target: number, o: FastOptions): Promise<FastResult> {
  const seeds = typeof o.seeds === 'number' ? range1(o.seeds) : [...o.seeds];
  const N = seeds.length;
  if (!N) throw new Error('bisectFast: no seeds');
  const batch = Math.max(1, o.batch ?? 4);
  const early = o.early;
  const rule = early === undefined ? null : early === 'exact' ? (x: number, n: number) => curtailed(x, n, N, target) : (x: number, n: number) => hyperStop(x, n, N, target, early.hyper);
  const tried: FastProbe[] = [];
  let runs = 0;

  const play = async (p: FastProbe, upto: number) => {
    const s = seeds.slice(p.n, upto);
    const needs = await shareAt(p.P, s);
    if (needs.length !== s.length) throw new Error(`ProbeFn returned ${needs.length} needs for ${s.length} seeds at P ${p.P}`);
    for (const v of needs) {
      p.needs.push(v);
      if (v <= o.limit) p.x++;
    }
    p.n = upto;
    p.share = p.x / p.n;
    runs += s.length;
  };

  /** Probe P and return its branch (true = share ≥ target). */
  const decide = async (P: number, role: FastProbe['role']): Promise<boolean> => {
    const p: FastProbe = { P, share: NaN, x: 0, n: 0, N, branch: 'lt', stop: 'full', role, needs: [] };
    tried.push(p);
    if (!rule) {
      await play(p, N);
      p.branch = p.x / N >= target ? 'ge' : 'lt';
      return p.branch === 'ge';
    }
    for (;;) {
      const d = rule(p.x, p.n);
      if (d) {
        p.branch = d;
        p.stop = p.n === N ? 'full' : curtailed(p.x, p.n, N, target) ? 'curtailed' : 'hyper';
        return d === 'ge';
      }
      // a sound rule always decides once every seed is played; reaching here is a broken rule, never a silent pass
      if (p.n >= N) throw new Error(`stopping rule undecided after all ${N} seeds (x ${p.x}, target ${target})`);
      await play(p, Math.min(N, p.n + batch));
    }
  };

  let L = o.lo;
  let U = o.hi;
  let steps = o.steps;
  if (o.warm) {
    const res = (o.hi - o.lo) / 2 ** o.steps;
    const P0 = Math.max(o.lo, Math.min(o.hi, o.warm.P0));
    const start = warmBracket(P0, o.warm.r, o.lo, o.hi, res);
    // low end: must pass (share ≥ target); a failing end is a known upper bound and the bracket widens downward.
    // An end clamped to lo / hi is not played: the cold method assumes lo passes and hi fails in the same way.
    let a = start.lo;
    let r = o.warm.r;
    let lowFailed = false;
    while (a > o.lo) {
      if (await decide(a, 'warm')) {
        L = a;
        break;
      }
      lowFailed = true;
      U = a;
      r = 2 * r + 1;
      a = Math.max(o.lo, P0 / (1 + r));
    }
    if (!lowFailed) {
      let b = start.hi;
      r = o.warm.r;
      while (b < o.hi) {
        if (!(await decide(b, 'warm'))) {
          U = b;
          break;
        }
        L = b;
        r = 2 * r + 1;
        b = Math.min(o.hi, P0 * (1 + r));
      }
    }
    steps = stepsFor(U - L, res);
  }
  for (let s = 0; s < steps; s++) {
    const mid = (L + U) / 2;
    if (await decide(mid, 'bisect')) L = mid;
    else U = mid;
  }
  if (!tried.length) throw new Error(`bisectFast: no probe was played (bracket [${L}, ${U}], ${steps} steps)`);

  // final pick: play on only the probes that can still be the closest (branch-and-bound); identical to the cold
  // pick because a dropped probe's best possible distance is already worse than some probe's worst.
  for (;;) {
    const bs = tried.map((p) => bounds(p, target));
    const ub = Math.min(...bs.map((b) => b.dmax));
    const open = tried
      .map((p, i) => ({ p, b: bs[i] }))
      .filter(({ p, b }) => b.dmin <= ub && p.n < N)
      .sort((u, v) => u.b.dmin - v.b.dmin || v.p.P - u.p.P);
    if (!open.length) break;
    // one batch at a time: a partly played probe often leaves the race before it is complete (a statistical stop at
    // 4 seeds has a share interval that still contains the target; 4 more seeds usually rule it out)
    await play(open[0].p, Math.min(N, open[0].p.n + batch));
  }
  const ub = Math.min(...tried.map((p) => bounds(p, target).dmax));
  const done = tried.filter((p) => p.n === N && bounds(p, target).dmin <= ub);
  const best = closest(done, target);
  return { P: best.P, tried, runs, coldRuns: o.steps * N, reachable: tried.some((p) => p.branch === 'ge'), steps };
}

// ───────────────────────────── replay on recorded needs (00 §4.3) ─────────────────────────────

/** mulberry32, value-for-value the sequence of `src/rng.ts` (`tests/harness-fast.test.ts` pins it). Copied, not
 *  imported, because this file must have no imports (header). The authority is `src/rng.ts`. */
export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded generator. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const r = mulberry(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A sector's recorded probes (`--record-needs`): JSON cannot carry Infinity, so a never-cleared seed is null. */
export interface SectorRecord {
  target: number;
  limit: number;
  lo: number;
  hi: number;
  steps: number;
  seeds: number[];
  /** the stored P* before this tune (warm start) and the P* the recorded cold tune chose */
  P0?: number;
  Pstar?: number;
  probes: Array<{ P: number; needs: Array<number | null> }>;
}

export interface NeedsRecord {
  version: 1;
  source?: string;
  sectors: Record<string, SectorRecord>;
}

/** A probe at a P that the record never played. */
export class ReplayMiss extends Error {
  readonly P: number;
  constructor(P: number) {
    super(`no recorded needs at P ${P}`);
    this.P = P;
  }
}

/** ProbeFn answered from a record (P matched exactly: bisection midpoints are reproducible floats). */
export function recordedProbe(rec: SectorRecord): ProbeFn {
  const at = new Map<number, Map<number, number>>();
  for (const p of rec.probes) {
    const m = at.get(p.P) ?? new Map<number, number>();
    p.needs.forEach((v, i) => m.set(rec.seeds[i], v === null ? Infinity : v));
    at.set(p.P, m);
  }
  return (P, seeds) => {
    const m = at.get(P);
    if (!m) throw new ReplayMiss(P);
    return seeds.map((s) => {
      const v = m.get(s);
      if (v === undefined) throw new ReplayMiss(P);
      return v;
    });
  };
}

export interface ReplayOptions {
  /** hyper: random seed orders replayed (00 §4.3: 1,000) and the worst per-decision error α is calibrated to */
  orders: number;
  maxErr: number;
  batch: number;
  /** warm start r (needs `P0` in the record); undefined = skip */
  warm?: number;
  /** seed of the order shuffles */
  seed: number;
}

export interface SectorReplay {
  key: string;
  target: number;
  N: number;
  recorded: number | null;
  cold: { P: number; runs: number; matchesRecord: boolean | null };
  exact: { P: number; runs: number; identical: boolean; saving: number };
  hyper: {
    alpha: number;
    statedErr: number;
    orders: number;
    pathIdentical: number;
    pIdentical: number;
    /** orders that left the recorded probe set (path diverged early; needs a live run to resolve) */
    unresolved: number;
    meanRuns: number;
    saving: number;
    /** resolved orders with a different P: worst |share(P) − share(cold P)| in seeds (00 §4.3 tolerance: ≤ 1) */
    worstGapSeeds: number;
    accept: boolean;
  };
  warm: { r: number; P: number; runs: number; identical: boolean } | { r: number; unresolved: number } | null;
}

const pathOf = (r: FastResult) => r.tried.filter((p) => p.role === 'bisect').map((p) => `${p.P}:${p.branch}`).join(' ');

export async function replaySector(key: string, rec: SectorRecord, o: ReplayOptions): Promise<SectorReplay> {
  const fn = recordedProbe(rec);
  const base = { limit: rec.limit, lo: rec.lo, hi: rec.hi, steps: rec.steps, batch: o.batch };
  const N = rec.seeds.length;
  const cold = await bisectFast(fn, rec.target, { ...base, seeds: rec.seeds });
  const exact = await bisectFast(fn, rec.target, { ...base, seeds: rec.seeds, early: 'exact' });
  const cal = calibrateAlpha(N, rec.target, o.maxErr, o.batch);
  const shareAt = (P: number) => {
    const p = cold.tried.find((t) => t.P === P);
    return p ? p.x : NaN;
  };
  let pathSame = 0;
  let pSame = 0;
  let unresolved = 0;
  let runSum = 0;
  let resolved = 0;
  let worstGap = 0;
  const coldPath = pathOf(cold);
  for (let i = 0; i < o.orders; i++) {
    const order = shuffled(rec.seeds, o.seed + i);
    try {
      const h = await bisectFast(fn, rec.target, { ...base, seeds: order, early: { hyper: cal.alpha } });
      resolved++;
      runSum += h.runs;
      if (pathOf(h) === coldPath) pathSame++;
      if (h.P === cold.P) pSame++;
      else worstGap = Math.max(worstGap, Math.abs(shareAt(h.P) - shareAt(cold.P)));
    } catch (e) {
      if (!(e instanceof ReplayMiss)) throw e;
      unresolved++;
    }
  }
  let warm: SectorReplay['warm'] = null;
  if (o.warm !== undefined && rec.P0 !== undefined) {
    try {
      const w = await bisectFast(fn, rec.target, { ...base, seeds: rec.seeds, early: 'exact', warm: { P0: rec.P0, r: o.warm } });
      warm = { r: o.warm, P: w.P, runs: w.runs, identical: w.P === cold.P };
    } catch (e) {
      if (!(e instanceof ReplayMiss)) throw e;
      warm = { r: o.warm, unresolved: 1 };
    }
  }
  const meanRuns = resolved ? runSum / resolved : NaN;
  return {
    key,
    target: rec.target,
    N,
    recorded: rec.Pstar ?? null,
    cold: { P: cold.P, runs: cold.runs, matchesRecord: rec.Pstar === undefined ? null : rec.Pstar === cold.P },
    exact: { P: exact.P, runs: exact.runs, identical: exact.P === cold.P, saving: 1 - exact.runs / cold.runs },
    hyper: {
      alpha: cal.alpha,
      statedErr: cal.worst,
      orders: o.orders,
      pathIdentical: pathSame,
      pIdentical: pSame,
      unresolved,
      meanRuns,
      saving: 1 - meanRuns / cold.runs,
      worstGapSeeds: worstGap,
      // 00 §4.3 step 3: path identical in ≥ 90 % of orders; where it differs the share stays within 1 seed.
      // An unresolved order counts as "not identical" (it diverged) and its gap is unknown ⇒ it cannot help accept.
      accept: pathSame >= 0.9 * o.orders && worstGap <= 1,
    },
    warm,
  };
}

export interface ReplayReport {
  sectors: SectorReplay[];
  /** red rows: the record disagrees with its own cold replay, or exact differs from cold (T-T1 on real data) */
  red: string[];
  totals: { coldRuns: number; exactRuns: number; exactSaving: number; hyperRuns: number; hyperSaving: number };
}

/** The red rows of a replay: the record is not its own cold tune, or exact ≠ cold (T-T1 on real data). */
export function redRows(sectors: readonly Pick<SectorReplay, 'key' | 'recorded' | 'cold' | 'exact'>[]): string[] {
  const red: string[] = [];
  for (const s of sectors) {
    if (s.cold.matchesRecord === false) red.push(`${s.key}: cold replay P ${s.cold.P} ≠ recorded P* ${s.recorded} (the record is not a cold tune)`);
    if (!s.exact.identical) red.push(`${s.key}: exact P ${s.exact.P} ≠ cold P ${s.cold.P}`);
  }
  return red;
}

export async function replayRecord(rec: NeedsRecord, o: ReplayOptions): Promise<ReplayReport> {
  if (rec.version !== 1) throw new Error(`needs record version ${String(rec.version)} (expected 1)`);
  const sectors: SectorReplay[] = [];
  for (const [k, s] of Object.entries(rec.sectors)) sectors.push(await replaySector(k, s, o));
  const red = redRows(sectors);
  const sum = (f: (s: SectorReplay) => number) => sectors.reduce((a, s) => a + f(s), 0);
  const coldRuns = sum((s) => s.cold.runs);
  const exactRuns = sum((s) => s.exact.runs);
  const hyperRuns = sum((s) => (Number.isFinite(s.hyper.meanRuns) ? s.hyper.meanRuns : s.cold.runs));
  return { sectors, red, totals: { coldRuns, exactRuns, exactSaving: 1 - exactRuns / coldRuns, hyperRuns, hyperSaving: 1 - hyperRuns / coldRuns } };
}

export function renderReplay(r: ReplayReport): string {
  const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : 'n/a');
  const lines = ['| sector | target | cold P (runs) | exact runs, saving, same P | hyper α (stated err) | hyper path same / P same / unresolved | hyper saving | worst gap | warm |', '|---|---|---|---|---|---|---|---|---|'];
  for (const s of r.sectors) {
    const h = s.hyper;
    const w = s.warm === null ? '—' : 'P' in s.warm ? `r ${s.warm.r}: ${s.warm.runs} runs, ${s.warm.identical ? 'same P' : `P ${s.warm.P}`}` : `r ${s.warm.r}: off the record (live run needed)`;
    lines.push(
      `| ${s.key} | ${s.target.toFixed(3)} | ${s.cold.P} (${s.cold.runs})${s.cold.matchesRecord === false ? ' ✗ record' : ''} | ${s.exact.runs}, ${pct(s.exact.saving)}, ${s.exact.identical ? 'yes' : '**NO**'} | ${h.alpha} (${pct(h.statedErr)}) | ${h.pathIdentical} / ${h.pIdentical} / ${h.unresolved} of ${h.orders} | ${pct(h.saving)} | ${h.worstGapSeeds} seed(s) ${h.accept ? 'accept' : 'not accepted'} | ${w} |`,
    );
  }
  const t = r.totals;
  lines.push('', `total runs: cold ${t.coldRuns} · exact ${t.exactRuns} (${pct(t.exactSaving)} fewer) · hyper ≈ ${t.hyperRuns.toFixed(0)} (${pct(t.hyperSaving)} fewer)`);
  lines.push(r.red.length ? `RED:\n${r.red.map((x) => `  ✗ ${x}`).join('\n')}` : 'exact = cold on every sector (bit for bit)');
  return lines.join('\n');
}
