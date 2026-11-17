/* GENERATED from gameforge/src/pixelfx/specs/collect-burst.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as collectBurst from '../vendor/fx/pickups/collect-burst.js';

export const COLLECT_BURST = {
  id: 'pickups/collect-burst', mod: collectBurst, cls: 'small', litPx: 1076, writes: 9052, minGap: 0.15,
  topDown: { dy: 30 }, opts: { cross: false },
  desc: 'Overtake: a thin ring snapping out ahead of a softer one, twinkles thrown wide that brake and wink out.',
} as const satisfies PfxSpec;
