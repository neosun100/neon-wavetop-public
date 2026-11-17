/** NEON WAVETOP — the simulation. No DOM, no renderer, no clock, no Math.sin-class call: a run is a pure function
 *  of (world, level, pay, the controls of every tick), identical in every JS engine. That is what lets a human
 *  run recorded in a phone browser be replayed and measured in Node (`./playtest`).
 *
 *  The loop (each verb of the flight toy has a job):
 *    rings  → heading and height have a target; a ring pays seconds onto the clock
 *    skim   → flying low refills the thrusters: the "never crash" floor becomes a risk the player chooses
 *    thrust → spends that energy to beat the clock
 *    roll   → the dodge (shells pass through a rolling craft) and the stunt (roll through a knife gate)
 *    guns   → fire by themselves at what the nose points at: aiming IS flying
 *    kick   → opening the thrusters just after a ring is a free surge: the commander's rhythm */
import { next, rngState, type RngState } from '../engine/rng';
import { FLIGHT_DEFAULTS, makeCraft, startSpin, stepFlight, type Craft, type FlightParams } from '../engine/stack3d/flight';
import { clamp, wrapAngle } from '../engine/stack3d/math';
import { groundAt, groundMax, type StackWorld } from '../engine/stack3d/world';
import { atan2, cos, hypot, sin } from '../engine/trig';
import { ENDLESS_STAGE, endlessPay, type LevelDef } from './levels';

export const TICK = 1 / 60;

/** Every tunable in one place. */
export const Rules = {
  /** the clock starts at clockBase + clockGates × pay */
  clockBase: 3,
  clockGates: 2,
  /** a pass this close to the centre (share of the radius) is a bullseye */
  bullseye: 0.38,
  /** below this height over the surface the craft is skimming */
  skimHeight: 13,
  energyRegen: 0.04,
  energySkim: 0.34,
  energyBurn: 0.3,
  energyGate: 0.12,
  gunRange: 220,
  gunCone: 0.22,
  /** ticks between shots */
  gunPeriod: 7,
  shellSpeed: 115,
  shellLife: 4,
  shellHit: 8,
  turretRange: 280,
  turretPeriod: 2.6,
  /** seconds a hit costs, and seconds without damage after it */
  hitPenalty: 4,
  mercy: 1.2,
  /** seconds a popped balloon pays, and a knife gate rolled through */
  balloonTime: 0.5,
  stuntTime: 0.6,
  comboCap: 20,
  /** the ring kick: opening the thrusters within this many ticks after a ring is passed gives a free surge */
  kickWindow: 15,
  kickEnergy: 0.3,
  /** … and seconds on the clock: the commander's rhythm has to be worth something that decides a run
   *  (measured 2026-11-17: with energy alone the reference commander needed only ×1.10–1.15 the expert's pay) */
  kickTime: 0.3,
} as const;

export const FLIGHT: FlightParams = { ...FLIGHT_DEFAULTS, cruise: 50, ceiling: 230, halfSpan: 7 };
/** [bottom, top] of the cloud layer: rings and balloons stay out of it (they would be hidden) */
export const CLOUD: readonly [number, number] = [70, 78];

export interface Gate {
  x: number;
  y: number;
  z: number;
  /** heading of the leg that ends here; the ring is square to it */
  h: number;
  r: number;
  knife: boolean;
  /** signed distance of the craft to the ring's plane at the last tick (negative = still before it) */
  side: number;
}

export interface Target {
  kind: 'balloon' | 'turret';
  x: number;
  y: number;
  z: number;
  r: number;
  hp: number;
  gate: number;
  cool: number;
  /** ticks left of the hit flash */
  hit: number;
}

export interface Shell {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
}

export type SimEvent =
  | { type: 'gate'; x: number; y: number; z: number; h: number; r: number; bull: boolean; stunt: boolean; combo: number; points: number; index: number }
  | { type: 'miss'; index: number }
  | { type: 'shot'; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  | { type: 'pop'; kind: Target['kind']; x: number; y: number; z: number; points: number }
  | { type: 'fire'; x: number; y: number; z: number }
  | { type: 'hurt'; x: number; y: number; z: number }
  | { type: 'dodge'; x: number; y: number; z: number; points: number }
  | { type: 'stage'; stage: number }
  | { type: 'roll' }
  | { type: 'kick'; x: number; y: number; z: number }
  | { type: 'end'; won: boolean };

/** One tick of input, already quantized (what is recorded is exactly what was simulated). */
export interface Controls {
  /** −100..100: share of the maximum turn rate, in percent */
  turn: number;
  /** −1 dive · 0 · 1 climb (ignored when `alt` ≥ 0) */
  climb: number;
  /** absolute height goal in whole px, or −1 for none */
  alt: number;
  thrust: boolean;
  roll: boolean;
}
export const NO_INPUT: Controls = { turn: 0, climb: 0, alt: -1, thrust: false, roll: false };

/** Quantize free-form input to what a tick may carry. */
export function controls(turn: number, climb: number, alt: number | undefined, thrust: boolean, roll: boolean): Controls {
  return { turn: Math.round(clamp(turn, -1, 1) * 100), climb: climb > 0.3 ? 1 : climb < -0.3 ? -1 : 0, alt: alt === undefined ? -1 : Math.round(clamp(alt, 0, 510)), thrust, roll };
}
export const packControls = (c: Controls): number => (c.turn + 100) | ((c.alt + 1) << 8) | ((c.climb + 1) << 18) | ((c.thrust ? 1 : 0) << 20) | ((c.roll ? 1 : 0) << 21);
export function unpackControls(n: number): Controls {
  return { turn: (n & 255) - 100, alt: ((n >> 8) & 1023) - 1, climb: ((n >> 18) & 3) - 1, thrust: ((n >> 20) & 1) === 1, roll: ((n >> 21) & 1) === 1 };
}

/** What a pilot — human, autopilot or reference — can see on the screen. Pilots get this and nothing else. */
export interface PilotView {
  tick: number;
  x: number; y: number; z: number; yaw: number; yawRate: number; vx: number; vy: number;
  speed: number;
  spinning: boolean;
  energy: number;
  dry: boolean;
  skimming: boolean;
  /** the lowest and highest the craft may fly right now */
  floor: number;
  ceiling: number;
  /** the ring to fly through and the one after it (drawn dotted); null past the last */
  gate: Gate;
  next: Gate | null;
  targets: readonly Target[];
  shells: readonly Shell[];
  clock: number;
}

export interface GateLog {
  /** seconds since the start */
  t: number;
  /** distance from the centre, in radii (> 1 = a miss) */
  off: number;
  pass: boolean;
}

export type RunState = 'fly' | 'won' | 'lost';

export class Run {
  state: RunState = 'fly';
  tick = 0;
  craft: Craft;
  score = 0;
  clock: number;
  combo = 0;
  energy = 1;
  gateIdx = 0;
  passed = 0;
  missed = 0;
  bullseyes = 0;
  stunts = 0;
  pops = 0;
  hits = 0;
  dodges = 0;
  /** ring kicks landed */
  kicks = 0;
  gates: Gate[] = [];
  targets: Target[] = [];
  shells: Shell[] = [];
  lock: Target | null = null;
  skimming = false;
  /** ticks of mercy left after a hit */
  mercy = 0;
  dry = false;
  events: SimEvent[] = [];
  gateLog: GateLog[] = [];
  /** seconds paid / taken so far, besides the rings (balloons, stunts / hits) */
  bonus = 0;
  penalty = 0;
  /** the smallest pay (seconds per ring) with which this run would not have run out of clock so far */
  need = 0;
  private rng: RngState;
  private gunCool = 0;
  /** ticks since the last ring was passed (large once its kick is spent or lapsed) */
  private sinceGate = 9999;
  private prevThrust = false;

  /** `pay`: seconds a ring pays (the level's tuned knob); Infinity = no clock (measurement, attract mode). */
  constructor(readonly world: StackWorld, readonly level: LevelDef, readonly pay: number) {
    this.rng = rngState(level.seed);
    const s = level.start;
    this.craft = s ? makeCraft(s.x, s.y, s.z, s.yaw) : makeCraft(world.spawnX, world.spawnY, FLIGHT.cruise, 0.9);
    this.clock = Rules.clockBase + Rules.clockGates * this.payAt(0);
    this.ensureGates();
    // free flight has no rings at all
    if (this.gates.length) this.gates[0].side = this.sideOf(this.gates[0]);
  }

  get time(): number {
    return this.tick * TICK;
  }
  get multiplier(): number {
    return 1 + Math.min(this.combo, Rules.comboCap) * 0.1;
  }
  get endless(): boolean {
    return this.level.gates === Infinity;
  }
  /** free flight: no rings, nothing to finish */
  get free(): boolean {
    return this.level.gates === 0;
  }
  get stage(): number {
    return Math.floor(this.gateIdx / ENDLESS_STAGE) + 1;
  }
  /** seconds ring `i` pays */
  payAt(i: number): number {
    return this.endless && Number.isFinite(this.pay) ? endlessPay(i) : this.pay;
  }

  view(): PilotView {
    const c = this.craft;
    return {
      tick: this.tick, x: c.x, y: c.y, z: c.z, yaw: c.yaw, yawRate: c.yawRate, vx: c.vx, vy: c.vy, speed: c.speed, spinning: c.spin >= 0,
      energy: this.energy, dry: this.dry, skimming: this.skimming, floor: c.floor, ceiling: Math.max(c.floor, FLIGHT.cruise, FLIGHT.ceiling),
      gate: this.gates[Math.min(this.gateIdx, this.gates.length - 1)], next: this.gates[this.gateIdx + 1] ?? null,
      targets: this.targets, shells: this.shells, clock: this.clock,
    };
  }

  /** A stable fingerprint of the run so far (replays compare it). */
  digest(): string {
    const c = this.craft;
    return [this.state, this.tick, c.x, c.y, c.z, c.yaw, this.score, this.energy, this.gateIdx, this.passed, this.missed, this.pops, this.hits, this.kicks, this.targets.length, this.shells.length]
      .map((v) => (typeof v === 'number' ? v.toFixed(5) : v)).join('|');
  }

  private sideOf(g: Gate): number {
    return (this.craft.x - g.x) * sin(g.h) - (this.craft.y - g.y) * cos(g.h);
  }

  private ensureGates(): void {
    const want = Math.min(this.level.gates, this.gateIdx + 3);
    while (this.gates.length < want) this.addGate();
  }

  private addGate(): void {
    const rnd = (): number => next(this.rng);
    const w = this.world;
    const L = this.level;
    const i = this.gates.length;
    const st = this.endless ? Math.floor(i / ENDLESS_STAGE) : 0;
    const prev = i > 0 ? this.gates[i - 1] : null;
    const c = this.craft;
    // each leg turns left or right of the last
    const swing = (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * Math.min(1.1, L.swing + st * 0.06));
    const d = (prev ? 250 + rnd() * 170 : 240) * (L.legScale ?? 1);
    const h = prev ? prev.h + swing : c.yaw;
    const ox = prev ? prev.x : c.x;
    const oy = prev ? prev.y : c.y;
    const oz = prev ? prev.z : c.z;
    const x = ox + sin(h) * d;
    const y = oy - cos(h) * d;
    const r = Math.max(14, L.radius - st * 1.2);
    const top = groundMax(w, x, y, r + 10);
    const [cl, ch] = CLOUD;
    // three height bands: wave-top, over the clouds, high
    const band = rnd();
    const hgt = rnd();
    let z = band < L.bands[0] ? r + 4 + hgt * 12 : band < L.bands[0] + L.bands[1] ? ch + r + 3 + hgt * 30 : 150 + hgt * 40;
    // the first ring is dead ahead at the craft's height: nobody loses a run in its first second
    if (!prev) z = oz;
    // never more climb than the craft can make on this leg (climb rate is 0.55 × speed; 0.4 leaves a margin)
    z = clamp(z, oz - 0.4 * d, oz + 0.4 * d);
    z = Math.max(z, top + r + 5);
    // a ring inside the cloud layer would be hidden: go under it when the ground allows, else over it
    if (z + r > cl - 2 && z - r < ch + 2) z = oz < cl && top + 2 * r + 8 <= cl ? cl - 3 - r : ch + r + 3;
    const knife = prev !== null && rnd() < L.knife;
    this.gates.push({ x, y, z, h, r, knife, side: -1 });
    if (!prev) return;

    const ux = cos(h);
    const uy = sin(h);
    const balloons = Math.floor(L.balloons) + (rnd() < L.balloons - Math.floor(L.balloons) ? 1 : 0);
    for (let b = 0; b < balloons; b++) {
      const t = 0.25 + rnd() * 0.55;
      const off = (rnd() < 0.5 ? -1 : 1) * (10 + rnd() * 34);
      const bx = ox + (x - ox) * t + ux * off;
      const by = oy + (y - oy) * t + uy * off;
      let bz = Math.max(oz + (z - oz) * t + (rnd() - 0.5) * 14, groundAt(w, bx, by) + 10);
      if (bz + 6 > cl && bz - 6 < ch) bz = groundAt(w, bx, by) + 16 < cl ? cl - 8 : ch + 8;
      this.targets.push({ kind: 'balloon', x: bx, y: by, z: bz, r: 5, hp: 2, gate: i, cool: 0, hit: 0 });
    }
    // flak: a gun beside the ring, a little before it
    const gun = rnd() < Math.min(0.9, L.flak + st * 0.05);
    const off = (rnd() < 0.5 ? -1 : 1) * (45 + rnd() * 45);
    const wait = 1 + rnd() * 1.5;
    if (gun) {
      const tx = x + ux * off - sin(h) * 30;
      const ty = y + uy * off + cos(h) * 30;
      this.targets.push({ kind: 'turret', x: tx, y: ty, z: groundAt(w, tx, ty) + 3, r: 4, hp: 6, gate: i, cool: wait, hit: 0 });
    }
  }

  /** The clock must cover what has been flown so far: raise `need` to the pay that would just have. */
  private account(): void {
    const n = (this.time + this.penalty - this.bonus - Rules.clockBase) / (Rules.clockGates + this.passed);
    if (n > this.need) this.need = n;
  }
  private grant(seconds: number, ring: boolean): void {
    this.account();
    if (!ring) this.bonus += seconds;
    this.clock += seconds;
  }

  /** One tick. After the run has ended this is a no-op. */
  step(ctl: Controls): void {
    if (this.state !== 'fly') return;
    this.tick++;
    const c = this.craft;
    const R = Rules;
    if (this.energy <= 0.01) this.dry = true;
    else if (this.energy > 0.18) this.dry = false;
    // the ring kick: a commander who opens the thrusters right after a ring gets energy back and full thrust at once
    this.sinceGate++;
    if (ctl.thrust && !this.prevThrust && this.sinceGate <= R.kickWindow && !this.dry) {
      this.sinceGate = 9999;
      this.kicks++;
      this.energy = Math.min(1, this.energy + R.kickEnergy);
      c.boost = 1;
      this.score += 50 * this.multiplier;
      this.grant(R.kickTime, false);
      this.events.push({ type: 'kick', x: c.x, y: c.y, z: c.z });
    }
    this.prevThrust = ctl.thrust;
    stepFlight(c, FLIGHT, this.world, TICK, this.time, {
      turn: ctl.turn / 100, climb: ctl.climb, alt: ctl.alt >= 0 ? ctl.alt : undefined, thrust: this.dry || !ctl.thrust ? 0 : 1, hold: true,
    });
    if (ctl.roll && startSpin(c)) this.events.push({ type: 'roll' });

    this.skimming = c.z - groundAt(this.world, c.x, c.y) < R.skimHeight;
    this.energy = clamp(this.energy + (R.energyRegen + (this.skimming ? R.energySkim : 0) - R.energyBurn * c.boost) * TICK, 0, 1);
    if (this.skimming) this.score += 25 * this.multiplier * TICK;
    if (this.mercy > 0) this.mercy--;
    this.clock -= TICK;
    if (this.clock <= 0) {
      this.clock = 0;
      this.state = 'lost';
      this.lock = null;
      this.events.push({ type: 'end', won: false });
      return;
    }

    // the ring: crossing its plane inside it is a pass, outside it a miss — either way the run moves on, so a
    // missed ring costs its seconds and the combo, never the flow
    const g: Gate | undefined = this.gates[this.gateIdx];
    const side = g ? this.sideOf(g) : -1;
    if (g && g.side < 0 && side >= 0) {
      const lat = (c.x - g.x) * cos(g.h) + (c.y - g.y) * sin(g.h);
      const off = hypot(lat, c.z - g.z);
      const pass = off <= g.r + 3;
      this.gateLog.push({ t: this.time, off: off / g.r, pass });
      if (pass) {
        const bull = off < g.r * R.bullseye;
        const stunt = g.knife && c.spin >= 0;
        this.combo++;
        if (bull) this.bullseyes++;
        if (stunt) this.stunts++;
        const points = Math.round((bull ? 200 : 100) * (stunt ? 2 : 1) * this.multiplier);
        this.score += points;
        this.grant(this.payAt(this.gateIdx), true);
        this.passed++;
        this.sinceGate = 0;
        if (stunt) this.grant(R.stuntTime, false);
        this.energy = Math.min(1, this.energy + R.energyGate);
        this.events.push({ type: 'gate', x: g.x, y: g.y, z: g.z, h: g.h, r: g.r, bull, stunt, combo: this.combo, points, index: this.gateIdx });
      } else {
        this.combo = 0;
        this.missed++;
        this.events.push({ type: 'miss', index: this.gateIdx });
      }
      this.gateIdx++;
      if (this.gateIdx >= this.level.gates) {
        this.account();
        this.state = 'won';
        this.lock = null;
        this.events.push({ type: 'end', won: true });
        return;
      }
      this.ensureGates();
      this.gates[this.gateIdx].side = this.sideOf(this.gates[this.gateIdx]);
      if (this.endless && this.gateIdx % ENDLESS_STAGE === 0) this.events.push({ type: 'stage', stage: this.stage });
      this.targets = this.targets.filter((t) => t.gate >= this.gateIdx - 1);
    } else if (g) g.side = side;

    // guns: the nearest target inside the cone ahead
    this.lock = null;
    let best: number = R.gunRange;
    for (const t of this.targets) {
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      const dist = hypot(dx, dy);
      if (dist >= best || Math.abs(t.z - c.z) > 14 + 0.3 * dist) continue;
      if (Math.abs(wrapAngle(atan2(dx, -dy) - c.yaw)) > R.gunCone) continue;
      best = dist;
      this.lock = t;
    }
    if (this.gunCool > 0) this.gunCool--;
    if (this.lock && this.gunCool <= 0) {
      const t = this.lock;
      this.gunCool = R.gunPeriod;
      t.hp--;
      t.hit = 7;
      this.events.push({ type: 'shot', x: c.x, y: c.y, z: c.z, tx: t.x, ty: t.y, tz: t.z });
      if (t.hp <= 0) {
        const points = Math.round((t.kind === 'turret' ? 150 : 50) * this.multiplier);
        this.score += points;
        this.pops++;
        if (t.kind === 'balloon') this.grant(R.balloonTime, false);
        this.events.push({ type: 'pop', kind: t.kind, x: t.x, y: t.y, z: t.z, points });
        this.targets.splice(this.targets.indexOf(t), 1);
        this.lock = null;
      }
    }

    // flak: aimed where the craft will be
    for (const t of this.targets) {
      if (t.hit > 0) t.hit--;
      if (t.kind !== 'turret') continue;
      t.cool -= TICK;
      const dist = hypot(c.x - t.x, c.y - t.y);
      if (t.cool > 0 || dist > R.turretRange || dist < 50) continue;
      t.cool = R.turretPeriod;
      const lead = (dist / R.shellSpeed) * 0.9;
      const ax = c.x + c.vx * lead - t.x;
      const ay = c.y + c.vy * lead - t.y;
      const az = c.z - (t.z + 6);
      const k = R.shellSpeed / (hypot(ax, ay, az) || 1);
      this.shells.push({ x: t.x, y: t.y, z: t.z + 6, vx: ax * k, vy: ay * k, vz: az * k, age: 0 });
      this.events.push({ type: 'fire', x: t.x, y: t.y, z: t.z + 6 });
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += TICK;
      s.x += s.vx * TICK;
      s.y += s.vy * TICK;
      s.z += s.vz * TICK;
      let gone = s.age > R.shellLife || s.z < groundAt(this.world, s.x, s.y);
      if (!gone && hypot(s.x - c.x, s.y - c.y, s.z - c.z) < R.shellHit) {
        if (c.spin >= 0) {
          const points = Math.round(75 * this.multiplier);
          this.score += points;
          this.dodges++;
          this.events.push({ type: 'dodge', x: s.x, y: s.y, z: s.z, points });
          gone = true;
        } else if (this.mercy <= 0) {
          this.mercy = Math.round(R.mercy / TICK);
          this.combo = 0;
          this.hits++;
          this.account();
          this.penalty += R.hitPenalty;
          this.clock = Math.max(TICK, this.clock - R.hitPenalty);
          this.events.push({ type: 'hurt', x: c.x, y: c.y, z: c.z });
          gone = true;
        }
      }
      if (gone) this.shells.splice(i, 1);
    }
  }
}

/** A pilot turns what is on the screen into one tick of controls. */
export interface Pilot {
  act(v: PilotView): Controls;
}

/** Fly a whole level headless. `pay` = Infinity measures what the pilot needs (`need`), with no clock. */
export function fly(world: StackWorld, level: LevelDef, pay: number, pilot: Pilot, maxSeconds = 600): Run {
  const run = new Run(world, level, pay);
  const cap = Math.round(maxSeconds / TICK);
  while (run.state === 'fly' && run.tick < cap) {
    run.step(pilot.act(run.view()));
    run.events.length = 0;
  }
  return run;
}
