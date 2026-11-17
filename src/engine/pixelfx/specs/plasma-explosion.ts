/* GENERATED from gameforge/src/pixelfx/specs/plasma-explosion.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as plasma from '../vendor/fx/explosions/plasma-explosion.js';

export const PLASMA = {
  id: 'explosions/plasma-explosion', mod: plasma, cls: 'big', litPx: 5057, writes: 55771, minGap: 0.5, heroFlash: 0.6,
  accentKey: 'accent',
  desc: 'Surge: a short flash, then a ball with tilted dotted bands, forked bolts and a boiling accent rim.',
} as const satisfies PfxSpec;
