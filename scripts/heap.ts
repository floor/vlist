/**
 * vlist — Heap growth gate
 *
 * Q2 of the 3.0 review: the release gate has no heap assertion. The memory
 * suites assert DOM, listener, observer and timer teardown — all structural. A
 * list that is fully detached but still referenced by one surviving closure
 * passes every one of them, because nothing ever asks whether the heap comes
 * back.
 *
 * What this measures: create and destroy a list repeatedly, force a full GC at
 * intervals, and watch the *rate* of heap growth rather than its total. A
 * bounded one-time cost — module state, JIT tiering, warm caches — shows a
 * decaying rate. A leak holds a flat one. That distinction, not an absolute
 * number, is what separates the two; a total alone cannot, because a clean run
 * also grows for the first hundred cycles and then stops.
 *
 * Three details are not optional. Each came from a measurement, and the first
 * two would each have produced a confident wrong answer:
 *
 *   - Frames must be drained before sampling. Under a setTimeout-based rAF
 *     shim, pending frames held every destroyed instance alive and accounted
 *     for 84% of apparent growth — an artifact that reads as a ~50 KB/cycle
 *     leak. This script uses happy-dom's native rAF and still drains.
 *   - The run must warm up before the baseline is taken, or one-time growth is
 *     counted as a leak.
 *   - The criterion needs proving, not asserting. `--self-test` retains every
 *     instance on purpose and requires the gate to fail; a heap gate that
 *     silently stopped detecting anything would otherwise pass forever.
 *
 * The ratio is only applied above a floor of total growth. Both criteria are
 * needed because each is blind where the other works: the ratio catches a leak
 * buried under warm-up, and the absolute numbers catch the case where there is
 * too little growth for a ratio to mean anything.
 *
 * Usage:
 *   bun run scripts/heap.ts              # the gate
 *   bun run scripts/heap.ts --self-test  # prove it still detects a real leak
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { gcAndSweep, heapStats } = await import("bun:jsc");
const { createVList } = await import("../src/index");

// ── Tuning ────────────────────────────────────────────────────────
//
// Set from this script's own output on a clean tree, with margin. The ratio is
// the discriminator; the cap is a coarse second signal so a leak large enough
// to swamp the warm-up still fails even if the rate curve misleads.

const WARMUP_CYCLES = 20;
const CYCLES = 200;
const WINDOWS = 4;

/** Last-window rate / first-window rate. Below this is a decaying curve. */
const RATE_RATIO_MAX = 0.65;

/** Absolute growth ceiling across the measured cycles, per profile. */
const TOTAL_GROWTH_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Below this much total growth, a profile passes on the absolute number alone.
 *
 * A ratio needs a curve to describe, and where almost nothing accumulates there
 * is no curve — only jitter. Linux CI retained 89,598 bytes over 200 cycles on
 * the 1000-item profile, twelve times less than the profile that passed, and
 * still reported 1.11x: its first window was 405 bytes/cycle, so one ordinary
 * allocation in the last window swamped the signal. A gate that fails hardest
 * when the code is cleanest is measuring itself, not the library.
 *
 * This is not free. It admits a leak below ~1.3 KB/cycle, where retaining a
 * whole list costs ~47 KB/cycle — a 35x margin, under which this measurement
 * cannot resolve anything in the first place.
 */
const RATIO_FLOOR_BYTES = 256 * 1024;

interface Profile {
  readonly name: string;
  readonly items: number;
}

const PROFILES: readonly Profile[] = [
  { name: "10 items", items: 10 },
  { name: "1000 items", items: 1000 },
];

// ── Harness ───────────────────────────────────────────────────────
//
// Self-contained rather than imported from test/helpers: a release gate should
// not depend on test scaffolding, and happy-dom reports 0 for clientWidth and
// clientHeight unless they are defined outright.

const createContainer = (width = 300, height = 500): HTMLElement => {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
  document.body.appendChild(el);
  return el;
};

interface Row {
  readonly id: number;
  readonly name: string;
}

const makeItems = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `Item ${i}` }));

const template = (item: Row): string => `<div class="item">${item.name}</div>`;

/** Let pending frames and microtasks run, so nothing is held by a queued callback. */
const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const cycle = async (items: number, sink: unknown[] | null): Promise<void> => {
  const container = createContainer();
  const list = createVList({
    container,
    items: makeItems(items),
    item: { height: 50, template },
  });
  list.destroy();
  container.remove();
  if (sink) sink.push(list);
  await drain();
};

// ── Measurement ───────────────────────────────────────────────────

interface Measurement {
  readonly profile: string;
  readonly marks: ReadonlyArray<readonly [number, number]>;
  readonly firstRate: number;
  readonly lastRate: number;
  readonly ratio: number;
  readonly total: number;
}

const measure = async (profile: Profile, sink: unknown[] | null): Promise<Measurement> => {
  for (let i = 0; i < WARMUP_CYCLES; i++) await cycle(profile.items, null);

  gcAndSweep();
  const base = heapStats().heapSize;

  const marks: Array<readonly [number, number]> = [];
  const step = CYCLES / WINDOWS;
  for (let i = 1; i <= CYCLES; i++) {
    await cycle(profile.items, sink);
    if (i % step === 0) {
      gcAndSweep();
      marks.push([i, heapStats().heapSize - base] as const);
    }
  }

  const first = marks[0]!;
  const last = marks[marks.length - 1]!;
  const firstRate = first[1] / first[0];
  const lastRate = last[1] / last[0];
  // A first window at or below zero means nothing accumulated to decay from,
  // which is a pass, not a division to trust.
  const ratio = firstRate > 0 ? lastRate / firstRate : 0;

  return { profile: profile.name, marks, firstRate, lastRate, ratio, total: last[1] };
};

const fmt = (n: number): string => n.toLocaleString("en-US");

const report = (m: Measurement): void => {
  console.log(`  ${m.profile}`);
  for (const [cycles, growth] of m.marks) {
    const rate = Math.round(growth / cycles);
    console.log(
      `    after ${String(cycles).padStart(3)} cycles  ${fmt(growth).padStart(11)} bytes` +
        `  ${fmt(rate).padStart(8)}/cycle`,
    );
  }
  const ratioApplies = m.total > RATIO_FLOOR_BYTES;
  console.log(
    `    rate ratio ${m.ratio.toFixed(2)}x ` +
      (ratioApplies
        ? `(max ${RATE_RATIO_MAX})`
        : `(not applied — growth under the ${fmt(RATIO_FLOOR_BYTES)} byte floor)`) +
      `  ·  total ${fmt(m.total)} bytes (max ${fmt(TOTAL_GROWTH_MAX_BYTES)})`,
  );
};

const failures = (m: Measurement): string[] => {
  const out: string[] = [];
  if (m.total > RATIO_FLOOR_BYTES && m.ratio > RATE_RATIO_MAX) {
    out.push(
      `${m.profile}: heap growth is not decaying — rate ratio ${m.ratio.toFixed(2)}x ` +
        `exceeds ${RATE_RATIO_MAX}. A flat rate across windows is what a retained ` +
        `instance looks like.`,
    );
  }
  if (m.total > TOTAL_GROWTH_MAX_BYTES) {
    out.push(
      `${m.profile}: retained ${fmt(m.total)} bytes over ${CYCLES} cycles, ` +
        `above the ${fmt(TOTAL_GROWTH_MAX_BYTES)} ceiling.`,
    );
  }
  return out;
};

// ── Run ───────────────────────────────────────────────────────────

const selfTest = process.argv.includes("--self-test");

console.log("");
console.log(selfTest ? "  vlist — Heap gate self-test" : "  vlist — Heap growth");
console.log("");

if (selfTest) {
  // Retain every instance. The gate must fail; if it passes, the gate is broken
  // and would keep passing on a real leak.
  const sink: unknown[] = [];
  const m = await measure(PROFILES[0]!, sink);
  report(m);
  console.log("");

  const detected = failures(m).length > 0;
  console.log(
    detected
      ? "  ✓ gate detects a deliberately retained instance"
      : "  ✗ gate did NOT detect a deliberately retained instance — the gate is broken",
  );
  console.log(`    (sink holds ${fmt(sink.length)} instances)`);
  console.log("");
  process.exit(detected ? 0 : 1);
}

const problems: string[] = [];
for (const profile of PROFILES) {
  const m = await measure(profile, null);
  report(m);
  problems.push(...failures(m));
  console.log("");
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("");
  process.exit(1);
}

console.log("  ✓ heap growth decays across all profiles — no retention after destroy");
console.log("");
