/* GENERATED from gameforge/src/pixelfx/catalog.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** The adopted pixelfx effects as a registry (code, not a doc — design 05 §2.2/§3.4).
 *  Each one is a "light, not matter" effect: thin lines, rings, sparks, small glows. Smoke/dust/fire/text/actor
 *  effects are rejected (05 §1.2) and are not vendored at all. `litPx`/`writes` are MEASURED (T-V6 checks them;
 *  `PFX_UPDATE=1 npx vitest run tests/pixelfx.test.ts` prints fresh values), never guessed.
 *  GAMES: import from './specs/<id>' — importing this file pulls every effect into the bundle. */
export type { PfxClass, PfxSpec } from './spec';
import type { PfxSpec } from './spec';
import { HIT_SPARK } from './specs/hit-spark';
import { CRIT_HIT } from './specs/crit-hit';
import { PARRY } from './specs/parry';
import { RICOCHET } from './specs/ricochet';
import { COLLECT_BURST } from './specs/collect-burst';
import { PLASMA } from './specs/plasma-explosion';
import { IMPLOSION } from './specs/implosion';
import { FIREWORK } from './specs/firework-burst';
export { HIT_SPARK, CRIT_HIT, PARRY, RICOCHET, COLLECT_BURST, PLASMA, IMPLOSION, FIREWORK };

/** Every adopted effect by id: for tests and tools. Games import the named specs they map, so a bundler
 *  keeps only those effect modules (importing PFX pulls all 8: +~6 KB gz). */
export const PFX = {
  'impacts/hit-spark': HIT_SPARK,
  'impacts/crit-hit': CRIT_HIT,
  'impacts/parry': PARRY,
  'impacts/ricochet': RICOCHET,
  'pickups/collect-burst': COLLECT_BURST,
  'explosions/plasma-explosion': PLASMA,
  'explosions/implosion': IMPLOSION,
  'explosions/firework-burst': FIREWORK,
} as const satisfies Record<string, PfxSpec>;

export type PfxId = keyof typeof PFX;
export const PFX_IDS = Object.keys(PFX) as PfxId[];
