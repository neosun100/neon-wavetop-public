/** Tilt control: turning a phone's orientation into input. Pure mapping (tested); the page owns the listeners.
 *  Angles are the DeviceOrientation ones, in degrees: beta = front-back (0 flat, 90 upright), gamma = left-right.
 *  `angle` is the screen's rotation (0 portrait, 90 / 270 landscape): the axes swap with it. */
export const TiltLimits = {
  /** degrees of tilt ignored around neutral, and the tilt that is full deflection */
  dead: 4,
  full: 26,
  /** forward tilt (degrees past neutral) that is the skim order on a course */
  skimAt: 16,
  /** backward tilt (degrees past neutral) that is the boost order on a course — pulling the stick back */
  boostAt: 14,
  /** a shove of the phone along the line of sight (m/s², gravity excluded) = a burst of boost; the pause after one
   *  (the stop at the end of a shove is a second spike) and how long the burst lasts (ms) */
  pushAccel: 6,
  pushPause: 500,
  pushHold: 1200,
  /** rotation rate (deg/s) that counts as a flick = the roll call, and the pause after one (ms) */
  flickRate: 240,
  flickPause: 600,
} as const;

export interface Neutral { beta: number; gamma: number }
export interface TiltInput {
  /** −1 (left) .. 1 (right) */
  turn: number;
  /** −1 (dive: tilted forward) .. 1 (climb: tilted back) */
  climb: number;
  /** tilted forward far enough to mean "skim" */
  skim: boolean;
  /** tilted back far enough to mean "boost" (a course only: in open skies back is climb) */
  boost: boolean;
}

const shape = (deg: number): number => {
  const a = Math.abs(deg);
  if (a <= TiltLimits.dead) return 0;
  return Math.sign(deg) * Math.min(1, (a - TiltLimits.dead) / (TiltLimits.full - TiltLimits.dead));
};

/** `neutral` is how the phone was held when tilt was switched on (or the run began): input is relative to it. */
export function tiltInput(beta: number, gamma: number, angle: number, neutral: Neutral): TiltInput {
  const db = beta - neutral.beta;
  const dg = gamma - neutral.gamma;
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  // left-right and front-back in the SCREEN's frame
  let lr: number;
  let fb: number;
  if (a === 90) { lr = db; fb = -dg; } else if (a === 270) { lr = -db; fb = dg; } else if (a === 180) { lr = -dg; fb = -db; } else { lr = dg; fb = db; }
  // tilting the top edge away (forward) lowers `fb`: that is a dive, like pushing a stick
  return { turn: shape(lr), climb: shape(fb), skim: fb < -TiltLimits.skimAt, boost: fb > TiltLimits.boostAt };
}

/** A flick of the wrist: any axis turning faster than the limit. */
export function isFlick(alpha: number | null, beta: number | null, gamma: number | null): boolean {
  return Math.max(Math.abs(alpha ?? 0), Math.abs(beta ?? 0), Math.abs(gamma ?? 0)) > TiltLimits.flickRate;
}

/** A shove: the phone pushed away or pulled in along the screen's normal. Either sign counts — which way is positive
 *  differs between phone systems, and a shove is a spike one way then the other anyway. */
export function isPush(z: number | null | undefined): boolean {
  return Math.abs(z ?? 0) > TiltLimits.pushAccel;
}
