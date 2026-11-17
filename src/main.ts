/** NEON WAVETOP — the page. It draws the simulation with the Stack3D kit, feeds it one quantized `Controls` per
 *  tick, and owns everything that must never feed back into it: camera, trails, smoke, sparks, sound, HUD, menus,
 *  the save and the playtest records. Test hook: `window.__wavetop`. */
import { Autopilot, ExpertCommander, type Orders } from './ai/pilot';
import { CHAPTERS, dailyLevel, DAILY_ID, ENDLESS, FREE, FREE_ID, LEVELS, SECTORS, type LevelDef } from './core/levels';
import { TUNED } from './core/levels.tuned';
import { encode, InputLog, record, type PlaytestRecord } from './core/playtest';
import { CLOUD, controls, FLIGHT, NO_INPUT, packControls, Rules, Run, TICK, unpackControls, type Controls, type Gate, type SimEvent, type Target } from './core/sim';
import { payOf } from './core/tuned';
import { ARCH_R, archAt, LEAGUE_COURSES, MAIL_TIER, rankOf, REGION_STARS, regionOpen, TRIAL_ID0, wrapDelta, type Trial } from './core/trials';
import { adoptOpen, OPEN_OPTS, openReady, trialsOf, worldOf } from './core/worlds';
import { aimCockpit, Cockpit, cockpitSheet, StackCamera, ViewRig, type RigSubject } from './engine/stack3d/camera';
import { buildCockpit, drawCockpit, type CockpitArt } from './engine/stack3d/cockpit.js';
import { bankOf, type Craft } from './engine/stack3d/flight';
import { clamp, pack, wrapAngle } from './engine/stack3d/math';
import { decodeRle, makePalette, makeSprite, modelPoint, poseAxes, type ModelPalette, type Pose } from './engine/stack3d/model';
import { StackRenderer, type Plumes, type ShadowCaster } from './engine/stack3d/render';
import type { StackWorld } from './engine/stack3d/world';
import type { TimeOfDay } from './engine/stack3d/math';
import { BALLOON, BALLOON_PALETTE, BEST_PALETTE, FLASH_PALETTE, GUN, GUN_PALETTE, RIVAL_PALETTE } from './render/models';
import { JET, JET_NOZZLES, JET_PALETTE, JET_RLE, JET_WINGTIP } from './render/jet';
import { Audio } from './ui/audio';
import { STR, type Lang, type StrKey } from './ui/i18n';
import { Store } from './ui/store';
import { isFlick, isPush, tiltInput, TiltLimits, type Neutral, type TiltInput } from './ui/tilt';

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const wrap = $('wrap');
const canvas = $<HTMLCanvasElement>('cv');
const ctx = canvas.getContext('2d')!;
const el = {
  score: $('score'), clock: $('clock'), ring: $('ring'), gap: $('gap'), alt: $('alt'), intent: $('intent'), fuel: $('fuel'),
  fuelBar: $('fuel').firstElementChild as HTMLElement, banner: $('banner'), hint: $('hint'), hurt: $('hurt'), panel: $('panel'),
  bView: $('bView'), bAuto: $('bAuto'), bBoost: $('bBoost'), bPause: $('bPause'), bSkim: $('bSkim'), call: $('call'), tiltbar: $('tiltbar'), tiltDot: $('tiltbar').firstElementChild as HTMLElement, map: $<HTMLCanvasElement>('map'),
};

const store = new Store();
const audio = new Audio();
audio.muted = store.data.mute;
let lang: Lang = store.data.lang >= 0 ? (store.data.lang as Lang) : /^zh/i.test(navigator.language) ? 1 : 0;
const t = (k: StrKey): string => STR[k][lang];
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** today as yyyymmdd in UTC: the seed of the daily run (the page reads the date; the simulation never does) */
const today = (): number => { const d = new Date(); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
const dayText = (n: number): string => `${Math.floor(n / 10000)}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`;
const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// touch = ANY touch capability, not "the primary pointer is coarse" (an iPad with a mouse reports a fine pointer)
let touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window || !!window.matchMedia?.('(any-pointer: coarse)').matches;
let touchUsed = false;
/** a mouse has moved over the page: the hint speaks mouse even on a touch-capable machine */
let mouseSeen = false;

// ── the kit: one renderer per chapter world ──
const SC = 0.6; // the jet is drawn at this scale
const sprite = makeSprite(decodeRle(JET_RLE, JET.w, JET.l, JET.h), JET.pivotK, JET.pivotY);
const renderers = new Map<StackWorld, StackRenderer>();
let R!: StackRenderer;
let world!: StackWorld;
let pal!: ModelPalette;
let palRival!: ModelPalette;
let palBest!: ModelPalette;
let palBalloon!: ModelPalette;
let palGun!: ModelPalette;
const palFlash = makePalette(FLASH_PALETTE, 'day', 1);
function useChapter(level: LevelDef): void {
  const ch = CHAPTERS[level.chapter];
  world = worldOf(level);
  let r = renderers.get(world);
  if (!r) renderers.set(world, (r = new StackRenderer(world, { cloudAlt: CLOUD[0] })));
  R = r;
  R.cloudCover = ch.clouds;
  light(ch.tod);
  image = null;
  layout();
}
/** Set the time of day: the world's palette and every model's. */
function light(tod: TimeOfDay): void {
  R.setTimeOfDay(tod);
  pal = makePalette(JET_PALETTE, tod);
  palRival = makePalette(RIVAL_PALETTE, tod);
  palBest = makePalette(BEST_PALETTE, tod);
  palBalloon = makePalette(BALLOON_PALETTE, tod);
  palGun = makePalette(GUN_PALETTE, tod);
}
/** Open skies: the day turns — day, dusk, night — every 75 s of flying. */
const DAY_PARTS: TimeOfDay[] = ['day', 'sunset', 'night', 'sunset'];
const DAY_PART_SECONDS = 75;
const rig = new ViewRig({ avoid: CLOUD, transition: 1.2 }, 1);
/** the camera every draw call uses: the rig's, or the seat's while the cockpit view is drawn */
let cam: StackCamera = rig.cam;
/** the cockpit view: the seat camera, the sheet the world is drawn on before it is turned, the painted cockpit */
const seat = new StackCamera();
const sheets = new Map<StackWorld, StackRenderer>();
let cockpit = false;
let cockArt: CockpitArt | null = null;
let cockKey = '';
let headX = 0;
let headY = 0;
let headVX = 0;
let headVY = 0;
/** the jet from above, for the cockpit's status screen: 0 empty · 1 body · 2 paint · 3 glass */
const jetTop = { w: JET.w, h: JET.l, cells: new Uint8Array(JET.w * JET.l) };
for (let y = JET.h - 1; y >= 0; y--) for (let o = 0; o < JET.w * JET.l; o++) { const v = sprite.model.slices[y][o]; if (v && jetTop.cells[o] === 0) jetTop.cells[o] = 1 + Math.min(2, (v - 1) >> 4); }
const SUN = { day: pack(255, 246, 222), sunset: pack(255, 170, 92), night: pack(150, 190, 255) };

// ── the session: the player's run, the rival's and the best ghost's, stepped tick for tick ──
type Mode = 'attract' | 'play' | 'watch';
interface Ghost { run: Run; inputs: number[]; i: number; left: number; ctl: Controls }
interface Session {
  mode: Mode;
  level: LevelDef;
  run: Run;
  /** the AI that holds the stick on every tick of a course; the player commands it with orders */
  pilot: Autopilot;
  /** the commander that takes over in full auto, watch mode and the attract run */
  expert: ExpertCommander;
  /** full auto: the expert commander is giving the orders right now */
  auto: boolean;
  /** it commanded at least one tick of this run: no stars, no best, no playtest record */
  assisted: boolean;
  log: InputLog;
  rival: Run | null;
  rivalPilot: ExpertCommander;
  best: Ghost | null;
  /** the ring whose gap to the rival is still to be shown (the player crossed it first) */
  pending: number;
  device: PlaytestRecord['device'];
  done: boolean;
}
let S!: Session;
function begin(level: LevelDef, mode: Mode): void {
  useChapter(level);
  const pay = mode === 'attract' || level.id === FREE_ID ? Infinity : payOf(level);
  // free flight resumes where the craft was last
  const run = new Run(world, level.id === FREE_ID && store.data.roam ? { ...level, start: store.data.roam } : level, pay);
  const campaign = mode === 'play' && level.id > 0;
  const bestIn = store.data.bestInputs[level.id];
  S = {
    mode, level, run, pilot: new Autopilot(), expert: new ExpertCommander(), auto: mode !== 'play', assisted: false, log: new InputLog(),
    rival: campaign && store.data.rival ? new Run(world, level, Infinity) : null, rivalPilot: new ExpertCommander(),
    best: campaign && store.data.ghost && bestIn ? { run: new Run(world, level, Infinity), inputs: bestIn, i: 0, left: bestIn[1] ?? 0, ctl: unpackControls(bestIn[0] ?? 0) } : null,
    pending: -1, device: touchUsed ? 'touch' : 'mouse', done: false,
  };
  syncPose();
  rig.seat(subject);
  trailLen = 0;
  smoke.length = parts.length = tracers.length = 0;
  held.clear();
  holding = false;
  rollNow = false;
  skimOrder = false;
  coached.boost = coached.skim = false;
  tiltNeutral = null; // how the phone is held now is level flight
  routing = false;
  kickUntil = -1;
  paused = false;
  acc = 0;
  // a breath before the clock starts: the camera settles and the first ring is found
  if (level.id === FREE_ID) archArmed = false;
  holdTicks = level.id === FREE_ID ? 0 : mode === 'play' ? 75 : mode === 'watch' ? 20 : 0;
  bannerUntil = 0;
  el.gap.classList.add('off');
}

const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, scale: SC };
const subject: RigSubject = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, length: JET.l * SC, width: JET.w * SC, tilt: 0, boost: 0 };
function poseOf(c: Craft, out: Pose): Pose {
  out.x = c.x; out.y = c.y; out.z = c.z; out.yaw = c.yaw; out.roll = bankOf(c); out.pitch = c.pitch; out.scale = SC;
  return out;
}
function syncPose(): void {
  const c = S.run.craft;
  poseOf(c, pose);
  subject.x = c.x; subject.y = c.y; subject.z = c.z; subject.yaw = c.yaw; subject.vx = c.vx; subject.vy = c.vy; subject.tilt = c.tilt; subject.boost = c.boost;
}

// ── presentation-only effects (their own clock and random stream; the simulation never reads them) ──
const COL = {
  gateA: pack(255, 236, 90), gateB: pack(255, 255, 255), gateNext: pack(110, 230, 255), knifeA: pack(255, 90, 170), knifeB: pack(255, 220, 240),
  shellA: pack(255, 70, 40), shellB: pack(255, 236, 120), tracer: pack(255, 244, 170), white: pack(255, 255, 255), lock: pack(140, 255, 170),
  spray: pack(232, 248, 255), ai: pack(125, 249, 255), rival: pack(125, 249, 255), best: pack(240, 244, 255), scrapA: pack(255, 132, 150), scrapB: pack(236, 60, 96),
  steel: pack(104, 110, 128), guide: pack(255, 255, 255),
};
/** Caps on what an effect may cover, in art pixels (effects must never hide the course). */
const FxLimits = { puffPx: 9, sparkPx: 2 } as const;
const TRAIL_N = 160;
const trail = [new Float32Array(TRAIL_N * 4), new Float32Array(TRAIL_N * 4)];
let trailHead = 0;
let trailLen = 0;
let trailX = 0;
let trailY = 0;
interface Puff { x: number; y: number; z: number; born: number; size: number; px: number; py: number; strength: number; life: number }
const smoke: Puff[] = [];
let smokeClock = 0;
/** kind: 0 spark (white → gold) · 1 fire · 2 balloon scrap · 3 spray · 4 steel debris */
interface Part { x: number; y: number; z: number; vx: number; vy: number; vz: number; born: number; life: number; kind: number; size: number }
const parts: Part[] = [];
interface Tracer { x: number; y: number; z: number; tx: number; ty: number; tz: number; born: number }
const tracers: Tracer[] = [];
let fxTime = 0;
let noise = 1;
const fxRand = (): number => {
  noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
  return noise / 4294967296;
};
function burst(x: number, y: number, z: number, n: number, speed: number, kind: number, life: number, size = 1): void {
  for (let i = 0; i < n && parts.length < 520; i++) {
    const a = fxRand() * 6.2832;
    const up = fxRand() * 2 - 1;
    const sp = speed * (0.35 + 0.65 * fxRand());
    const flat = Math.sqrt(1 - up * up);
    parts.push({ x, y, z, vx: Math.cos(a) * flat * sp, vy: Math.sin(a) * flat * sp, vz: up * sp, born: fxTime, life: life * (0.6 + 0.4 * fxRand()), kind, size });
  }
}
const tmp = { x: 0, y: 0, z: 0 };
const plumeLength = (c: Craft): number => 0.24 * JET.l * (1 + 1.6 * c.boost);

function stepFx(dt: number): void {
  fxTime += dt;
  const run = S.run;
  const c = run.craft;
  const ax = poseAxes(pose);
  if ((c.x - trailX) ** 2 + (c.y - trailY) ** 2 > 6.25) {
    trailX = c.x;
    trailY = c.y;
    for (let w = 0; w < 2; w++) {
      modelPoint(pose, ax, (w === 0 ? -1 : 1) * JET_WINGTIP.a, JET.pivotK - JET_WINGTIP.k, JET_WINGTIP.y - JET.pivotY, tmp);
      trail[w].set([tmp.x, tmp.y, tmp.z, fxTime], trailHead * 4);
    }
    trailHead = (trailHead + 1) % TRAIL_N;
    if (trailLen < TRAIL_N) trailLen++;
  }
  smokeClock += dt;
  if (smokeClock >= 0.034 - 0.012 * c.boost) {
    smokeClock = 0;
    const side = smoke.length & 1 ? 1 : -1;
    modelPoint(pose, ax, side * JET_NOZZLES[1].a, JET.pivotK - JET_NOZZLES[0].k - plumeLength(c) * 0.78, JET_NOZZLES[0].y - JET.pivotY, tmp);
    smoke.push({ x: tmp.x, y: tmp.y, z: tmp.z, born: fxTime, size: (1.3 + fxRand() * 1.2) * SC, px: -c.vx * 0.3 + (fxRand() - 0.5) * 12, py: -c.vy * 0.3 + (fxRand() - 0.5) * 12, strength: 0.46 + 0.36 * c.boost, life: 0.75 + 0.5 * c.boost + fxRand() * 0.3 });
    if (smoke.length > 96) smoke.shift();
  }
  // a wake of spray while skimming over water
  if (run.skimming && run.state === 'fly' && world.mat[(((c.y | 0) & world.mask) << world.shift) | ((c.x | 0) & world.mask)] < 4) {
    for (let i = 0; i < 2; i++) if (fxRand() < dt * 60) parts.push({ x: c.x + (fxRand() - 0.5) * 12, y: c.y + (fxRand() - 0.5) * 12, z: 1, vx: -c.vx * 0.25 + (fxRand() - 0.5) * 30, vy: -c.vy * 0.25 + (fxRand() - 0.5) * 30, vz: 16 + fxRand() * 18, born: fxTime, life: 0.55, kind: 3, size: 1 });
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (fxTime - p.born > p.life) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vz -= (p.kind === 1 ? 10 : 46) * dt;
    const drag = Math.exp(-dt * 1.6);
    p.vx *= drag;
    p.vy *= drag;
  }
  while (tracers.length && fxTime - tracers[0].born > 0.08) tracers.shift();
  // the pilot's head: it leans into a turn, sinks in a climb and under thrust, and is never quite still —
  // on a soft spring, so it overshoots a little and settles (the cockpit's layers sway with it)
  const hxGoal = clamp(c.yawRate / FLIGHT.agility, -1, 1) * 6.4 + Math.sin(fxTime * 0.53) * 0.3;
  const hyGoal = clamp(c.tilt / 0.5, -1, 1) * 3.4 + c.boost * 1.6 + Math.sin(fxTime * 0.71 + 1) * 0.25;
  headVX += ((hxGoal - headX) * 64 - headVX * 11) * dt;
  headVY += ((hyGoal - headY) * 64 - headVY * 11) * dt;
  headX = clamp(headX + headVX * dt, -8, 8);
  headY = clamp(headY + headVY * dt, -5, 5);
}

// ── HUD ──
const text = (node: HTMLElement, s: string): void => {
  if (node.textContent !== s) node.textContent = s;
};
/** one title at a time: a banner only replaces one of lower or equal rank, or an expired one */
let bannerUntil = 0;
let bannerRank = 0;
function banner(s: string, rank: number, secs = 1.1): void {
  // at ×8 and up events arrive faster than anyone can read: only the big ones (rank ≥ 3) are announced
  if (speedNow() >= 8 && rank < 3) return;
  if (fxTime < bannerUntil && rank < bannerRank) return;
  bannerRank = rank;
  bannerUntil = fxTime + secs;
  text(el.banner, s);
  el.banner.classList.remove('off');
}
let shake = 0;
let lastCall = '';
let fuelShown = -1;
let gapUntil = 0;
function showGap(seconds: number): void {
  const ahead = seconds < 0;
  text(el.gap, `${t('rival')} ${ahead ? '−' : '+'}${Math.abs(seconds).toFixed(2)}s ${t(ahead ? 'ahead' : 'behind')}`);
  el.gap.className = `chip ${ahead ? 'ahead' : 'behind'}`;
  gapUntil = fxTime + 2.4;
}

function onEvent(e: SimEvent): void {
  const quiet = S.mode === 'attract';
  switch (e.type) {
    case 'gate': {
      const ux = Math.cos(e.h);
      const uy = Math.sin(e.h);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * 6.2832;
        burst(e.x + ux * Math.cos(a) * e.r, e.y + uy * Math.cos(a) * e.r, e.z + Math.sin(a) * e.r, 2, 30, 0, 0.5);
      }
      if (quiet) break;
      banner(e.stunt ? `${t('stunt')}  +${e.points}` : e.bull ? `${t('bullseye')}  +${e.points}` : `+${e.points}`, e.stunt || e.bull ? 2 : 1);
      const up = 2 ** (Math.min(e.combo, 12) / 12);
      audio.tone(440 * up, 0.12, 'square', 0.05);
      if (e.bull || e.stunt) audio.tone(880 * up, 0.16, 'square', 0.04, 1, 0.07);
      kickUntil = S.run.tick + Rules.kickWindow;
      if (S.rival) {
        const r = S.rival.gateLog[e.index];
        if (r) showGap(S.run.time - r.t);
        else S.pending = e.index;
      }
      break;
    }
    case 'miss':
      if (quiet) break;
      banner(t('missed'), 2);
      audio.tone(150, 0.2, 'sawtooth', 0.05, 0.6);
      break;
    case 'shot':
      tracers.push({ ...e, born: fxTime });
      burst(e.tx, e.ty, e.tz, 2, 30, 0, 0.25);
      if (!quiet) audio.tone(900, 0.03, 'square', 0.014, 0.5);
      break;
    case 'pop':
      if (e.kind === 'turret') { burst(e.x, e.y, e.z, 34, 64, 1, 0.7, 2); burst(e.x, e.y, e.z, 22, 50, 4, 0.9, 2); }
      else burst(e.x, e.y, e.z, 26, 46, 2, 0.7, 2);
      if (quiet) break;
      banner(e.kind === 'turret' ? `${t('flakDown')}  +${e.points}` : `+${e.points}  +${Rules.balloonTime}s`, 1);
      audio.tone(e.kind === 'turret' ? 180 : 620, 0.16, e.kind === 'turret' ? 'sawtooth' : 'triangle', 0.07, 0.4);
      if (e.kind === 'turret' && !reduced) shake = Math.max(shake, 0.15);
      break;
    case 'fire':
      burst(e.x, e.y, e.z, 6, 22, 1, 0.3);
      if (!quiet) audio.tone(90, 0.12, 'sawtooth', 0.03, 0.5);
      break;
    case 'hurt':
      burst(e.x, e.y, e.z, 30, 50, 1, 0.6, 2);
      if (quiet) break;
      banner(`${t('hit')}  −${Rules.hitPenalty}s`, 3, 1.3);
      audio.tone(120, 0.35, 'sawtooth', 0.09, 0.45);
      shake = reduced ? 0 : 0.4;
      el.hurt.style.opacity = reduced ? '0.25' : '1';
      window.setTimeout(() => (el.hurt.style.opacity = '0'), 120);
      break;
    case 'dodge':
      burst(e.x, e.y, e.z, 14, 40, 0, 0.4);
      if (quiet) break;
      banner(`${t('dodged')}  +${e.points}`, 2);
      audio.tone(700, 0.12, 'triangle', 0.06, 1.6);
      break;
    case 'stage':
      if (quiet) break;
      banner(`${t('stage')} ${e.stage}`, 4, 1.8);
      [523, 659, 784, 1047].forEach((f, i) => audio.tone(f, 0.14, 'square', 0.05, 1, i * 0.08));
      break;
    case 'kick':
      burst(e.x, e.y, e.z, 18, 46, 0, 0.45);
      if (quiet) break;
      banner(`⚡ ${t('kicked')}  +${Rules.kickTime}s`, 2);
      audio.tone(520, 0.1, 'square', 0.05, 2.4);
      break;
    case 'roll':
      if (!quiet) audio.tone(300, 0.18, 'triangle', 0.03, 2.2);
      break;
    case 'end':
      finish(e.won);
      break;
  }
}

function hud(): void {
  const flying = S.mode !== 'attract' && ui === 'fly';
  for (const n of [el.score, el.clock, el.ring, el.fuel]) n.classList.toggle('off', !flying);
  el.map.classList.toggle('off', !(flying && S.run.free));
  for (const n of [el.bView, el.bAuto, el.bBoost, el.bPause]) n.classList.toggle('off', !(flying && touch));
  el.bSkim.classList.toggle('off', !(flying && touch && !S.run.free));
  if (fxTime >= bannerUntil) el.banner.classList.add('off');
  if (fxTime >= gapUntil) el.gap.classList.add('off');
  if (!flying) {
    for (const n of [el.alt, el.intent, el.gap, el.call, el.tiltbar]) n.classList.add('off');
    return;
  }
  const run = S.run;
  if (!run.free) text(el.score, `${Math.floor(run.score)}  ×${run.multiplier.toFixed(1)}`);
  const free = S.level.id === FREE_ID;
  text(el.clock, free ? `★ ${leagueStars()}/${LEAGUE_MAX} · ${rankOf(leagueStars())[1 + lang]}` : run.clock.toFixed(1));
  if (free) text(el.score, `${t('explored')} ${Math.round(exploredShare() * 100)}%`);
  el.clock.classList.toggle('low', run.clock < 6);
  text(el.ring, free ? t(`biome${world.biome[(((run.craft.y | 0) & world.mask) << world.shift) | ((run.craft.x | 0) & world.mask)]}` as StrKey) : run.endless ? `${t('stage')} ${run.stage} · ${t('ring')} ${run.gateIdx + 1}` : `${S.level.id} · ${t('ring')} ${Math.min(run.gateIdx + 1, S.level.gates)}/${S.level.gates}`);
  // (the bar is restyled only when it moves by a visible amount: a style write every frame is a layout every frame)
  if (Math.abs(run.energy - fuelShown) > 0.004) { fuelShown = run.energy; el.fuelBar.style.transform = `scaleX(${run.energy.toFixed(3)})`; }
  el.fuel.classList.toggle('skim', run.skimming);
  el.fuel.classList.toggle('dry', run.dry);
  // the one thing the picture cannot say in the overhead view: is the ring above or below
  // (in free flight the thing ahead is the nearest arch still to win)
  const g = run.free ? roamTarget() : run.gates[Math.min(run.gateIdx, run.gates.length - 1)];
  const dz = g ? g.z - run.craft.z : 0;
  const far = !!g && Math.abs(dz) > g.r * 0.6 && (!run.free || Math.hypot(g.x - run.craft.x, g.y - run.craft.y) < 500);
  el.alt.classList.toggle('off', !far);
  if (far) text(el.alt, t(dz > 0 ? 'climb' : 'dive'));
  // what the AI is doing, and the orders it is flying under
  el.intent.classList.toggle('off', run.free);
  const ai = S.auto ? S.expert.ai : S.pilot;
  const o = S.auto ? S.expert.orders : lastOrders;
  // (a phone has no room for the words: there the orders are their signs only — the first phone screenshot had this
  // chip running off both edges and over the pause button)
  const narrow = wrap.clientWidth < 620;
  if (!run.free) text(el.intent, narrow
    ? `AI · ${t(`intent${ai.plan.intent}` as StrKey)} ${o.boost ? '⚡' : ''}${o.skim ? '▼' : ''}${o.hunt ? '◎' : ''}${S.auto ? ` ×${SPEEDS[speedIdx]} ▸` : ''}`
    : `AI · ${t(`intent${ai.plan.intent}` as StrKey)}${o.boost ? ` · ⚡${t('ordBoost')}` : ''}${o.skim ? ` · ▼${t('ordSkim')}` : ''}${o.hunt ? ` · ◎${t('ordHunt')}` : ''}${S.auto ? ` · ${t('bAuto')} ×${SPEEDS[speedIdx]} ▸` : ` · ${t(`line${store.data.line}` as StrKey)}`}`);
  // the AI's call to its commander: roll for flak / a knife gate, or the kick window after a ring
  // (in the first sectors, on a pilot's first tries, the coach names the order that would help right now —
  // once, until it has been given in this run)
  if (o.boost) coached.boost = true;
  if (o.skim) coached.skim = true;
  const green = S.level.id >= 1 && S.level.id <= 3 && (store.data.attempts[S.level.id] ?? 0) <= 3 && !(store.data.stars[S.level.id] ?? 0);
  const coach = !green || run.tick < 90 ? '' : !coached.boost && run.energy > 0.5 ? 'coachBoost' : !coached.skim && S.level.id >= 2 && run.energy < 0.45 ? 'coachSkim' : '';
  const calling = !S.auto && !run.free && run.state === 'fly' && holdTicks === 0 ? (S.pilot.alert === 'flak' ? 'callFlak' : S.pilot.alert === 'knife' ? 'callKnife' : run.tick <= kickUntil ? 'callKick' : coach) : '';
  // a call is heard as well as seen: the commander may be looking at the ring, not at the chip
  if (calling && calling !== lastCall) audio.tone(calling === 'callKick' ? 990 : 1320, 0.07, 'square', 0.05, calling === 'callKick' ? 1.5 : 1);
  lastCall = calling;
  el.call.classList.toggle('off', !calling);
  if (calling) { text(el.call, t(calling as StrKey)); el.call.classList.toggle('kick', calling === 'callKick' || calling.startsWith('coach')); }
  el.bSkim.classList.toggle('on', skimOrder);
  // the tilt bar: shown while the sensors are being read, the dot at how far the phone leans
  el.tiltbar.classList.toggle('off', !tiltFresh());
  if (tiltFresh()) {
    el.tiltDot.style.left = `${50 + tilt.turn * 46}%`;
    el.tiltDot.style.top = `${50 - tilt.climb * 46}%`;
    el.tiltbar.classList.toggle('hot', lastOrders.boost || performance.now() < pushUntil);
  }
  el.bAuto.classList.toggle('on', S.auto);
  if (S.rival && S.pending >= 0) {
    const r = S.rival.gateLog[S.pending];
    if (r) { showGap(run.gateLog[S.pending].t - r.t); S.pending = -1; }
  }
}

// ── tilt control: the phone's orientation as input (free flight: steering; a course: skim by leaning forward, roll by a flick) ──
let tiltLive = false;
let tiltAsked = false;
let tiltTries = 0;
const TILT_TRIES = 4;
/** why tilt could not be switched on, the last time it could not (shown to the test hook; the player gets the banner) */
let tiltWhy = '';
let tiltNeutral: Neutral | null = null;
let tilt: TiltInput = { turn: 0, climb: 0, skim: false, boost: false };
/** a shove of the phone boosts until this time (performance.now) */
let pushUntil = -1e9;
let pushAt = -1e9;
let tiltAt = -1e9;
let flickAt = -1e9;
const screenAngle = (): number => screen.orientation?.angle ?? 0;
function onOrient(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return; // a desktop fires this event with no readings
  tiltNeutral ??= { beta: e.beta, gamma: e.gamma };
  tilt = tiltInput(e.beta, e.gamma, screenAngle(), tiltNeutral);
  tiltAt = performance.now();
}
function onMotion(e: DeviceMotionEvent): void {
  const now = performance.now();
  if (isPush(e.acceleration?.z) && now - pushAt > TiltLimits.pushPause) { pushAt = now; pushUntil = now + TiltLimits.pushHold; }
  const r = e.rotationRate;
  if (!r || !isFlick(r.alpha, r.beta, r.gamma) || performance.now() - flickAt < TiltLimits.flickPause) return;
  flickAt = performance.now();
  if (ui === 'fly') rollNow = true;
}
/** readings count only while they keep coming (a phone laid down, or a revoked permission, must not keep steering) */
const tiltFresh = (): boolean => tiltLive && performance.now() - tiltAt < 500;
/** Switch tilt on (asks for the permission iOS requires, from this gesture) or off. Says so when it cannot. */
async function setTilt(on: boolean): Promise<void> {
  window.removeEventListener('deviceorientation', onOrient);
  window.removeEventListener('devicemotion', onMotion);
  tiltLive = false;
  tiltNeutral = null;
  if (!on) return;
  try {
    if (typeof DeviceOrientationEvent === 'undefined') throw new Error('no sensors');
    // iOS: both event types have their own static requestPermission; called ON the class (a detached call can
    // throw), and only from a gesture that counts as user activation (see the pointerup / click hook)
    type Asks = { requestPermission?: () => Promise<string> };
    const O = DeviceOrientationEvent as unknown as Asks;
    const M = (typeof DeviceMotionEvent === 'undefined' ? {} : DeviceMotionEvent) as unknown as Asks;
    if (typeof O.requestPermission === 'function' && (await O.requestPermission()) !== 'granted') throw new Error('refused');
    // the flick (roll) is an extra: a refused motion permission must not take steering away
    if (typeof M.requestPermission === 'function') await M.requestPermission().catch(() => 'denied');
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('devicemotion', onMotion);
    tiltLive = true;
    banner(t('tiltOn'), 5, 5);
  } catch (err) {
    // refused, or no sensors: the setting goes back off and the player is told (never a silent no-op)
    tiltWhy = String((err as Error)?.message ?? err);
    // asked outside a gesture the browser accepts (NotAllowedError): not the player's answer — keep the setting
    // and ask again at the next tap, a few times at most
    if ((err as Error)?.name === 'NotAllowedError' && tiltTries < TILT_TRIES) { tiltAsked = false; return; }
    store.data.tilt = false;
    store.save();
    banner(t('tiltNo'), 5, 3);
  }
}

// ── autopilot speed: how many simulation ticks a frame runs while the AI is flying ──
const SPEEDS = [1, 2, 4, 8, 16] as const;
let speedIdx = clamp(store.data.aiSpeed ?? 0, 0, SPEEDS.length - 1);
/** ticks per frame-tick right now: the tiers apply only while the autopilot has the stick */
const speedNow = (): number => (S.auto && S.mode !== 'attract' ? SPEEDS[speedIdx] : 1);
function setSpeed(i: number): void {
  speedIdx = (i + SPEEDS.length) % SPEEDS.length;
  store.data.aiSpeed = speedIdx;
  store.save();
}

// ── input ──
const held = new Set<string>();
const FLY: Record<string, string> = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ShiftLeft: 'b', ShiftRight: 'b', TouchBoost: 'b' };
let keyMode = false;
let pointerOn = false;
let pointerX = 0;
let pointerY = 0;
let pointerIdle = 99;
let holding = false;
let holdT = 0;
let rollNow = false;
let paused = false;
let px = 4;
const HOLD = 0.2; // seconds: shorter is a click (roll), longer is a hold (thrusters)
let finger: { id: number; t: number; x: number; y: number; moved: boolean } | null = null;

/** the last orders given (HUD), the tick until which the kick prompt shows, and the skim order (a toggle on touch) */
let lastOrders: Orders = { boost: false, skim: false, hunt: true, roll: false, push: 0.5, nudge: 0 };
let kickUntil = -1;
let skimOrder = false;
/** what the coach has seen the player do in this run */
const coached = { boost: false, skim: false };
/** On a course the AI flies; this is what the player tells it this tick. */
function playerOrders(): Orders {
  let boost = holding;
  let skim = skimOrder;
  held.forEach((code) => {
    const k = FLY[code];
    if (k === 'b') boost = true;
    else if (k === 'd') skim = true;
  });
  if (held.size && S.device === 'mouse') S.device = 'keys';
  if (tiltFresh() && tilt.skim) skim = true;
  // pull the phone back = boost, a shove = a burst of it (the ring kick is a boost edge: a shove is one)
  if (tiltFresh() && (tilt.boost || performance.now() < pushUntil)) boost = true;
  const roll = rollNow;
  rollNow = false;
  // lean on the stick: tilt, or A / D — the AI still flies, this bends its line
  let nudge = tiltFresh() ? tilt.turn : 0;
  held.forEach((code) => { const k = FLY[code]; if (k === 'l') nudge -= 1; else if (k === 'r') nudge += 1; });
  return (lastOrders = { boost, skim, hunt: store.data.hunt, roll, push: store.data.line / 2, nudge: clamp(nudge, -1, 1) });
}
/** free flight, auto-route: the AI flies to the nearest arch still to win */
let routing = false;
function routeControls(): Controls {
  const c = S.run.craft;
  const g = roamTarget();
  if (!g) { routing = false; return NO_INPUT; }
  const err = wrapAngle(Math.atan2(g.x - c.x, -(g.y - c.y)) - c.yaw);
  return controls((err * 3) / FLIGHT.agility, 0, g.z, S.run.energy > 0.5 && Math.abs(err) < 0.3, false);
}

/** Free flight: the player points, the flight model keeps the craft off the ground (fly-by-wire). */
function playerControls(): Controls {
  const c = S.run.craft;
  let turn = 0;
  let climb = 0;
  let boost = holding && holdT >= HOLD;
  let keys = false;
  held.forEach((code) => {
    const k = FLY[code];
    if (k === 'l') { turn -= 1; keys = true; } else if (k === 'r') { turn += 1; keys = true; } else if (k === 'u') { climb += 1; keys = true; } else if (k === 'd') { climb -= 1; keys = true; } else if (k === 'b') boost = true;
  });
  if (keys && S.device === 'mouse') S.device = 'keys';
  if (store.data.stick) climb = -climb;
  // tilt steers when nothing else is: lean to turn, back to climb, forward to dive
  if (tiltFresh() && !keys && !pointerOn) {
    turn = tilt.turn;
    climb = tilt.climb;
    if (performance.now() < pushUntil) boost = true;
    if (S.device !== 'touch') S.device = 'touch';
  }
  let alt: number | undefined;
  if (!keyMode && pointerOn && pointerIdle < 5) {
    if (rig.chase > 0.5) {
      // from behind: point left or right of the jet to turn, above or below it to climb or dive
      const tt = clamp((pointerX - cam.cx) / (R.W * 0.26), -1, 1);
      if (Math.abs(tt) > 0.06) turn = tt;
      const raw = pointerY < rig.steerY ? (rig.steerY - pointerY) / Math.max(1, rig.steerY) : -(pointerY - rig.steerY) / Math.max(1, R.H - rig.steerY);
      const up = ((store.data.stick ? -1 : 1) * Math.sign(raw) * Math.max(0, Math.abs(raw) - 0.08)) / 0.92;
      const lo = c.floor;
      const hi = Math.max(lo, FLIGHT.cruise, FLIGHT.ceiling);
      // the middle of the screen holds the height of the ring ahead: aiming at it is aiming through it
      const ahead = S.run.free ? roamTarget() : S.run.gates[Math.min(S.run.gateIdx, S.run.gates.length - 1)];
      const mid = clamp(ahead ? ahead.z : FLIGHT.cruise, lo, hi);
      if (climb === 0) alt = up >= 0 ? mid + up * (hi - mid) : mid + up * (mid - lo);
    } else if (cam.project(c.x, c.y, c.z)) {
      const vx = pointerX - cam.sx;
      const vy = pointerY - cam.sy;
      if (vx * vx + vy * vy > 18 * 18) {
        const fx = vx * cam.cos + vy * cam.sin;
        const fy = -vx * cam.sin + vy * cam.cos;
        turn = clamp((wrapAngle(Math.atan2(fx, -fy) - c.yaw) * 2.6) / FLIGHT.agility, -1, 1);
      }
    }
  }
  const roll = rollNow;
  rollNow = false;
  return controls(turn, climb, alt, boost, roll);
}

let hintTimer = 0;
function hint(secs = 8): void {
  const fingers = touchUsed || (touch && !mouseSeen);
  text(el.hint, S.run.free ? t(fingers ? (store.data.tilt ? 'hintRoamTilt' : 'hintRoamTouch') : 'hintRoam') : t(fingers ? (store.data.tilt ? 'hintCommandTilt' : 'hintCommandTouch') : 'hintCommand'));
  wrap.classList.toggle('fingers', fingers);
  el.hint.classList.remove('off');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => el.hint.classList.add('off'), secs * 1000);
}
/** behind the jet → in the cockpit → overhead → behind the jet */
function setView(v: 'chase' | 'cockpit' | 'top'): void {
  cockpit = v === 'cockpit';
  rig.target = v === 'top' ? 0 : 1;
  if (ui === 'fly') hint(5);
}
const viewNow = (): 'chase' | 'cockpit' | 'top' => (cockpit ? 'cockpit' : rig.target === 1 ? 'chase' : 'top');
function nextView(): void {
  setView(viewNow() === 'chase' ? 'cockpit' : viewNow() === 'cockpit' ? 'top' : 'chase');
}
function setPaused(p: boolean): void {
  if (ui !== 'fly' || S.done) return;
  paused = p;
  if (p) banner(t('paused'), 9, 1e9);
  else bannerUntil = 0;
}
function toggleAuto(): void {
  if (ui !== 'fly' || S.mode !== 'play' || S.done) return;
  if (S.run.free) {
    // free flight has no course: "auto" there means fly me to the nearest arch
    routing = !routing;
    banner(t(routing ? 'routeOn' : 'routeOff'), 3, 1.6);
    return;
  }
  S.auto = !S.auto;
  if (S.auto) S.assisted = true;
  banner(t(S.auto ? 'autoOn' : 'autoOff'), 3, 1.4);
  audio.tone(S.auto ? 660 : 440, 0.12, 'triangle', 0.05);
}

// ── open skies: the league's arches, the fog of exploration, the map ──
/** League stars, read from the save alone: the menu shows them, and the menu must never build the open map
 *  (2026-11-18: it did — `trialsOf()` here built the 2048 map on the main thread at every page load). */
const leagueStars = (): number => Object.entries(store.data.stars).reduce((n, [id, s]) => n + (Number(id) >= TRIAL_ID0 ? s : 0), 0);
const LEAGUE_MAX = LEAGUE_COURSES * 3;
const FOG_N = 32;
const exploredShare = (): number => store.data.fog.reduce((n, row) => { let c = 0; for (let b = row >>> 0; b; b &= b - 1) c++; return n + c; }, 0) / (FOG_N * FOG_N);
const fogSeen = (i: number, j: number): boolean => (((store.data.fog[j & (FOG_N - 1)] ?? 0) >>> (i & (FOG_N - 1))) & 1) === 1;
/** Mark the cells around the craft as seen; true when something new was uncovered. */
function uncover(): boolean {
  const c = S.run.craft;
  const cell = world.n / FOG_N;
  const ci = Math.floor(c.x / cell);
  const cj = Math.floor(c.y / cell);
  let fresh = false;
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
    if (di * di + dj * dj > 10 || fogSeen(ci + di, cj + dj)) continue;
    const j = (cj + dj) & (FOG_N - 1);
    store.data.fog[j] = ((store.data.fog[j] ?? 0) | (1 << ((ci + di) & (FOG_N - 1)))) >>> 0;
    fresh = true;
  }
  return fresh;
}
/** A trial's arch as a point near the craft (the map wraps; the craft's own coordinates do not). */
function archPoint(tr: Trial): { x: number; y: number; z: number; r: number } {
  const c = S.run.craft;
  return { x: c.x + wrapDelta(c.x, tr.start.x, world.n), y: c.y + wrapDelta(c.y, tr.start.y, world.n), z: tr.start.z, r: ARCH_R };
}
/** The nearest arch not yet won with three stars: where the edge arrow points in free flight. */
function roamTarget(): { x: number; y: number; z: number; r: number } | null {
  const c = S.run.craft;
  let best: { x: number; y: number; z: number; r: number } | null = null;
  let bd = Infinity;
  for (const tr of trialsOf()) {
    if ((store.data.stars[tr.id] ?? 0) >= 3 || !trialOpen(tr)) continue;
    const p = archPoint(tr);
    const d = Math.hypot(p.x - c.x, p.y - c.y) + (store.data.stars[tr.id] ? 600 : 0); // unbeaten arches first
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
const COL_ARCH = { open: pack(255, 214, 64), won: pack(120, 240, 150), beam: pack(255, 244, 190), mail: pack(120, 200, 255), locked: pack(110, 116, 132) };
const trialOpen = (tr: Trial): boolean => regionOpen(tr.biome, leagueStars());
function drawArches(near: boolean, jetV: number): void {
  const pulse = (fxTime * 5) | 0;
  for (const tr of trialsOf()) {
    const p = archPoint(tr);
    if (Math.hypot(p.x - S.run.craft.x, p.y - S.run.craft.y) > 1100) continue;
    if (!cam.project(p.x, p.y, p.z) || cam.sv > jetV === near) continue;
    const won = (store.data.stars[tr.id] ?? 0) > 0;
    const locked = !trialOpen(tr);
    const base = locked ? COL_ARCH.locked : won ? COL_ARCH.won : tr.tier === MAIL_TIER ? COL_ARCH.mail : COL_ARCH.open;
    const ux = Math.cos(tr.start.yaw);
    const uy = Math.sin(tr.start.yaw);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * 6.2832;
      if (!cam.project(p.x + ux * Math.cos(a) * ARCH_R, p.y + uy * Math.cos(a) * ARCH_R, p.z + Math.sin(a) * ARCH_R)) continue;
      const size = Math.max(1, Math.round(cam.sm * 2.2));
      R.plot(Math.round(cam.sx - size / 2), Math.round(cam.sy - size / 2), size, won || locked ? base : ((i >> 1) + pulse) & 1 ? base : COL.white, cam.sv);
    }
    // a beam of light over it, so an arch is found from far away; one pip per tier
    for (let h = ARCH_R + 6; h < 190; h += 7) if (cam.project(p.x, p.y, p.z + h)) R.plot(Math.round(cam.sx), Math.round(cam.sy), cam.sm > 1.5 ? 2 : 1, won || locked || tr.tier === MAIL_TIER ? base : COL_ARCH.beam, cam.sv);
    for (let k = 0; k <= tr.tier; k++) if (cam.project(p.x + ux * (k - tr.tier / 2) * 8, p.y + uy * (k - tr.tier / 2) * 8, p.z + ARCH_R + 8)) R.plot(Math.round(cam.sx) - 1, Math.round(cam.sy) - 1, Math.max(2, Math.round(cam.sm * 3)), COL.white, cam.sv);
  }
}
// the map: one pixel per 16 px of world, painted once per world; fog, arches and the craft are drawn over it
const mapCtx = el.map.getContext('2d')!;
let mapBase: ImageData | null = null;
let mapWorld: StackWorld | null = null;
const MAP_LAND = [[96, 178, 52], [214, 150, 84], [226, 236, 246], [86, 82, 78], [196, 172, 70]];
const MAP_SEA = [[36, 104, 180], [30, 124, 166], [44, 90, 140], [40, 52, 100], [40, 112, 148]];
function drawMap(): void {
  const N = 128;
  if (mapWorld !== world || !mapBase) {
    mapWorld = world;
    mapBase = mapCtx.createImageData(N, N);
    const step = world.n / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = (((j * step + step / 2) | 0) << world.shift) | ((i * step + step / 2) | 0);
      const col = (world.mat[o] < 4 ? MAP_SEA : MAP_LAND)[world.biome[o]];
      const k = (j * N + i) * 4;
      const lift = world.mat[o] < 4 ? 1 : 0.8 + Math.min(0.4, world.height[o] / 60);
      mapBase.data[k] = col[0] * lift; mapBase.data[k + 1] = col[1] * lift; mapBase.data[k + 2] = col[2] * lift; mapBase.data[k + 3] = 255;
    }
  }
  mapCtx.putImageData(mapBase, 0, 0);
  const cell = N / FOG_N;
  mapCtx.fillStyle = 'rgba(8, 16, 34, 0.86)';
  for (let j = 0; j < FOG_N; j++) for (let i = 0; i < FOG_N; i++) if (!fogSeen(i, j)) mapCtx.fillRect(i * cell, j * cell, cell, cell);
  const k = N / world.n;
  for (const tr of trialsOf()) {
    // an arch shows on the map once its cell has been flown over
    if (!fogSeen(Math.floor(tr.start.x / (world.n / FOG_N)), Math.floor(tr.start.y / (world.n / FOG_N)))) continue;
    mapCtx.fillStyle = !trialOpen(tr) ? '#6e7484' : (store.data.stars[tr.id] ?? 0) > 0 ? '#78f096' : tr.tier === MAIL_TIER ? '#78c8ff' : '#ffd640';
    mapCtx.fillRect(Math.round(tr.start.x * k) - 2, Math.round(tr.start.y * k) - 2, 4, 4);
  }
  const c = S.run.craft;
  const mx = ((c.x % world.n) + world.n) % world.n * k;
  const my = ((c.y % world.n) + world.n) % world.n * k;
  mapCtx.strokeStyle = '#ffffff';
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  mapCtx.moveTo(mx, my);
  mapCtx.lineTo(mx + Math.sin(c.yaw) * 7, my - Math.cos(c.yaw) * 7);
  mapCtx.stroke();
  mapCtx.fillStyle = '#ffffff';
  mapCtx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3);
}
let mapTick = 0;
/** false right after free flight (re)starts on an arch: it must be left before it can start its trial again */
let archArmed = true;
/** Free flight, once a tick: uncover the map, and start the trial whose arch the craft flies through. */
function roam(): void {
  const c = S.run.craft;
  if (++mapTick % 30 === 0) { if (uncover() && mapTick % 600 === 0) store.save(); drawMap(); }
  const tr = archAt(trialsOf(), world.n, c.x, c.y, c.z, trialOpen);
  if (!tr) {
    archArmed = true;
    // flying through a locked arch says what it takes
    const shut = archAt(trialsOf(), world.n, c.x, c.y, c.z);
    if (shut) banner(`${t('regionLocked')} ${REGION_STARS[shut.biome]} ★`, 3, 2.2);
    return;
  }
  if (!archArmed) return;
  store.data.roam = { x: tr.start.x, y: tr.start.y, z: tr.start.z, yaw: tr.start.yaw };
  store.save();
  startLevel(tr, 'play');
  banner(`${t('trialAt')} · ${tr.name[lang]}`, 5, 1.4);
}

// ── menus (DOM; every string comes from the table, nothing from outside is ever put into innerHTML) ──
type Ui = 'menu' | 'levels' | 'options' | 'playtest' | 'log' | 'brief' | 'fly' | 'result';
let ui: Ui = 'menu';
let briefLevel: LevelDef = LEVELS[0];
let briefWatch = false;
let lastRecord: PlaytestRecord | null = null;
let resultHtml = '';
let shareLine = '';
const starsHtml = (n: number): string => `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
const unlocked = (l: LevelDef): boolean => l.id === 1 || (store.data.stars[l.id - 1] ?? 0) > 0 || (store.data.stars[l.id] ?? 0) > 0;
const nextLevel = (): LevelDef => LEVELS.find((l) => !(store.data.stars[l.id] ?? 0)) ?? LEVELS[LEVELS.length - 1];
const fmtTime = (s: number): string => (Number.isFinite(s) ? `${s.toFixed(2)}s` : '—');
const btn = (act: string, label: string, cls = '', extra = ''): string => `<button class="b ${cls}" type="button" data-act="${act}" ${extra}>${esc(label)}</button>`;

function show(next: Ui): void {
  ui = next;
  const p = el.panel;
  p.classList.toggle('off', ui === 'fly');
  let h = '';
  if (ui === 'menu') {
    const total = LEVELS.reduce((n, l) => n + (store.data.stars[l.id] ?? 0), 0);
    const n = nextLevel();
    h = `<h1><small>NEON</small>WAVETOP</h1><p>${esc(t('tagline'))}</p><div class="col">
      ${btn(`brief:${n.id}`, `▶ ${total ? t('cont') : t('campaign')} · ${n.id} ${n.name[lang]}`, 'main')}
      ${btn('levels', `▦ ${t('levels')}  ${total}/${LEVELS.length * 3} ★`)}
      ${btn('open', `✈ ${t('open')}${leagueStars() ? ` · ★ ${leagueStars()}/${LEAGUE_MAX}` : ''}`)}
      ${btn('daily', `☀ ${t('daily')} · ${dayText(today())}${store.data.dailyDay === today() && store.data.dailyBest ? ` · ${t('best')} ${store.data.dailyBest}` : ''}`)}
      ${btn('endless', `∞ ${t('endless')}${store.data.endlessBest ? ` · ${t('best')} ${store.data.endlessBest}` : ''}`)}
      ${btn(`watch:${n.id}`, `◉ ${t('watch')}`)}
      <div class="row">${btn('options', `⚙ ${t('options')}`)}${btn('log', `✎ ${t('log')}`)}${btn('playtest', `▤ ${t('playtest')} ${store.data.records.length}`)}</div></div>
      ${store.ok ? '' : `<p class="note"><b>${esc(t('noSave'))}</b></p>`}<p class="note">v${esc(BUILD)}</p>`;
  } else if (ui === 'levels') {
    h = `<h2>${esc(t('levels'))}</h2><div class="grid">`;
    CHAPTERS.forEach((ch, c) => {
      h += `<div class="ch">${lang ? `${t('chapter')} ${c + 1} ${t('chapterEnd')}` : `${t('chapter')} ${c + 1}`} · ${esc(ch.name[lang])}</div>`;
      for (const l of LEVELS.slice(c * SECTORS, (c + 1) * SECTORS)) {
        const open = unlocked(l);
        h += btn(`brief:${l.id}`, '', '', open ? '' : `disabled title="${esc(t('locked'))}"`).replace('></button>', `>${l.id}${store.data.perfect[l.id] ? ' ◆' : ''}<br>${starsHtml(store.data.stars[l.id] ?? 0)}</button>`);
      }
    });
    h += `</div><div class="row">${btn('menu', t('back'))}</div>`;
  } else if (ui === 'options') {
    const sw = (k: string, label: StrKey, on: boolean): string => `<div class="row"><span>${esc(t(label))}</span>${btn(`opt:${k}`, t(on ? 'on' : 'off'), on ? 'sel' : '')}</div>`;
    h = `<h2>${esc(t('options'))}</h2><div class="col">
      <div class="row"><span>${esc(t('lang'))}</span>${btn('opt:lang0', 'English', lang === 0 ? 'sel' : '')}${btn('opt:lang1', '中文', lang === 1 ? 'sel' : '')}</div>
      ${sw('mute', 'sound', !store.data.mute)}${sw('rival', 'showRival', store.data.rival)}${sw('ghost', 'showBest', store.data.ghost)}${sw('stick', 'stick', store.data.stick)}${sw('tilt', 'tilt', store.data.tilt)}${store.data.tilt ? `<p class="note">${esc(tiltFresh() ? t('tiltActive') : t('tiltWaiting'))}</p>` : tiltWhy ? `<p class="note">${esc(t('tiltNo'))}</p>` : ''}
      ${btn('menu', t('back'))}</div>${audio.credit ? `<p class="note">♪ ${esc(audio.credit)}</p>` : ''}`;
  } else if (ui === 'playtest') {
    h = `<h2>${esc(t('playtest'))}</h2><p><b>${store.data.records.length}</b> ${esc(t('ptLine'))}</p>
      <div class="row">${btn('pt:copy', t('copy'), 'main')}${btn('pt:download', t('download'))}${btn('pt:clear', t('clear'))}</div>
      <p class="note" id="ptNote"></p><div class="row">${btn('menu', t('back'))}</div>`;
  } else if (ui === 'log') {
    const lg = store.data.log;
    const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—');
    const campaign = LEVELS.reduce((n, l) => n + (store.data.stars[l.id] ?? 0), 0);
    const mins = Math.floor((lg.ticks * TICK) / 60);
    const row = (k: StrKey, v: string): string => `<tr><td>${esc(t(k))}</td><td>${esc(v)}</td></tr>`;
    h = `<h2>${esc(t('log'))}</h2><p><b>${esc(String(rankOf(leagueStars())[1 + lang]))}</b></p>${lg.runs ? '' : `<p class="note">${esc(t('logEmpty'))}</p>`}
      <table class="t">${row('logRuns', String(lg.runs))}${row('logWins', `${lg.wins} · ${pct(lg.wins, lg.runs)}`)}
      ${row('logKick', `${lg.kicks}/${lg.rings} · ${pct(lg.kicks, lg.rings)}`)}${row('logDodge', `${lg.dodges}/${lg.dodges + lg.hits} · ${pct(lg.dodges, lg.dodges + lg.hits)}`)}
      ${row('logStunt', String(lg.stunts))}${row('logBull', `${lg.bullseyes} · ${pct(lg.bullseyes, lg.rings)}`)}${row('logTime', `${mins} min`)}
      ${row('logCampaign', `${campaign}/${LEVELS.length * 3}`)}${row('logLeague', `${leagueStars()}/${LEAGUE_MAX}`)}</table>
      <div class="row">${btn('menu', t('back'))}</div>`;
  } else if (ui === 'brief') {
    const l = briefLevel;
    const tn = TUNED[l.id];
    const mine = store.data.best[l.id];
    h = `<p>${lang ? `${t('chapter')} ${l.chapter + 1} ${t('chapterEnd')}` : `${t('chapter')} ${l.chapter + 1}`} · ${esc(CHAPTERS[l.chapter].name[lang])}</p>
      <h2>${l.id} · ${esc(l.name[lang])}</h2><p><b>${esc(l.teach[lang])}</b></p>
      <table class="t"><tr><td>${l.gates} ${esc(t('rings'))}</td><td>${starsHtml(store.data.stars[l.id] ?? 0)}</td></tr>
      <tr><td>★★ ${esc(t('par'))}</td><td>${fmtTime(tn.par)}</td></tr><tr><td>★★★ ${esc(t('rival'))}</td><td>${fmtTime(tn.ai)}</td></tr>
      ${mine ? `<tr><td>${esc(t('best'))}</td><td>${fmtTime(mine * TICK)}</td></tr>` : ''}</table>
      <div class="row">${btn('go', briefWatch ? `◉ ${t('watch')}` : `▶ ${t('start')}`, 'main')}${btn('menu', t('back'))}</div>`;
  } else if (ui === 'result') h = resultHtml;
  p.innerHTML = h;
  if (ui === 'menu' && S.mode !== 'attract') {
    // leaving free flight: remember where the craft was
    if (S.run.free) { const c = S.run.craft; store.data.roam = { x: ((c.x % world.n) + world.n) % world.n, y: ((c.y % world.n) + world.n) % world.n, z: c.z, yaw: c.yaw }; store.save(); }
    begin(ENDLESS, 'attract');
  }
  (p.querySelector('button.main') as HTMLElement | null)?.focus({ preventScroll: true });
}

function startLevel(level: LevelDef, mode: Mode): void {
  audio.wake();
  begin(level, mode);
  if (mode === 'play') store.data.attempts[level.id] = (store.data.attempts[level.id] ?? 0) + 1;
  show('fly');
  banner(mode === 'play' ? t('ready') : t('go'), 4, 1.2);
  hint(mode === 'play' ? 9 : 4);
  wrap.focus({ preventScroll: true });
}

function finish(won: boolean): void {
  if (S.mode === 'attract' || S.done) return;
  S.done = true;
  const run = S.run;
  const l = S.level;
  const campaign = l.id > 0;
  const daily = l.id === DAILY_ID;
  const prevBest = store.data.best[l.id];
  const clean = S.mode === 'play' && !S.assisted;
  let stars = 0;
  let isBest = false;
  lastRecord = null;
  if (clean) {
    lastRecord = record(run, S.log, { build: BUILD, device: S.device, attempt: store.data.attempts[l.id] ?? 1 });
    store.data.records.push(lastRecord);
    const lg = store.data.log;
    lg.runs++;
    if (won) lg.wins++;
    lg.rings += run.passed;
    lg.kicks += run.kicks;
    lg.dodges += run.dodges;
    lg.hits += run.hits;
    lg.stunts += run.stunts;
    lg.bullseyes += run.bullseyes;
    lg.ticks += run.tick;
    if (campaign && won) {
      const tn = TUNED[l.id];
      stars = 1 + (run.time <= tn.par ? 1 : 0) + (run.time < tn.ai ? 1 : 0);
      store.data.stars[l.id] = Math.max(store.data.stars[l.id] ?? 0, stars);
      if (run.missed === 0) store.data.perfect[l.id] = true;
      if (!store.data.best[l.id] || run.tick < store.data.best[l.id]) {
        isBest = true;
        store.data.best[l.id] = run.tick;
        store.data.bestInputs[l.id] = S.log.pairs.slice();
      }
    }
    if (daily) {
      if (store.data.dailyDay !== l.seed) { store.data.dailyDay = l.seed; store.data.dailyBest = 0; }
      if (Math.floor(run.score) > store.data.dailyBest) { isBest = true; store.data.dailyBest = Math.floor(run.score); }
    } else if (!campaign && Math.floor(run.score) > store.data.endlessBest) {
      isBest = true;
      store.data.endlessBest = Math.floor(run.score);
    }
    store.save();
  }
  if (won) [523, 659, 784, 1047, 1319].forEach((f, i) => audio.tone(f, 0.16, 'square', 0.05, 1, i * 0.09));
  else [392, 330, 262, 196].forEach((f, i) => audio.tone(f, 0.22, 'triangle', 0.06, 1, i * 0.14));
  const tn = TUNED[l.id];
  const rows = campaign
    ? `<tr><td>${esc(t('you'))}</td><td>${won ? fmtTime(run.time) : '—'}</td></tr>${won && clean && prevBest ? `<tr><td>${esc(t('vsBest'))}</td><td>${run.tick <= prevBest ? '−' : '+'}${(Math.abs(run.tick - prevBest) * TICK).toFixed(2)}s</td></tr>` : ''}<tr><td>${esc(t('par'))}</td><td>${fmtTime(tn.par)}</td></tr><tr><td>${esc(t('rival'))}</td><td>${fmtTime(tn.ai)}</td></tr>`
    : `<tr><td>${esc(t('stage'))}</td><td>${run.stage}</td></tr>`;
  const starLines = campaign && won && clean ? `<p>${starsHtml(stars)}<br><span class="note">${esc([t('star1'), t('star2'), t('star3')].slice(0, stars).join(' · '))}</span>${run.missed === 0 ? `<br><b>◆ ${esc(t('perfect'))}</b>` : ''}</p>` : '';
  // a line to paste to a friend: the day names the course, so two results of one day are comparable
  shareLine = daily && clean ? `NEON WAVETOP ${t('daily')} ${dayText(l.seed)} — ${Math.floor(run.score)} · ${t('stage')} ${run.stage} · ${run.passed} ${t('rings')} — https://neon-wavetop.pages.dev` : '';
  const rate = lastRecord
    ? `<div class="col" id="rate"><div class="row"><span>${esc(t('howHard'))}</span>${btn('rate:h-1', t('tooEasy'))}${btn('rate:h0', t('justRight'))}${btn('rate:h1', t('tooHard'))}</div>
       <div class="row"><span>${esc(t('howFun'))}</span>${[1, 2, 3, 4, 5].map((n) => btn(`rate:f${n}`, String(n))).join('')}</div></div>`
    : '';
  const trial = l.id >= 100;
  const canNext = campaign && won && l.id < LEVELS.length;
  resultHtml = `<h2>${esc(S.mode === 'watch' ? t('rival') : won ? t('cleared') : t('timeUp'))}</h2>
    <p>${trial ? `${esc(t('trialAt'))} · ${esc(l.name[lang])}` : campaign ? `${l.id} · ${esc(l.name[lang])}` : daily ? `${esc(t('daily'))} · ${dayText(l.seed)}` : esc(t('endless'))}${isBest ? ` — <b>${esc(t('newBest'))}</b>` : ''}</p>${starLines}
    <table class="t">${rows}<tr><td>${esc(t('score'))}</td><td>${Math.floor(run.score)}</td></tr>
    <tr><td>${esc(t('ring'))}</td><td>${run.passed}/${campaign ? l.gates : run.gateIdx}${run.bullseyes ? ` · ◎ ${run.bullseyes}` : ''}${run.stunts ? ` · ◇ ${run.stunts}` : ''}</td></tr>
    <tr><td>⚡ ${esc(t('kicks'))}</td><td>${run.kicks}/${run.passed}</td></tr>${trial ? `<tr><td>${esc(t('rank'))}</td><td>${esc(String(rankOf(leagueStars())[1 + lang]))} · ★ ${leagueStars()}</td></tr>` : ''}</table>
    ${S.assisted && S.mode === 'play' ? `<p class="note">${esc(t('assisted'))}</p>` : ''}${rate}
    ${shareLine ? `<div class="row">${btn('share', t('copyResult'))}<span class="note" id="shareNote"></span></div>` : ''}
    <div class="row">${canNext ? btn(`brief:${l.id + 1}`, `▶ ${t('next')}`, 'main') : ''}${trial ? btn('open', `✈ ${t('flyOn')}`, 'main') : ''}${btn('retry', `↻ ${t('retry')} (R)`, canNext || trial ? '' : 'main')}${btn('menu', t('menu'))}</div>`;
  // the card comes up a moment after the last ring, so its burst is seen
  window.setTimeout(() => { if (S.done && ui === 'fly') show('result'); }, won ? 900 : 500);
}

function exportText(): string {
  return encode(store.data.records);
}
function act(a: string): void {
  audio.wake();
  const [k, v] = a.split(':');
  if (k === 'menu') show('menu');
  else if (k === 'levels' || k === 'options' || k === 'playtest' || k === 'log') show(k);
  else if (k === 'brief' || k === 'watch') {
    const l = LEVELS[Number(v) - 1];
    if (!l || (k === 'brief' && !unlocked(l))) return;
    briefLevel = l;
    briefWatch = k === 'watch';
    show('brief');
  } else if (k === 'go') startLevel(briefLevel, briefWatch ? 'watch' : 'play');
  else if (k === 'endless') startLevel(ENDLESS, 'play');
  else if (k === 'daily') startLevel(dailyLevel(today()), 'play');
  else if (k === 'open') {
    const go = (): void => { startLevel(FREE, 'play'); banner(t('archHint'), 5, 4); };
    if (openReady()) go();
    else {
      // the worker has not delivered the map yet (or there is no worker): say so, and enter when it is there
      el.panel.innerHTML = `<h2>${esc(t('loading'))}</h2>`;
      if (openWorker) openWaiting = go;
      else window.setTimeout(go, 40); // built here, on the main thread, by worldOf
    }
  }
  else if (k === 'share') {
    const note = document.getElementById('shareNote');
    navigator.clipboard?.writeText(shareLine).then(() => note && text(note, t('copied')), () => note && text(note, shareLine)) ?? (note && text(note, shareLine));
  }
  else if (k === 'retry') startLevel(S.level, S.mode === 'watch' ? 'watch' : 'play');
  else if (k === 'opt') {
    if (v === 'lang0' || v === 'lang1') { lang = v === 'lang1' ? 1 : 0; store.data.lang = lang; document.documentElement.lang = lang ? 'zh-CN' : 'en'; labels(); }
    else if (v === 'mute') { store.data.mute = !store.data.mute; audio.muted = store.data.mute; }
    else if (v === 'rival') store.data.rival = !store.data.rival;
    else if (v === 'ghost') store.data.ghost = !store.data.ghost;
    else if (v === 'stick') store.data.stick = !store.data.stick;
    else if (v === 'tilt') { store.data.tilt = !store.data.tilt; store.data.tiltSet = true; void setTilt(store.data.tilt).then(() => { if (ui === 'options') show('options'); }); }
    store.save();
    show('options');
  } else if (k === 'pt') {
    const note = document.getElementById('ptNote');
    if (v === 'copy') {
      const s = exportText();
      // the clipboard can be refused (no permission, insecure context): say so and point at Download
      navigator.clipboard?.writeText(s).then(() => note && text(note, t('copied')), () => note && text(note, t('copyFail'))) ?? (note && text(note, t('copyFail')));
    } else if (v === 'download') {
      const url = URL.createObjectURL(new Blob([exportText()], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `wavetop-playtest-${store.data.records.length}.txt`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (v === 'clear') { store.data.records = []; store.save(); show('playtest'); }
  } else if (k === 'rate' && lastRecord) {
    const cur = lastRecord.rating ?? { hard: 0 as -1 | 0 | 1, fun: 0 };
    if (v[0] === 'h') cur.hard = Number(v.slice(1)) as -1 | 0 | 1;
    else cur.fun = Number(v.slice(1));
    lastRecord.rating = cur;
    store.save();
    for (const b of el.panel.querySelectorAll<HTMLElement>(`#rate button[data-act^="rate:${v[0]}"]`)) b.classList.toggle('sel', b.dataset.act === a);
  }
}
el.panel.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
  if (b && !b.hasAttribute('disabled')) act(b.dataset.act!);
});
function labels(): void {
  text(el.bView, t('bView'));
  text(el.bAuto, t('bAuto'));
  text(el.bSkim, t('bSkim'));
  text(el.bBoost, t('bBoost'));
  text(el.bPause, '❚❚');
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (ui !== 'fly') {
    if (e.code === 'Escape' && ui !== 'menu') show('menu');
    else if (e.code === 'KeyR' && ui === 'result') act('retry');
    return; // Enter / Space activate the focused button natively
  }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) rollNow = true; }
  else if (e.code === 'KeyV' && !e.repeat) nextView();
  else if (e.code === 'KeyP' && !e.repeat) setPaused(!paused);
  else if (e.code === 'KeyM' && !e.repeat) { store.data.mute = audio.muted = !audio.muted; store.save(); banner(t(audio.muted ? 'soundOff' : 'soundOn'), 1); }
  else if (e.code === 'KeyR' && !e.repeat) act('retry');
  else if (e.code === 'Escape') show('menu');
  else if ((e.code === 'KeyQ' || e.code === 'KeyN') && !e.repeat) toggleAuto();
  else if (e.code === 'KeyH' && !e.repeat) { store.data.hunt = !store.data.hunt; store.save(); banner(`◎ ${t('ordHunt')}: ${t(store.data.hunt ? 'on' : 'off')}`, 2); }
  else if (e.code === 'KeyL' && !e.repeat) { store.data.line = (store.data.line + 1) % 3; store.save(); banner(t(`line${store.data.line}` as StrKey), 2); }
  else if ((e.code === 'KeyF' || e.code === 'Equal' || e.code === 'BracketRight') && !e.repeat) setSpeed(speedIdx + 1);
  else if ((e.code === 'Minus' || e.code === 'BracketLeft') && !e.repeat) setSpeed(speedIdx - 1);
  else if (FLY[e.code]) {
    if (e.code.startsWith('Arrow')) e.preventDefault();
    held.add(e.code);
    if (FLY[e.code] !== 'b') keyMode = true;
  }
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => { held.clear(); holding = false; el.bBoost.classList.remove('on'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

const toFrame = (e: PointerEvent): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / px, (e.clientY - r.top) / px];
};
const aim = (e: PointerEvent): void => {
  [pointerX, pointerY] = toFrame(e);
  pointerOn = true;
  pointerIdle = 0;
  keyMode = false;
};
wrap.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') mouseSeen = true;
  if (ui !== 'fly') return;
  if (e.pointerType === 'touch') {
    if (!finger || finger.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - finger.x, e.clientY - finger.y) > 12) finger.moved = true;
  }
  aim(e);
});
// a saved "tilt on" can only be honoured from a gesture, and on a touch screen the press does NOT count as one:
// user activation comes with the release (pointerup / touchend / click) — asking at pointerdown is refused on iOS
const askTilt = (): void => {
  if (store.data.tilt && !tiltLive && !tiltAsked) { tiltAsked = true; tiltTries++; void setTilt(true); }
};
for (const ev of ['pointerup', 'touchend', 'click'] as const) window.addEventListener(ev, askTilt, true);
wrap.addEventListener('pointerdown', (e) => {
  audio.wake();
  if (ui !== 'fly' || (e.target as HTMLElement).closest('.btn')) return;
  wrap.focus({ preventScroll: true });
  if (paused) { setPaused(false); return; }
  if (e.pointerType === 'touch') {
    touch = touchUsed = true;
    if (S.mode === 'play') S.device = 'touch';
    if (finger) return; // one finger steers; a second one is for the buttons
    finger = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, moved: false };
    aim(e);
  } else if (e.button === 2 && !S.run.free) {
    rollNow = true; // on a course the right button is the roll call
  } else {
    aim(e);
    holding = true;
    holdT = 0;
  }
});
const lift = (e: PointerEvent, tap: boolean): void => {
  if (e.pointerType === 'touch') {
    if (!finger || finger.id !== e.pointerId) return;
    if (tap && !finger.moved && performance.now() - finger.t < 260) rollNow = true;
    finger = null;
    pointerOn = false;
  } else {
    // free flight: a click rolls, a hold was the thrusters. On a course the left button IS the boost order
    // (no delay: the ring kick is a matter of ticks), and the roll call is Space or the right button.
    if (tap && holding && holdT < HOLD && S.run.free) rollNow = true;
    holding = false;
    if (!tap) pointerOn = false;
  }
};
wrap.addEventListener('pointerup', (e) => lift(e, true));
wrap.addEventListener('pointerleave', (e) => lift(e, false));
wrap.addEventListener('pointercancel', (e) => lift(e, false));
wrap.addEventListener('contextmenu', (e) => { if (touch || ui === 'fly') e.preventDefault(); });
wrap.addEventListener('wheel', (e) => {
  if (ui === 'fly' && rig.chase <= 0.5) wheelAlt = clamp((wheelAlt < 0 ? S.run.craft.altGoal : wheelAlt) - e.deltaY * 0.12, 0, 500);
}, { passive: true });
/** overhead view: the wheel sets a height goal that is fed through the controls (−1 = not in use) */
let wheelAlt = -1;
el.bView.addEventListener('click', nextView);
el.bAuto.addEventListener('click', toggleAuto);
el.bSkim.addEventListener('click', () => { skimOrder = !skimOrder; });
// the autopilot chip is also its speed switch (a tap or a click steps to the next tier)
el.intent.addEventListener('pointerdown', (e) => { e.stopPropagation(); setSpeed(speedIdx + 1); });
el.bPause.addEventListener('click', () => setPaused(!paused));
const boostBtn = (on: boolean) => (e: Event): void => {
  e.stopPropagation();
  if (on) held.add('TouchBoost');
  else held.delete('TouchBoost');
  el.bBoost.classList.toggle('on', on);
};
el.bBoost.addEventListener('pointerdown', (e) => {
  try { el.bBoost.setPointerCapture(e.pointerId); } catch { /* the touch has already ended: the button simply is not captured */ }
  boostBtn(true)(e);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.bBoost.addEventListener(ev, boostBtn(false));

// ── frame budget: the picture gets coarser before it gets slower ──
/** The renderer runs on the CPU and costs in proportion to the art pixels drawn. A slow phone must not drop
 *  frames, so the work of each frame is timed: when its running mean stays over the budget the art pixel grows one
 *  step (fewer pixels to draw), and it comes back down only after a long calm stretch. Presentation only. */
const Pace = { budgetMs: 11, calmMs: 5, raiseAfter: 45, lowerAfter: 600, maxSteps: 4 } as const;
let coarser = 0;
let workMs = 0;
let hot = 0;
let calm = 0;
/** test hook: a budget override in ms (0 = the real one) */
let budgetOverride = 0;
function pace(ms: number): void {
  workMs += (ms - workMs) * 0.1;
  const budget = budgetOverride || Pace.budgetMs;
  if (workMs > budget) { hot++; calm = 0; } else if (workMs < Math.min(Pace.calmMs, budget / 2)) { calm++; hot = 0; } else { hot = 0; calm = 0; }
  if (hot >= Pace.raiseAfter && coarser < Pace.maxSteps) { coarser++; hot = 0; workMs = 0; layout(); }
  else if (calm >= Pace.lowerAfter && coarser > 0) { coarser--; calm = 0; layout(); }
}

// ── layout: a whole number of screen pixels per art pixel ──
let image: ImageData | null = null;
function layout(): void {
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (!cw || !ch || !R) return;
  // the size the picture wants, plus however many steps the frame budget has taken away (see `pace`)
  px = Math.min(12, Math.max(2, Math.round(Math.sqrt((cw * ch) / 100000))) + coarser);
  const lw = Math.ceil(cw / px);
  const lh = Math.ceil(ch / px);
  if (canvas.width !== lw || canvas.height !== lh) {
    canvas.width = lw;
    canvas.height = lh;
  }
  if (R.W !== lw || R.H !== lh) {
    R.resize(lw, lh);
    image = null;
  }
  canvas.style.width = `${lw * px}px`;
  canvas.style.height = `${lh * px}px`;
  canvas.style.left = `${Math.round((cw - lw * px) / 2)}px`;
  canvas.style.top = `${Math.round((ch - lh * px) / 2)}px`;
}
new ResizeObserver(layout).observe(wrap);

// ── drawing the game's own things with the kit ──
function drawGate(g: Gate, active: boolean, near: boolean, jetV: number): void {
  const ux = Math.cos(g.h);
  const uy = Math.sin(g.h);
  const n = clamp(Math.ceil(g.r * 5.2), 24, 120);
  const pulse = (fxTime * 6) | 0;
  for (let i = 0; i < n; i++) {
    if (!active && (i & 1) === 1) continue; // the ring after next is dotted
    const a = (i / n) * 6.2832;
    // a knife gate is a diamond
    const rr = g.knife ? g.r / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) : g.r;
    const ca = Math.cos(a) * rr;
    if (!cam.project(g.x + ux * ca, g.y + uy * ca, g.z + Math.sin(a) * rr)) continue;
    if (cam.sv > jetV === near) continue;
    const size = Math.max(1, Math.round(cam.sm * (active ? 1.8 : 1.1)));
    const on = (((i >> 2) + pulse) & 1) === 1;
    const col = !active ? COL.gateNext : g.knife ? (on ? COL.knifeA : COL.knifeB) : on ? COL.gateA : COL.gateB;
    R.plot(Math.round(cam.sx - size / 2), Math.round(cam.sy - size / 2), size, col, cam.sv);
  }
}
const tPose: Pose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, scale: 1 };
function drawTarget(tg: Target, i: number): void {
  tPose.x = tg.x; tPose.y = tg.y; tPose.z = tg.z; tPose.roll = 0; tPose.pitch = 0;
  if (tg.kind === 'balloon') {
    tPose.scale = 1.15;
    tPose.yaw = fxTime * 0.5 + i * 1.7;
    tPose.z = tg.z + Math.sin(fxTime * 1.3 + i) * 0.8;
    R.drawSprite(cam, BALLOON, tg.hit > 0 ? palFlash : palBalloon, tPose, fxTime);
  } else {
    const c = S.run.craft;
    tPose.scale = 1.1;
    tPose.yaw = Math.atan2(c.x - tg.x, -(c.y - tg.y)); // the barrel follows the jet
    R.drawSprite(cam, GUN, tg.hit > 0 ? palFlash : palGun, tPose, fxTime);
  }
}
function drawThings(near: boolean, jetV: number): void {
  const run = S.run;
  if (run.free) drawArches(near, jetV);
  else if (run.state === 'fly') {
    const nx = run.gates[run.gateIdx + 1];
    if (nx) drawGate(nx, false, near, jetV);
    drawGate(run.gates[run.gateIdx], true, near, jetV);
  }
  run.targets.forEach((tg, i) => {
    if (!cam.project(tg.x, tg.y, tg.z) || cam.sv > jetV === near) return;
    drawTarget(tg, i);
  });
  for (const s of run.shells) {
    if (!cam.project(s.x, s.y, s.z) || cam.sv > jetV === near) continue;
    // a shell is the one thing that hurts: the only red-and-yellow blinking disc on screen
    R.disc(cam.sx, cam.sy, Math.max(1.5, 2.4 * cam.sm), ((fxTime * 14) | 0) & 1 ? COL.shellA : COL.shellB, cam.sv);
  }
}
function drawFx(): void {
  // from behind, a long trail runs back past the eye and reads as two rails across the frame (seen in the box
  // screenshots twice): there it is kept to the stretch right behind the wingtips
  const life = (2.6 - 2.42 * rig.chase) * (0.3 + 0.7 * S.run.craft.g);
  for (let w = 0; w < 2; w++) {
    const tr = trail[w];
    for (let n = 0; n + 1 < trailLen; n++) {
      const o = ((trailHead - 1 - n + TRAIL_N * 2) % TRAIL_N) * 4;
      const o2 = ((trailHead - 2 - n + TRAIL_N * 2) % TRAIL_N) * 4;
      const age = (fxTime - tr[o + 3]) / life;
      if (age >= 1) break;
      R.segment(cam, tr[o], tr[o + 1], tr[o + 2], tr[o2], tr[o2 + 1], tr[o2 + 2], COL.white, age < 0.5 ? 1 : (1 - age) * 2);
    }
  }
  const night = R.tod === 'night' ? 0.55 : 1;
  for (const s of smoke) {
    const age = fxTime - s.born;
    if (age >= s.life) continue;
    const u = age / s.life;
    const push = (1 - Math.exp(-age * 5)) / 5;
    if (!cam.project(s.x + s.px * push, s.y + s.py * push, s.z + age * 2.5)) continue;
    const rad = Math.max(0.8, s.size * (1 + 2.4 * u) * cam.sm);
    // a puff close to the eye would be a grey ball over the picture (seen in the first box screenshots): dropped
    if (rad > FxLimits.puffPx) continue;
    const shade = 26 + 70 * u;
    R.puff(cam.sx, cam.sy, rad, pack(shade, shade + 1, shade + 7), 0.7 * s.strength * (1 - u) * (1 - u) * (u < 0.08 ? u / 0.08 : 1) * night, cam.sv);
  }
}
function drawSparks(): void {
  for (const p of parts) {
    if (!cam.project(p.x, p.y, p.z)) continue;
    const u = (fxTime - p.born) / p.life;
    const col = p.kind === 1 ? R.flamePal[Math.min(5, (u * 6) | 0)] : p.kind === 2 ? (u < 0.4 ? COL.scrapA : COL.scrapB) : p.kind === 3 ? COL.spray : p.kind === 4 ? COL.steel : u < 0.35 ? COL.white : COL.gateA;
    // a spark next to the eye would be a block the size of a button: capped
    const size = Math.min(FxLimits.sparkPx, Math.max(1, Math.round(cam.sm * p.size * (p.kind === 1 ? 1.6 : 1.1) * (1 - 0.5 * u))));
    R.plot(Math.round(cam.sx), Math.round(cam.sy), size, col, cam.sv);
  }
  for (const tr of tracers) R.segment(cam, tr.x, tr.y, tr.z, tr.tx, tr.ty, tr.tz, COL.tracer, 0.8);
}
/** Speed lines at the edge of the frame while the thrusters are open (chase view). */
function drawSpeed(): void {
  const b = S.run.craft.boost * rig.chase;
  if (b < 0.25 || reduced) return;
  const { W, H } = R;
  const n = Math.round(22 * b);
  for (let i = 0; i < n; i++) {
    const a = fxRand() * 6.2832;
    const r0 = (0.58 + fxRand() * 0.3) * Math.hypot(W, H) * 0.5;
    const r1 = r0 + (8 + fxRand() * 22) * b;
    const cx = W / 2;
    const cy = cam.cy - H * 0.1;
    R.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.8, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.8, COL.white, 0.35 + 0.3 * b, 1, -1e9);
  }
}
/** Marks drawn over the picture: the gun lock, the line to the ring, the autopilot's plan, the edge arrow. */
function drawMarks(): void {
  const { W, H } = R;
  const run = S.run;
  const c = run.craft;
  const lock = run.lock;
  if (lock && cam.project(lock.x, lock.y, lock.z)) {
    const r = Math.max(5, Math.round(lock.r * cam.sm) + 4);
    const x = Math.round(cam.sx);
    const y = Math.round(cam.sy);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      R.line(x + dx * r, y + dy * r, x + dx * (r - 3), y + dy * r, COL.lock, 1, 1, -1e9);
      R.line(x + dx * r, y + dy * r, x + dx * r, y + dy * (r - 3), COL.lock, 1, 1, -1e9);
    }
  }
  if (run.state !== 'fly') return;
  const g = run.free ? roamTarget() : run.gates[run.gateIdx];
  if (!g) return;
  // a row of dots from the nose to the ring: it gives the distance and the height at a glance
  for (let k = 1; k <= 7 && !run.free; k++) {
    const u = k / 8;
    if (cam.project(c.x + (g.x - c.x) * u, c.y + (g.y - c.y) * u, c.z + (g.z - c.z) * u)) R.plot(Math.round(cam.sx), Math.round(cam.sy), cam.sm > 2 ? 2 : 1, COL.guide, cam.sv);
  }
  if (!run.free) {
    // the AI shows where it is putting the nose
    const p = (S.auto ? S.expert.ai : S.pilot).plan;
    const az = clamp(p.az, c.floor, 500);
    R.segment(cam, c.x, c.y, c.z, p.ax, p.ay, az, COL.ai, 0.5);
    if (cam.project(p.ax, p.ay, az)) {
      const x = Math.round(cam.sx);
      const y = Math.round(cam.sy);
      for (let k = -3; k <= 3; k++) { R.plot(x + k, y - (3 - Math.abs(k)), 1, COL.ai, -1e9); R.plot(x + k, y + (3 - Math.abs(k)), 1, COL.ai, -1e9); }
    }
  }
  if (cam === seat) return; // the cockpit has its own instruments for where things are; the edge arrow is the frame's
  const seen = cam.project(g.x, g.y, g.z) && cam.sx > 6 && cam.sx < W - 6 && cam.sy > 6 && cam.sy < H - 6;
  if (seen) return;
  let dx: number;
  let dy: number;
  if (rig.chase > 0.5) {
    const b = wrapAngle(Math.atan2(g.x - c.x, -(g.y - c.y)) - c.yaw);
    dx = Math.sin(b);
    dy = -Math.cos(b);
  } else {
    const ox = g.x - cam.x;
    const oy = g.y - cam.y;
    dx = ox * cam.cos - oy * cam.sin;
    dy = ox * cam.sin + oy * cam.cos;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
  }
  const reach = Math.min((W / 2 - 10) / Math.max(1e-3, Math.abs(dx)), (H / 2 - 10) / Math.max(1e-3, Math.abs(dy)));
  const tx = W / 2 + dx * reach;
  const ty = H / 2 + dy * reach;
  const col = ((fxTime * 6) | 0) & 1 ? COL.gateA : COL.gateB;
  for (let k = 0; k < 7; k++) for (let s = -k; s <= k; s++) R.plot(Math.round(tx - dx * k - dy * s * 0.7), Math.round(ty - dy * k + dx * s * 0.7), 1, col, -1e9);
}
const gPose: Pose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, scale: SC };
function drawGhost(run: Run, p: ModelPalette, alpha: number, mark: number): void {
  const c = run.craft;
  const me = S.run.craft;
  // a ghost on top of the player is clutter, not information
  if (Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z) < 16) return;
  R.drawSprite(cam, sprite, p, poseOf(c, gPose), fxTime, undefined, alpha);
  // a small marker over it, so a ghost far away is still found
  if (cam.project(c.x, c.y, c.z + 9)) for (let k = 0; k < 3; k++) for (let w = -k; w <= k; w++) R.plot(Math.round(cam.sx + w), Math.round(cam.sy - k), 1, mark, -1e9);
}

/** The cockpit view: the world is drawn from the seat onto a larger sheet, turned by the bank into the frame, and
 *  the cockpit — canopy, panel, live instruments, head-up display — is laid over it. */
function renderCockpit(): void {
  const F = R;
  const size = cockpitSheet(F.W, F.H);
  let RS = sheets.get(world);
  if (!RS) sheets.set(world, (RS = new StackRenderer(world, { cloudAlt: CLOUD[0] })));
  if (RS.W !== size.w || RS.H !== size.h) RS.resize(size.w, size.h);
  RS.cloudCover = F.cloudCover;
  if (RS.tod !== F.tod) RS.setTimeOfDay(F.tod);
  const c = S.run.craft;
  const pivotY = Math.round(F.H * Cockpit.pivot);
  const focal = aimCockpit(seat, F.W, F.H, subject, c.pitch, SC);
  const horizonY = seat.cy;
  // the same view, centred on the sheet
  seat.cx = RS.W >> 1;
  seat.cy = (RS.H >> 1) + (horizonY - pivotY);
  // the view follows the bank of a turn (not the full spin of a roll), up to what the sheet covers
  const roll = clamp(c.roll, -Cockpit.maxRoll, Cockpit.maxRoll);
  cam = seat;
  R = RS;
  R.drawWorld(cam, fxTime, []);
  R.drawSky(cam);
  drawThings(false, -1e9); // everything is ahead of the seat: one pass
  if (S.best && S.best.run.state === 'fly') drawGhost(S.best.run, palBest, 0.4, COL.best);
  if (S.rival && S.rival.state === 'fly') drawGhost(S.rival, palRival, 0.55, COL.rival);
  drawSparks();
  if (S.mode !== 'attract') drawMarks();
  R = F;
  cam = rig.cam;
  F.turnFrom(RS, roll, pivotY);
  const key = `${F.W}x${F.H}:${F.tod}`;
  if (!cockArt || cockKey !== key) {
    cockKey = key;
    cockArt = buildCockpit(F.W, F.H, { body: Array.from({ length: 9 }, (_, i) => pal.base[1 + i]), hot: Array.from({ length: 6 }, (_, i) => pal.base[17 + i]) });
  }
  const sn = Math.sin(c.yaw);
  const cs = Math.cos(c.yaw);
  const sl = Math.hypot(F.sunX, F.sunY) || 1;
  const blips: number[] = [];
  for (const g of [S.rival, S.best?.run]) if (g && g.state === 'fly') { const ex = g.craft.x - c.x; const ey = g.craft.y - c.y; blips.push(ex * cs + ey * sn, ex * sn - ey * cs); }
  drawCockpit(F.fb, cockArt, {
    time: fxTime, inPlace: 1, hud: 1, roll, pitch: c.pitch, heading: c.yaw, speed: c.speed, speedMax: FLIGHT.speed * FLIGHT.boost * 1.08, alt: c.z,
    altMax: Math.max(FLIGHT.cruise, FLIGHT.ceiling), climb: clamp(c.tilt / 0.5, -1, 1), turn: clamp(c.yawRate / FLIGHT.agility, -1, 1), boost: c.boost,
    pivotY, horizonY, focal, headX, headY: headY + (c.boost > 0.2 && !reduced ? ((((fxTime * 30) | 0) & 1) - 0.5) * 1.5 * c.boost : 0),
    sunSide: (-F.sunX * cs - F.sunY * sn) / sl, sunReach: 0.72 - 0.28 * ((-F.sunX * sn + F.sunY * cs) / sl), sunColor: SUN[F.tod], sunPower: F.tod === 'sunset' ? 1.1 : F.tod === 'night' ? 0.45 : 1,
    land: (right, ahead) => { const mt = world.mat[((((c.y + right * sn - ahead * cs) | 0) & world.mask) << world.shift) | (((c.x + right * cs + ahead * sn) | 0) & world.mask)]; return mt >= 12 ? 3 : mt >= 4 ? 2 : mt >= 2 ? 1 : 0; },
    blips, jet: jetTop,
  });
  image ??= new ImageData(F.bytes, F.W, F.H);
  ctx.putImageData(image, 0, 0);
}

function render(): void {
  if (!R || !R.W) return;
  syncPose();
  rig.aim(R.W, R.H, subject);
  if (cockpit && ui === 'fly' && S.mode !== 'attract') { renderCockpit(); return; }
  const casters: ShadowCaster[] = [{ sprite, pose }];
  R.drawWorld(cam, fxTime, casters);
  R.drawSky(cam);
  drawFx();
  const jetV = cam.project(pose.x, pose.y, pose.z) ? cam.sv : 0;
  drawThings(false, jetV);
  if (S.best && S.best.run.state === 'fly') drawGhost(S.best.run, palBest, 0.4, COL.best);
  if (S.rival && S.rival.state === 'fly') drawGhost(S.rival, palRival, 0.55, COL.rival);
  const c = S.run.craft;
  const plumes: Plumes = {
    nozzles: JET_NOZZLES, length: plumeLength(c), wide: 1.15 * (1 + 0.22 * c.boost), bend: clamp(c.yawRate / FLIGHT.agility, -1, 1) * 0.36,
    arch: c.tilt * 0.35, heat: c.boost, behind: rig.chase > 0.5,
  };
  // a moment of mercy after a hit: the jet blinks
  if (S.run.mercy <= 0 || ((fxTime * 16) | 0) & 1) R.drawSprite(cam, sprite, pal, pose, fxTime, plumes);
  drawThings(true, jetV);
  drawSparks();
  drawSpeed();
  if (S.mode !== 'attract') drawMarks();
  image ??= new ImageData(R.bytes, R.W, R.H);
  ctx.putImageData(image, 0, 0);
}

// ── the loop: fixed ticks for the simulation, the frame's own time for everything drawn ──
let acc = 0;
/** ticks still to wait before the run starts (nothing is simulated or recorded while waiting) */
let holdTicks = 0;
function tick(): void {
  if (holdTicks > 0) {
    if (--holdTicks === 0 && S.mode === 'play') { banner(t('go'), 4, 0.8); audio.tone(880, 0.18, 'square', 0.06); }
    else if (S.mode === 'play' && holdTicks % 25 === 0) audio.tone(440, 0.08, 'square', 0.04);
    return;
  }
  const run = S.run;
  if (run.state === 'fly') {
    let ctl: Controls;
    if (run.free) {
      // free flight: the player points (or asks to be flown to an arch); nothing is recorded
      if (routing) ctl = routeControls();
      else {
        ctl = playerControls();
        if (wheelAlt >= 0 && ctl.alt < 0 && ctl.climb === 0) ctl = { ...ctl, alt: Math.round(wheelAlt) };
        else wheelAlt = -1;
      }
    } else if (S.auto) ctl = S.expert.act(run.view());
    else {
      // a course: the AI holds the stick, the player gives the orders
      const v = run.view();
      S.pilot.scan(v);
      ctl = S.pilot.act(v, playerOrders());
    }
    S.log.push(packControls(ctl));
    run.step(ctl);
    if (run.free && S.mode === 'play') {
      S.log.pairs.length = 0; // free flight is not a recorded run
      roam();
      if (S.run !== run) return; // an arch started a trial: this tick belongs to the old run
    }
    for (const e of run.events) onEvent(e);
    run.events.length = 0;
  } else if (S.mode === 'attract') {
    begin(ENDLESS, 'attract');
    return;
  } else {
    // the run is over: the craft idles on while the card comes up (never recorded)
    run.craft.x += run.craft.vx * TICK;
    run.craft.y += run.craft.vy * TICK;
  }
  if (S.rival && S.rival.state === 'fly') { S.rival.step(S.rivalPilot.act(S.rival.view())); S.rival.events.length = 0; }
  const b = S.best;
  if (b && b.run.state === 'fly') {
    while (b.left <= 0 && b.i + 2 < b.inputs.length) { b.i += 2; b.ctl = unpackControls(b.inputs[b.i]); b.left = b.inputs[b.i + 1]; }
    b.run.step(b.left > 0 ? b.ctl : NO_INPUT);
    b.left--;
    b.run.events.length = 0;
  }
}
let last = performance.now();
let frameNo = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  if (!paused) {
    pointerIdle += dt;
    if (holding) holdT += dt;
    acc += dt;
    // at most 3 ticks a frame: a stalled tab resumes, it does not fast-forward
    const k = speedNow();
    audio.quiet = k >= 8;
    for (let n = 0; acc >= TICK && n < 3; n++) {
      acc -= TICK;
      for (let j = 0; j < k && (j === 0 || (S.auto && S.run.state === 'fly')); j++) tick();
    }
    if (acc > TICK * 3) acc = 0;
    syncPose();
    stepFx(dt);
    rig.step(dt, subject, world);
    shake = Math.max(0, shake - dt);
  }
  if (S.level.id === FREE_ID && ui === 'fly') {
    const part = DAY_PARTS[Math.floor(S.run.time / DAY_PART_SECONDS) % DAY_PARTS.length];
    if (part !== R.tod) light(part);
  }
  audio.fly(S.run.craft.speed, S.run.craft.boost, S.level.chapter, ui === 'fly' && !paused && S.run.state === 'fly');
  // behind a menu the scene is decoration: it is drawn every other frame
  if (ui === 'fly' || (frameNo++ & 1) === 0) {
    const t0 = performance.now();
    render();
    if (ui === 'fly' && !paused) pace(performance.now() - t0);
  }
  canvas.style.transform = shake > 0 ? `translate(${Math.round(Math.sin(now / 17) * shake * 10)}px, ${Math.round(Math.cos(now / 13) * shake * 10)}px)` : '';
  hud();
}

// the open map is built in a worker right after the first frames, so the menu never stalls and open skies opens at once
let openWorker: Worker | null = null;
let openWaiting: (() => void) | null = null;
let openBuiltMs = -1;
function prebuildOpen(): void {
  const t0 = performance.now();
  const done = (): void => { openWorker = null; const go = openWaiting; openWaiting = null; go?.(); };
  try {
    openWorker = new Worker(new URL('./render/world-worker.ts', import.meta.url), { type: 'module' });
    openWorker.onmessage = (e: MessageEvent<StackWorld>) => { if (adoptOpen(e.data)) openBuiltMs = performance.now() - t0; openWorker?.terminate(); done(); };
    // a worker that cannot start or fails: the map is then built on the main thread when it is first needed
    openWorker.onerror = () => { openWorker?.terminate(); done(); };
    openWorker.postMessage(OPEN_OPTS);
  } catch {
    openWorker = null; // no module workers here: same fallback
  }
}
window.setTimeout(prebuildOpen, 600);

// a phone starts with tilt on: nobody finds a switch in Options before the first flight (owner, 2026-11-18:
// "I leaned left and right and nothing happened" — it was off by default). The sensors are asked for at the first tap.
if (!store.data.tiltSet && touch) store.data.tilt = true;

document.documentElement.lang = lang ? 'zh-CN' : 'en';
labels();
begin(ENDLESS, 'attract');
show('menu');
requestAnimationFrame(frame);

declare global {
  interface Window {
    __wavetop: unknown;
  }
}
window.__wavetop = {
  store,
  act,
  /** start a level by id (0 = endless); `auto` lets the autopilot fly it (watch mode) */
  start: (id: number, auto = false) => startLevel(id === 0 ? ENDLESS : id === DAILY_ID ? dailyLevel(today()) : id === FREE_ID ? FREE : LEVELS[id - 1], auto ? 'watch' : 'play'),
  /** open skies only: put the craft 70 px short of trial `i`'s arch, on its line (the e2e flies in from there) */
  toArch: (i: number): boolean => {
    const tr = trialsOf()[i];
    if (!S.run.free || !tr) return false;
    const c = S.run.craft;
    c.x = tr.start.x - Math.sin(tr.start.yaw) * 70;
    c.y = tr.start.y + Math.cos(tr.start.yaw) * 70;
    c.z = c.altGoal = tr.start.z;
    c.yaw = tr.start.yaw;
    c.yawRate = 0;
    syncPose();
    rig.seat(subject);
    return true;
  },
  /** open skies only (never a recorded run): put the craft over the first pixel of a biome, for screenshots */
  warp: (biome: number): boolean => {
    if (S.level.id !== FREE_ID) return false;
    for (let o = 0; o < world.biome.length; o += 4099) {
      if (world.biome[o] !== biome || world.height[o] < 2) continue; // over land (frost is low: 2 px is already a field)
      S.run.craft.x = o & world.mask;
      S.run.craft.y = o >> world.shift;
      syncPose();
      rig.seat(subject);
      return true;
    }
    return false;
  },
  toggleAuto,
  nextView,
  setView,
  setSpeed,
  /** frame budget override for the e2e (0 restores the real one) */
  setBudget: (ms: number): void => { budgetOverride = ms; hot = calm = 0; },
  /** mean and worst milliseconds of drawing one frame (no simulation), over `n` frames of the current scene */
  bench: (n = 120): { mean: number; worst: number; w: number; h: number } => {
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      render();
      const d = performance.now() - t0;
      sum += d;
      if (d > worst) worst = d;
    }
    return { mean: sum / n, worst, w: R.W, h: R.H };
  },
  state: () => ({
    ui, mode: S.mode, level: S.level.id, run: S.run.state, tick: S.run.tick, clock: S.run.clock, gate: S.run.gateIdx, passed: S.run.passed, missed: S.run.missed,
    score: Math.floor(S.run.score), auto: S.auto, assisted: S.assisted, rival: S.rival ? S.rival.gateIdx : -1, ghost: !!S.best, w: R.W, h: R.H, px, lang,
    stars: { ...store.data.stars }, records: store.data.records.length, touch, intent: (S.auto ? S.expert.ai : S.pilot).plan.intent, digest: S.run.digest(), alert: S.pilot.alert, kicks: S.run.kicks, orders: lastOrders, routing, tiltOpt: store.data.tilt, tiltBar: !el.tiltbar.classList.contains('off'),
    speed: speedNow(), bgm: audio.bgm, tod: R.tod, coarser, workMs, view: viewNow(), tilt: tiltLive, tiltFresh: tiltFresh(), tiltWhy, yawRate: S.run.craft.yawRate, openReady: openReady(), openBuiltMs, free: S.run.free, league: leagueStars(), explored: exploredShare(), map: !el.map.classList.contains('off'),
    biome: world.biome[(((S.run.craft.y | 0) & world.mask) << world.shift) | ((S.run.craft.x | 0) & world.mask)],
  }),
  exportText,
};
