/** Builds the open map off the main thread, so the menu keeps animating while it is made and entering open skies
 *  is instant afterwards. `buildIslands` is a pure function of its options: the world built here is byte-for-byte
 *  the one the main thread (or the box) would build. */
import { buildIslands, type WorldOpts } from '../engine/stack3d/world';

self.onmessage = (e: MessageEvent<WorldOpts>): void => {
  const w = buildIslands(e.data);
  // the arrays are moved, not copied
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(w, [w.height.buffer, w.mat.buffer, w.tone.buffer, w.biome.buffer, w.cloud.buffer, w.noise.buffer]);
};
