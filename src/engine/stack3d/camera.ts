/* GENERATED from gameforge/src/stack3d/camera.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Stack3D kit — one camera for every view.
 *
 *  A world point lands on screen at
 *      scale = S / (1 + q·depth)      x = Cx + scale·across      y = Cy − scale·(height − alt + tan·depth)
 *  where (across, depth) is the ground offset from the camera's focus turned by the view heading.
 *  With q = 0 this is the flat sprite-stack view: nothing shrinks and every layer of height is drawn `scale` px
 *  above the last. Raising q brings the eye in behind the focus: far things shrink and a horizon appears at
 *  y = Cy − S·tan/q. A view change only slides q, tan, S, Cy and the heading, so it is one continuous move with no
 *  cut — the design idea the whole kit is built on. DOM-free. */
import { clamp, wrapAngle } from './math';
import { groundAt, type StackWorld } from './world';

export class StackCamera {
  /** the focus: the point the view is centred on */
  x = 0;
  y = 0;
  alt = 0;
  /** view heading (the world is turned by this before it is drawn) */
  yaw = 0;
  /** 1 / eye distance: 0 = flat stack view */
  q = 0;
  /** how steeply the view looks down (tan of the angle; 1 = 45°) */
  tan = 1;
  /** pixels per world pixel at the focus */
  scale = 1;
  /** where the focus sits in the frame */
  cx = 0;
  cy = 0;
  cos = 1;
  sin = 0;
  /** result of the last `project`: screen x, y, scale there, and depth into the view */
  sx = 0;
  sy = 0;
  sm = 0;
  sv = 0;

  turn(yaw: number): void {
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }

  /** World point → `sx, sy, sm, sv`; false when it is behind (or too close to) the eye. */
  project(x: number, y: number, z: number): boolean {
    const dx = x - this.x;
    const dy = y - this.y;
    const depth = -(dx * this.sin + dy * this.cos);
    const den = 1 + this.q * depth;
    if (den < 0.12) return false;
    this.sv = depth;
    this.sm = this.scale / den;
    this.sx = this.cx + this.sm * (dx * this.cos - dy * this.sin);
    this.sy = this.cy - this.sm * (z - this.alt + this.tan * depth);
    return true;
  }

  /** Screen row of the horizon (−∞ in the flat view, which has none). */
  get horizon(): number {
    return this.q > 1e-7 ? this.cy - (this.scale * this.tan) / this.q : -1e9;
  }
}

export interface RigParams {
  /** chase: eye distance behind the subject, in subject lengths */
  chaseDistance: number;
  /** chase: how far down the eye looks, degrees */
  chaseAngle: number;
  /** chase: the subject's width as a share of the frame width */
  chaseSize: number;
  /** overhead: how much of the subject's heading the view turns with (0 = north-up, 1 = heading-up) */
  follow: number;
  /** seconds a view change takes */
  transition: number;
  /** a layer the chase eye stays out of (clouds): [bottom, top] heights, or null */
  avoid: readonly [number, number] | null;
}

export const RIG_DEFAULTS: RigParams = { chaseDistance: 2.6, chaseAngle: 12, chaseSize: 0.19, follow: 0.6, transition: 1.4, avoid: null };

/** What the rig follows (a craft, a car, a character). */
export interface RigSubject {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  /** on-screen size of the subject in world pixels */
  length: number;
  width: number;
  /** −0.5..0.5: climbing / diving — the chase eye drops behind a climb and rises over a dive */
  tilt: number;
  /** 0..1: under thrust the eye closes in a little, which widens the view */
  boost: number;
}

/** Follows a subject and blends two camera poses — overhead (flat stack) and chase (behind, with a horizon).
 *  Presentation only: nothing here may feed the simulation. */
export class ViewRig {
  readonly cam = new StackCamera();
  p: RigParams;
  /** 0 = overhead, 1 = chase */
  target: 0 | 1;
  /** how far into the chase view the camera is, 0..1 */
  chase: number;
  /** the screen row that means "hold this height" for pointer steering */
  steerY = 0;
  private w: [number, number, number];
  private fx = 0;
  private fy = 0;
  private falt = 0;
  private topYaw = 0;
  private chaseYaw = 0;
  private yawDiff = 0;
  private fix = 0;
  private floor = 0;
  private lean = 1;

  constructor(p: Partial<RigParams> = {}, view: 0 | 1 = 0) {
    this.p = { ...RIG_DEFAULTS, ...p };
    this.target = view;
    this.chase = view;
    this.w = [view, view, view];
  }

  /** Put the camera on the subject at once (start of a run). */
  seat(s: RigSubject): void {
    this.fx = s.x;
    this.fy = s.y;
    this.falt = s.z;
    this.topYaw = -s.yaw * this.p.follow;
    this.chaseYaw = -s.yaw;
    this.yawDiff = wrapAngle(this.chaseYaw - this.topYaw);
    this.fix = 0;
    this.floor = 0;
  }

  toggle(): void {
    this.target = this.target === 0 ? 1 : 0;
  }

  step(dt: number, s: RigSubject, world: StackWorld): void {
    // the weight glides to its goal through three soft stages: a change starts and ends gently and can be
    // redirected half-way without a jolt
    const ease = 1 - Math.exp((-dt * 7.6) / clamp(this.p.transition, 0.2, 8));
    let settled = true;
    for (let i = 0; i < 3; i++) {
      this.w[i] += ((i === 0 ? this.target : this.w[i - 1]) - this.w[i]) * ease;
      if (Math.abs(this.w[i] - this.target) > 0.0004) settled = false;
    }
    if (settled) this.w.fill(this.target);
    const vC = (this.chase = this.w[2]);

    // overhead looks a little ahead of the subject; from behind it sits on it
    const look = (22 + 16 * s.boost) * (1 - vC);
    const tx = s.x + Math.sin(s.yaw) * look;
    const ty = s.y - Math.cos(s.yaw) * look;
    const kc = 1 - Math.exp(-dt * 3.5);
    this.fx += s.vx * dt + (tx - (this.fx + s.vx * dt)) * kc;
    this.fy += s.vy * dt + (ty - (this.fy + s.vy * dt)) * kc;
    this.falt += (s.z - this.falt) * (1 - Math.exp(-dt * 3));
    this.topYaw += (-s.yaw * clamp(this.p.follow, 0, 1) - this.topYaw) * (1 - Math.exp(-dt * 1.6));

    // the chase eye keeps clear of the hills behind the subject and out of the avoided layer
    let fix = 0;
    this.floor = 0;
    const c = this.cam;
    if (vC > 0.3 && c.q > 1e-4) {
      const back = 1 / c.q;
      const gx = this.fx + c.sin * back;
      const gy = this.fy + c.cos * back;
      let top = 0;
      for (let iy = -1; iy <= 1; iy++) for (let ix = -1; ix <= 1; ix++) top = Math.max(top, groundAt(world, gx + ix * 9, gy + iy * 9));
      this.floor = top + 5;
      const nominal = this.falt + this.lean * back;
      let want = Math.max(nominal, this.floor);
      const av = this.p.avoid;
      if (av && want > av[0] - 3 && want < av[1] + 3) want = s.z < av[0] - 8 ? Math.max(this.floor, av[0] - 3) : av[1] + 3;
      fix = want - nominal;
    }
    this.fix += (fix - this.fix) * (1 - Math.exp(-dt * 7));
    // the chase heading swings round a beat late in turns; the difference to the overhead heading is kept
    // continuous so a view change never spins the long way round
    this.chaseYaw += (-s.yaw - this.chaseYaw) * (1 - Math.exp(-dt * 3.4));
    const raw = this.chaseYaw - this.topYaw;
    if (vC === 0) this.yawDiff = wrapAngle(raw);
    else this.yawDiff += wrapAngle(raw - this.yawDiff);
  }

  /** Write the blended pose into `cam` for a W × H frame. */
  aim(W: number, H: number, s: RigSubject): void {
    const c = this.cam;
    const vC = this.chase;
    c.cx = W >> 1;
    c.x = this.fx;
    c.y = this.fy;
    c.alt = this.falt;
    if (vC === 0) {
      c.q = 0;
      c.tan = 1;
      this.lean = 1;
      c.scale = 1;
      c.cy = H >> 1;
      this.steerY = c.cy;
      c.turn(this.topYaw);
      return;
    }
    const top = 1 - vC;
    const dist = clamp(this.p.chaseDistance, 1, 8) * s.length * (1 - 0.16 * s.boost);
    const zoom = Math.max(1, (clamp(this.p.chaseSize, 0.05, 0.6) * W) / Math.max(1, s.width));
    c.q = vC / dist;
    // scales blend in log space: the zoom feels even all the way through the move
    c.scale = Math.exp(vC * Math.log(zoom));
    const angle = (45 * top + clamp(this.p.chaseAngle, 2, 40) * vC) * (Math.PI / 180);
    this.lean = Math.tan(angle) - 0.5 * s.tilt * vC;
    c.tan = Math.max(this.lean + this.fix * c.q, (this.floor - c.alt) * c.q, (2 - c.alt) * c.q);
    c.cy = top * (H >> 1) + vC * ((H >> 1) + H * (0.14 - 0.03 * s.boost));
    this.steerY = c.cy;
    c.turn(this.topYaw + this.yawDiff * vC);
  }
}

/** The cockpit view: the eye sits in the craft and looks at a point ahead of the nose. */
export const Cockpit = {
  /** the view is centred this far ahead of the craft, px */
  look: 64,
  /** the pilot's eyes, px above the craft's middle (before its scale) */
  eye: 3,
  /** the row the view rolls about, as a share of the frame height */
  pivot: 0.34,
  /** focal length as a share of the frame width */
  focal: 0.6,
  /** the view follows the bank up to this roll (radians): beyond it the sheet the world is drawn on would have to
   *  be much larger than the frame */
  maxRoll: 0.5,
} as const;

/** Aim `cam` from the seat for a W × H frame. `pitch` is the craft's; `scale` its drawn scale. Returns the focal
 *  length in frame px (the cockpit's instruments need it). */
export function aimCockpit(cam: StackCamera, W: number, H: number, s: RigSubject, pitch: number, scale: number): number {
  const K = Cockpit;
  const focal = W * K.focal * (1 - 0.1 * s.boost);
  cam.x = s.x + Math.sin(s.yaw) * K.look;
  cam.y = s.y - Math.cos(s.yaw) * K.look;
  cam.alt = s.z + K.eye * scale;
  cam.q = 1 / K.look;
  cam.scale = focal / K.look;
  // level, but never looking up out of the ground
  cam.tan = Math.max(0, (2 - cam.alt) * cam.q);
  cam.cx = W >> 1;
  // a climb drops the horizon
  cam.cy = Math.round(H * K.pivot) + focal * Math.tan(clamp(pitch * 0.8, -0.6, 0.6));
  cam.turn(-s.yaw);
  return focal;
}

/** The size of the sheet the world is drawn on before it is turned by up to `Cockpit.maxRoll` into a W × H frame. */
export function cockpitSheet(W: number, H: number): { w: number; h: number } {
  const c = Math.cos(Cockpit.maxRoll);
  const s = Math.sin(Cockpit.maxRoll);
  const tall = Math.max(H * Cockpit.pivot, H * (1 - Cockpit.pivot));
  return { w: (Math.ceil(c * (W / 2) + s * tall) + 2) * 2, h: (Math.ceil(c * tall + s * (W / 2)) + 2) * 2 };
}
