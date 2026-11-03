import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface WorkflowStep { name?: string; uses?: string; if?: string; 'continue-on-error'?: boolean; with?: Record<string, string> }
interface Workflow { jobs: Record<string, { steps: WorkflowStep[] }> }

const workflow = Bun.YAML.parse(readFileSync(resolve(import.meta.dir, '../../.github/workflows/publish.yml'), 'utf8')) as Workflow;
const steps: WorkflowStep[] = Object.values(workflow.jobs)[0]?.steps ?? [];
const indexOf = (name: string): number => steps.findIndex((step) => step.name === name);
const redeploy: WorkflowStep | undefined = steps[indexOf('Redeploy vlist.io')];

// vlist.io production installs vlist from npm and had no trigger on a release, so
// it served 3.1.6 through four releases. The publish job now asks it to redeploy.
test('a stable publish asks vlist.io to redeploy with the released version', () => {
  expect(redeploy?.uses).toStartWith('peter-evans/repository-dispatch@');
  expect(redeploy?.with?.token).toBe('${{ secrets.DISPATCH_TOKEN }}');
  expect(redeploy?.with?.repository).toBe('floor/vlist.io');
  expect(redeploy?.with?.['event-type']).toBe('vlist-released');
  expect(redeploy?.with?.['client-payload']).toContain('${{ github.ref_name }}');
});

test('a prerelease never redeploys the production site', () => {
  expect(redeploy?.if).toBe(steps[indexOf('Remove npm next dist-tag')]?.if);
  expect(redeploy?.if).toBe("${{ !contains(github.ref_name, '-') }}");
});

test('the redeploy is asked for only once the package and the release are out', () => {
  expect(indexOf('Redeploy vlist.io')).toBeGreaterThan(indexOf('Publish'));
  expect(indexOf('Redeploy vlist.io')).toBeGreaterThan(indexOf('Create GitHub Release'));
});

test('a refused redeploy does not turn a published release red', () => {
  expect(redeploy?.['continue-on-error']).toBe(true);
});


test('stable publication removes the npm next dist-tag with a soft-fail warning and no check-dist-tags step', () => {
  const remove = steps[indexOf('Remove npm next dist-tag')] as WorkflowStep & { run?: string };
  expect(remove?.if).toBe("${{ !contains(github.ref_name, '-') }}");
  expect(remove?.['continue-on-error']).toBe(true);
  expect(remove?.run).toContain('npm dist-tag rm vlist next');
  expect(remove?.run).toContain('::warning');
  expect(steps.some((step) => (step as { run?: string }).run?.includes('npm dist-tag add'))).toBe(false);
  expect(steps.some((step) => (step as { run?: string }).run?.includes('check-dist-tags'))).toBe(false);
});

test('CI targets main and 2.x staging, with no retired integration branch', () => {
  const ci = Bun.YAML.parse(readFileSync(resolve(import.meta.dir, '../../.github/workflows/ci.yml'), 'utf8')) as { on: { push: { branches: string[] }; pull_request: { branches: string[] } } };
  expect(ci.on.push.branches).toEqual(['main', 'staging']);
  expect(ci.on.pull_request.branches).toEqual(['main', 'staging']);
});
