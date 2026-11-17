/* GENERATED from gameforge/src/pixelfx/specs/hit-spark.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as hitSpark from '../vendor/fx/impacts/hit-spark.js';

export const HIT_SPARK = {
  id: 'impacts/hit-spark', mod: hitSpark, cls: 'small', litPx: 801, writes: 11066, minGap: 0.08,
  opts: { height: 0 },
  desc: 'Graze tick: a lopsided 1-px cross and a white diamond for 3 frames, then a short cone of sparks. Tiny.',
} as const satisfies PfxSpec;
