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
  expect(redeploy?.if).toBe(steps[indexOf('Move next to this release')]?.if);
  expect(redeploy?.if).toBe("${{ !contains(github.ref_name, '-') }}");
});

test('the redeploy is asked for only once the package and the release are out', () => {
  expect(indexOf('Redeploy vlist.io')).toBeGreaterThan(indexOf('Publish'));
  expect(indexOf('Redeploy vlist.io')).toBeGreaterThan(indexOf('Create GitHub Release'));
});

test('a refused redeploy does not turn a published release red', () => {
  expect(redeploy?.['continue-on-error']).toBe(true);
});
