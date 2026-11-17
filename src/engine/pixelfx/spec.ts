/* GENERATED from gameforge/src/pixelfx/spec.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/** The registry entry type for an adopted pixelfx effect (design 05 §2.2). Measured fields are pinned by
 *  tests/pixelfx.test.ts T-V6. */
import type { FxModule } from './vendor/core/index.js';

export type PfxClass = 'small' | 'medium' | 'big';
export interface PfxSpec {
  readonly id: string;
  readonly mod: FxModule;
  /** drives the concurrency caps (PixelLimits.maxByClass) */
  readonly cls: PfxClass;
  /** peak art px whose light luma > 0.15 at light = 1, seed 1, CYAN (measured, T-V6) */
  readonly litPx: number;
  /** peak painter writes per frame, max over seeds 1/2/3/7 (measured, T-V6): what the layer budgets (writesFrame) */
  readonly writes: number;
  /** s of wall time between two spawns of this spec on one layer */
  readonly minGap: number;
  /** strength of its t≈0 flash; goes through the SAME FlashGuard as shell.flashKick (one light event per moment) */
  readonly heroFlash?: number;
  /** art-px offset that cancels a side-view anchor (collect-burst draws round CY = -30) */
  readonly topDown?: { readonly dy: number };
  /** which effect option takes SpawnReq.accent ('accent' for plasma, 'core' for firework) */
  readonly accentKey?: string;
  /** our defaults over the effect's own (height 0: top-down games have no floor to lift off) */
  readonly opts?: Readonly<Record<string, unknown>>;
  /** at AI ≥ ×8 a medium falls back to this small spec (crit → hit-spark, design 05 §3.3) */
  readonly fallback?: PfxSpec;
  /** one-line art direction, 12..180 chars (pixelfx meta.desc rule) */
  readonly desc: string;
}
