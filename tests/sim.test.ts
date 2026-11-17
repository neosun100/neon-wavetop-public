// The simulation, the pilots and the playtest records. Mutations W1–W22 in mutations.txt.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Autopilot, ExpertCommander, NoCommander, NO_ORDERS } from '../src/ai/pilot';
import { ReferenceCommander } from '../src/ai/reference';
import { ENDLESS, FREE, LEVELS, SECTORS, CHAPTERS, dailyLevel, DAILY_ID } from '../src/core/levels';
import { decode, encode, InputLog, record, replay, type PlaytestRecord } from '../src/core/playtest';
import { CLOUD, controls, fly, NO_INPUT, packControls, Rules, Run, TICK, unpackControls, type Controls, type Pilot } from '../src/core/sim';
import { archAt, LEAGUE_COURSES, MAIL_TIER, rankOf, RANKS, REGION_STARS, regionOpen, TRIALS_PER_BIOME, wrapDelta } from '../src/core/trials';
import { adoptOpen, levelById, OPEN_OPTS, openReady, trialsOf, worldOf } from '../src/core/worlds';
import { groundAt } from '../src/engine/stack3d/world';

const L = (id: number) => LEVELS[id - 1];
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('campaign data', () => {
  it('4 chapters × 5 sectors, unique seeds and names, targets saw-tooth down inside a chapter', () => {
    expect(LEVELS.length).toBe(CHAPTERS.length * SECTORS);
    expect(new Set(LEVELS.map((l) => l.seed)).size).toBe(LEVELS.length);
    expect(new Set(LEVELS.map((l) => l.name[0])).size).toBe(LEVELS.length);
    for (const l of LEVELS) {
      expect(l.bands[0] + l.bands[1] + l.bands[2]).toBeCloseTo(1, 9);
      if ((l.id - 1) % SECTORS) expect(l.target).toBeLessThan(L(l.id - 1).target);
      // English strings carry no CJK, Chinese strings do
      expect(/[㐀-鿿]/.test(l.name[0] + l.teach[0])).toBe(false);
      expect(/[㐀-鿿]/.test(l.name[1])).toBe(true);
    }
  });

  it('a new mechanic first appears outside a gauntlet: flak in 6, knife gates in 7', () => {
    expect(LEVELS.findIndex((l) => l.flak > 0) + 1).toBe(6);
    expect(LEVELS.findIndex((l) => l.knife > 0) + 1).toBe(7);
  });
});

describe('the run', () => {
  it('is a pure function of level, pay and controls', () => {
    const a = fly(worldOf(L(8)), L(8), Infinity, new ReferenceCommander(3));
    const b = fly(worldOf(L(8)), L(8), Infinity, new ReferenceCommander(3));
    expect(b.digest()).toBe(a.digest());
    expect(fly(worldOf(L(8)), L(8), Infinity, new ReferenceCommander(4)).digest()).not.toBe(a.digest());
  });

  it('controls survive packing, and quantizing is idempotent', () => {
    for (const c of [NO_INPUT, controls(-1, 1, undefined, true, false), controls(0.337, 0, 222.6, false, true), controls(1, -1, 0, true, true)]) {
      expect(unpackControls(packControls(c))).toEqual(c);
      expect(controls(c.turn / 100, c.climb, c.alt < 0 ? undefined : c.alt, c.thrust, c.roll)).toEqual(c);
    }
  });

  it('`need` is exact: a hair more pay wins the same flight, a hair less loses it', () => {
    let checked = 0;
    for (const id of [5, 10, 15]) {
      for (const seed of [1, 2, 3, 4]) {
        const free = fly(worldOf(L(id)), L(id), Infinity, new ReferenceCommander(seed));
        expect(free.state, `level ${id} pilot ${seed}`).toBe('won');
        expect(fly(worldOf(L(id)), L(id), free.need + 0.02, new ReferenceCommander(seed)).state).toBe('won');
        expect(fly(worldOf(L(id)), L(id), free.need - 0.02, new ReferenceCommander(seed)).state).toBe('lost');
        checked++;
      }
    }
    expect(checked).toBe(12);
  });

  it('every ring of every level clears the ground, stays out of the cloud layer, and is reachable from the last', () => {
    for (const level of LEVELS) {
      const w = worldOf(level);
      const run = fly(w, level, Infinity, new ExpertCommander());
      expect(run.gates.length, level.name[0]).toBe(level.gates);
      run.gates.forEach((g, i) => {
        expect(g.z - g.r, `${level.name[0]} ring ${i}`).toBeGreaterThanOrEqual(groundAt(w, g.x, g.y) + 4);
        expect(g.z + g.r <= CLOUD[0] - 2 || g.z - g.r >= CLOUD[1] + 2, `${level.name[0]} ring ${i} at ${g.z} ± ${g.r}`).toBe(true);
        if (i) {
          const p = run.gates[i - 1];
          expect(Math.abs(g.z - p.z)).toBeLessThanOrEqual(0.55 * Math.sqrt((g.x - p.x) ** 2 + (g.y - p.y) ** 2));
        }
      });
    }
  });

  it('a miss costs the ring its pay and the combo, and the run moves on', () => {
    const level = L(1);
    const run = new Run(worldOf(level), level, 6);
    const clock0 = run.clock;
    expect(clock0).toBe(Rules.clockBase + Rules.clockGates * 6);
    // the first ring is dead ahead at the craft's height: flying straight passes it
    while (run.gateIdx === 0) run.step(NO_INPUT);
    expect(run.passed).toBe(1);
    expect(run.combo).toBe(1);
    expect(run.clock).toBeCloseTo(clock0 + 6 - run.time, 6);
    // then keep flying straight and high: the next plane is crossed far outside its ring
    const before = run.clock;
    const t0 = run.time;
    while (run.gateIdx === 1 && run.state === 'fly') run.step({ ...NO_INPUT, alt: 225 });
    if (run.state === 'fly') {
      expect(run.missed).toBe(1);
      expect(run.combo).toBe(0);
      expect(run.clock).toBeCloseTo(before - (run.time - t0), 6);
    } else expect(run.state).toBe('lost'); // the plane was never reached: the clock ended it, also legal
  });

  it('a rolling craft dodges a shell; a level one pays once, then has mercy', () => {
    const level = L(1);
    const shell = (r: Run): void => { r.shells.push({ x: r.craft.x, y: r.craft.y, z: r.craft.z, vx: 0, vy: 0, vz: 0, age: 0 }); };
    const a = new Run(worldOf(level), level, 6);
    const c0 = a.clock;
    shell(a);
    a.step(NO_INPUT);
    expect(a.hits).toBe(1);
    expect(a.clock).toBeCloseTo(c0 - Rules.hitPenalty - TICK, 6);
    shell(a);
    a.step(NO_INPUT);
    expect(a.hits).toBe(1);
    const b = new Run(worldOf(level), level, 6);
    b.step({ ...NO_INPUT, roll: true });
    shell(b);
    b.step(NO_INPUT);
    expect(b.dodges).toBe(1);
    expect(b.hits).toBe(0);
  });

  it('thrust burns energy and runs dry; the wavetops refill it', () => {
    const level = L(2);
    const run = new Run(worldOf(level), level, Infinity);
    for (let i = 0; i < 60 * 6; i++) run.step({ ...NO_INPUT, alt: 150, thrust: true });
    expect(run.dry).toBe(true);
    expect(run.craft.boost).toBeLessThan(0.2);
    const low = run.energy;
    let skimmed = 0;
    for (let i = 0; i < 60 * 5; i++) { run.step({ ...NO_INPUT, alt: 0 }); if (run.skimming) skimmed++; }
    expect(skimmed).toBeGreaterThan(60);
    expect(run.energy).toBeGreaterThan(low + 0.3);
  });

  it('the ring kick: opening the thrusters within the window after a ring gives energy and a surge, once; later it gives nothing', () => {
    const level = L(1);
    const kick = (delay: number): Run => {
      const run = new Run(worldOf(level), level, Infinity);
      while (run.gateIdx === 0) run.step(NO_INPUT);
      for (let i = 0; i < delay; i++) run.step(NO_INPUT);
      run.energy = 0.4;
      run.step({ ...NO_INPUT, thrust: true });
      return run;
    };
    const hit = kick(5);
    expect(hit.kicks).toBe(1);
    expect(hit.energy).toBeGreaterThan(0.4 + Rules.kickEnergy - 0.02);
    expect(hit.craft.boost).toBeGreaterThan(0.9);
    hit.step(NO_INPUT);
    hit.step({ ...NO_INPUT, thrust: true });
    expect(hit.kicks).toBe(1); // one kick a ring
    const late = kick(Rules.kickWindow + 5);
    expect(late.kicks).toBe(0);
    expect(late.energy).toBeLessThan(0.45);
    // holding the thrusters through the ring is not a kick: it takes the commander's re-press
    const held = new Run(worldOf(level), level, Infinity);
    while (held.gateIdx === 0) held.step({ ...NO_INPUT, thrust: true });
    for (let i = 0; i < 20; i++) held.step({ ...NO_INPUT, thrust: true });
    expect(held.kicks).toBe(0);
  });

  it('a knife gate pays the stunt only to a rolling craft', () => {
    const level = L(7);
    const ai = fly(worldOf(level), level, Infinity, new ExpertCommander());
    expect(ai.gates.filter((g) => g.knife).length).toBeGreaterThan(1);
    expect(ai.stunts).toBeGreaterThan(0);
    const cmd = new ExpertCommander();
    const flat: Pilot = { act: (v) => ({ ...cmd.act(v), roll: false }) };
    const noRoll = fly(worldOf(level), level, Infinity, flat);
    expect(noRoll.stunts).toBe(0);
    expect(noRoll.passed).toBeGreaterThan(0);
  });

  it('the daily run is one course per day: same day ⇒ same rings, another day ⇒ another course; endless rules', () => {
    const rings = (day: number): string => { const r = new Run(worldOf(dailyLevel(day)), dailyLevel(day), 1); for (let i = 0; i < 300; i++) r.step(NO_INPUT); return r.gates.map((g) => `${g.x.toFixed(2)},${g.z.toFixed(2)}`).join(';'); };
    expect(rings(20261117)).toBe(rings(20261117));
    expect(rings(20261118)).not.toBe(rings(20261117));
    const d = dailyLevel(20261117);
    expect(d.id).toBe(DAILY_ID);
    expect(new Run(worldOf(d), d, 1).endless).toBe(true);
    expect(/[\u3400-\u9fff]/.test(d.name[0] + d.teach[0])).toBe(false);
  });

  it('the league: 20 courses on the open map (3 trials + a mail run per biome), apart from each other, each flyable from its own arch', () => {
    const w = worldOf(FREE);
    const ts = trialsOf();
    expect(ts.length).toBe(LEAGUE_COURSES);
    expect(new Set(ts.map((t) => t.id)).size).toBe(20);
    const mail = ts.filter((t) => t.tier === MAIL_TIER);
    expect(mail.length).toBe(5);
    for (const t of ts) {
      expect(w.biome[(t.start.y << w.shift) | t.start.x], t.name[0]).toBe(t.biome);
      expect(levelById(t.id)).toBe(t);
      expect(worldOf(t)).toBe(w);
      for (const u of ts) if (u !== t) expect(Math.hypot(u.start.x - t.start.x, u.start.y - t.start.y)).toBeGreaterThan(200);
      const run = fly(w, t, Infinity, new ExpertCommander());
      expect(run.state, t.name[0]).toBe('won');
      expect(run.gates.length).toBe(t.gates);
      // the course starts at the arch, not at the map's spawn point
      expect(Math.hypot(run.gates[0].x - t.start.x, run.gates[0].y - t.start.y)).toBeLessThan(t.tier === MAIL_TIER ? 700 : 260);
      // a mail run's rings are far apart
      if (t.tier === MAIL_TIER) expect(Math.hypot(run.gates[2].x - run.gates[1].x, run.gates[2].y - run.gates[1].y)).toBeGreaterThan(600);
    }
    expect(levelById(3)).toBe(L(3));
    expect(levelById(999)).toBeUndefined();
  });

  it('an arch starts its trial only for a craft flying through it — across the map seam too', () => {
    const ts = trialsOf();
    const n = worldOf(FREE).n;
    const a = ts[4].start;
    expect(archAt(ts, n, a.x, a.y, a.z)).toBe(ts[4]);
    expect(archAt(ts, n, a.x + n * 3 + 20, a.y - n, a.z + 20)).toBe(ts[4]); // the craft's own coordinates never wrap
    expect(archAt(ts, n, a.x + 45, a.y, a.z)).toBeNull();
    expect(archAt(ts, n, a.x, a.y, a.z + 60)).toBeNull(); // over the top of it is not through it
    expect(wrapDelta(10, n - 10, n)).toBe(-20);
    expect(wrapDelta(n - 10, 10, n)).toBe(20);
    expect(wrapDelta(5, 5 + n * 7, n)).toBe(0);
    // a locked region's arch does not start anything
    expect(archAt(ts, n, a.x, a.y, a.z, () => false)).toBeNull();
  });

  it('regions open in order by league stars, and ranks rise with them', () => {
    expect([0, 1, 2, 3, 4].map((b) => regionOpen(b, 0))).toEqual([true, false, false, false, false]);
    expect([0, 1, 2, 3, 4].map((b) => regionOpen(b, 10))).toEqual([true, true, true, false, false]);
    expect(regionOpen(4, 28)).toBe(true);
    // every threshold can be reached from the regions already open (4 courses × 3 stars each)
    REGION_STARS.forEach((need, b) => expect(need, `region ${b}`).toBeLessThanOrEqual(b * TRIALS_PER_BIOME * 3));
    expect(rankOf(0)[1]).toBe('Cadet');
    expect(rankOf(29)[1]).toBe('Flight Lead');
    expect(rankOf(60)[1]).toBe('Legend');
    for (const r of RANKS) { expect(/[\u3400-\u9fff]/.test(r[1])).toBe(false); expect(/[\u3400-\u9fff]/.test(r[2])).toBe(true); }
  });

  it('an open map built elsewhere is adopted only when none is here yet, and only at the right size', () => {
    const w = worldOf(FREE);
    expect(openReady()).toBe(true);
    expect(adoptOpen(w)).toBe(false); // already have one
    expect(adoptOpen(worldOf(L(1)))).toBe(false); // a chapter world is not the open map
    expect(OPEN_OPTS.biomes).toBe(true);
  });

  it('free flight has no rings: nothing to pass, nothing to miss, no end', () => {
    const run = new Run(worldOf(FREE), FREE, Infinity);
    expect(run.free).toBe(true);
    for (let i = 0; i < 60 * 20; i++) run.step({ ...NO_INPUT, turn: 30 });
    expect(run.gates.length).toBe(0);
    expect(run.passed + run.missed).toBe(0);
    expect(run.state).toBe('fly');
    const from = new Run(worldOf(FREE), { ...FREE, start: { x: 300, y: 400, z: 80, yaw: 1 } }, Infinity);
    expect([from.craft.x, from.craft.y, from.craft.z, from.craft.yaw]).toEqual([300, 400, 80, 1]);
  });

  it('open skies: the five-biome map, and a clockless run on it never ends', () => {
    const w = worldOf(FREE);
    expect(w.n).toBe(2048);
    expect(new Set(Array.from(w.biome)).size).toBe(5);
    expect(worldOf(FREE)).toBe(w); // built once
    expect(worldOf(L(1)).biome.every((b) => b === 0)).toBe(true); // campaign worlds are untouched (their tuning stands)
    const run = new Run(w, FREE, Infinity);
    for (let i = 0; i < 60 * 30; i++) run.step(NO_INPUT);
    expect(run.state).toBe('fly');
  });

  it('endless never finishes by itself and pays less per stage', () => {
    const run = new Run(worldOf(ENDLESS), ENDLESS, 1);
    expect(run.payAt(0)).toBeGreaterThan(run.payAt(40));
    const ai = new ExpertCommander();
    for (let i = 0; i < 60 * 200 && run.state === 'fly'; i++) { run.step(ai.act(run.view())); run.events.length = 0; }
    expect(run.state === 'fly' || run.state === 'lost').toBe(true);
    expect(run.passed).toBeGreaterThan(16);
  });
});

describe('the pilots', () => {
  const sample = [1, 5, 8, 10, 14, 20].map(L);
  const needs = (level: (typeof LEVELS)[number], mk: (seed: number) => Pilot, seeds = [1, 2, 3, 4, 5, 6, 7, 8]): number[] =>
    seeds.map((s) => { const r = fly(worldOf(level), level, Infinity, mk(s)); return r.state === 'won' ? r.need : Infinity; });

  it('the expert commander clears every level without a miss and is quicker than the median reference commander', () => {
    for (const level of LEVELS) {
      const ai = fly(worldOf(level), level, Infinity, new ExpertCommander());
      expect(ai.state, level.name[0]).toBe('won');
      expect(ai.missed, level.name[0]).toBe(0);
    }
    for (const level of sample) {
      const ai = fly(worldOf(level), level, Infinity, new ExpertCommander());
      expect(ai.need, level.name[0]).toBeLessThan(med(needs(level, (s) => new ReferenceCommander(s))));
    }
  });

  it('reference commanders differ from each other (a population, not one script) and all finish', () => {
    for (const level of sample) {
      const n = needs(level, (s) => new ReferenceCommander(s));
      expect(n.every(Number.isFinite), level.name[0]).toBe(true);
      expect(new Set(n.map((x) => x.toFixed(3))).size, level.name[0]).toBeGreaterThanOrEqual(6);
    }
  });

  it('orders matter: with no commander the autopilot is clean but slow; a commander who never boosts, or never calls the roll, pays for it', () => {
    for (const level of [L(5), L(10), L(20)]) {
      const w = worldOf(level);
      const bare = fly(w, level, Infinity, new NoCommander());
      expect(bare.state, level.name[0]).toBe('won');
      expect(bare.missed, level.name[0]).toBe(0);
      expect(bare.stunts + bare.dodges + bare.kicks).toBe(0); // it times nothing by itself
      const ref = med(needs(level, (s) => new ReferenceCommander(s)));
      expect(bare.need, level.name[0]).toBeGreaterThan(1.15 * ref);
      expect(med(needs(level, (s) => new ReferenceCommander(s, { neverBoost: true }))), level.name[0]).toBeGreaterThan(1.1 * ref);
    }
    // flak level: never calling the roll means more hits, and hits cost seconds
    const gun = L(10);
    // (24 commanders; with 8 the ratio was exactly ×1.5 — 6 hits against 4 — too few to say anything)
    const hits = (mk: (s: number) => Pilot): number => Array.from({ length: 24 }, (_, i) => i + 1).reduce((n, s) => n + fly(worldOf(gun), gun, Infinity, mk(s)).hits, 0);
    const never = hits((s) => new ReferenceCommander(s, { neverRoll: true }));
    const some = hits((s) => new ReferenceCommander(s));
    expect(never, `never ${never} vs reference ${some}`).toBeGreaterThanOrEqual(1.3 * some);
    expect(hits(() => new ExpertCommander())).toBe(0);
  });

  it('a nudge bends the line: it is added to the AI\'s own turn, and the AI keeps flying', () => {
    const level = L(1);
    const run = new Run(worldOf(level), level, Infinity);
    const v = run.view();
    const ai = new Autopilot();
    const base = ai.act(v, NO_ORDERS).turn;
    expect(ai.act(v, { ...NO_ORDERS, nudge: 1 }).turn).toBeGreaterThan(base + 50);
    expect(ai.act(v, { ...NO_ORDERS, nudge: -1 }).turn).toBeLessThan(base - 50);
    expect(ai.act(v, { ...NO_ORDERS, nudge: 9 }).turn).toBe(ai.act(v, { ...NO_ORDERS, nudge: 1 }).turn); // clamped
    // a commander who leans a little the whole way still gets round: the AI corrects against it
    const lean: Pilot = { act: (pv) => { ai.scan(pv); return ai.act(pv, { ...NO_ORDERS, nudge: 0.25 }); } };
    const flown = fly(worldOf(level), level, Infinity, lean);
    expect(flown.state).toBe('won');
    expect(flown.passed).toBeGreaterThanOrEqual(level.gates - 1);
  });

  it('the autopilot obeys an order only when it is safe to: no boost on an empty tank, no dive without room to climb back', () => {
    const level = L(2);
    const run = new Run(worldOf(level), level, Infinity);
    const ai = new Autopilot();
    let thrustDry = 0;
    for (let i = 0; i < 60 * 12 && run.state === 'fly'; i++) {
      const v = run.view();
      ai.scan(v);
      const c = ai.act(v, { ...NO_ORDERS, boost: true, skim: true });
      if (v.dry && c.thrust) thrustDry++;
      // close to the ring it must be on the ring's height, whatever was ordered
      const d = Math.hypot(v.gate.x - v.x, v.gate.y - v.y);
      if (d < 80) expect(c.alt).toBe(Math.round(v.gate.z));
      run.step(c);
      run.events.length = 0;
    }
    expect(thrustDry).toBe(0);
    expect(run.missed).toBe(0);
  });

  it('pilots see only PilotView: no pilot source touches the Run, its rng or rings beyond the next one', () => {
    for (const f of readdirSync(join(__dirname, '../src/ai')).filter((x) => x !== 'headless.ts')) {
      const code = readFileSync(join(__dirname, '../src/ai', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(code.match(/\bRun\b|\.gates\b|\.rng\b|\.world\b|\bfly\(/g) ?? [], f).toEqual([]);
    }
  });

  it('the view shows the ring and the one after it, and nothing further', () => {
    const run = new Run(worldOf(L(5)), L(5), Infinity);
    const v = run.view();
    expect(v.gate).toBe(run.gates[0]);
    expect(v.next).toBe(run.gates[1]);
    expect(Object.keys(v)).not.toContain('gates');
  });
});

describe('playtest records', () => {
  const level = L(6);
  function played(pilot: Pilot, pay: number): { run: Run; log: InputLog } {
    const run = new Run(worldOf(level), level, pay);
    const log = new InputLog();
    while (run.state === 'fly') {
      const c: Controls = pilot.act(run.view());
      log.push(packControls(c));
      run.step(c);
      run.events.length = 0;
    }
    return { run, log };
  }
  const { run, log } = played(new ReferenceCommander(2), 7);
  const rec = record(run, log, { build: 'test', device: 'mouse', attempt: 1 });

  it('round-trips as text and replays exactly, win or lose', () => {
    const back = decode(encode([rec]));
    expect(back).toEqual([rec]);
    const r = replay(back[0], (id) => LEVELS[id - 1], worldOf);
    expect(r.verdict).toBe('exact');
    expect(r.run.need).toBe(run.need);
    const lost = played(new ReferenceCommander(2), 1.3);
    expect(lost.run.state).toBe('lost');
    expect(replay(record(lost.run, lost.log, { build: 'test', device: 'touch', attempt: 2 }), (id) => LEVELS[id - 1], worldOf).verdict).toBe('exact');
  });

  it('a tampered record is reported as diverged, never trusted', () => {
    const forged = { ...rec, inputs: rec.inputs.slice() };
    forged.inputs[0] = packControls(controls(1, 0, undefined, false, false));
    forged.inputs[1] = 240;
    expect(replay(forged, (id) => LEVELS[id - 1], worldOf).verdict).toBe('diverged');
    expect(replay({ ...rec, result: { ...rec.result, ticks: rec.result.ticks - 1 } }, (id) => LEVELS[id - 1], worldOf).verdict).toBe('diverged');
  });

  it('refuses what is not an export, with a four-part error', () => {
    expect(() => decode('hello')).toThrow(/bad_prefix/);
    expect(() => decode('WT1.!!!')).toThrow(/bad_payload/);
    expect(() => decode(encode([{ ...rec, v: 9 }]))).toThrow(/bad_version/);
    expect(() => decode(encode([{ ...rec, inputs: [1, 2, 3] }]))).toThrow(/bad_inputs/);
    expect(() => decode(encode([{ ...rec, inputs: [0, 9e7] }]))).toThrow(/too_many_ticks/);
    expect(() => replay({ ...rec, level: 99 }, (id) => LEVELS[id - 1], worldOf)).toThrow(/unknown_level/);
    expect(() => record(new Run(worldOf(level), level, 5), new InputLog(), { build: 't', device: 'keys', attempt: 1 })).toThrow(/run_not_over/);
  });

  it('carries no personal data: only the listed keys', () => {
    expect(Object.keys(rec).sort()).toEqual(['attempt', 'build', 'device', 'digest', 'gates', 'inputs', 'level', 'pay', 'result', 'v']);
  });
});

describe('the playtest report (scripts/playtest.ts)', () => {
  it('measures people with the tuning ruler, leaves diverged records out, and flags a level people clear far off target', async () => {
    const { report } = await import('../scripts/playtest');
    const level = L(3);
    const recs: PlaytestRecord[] = [];
    // ten "people" who are in fact reference pilots, playing at a starved pay: they mostly lose
    for (let seed = 1; seed <= 10; seed++) {
      const run = new Run(worldOf(level), level, 0.7);
      const log = new InputLog();
      const pilot = new ReferenceCommander(seed);
      while (run.state === 'fly') { const c = pilot.act(run.view()); log.push(packControls(c)); run.step(c); run.events.length = 0; }
      recs.push({ ...record(run, log, { build: 't', device: 'mouse', attempt: 1 }), rating: { hard: 1, fun: 2 } });
    }
    const forged = { ...recs[0], digest: 'x' };
    const { rows, diverged, exact } = report([...recs, forged]);
    expect(diverged).toBe(1);
    expect(exact).toBe(10);
    expect(rows.length).toBe(1);
    expect(rows[0].runs).toBe(10);
    expect(rows[0].humanClear).toBeLessThan(0.4);
    expect(rows[0].tooHard).toBe(10);
    expect(rows[0].flag).toMatch(/too strong/);
  });
});
