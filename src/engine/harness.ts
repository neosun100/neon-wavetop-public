/* GENERATED from gameforge/src/harness.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/**
 * Level harness core: turn "how much of a resource did each seed need" into a tuned limit per
 * level, and gate the result. Shared by every neon game with designed levels.
 *
 * The game supplies `measure(n, limit)`: play the level once per seed with the reference player
 * and with the AI, on an UNLIMITED budget while showing the player the candidate `limit`, and
 * report what each seed needed (Infinity = never cleared). One play per seed gives the whole
 * win-rate-against-limit curve, so tuning needs no bisection. The resource can be seconds, moves,
 * shots — anything where "more is easier".
 *
 * Difficulty is always set by the REFERENCE player (a casual-human stand-in), never by the AI:
 * tuning to the AI would make the game harder for people every time the AI improved.
 */
import { createHash } from 'node:crypto';

export interface Measured {
  ai: number[];
  ref: number[];
  /** worst ms per AI decision */
  ms: number;
  /** no-move / stall states seen (must be 0) */
  stalls: number;
}

export interface HarnessLimits {
  /** smallest / largest limit the tuner may choose */
  min: number;
  max: number;
  /** --check: the reference player's win rate may drift this far from the target */
  tolerance: number;
  /** per group, the reference player must need at least this much more than the AI */
  minRatio: number;
  /** ms per AI decision */
  maxMs: number;
}

export interface LevelRow {
  n: number;
  limit: number;
  target: number;
  /** win rates at the limit */
  ai: number;
  ref: number;
  ms: number;
  stalls: number;
  /** median need (a seed never cleared counts as 2 × max) */
  needAi: number;
  needRef: number;
}

/** Smallest whole unit at which `rate` of the needs are met, clamped to [min, max]. */
export function limitFor(needs: number[], rate: number, lim: Pick<HarnessLimits, 'min' | 'max'>): number {
  const sorted = [...needs].sort((a, b) => a - b);
  const k = Math.max(0, Math.ceil(rate * sorted.length) - 1);
  const v = sorted[k];
  return Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, Math.ceil(v))) : lim.max;
}

export const share = (needs: number[], limit: number) => needs.filter((x) => x <= limit).length / needs.length;

export function median(needs: number[], cap: number): number {
  const s = needs.map((x) => (Number.isFinite(x) ? x : cap)).sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Geometric mean of (reference need / AI need): "how many times more the reference needs". */
export const needRatio = (rows: LevelRow[]) => Math.exp(rows.reduce((a, r) => a + Math.log(r.needRef / r.needAi), 0) / rows.length);

function row(n: number, limit: number, target: number, m: Measured, lim: HarnessLimits): LevelRow {
  return { n, limit, target, ai: share(m.ai, limit), ref: share(m.ref, limit), ms: m.ms, stalls: m.stalls, needAi: median(m.ai, 2 * lim.max), needRef: median(m.ref, 2 * lim.max) };
}

/** Two passes: measure under the current limit, re-measure under the new one (players read the budget). */
export function tuneLevel(n: number, target: number, start: number, measure: (n: number, limit: number) => Measured, lim: HarnessLimits): LevelRow {
  let limit = start;
  let m = measure(n, limit);
  limit = limitFor(m.ref, target, lim);
  m = measure(n, limit);
  limit = limitFor(m.ref, target, lim);
  return row(n, limit, target, m, lim);
}

export function checkLevel(n: number, target: number, limit: number, measure: (n: number, limit: number) => Measured, lim: HarnessLimits): LevelRow {
  return row(n, limit, target, measure(n, limit), lim);
}

/**
 * The gate. `groupOf(n)` maps a level to its group (chapter); a group is judged only when all
 * `groupSize` of its levels are in `rows`. Returns the failures (empty = pass).
 */
export function gate(rows: LevelRow[], mode: 'tune' | 'check', lim: HarnessLimits, groupOf: (n: number) => number, groupSize: number, unit: string, label = (g: number) => `chapter ${g + 1}`): string[] {
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  const fails: string[] = [];
  for (const r of rows) {
    if (r.stalls) fails.push(`level ${r.n}: ${r.stalls} no-move states (must be 0)`);
    if (r.ms > lim.maxMs) fails.push(`level ${r.n}: ${r.ms.toFixed(1)} ms per decision > ${lim.maxMs}`);
    if (mode === 'check' && Math.abs(r.ref - r.target) > lim.tolerance) fails.push(`level ${r.n}: reference player clears ${pct(r.ref)}, target ${pct(r.target)} (tolerance ${pct(lim.tolerance)}) — re-tune`);
    if (r.limit >= lim.max && r.ref < r.target) fails.push(`level ${r.n}: unreachable target even at ${lim.max}${unit} — the level is too hard`);
  }
  const groups = new Map<number, LevelRow[]>();
  for (const r of rows) groups.set(groupOf(r.n), [...(groups.get(groupOf(r.n)) ?? []), r]);
  for (const [g, rs] of groups) {
    if (rs.length < groupSize) continue;
    const ratio = needRatio(rs);
    if (ratio < lim.minRatio) fails.push(`${label(g)}: the reference player needs only ×${ratio.toFixed(2)} the AI's ${unit.trim() || 'budget'} (gate ×${lim.minRatio})`);
  }
  return fails;
}

/** Fingerprint of the DATA tuning depends on (code changes are caught by the replay in --check). */
export const fingerprint = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
