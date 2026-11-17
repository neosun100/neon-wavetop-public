/** The reference commander: a scripted stand-in for a casual human commanding the autopilot, and the ONLY thing
 *  course difficulty is tuned against. It is a population — each seed draws its own habits — because one
 *  deterministic reference makes win rates jump 0 → 100 % between seeds.
 *
 *  What makes it human-like (each is a way people differ from the expert commander):
 *    · it calls the roll late: it reacts `lag` ticks after the alert, and only to some of them
 *    · it rides the thrusters in bursts (on above one level, off below another), not optimally
 *    · some pilots use the wavetops, late; some never do
 *    · some hunt balloons, some stay on the line
 *    · it pushes the line only part of the way
 *    · it tries the ring kick after some rings only, and at its own reaction time — so it lands some
 *  Whether these numbers match real people is measured by `scripts/playtest.ts` against recorded human runs. */
import { next, rngState, type RngState } from '../engine/rng';
import type { Controls, Pilot, PilotView } from '../core/sim';
import { Autopilot, type Alert } from './pilot';

/** The middle of the population; each commander is drawn ± `spread` around it. */
export const RefHabits = {
  lagTicks: 13,
  /** share of flak alerts / knife gates it reacts to at all */
  dodge: 0.55,
  stunt: 0.7,
  boostOn: 0.6,
  boostOff: 0.3,
  /** share of commanders who use the wavetops, and the energy at which they call it / call it off */
  skimmers: 0.5,
  skimOn: 0.35,
  skimOff: 0.8,
  hunters: 0.5,
  push: 0.5,
  /** share of rings after which it tries the ring kick (it re-gives the boost order `lag` ticks after the ring) */
  kick: 0.4,
  spread: 0.25,
} as const;

export class ReferenceCommander implements Pilot {
  readonly ai = new Autopilot();
  /** its own stream: a commander never shares the course generator */
  private readonly dice: RngState;
  private readonly lag: number;
  private readonly boostOn: number;
  private readonly skims: boolean;
  private readonly hunts: boolean;
  private readonly push: number;
  private boosting = false;
  private skimming = false;
  private alertSince = -1;
  private last: Alert = 'none';
  private will = false;
  private ring: unknown = null;
  private pumpUntil = -1;

  constructor(seed: number, private readonly opt: { neverRoll?: boolean; neverBoost?: boolean } = {}) {
    this.dice = rngState(seed * 2654435761 + 97);
    const H = RefHabits;
    const j = (): number => 1 + (next(this.dice) * 2 - 1) * H.spread;
    this.lag = Math.max(3, Math.round(H.lagTicks * j()));
    this.boostOn = H.boostOn * j();
    this.skims = next(this.dice) < H.skimmers;
    this.hunts = next(this.dice) < H.hunters;
    this.push = Math.min(1, H.push * j());
  }

  act(v: PilotView): Controls {
    const H = RefHabits;
    const alert = this.ai.scan(v);
    // one decision per alert, made when it starts; the call itself comes `lag` ticks later
    if (alert !== 'none' && this.last === 'none') {
      this.alertSince = v.tick;
      this.will = next(this.dice) < (alert === 'flak' ? H.dodge : H.stunt);
    }
    this.last = alert;
    const roll = !this.opt.neverRoll && alert !== 'none' && this.will && v.tick - this.alertSince >= (alert === 'knife' ? Math.round(this.lag / 3) : this.lag) && !v.spinning;
    if (v.energy > this.boostOn) this.boosting = true;
    else if (v.energy < H.boostOff) this.boosting = false;
    // a new ring ahead means one was just passed: sometimes it pumps the boost for the kick, at its own pace
    if (v.gate !== this.ring) {
      if (this.ring !== null && next(this.dice) < H.kick) this.pumpUntil = v.tick + this.lag;
      this.ring = v.gate;
    }
    const pumping = v.tick < this.pumpUntil;
    if (v.tick === this.pumpUntil) this.boosting = true;
    if (this.skims) {
      if (v.energy < H.skimOn) this.skimming = true;
      else if (v.energy > H.skimOff) this.skimming = false;
    }
    return this.ai.act(v, { boost: this.boosting && !pumping && !this.opt.neverBoost, skim: this.skimming, hunt: this.hunts, roll, push: this.push, nudge: 0 });
  }
}
