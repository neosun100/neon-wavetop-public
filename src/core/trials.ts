/** The league: ring trials scattered over the open five-biome map, three per biome, harder by tier. A trial is a
 *  campaign-style level (`LevelDef`) that starts where its arch stands — so it is tuned by the same harness and
 *  replayed by the same playtest records. The list is derived from the map by a seeded search: data, no clock. */
import { next, rngState } from '../engine/rng';
import type { StackWorld } from '../engine/stack3d/world';
import { hypot } from '../engine/trig';
import type { LevelDef } from './levels';

export const TRIAL_ID0 = 101;
/** per biome: three ring trials (tiers 0–2) and one mail run (tier 3: a few rings far apart) */
export const TRIALS_PER_BIOME = 4;
export const MAIL_TIER = 3;
/** how many league courses there are, without building the map to count them */
export const LEAGUE_COURSES = 5 * TRIALS_PER_BIOME;
/** height of every trial's arch, and how close the craft must pass to start it (ground distance, height) */
export const ARCH_Z = 56;
export const ARCH_R = 26;
export const ARCH_REACH = { xy: 30, z: 34 } as const;

/** Regions open in order: region `b` needs this many league stars (the first is open from the start). */
export const REGION_STARS = [0, 4, 10, 18, 28] as const;
export const regionOpen = (biome: number, leagueStars: number): boolean => leagueStars >= REGION_STARS[biome];
/** League ranks by stars. */
export const RANKS: ReadonlyArray<readonly [number, string, string]> = [[0, 'Cadet', '学员'], [6, 'Pilot', '飞行员'], [16, 'Flight Lead', '长机'], [30, 'Ace', '王牌'], [48, 'Legend', '传奇']];
export const rankOf = (leagueStars: number): readonly [number, string, string] => [...RANKS].reverse().find((r) => leagueStars >= r[0]) ?? RANKS[0];

/** `to` − `from` on a map that wraps: the short way round. */
export function wrapDelta(from: number, to: number, n: number): number {
  const d = (((to - from) % n) + n) % n;
  return d > n / 2 ? d - n : d;
}
/** The trial whose arch the craft is flying through right now, if any. */
export function archAt(trials: readonly Trial[], n: number, x: number, y: number, z: number, open: (t: Trial) => boolean = () => true): Trial | null {
  for (const t of trials) {
    if (!open(t)) continue;
    if (Math.abs(z - t.start.z) > ARCH_REACH.z) continue;
    if (hypot(wrapDelta(x, t.start.x, n), wrapDelta(y, t.start.y, n)) <= ARCH_REACH.xy) return t;
  }
  return null;
}
export const BIOME_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['Verdant Isles', '翠屿'], ['Red Mesa', '赤岩峡'], ['Frostfield', '霜原'], ['Cinder Isles', '熔岛'], ['Maple Harbour', '枫港'],
];
const TIER = ['I', 'II', 'III', 'Mail', '邮路'] as const;
/** per tier: rings, swing, radius, balloons, flak, knife share, reference win-rate target */
const TIERS = [
  [6, 0.45, 23, 1.0, 0, 0, 0.86],
  [8, 0.65, 20, 1.2, 0.45, 0.2, 0.76],
  [10, 0.85, 17, 1.4, 0.75, 0.35, 0.66],
  // the mail run: five rings, long legs — thrusters, wavetops and the kick decide it
  [5, 0.5, 24, 0.6, 0.25, 0, 0.74],
] as const;
const MAIL_LEG = 2.6;
/** height bands per biome (wave-top / over the clouds / high): the scenery decides how a trial flies */
const BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [0.45, 0.4, 0.15], // verdant: a bit of everything
  [0.7, 0.3, 0], // red mesa: down among the buttes
  [0.8, 0.15, 0.05], // frost: long low runs over the flats
  [0.25, 0.35, 0.4], // cinder: climbs over the cones
  [0.55, 0.4, 0.05], // harbour: low over piers and woods
];
const TEACH: readonly [string, string][] = [
  ['A sprint. Fly the rings.', '短程冲刺，穿过每道环。'],
  ['Guns on the course. Roll through the flak.', '赛道上有炮，翻滚闪弹。'],
  ['Tight rings, hard turns, guns. The region title.', '小环、急弯、炮火：本区冠军赛。'],
  ['The mail run: five rings, far apart. Manage the thrusters.', '邮路：五个环，相隔很远。管好推进器。'],
];

export interface Trial extends LevelDef {
  biome: number;
  tier: number;
  start: { x: number; y: number; z: number; yaw: number };
}

/** The trials of a map. Sites are at least `apart` px from each other, inside their biome. */
export function buildTrials(world: StackWorld, seed = 20261117, apart = 260): Trial[] {
  const rng = rngState(seed);
  const out: Trial[] = [];
  if (BIOME_NAMES.length * TRIALS_PER_BIOME !== LEAGUE_COURSES) throw new Error(JSON.stringify({ error: 'league_count', message: 'LEAGUE_COURSES is out of step with the biome list', actual: BIOME_NAMES.length * TRIALS_PER_BIOME, expected: LEAGUE_COURSES }));
  for (let biome = 0; biome < BIOME_NAMES.length; biome++) {
    for (let tier = 0; tier < TRIALS_PER_BIOME; tier++) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 40000; tries++) {
        x = (next(rng) * world.n) | 0;
        y = (next(rng) * world.n) | 0;
        if (world.biome[(y << world.shift) | x] !== biome) continue;
        // the wrapped distance: the map has no edge
        const far = out.every((t) => {
          const dx = Math.abs(t.start.x - x);
          const dy = Math.abs(t.start.y - y);
          return hypot(Math.min(dx, world.n - dx), Math.min(dy, world.n - dy)) >= apart;
        });
        if (far) break;
      }
      const yaw = next(rng) * 6.2832;
      const [gates, swing, radius, balloons, flak, knife, target] = TIERS[tier];
      const id = TRIAL_ID0 + biome * TRIALS_PER_BIOME + tier;
      out.push({
        id, chapter: 0, teach: TEACH[tier],
        name: tier === MAIL_TIER ? [`${BIOME_NAMES[biome][0]} ${TIER[3]}`, `${BIOME_NAMES[biome][1]}${TIER[4]}`] : [`${BIOME_NAMES[biome][0]} ${TIER[tier]}`, `${BIOME_NAMES[biome][1]} ${TIER[tier]}`],
        ...(tier === MAIL_TIER ? { legScale: MAIL_LEG } : {}),
        seed: 5000 + id * 53, gates, swing, bands: BANDS[biome], radius, balloons, flak, knife, target, biome, tier,
        // the arch hangs between the tallest ground (40) and the cloud layer (70): seen from above and below
        start: { x, y, z: ARCH_Z, yaw },
      });
    }
  }
  return out;
}
