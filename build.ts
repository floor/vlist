// build.ts - Build vlist library
import { $ } from "bun";
import { readFileSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";

const isDev = process.argv.includes("--watch");
const withTypes = process.argv.includes("--types");

async function build() {
  const totalStart = performance.now();
  console.log("Building vlist...\n");

  // Clean dist folder before building to avoid stale files
  const cleanStart = performance.now();
  if (!isDev) {
    rmSync("./dist", { recursive: true, force: true });
    console.log(
      `  Clean       ${(performance.now() - cleanStart).toFixed(0).padStart(6)}ms  dist/`,
    );
  }

  // Build main bundle
  const bundleStart = performance.now();

  // Bun tree-shakes re-export barrels into empty stubs, so we
  // reference all exports in a wrapper to force inclusion.
  const entryAbs = resolve("./src/index.ts");
  const wrapperCode = [
    `export { createVList, scrollbar, grid, a11y, selection, page,`,
    `  snapshots, transition, autosize, masonry, data, groups, table, sortable, tree, search, carousel,`,
    `  registerPreset, getPreset, resolvePreset, full, hero, heroCenter, multi, uncontained,`,
    `  createStats, rebuild } from "${entryAbs}";`,
  ].join("\n");
  const wrapperPath = "/tmp/_vlist_build_entry.ts";
  writeFileSync(wrapperPath, wrapperCode);

  const bundleResult = await Bun.build({
    entrypoints: [wrapperPath],
    outdir: "./dist",
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "index.js",
  });

  if (!bundleResult.success) {
    console.error("\nBundle build failed:\n");
    for (const log of bundleResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const bundleFile = Bun.file("./dist/index.js");
  const bundleSize = (bundleFile.size / 1024).toFixed(1);
  const bundleTime = performance.now() - bundleStart;
  console.log(
    `  Bundle      ${bundleTime.toFixed(0).padStart(6)}ms  dist/index.js (${bundleSize} KB)`,
  );

  // Build config bundle (framework-adapter convenience config + resolver)
  const configStart = performance.now();

  const cfgWrapperCode = `export * from "${resolve("./src/config.ts")}";`;
  const cfgWrapperPath = "/tmp/_vlist_build_config.ts";
  writeFileSync(cfgWrapperPath, cfgWrapperCode);

  const configResult = await Bun.build({
    entrypoints: [cfgWrapperPath],
    outdir: "./dist",
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "config.js",
  });

  if (!configResult.success) {
    console.error("\nConfig build failed:\n");
    for (const log of configResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const configFile = Bun.file("./dist/config.js");
  const configSize = (configFile.size / 1024).toFixed(1);
  const configTime = performance.now() - configStart;
  console.log(
    `  Config      ${configTime.toFixed(0).padStart(6)}ms  dist/config.js (${configSize} KB)`,
  );

  // Build internals bundle (low-level exports for advanced users)
  const internalsStart = performance.now();

  const intWrapperCode = `export * from "${resolve("./src/internals.ts")}";`;
  const intWrapperPath = "/tmp/_vlist_build_internals.ts";
  writeFileSync(intWrapperPath, intWrapperCode);

  const internalsResult = await Bun.build({
    entrypoints: [intWrapperPath],
    outdir: "./dist",
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "internals.js",
  });

  if (!internalsResult.success) {
    console.error("\nInternals build failed:\n");
    for (const log of internalsResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const internalsFile = Bun.file("./dist/internals.js");
  const internalsSize = (internalsFile.size / 1024).toFixed(1);
  const internalsTime = performance.now() - internalsStart;
  console.log(
    `  Internals   ${internalsTime.toFixed(0).padStart(6)}ms  dist/internals.js (${internalsSize} KB)`,
  );

  // Generate type declarations (optional — pass --types or used in prepublishOnly)
  if (withTypes) {
    const dtsStart = performance.now();
    const tsc = await $`bunx tsc -p tsconfig.build.json`.quiet().nothrow();
    if (tsc.exitCode !== 0) {
      console.error("\nTypeScript declaration generation failed:\n");
      console.error(tsc.stderr.toString());
      process.exit(1);
    }
    const dtsTime = performance.now() - dtsStart;
    console.log(
      `  Types       ${dtsTime.toFixed(0).padStart(6)}ms  dist/**/*.d.ts`,
    );
  }

  // Minify and copy CSS
  const cssStart = performance.now();
  const minifyCss = (src: string, dest: string) => {
    const raw = readFileSync(src, "utf-8");
    const minified = raw
      .replace(/\/\*[\s\S]*?\*\//g, "") // strip comments
      .replace(/\s*([{}:;,>~])\s*/g, "$1") // collapse around symbols (not + or -, calc needs them spaced)
      .replace(/;\}/g, "}") // drop trailing semicolons
      .replace(/\s+/g, " ") // collapse whitespace
      .trim();
    writeFileSync(dest, minified);
  };
  minifyCss("./src/styles/vlist.css", "./dist/vlist.css");
  minifyCss("./src/styles/vlist-grid.css", "./dist/vlist-grid.css");
  minifyCss("./src/styles/vlist-masonry.css", "./dist/vlist-masonry.css");
  minifyCss("./src/styles/vlist-table.css", "./dist/vlist-table.css");
  minifyCss("./src/styles/vlist-extras.css", "./dist/vlist-extras.css");
  minifyCss("./src/styles/vlist-tree.css", "./dist/vlist-tree.css");
  minifyCss("./src/styles/vlist-search.css", "./dist/vlist-search.css");
  minifyCss("./src/styles/vlist-carousel.css", "./dist/vlist-carousel.css");
  const cssTime = performance.now() - cssStart;
  const cssFile = Bun.file("./dist/vlist.css");
  const cssSize = (cssFile.size / 1024).toFixed(1);
  const gridFile = Bun.file("./dist/vlist-grid.css");
  const gridSize = (gridFile.size / 1024).toFixed(1);
  const masonryFile = Bun.file("./dist/vlist-masonry.css");
  const masonrySize = (masonryFile.size / 1024).toFixed(1);
  const tableFile = Bun.file("./dist/vlist-table.css");
  const tableSize = (tableFile.size / 1024).toFixed(1);
  const extrasFile = Bun.file("./dist/vlist-extras.css");
  const extrasSize = (extrasFile.size / 1024).toFixed(1);
  console.log(
    `  CSS         ${cssTime.toFixed(0).padStart(6)}ms  dist/vlist.css (${cssSize} KB) + grid (${gridSize} KB) + masonry (${masonrySize} KB) + table (${tableSize} KB) + extras (${extrasSize} KB)`,
  );

  // ── Size measurement (tree-shaken, mirrors scripts/measure-size.ts) ──

  const ALL_PLUGINS = [
    "a11y", "selection", "data", "scrollbar", "sortable",
    "groups", "page", "snapshots", "transition",
    "autosize", "grid", "table", "masonry", "tree", "search", "carousel",
  ] as const;

  const scenarios = [
    { name: "base", imports: ["createVList"] },
    ...ALL_PLUGINS.map((f) => ({ name: f, imports: ["createVList", f] })),
  ];

  const sizes: Record<string, { minified: string; gzipped: string; minBytes: number; gzBytes: number }> = {};

  for (const { name, imports } of scenarios) {
    const code = `import { ${imports.join(", ")} } from "${entryAbs}"; globalThis._v = [${imports.join(", ")}];`;
    const tmp = `/tmp/_vlist_size_${name}.ts`;
    writeFileSync(tmp, code);

    const result = await Bun.build({
      entrypoints: [tmp],
      minify: true,
      target: "browser",
      format: "esm",
      define: { "process.env.NODE_ENV": '"production"' },
    });

    if (result.success) {
      const output = await result.outputs[0]!.arrayBuffer();
      const bytes = new Uint8Array(output);
      const compressed = Bun.gzipSync(bytes);
      sizes[name] = {
        minified: (bytes.byteLength / 1024).toFixed(1),
        gzipped: (compressed.byteLength / 1024).toFixed(1),
        minBytes: bytes.byteLength,
        gzBytes: compressed.byteLength,
      };
    }
  }

  writeFileSync("./dist/size.json", JSON.stringify(sizes) + "\n");

  const base = sizes.base ?? { minified: "0", gzipped: "0" };
  const baseGz = parseFloat(base.gzipped);
  if (baseGz < 3 || baseGz > 50) {
    console.error(`\n  ✗ Base gzipped size ${base.gzipped} KB is outside expected range (3–50 KB). Build or tree-shaking may be broken.\n`);
    process.exit(1);
  }

  console.log("");
  console.log(`  base        ${base.minified} KB minified, ${base.gzipped} KB gzipped (tree-shaken)`);

  const totalTime = performance.now() - totalStart;
  console.log(`\nDone in ${totalTime.toFixed(0)}ms`);
}

if (isDev) {
  console.log("Watching for changes...\n");

  const { watch } = await import("fs");
  watch("./src", { recursive: true }, async (_event, filename) => {
    if (filename && !filename.includes("node_modules")) {
      console.log(`\n${filename} changed\n`);
      await build();
    }
  });

  await build();
} else {
  await build();
}
