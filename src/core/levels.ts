/** The campaign: data only. One level = one seeded course + ONE measured knob (seconds a gate pays, tuned by
 *  `scripts/levels.ts` against the reference player — never against the autopilot). Each chapter has its own
 *  island world and light; each sector teaches one thing and the fifth is the chapter's gauntlet. */
import type { TimeOfDay } from '../engine/stack3d/math';

export interface Chapter {
  name: readonly [string, string];
  worldSeed: number;
  land: number;
  clouds: number;
  tod: TimeOfDay;
}

export interface LevelDef {
  /** 1-based, campaign order */
  id: number;
  chapter: number;
  name: readonly [string, string];
  /** the one thing this sector teaches (shown before the run) */
  teach: readonly [string, string];
  seed: number;
  gates: number;
  /** how hard legs turn: the swing is 0.25 + rnd · swing (radians) */
  swing: number;
  /** share of gates at wave-top / over the clouds / high */
  bands: readonly [number, number, number];
  radius: number;
  /** balloons per leg (expected) */
  balloons: number;
  /** chance of a flak gun at a gate */
  flak: number;
  /** share of gates that are knife gates (roll through them for the stunt bonus) */
  knife: number;
  /** the reference player's win rate this level is tuned to */
  target: number;
  /** legs are this many times as long (default 1): a mail run is a few rings far apart */
  legScale?: number;
  /** where the craft starts (default: the world's spawn point, heading 0.9) — set by trials and by free flight */
  start?: { x: number; y: number; z: number; yaw: number };
}

export const CHAPTERS: readonly Chapter[] = [
  { name: ['Morning Run', '晨间航线'], worldSeed: 7, land: 0.3, clouds: 0.35, tod: 'day' },
  { name: ['Reef Country', '礁岛群'], worldSeed: 23, land: 0.42, clouds: 0.5, tod: 'day' },
  { name: ['Ember Coast', '余烬海岸'], worldSeed: 41, land: 0.36, clouds: 0.55, tod: 'sunset' },
  { name: ['Night Mail', '夜航邮路'], worldSeed: 58, land: 0.33, clouds: 0.45, tod: 'night' },
];

/** Sawtooth: each chapter starts gentle and ends on its gauntlet. */
const TARGETS = [0.9, 0.84, 0.78, 0.72, 0.64] as const;

type Row = [name: readonly [string, string], teach: readonly [string, string], gates: number, swing: number, bands: readonly [number, number, number], radius: number, balloons: number, flak: number, knife: number];
const ROWS: readonly Row[] = [
  // ── 1 Morning Run: the controls, one at a time
  [['First Light', '第一缕光'], ['The AI flies the rings. Hold boost on the straights.', 'AI 负责穿环。直线上按住加力。'], 6, 0.35, [0.0, 1, 0], 26, 0, 0, 0],
  [['Wavetops', '浪尖'], ['Order a skim (S): the AI rides the wavetops and the thrusters refill.', '下令掠海（S）：AI 贴着浪尖飞，推进器回能。'], 7, 0.4, [0.7, 0.3, 0], 25, 0, 0, 0],
  [['Up and Over', '翻越云层'], ['Press boost right after a ring: the kick. Energy back, +0.3 s.', '过环后立刻按加力：环后点火，回能量，+0.3 秒。'], 8, 0.45, [0.4, 0.4, 0.2], 24, 0.6, 0, 0],
  [['Balloon Day', '气球日'], ['Hunt (H): the AI leaves the line for balloons. Each one pays time.', '打气球（H）：AI 会离线去追气球，打爆加时间。'], 8, 0.5, [0.4, 0.5, 0.1], 23, 1.6, 0, 0],
  [['Harbour Dash', '港湾冲刺'], ['Everything so far, against the clock.', '把学到的都用上，和时间赛跑。'], 10, 0.6, [0.45, 0.4, 0.15], 22, 1, 0, 0],
  // ── 2 Reef Country: flak and the roll
  [['Warning Shots', '警告射击'], ['When FLAK flashes, call the roll (Space / right button): the shell passes through.', '「炮弹来袭」亮起时喊翻滚（空格 / 右键），炮弹会穿过去。'], 8, 0.5, [0.4, 0.5, 0.1], 23, 0.8, 0.5, 0],
  [['Knife Edge', '刀锋'], ['Call the roll at a diamond gate for the stunt bonus.', '到菱形门时喊翻滚，拿特技奖励。'], 9, 0.55, [0.45, 0.45, 0.1], 22, 0.8, 0.3, 0.4],
  [['Low Road', '低空航道'], ['Long low legs: keep the skim order on and kick every ring.', '低空长航段：一直掠海，每个环都点火。'], 10, 0.6, [0.75, 0.25, 0], 21, 1, 0.6, 0.2],
  [['Reef Ladder', '礁石阶梯'], ['Climb and dive between every ring.', '每道环之间都要爬升或俯冲。'], 10, 0.6, [0.4, 0.2, 0.4], 21, 1, 0.5, 0.2],
  [['Gun Alley', '炮火走廊'], ['A gun at nearly every ring.', '几乎每道环都有一门炮。'], 12, 0.7, [0.5, 0.35, 0.15], 20, 1.2, 0.85, 0.25],
  // ── 3 Ember Coast: tighter, faster, in low light
  [['Long Shadows', '长影'], ['Smaller rings: fly the centre for a bullseye.', '环更小了：穿正中心拿靶心。'], 9, 0.6, [0.4, 0.45, 0.15], 18, 1, 0.4, 0.2],
  [['Switchback', '回头弯'], ['Hard turns: try the racing line (L) — and lift the boost before the ring.', '急弯：试试竞速走线（L），进环前松开加力。'], 10, 0.95, [0.45, 0.45, 0.1], 19, 0.8, 0.4, 0.2],
  [['Thermals', '热气流'], ['Balloons everywhere: time is in the air.', '满天气球：时间就飘在空中。'], 10, 0.7, [0.3, 0.5, 0.2], 18, 2.6, 0.3, 0.2],
  [['Tracer Dusk', '曳光黄昏'], ['Flak and knife gates together.', '高射炮加菱形门。'], 11, 0.75, [0.45, 0.4, 0.15], 18, 1.2, 0.7, 0.45],
  [['Ember Gauntlet', '余烬试炼'], ['The coast throws everything at you.', '整条海岸线的火力。'], 14, 0.85, [0.45, 0.35, 0.2], 17, 1.4, 0.8, 0.35],
  // ── 4 Night Mail: the lot, in the dark
  [['Lamplight', '灯塔'], ['Night: follow the lit rings.', '夜航：跟着发光的环。'], 10, 0.6, [0.4, 0.45, 0.15], 18, 1, 0.4, 0.2],
  [['Star Road', '星路'], ['High and fast over the clouds.', '云上高速航段。'], 11, 0.65, [0.15, 0.45, 0.4], 17, 1.2, 0.5, 0.25],
  [['Black Water', '黑水'], ['A whole course on the wavetops.', '全程贴海。'], 12, 0.8, [0.9, 0.1, 0], 17, 1.2, 0.75, 0.3],
  [['Night Fighters', '夜战'], ['Tight rings, hard turns, guns.', '小环、急弯、炮火。'], 13, 0.95, [0.45, 0.35, 0.2], 16, 1.4, 0.8, 0.4],
  [['Last Mail', '最后一班邮机'], ['The longest run. Deliver it.', '最长的一程。把信送到。'], 16, 0.9, [0.45, 0.35, 0.2], 16, 1.6, 0.85, 0.4],
];

export const SECTORS = 5;
export const LEVELS: readonly LevelDef[] = ROWS.map(([name, teach, gates, swing, bands, radius, balloons, flak, knife], i) => ({
  id: i + 1, chapter: Math.floor(i / SECTORS), name, teach, seed: 1000 + i * 37, gates, swing, bands, radius, balloons, flak, knife, target: TARGETS[i % SECTORS],
}));

/** Endless score attack: not a campaign level and not tuned — its clock comes from `endlessPay`. */
export const ENDLESS: LevelDef = {
  id: 0, chapter: 0, name: ['Endless', '无尽模式'], teach: ['No finish line: how far can you go?', '没有终点：你能飞多远？'],
  seed: 1, gates: Infinity, swing: 0.6, bands: [0.45, 0.4, 0.15], radius: 22, balloons: 1.2, flak: 0.5, knife: 0.25, target: 0,
};
/** The daily run: endless rules on a course seeded by the day, so everyone flies the same sky that day.
 *  `day` is a whole number the page derives from the UTC date (yyyymmdd); the simulation never reads a clock. */
export const DAILY_ID = -1;
export function dailyLevel(day: number): LevelDef {
  return { ...ENDLESS, id: DAILY_ID, seed: day | 0, name: ['Daily run', '每日挑战'], teach: ['One course for everyone today.', '今天所有人同一条航线。'] };
}

/** Open skies: free flight over the five-biome map — no clock and no rings of its own (`gates: 0`); the league's
 *  trials (`./trials`) stand on this map and start when the craft flies through their arch. */
export const FREE_ID = -2;
export const FREE: LevelDef = { ...ENDLESS, id: FREE_ID, gates: 0, balloons: 0, flak: 0, name: ['Open skies', '开放空域'], teach: ['No clock. Go and look.', '没有时钟，随便飞。'] };

/** Endless: gates are grouped in stages of 8; each stage pays less per gate. */
export const ENDLESS_STAGE = 8;
export const endlessPay = (gateIdx: number): number => Math.max(1.6, 4.8 - Math.floor(gateIdx / ENDLESS_STAGE) * 0.35);
