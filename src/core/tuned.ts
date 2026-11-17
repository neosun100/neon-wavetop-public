/** The one place a level's clock comes from: the measured table (campaign) or the endless formula. */
import type { LevelDef } from './levels';
import { TUNED } from './levels.tuned';

/** Seconds a ring pays in `level`. Throws when a campaign level has no measured value — a level must never ship
 *  on a default (the owner would see an easier, untuned game). */
export function payOf(level: LevelDef): number {
  if (level.id <= 0) return 1; // endless and the daily run: any finite value — Run.payAt uses the endless formula
  const t = TUNED[level.id];
  if (!t) throw new Error(JSON.stringify({ error: 'level_not_tuned', message: 'run scripts/levels.ts --tune', actual: level.id, tuned: Object.keys(TUNED).length }));
  return t.payCs / 100;
}
export const parOf = (level: LevelDef): number => TUNED[level.id]?.par ?? Infinity;
