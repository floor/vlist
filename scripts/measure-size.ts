/**
 * vlist v2 — Plugin Size Measurement + Tree-Shaking Verification
 * Builds each plugin combination with tree-shaking and reports gzipped sizes.
 * Also verifies that unused plugins are actually excluded from the bundle.
 *
 * Usage:
 *   bun run scripts/size.ts
 */

import { gzipSync } from "bun";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const entry = `${root}/src/index.ts`;

// ── All v2 plugin names ───────────────────────────────────────────

const ALL_PLUGINS = [
  "a11y", "selection", "data", "scrollbar", "sortable",
  "groups", "scale", "page", "snapshots", "transition",
  "autosize", "grid", "table", "masonry",
] as const;

type PluginName = (typeof ALL_PLUGINS)[number];

// ── Known cross-plugin dependencies ──────────────────────────────
//
// Some plugins legitimately import code from other modules.
// These markers may appear in the bundle even when the dependency
// plugin wasn't explicitly imported by the consumer.

const KNOWN_DEPS: Partial<Record<PluginName, readonly PluginName[]>> = {
  // scale imports createScrollbar for fallback scrollbar in compressed mode
  scale: ["scrollbar"],
  // selection does a dynamic getMethod("getGroupLayout") lookup — string only, no import
  selection: ["groups"],
};

// ── Unique string markers per plugin ─────────────────────────────
//
// String literals that survive minification: CSS class fragments,
// registered method names, event names, addEventListener targets.

const PLUGIN_MARKERS: Record<PluginName, readonly string[]> = {
  a11y:       ['"a11y"'],
  grid:       ["-grid-item", "getGridLayout", "updateGrid"],
  selection:  ["selectAll", "clearSelection"],
  scrollbar:  ["-scrollbar__thumb"],
  scale:      ["touchcancel"],
  page:       ["scrollPadding"],
  snapshots:  ["getScrollSnapshot", "restoreScroll"],
  transition: ["remove:end", "insert:end"],
  autosize:   ["getMeasuredCount", "setMeasuredSize"],
  table:      ["--table", "column:resize", "column:sort"],
  groups:     ["--grouped", "getGroupLayout"],
  data:       ["load:start", "load:end"],
  masonry:    ["--masonry", "getMasonryLayout", "updateMasonry"],
  sortable:   ["sort:start", "sort:end", "--sorting"],
};

// ── Scenarios ─────────────────────────────────────────────────────

interface Scenario {
  name: string;
  imports: string[];
  mustNotContain: readonly PluginName[];
}

const excluded = (imported: readonly string[]): readonly PluginName[] => {
  const allowed = new Set<string>(imported);

  for (const name of imported) {
    const deps = KNOWN_DEPS[name as PluginName];
    if (deps) for (const dep of deps) allowed.add(dep);
  }

  return ALL_PLUGINS.filter((p) => !allowed.has(p));
};

const scenarios: Scenario[] = [
  { name: "Base (createVList)", imports: ["createVList"] },
  { name: "a11y",              imports: ["createVList", "a11y"] },
  { name: "selection",         imports: ["createVList", "selection"] },
  { name: "data",              imports: ["createVList", "data"] },
  { name: "scrollbar",         imports: ["createVList", "scrollbar"] },
  { name: "sortable",          imports: ["createVList", "sortable"] },
  { name: "groups",            imports: ["createVList", "groups"] },
  { name: "scale",             imports: ["createVList", "scale"] },
  { name: "page",              imports: ["createVList", "page"] },
  { name: "snapshots",         imports: ["createVList", "snapshots"] },
  { name: "transition",        imports: ["createVList", "transition"] },
  { name: "autosize",          imports: ["createVList", "autosize"] },
  { name: "grid",              imports: ["createVList", "grid"] },
  { name: "table",             imports: ["createVList", "table"] },
  { name: "masonry",           imports: ["createVList", "masonry"] },
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
  const tmpFile = `/tmp/_vlist_v2_size_${scenario.name.replace(/[^a-zA-Z0-9]/g, "_")}.ts`;

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

    for (const pluginName of scenario.mustNotContain) {
      const markers = PLUGIN_MARKERS[pluginName];

      for (const marker of markers) {
        if (bundleText.includes(marker)) {
          treeShakeFailures.push({
            scenario: scenario.name,
            leaked: pluginName,
            marker,
          });
          break;
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
console.log("  vlist v2 — Plugin Sizes");
console.log("");
console.log(`  ${"Plugin".padEnd(COL_NAME)}  ${"Minified".padStart(COL_MIN)}  ${"Gzipped".padStart(COL_GZ)}  ${"Delta".padStart(COL_DELTA)}`);
console.log(`  ${sep}`);

for (const r of results) {
  const min = `${r.minKB.toFixed(1)} KB`;
  const gz = `${r.gzKB.toFixed(1)} KB`;
  const delta = r.name.startsWith("Base") ? "" : `+${r.deltaKB.toFixed(1)} KB`;

  console.log(
    `  ${r.name.padEnd(COL_NAME)}  ${pad(min, COL_MIN)}  ${pad(gz, COL_GZ)}  ${pad(delta, COL_DELTA)}`,
  );
}

console.log(`  ${sep}`);

// ── Output: Tree-shaking results ──────────────────────────────────

console.log("");

if (treeShakeFailures.length === 0) {
  console.log(`  ✓ Tree-shaking: all ${scenarios.length} scenarios clean — unused plugins excluded`);
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
