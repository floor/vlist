// build.ts - Build vlist library
import { $ } from "bun";
import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync } from "fs";
import { resolve } from "path";
import { versionStamp } from "./scripts/version-stamp";
import { lazyDriver, DRIVER_FILE } from "./scripts/lazy-driver";
import { sharedCore } from "./scripts/shared-core";
import { forceInclusionWrapper, sourceValueExports } from "./scripts/shipped-exports";

// Framework entries (#328): vlist/vue, vlist/svelte, vlist/solid, vlist/react.
// The framework stays external: it is an optional peer dependency.
const FRAMEWORK_ENTRIES = ["vue", "svelte", "solid", "react"];
const FRAMEWORKS = ["react", "react-dom", "vue", "svelte", "solid-js"];

// Entries that import the core from dist/index.js (scripts/shared-core.ts).
// vlist/synthetic stays standalone: deprecated, it bundles its own core and driver.
const SHARED_CORE_ENTRIES = ["config", ...FRAMEWORK_ENTRIES];
// A string only createCore carries: its presence means a bundled copy of the core.
const CORE_MARKER = "horizontal RTL lists are not supported";

const isDev = process.argv.includes("--watch");

export interface BuildOptions {
  /** Directory the package exports are written under. Defaults to `./dist`. */
  readonly outDir?: string;
  /** Entry bundles and declarations only. Skips CSS and the size table. */
  readonly entriesOnly?: boolean;
  /** Emit `.d.ts` next to the bundles. The CLI flag `--types` does the same. */
  readonly types?: boolean;
}

export async function build(options: BuildOptions = {}): Promise<void> {
  const dist = options.outDir ?? "./dist";
  const emitTypes = options.types === true || process.argv.includes("--types");
  const entriesOnly = options.entriesOnly === true;
  const distPath = (name: string): string => `${dist}/${name}`;
  const scratch = mkdtempSync("/tmp/vlist-build-");
  const totalStart = performance.now();
  console.log("Building vlist...\n");

  // Shipped browser bundles have no `process`. Without this replace, a
  // `process.env.NODE_ENV !== "production"` guard either always logs or
  // throws; with it, the production log is dropped. Watch builds keep
  // development so setup failures still print.
  const define = {
    "process.env.NODE_ENV": isDev ? '"development"' : '"production"',
  };

  // Clean dist folder before building to avoid stale files
  const cleanStart = performance.now();
  if (!isDev) {
    rmSync(dist, { recursive: true, force: true });
    // Recreate it rather than leaving the outdir to Bun.build. There are four
    // separate build calls writing into ./dist, and only the first would create
    // it; the rest assume it is there. That produced one failure in thirty
    // builds, always on a later chunk after the first had been written:
    //
    //   Bundle  11ms  dist/index.js (184.6 KB)
    //   error: No such file or directory: writing chunk "./config.js"
    //
    // The cause was never reproduced — 29 consecutive builds after it were
    // clean — so this is not a diagnosis. It removes the window in which the
    // directory can be absent while a build writes into it, whatever opened it.
    mkdirSync(dist, { recursive: true });
    console.log(
      `  Clean       ${(performance.now() - cleanStart).toFixed(0).padStart(6)}ms  dist/`,
    );
  }

  // Build main bundle
  const bundleStart = performance.now();

  // Bun tree-shakes a re-export barrel into an empty stub unless the wrapper
  // names every value. A hand-kept list drifted: DEFAULT_SEARCH_TEXT stayed
  // in the .d.ts and disappeared from dist/index.js, so
  // `import { DEFAULT_SEARCH_TEXT } from "vlist"` failed at link time.
  const entryAbs = resolve("./src/index.ts");
  const wrapperCode = forceInclusionWrapper(resolve("."), entryAbs);
  const wrapperPath = `${scratch}/entry.ts`;
  writeFileSync(wrapperPath, wrapperCode);

  const bundleResult = await Bun.build({
    entrypoints: [wrapperPath],
    outdir: dist,
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "index.js",
    plugins: [lazyDriver],
    define,
  });

  if (!bundleResult.success) {
    console.error("\nBundle build failed:\n");
    for (const log of bundleResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const bundleFile = Bun.file(distPath("index.js"));
  const bundleSize = (bundleFile.size / 1024).toFixed(1);
  const bundleTime = performance.now() - bundleStart;
  console.log(
    `  Bundle      ${bundleTime.toFixed(0).padStart(6)}ms  dist/index.js (${bundleSize} KB)`,
  );

  // Opt-in synthetic entry and the native compatibility alias.
  for (const name of ["synthetic"]) {
    const result = await Bun.build({
      entrypoints: [resolve(`./src/${name}.ts`)], outdir: dist,
      format: "esm", target: "browser", minify: !isDev,
      sourcemap: isDev ? "inline" : "none", naming: `${name}.js`,
      define,
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
  }

  // Same derivation as the root barrel. native re-exports the shared core
  // from dist/index.js instead of bundling a second copy.
  const nativeNames = sourceValueExports(resolve("."), resolve("./src/native.ts"));
  if (nativeNames.length === 0) throw new Error("src/native.ts has no value exports");
  await Bun.write(distPath("native.js"), `export { ${nativeNames.join(", ")} } from "./index.js";\n`);

  // scroll.mode: the driver index.js imports lazily, built on its own.
  {
    const result = await Bun.build({
      entrypoints: [resolve("./src/synthetic/driver.ts")], outdir: dist,
      format: "esm", target: "browser", minify: !isDev,
      sourcemap: isDev ? "inline" : "none", naming: DRIVER_FILE, define,
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
    if (!(await Bun.file(distPath(DRIVER_FILE)).text()).includes("pan-x pinch-zoom")) {
      throw new Error(`dist/${DRIVER_FILE} must contain the synthetic driver`);
    }
  }

  for (const name of ["index", "native", "synthetic"]) {
    const text = await Bun.file(distPath(`${name}.js`)).text();
    const hasDriver = text.includes("pan-x pinch-zoom");
    if (hasDriver !== (name === "synthetic")) {
      throw new Error(`Unexpected synthetic driver presence in dist/${name}.js`);
    }
    if (name !== "native" && text.includes("setup failed")) {
      throw new Error(`Production dist/${name}.js still logs plugin setup failures`);
    }
  }

  // Build config bundle (framework-adapter convenience config + resolver)
  const configStart = performance.now();

  const cfgWrapperCode = `export * from "${resolve("./src/config.ts")}";`;
  const cfgWrapperPath = `${scratch}/config.ts`;
  writeFileSync(cfgWrapperPath, cfgWrapperCode);

  const configResult = await Bun.build({
    entrypoints: [cfgWrapperPath],
    outdir: dist,
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "config.js",
    // The core comes from ./index.js, not a copy of its own.
    plugins: [sharedCore],
    define,
  });

  if (!configResult.success) {
    console.error("\nConfig build failed:\n");
    for (const log of configResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const configFile = Bun.file(distPath("config.js"));
  const configSize = (configFile.size / 1024).toFixed(1);
  const configTime = performance.now() - configStart;
  console.log(
    `  Config      ${configTime.toFixed(0).padStart(6)}ms  dist/config.js (${configSize} KB)`,
  );

  // The root bundle loads the synthetic driver lazily, never carries it.
  const indexText = await Bun.file(distPath("index.js")).text();
  if (!indexText.includes(`import("./${DRIVER_FILE}")`) || indexText.includes("pan-x pinch-zoom")) {
    throw new Error(`dist/index.js must load the synthetic driver lazily from dist/${DRIVER_FILE}`);
  }
  for (const name of FRAMEWORK_ENTRIES) {
    const result = await Bun.build({
      entrypoints: [resolve(`./src/${name}.ts`)], outdir: dist,
      format: "esm", target: "browser", minify: !isDev,
      sourcemap: isDev ? "inline" : "none", naming: `${name}.js`,
      external: FRAMEWORKS, plugins: [sharedCore], define,
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
  }

  // Secondary entries import the core from it: no copy of their own, no driver.
  for (const name of SHARED_CORE_ENTRIES) {
    const text = await Bun.file(distPath(`${name}.js`)).text();
    if (!/from\s*"\.\/index\.js"/.test(text) || text.includes(CORE_MARKER) || text.includes("pan-x pinch-zoom")) {
      throw new Error(`dist/${name}.js must import the core from ./index.js, not carry its own`);
    }
  }

  // Build internals bundle (low-level exports for advanced users)
  const internalsStart = performance.now();

  const intWrapperCode = `export * from "${resolve("./src/internals.ts")}";`;
  const intWrapperPath = `${scratch}/internals.ts`;
  writeFileSync(intWrapperPath, intWrapperCode);

  const internalsResult = await Bun.build({
    entrypoints: [intWrapperPath],
    outdir: dist,
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "internals.js",
    define,
  });

  if (!internalsResult.success) {
    console.error("\nInternals build failed:\n");
    for (const log of internalsResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const internalsFile = Bun.file(distPath("internals.js"));
  const internalsSize = (internalsFile.size / 1024).toFixed(1);
  const internalsTime = performance.now() - internalsStart;
  console.log(
    `  Internals   ${internalsTime.toFixed(0).padStart(6)}ms  dist/internals.js (${internalsSize} KB)`,
  );

  // Generate type declarations (optional — pass --types or used in prepublishOnly)
  if (emitTypes) {
    const dtsStart = performance.now();
    const tsc = await $`bunx tsc -p tsconfig.build.json --outDir ${dist}`.quiet().nothrow();
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

  // The export guard builds entries and declarations only. CSS and the size
  // table do not change which names the bundles export.
  if (entriesOnly) {
    rmSync(scratch, { recursive: true, force: true });
    const totalTime = performance.now() - totalStart;
    console.log(`\nDone in ${totalTime.toFixed(0)}ms`);
    return;
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
  minifyCss("./src/styles/vlist.css", distPath("vlist.css"));
  minifyCss("./src/styles/vlist-grid.css", distPath("vlist-grid.css"));
  minifyCss("./src/styles/vlist-masonry.css", distPath("vlist-masonry.css"));
  minifyCss("./src/styles/vlist-table.css", distPath("vlist-table.css"));
  minifyCss("./src/styles/vlist-extras.css", distPath("vlist-extras.css"));
  minifyCss("./src/styles/vlist-tree.css", distPath("vlist-tree.css"));
  minifyCss("./src/styles/vlist-search.css", distPath("vlist-search.css"));
  minifyCss("./src/styles/vlist-carousel.css", distPath("vlist-carousel.css"));
  const cssTime = performance.now() - cssStart;
  const cssFile = Bun.file(distPath("vlist.css"));
  const cssSize = (cssFile.size / 1024).toFixed(1);
  const gridFile = Bun.file(distPath("vlist-grid.css"));
  const gridSize = (gridFile.size / 1024).toFixed(1);
  const masonryFile = Bun.file(distPath("vlist-masonry.css"));
  const masonrySize = (masonryFile.size / 1024).toFixed(1);
  const tableFile = Bun.file(distPath("vlist-table.css"));
  const tableSize = (tableFile.size / 1024).toFixed(1);
  const extrasFile = Bun.file(distPath("vlist-extras.css"));
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
    { name: "synthetic", imports: ["createVList"] },
    { name: "synthetic + carousel", imports: ["createVList", "carousel"] },
    { name: "synthetic + sortable", imports: ["createVList", "sortable"] },
    { name: "createStats", imports: ["createVList", "createStats"] },
    { name: "synthetic + createStats", imports: ["createVList", "createStats"] },
    { name: "native", imports: ["createVList"] },
    // Framework entries (#328), framework external.
    { name: "vue", imports: ["useVList"] },
    { name: "svelte", imports: ["vlist"] },
    { name: "solid", imports: ["createVList"] },
    { name: "react", imports: ["useVList"] },
    { name: "react + grid", imports: ["useVList", "grid"] },
    ...ALL_PLUGINS.map((f) => ({ name: f, imports: ["createVList", f] })),
  ];

  const sizes: Record<string, { minified: string; gzipped: string; minBytes: number; gzBytes: number }> = {};

  for (const { name, imports } of scenarios) {
    const scenarioEntry = ["synthetic", "native"].includes(name) ? resolve(`./src/${name}.ts`) : entryAbs;
    const framework = /^(vue|svelte|solid|react)\b/.exec(name)?.[1];
    const code = framework
      ? `import { ${imports[0]} } from "${resolve(`./src/${framework}.ts`)}";${imports.length > 1 ? ` import { ${imports.slice(1).join(", ")} } from "${entryAbs}";` : ""} globalThis._v = [${imports.join(", ")}];`
      : name.startsWith("synthetic +")
      ? `import { createVList } from "${resolve("./src/synthetic.ts")}"; import { ${imports.slice(1).join(", ")} } from "${entryAbs}"; globalThis._v = [${imports.join(", ")}];`
      : `import { ${imports.join(", ")} } from "${scenarioEntry}"; globalThis._v = [${imports.join(", ")}];`;
    const tmp = `${scratch}/size_${name}.ts`;
    writeFileSync(tmp, code);

    const result = await Bun.build({
      entrypoints: [tmp],
      minify: true,
      target: "browser",
      format: "esm",
      plugins: [lazyDriver],
      external: FRAMEWORKS,
      define: { "process.env.NODE_ENV": '"production"' },
    });

    if (result.success) {
      const output = await result.outputs[0]!.arrayBuffer();
      const bytes = new Uint8Array(output);
      if (new TextDecoder().decode(bytes).includes("pan-x pinch-zoom") !== (name.startsWith("synthetic"))) {
        throw new Error(`Unexpected synthetic driver presence in ${name}`);
      }
      if (new TextDecoder().decode(bytes).includes(".runwayFactor") !== imports.includes("carousel")) {
        throw new Error(`Unexpected private runway presence in ${name}`);
      }
      const compressed = Bun.gzipSync(bytes);
      sizes[name] = {
        minified: (bytes.byteLength / 1024).toFixed(1),
        gzipped: (compressed.byteLength / 1024).toFixed(1),
        minBytes: bytes.byteLength,
        gzBytes: compressed.byteLength,
      };
    }
  }

  writeFileSync(distPath("size.json"), JSON.stringify(sizes) + "\n");
  // Which vlist this dist is: a site serving the bundle reads it from here.
  writeFileSync(distPath("version.json"), JSON.stringify(versionStamp(resolve("."))) + "\n");

  const base = sizes.base ?? { minified: "0", gzipped: "0" };
  const baseGz = parseFloat(base.gzipped);
  if (baseGz < 3 || baseGz > 50) {
    console.error(`\n  ✗ Base gzipped size ${base.gzipped} KB is outside expected range (3–50 KB). Build or tree-shaking may be broken.\n`);
    process.exit(1);
  }

  console.log("");
  console.log(`  base        ${base.minified} KB minified, ${base.gzipped} KB gzipped (tree-shaken)`);

  rmSync(scratch, { recursive: true, force: true });
  const totalTime = performance.now() - totalStart;
  console.log(`\nDone in ${totalTime.toFixed(0)}ms`);
}

if (import.meta.main) {
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
}
