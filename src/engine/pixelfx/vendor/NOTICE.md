<!-- GENERATED from gameforge/src/pixelfx/vendor/NOTICE.md — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. -->
# Notices

**Hugo Duprez.** `src/core/sim.js` and the effects that say so at the top of their file adapt Sprite Fusion's
open-source pixel art VFX (https://www.spritefusion.com/pixel-art-vfx), Copyright (c) 2026 Hugo Duprez, MIT License.

**Hollow Crown.** `src/core/act.js` adapts how Hollow Crown plays its skills (poses on 12 fps steps, hit-stops, the springy
straw target), from
https://github.com/rehan-remade/hollow-crown, Copyright (c) 2026 rehan-remade, MIT License.

**Patch Pixel.** The font in `gallery/fonts` is Patch's own and is not covered by this repository's MIT license. See
`gallery/fonts/NOTICE.md`.

---

## neon-engine vendoring (appended by neon-engine, not upstream)

Vendored from pixelfx (https://github.com/patch-gg/pixelfx, MIT License, Copyright (c) 2026 Patch and
Copyright (c) 2026 Hugo Duprez — see LICENSE in this folder) at commit a84159688af3ca37a4be05a0d422b94451b2e24e.

- Included: the runtime core (`core/*.js`, minus act/rig/scene/poses/chain) and 8 effects, listed with hashes in
  PROVENANCE.json. Effects adapted from Sprite Fusion keep their per-file attribution to Hugo Duprez.
- **Not included: `gallery/fonts`** (Patch Pixel font — not covered by the MIT license). No file here references it.
- **Not included: `core/act.js`** (adapts Hollow Crown, Copyright (c) 2026 rehan-remade, MIT). neon-engine's
  `src/juice.ts` is our own code modelled on the ideas in act.js (hit-stop, quantised shake, reaction spring,
  after-images); it copies no code from it. The Hollow Crown notice above is kept for that lineage.
- `core/index.js` is our slim barrel; `fx/explosions/{firework-burst,implosion,plasma-explosion}.js`,
  `fx/impacts/ricochet.js` and `fx/pickups/collect-burst.js` carry small marked patches (PROVENANCE.json → patches).
