# Changelog

All notable changes to NEON WAVETOP. Versions follow `package.json`; a published tag never moves.

## [0.3.0] - 2026-11-17

> Fly it with the phone — every order by tilt, a coach for the first sectors, a pilot log · 用手机开：倾斜即全部操作，新手教练与飞行员履历

- **The whole keyboard by tilt** (on by default on a touch device, asked for at the first tap): on a course lean
  left / right to bend the line the AI flies (A / D do the same), lean back to boost, forward to skim, shove the phone
  for a burst of boost (a ring kick when timed), flick to roll; in open skies lean to turn, climb and dive. A pad
  shows both axes while the sensors are read and lights while boosting; Options says active / waiting / refused.
- Tilt on iPhone: the sensor permission is asked for when a finger lifts (a press does not count as a gesture there),
  for orientation and motion both, and again at the next tap if the browser refused the moment.
- Not yet measured on a real device: the thresholds (14° back, 6 m/s² shove) and the landscape axis signs were
  verified with synthetic sensor events only.
- Coach: in sectors 1–3, on a pilot's first tries, the call chip names the order that would help now (boost, skim)
  until it has been given once in that run.
- Pilot log: ring kicks landed, flak dodged on your call, stunts, bullseyes, time in the air, stars and rank.
- Phone HUD: the orders chip is signs only on a narrow screen; hint, banner and call no longer overlap; e2e checks
  that no HUD element runs off the screen.

## [0.2.0] - 2026-11-18

> The AI flies, you command — orders, the ring kick, a league over five biomes, and the cockpit · AI 驾驶你指挥：命令、环后点火、五海区联赛与座舱视角

- League: a mail run per region (five rings far apart — thrusters, wavetops and kicks decide it), regions that open
  by league stars (0 / 4 / 10 / 18 / 28), ranks from Cadet to Legend; 40 tuned courses in all.
- Campaign briefings rewritten for command mode (each sector teaches one order).

- **The AI flies, you command**: on every course the autopilot holds the stick; you give orders (boost, skim, hunt,
  line, the roll call when it alerts) and time the new **ring kick**. All 35 courses retuned against reference
  commanders. The old hand-flown course mode is gone; open skies keeps point-to-fly, plus fly-me-to-the-arch.
- Smoothness: a frame budget that makes the picture coarser before it gets slower, no per-frame allocation in the
  renderer, menus drawn at half rate, fewer style writes. Draw cost itself is unchanged (4.9 ms chase / 4.2 ms
  overhead at 427×267 on the box, before and after).

- Autopilot speed tiers ×1 ×2 ×4 ×8 ×16 (F, or the autopilot chip).
- Daily run: one seeded course a day for everyone, with a result line to copy.
- A short countdown before the clock starts; a ◆ for clearing a level without missing a ring; time against your best.
- BGM: a recorded, looped soundtrack on the hosted build (not in this repository); the generated tune stays as the fallback.
- Open skies · League: free flight over a five-biome map with a turning day, a map with a fog of exploration, and
  15 ring trials (3 per biome, tuned like the campaign) started by flying through their gold arches.
- Tried and dropped: island assault as the main line — vetoed in 4 pre-registered headless rounds.
- The cockpit view (V: chase → cockpit → overhead): canopy, radar, attitude indicator, status screen, head-up display.
- The open map is built in a worker; the menu no longer builds it at page load.
- Tried and dropped by pre-registered measurement: island assault (4 rounds) and forts (2 rounds).

## [0.1.0] - 2026-11-17

> First flight: a 20-level sprite-stack flight run with an autopilot to race and recorded playtests · 首飞：20 关像素堆叠飞行闯关，可与自动驾驶竞速，自带试玩记录

- Campaign: 4 chapters × 5 sectors (day, reef, dusk, night), one mechanic taught per sector; endless score attack.
- Flight on GameForge's Stack3D kit: overhead ↔ chase in one camera, block-toned islands with houses,
  lighthouses and piers, clouds, shadows.
- Rings pay time; wavetop skimming refills the thrusters; roll dodges flak and scores knife gates; guns
  auto-fire at what the nose points at.
- Autopilot: watch mode with its plan drawn, live rival ghost on every level, take-over on Q; personal-best ghost.
- Stars: clear · under par (reference median) · beat the autopilot.
- Difficulty measured, not guessed: pay per ring tuned against 48 reference pilots per level
  (`scripts/levels.ts --tune` / `--check`).
- Human playtests: every clean run recorded locally with its inputs, exportable; `scripts/playtest.ts`
  replays and compares people with the reference player.
- English / 中文, mouse / keys / touch, generated sound.
- Not done: no human run collected yet; no pre-registered P0; Chromium-only e2e; not pushed.
