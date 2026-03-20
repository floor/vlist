/**
 * vlist — Feature Size Measurement + Tree-Shaking Verification
 * Builds each feature combination with tree-shaking and reports gzipped sizes.
 * Also verifies that unused features are actually excluded from the bundle.
 *
 * Usage:
 *   bun run size
 *   bun run scripts/measure-size.ts
 */

import { gzipSync } from "bun";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const entry = `${root}/src/index.ts`;

// ── All feature names ─────────────────────────────────────────────

const ALL_FEATURES = [
  "withGrid",
  "withMasonry",
  "withGroups",
  "withAsync",
  "withSelection",
  "withScale",
  "withScrollbar",
  "withPage",
  "withSnapshots",
  "withTable",
] as const;

type FeatureName = (typeof ALL_FEATURES)[number];

// ── Known cross-feature dependencies ──────────────────────────────
//
// Some features legitimately import code from other features at the
// source level.  These show up in the tree-shaken bundle even when
// the dependency feature wasn't explicitly imported by the consumer.
//
// Map: feature → set of features whose markers may appear in its bundle.

const KNOWN_DEPS: Partial<Record<FeatureName, readonly FeatureName[]>> = {
  // withGroups pulls in grid/renderer via require() for grouped grid layouts
  withGroups: ["withGrid"],
  // withAsync references "restoreScroll" method name string from withSnapshots
  withAsync: ["withSnapshots"],
  // withScale imports createScrollbar for compressed-mode auto-scrollbar
  withScale: ["withScrollbar"],
  // withSnapshots references "loadVisibleRange" method name string from withAsync
  withSnapshots: ["withAsync"],
};

// ── Unique string markers per feature ─────────────────────────────
//
// Minified bundles mangle identifiers, so we search for string
// literals that are unique to each feature — CSS class suffixes,
// method names, event names, ARIA attributes — that survive
// minification.
//
// Each entry maps a feature name to an array of marker strings.
// If **any** marker is found in the output, the feature leaked in.
//
// NOTE: "withGrid"/"withMasonry" appear as string literals in
// core.ts via features.has() checks — don't use those as markers.

const FEATURE_MARKERS: Record<FeatureName, readonly string[]> = {
  withGrid:      ["-grid-item"],
  withMasonry:   ["-masonry-item"],
  withGroups:    ["__group_header_", "-sticky-header"],
  withAsync:     ["loadVisibleRange"],
  withSelection: ["selection:change", "selectAll"],
  withScale:     ["touchcancel"],
  withScrollbar: ["-scrollbar-thumb"],
  withPage:      ["innerWidth"],
  withSnapshots: ["getScrollSnapshot", "restoreScroll"],
  withTable:     ["aria-colcount", "gridcell"],
};

// ── Feature scenarios ─────────────────────────────────────────────

interface Scenario {
  name: string;
  imports: string[];
  /** Computed: features that must NOT appear in the tree-shaken output */
  mustNotContain: readonly FeatureName[];
}

/**
 * Derive mustNotContain automatically:
 *   ALL_FEATURES − imported features − their known transitive deps
 */
const excluded = (imported: readonly string[]): readonly FeatureName[] => {
  const allowed = new Set<string>(imported);

  // Expand with known transitive dependencies
  for (const feat of imported) {
    const deps = KNOWN_DEPS[feat as FeatureName];
    if (deps) for (const dep of deps) allowed.add(dep);
  }

  return ALL_FEATURES.filter((f) => !allowed.has(f));
};

const scenarios: Scenario[] = [
  { name: "Base",          imports: ["vlist"] },
  { name: "withGrid",      imports: ["vlist", "withGrid"] },
  { name: "withMasonry",   imports: ["vlist", "withMasonry"] },
  { name: "withGroups",    imports: ["vlist", "withGroups"] },
  { name: "withAsync",     imports: ["vlist", "withAsync"] },
  { name: "withSelection", imports: ["vlist", "withSelection"] },
  { name: "withScale",     imports: ["vlist", "withScale"] },
  { name: "withScrollbar", imports: ["vlist", "withScrollbar"] },
  { name: "withPage",      imports: ["vlist", "withPage"] },
  { name: "withSnapshots", imports: ["vlist", "withSnapshots"] },
  { name: "withTable",     imports: ["vlist", "withTable"] },
].map((s) => ({ ...s, mustNotContain: excluded(s.imports) }));

// ── Build & measure ───────────────────────────────────────────────

interface Result {
  name: string;
  minKB: number;
  gzKB: number;
  deltaKB: number;
}

interface TreeShakeFailure {
  scenario: string;
  leaked: string;
  marker: string;
}

const results: Result[] = [];
const treeShakeFailures: TreeShakeFailure[] = [];

for (const scenario of scenarios) {
  const imports = scenario.imports.join(", ");
  const code = `import { ${imports} } from "${entry}"; globalThis._v = [${imports}];`;
  const tmpFile = `/tmp/_vlist_size_${scenario.name}.ts`;

  await Bun.write(tmpFile, code);

  const build = await Bun.build({
    entrypoints: [tmpFile],
    minify: true,
    target: "browser",
    format: "esm",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  if (!build.success) {
    console.error(`  ✗ ${scenario.name} — build failed`);
    for (const log of build.logs) console.error("   ", log);
    continue;
  }

  const output = await build.outputs[0]!.arrayBuffer();
  const minBytes = output.byteLength;
  const gzBytes = gzipSync(new Uint8Array(output)).byteLength;

  results.push({
    name: scenario.name,
    minKB: minBytes / 1024,
    gzKB: gzBytes / 1024,
    deltaKB: 0,
  });

  // ── Tree-shaking verification ─────────────────────────────────

  if (scenario.mustNotContain.length > 0) {
    const bundleText = new TextDecoder().decode(output);

    for (const featureName of scenario.mustNotContain) {
      const markers = FEATURE_MARKERS[featureName];

      for (const marker of markers) {
        if (bundleText.includes(marker)) {
          treeShakeFailures.push({
            scenario: scenario.name,
            leaked: featureName,
            marker,
          });
          break; // one marker is enough to flag the feature
        }
      }
    }
  }
}

// ── Compute deltas ────────────────────────────────────────────────

const baseGz = results[0]?.gzKB ?? 0;

for (const r of results) {
  r.deltaKB = r.gzKB - baseGz;
}

// ── Output: Size table ────────────────────────────────────────────

const COL_NAME = 22;
const COL_MIN = 10;
const COL_GZ = 9;
const COL_DELTA = 12;
const LINE_W = COL_NAME + COL_MIN + COL_GZ + COL_DELTA + 4;

const pad = (s: string, n: number) => s.padStart(n);
const sep = "─".repeat(LINE_W);

console.log("");
console.log(`  ${"Feature".padEnd(COL_NAME)}  ${"Minified".padStart(COL_MIN)}  ${"Gzipped".padStart(COL_GZ)}  ${"Delta".padStart(COL_DELTA)}`);
console.log(`  ${sep}`);

for (const r of results) {
  const min = `${r.minKB.toFixed(1)} KB`;
  const gz = `${r.gzKB.toFixed(1)} KB`;
  const delta = r.name === "Base" ? "" : `+${r.deltaKB.toFixed(1)} KB`;

  console.log(
    `  ${r.name.padEnd(COL_NAME)}  ${pad(min, COL_MIN)}  ${pad(gz, COL_GZ)}  ${pad(delta, COL_DELTA)}`,
  );
}

console.log(`  ${sep}`);

// ── Output: Tree-shaking results ──────────────────────────────────

console.log("");

if (treeShakeFailures.length === 0) {
  console.log(`  ✓ Tree-shaking: all ${scenarios.length} scenarios clean — unused features excluded`);
} else {
  console.log(`  ✗ Tree-shaking: ${treeShakeFailures.length} leak(s) detected`);
  console.log("");
  for (const f of treeShakeFailures) {
    console.log(`    ${f.scenario}: leaked ${f.leaked} (marker: "${f.marker}")`);
  }
}

console.log("");

// ── Exit code ─────────────────────────────────────────────────────

if (treeShakeFailures.length > 0) {
  process.exit(1);
}