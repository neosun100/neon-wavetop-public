/* GENERATED from gameforge/src/pixelfx/specs/parry.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as parry from '../vendor/fx/impacts/parry.js';

export const PARRY = {
  id: 'impacts/parry', mod: parry, cls: 'small', litPx: 2086, writes: 20511, minGap: 0.3,
  opts: { height: 0 },
  desc: 'Car contact: a crisp star with a broken ring and a fan of sparks, no fill.',
} as const satisfies PfxSpec;
