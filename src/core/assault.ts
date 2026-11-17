/** Open skies — one island assault, headless. A fort is a command tower and a ring of flak guns on an island;
 *  it is freed when all of them are destroyed. No rings, no global clock: the cost of flying badly is time and
 *  hits. Same flight, same guns, same determinism rules as `./sim` (no clock, no Math.sin-class call).
 *
 *  What makes the verbs matter here:
 *    tower   → while it stands the guns lead their shots properly AND a destroyed gun is rebuilt; without it
 *              they fire late and wide and stay down
 *    skim    → the deck is cover: a gun cannot fire at a skimming craft unless it is point-blank
 *    roll    → a shell passes through a rolling craft
 *    a hit   → costs the thrusters for a moment; the third one shoots the craft down (it re-enters from outside) */
import { next, rngState, type RngState } from '../engine/rng';
import { FLIGHT_DEFAULTS, makeCraft, startSpin, stepFlight, type Craft, type FlightParams } from '../engine/stack3d/flight';
import { clamp, wrapAngle } from '../engine/stack3d/math';
import { groundAt, WATER_MATS, type StackWorld } from '../engine/stack3d/world';
import { atan2, cos, hypot, sin } from '../engine/trig';
import { TICK, type Controls, type Shell } from './sim';

export const AssaultRules = {
  gunHp: 6,
  towerHp: 16,
  gunRange: 220,
  gunCone: 0.22,
  gunPeriod: 7,
  shellSpeed: 150,
  shellLife: 3.2,
  shellHit: 11,
  flakRange: 300,
  /** seconds between a gun's shots (THE knob a fort tier will tune); × this when the tower is down / the craft skims */
  reload: 1.5,
  leaderlessReload: 1.6,
  /** a skimming craft can only be fired at from inside this distance */
  deckRange: 110,
  /** seconds until a destroyed gun is back, while the tower stands */
  rebuild: 10,
  /** hits that shoot the craft down, and the seconds it is out */
  armour: 3,
  downSeconds: 5,
  entry: 420,
  /** how far off a leaderless gun leads (share of the true lead, ±) */
  leaderlessError: 0.6,
  skimHeight: 13,
  energyRegen: 0.04,
  energySkim: 0.34,
  energyBurn: 0.3,
  /** ticks without thrust after a hit, and ticks of mercy */
  stun: 60,
  mercy: 72,
} as const;

export const ASSAULT_FLIGHT: FlightParams = { ...FLIGHT_DEFAULTS, cruise: 40, ceiling: 230, halfSpan: 7 };

export interface Emplacement {
  kind: 'gun' | 'tower';
  x: number;
  y: number;
  z: number;
  hp: number;
  cool: number;
}

export interface Fort {
  x: number;
  y: number;
  biome: number;
  guns: number;
}

/** A fort site for each wanted biome: a land point with enough land around it for the guns. Deterministic. */
export function findForts(world: StackWorld, seed: number, biomes: readonly number[]): Fort[] {
  const rng = rngState(seed);
  const out: Fort[] = [];
  for (const biome of biomes) {
    for (let tries = 0; tries < 20000; tries++) {
      const x = (next(rng) * world.n) | 0;
      const y = (next(rng) * world.n) | 0;
      const o = (y << world.shift) | x;
      if (world.biome[o] !== biome || world.mat[o] < WATER_MATS) continue;
      let land = 0;
      for (let a = 0; a < 12; a++) if (world.mat[(((y + sin(a * 0.5236) * 70) & world.mask) << world.shift) | ((x + cos(a * 0.5236) * 70) & world.mask)] >= WATER_MATS) land++;
      if (land < 6) continue;
      if (out.some((f) => hypot(f.x - x, f.y - y) < 500)) continue;
      out.push({ x, y, biome, guns: 4 + ((next(rng) * 4) | 0) });
      break;
    }
  }
  return out;
}

/** What a pilot sees of an assault: its own instruments, what still stands, and the shells in the air. */
export interface AssaultView {
  tick: number;
  x: number; y: number; z: number; yaw: number; vx: number; vy: number; speed: number;
  spinning: boolean;
  energy: number;
  dry: boolean;
  skimming: boolean;
  floor: number;
  standing: readonly Emplacement[];
  shells: readonly Shell[];
  fortX: number;
  fortY: number;
}
export interface AssaultPilot {
  act(v: AssaultView): Controls;
}

export class Assault {
  tick = 0;
  craft: Craft;
  energy = 1;
  dry = false;
  skimming = false;
  hits = 0;
  /** times shot down */
  downs = 0;
  dodges = 0;
  shots = 0;
  freed = false;
  standing: Emplacement[] = [];
  shells: Shell[] = [];
  /** destroyed guns waiting to be rebuilt: the gun and the ticks left */
  private wrecks: Array<{ e: Emplacement; left: number }> = [];
  private armour: number = AssaultRules.armour;
  /** ticks the craft is out after being shot down */
  private out = 0;
  private stun = 0;
  private mercy = 0;
  private gunCool = 0;
  private readonly rng: RngState;

  constructor(readonly world: StackWorld, readonly fort: Fort, seed: number, readonly reload: number = AssaultRules.reload) {
    this.rng = rngState(seed * 7919 + fort.x * 31 + fort.y);
    const w = world;
    this.standing.push({ kind: 'tower', x: fort.x, y: fort.y, z: groundAt(w, fort.x, fort.y) + 6, hp: AssaultRules.towerHp, cool: 0 });
    for (let i = 0; i < fort.guns; i++) {
      // guns ring the tower; one that would stand in the sea moves in until it finds land
      const a = (i / fort.guns) * 6.2832 + next(this.rng) * 0.5;
      let r = 60 + next(this.rng) * 50;
      let gx = fort.x;
      let gy = fort.y;
      for (; r > 10; r -= 10) {
        gx = fort.x + cos(a) * r;
        gy = fort.y + sin(a) * r;
        if (w.mat[(((gy | 0) & w.mask) << w.shift) | ((gx | 0) & w.mask)] >= WATER_MATS) break;
      }
      this.standing.push({ kind: 'gun', x: gx, y: gy, z: groundAt(w, gx, gy) + 3, hp: AssaultRules.gunHp, cool: 0.5 + next(this.rng) * this.reload });
    }
    // the craft starts 420 px out, pointed at the fort
    const a0 = next(this.rng) * 6.2832;
    this.craft = makeCraft(fort.x + sin(a0) * 420, fort.y - cos(a0) * 420, ASSAULT_FLIGHT.cruise, a0 + 3.14159265);
  }

  get time(): number {
    return this.tick * TICK;
  }
  get towerUp(): boolean {
    return this.standing.some((e) => e.kind === 'tower');
  }

  view(): AssaultView {
    const c = this.craft;
    return {
      tick: this.tick, x: c.x, y: c.y, z: c.z, yaw: c.yaw, vx: c.vx, vy: c.vy, speed: c.speed, spinning: c.spin >= 0, energy: this.energy, dry: this.dry,
      skimming: this.skimming, floor: c.floor, standing: this.standing, shells: this.shells, fortX: this.fort.x, fortY: this.fort.y,
    };
  }

  digest(): string {
    const c = this.craft;
    return [this.tick, c.x, c.y, c.z, c.yaw, this.energy, this.hits, this.downs, this.dodges, this.shots, this.standing.length, this.shells.length].map((v) => v.toFixed(5)).join('|');
  }

  step(ctl: Controls): void {
    if (this.freed) return;
    this.tick++;
    const R = AssaultRules;
    const c = this.craft;
    // the tower rebuilds its guns; without it the wrecks stay wrecks
    if (this.towerUp) {
      for (let i = this.wrecks.length - 1; i >= 0; i--) {
        if (--this.wrecks[i].left > 0) continue;
        const e = this.wrecks[i].e;
        e.hp = R.gunHp;
        e.cool = this.reload;
        this.standing.push(e);
        this.wrecks.splice(i, 1);
      }
    }
    if (this.out > 0) {
      // shot down: out of the fight; then back in from outside, pointed at the fort
      if (--this.out === 0) {
        const a = next(this.rng) * 6.2832;
        this.craft = makeCraft(this.fort.x + sin(a) * R.entry, this.fort.y - cos(a) * R.entry, ASSAULT_FLIGHT.cruise, a + 3.14159265);
        this.armour = R.armour;
        this.shells.length = 0;
      }
      return;
    }
    if (this.energy <= 0.01) this.dry = true;
    else if (this.energy > 0.18) this.dry = false;
    if (this.stun > 0) this.stun--;
    if (this.mercy > 0) this.mercy--;
    stepFlight(c, ASSAULT_FLIGHT, this.world, TICK, this.time, {
      turn: ctl.turn / 100, climb: ctl.climb, alt: ctl.alt >= 0 ? ctl.alt : undefined, thrust: this.dry || this.stun > 0 || !ctl.thrust ? 0 : 1, hold: true,
    });
    if (ctl.roll) startSpin(c);
    this.skimming = c.z - groundAt(this.world, c.x, c.y) < R.skimHeight;
    this.energy = clamp(this.energy + (R.energyRegen + (this.skimming ? R.energySkim : 0) - R.energyBurn * c.boost) * TICK, 0, 1);

    // the craft's guns: the nearest emplacement inside the cone ahead
    let lock: Emplacement | null = null;
    let best: number = R.gunRange;
    for (const e of this.standing) {
      const dx = e.x - c.x;
      const dy = e.y - c.y;
      const d = hypot(dx, dy);
      if (d >= best || Math.abs(e.z - c.z) > 20 + 0.4 * d) continue;
      if (Math.abs(wrapAngle(atan2(dx, -dy) - c.yaw)) > R.gunCone) continue;
      best = d;
      lock = e;
    }
    if (this.gunCool > 0) this.gunCool--;
    if (lock && this.gunCool <= 0) {
      this.gunCool = R.gunPeriod;
      this.shots++;
      if (--lock.hp <= 0) {
        this.standing.splice(this.standing.indexOf(lock), 1);
        if (lock.kind === 'gun') this.wrecks.push({ e: lock, left: Math.round(R.rebuild / TICK) });
        if (this.standing.length === 0) { this.freed = true; return; }
      }
    }

    // flak: led properly while the tower stands; late and wide without it; slow onto a craft on the deck
    const led = this.towerUp;
    for (const e of this.standing) {
      if (e.kind !== 'gun') continue;
      e.cool -= TICK;
      const d = hypot(c.x - e.x, c.y - e.y);
      if (e.cool > 0 || d > R.flakRange || d < 40 || (this.skimming && d > R.deckRange)) continue;
      e.cool = this.reload * (led ? 1 : R.leaderlessReload);
      const lead = (d / R.shellSpeed) * (led ? 0.9 : 0.9 + (next(this.rng) * 2 - 1) * R.leaderlessError);
      const ax = c.x + c.vx * lead - e.x;
      const ay = c.y + c.vy * lead - e.y;
      const az = c.z - (e.z + 6);
      const k = R.shellSpeed / (hypot(ax, ay, az) || 1);
      this.shells.push({ x: e.x, y: e.y, z: e.z + 6, vx: ax * k, vy: ay * k, vz: az * k, age: 0 });
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += TICK;
      s.x += s.vx * TICK;
      s.y += s.vy * TICK;
      s.z += s.vz * TICK;
      let gone = s.age > R.shellLife || s.z < groundAt(this.world, s.x, s.y);
      if (!gone && hypot(s.x - c.x, s.y - c.y, s.z - c.z) < R.shellHit) {
        if (c.spin >= 0) { this.dodges++; gone = true; }
        else if (this.mercy <= 0) {
          this.hits++;
          this.stun = R.stun;
          this.mercy = R.mercy;
          gone = true;
          if (--this.armour <= 0) { this.downs++; this.out = Math.round(R.downSeconds / TICK); }
        }
      }
      if (gone) this.shells.splice(i, 1);
    }
  }
}

/** Fly one assault headless; `seconds` is Infinity when the fort still stands at the cap. */
export function assault(world: StackWorld, fort: Fort, seed: number, pilot: AssaultPilot, cap = 600, reload?: number): { seconds: number; hits: number; downs: number; dodges: number; digest: string } {
  const a = new Assault(world, fort, seed, reload);
  const max = Math.round(cap / TICK);
  while (!a.freed && a.tick < max) a.step(pilot.act(a.view()));
  return { seconds: a.freed ? a.time : Infinity, hits: a.hits, downs: a.downs, dodges: a.dodges, digest: a.digest() };
}
