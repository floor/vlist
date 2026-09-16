import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
const script = resolve(import.meta.dir, '../../scripts/heap.ts');

// Generous timeouts: both runs finish in well under a second locally, but the
// bun default of 5s is thin on a loaded CI runner, and a gate that flakes is
// not a gate.

test('heap gate reports no retention after destroy', async () => {
  const proc = Bun.spawn(['bun', script], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(out).toContain('no retention after destroy');
  expect(out).toContain('rate ratio');
}, 30000);

test('heap gate still detects a deliberately retained instance', async () => {
  // The criterion is only worth anything if it can still fail. The self-test
  // retains every destroyed list on purpose; if the gate stops noticing that,
  // it would pass forever on a real leak.
  const proc = Bun.spawn(['bun', script, '--self-test'], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(out).toContain('gate detects a deliberately retained instance');
  expect(out).not.toContain('the gate is broken');
}, 30000);
