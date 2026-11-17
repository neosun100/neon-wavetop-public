// UI pure functions: tilt mapping. Mutations U1–U3 in mutations.txt.
import { describe, expect, it } from 'vitest';
import { isFlick, isPush, tiltInput, TiltLimits } from '../src/ui/tilt';

describe('tilt control', () => {
  const n = { beta: 40, gamma: 0 };

  it('portrait: right tilt turns right, back climbs, forward dives; a small wobble is ignored; it saturates', () => {
    expect(tiltInput(40, 0, 0, n)).toEqual({ turn: 0, climb: 0, skim: false, boost: false });
    expect(tiltInput(42, -3, 0, n)).toEqual({ turn: 0, climb: 0, skim: false, boost: false }); // inside the dead zone
    expect(tiltInput(40, 15, 0, n).turn).toBeCloseTo(0.5, 6);
    expect(tiltInput(40, -15, 0, n).turn).toBeCloseTo(-0.5, 6);
    expect(tiltInput(40, 80, 0, n).turn).toBe(1);
    expect(tiltInput(55, 0, 0, n).climb).toBeGreaterThan(0);
    expect(tiltInput(25, 0, 0, n).climb).toBeLessThan(0);
  });

  it('input is relative to how the phone was held, not to flat', () => {
    expect(tiltInput(70, 10, 0, { beta: 70, gamma: 10 })).toEqual({ turn: 0, climb: 0, skim: false, boost: false });
    expect(tiltInput(70, 10, 0, n).climb).toBe(1);
  });

  it('forward past the threshold is the skim order, and only forward', () => {
    expect(tiltInput(40 - TiltLimits.skimAt - 1, 0, 0, n).skim).toBe(true);
    expect(tiltInput(40 - TiltLimits.skimAt + 1, 0, 0, n).skim).toBe(false);
    expect(tiltInput(40 + 30, 0, 0, n).skim).toBe(false);
  });

  it('the axes follow the screen: in landscape, front-back tilt of the device is left-right of the screen', () => {
    expect(tiltInput(40 + 15, 0, 90, n).turn).toBeCloseTo(0.5, 6);
    expect(tiltInput(40 + 15, 0, 270, n).turn).toBeCloseTo(-0.5, 6);
    expect(tiltInput(40, 20, 90, n).climb).toBeLessThan(0);
    expect(tiltInput(40, 20, 270, n).climb).toBeGreaterThan(0);
    expect(tiltInput(40, 15, 180, n).turn).toBeCloseTo(-0.5, 6);
    // an angle a little off a quarter turn is read as that quarter turn
    expect(tiltInput(40 + 15, 0, 88, n).turn).toBeCloseTo(0.5, 6);
  });

  it('a flick is a fast turn on any axis; missing readings are not one', () => {
    expect(isFlick(0, 0, TiltLimits.flickRate + 1)).toBe(true);
    expect(isFlick(-(TiltLimits.flickRate + 1), 0, 0)).toBe(true);
    expect(isFlick(100, 100, 100)).toBe(false);
    expect(isFlick(null, null, null)).toBe(false);
  });

  it('leaning back past the limit is the boost order and forward is not; a shove is a spike either way', () => {
    expect(tiltInput(40 + TiltLimits.boostAt + 1, 0, 0, n).boost).toBe(true);
    expect(tiltInput(40 + TiltLimits.boostAt - 1, 0, 0, n).boost).toBe(false);
    expect(tiltInput(40 - 30, 0, 0, n).boost).toBe(false);
    expect(isPush(TiltLimits.pushAccel + 1)).toBe(true);
    expect(isPush(-(TiltLimits.pushAccel + 1))).toBe(true);
    expect(isPush(2)).toBe(false);
    expect(isPush(null)).toBe(false);
  });
});
