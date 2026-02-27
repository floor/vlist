/**
 * vlist — Feature Size Measurement
 * Builds each feature combination with tree-shaking and reports gzipped sizes.
 *
 * Usage:
 *   bun run size
 *   bun run scripts/measure-size.ts
 */

import { gzipSync } from "bun";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const entry = `${root}/src/index.ts`;

// ── Feature scenarios ─────────────────────────────────────────────

interface Scenario {
  name: string;
  imports: string[];
}

const scenarios: Scenario[] = [
  { name: "Base", imports: ["vlist"] },
  { name: "withGrid", imports: ["vlist", "withGrid"] },
  { name: "withMasonry", imports: ["vlist", "withMasonry"] },
  { name: "withSections", imports: ["vlist", "withSections"] },
  { name: "withAsync", imports: ["vlist", "withAsync"] },
  { name: "withSelection", imports: ["vlist", "withSelection"] },
  { name: "withScale", imports: ["vlist", "withScale"] },
  { name: "withScrollbar", imports: ["vlist", "withScrollbar"] },
  { name: "withPage", imports: ["vlist", "withPage"] },
  { name: "withSnapshots", imports: ["vlist", "withSnapshots"] },
];

// ── Build & measure ───────────────────────────────────────────────

interface Result {
  name: string;
  minKB: number;
  gzKB: number;
  deltaKB: number;
}

const results: Result[] = [];

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
}

// ── Compute deltas ────────────────────────────────────────────────

const baseGz = results[0]?.gzKB ?? 0;

for (const r of results) {
  r.deltaKB = r.gzKB - baseGz;
}

// ── Output ────────────────────────────────────────────────────────

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
  const delta =
    r.name === "Base" ? "" : `+${r.deltaKB.toFixed(1)} KB`;

  console.log(
    `  ${r.name.padEnd(COL_NAME)}  ${pad(min, COL_MIN)}  ${pad(gz, COL_GZ)}  ${pad(delta, COL_DELTA)}`,
  );
}

console.log(`  ${sep}`);
console.log("");