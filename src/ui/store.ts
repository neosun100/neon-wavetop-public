/** Progress, settings and recorded playtests, in this browser only. Storage can be blocked (private window,
 *  embedded preview): the game then runs on memory and `ok` is false, which the menu says out loud. */
import type { PlaytestRecord } from '../core/playtest';

export interface Save {
  stars: Record<number, number>;
  /** best clear time per level, ticks */
  best: Record<number, number>;
  /** inputs (run-length pairs) of that best run: the personal-best ghost */
  bestInputs: Record<number, number[]>;
  endlessBest: number;
  attempts: Record<number, number>;
  records: PlaytestRecord[];
  lang: 0 | 1 | -1;
  mute: boolean;
  stick: boolean;
  rival: boolean;
  ghost: boolean;
  /** the daily run: the day (yyyymmdd, UTC) of the best below */
  dailyDay: number;
  dailyBest: number;
  /** levels cleared without missing a ring */
  perfect: Record<number, boolean>;
  /** open skies: 32 rows of 32 bits, one per 64 px cell that has been flown over */
  fog: number[];
  /** open skies: where the craft was last (free flight resumes there) */
  roam: { x: number; y: number; z: number; yaw: number } | null;
  /** the pilot's log: totals over every clean commanded run (what the commander did, not what the AI did) */
  log: { runs: number; wins: number; rings: number; kicks: number; dodges: number; hits: number; stunts: number; bullseyes: number; ticks: number };
  /** steer by tilting the phone; `tiltSet` = the player has chosen (until then a touch device starts with it on) */
  tilt: boolean;
  tiltSet: boolean;
  /** standing orders: hunt balloons, and how hard to push the line (0 safe · 1 normal · 2 racing) */
  hunt: boolean;
  line: number;
  /** index of the autopilot speed tier last chosen */
  aiSpeed: number;
}

/** Caps: a save must stay far under the ~5 MB a browser gives one origin. */
export const StoreLimits = { records: 60, key: 'wavetop.v1' } as const;

const fresh = (): Save => ({ stars: {}, best: {}, bestInputs: {}, endlessBest: 0, attempts: {}, records: [], lang: -1, mute: false, stick: false, rival: true, ghost: true, aiSpeed: 0, dailyDay: 0, dailyBest: 0, perfect: {}, fog: [], roam: null, hunt: true, line: 1, tilt: false, tiltSet: false, log: { runs: 0, wins: 0, rings: 0, kicks: 0, dodges: 0, hits: 0, stunts: 0, bullseyes: 0, ticks: 0 } });

export class Store {
  data: Save = fresh();
  /** false when the browser refused to read or write: nothing is persisted */
  ok = true;

  constructor() {
    try {
      const raw = localStorage.getItem(StoreLimits.key);
      // a save written by an older build may lack fields: defaults fill them, unknown fields are dropped
      if (raw) this.data = { ...fresh(), ...(JSON.parse(raw) as Partial<Save>) };
    } catch {
      this.ok = false; // blocked or corrupt: start fresh in memory; the menu shows `noSave`
    }
  }

  save(): void {
    if (this.data.records.length > StoreLimits.records) this.data.records = this.data.records.slice(-StoreLimits.records);
    try {
      localStorage.setItem(StoreLimits.key, JSON.stringify(this.data));
      this.ok = true;
    } catch {
      this.ok = false; // quota or blocked: the run still counts for this visit
    }
  }
}
