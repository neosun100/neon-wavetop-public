/** CPU-time clock for the harness (the one file in src/ai allowed to read a clock: it measures the pilots and
 *  never feeds them). Node: process CPU time, so a busy box does not turn a budget red. */
export function cpuMs(): number {
  const g = globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } };
  const u = g.process?.cpuUsage?.();
  return u ? (u.user + u.system) / 1000 : performance.now();
}
