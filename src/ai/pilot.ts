/** The pilot is the AI. The human is its commander.
 *
 *  `Autopilot` holds the stick on every tick: it flies the line to the ring, keeps the height, respects the floor.
 *  What it does NOT decide by itself is anything that spends, risks or times something — those are `Orders`,
 *  given by whoever commands it:
 *    boost  spend energy on the thrusters           hunt  leave the line for a balloon (time on the clock)
 *    skim   go down to the wavetops for energy      push  cut the corners (0 = ring centre … 1 = racing line)
 *    nudge  lean on the stick: the AI still flies, the commander bends its line
 *    roll   NOW — the dodge and the knife-gate stunt are the commander's timing, the AI only raises the alert
 *    (and the ring kick: a boost order given just after a ring is a free surge — the commander's rhythm)
 *  With no orders it flies a safe, slow, clean course. A commander is anything that turns what is on the screen
 *  into orders: the player (the page), `ExpertCommander` (the rival ghost and "full auto"), or the reference
 *  commanders that set the difficulty (`./reference`). The autopilot reads only `PilotView`. */
import { clamp, wrapAngle } from '../engine/stack3d/math';
import { atan2, hypot } from '../engine/trig';
import { controls, FLIGHT, Rules, type Controls, type Pilot, type PilotView } from '../core/sim';

export interface Orders {
  boost: boolean;
  skim: boolean;
  hunt: boolean;
  /** roll on this tick */
  roll: boolean;
  /** 0..1 */
  push: number;
  /** −1..1: lean on the stick — added to the AI's own turn (tilt control, keys); the AI keeps correcting */
  nudge: number;
}
export const NO_ORDERS: Orders = { boost: false, skim: false, hunt: false, roll: false, push: 0, nudge: 0 };

export type Intent = 'LINE' | 'SKIM' | 'BOOST' | 'HUNT' | 'EVADE' | 'STUNT';
/** What the AI is telling its commander: a shell is about to arrive / a knife gate is about to be crossed. */
export type Alert = 'none' | 'flak' | 'knife';

export interface Plan {
  intent: Intent;
  /** the point the nose is being put on */
  ax: number;
  ay: number;
  az: number;
}

/** Weights in one place. */
export const AutoWeights = {
  /** at push = 1: how far inside the ring (in radii) the aim shifts towards the next ring, from this distance */
  cut: 0.42,
  cutFrom: 170,
  /** steer gain: turn rate asked per radian of error */
  gain: 3.2,
  /** a balloon is worth a detour of at most this many radians off the line, within this range */
  huntAngle: 0.3,
  huntRange: 190,
  /** a skim order is obeyed when there is this much room (px) to climb back to the ring */
  skimMargin: 45,
  /** a boost order is obeyed on a straight line (and anywhere above `boostAlways` energy) */
  boostAlways: 0.6,
  straight: 0.28,
  /** how much of the turn a full nudge adds (share of the maximum turn rate) */
  nudge: 0.7,
  /** inside this distance of the ring nothing else matters: no hunting, no diving */
  commit: 90,
  /** the alert is raised when a shell is this many seconds from arriving / a knife gate this many seconds ahead */
  flakLead: 0.3,
  knifeLead: 0.4,
} as const;

export class Autopilot {
  /** the last decision and alert, for the HUD and for commanders (the sim never reads them) */
  plan: Plan = { intent: 'LINE', ax: 0, ay: 0, az: 0 };
  alert: Alert = 'none';
  private prevBoost = false;

  /** What a commander needs before it gives this tick's orders. */
  scan(v: PilotView): Alert {
    const W = AutoWeights;
    const reach = Rules.shellHit + Rules.shellSpeed * W.flakLead + 20;
    for (const s of v.shells) if (hypot(v.x - s.x, v.y - s.y, v.z - s.z) < reach) return (this.alert = 'flak');
    const g = v.gate;
    if (g.knife && hypot(g.x - v.x, g.y - v.y) < v.speed * W.knifeLead) return (this.alert = 'knife');
    return (this.alert = 'none');
  }

  act(v: PilotView, o: Orders): Controls {
    const W = AutoWeights;
    const g = v.gate;
    const dx = g.x - v.x;
    const dy = g.y - v.y;
    const dist = hypot(dx, dy);
    let ax = g.x;
    let ay = g.y;
    let az = g.z;
    let intent: Intent = 'LINE';

    // push: shift the aim inside the ring towards where the next ring is
    if (o.push > 0 && v.next && dist < W.cutFrom) {
      const nx = v.next.x - g.x;
      const ny = v.next.y - g.y;
      const nl = hypot(nx, ny) || 1;
      const lx = -dy / (dist || 1);
      const ly = dx / (dist || 1);
      // a small ring leaves less room to cut
      const k = clamp((nx * lx + ny * ly) / nl, -1, 1) * W.cut * clamp(o.push, 0, 1) * Math.max(0, g.r - 6);
      ax += lx * k;
      ay += ly * k;
      az += clamp((v.next.z - g.z) / 60, -1, 1) * W.cut * clamp(o.push, 0, 1) * 0.6 * g.r;
    }

    // hunt: a balloon close to the line is free time
    const bearing = atan2(dx, -dy);
    let hunting = false;
    if (o.hunt) {
      let nearest: number = W.huntRange;
      for (const t of v.targets) {
        if (t.kind !== 'balloon') continue;
        const tx = t.x - v.x;
        const ty = t.y - v.y;
        const td = hypot(tx, ty);
        if (td > nearest || td > dist - W.commit) continue;
        if (Math.abs(wrapAngle(atan2(tx, -ty) - bearing)) > W.huntAngle) continue;
        if (Math.abs(t.z - v.z) > 0.45 * td + 10) continue;
        nearest = td;
        ax = t.x;
        ay = t.y;
        az = t.z;
        hunting = true;
      }
      if (hunting) intent = 'HUNT';
    }

    // skim: obeyed only when there is room to dive and climb back to the ring
    const climbBack = (g.z - v.floor) / 0.55;
    if (o.skim && !hunting && dist > climbBack * 1.15 + W.skimMargin + W.commit && g.z < 120) {
      az = 0;
      intent = 'SKIM';
    }

    const err = wrapAngle(atan2(ax - v.x, -(ay - v.y)) - v.yaw);
    // off the thrusters when the ring is close and the nose is not on it yet: a wide turn at speed is a miss
    const settle = dist < W.commit + 40 && Math.abs(err) > 0.1;
    // the tick a boost order arrives the thrusters open whatever the line (that edge is the ring kick's timing)
    const edge = o.boost && !this.prevBoost && !v.dry;
    this.prevBoost = o.boost;
    const thrust = edge || (o.boost && !v.dry && !settle && (v.energy > W.boostAlways || (Math.abs(err) < W.straight && dist > 70)));
    if (thrust && intent === 'LINE') intent = 'BOOST';
    if (o.roll) intent = this.alert === 'knife' ? 'STUNT' : 'EVADE';

    this.plan = { intent, ax, ay, az };
    return controls((err * W.gain) / FLIGHT.agility + clamp(o.nudge, -1, 1) * W.nudge, 0, az, thrust, o.roll);
  }
}

/** The best commander we have: orders everything the moment it pays. It is the rival ghost of every course and
 *  what "full auto" hands the craft to. It never tunes a level. */
export class ExpertCommander implements Pilot {
  readonly ai = new Autopilot();
  /** what it ordered on the last tick (the HUD shows it in full auto) */
  orders: Orders = NO_ORDERS;
  static readonly habits = { boostAbove: 0.22, skimBelow: 0.85, liftLead: 0.2, kickAligned: 0.45 } as const;

  act(v: PilotView): Controls {
    const alert = this.ai.scan(v);
    // it lifts the boost order a moment before every ring, so that re-giving it right after is a kick
    const d = hypot(v.gate.x - v.x, v.gate.y - v.y);
    const lift = d < v.speed * ExpertCommander.habits.liftLead;
    // … and does not re-give it into a hard turn: a kick while the nose is far off the next ring is a miss
    // (the first tuned run with the kick had it miss a ring in Gun Alley)
    const off = Math.abs(wrapAngle(atan2(v.gate.x - v.x, -(v.gate.y - v.y)) - v.yaw));
    const wild = off > ExpertCommander.habits.kickAligned && d < 220;
    this.orders = { boost: v.energy > ExpertCommander.habits.boostAbove && !lift && !wild, skim: v.energy < ExpertCommander.habits.skimBelow, hunt: true, roll: alert !== 'none', push: 1, nudge: 0 };
    return this.ai.act(v, this.orders);
  }
}

/** No commander at all: the autopilot's own safe course (a control for the tests, and the floor of the game). */
export class NoCommander implements Pilot {
  readonly ai = new Autopilot();
  act(v: PilotView): Controls {
    this.ai.scan(v);
    return this.ai.act(v, NO_ORDERS);
  }
}
