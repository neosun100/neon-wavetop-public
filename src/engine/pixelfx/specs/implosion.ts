/* GENERATED from gameforge/src/pixelfx/specs/implosion.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as implosion from '../vendor/fx/explosions/implosion.js';

export const IMPLOSION = {
  id: 'explosions/implosion', mod: implosion, cls: 'big', litPx: 6180, writes: 30584, minGap: 0.5, heroFlash: 0.5,
  desc: 'Phase change: streaks gather inward, pulse rings tighten, then a cross flare releases.',
} as const satisfies PfxSpec;
