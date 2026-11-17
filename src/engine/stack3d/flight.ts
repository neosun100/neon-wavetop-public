/* GENERATED from gameforge/src/stack3d/flight.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Stack3D kit — arcade flight over a `StackWorld`: heading by yaw rate, bank that follows the turn, a height goal
 *  reached at a limited climb rate, and a floor that skims whatever ground lies ahead. The craft can get close to
 *  the ground but the model never lets it hit: the skill is in WHERE you fly, not in not crashing — a game adds its
 *  own stakes (clock, gates, fire) on top. Deterministic and DOM-free: only + − × ÷ sqrt and `../trig`, so a fixed `dt` replays bit-for-bit in every JS
 *  engine (a run recorded in Safari replays in Node). */
import { cos, expNeg, sin } from '../trig';
import { clamp } from './math';
import { groundAt, type StackWorld } from './world';

export interface FlightParams {
  /** cruise speed, world px / s */
  speed: number;
  /** × speed at full thrust */
  boost: number;
  /** maximum turn rate, rad / s */
  agility: number;
  /** bank angle at the maximum turn rate, degrees */
  bank: number;
  /** the height it settles at when nobody chooses one */
  cruise: number;
  /** the highest it climbs */
  ceiling: number;
  /** the lowest it skims above the ground ahead, px */
  clearance: number;
  /** half the wingspan in world px: the floor looks this far to each side */
  halfSpan: number;
}

export const FLIGHT_DEFAULTS: FlightParams = { speed: 92, boost: 1.8, agility: 1.25, bank: 52, cruise: 64, ceiling: 300, clearance: 7, halfSpan: 7 };

export interface Craft {
  x: number;
  y: number;
  z: number;
  yaw: number;
  yawRate: number;
  /** bank from turning (the full roll of a spin is added by `bankOf`) */
  roll: number;
  pitch: number;
  vx: number;
  vy: number;
  /** −1 = not spinning, else 0..1 through a full aileron roll */
  spin: number;
  spinDir: number;
  /** 0..1: how far the thrusters are open (eased) */
  boost: number;
  speed: number;
  /** the height it is heading for */
  altGoal: number;
  /** the lowest it may fly right now (ground ahead + clearance), smoothed */
  floor: number;
  climbV: number;
  /** −0.5..0.5: climb / dive angle, for the nose and the camera */
  tilt: number;
  /** 0..1: how hard it is being flown (turn + spin + thrust + climb), eased — trails and sound read it */
  g: number;
}

export interface FlightInput {
  /** −1 (left) .. 1 (right): share of the maximum turn rate */
  turn: number;
  /** 0..1 */
  thrust: number;
  /** −1 (dive) .. 1 (climb): moves the height goal at the climb rate … */
  climb: number;
  /** … or an absolute height goal, which wins when set */
  alt?: number;
  /** true: with no climb input the height goal stays where it was flown to (false: it drifts back to cruise) */
  hold: boolean;
}

/** Seconds a full roll takes. */
export const SPIN_TIME = 0.85;

export function makeCraft(x: number, y: number, z: number, yaw: number): Craft {
  return { x, y, z, yaw, yawRate: 0, roll: 0, pitch: 0, vx: 0, vy: 0, spin: -1, spinDir: 1, boost: 0, speed: 0, altGoal: z, floor: 0, climbV: 0, tilt: 0, g: 0 };
}

/** Begin a full roll in the direction of the turn; false while one is under way. */
export function startSpin(c: Craft): boolean {
  if (c.spin >= 0) return false;
  c.spin = 0;
  c.spinDir = c.yawRate >= 0 ? 1 : -1;
  return true;
}

/** The bank angle to draw, including any roll it is half-way through (eased in and out). */
export function bankOf(c: Craft): number {
  if (c.spin < 0) return c.roll;
  const t = c.spin;
  return c.roll + c.spinDir * Math.PI * 2 * (t < 0.5 ? 2 * t * t : 1 - ((2 - 2 * t) * (2 - 2 * t)) / 2);
}

/** The tallest ground under the craft and along the next stretch of its path. */
function groundAhead(w: StackWorld, c: Craft, speed: number, half: number): number {
  const sn = sin(c.yaw);
  const cs = cos(c.yaw);
  let top = 0;
  for (let i = 0; i <= 4; i++) {
    const d = speed * 0.16 * i;
    for (let side = -1; side <= 1; side++) {
      const h = groundAt(w, c.x + sn * d + cs * side * half, c.y - cs * d + sn * side * half);
      if (h > top) top = h;
    }
  }
  return top;
}

/** The height band the craft may use right now: [floor, ceiling]. */
export function altBand(c: Craft, p: FlightParams): [number, number] {
  return [c.floor, Math.max(c.floor, p.cruise, p.ceiling)];
}

/** One step. `time` only drives the gentle cruise bob (pass the simulation clock, never the wall clock). */
export function stepFlight(c: Craft, p: FlightParams, world: StackWorld, dt: number, time: number, input: FlightInput): void {
  const ease = (rate: number): number => 1 - expNeg(dt * rate);
  const goal = clamp(input.thrust, 0, 1);
  // thrust opens fast and closes slowly
  c.boost += (goal - c.boost) * ease(goal > c.boost ? 5 : 2.4);
  if (c.boost < 0.0005 && goal === 0) c.boost = 0;
  const speed = p.speed * (1 + (clamp(p.boost, 1, 4) - 1) * c.boost);
  c.speed = speed;
  const maxRate = Math.max(0.1, p.agility);

  // the floor rises at once when a hill comes up and sinks slowly after it
  const floorNow = groundAhead(world, c, speed, p.halfSpan) + p.clearance;
  if (c.floor === 0) c.floor = floorNow;
  c.floor += (floorNow - c.floor) * ease(floorNow > c.floor ? 9 : 3);
  const [lo, hi] = altBand(c, p);
  const climbMax = speed * 0.55;

  c.yawRate += (clamp(input.turn, -1, 1) * maxRate - c.yawRate) * ease(2.6);
  c.yaw += c.yawRate * dt;
  c.roll += (clamp(c.yawRate / maxRate, -1, 1) * ((p.bank * Math.PI) / 180) - c.roll) * ease(5);
  c.vx = sin(c.yaw) * speed;
  c.vy = -cos(c.yaw) * speed;
  c.x += c.vx * dt;
  c.y += c.vy * dt;

  if (input.alt !== undefined) c.altGoal = input.alt;
  else if (input.climb !== 0) c.altGoal += clamp(input.climb, -1, 1) * climbMax * dt;
  else if (!input.hold) c.altGoal += (p.cruise - c.altGoal) * ease(0.9);
  c.altGoal = clamp(c.altGoal, lo, hi);
  let dz = (c.altGoal + sin(time * 0.9) * 1.5 - c.z) * ease(3);
  dz = clamp(dz, -climbMax * dt, climbMax * dt);
  c.z += dz;
  // last resort: never closer to what is right underneath than most of the clearance
  const hard = groundAt(world, c.x, c.y) + p.clearance * 0.7;
  if (c.z < hard) c.z += (hard - c.z) * ease(22);
  // … and a hard stop under the easing: a tight turn into a cliff face must not sink through half the clearance
  // (measured 2026-11-16: easing alone let 240 s of hostile input reach 0.4 × clearance)
  const stop = hard - p.clearance * 0.2;
  if (c.z < stop) c.z = stop;
  c.climbV += (dz / Math.max(dt, 1e-4) - c.climbV) * ease(6);
  // nose up in a climb, down in a dive (the cruise bob does not count)
  const climbing = Math.sign(c.climbV) * Math.max(0, Math.abs(c.climbV) - 3);
  c.tilt = clamp((climbing / Math.max(20, speed)) * 1.25, -0.5, 0.5);
  c.pitch += (Math.abs(c.yawRate / maxRate) * 0.1 + c.tilt - c.pitch) * ease(4);

  if (c.spin >= 0) {
    c.spin += dt / SPIN_TIME;
    if (c.spin >= 1) c.spin = -1;
  }
  const gNow = clamp(Math.abs(c.yawRate) / maxRate + (c.spin >= 0 ? 0.7 : 0) + c.boost * 0.9 + Math.abs(c.tilt), 0, 1);
  c.g += (gNow - c.g) * ease(2.5);
}
