import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
const script = resolve(import.meta.dir, '../../scripts/heap.ts');

// Generous timeouts: both runs finish in well under a second locally, but the
// bun default of 5s is thin on a loaded CI runner, and a gate that flakes is
// not a gate.

/**
 * Run the gate and return its output. A bare exit code is useless here: the
 * thresholds are sensitive to the host's GC, so a failure has to say which
 * criterion tripped and by how much, or the next person only learns that
 * something went wrong on a machine they cannot see.
 */
const runGate = async (args: string[] = []): Promise<string> => {
  const proc = Bun.spawn(['bun', script, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`heap gate exited ${code}\n${out}${err}`);
  return out;
};

test('heap gate reports no retention after destroy', async () => {
  const out = await runGate();
  expect(out).toContain('no retention after destroy');
  expect(out).toContain('rate ratio');
}, 30000);

test('heap gate still detects a deliberately retained instance', async () => {
  // The criterion is only worth anything if it can still fail. The self-test
  // retains every destroyed list on purpose; if the gate stops noticing that,
  // it would pass forever on a real leak.
  const out = await runGate(['--self-test']);
  expect(out).toContain('gate detects a deliberately retained instance');
  expect(out).not.toContain('the gate is broken');
}, 30000);
