/** Block models authored as functions (no art files): the balloon and the flak gun, and the palettes of the
 *  rival and personal-best ghosts. Presentation only. */
import { buildModel, makeSprite, type PaletteRow, type StackSprite } from '../engine/stack3d/model';
import { JET_PALETTE } from './jet';

/** Balloon: a striped envelope over a little basket. 11 × 11 × 14. */
export const BALLOON: StackSprite = makeSprite(
  buildModel(11, 11, 14, (i, k, y) => {
    const dx = i - 5;
    const dz = k - 5;
    if (y <= 1) return Math.abs(dx) <= 1 && Math.abs(dz) <= 1 ? 34 : 0; // basket
    if (y <= 3) return (Math.abs(dx) === 1 || dx === 0) && Math.abs(dz) === 1 && y === 3 ? 0 : Math.abs(dx) === 2 && Math.abs(dz) === 2 ? 35 : 0; // ropes
    const dy = y - 9;
    const d2 = dx * dx + dz * dz + dy * dy * 1.1;
    if (d2 > 24) return 0;
    // six gores: alternate by octant so the stripes turn with the model
    const gore = (dx >= 0 ? 1 : 0) ^ (dz >= 0 ? 1 : 0) ^ (Math.abs(dx) > Math.abs(dz) ? 1 : 0);
    const tone = dy > 2 ? 3 : dy < -2 ? 1 : 2;
    return (gore ? 0 : 16) + tone + 1;
  }),
  5, 6,
);
export const BALLOON_PALETTE: readonly PaletteRow[] = [
  [1, 150, 24, 60], [2, 196, 38, 76], [3, 236, 60, 96], [4, 255, 132, 150], [5, 255, 196, 204],
  [17, 196, 150, 60], [18, 236, 196, 84], [19, 255, 232, 120], [20, 255, 246, 190], [21, 255, 252, 230],
  [33, 70, 46, 30], [34, 112, 76, 48], [35, 160, 116, 76], [36, 200, 160, 110],
];
/** drawn all white for a few ticks when hit */
export const FLASH_PALETTE: readonly PaletteRow[] = Array.from({ length: 60 }, (_, i) => [i + 1, 255, 255, 255] as const);

/** Flak gun: a squat block base, a turret and a raised barrel. 9 × 13 × 8. */
export const GUN: StackSprite = makeSprite(
  buildModel(9, 13, 8, (i, k, y) => {
    const dx = i - 4;
    const dz = k - 8;
    if (y <= 2) return Math.abs(dx) <= 4 && Math.abs(dz) <= 4 ? (y === 2 && (Math.abs(dx) === 4 || Math.abs(dz) === 4) ? 4 : 2 + (y === 0 ? 0 : 1)) : 0;
    if (y <= 5 && dx * dx + dz * dz <= 7) return y === 5 ? 5 : 4;
    // the barrel points forward and up
    if (y >= 4 && Math.abs(dx) <= 0 && k >= 1 && k <= 7 && y === 4 + Math.round((7 - k) * 0.5)) return k <= 1 ? 50 : 6;
    if (y === 6 && dx === 0 && dz === 0) return 51; // warning lamp
    return 0;
  }),
  8, 0,
);
export const GUN_PALETTE: readonly PaletteRow[] = [
  [1, 30, 34, 44], [2, 52, 58, 72], [3, 74, 80, 98], [4, 104, 110, 128], [5, 140, 146, 162], [6, 178, 184, 196], [7, 214, 218, 226],
  [49, 120, 30, 20], [50, 255, 150, 60], [51, 255, 70, 40],
];

/** The rival (the autopilot's run): the same airframe in cyan trim. */
export const RIVAL_PALETTE: readonly PaletteRow[] = JET_PALETTE.map(([i, r, g, b]) => (i >= 17 && i <= 32 ? ([i, b * 0.35, Math.min(255, g * 1.6 + 60), Math.min(255, r * 1.05)] as const) : ([i, r, g, b] as const)));
/** The player's own best run: a pale ghost. */
export const BEST_PALETTE: readonly PaletteRow[] = JET_PALETTE.map(([i, r, g, b]) => [i, 150 + r * 0.4, 160 + g * 0.37, 176 + b * 0.3] as const);
