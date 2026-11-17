/* GENERATED from gameforge/src/pixelfx/vendor/core/index.js — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
// neon-engine slim barrel (NOT upstream): the same exports as pixelfx's src/core/index.js minus
// actor-acting/scene/rig/poses/chain, which no adopted effect uses and which allocate grids at import.
// Effects import "../../core/index.js" and so stay byte-identical to upstream. A dropped export that an
// effect needs fails the build loudly (tests/pixelfx.test.ts T-V2 imports every effect).
export * from "./math.js";
export * from "./color.js";
export * from "./particles.js";
export * from "./shapes.js";
export { Particles, Bits, Lights, Blazes, P, PF, B, GRAVITY, FIRE_RAMP, SMOKE_RAMP, sparkle, flare, band, crystal } from "./sim.js";
export { Painter } from "./painter.js";
export { FONTS, textWidth } from "./font.js";
export { createFrame, clearFrame, createFx, composite, painterFor, resolveOptions } from "./fx.js";
