// Human playtests against the reference player — the measurement the series never had ("is the reference
// player human-like?"). Feed it the text the game exports (menu → Playtest data → Copy / Download):
//
//   npx tsx scripts/playtest.ts runs1.txt runs2.txt …        # or: … < pasted.txt
//
// For every record it (1) replays the run from its inputs — `exact` means this build reproduced it bit for bit;
// a `diverged` record (other build, or edited) is listed and left out of the numbers; (2) reads the pay per ring
// the human needed, the same ruler the levels are tuned with. Per level it prints the human clear rate at the
// shipped pay next to the reference player's, the humans' median need next to the reference median, and the
// ratings. A level is flagged when people clear it more than 15 points off its target.
// Exit 0 printed · 1 nothing usable · 2 usage. It never writes: retuning stays a decision.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReferenceCommander } from '../src/ai/reference';
import { TUNED } from '../src/core/levels.tuned';
import { decode, replay, type PlaytestRecord } from '../src/core/playtest';
import { fly } from '../src/core/sim';
import { levelById, worldOf } from '../src/core/worlds';

export interface LevelReport {
  level: number;
  runs: number;
  /** first attempts only: the cleanest reading of difficulty */
  firstTries: number;
  humanClear: number;
  refClear: number;
  target: number;
  humanNeed: number;
  refNeed: number;
  tooEasy: number;
  right: number;
  tooHard: number;
  fun: number;
  flag: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export function report(records: PlaytestRecord[]): { rows: LevelReport[]; diverged: number; exact: number } {
  let diverged = 0;
  const byLevel = new Map<number, Array<{ rec: PlaytestRecord; need: number; won: boolean }>>();
  for (const rec of records) {
    const level = levelById(rec.level);
    if (!level) continue; // endless and unknown levels carry no tuned pay to compare with
    const r = replay(rec, levelById, worldOf);
    if (r.verdict !== 'exact') { diverged++; continue; }
    // what this human would have needed with no clock: a lost run only proves "more than it had"
    const need = r.run.state === 'won' ? r.run.need : Infinity;
    byLevel.set(rec.level, [...(byLevel.get(rec.level) ?? []), { rec, need, won: r.run.state === 'won' }]);
  }
  const rows: LevelReport[] = [];
  for (const [id, runs] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const level = levelById(id)!;
    const pay = TUNED[id].payCs / 100;
    const refNeeds = Array.from({ length: 48 }, (_, i) => fly(worldOf(level), level, Infinity, new ReferenceCommander(i + 1)).need);
    const rated = runs.filter((x) => x.rec.rating);
    const humanClear = runs.filter((x) => x.won).length / runs.length;
    const off = humanClear - level.target;
    rows.push({
      level: id, runs: runs.length, firstTries: runs.filter((x) => x.rec.attempt === 1).length, humanClear, refClear: TUNED[id].ref, target: level.target,
      humanNeed: median(runs.map((x) => x.need).filter(Number.isFinite)), refNeed: median(refNeeds),
      tooEasy: rated.filter((x) => x.rec.rating!.hard === -1).length, right: rated.filter((x) => x.rec.rating!.hard === 0).length, tooHard: rated.filter((x) => x.rec.rating!.hard === 1).length,
      fun: median(rated.map((x) => x.rec.rating!.fun).filter((f) => f > 0)),
      flag: runs.length < 8 ? `only ${runs.length} runs: not enough to judge` : Math.abs(off) > 0.15 ? `people clear ${Math.round(humanClear * 100)} %, target ${Math.round(level.target * 100)} %: the reference player is ${off < 0 ? 'too strong' : 'too weak'} here (pay was ${pay.toFixed(2)} s)` : '',
    });
  }
  return { rows, diverged, exact: records.length - diverged };
}

function main(argv: string[]): number {
  const texts = argv.length ? argv.map((f) => readFileSync(f, 'utf8')) : [readFileSync(0, 'utf8')];
  let records: PlaytestRecord[] = [];
  try {
    records = texts.flatMap((x) => decode(x));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const { rows, diverged, exact } = report(records);
  console.log(`${records.length} records · ${exact} replayed exactly · ${diverged} diverged (left out)`);
  if (!rows.length) { console.log('no campaign run to report'); return 1; }
  console.log('level  runs  1st  human%  ref%  target  need human / ref   easy/right/hard  fun   note');
  for (const r of rows) {
    const p = (x: number): string => `${Math.round(x * 100)}`.padStart(4);
    console.log(`${String(r.level).padStart(5)} ${String(r.runs).padStart(5)} ${String(r.firstTries).padStart(4)}  ${p(r.humanClear)}   ${p(r.refClear)}   ${p(r.target)}    ${Number.isNaN(r.humanNeed) ? '  —' : r.humanNeed.toFixed(2)} / ${r.refNeed.toFixed(2)}        ${r.tooEasy}/${r.right}/${r.tooHard}        ${Number.isNaN(r.fun) ? '—' : r.fun}   ${r.flag}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
