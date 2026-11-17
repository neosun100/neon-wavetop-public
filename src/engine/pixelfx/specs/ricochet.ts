/* GENERATED from gameforge/src/pixelfx/specs/ricochet.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// one spec per file: a game imports only the effects it maps, and the bundler keeps only those vendored
// modules (they have top-level side effects, so a shared barrel would pull all of them in).
import type { PfxSpec } from '../spec';
import * as ricochet from '../vendor/fx/impacts/ricochet.js';

export const RICOCHET = {
  id: 'impacts/ricochet', mod: ricochet, cls: 'small', litPx: 950, writes: 10431, minGap: 0.12,
  // no stone option: the grit and dust it coloured are patched out (tools/pixelfx-vendor.mjs ricochet-no-stone)
  desc: 'Wall scrape: a glancing star and a tracer streaking off along the wall, with a skid of sparks.',
} as const satisfies PfxSpec;
