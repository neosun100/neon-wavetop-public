/* GENERATED from gameforge/src/pixelfx/ramps.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** The neon recolour ramps for pixelfx effects (report 03 §3), dark → bright, built on particles.ts PALETTE.
 *  Every ramp starts near-black, so dithered fade-out pixels vanish into the background instead of greying it,
 *  and ends in #ffffff, which pixelfx uses only as the white-hot core (the hottest few pixels). */
export const RAMPS = {
  CYAN: ['#020b10', '#04303a', '#006a7a', '#00b4cc', '#00f0ff', '#7df9ff', '#ffffff'],
  MAG: ['#10030d', '#3d0a33', '#8a1170', '#d01fa8', '#ff2bd6', '#ff8be8', '#ffffff'],
  VIO: ['#08051a', '#1e1250', '#43279a', '#6a44d8', '#8a5cff', '#c4adff', '#ffffff'],
  GOLD: ['#120a02', '#3d2a05', '#806010', '#c99a1e', '#ffcf3a', '#ffe9a0', '#ffffff'],
  RED: ['#12030a', '#45081a', '#8f1230', '#d41d40', '#ff2a4d', '#ff9aa8', '#ffffff'],
  GRN: ['#021208', '#063d20', '#0e7a44', '#22c070', '#3dff9a', '#a8ffd2', '#ffffff'],
  ORG: ['#120702', '#4a2006', '#8f400c', '#d46614', '#ff8a1f', '#ffc58a', '#ffffff'],
} as const satisfies Record<string, readonly string[]>;

export type RampName = keyof typeof RAMPS;
