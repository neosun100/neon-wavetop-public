/* GENERATED from gameforge/src/pixelfx/specs/firework-burst.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as firework from '../vendor/fx/explosions/firework-burst.js';

export const FIREWORK = {
  id: 'explosions/firework-burst', mod: firework, cls: 'big', litPx: 5348, writes: 56338, minGap: 1.0, heroFlash: 0.4,
  accentKey: 'core',
  desc: 'Show moment: one shell bursts into trailing stars round a gold core; they droop, crackle and fade. No smoke.',
} as const satisfies PfxSpec;
