/* GENERATED from gameforge/src/pixelfx/specs/crit-hit.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as critHit from '../vendor/fx/impacts/crit-hit.js';
import { HIT_SPARK } from './hit-spark';

export const CRIT_HIT = {
  id: 'impacts/crit-hit', mod: critHit, cls: 'medium', litPx: 3834, writes: 53685, minGap: 0.3, heroFlash: 0.8,
  opts: { height: 0 }, fallback: HIT_SPARK,
  desc: 'The hit that lands: a spiked star and a ring breaking into arcs; its flash is the only light event.',
} as const satisfies PfxSpec;
