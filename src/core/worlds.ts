/** One island world per chapter, built once and kept (building takes a moment). */
import { buildIslands, type StackWorld, type WorldOpts } from '../engine/stack3d/world';
import { CHAPTERS, FREE, FREE_ID, LEVELS, type LevelDef } from './levels';
import { buildTrials, TRIAL_ID0, type Trial } from './trials';

export const WORLD_SIZE = 1024;
const cache = new Map<number, StackWorld>();

/** The open map: twice the side of a chapter world, divided into the five biomes. */
export const OPEN_SIZE = 2048;
const OPEN_KEY = -1;
/** the one definition of the open map (the page's worker builds from the same options) */
export const OPEN_OPTS: WorldOpts = { size: OPEN_SIZE, cloudSize: 1024, seed: 2026, land: 0.36, biomes: true };
/** Take an open map built elsewhere (the page's worker). Ignored if one is already here. */
export function adoptOpen(w: StackWorld): boolean {
  if (cache.has(OPEN_KEY) || w.n !== OPEN_SIZE || w.height.length !== OPEN_SIZE * OPEN_SIZE) return false;
  cache.set(OPEN_KEY, w);
  return true;
}
export const openReady = (): boolean => cache.has(OPEN_KEY);

export function worldOf(level: LevelDef): StackWorld {
  if (level.id === FREE_ID || level.id >= TRIAL_ID0) {
    let o = cache.get(OPEN_KEY);
    if (!o) cache.set(OPEN_KEY, (o = buildIslands(OPEN_OPTS)));
    return o;
  }
  let w = cache.get(level.chapter);
  if (!w) {
    const ch = CHAPTERS[level.chapter];
    w = buildIslands({ size: WORLD_SIZE, cloudSize: 1024, seed: ch.worldSeed, land: ch.land });
    cache.set(level.chapter, w);
  }
  return w;
}

let trials: Trial[] | null = null;
/** The league's trials, on the open map (built once). */
export function trialsOf(): Trial[] {
  return (trials ??= buildTrials(worldOf(FREE)));
}
/** A campaign level or a trial by id (what a playtest record names); undefined for anything else. */
export function levelById(id: number): LevelDef | undefined {
  return id >= TRIAL_ID0 ? trialsOf().find((t) => t.id === id) : LEVELS[id - 1];
}
