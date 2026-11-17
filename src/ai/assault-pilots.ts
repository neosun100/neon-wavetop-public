/** Pilots of an island assault: the autopilot, the reference population, and the controls the P0 judges them
 *  against. All of them see only `AssaultView`. */
import { next, rngState, type RngState } from '../engine/rng';
import { clamp, wrapAngle } from '../engine/stack3d/math';
import { atan2, hypot, sin } from '../engine/trig';
import { ASSAULT_FLIGHT, AssaultRules, type AssaultPilot, type AssaultView, type Emplacement } from '../core/assault';
import { controls, type Controls } from '../core/sim';

const nearest = (v: AssaultView, pick: (e: Emplacement) => boolean): Emplacement | null => {
  let best: Emplacement | null = null;
  let bd = Infinity;
  for (const e of v.standing) {
    if (!pick(e)) continue;
    const d = hypot(e.x - v.x, e.y - v.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};

/** Strafing runs: fly at a target, pass it, extend, come back. `extend` is how far past it the pilot flies on. */
abstract class Strafer implements AssaultPilot {
  protected target: Emplacement | null = null;
  protected out = 0;
  protected abstract choose(v: AssaultView): Emplacement | null;
  protected abstract steer(v: AssaultView, err: number, dist: number, t: Emplacement): Controls;
  protected extend = 150;

  act(v: AssaultView): Controls {
    if (!this.target || !v.standing.includes(this.target)) { this.target = this.choose(v); this.out = 0; }
    const t = this.target;
    if (!t) return controls(0, 0, undefined, false, false);
    const dx = t.x - v.x;
    const dy = t.y - v.y;
    const dist = hypot(dx, dy);
    const err = wrapAngle(atan2(dx, -dy) - v.yaw);
    // past the target and too close to turn onto it: fly on until there is room, then re-pick and come back
    // (a craft turns in a circle of ~75 px: a target nearer than that and off the nose can never be reached by
    // turning harder — round 1 of the P0 had pilots orbiting one gun for ten minutes)
    if (this.out > 0 || (dist < 90 && Math.abs(err) > 0.5)) {
      if (this.out === 0) this.out = 1;
      if (dist > this.extend) { this.out = 0; this.target = this.choose(v); }
      else return this.steer(v, 0, dist, t);
    }
    return this.steer(v, err, dist, t);
  }
}

/** The autopilot: tower first, in on the deck, thrusters whenever there is energy, a roll for every shell. */
export class AssaultAutopilot extends Strafer {
  protected override extend = 160;
  /** a target it cannot hurt from the deck (a gun on a ledge): after 15 s without damage it comes in higher */
  private lastHp = -1;
  private since = 0;
  private high = false;
  protected choose(v: AssaultView): Emplacement | null {
    return nearest(v, (e) => e.kind === 'tower') ?? nearest(v, () => true);
  }
  protected steer(v: AssaultView, err: number, dist: number, t: Emplacement): Controls {
    let roll = false;
    for (const s of v.shells) if (hypot(s.x - v.x, s.y - v.y, s.z - v.z) < AssaultRules.shellHit + AssaultRules.shellSpeed * 0.3 + 20) roll = true;
    if (t.hp !== this.lastHp) { this.lastHp = t.hp; this.since = v.tick; this.high = false; }
    else if (v.tick - this.since > 900) this.high = true;
    // on the deck until the guns can bear, then up to the target's height
    const alt = this.high ? t.z + 16 : dist > 120 ? 0 : t.z + 4;
    return controls((err * 3.2) / ASSAULT_FLIGHT.agility, 0, alt, !v.dry && v.energy > 0.2, roll);
  }
}

export const AssaultRefHabits = { lagTicks: 14, wobble: 0.05, gain: 1.9, dodge: 0.5, spread: 0.2, approach: 14, deckUntil: 170 } as const;

/** The reference player: nearest thing first, late and wobbly, timid with the thrusters, rolls for half the
 *  shells it notices, comes in lowish but does not plan the deck. Options turn it into the P0's controls. */
export class AssaultReference extends Strafer {
  private readonly dice: RngState;
  private readonly lag: number;
  private readonly wobble: number;
  private readonly gain: number;
  private readonly phase: number;
  private readonly seen: number[] = [];
  private shellAt = -1;
  private will = false;

  constructor(seed: number, private readonly opt: { neverRoll?: boolean; neverSkim?: boolean; tower?: 'first' | 'last' } = {}) {
    super();
    this.dice = rngState(seed * 2654435761 + 131);
    const H = AssaultRefHabits;
    const j = (): number => 1 + (next(this.dice) * 2 - 1) * H.spread;
    this.lag = Math.max(4, Math.round(H.lagTicks * j()));
    this.wobble = H.wobble * j();
    this.gain = H.gain * j();
    this.phase = next(this.dice) * 6.283;
    this.extend = 170 * j();
  }
  protected choose(v: AssaultView): Emplacement | null {
    if (this.opt.tower === 'first') return nearest(v, (e) => e.kind === 'tower') ?? nearest(v, () => true);
    if (this.opt.tower === 'last') return nearest(v, (e) => e.kind === 'gun') ?? nearest(v, () => true);
    return nearest(v, () => true);
  }
  protected steer(v: AssaultView, err: number, dist: number, t: Emplacement): Controls {
    const H = AssaultRefHabits;
    const tt = v.tick / 60;
    this.seen.push(err + this.wobble * (0.6 * sin(tt * 1.3 + this.phase) + 0.4 * sin(tt * 2.9 + this.phase * 2)));
    if (this.seen.length > this.lag) this.seen.shift();
    const old = this.seen[0];
    let near = false;
    for (const s of v.shells) if (hypot(s.x - v.x, s.y - v.y, s.z - v.z) < 34) near = true;
    if (near && this.shellAt < 0) { this.shellAt = v.tick; this.will = next(this.dice) < H.dodge; }
    if (!near) this.shellAt = -1;
    const roll = !this.opt.neverRoll && near && this.will && v.tick - this.shellAt >= 3;
    // it has read the briefing: in on the deck, up for the attack (a late, sloppy version of what the autopilot does)
    const alt = this.opt.neverSkim ? Math.max(t.z + H.approach, v.floor + 30) : dist > H.deckUntil ? 0 : t.z + H.approach;
    return controls((old * this.gain) / ASSAULT_FLIGHT.agility, 0, clamp(alt, 0, 500), !v.dry && v.energy > 0.7 && Math.abs(old) < 0.14 && dist > 150, roll);
  }
}
