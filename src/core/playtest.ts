/** Recorded human runs. A record carries the exact controls of every tick, so the run can be re-simulated
 *  anywhere (`replay`) and measured with the same ruler as the reference player (`need` = the pay per ring it
 *  would have taken). It carries no personal data: no name, no id, no address — a device class and what was flown.
 *
 *  Text form: "WT1." + base64(JSON). The page keeps the last runs in localStorage and can copy / download them;
 *  `scripts/playtest.ts` verifies and aggregates them. */
import type { StackWorld } from '../engine/stack3d/world';
import type { LevelDef } from './levels';
import { Run, unpackControls, type GateLog } from './sim';

export const PLAYTEST_VERSION = 1;
const PREFIX = 'WT1.';

/** Limits on what a record may claim (a pasted record is untrusted input). */
export const PlaytestLimits = { maxTicks: 60 * 60 * 20, maxRuns: 200_000, maxText: 4_000_000 } as const;

export interface PlaytestRecord {
  v: number;
  /** the build that recorded it (package version) */
  build: string;
  level: number;
  /** seconds per ring the run was played with */
  pay: number;
  device: 'mouse' | 'keys' | 'touch' | 'pad';
  /** run-length pairs: packed controls, tick count */
  inputs: number[];
  result: { state: 'won' | 'lost'; ticks: number; passed: number; missed: number; need: number; score: number; hits: number; pops: number };
  gates: GateLog[];
  digest: string;
  /** asked after the run: −1 too easy · 0 about right · 1 too hard; fun 1–5. Absent when skipped. */
  rating?: { hard: -1 | 0 | 1; fun: number };
  /** which try at this level in this browser (1 = first ever) */
  attempt: number;
}

export class InputLog {
  readonly pairs: number[] = [];
  push(packed: number): void {
    const n = this.pairs.length;
    if (n >= 2 && this.pairs[n - 2] === packed) this.pairs[n - 1]++;
    else this.pairs.push(packed, 1);
  }
}

export function record(run: Run, log: InputLog, meta: { build: string; device: PlaytestRecord['device']; attempt: number }): PlaytestRecord {
  if (run.state === 'fly') throw new Error(JSON.stringify({ error: 'run_not_over', message: 'only a finished run is recorded', actual: run.state, allowed: ['won', 'lost'] }));
  return {
    v: PLAYTEST_VERSION, build: meta.build, level: run.level.id, pay: run.pay, device: meta.device, inputs: log.pairs.slice(),
    result: { state: run.state, ticks: run.tick, passed: run.passed, missed: run.missed, need: run.need, score: Math.floor(run.score), hits: run.hits, pops: run.pops },
    gates: run.gateLog.slice(), digest: run.digest(), attempt: meta.attempt,
  };
}

// records are plain ASCII JSON (numbers and fixed keys), so base64 needs no UTF-8 step
const b64 = (s: string): string => btoa(s);
const unb64 = (s: string): string => atob(s);

export function encode(records: PlaytestRecord[]): string {
  return PREFIX + b64(JSON.stringify(records));
}

function bad(error: string, message: string, actual: unknown, limit: unknown): Error {
  return new Error(JSON.stringify({ error, message, actual, limit }));
}

export function decode(text: string): PlaytestRecord[] {
  const t = text.trim();
  if (t.length > PlaytestLimits.maxText) throw bad('too_long', 'playtest text is too long', t.length, PlaytestLimits.maxText);
  if (!t.startsWith(PREFIX)) throw bad('bad_prefix', 'not a NEON WAVETOP playtest export', t.slice(0, 8), PREFIX);
  let data: unknown;
  try {
    data = JSON.parse(unb64(t.slice(PREFIX.length)));
  } catch (e) {
    throw bad('bad_payload', `the export does not decode: ${(e as Error).message}`, t.length, 'base64 of a JSON array');
  }
  if (!Array.isArray(data)) throw bad('bad_payload', 'the export is not a list of runs', typeof data, 'array');
  return data.map((r, i) => check(r, i));
}

function check(r: unknown, i: number): PlaytestRecord {
  const x = r as PlaytestRecord;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!x || x.v !== PLAYTEST_VERSION) throw bad('bad_version', `run ${i}: unknown record version`, (x as { v?: unknown })?.v, PLAYTEST_VERSION);
  if (!Number.isInteger(x.level) || (!num(x.pay) && x.pay !== null)) throw bad('bad_record', `run ${i}: level / pay missing`, [x.level, x.pay], 'integers / seconds');
  if (!Array.isArray(x.inputs) || x.inputs.length % 2 !== 0 || !x.inputs.every((n) => Number.isInteger(n) && n >= 0)) throw bad('bad_inputs', `run ${i}: inputs are not run-length pairs`, x.inputs?.length, 'even list of non-negative integers');
  let ticks = 0;
  for (let k = 1; k < x.inputs.length; k += 2) ticks += x.inputs[k];
  if (ticks > PlaytestLimits.maxTicks) throw bad('too_many_ticks', `run ${i}: longer than any run can be`, ticks, PlaytestLimits.maxTicks);
  if (!x.result || !Array.isArray(x.gates) || typeof x.digest !== 'string') throw bad('bad_record', `run ${i}: result / gates / digest missing`, Object.keys(x), 'result, gates, digest');
  return x;
}

export interface Replayed {
  /** exact: this engine reproduced the recorded run bit for bit. diverged: it did not (another build, or a
   *  tampered record) — the recorded numbers are then unverified, never silently trusted. */
  verdict: 'exact' | 'diverged';
  run: Run;
}

/** Re-simulate a record. `worldOf` / `levelOf` are the build's own (a record never supplies its level data). */
export function replay(rec: PlaytestRecord, levelOf: (id: number) => LevelDef | undefined, worldOf: (level: LevelDef) => StackWorld): Replayed {
  const level = levelOf(rec.level);
  if (!level) throw bad('unknown_level', 'the record names a level this build does not have', rec.level, 'a level id of this build');
  const run = new Run(worldOf(level), level, rec.pay ?? Infinity);
  for (let k = 0; k < rec.inputs.length && run.state === 'fly'; k += 2) {
    const ctl = unpackControls(rec.inputs[k]);
    for (let n = rec.inputs[k + 1]; n > 0 && run.state === 'fly'; n--) {
      run.step(ctl);
      run.events.length = 0;
    }
  }
  return { verdict: run.digest() === rec.digest && run.tick === rec.result.ticks ? 'exact' : 'diverged', run };
}
