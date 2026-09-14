import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const script = resolve(import.meta.dir, '../../scripts/bench.ts');

test('benchmark rejects invalid explicit ports before doing work', async () => {
  const proc = Bun.spawn(['bun', script, '--dry-run'], { env: { ...process.env, VLIST_BENCH_PORT: '0' }, stdout: 'pipe', stderr: 'pipe' });
  expect(await proc.exited).not.toBe(0);
  expect(await new Response(proc.stderr).text()).toContain('VLIST_BENCH_PORT must be an integer');
});

test('benchmark never reuses a server on an explicitly selected port', async () => {
  const site = mkdtempSync(resolve(tmpdir(), 'vlist-bench-port-'));
  mkdirSync(resolve(site, 'node_modules'));
  mkdirSync(resolve(site, 'benchmarks/ci'), { recursive: true });
  writeFileSync(resolve(site, 'benchmarks/ci/runner.mjs'), '');
  const server = Bun.serve({ port: 0, fetch: () => new Response('unrelated server') });
  try {
    const proc = Bun.spawn(['bun', script, '--quick'], { env: { ...process.env, VLIST_IO_DIR: site, VLIST_BENCH_PORT: String(server.port) }, stdout: 'pipe', stderr: 'pipe' });
    expect(await proc.exited).not.toBe(0);
    expect(await new Response(proc.stderr).text()).toContain('already in use');
    expect(await new Response(proc.stdout).text()).not.toContain('Running benchmarks');
  } finally { server.stop(true); rmSync(site, { recursive: true, force: true }); }
});
