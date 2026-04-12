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

  const bundleResult = await Bun.build({
    entrypoints: ["./src/index.ts"],
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

  // Build internals bundle (low-level exports for advanced users)
  const internalsStart = performance.now();

  const internalsResult = await Bun.build({
    entrypoints: ["./src/internals.ts"],
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

  // Generate type declarations (optional)
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
      `  Types       ${dtsTime.toFixed(0).padStart(6)}ms  dist/*.d.ts`,
    );
  }

  // Minify and copy CSS
  const cssStart = performance.now();
  const minifyCss = (src: string, dest: string) => {
    const raw = readFileSync(src, "utf-8");
    const minified = raw
      .replace(/\/\*[\s\S]*?\*\//g, "") // strip comments
      .replace(/\s*([{}:;,>~+])\s*/g, "$1") // collapse around symbols
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

  // Size summary — tree-shaken base bundle (only vlist, no features)
  const absEntry = resolve("./src/index.ts");
  const baseCode = `import { vlist } from "${absEntry}"; globalThis._v = [vlist];`;
  const tmpFile = "/tmp/_vlist_base_size.ts";
  writeFileSync(tmpFile, baseCode);

  const baseBuild = await Bun.build({
    entrypoints: [tmpFile],
    minify: true,
    target: "browser",
    format: "esm",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  let baseMinified = "0";
  let baseGzipped = "0";

  if (baseBuild.success) {
    const output = await baseBuild.outputs[0]!.arrayBuffer();
    const bytes = new Uint8Array(output);
    const compressed = Bun.gzipSync(bytes);
    baseMinified = (bytes.byteLength / 1024).toFixed(1);
    baseGzipped = (compressed.byteLength / 1024).toFixed(1);

    // Write size.json so vlist.io homepage can read the accurate value
    writeFileSync(
      "./dist/size.json",
      JSON.stringify({
        base: { minified: baseMinified, gzipped: baseGzipped },
        full: { minified: bundleSize, gzipped: "0" },
      }),
    );
  }

  // Also compute full bundle gzip for display
  const fullContent = await Bun.file("./dist/index.js").arrayBuffer();
  const fullCompressed = Bun.gzipSync(new Uint8Array(fullContent));
  const fullGzipped = (fullCompressed.byteLength / 1024).toFixed(1);

  // Update size.json with full bundle size
  if (baseBuild.success) {
    writeFileSync(
      "./dist/size.json",
      JSON.stringify({
        base: { minified: baseMinified, gzipped: baseGzipped },
        full: { minified: bundleSize, gzipped: fullGzipped },
      }),
    );
  }

  console.log("");
  console.log(`  index.js    ${bundleSize} KB minified, ${fullGzipped} KB gzipped`);
  console.log(`  base        ${baseMinified} KB minified, ${baseGzipped} KB gzipped (tree-shaken)`);

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
