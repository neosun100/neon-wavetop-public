// The tuned table is what the game plays (wiring), covers every level, and is at full precision.
import { describe, expect, it } from 'vitest';
import { dailyLevel, ENDLESS, LEVELS } from '../src/core/levels';
import { FINGERPRINT, TUNED } from '../src/core/levels.tuned';
import { Rules, Run } from '../src/core/sim';
import { parOf, payOf } from '../src/core/tuned';
import { trialsOf, worldOf } from '../src/core/worlds';

describe('tuned levels', () => {
  it('every campaign level has a measured pay, a par and the autopilot time, under a fingerprint', () => {
    expect(FINGERPRINT).toMatch(/^[0-9a-f]{16}$/);
    for (const l of LEVELS) {
      const t = TUNED[l.id];
      expect(t, l.name[0]).toBeDefined();
      expect(Number.isInteger(t.payCs) && t.payCs >= 120 && t.payCs < 1500, `${l.name[0]} pay ${t.payCs}`).toBe(true);
      expect(t.ai).toBeLessThan(t.par);
      expect(Math.abs(t.ref - l.target), `${l.name[0]} reference win rate ${t.ref}`).toBeLessThanOrEqual(0.15);
    }
  });

  it('the game plays the tuned value: a run started the way the app starts it has that clock', () => {
    for (const l of LEVELS) {
      const run = new Run(worldOf(l), l, payOf(l));
      expect(run.clock).toBe(Rules.clockBase + Rules.clockGates * (TUNED[l.id].payCs / 100));
      expect(parOf(l)).toBe(TUNED[l.id].par);
    }
    for (const t of trialsOf()) {
      expect(TUNED[t.id], t.name[0]).toBeDefined();
      expect(Math.abs(TUNED[t.id].ref - t.target), `${t.name[0]} reference win rate`).toBeLessThanOrEqual(0.15);
      expect(new Run(worldOf(t), t, payOf(t)).clock).toBe(Rules.clockBase + Rules.clockGates * (TUNED[t.id].payCs / 100));
    }
    expect(() => payOf({ ...LEVELS[0], id: 999 })).toThrow(/level_not_tuned/);
    expect(payOf(ENDLESS)).toBeGreaterThan(0);
    expect(payOf(dailyLevel(20261117))).toBeGreaterThan(0);
  });
});
