// The levels harness: every course gets ONE measured knob — the seconds a ring pays — set so the reference
// commanders (a population of scripted casual humans commanding the autopilot) clear it at its target rate.
// The expert commander (the rival ghost) is measured beside them and never tunes anything.
//
//   npx tsx scripts/levels.ts --tune            measure every level, write src/core/levels.tuned.ts, gate
//   npx tsx scripts/levels.ts --check           re-measure with the stored table: exact replay + gate (exit 1 = red)
//   npx tsx scripts/levels.ts --explain 7       per-seed needs and per-ring times of one level
//
// A run with no clock yields the exact pay it would have needed (`Run.need`), so one flight per pilot gives the
// whole win-rate-against-pay curve: no bisection, no rounding inside the sim. Runs on the box (remote.sh).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpuMs } from '../src/ai/headless';
import { ExpertCommander } from '../src/ai/pilot';
import { RefHabits, ReferenceCommander } from '../src/ai/reference';
import { CHAPTERS, LEVELS, SECTORS, type LevelDef } from '../src/core/levels';
import { FINGERPRINT, TUNED } from '../src/core/levels.tuned';
import { fly, FLIGHT, Rules, type Pilot } from '../src/core/sim';
import { TRIALS_PER_BIOME, TRIAL_ID0 } from '../src/core/trials';
import { levelById, trialsOf, worldOf } from '../src/core/worlds';
import { checkLevel, fingerprint, gate, limitFor, median, share, type HarnessLimits, type LevelRow, type Measured } from '../src/engine/harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** reference pilots per level (≥ 48: fewer makes the win rate a coin flip) */
export const REF_SEEDS = Array.from({ length: 48 }, (_, i) => i + 1);
/** centiseconds per ring: the knob's range, and the gate */
export const LIMITS: HarnessLimits = { min: 120, max: 1500, tolerance: 0.15, minRatio: 1.15, maxMs: 15 };
const CAP_SECONDS = 900;
/** everything tuning depends on besides code (code changes are caught by the exact replay in --check) */
/** every tuned course: the campaign, then the league's trials on the open map */
export const ALL = (): LevelDef[] => [...LEVELS, ...trialsOf()];
export const inputs = () => ({ ALL: ALL(), CHAPTERS, Rules, FLIGHT, RefHabits, REF_SEEDS, LIMITS });

interface Flown { need: number; time: number; ms: number; stalled: boolean }
function flown(level: LevelDef, pilot: Pilot): Flown {
  const t0 = cpuMs();
  const run = fly(worldOf(level), level, Infinity, pilot, CAP_SECONDS);
  const ms = (cpuMs() - t0) / Math.max(1, run.tick);
  const done = run.state === 'won';
  return { need: done ? Math.ceil(run.need * 100) : Infinity, time: run.time, ms, stalled: !done };
}

export interface Sample { ref: Flown[]; ai: Flown }
const samples = new Map<number, Sample>();
export function sample(level: LevelDef): Sample {
  let s = samples.get(level.id);
  if (!s) samples.set(level.id, (s = { ref: REF_SEEDS.map((seed) => flown(level, new ReferenceCommander(seed))), ai: flown(level, new ExpertCommander()) }));
  return s;
}
/** the harness's `measure`: needs do not depend on the candidate limit (pilots do not read the clock) */
const measure = (n: number): Measured => {
  const s = sample(levelById(n)!);
  return { ai: [s.ai.need], ref: s.ref.map((f) => f.need), ms: s.ai.ms, stalls: s.ai.stalled ? 1 : 0 };
};

function rowOf(level: LevelDef, limit: number): LevelRow {
  return checkLevel(level.id, level.target, limit, measure, LIMITS);
}
const fmt = (r: LevelRow, level: LevelDef, s: Sample): string =>
  `${String(r.n).padStart(2)} ${level.name[0].padEnd(15)} pay ${(r.limit / 100).toFixed(2)}s  ref ${Math.round(r.ref * 100)}% (target ${Math.round(r.target * 100)}%)  ai ${Math.round(r.ai * 100)}%  need ref ${(r.needRef / 100).toFixed(2)} / ai ${(r.needAi / 100).toFixed(2)}  par ${median(s.ref.map((f) => f.time), CAP_SECONDS).toFixed(1)}s ai ${s.ai.time.toFixed(1)}s  ${r.ms.toFixed(3)} ms/tick`;

function main(argv: string[]): number {
  const ex = argv.indexOf('--explain');
  if (ex >= 0) {
    const level = levelById(Number(argv[ex + 1]));
    if (!level) { console.error(JSON.stringify({ error: 'no_such_level', message: '--explain <level id>', actual: argv[ex + 1], allowed: `1..${LEVELS.length}, ${TRIAL_ID0}..` })); return 2; }
    const s = sample(level);
    console.log(`level ${level.id} ${level.name[0]}: ${level.gates} rings, target ${level.target}`);
    console.log(`reference needs (s/ring), sorted: ${s.ref.map((f) => (f.need / 100).toFixed(2)).sort().join(' ')}`);
    console.log(`autopilot need ${(s.ai.need / 100).toFixed(2)} · time ${s.ai.time.toFixed(1)} s`);
    const run = fly(worldOf(level), level, Infinity, new ReferenceCommander(1));
    console.log('reference pilot 1, ring by ring (t, off-centre in radii, pass):');
    run.gateLog.forEach((g, i) => console.log(`  ${String(i + 1).padStart(2)}  ${g.t.toFixed(1)}s  ${g.off.toFixed(2)}  ${g.pass ? 'pass' : 'MISS'}`));
    return 0;
  }
  const mode = argv.includes('--check') ? 'check' : argv.includes('--tune') ? 'tune' : null;
  if (!mode) { console.error('usage: levels.ts --tune | --check | --explain <level>'); return 2; }
  const fp = fingerprint(inputs());
  const rows: LevelRow[] = [];
  const fails: string[] = [];
  const out: string[] = [];
  for (const level of ALL()) {
    const s = sample(level);
    const stored = TUNED[level.id];
    const limit = mode === 'tune' ? limitFor(s.ref.map((f) => f.need), level.target, LIMITS) : stored?.payCs;
    if (limit === undefined) { fails.push(`level ${level.id}: no tuned value (run --tune)`); continue; }
    const r = rowOf(level, limit);
    rows.push(r);
    const par = median(s.ref.map((f) => f.time), CAP_SECONDS);
    console.log(fmt(r, level, s));
    out.push(`  ${level.id}: { payCs: ${limit}, par: ${par}, ai: ${s.ai.time}, ref: ${share(s.ref.map((f) => f.need), limit)} },`);
    if (mode === 'check' && stored && (stored.par !== par || stored.ai !== s.ai.time)) fails.push(`level ${level.id}: replay differs from the stored table (par ${stored.par} → ${par}, ai ${stored.ai} → ${s.ai.time}) — code changed since --tune`);
    // the rival must be beatable in principle but hard: the autopilot is faster than the median reference pilot
    if (s.ai.time >= par) fails.push(`level ${level.id}: the autopilot (${s.ai.time.toFixed(1)} s) is not faster than the reference median (${par.toFixed(1)} s)`);
  }
  if (mode === 'check' && FINGERPRINT !== fp) fails.push(`fingerprint ${FINGERPRINT || '(none)'} ≠ ${fp}: level data or rules changed since --tune`);
  // the gate judges a whole group: campaign chapters of 5, league regions of 3
  fails.push(...gate(rows.filter((r) => r.n < TRIAL_ID0), mode, LIMITS, (n) => Math.floor((n - 1) / SECTORS), SECTORS, ' cs/ring'));
  fails.push(...gate(rows.filter((r) => r.n >= TRIAL_ID0), mode, LIMITS, (n) => Math.floor((n - TRIAL_ID0) / TRIALS_PER_BIOME), TRIALS_PER_BIOME, ' cs/ring', (g) => `league region ${g + 1}`));
  if (mode === 'tune') {
    writeFileSync(join(ROOT, 'src/core/levels.tuned.ts'),
      `// GENERATED by scripts/levels.ts --tune — do not edit. \`--check\` replays it exactly.\nexport const FINGERPRINT = '${fp}';\n/** per level id: payCs = centiseconds a ring pays (the measured knob) · par = the reference players' median\n *  finish time, s · ai = the autopilot's finish time, s · ref = the reference win rate at payCs */\nexport const TUNED: Record<number, { payCs: number; par: number; ai: number; ref: number }> = {\n${out.join('\n')}\n};\n`);
    console.log(`wrote src/core/levels.tuned.ts (${out.length} courses, fingerprint ${fp})`);
  }
  for (const f of fails) console.error(`✗ ${f}`);
  console.log(fails.length ? `${mode}: RED (${fails.length})` : `${mode}: green — ${rows.length} courses (${LEVELS.length} campaign + ${rows.length - LEVELS.length} league), ${REF_SEEDS.length} reference pilots each`);
  return fails.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
