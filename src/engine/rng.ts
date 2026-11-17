/* GENERATED from gameforge/src/rng.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Seeded PRNG (mulberry32). Simulation randomness must go through this so that
 *  every game — and every AI benchmark — is reproducible from its seed.
 *
 *  Two forms, one sequence:
 *  - `RngState` + `next(r)`: the state is a plain `{ s: uint32 }`, so a world can serialise it, copy it
 *    (`{ ...r }` forks a stream) and hash it. A closure cannot be hashed — two worlds that drew a different
 *    number of values looked identical to the replay hash (GRAZE 2.0 study 02 §1).
 *  - `mulberry32(seed)`: the original closure, now a wrapper over `next`. Its sequence is pinned value-for-value
 *    to the pre-2026-11 implementation (`tests/rng.test.ts`), so every tuned level and recorded seed of every
 *    game replays unchanged. */
export type Rng = () => number;

/** Serialisable generator state. `s` is always a uint32 after `rngState` / `next`. */
export interface RngState {
  s: number;
}

export function rngState(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Advance `r` in place and return a float in [0, 1). Integer ops only (`Math.imul`, shifts) — bit-identical
 *  in every JS engine. */
export function next(r: RngState): number {
  const a = (r.s + 0x6d2b79f5) >>> 0;
  r.s = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n) from a state. */
export function nextInt(r: RngState, n: number): number {
  return Math.floor(next(r) * n);
}

export function mulberry32(seed: number): Rng {
  const r = rngState(seed);
  return () => next(r);
}

export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}
