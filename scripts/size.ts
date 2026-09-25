/**
 * vlist — Plugin Size Measurement + Tree-Shaking Verification
 * Builds each plugin combination with tree-shaking and reports gzipped sizes.
 * Also verifies that unused plugins are actually excluded from the bundle.
 *
 * A scenario that fails to compile fails the command. Every measured size the
 * README publishes has a gzip budget, so a plugin that doubles cannot pass CI
 * just because the table still printed.
 *
 * Usage:
 *   bun run scripts/size.ts
 */

import { gzipSync } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const entry = `${root}/src/index.ts`;

// ── All v2 plugin names ───────────────────────────────────────────

const ALL_PLUGINS = [
  "a11y", "selection", "data", "scrollbar", "sortable",
  "groups", "page", "snapshots", "transition",
  "autosize", "grid", "table", "masonry", "tree", "search",
] as const;

type PluginName = (typeof ALL_PLUGINS)[number];

// ── Known cross-plugin dependencies ──────────────────────────────
//
// Some plugins legitimately import code from other modules.
// These markers may appear in the bundle even when the dependency
// plugin wasn't explicitly imported by the consumer.

const KNOWN_DEPS: Partial<Record<PluginName, readonly PluginName[]>> = {
  // selection does a dynamic getMethod("getGroupLayout") lookup — string only, no import
  selection: ["groups"],
  // groups does dynamic getMethod lookups for grid/masonry — string only, no import
  groups: ["grid", "masonry"],
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
  page:       ["scrollPadding"],
  snapshots:  ["getScrollSnapshot", "restoreScroll"],
  transition: ["remove:end", "insert:end"],
  autosize:   ["getMeasuredCount", "setMeasuredSize"],
  table:      ["--table", "column:resize", "column:sort"],
  groups:     ["--grouped", "getGroupLayout"],
  data:       ["load:start", "load:end"],
  masonry:    ["--masonry", "getMasonryLayout", "updateMasonry"],
  sortable:   ["sort:start", "sort:end", "--sorting"],
  tree:       ["--tree", "tree-node", "treeitem"],
  search:     ["-search-match", "search:change", "openSearch"],
};

// ── Scenarios ─────────────────────────────────────────────────────

export const SCENARIO_DEFS = [
  { name: "Base (createVList)", imports: ["createVList"] },
  { name: "synthetic", imports: ["createVList"] },
  { name: "synthetic + carousel", imports: ["createVList", "carousel"] },
  { name: "synthetic + sortable", imports: ["createVList", "sortable"] },
  { name: "createStats", imports: ["createVList", "createStats"] },
  { name: "synthetic + createStats", imports: ["createVList", "createStats"] },
  { name: "native", imports: ["createVList"] },
  { name: "a11y",              imports: ["createVList", "a11y"] },
  { name: "selection",         imports: ["createVList", "selection"] },
  { name: "data",              imports: ["createVList", "data"] },
  { name: "scrollbar",         imports: ["createVList", "scrollbar"] },
  { name: "sortable",          imports: ["createVList", "sortable"] },
  { name: "groups",            imports: ["createVList", "groups"] },
  { name: "page",              imports: ["createVList", "page"] },
  { name: "snapshots",         imports: ["createVList", "snapshots"] },
  { name: "transition",        imports: ["createVList", "transition"] },
  { name: "autosize",          imports: ["createVList", "autosize"] },
  { name: "grid",              imports: ["createVList", "grid"] },
  { name: "table",             imports: ["createVList", "table"] },
  { name: "masonry",           imports: ["createVList", "masonry"] },
  { name: "tree",              imports: ["createVList", "tree"] },
  { name: "search",            imports: ["createVList", "search"] },
  { name: "carousel",          imports: ["createVList", "carousel"] },
] as const;

export type ScenarioName = (typeof SCENARIO_DEFS)[number]["name"];

interface Scenario {
  name: ScenarioName;
  imports: readonly string[];
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

const scenarios: Scenario[] = SCENARIO_DEFS.map((s) => ({
  name: s.name,
  imports: s.imports,
  mustNotContain: excluded(s.imports),
}));

// ── Byte budget ───────────────────────────────────────────────────
//
// The README publishes a gzipped size for every row this script measures.
// Only the 9.9 KB base target used to be enforced, so 22 of 23 sizes could
// double and CI would still pass. Ceilings are a measured run's 0.1 KB
// column plus 0.4 KB of slack — the same margin the 9.9 KB target had over
// the advertised 9.5 KB base. Base and native keep a fixed target; it moved
// from 9.9 kB to 10.0 kB on 2026-09-25 (see below).

/** Tenth-of-a-KB ceiling, matching how the README quotes sizes. */
// Headroom rule (2026-09-18): each budget is the measured size rounded up on a
// 0.1 kB grid with at least ~100 bytes of room. A budget exists to catch a
// regression, not a rounding: with budgets set to the byte, a correct core
// change (FLO-191) failed this gate three times by 5, 5 and 2 bytes. The sizes
// quoted in the README still come from `bun run size`, never from this table.
//
// Two budgets are not headroom but a promise: the base and native entries stay
// at 10.0 kB, pinned by test/scripts/size.test.ts. The headroom rule does not
// apply to them — raising either is a product decision, not a chore. It was
// 9.9 kB until 2026-09-25: the 3.x fix cycle grew the core past it while the
// gate was dark behind a failing typecheck (#287 alone cost 43 bytes), and
// Dr Jones chose 10.0 kB over trimming merged fixes. 10.0 kB leaves the base
// 40 bytes of room, so the next core growth is a decision again, on purpose.
export const kb = (n: number): number => Math.floor(n * 1024);

export const BUDGET_BYTES: Record<ScenarioName, number> = {
  "Base (createVList)": kb(10.0),
  synthetic: kb(12.7),
  "synthetic + carousel": kb(17.6),
  "synthetic + sortable": kb(16.3),
  createStats: kb(10.3),
  "synthetic + createStats": kb(13.0),
  native: kb(10.0),
  a11y: kb(11.5),
  selection: kb(13.0),
  data: kb(14.9),
  scrollbar: kb(13.0),
  sortable: kb(13.6),
  groups: kb(15.5),
  page: kb(11.0),
  snapshots: kb(11.3),
  transition: kb(12.1),
  autosize: kb(11.2),
  grid: kb(12.7),
  table: kb(16.0),
  masonry: kb(14.5),
  tree: kb(15.5),
  search: kb(13.4),
  carousel: kb(15.3),
};

export interface SizeGateInput {
  readonly buildFailures: readonly string[];
  readonly treeShakeFailures: readonly unknown[];
  readonly overBudget: readonly string[];
}

/** The command fails if any scenario failed to build, leaked, or grew past its budget. */
export const sizeGateFails = (input: SizeGateInput): boolean =>
  input.buildFailures.length > 0
  || input.treeShakeFailures.length > 0
  || input.overBudget.length > 0;

export const missingMeasuredScenarios = (
  measuredNames: readonly string[],
): readonly ScenarioName[] => {
  const measured = new Set(measuredNames);
  return SCENARIO_DEFS.map((s) => s.name).filter((name) => !measured.has(name));
};

// ── Build & measure ───────────────────────────────────────────────

interface Result {
  name: ScenarioName;
  /** Exact bytes, kept because the README quotes them and the budget gates on them. */
  minBytes: number;
  gzBytes: number;
  minKB: number;
  gzKB: number;
  deltaKB: number;
}

interface TreeShakeFailure {
  scenario: string;
  leaked: string;
  marker: string;
}

const main = async (): Promise<void> => {
  const scratch = mkdtempSync("/tmp/vlist-size-");
  const results: Result[] = [];
  const treeShakeFailures: TreeShakeFailure[] = [];
  const buildFailures: ScenarioName[] = [];

  for (const scenario of scenarios) {
    const imports = scenario.imports.join(", ");
    const code = scenario.name.startsWith("synthetic +")
      ? `import { createVList } from "${root}/src/synthetic.ts"; import { ${scenario.imports.slice(1).join(", ")} } from "${entry}"; globalThis._v = [${imports}];`
      : `import { ${imports} } from "${["native", "synthetic"].includes(scenario.name) ? `${root}/src/${scenario.name}.ts` : entry}"; globalThis._v = [${imports}];`;
    const tmpFile = `${scratch}/${scenario.name.replace(/[^a-zA-Z0-9]/g, "_")}.ts`;

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
      buildFailures.push(scenario.name);
      continue;
    }

    const output = await build.outputs[0]!.arrayBuffer();
    const minBytes = output.byteLength;
    const gzBytes = gzipSync(new Uint8Array(output)).byteLength;

    results.push({
      name: scenario.name,
      minBytes,
      gzBytes,
      minKB: minBytes / 1024,
      gzKB: gzBytes / 1024,
      deltaKB: 0,
    });

    const syntheticMarker = "pan-x pinch-zoom";
    if (new TextDecoder().decode(output).includes(syntheticMarker) !== (scenario.name.startsWith("synthetic"))) {
      treeShakeFailures.push({ scenario: scenario.name, leaked: "synthetic", marker: syntheticMarker });
    }

    // The private runway engine belongs exclusively to the carousel plugin.
    // The native runway factor read distinguishes it from synthetic wrap folding.
    const runwayMarker = ".runwayFactor";
    if (new TextDecoder().decode(output).includes(runwayMarker) !== (scenario.imports.includes("carousel"))) {
      treeShakeFailures.push({ scenario: scenario.name, leaked: "runway", marker: runwayMarker });
    }

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
  console.log("  vlist — Plugin Sizes");
  console.log("");
  console.log(`  ${"Plugin".padEnd(COL_NAME)}  ${"Minified".padStart(COL_MIN)}  ${"Gzipped".padStart(COL_GZ)}  ${"Delta".padStart(COL_DELTA)}`);
  console.log(`  ${sep}`);

  for (const r of results) {
    const min = `${r.minKB.toFixed(1)} KB`;
    const gz = `${r.gzKB.toFixed(1)} KB`;
    const delta = r.name.startsWith("Base") ? "" : `${r.deltaKB >= 0 ? "+" : ""}${r.deltaKB.toFixed(1)} KB`;

    console.log(
      `  ${r.name.padEnd(COL_NAME)}  ${pad(min, COL_MIN)}  ${pad(gz, COL_GZ)}  ${pad(delta, COL_DELTA)}`,
    );
  }

  console.log(`  ${sep}`);

  console.log("");

  if (buildFailures.length > 0) {
    console.log(`  ✗ Build: ${buildFailures.length} scenario(s) failed to compile`);
    for (const name of buildFailures) {
      console.log(`    ${name}`);
    }
    console.log("");
  }

  // ── Output: Tree-shaking results ──────────────────────────────────

  if (treeShakeFailures.length === 0) {
    const checked = results.length;
    if (checked === scenarios.length) {
      console.log(`  ✓ Tree-shaking: all ${scenarios.length} scenarios clean — unused plugins excluded`);
    } else {
      console.log(`  ✓ Tree-shaking: ${checked} measured scenario(s) clean`);
    }
  } else {
    console.log(`  ✗ Tree-shaking: ${treeShakeFailures.length} leak(s) detected`);
    console.log("");
    for (const f of treeShakeFailures) {
      console.log(`    ${f.scenario}: leaked ${f.leaked} (marker: "${f.marker}")`);
    }
  }

  console.log("");

  const overBudget: string[] = [];

  for (const scenario of scenarios) {
    const budget = BUDGET_BYTES[scenario.name];
    const r = results.find((x) => x.name === scenario.name);
    if (!r) {
      console.log(`  ✗ ${scenario.name}: not measured (build failed)`);
      continue;
    }
    const over = r.gzBytes > budget;
    if (over) overBudget.push(r.name);
    console.log(
      `  ${over ? "✗" : "✓"} ${r.name}: ${r.gzBytes} bytes gzipped (budget ${budget})`,
    );
  }

  console.log("");

  rmSync(scratch, { recursive: true, force: true });

  // A failed scenario that was logged and skipped still fails the command.
  // Checking measured names as well covers a dropped result that never made
  // it into buildFailures — the original bug, where Base vanishing also
  // silenced the only budget.
  for (const name of missingMeasuredScenarios(results.map((r) => r.name))) {
    if (!buildFailures.includes(name)) buildFailures.push(name);
  }

  // ── Exit code ─────────────────────────────────────────────────────

  if (sizeGateFails({ buildFailures, treeShakeFailures, overBudget })) {
    process.exit(1);
  }
};

if (import.meta.main) {
  await main();
}
