/* GENERATED from gameforge/src/stack3d/cockpit.d.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** Types of `./cockpit.js` (the cockpit view's painted layers and live instruments). */
export interface CockpitArt {
  W: number;
  H: number;
}
export interface CockpitLive {
  time: number;
  /** 0..1: how far the cockpit has slid into place round the camera, and how far the head-up display has faded in */
  inPlace: number;
  hud: number;
  /** the view's roll, the craft's pitch and heading (radians) */
  roll: number;
  pitch: number;
  heading: number;
  speed: number;
  speedMax: number;
  alt: number;
  altMax: number;
  /** −1..1 */
  climb: number;
  turn: number;
  /** 0..1 */
  boost: number;
  /** the screen row the view rolls about, the row of the horizon, and the focal length in frame px */
  pivotY: number;
  horizonY: number;
  focal: number;
  /** the pilot's head sway, design px (right and down positive) */
  headX: number;
  headY: number;
  /** where the sun is from the seat (−1 left … 1 right), how far its light reaches, its colour (0xAABBGGRR) and power */
  sunSide: number;
  sunReach: number;
  sunColor: number;
  sunPower: number;
  /** radar: what lies `right` / `ahead` px of the craft — 0 deep water · 1 shallows · 2 land · 3 high ground */
  land: (right: number, ahead: number) => number;
  /** radar blips: pairs (right, ahead) in px */
  blips: number[];
  /** the craft from above for the status screen: 0 empty · 1 body · 2 paint · 3 glass */
  jet: { w: number; h: number; cells: Uint8Array };
}
/** Paint the fixed parts for a W × H frame. `body`: 9 tones dark → light; `hot`: 6 accent tones. Colours are 0xAABBGGRR. */
export function buildCockpit(W: number, H: number, pal: { body: number[]; hot: number[] }): CockpitArt;
/** Lay the cockpit over the frame buffer (W × H of the art) and draw its live parts. */
export function drawCockpit(fb: Uint32Array, art: CockpitArt, live: CockpitLive): void;
