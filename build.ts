// build.ts - Build vlist library
import { $ } from "bun";
import { readFileSync, writeFileSync, rmSync } from "fs";

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

  // Build sub-module bundles for tree-shaking
  const subStart = performance.now();

  const coreModules: { entry: string; out: string; folder: boolean }[] = [];

  const builderModules = [
    { entry: "./src/builder/index.ts", out: "builder", folder: true },
  ];

  const mainModule = { entry: "./src/index.ts", out: "index.js" };

  const featureModules = [
    { entry: "./src/features/async/index.ts", out: "async", folder: true },
    { entry: "./src/features/scale/index.ts", out: "scale", folder: true },
    {
      entry: "./src/features/selection/index.ts",
      out: "selection",
      folder: true,
    },
    {
      entry: "./src/features/scrollbar/index.ts",
      out: "scrollbar",
      folder: true,
    },
    {
      entry: "./src/features/sections/index.ts",
      out: "sections",
      folder: true,
    },
    { entry: "./src/features/grid/index.ts", out: "grid", folder: true },
    {
      entry: "./src/features/snapshots/index.ts",
      out: "snapshots",
      folder: true,
    },
    { entry: "./src/features/page/index.ts", out: "page", folder: true },
  ];

  const allModules = [...coreModules, ...builderModules, ...featureModules];

  // Single-file builds (no folder structure)
  const singleFileModules = [mainModule];

  // Framework adapters removed - now separate packages:
  // - vlist-react (https://github.com/floor/vlist-react)
  // - vlist-vue (https://github.com/floor/vlist-vue)
  // - vlist-svelte (https://github.com/floor/vlist-svelte)

  const subResults: { name: string; size: string; type: string }[] = [];

  for (const sub of allModules) {
    const moduleType = coreModules.includes(sub)
      ? "core"
      : builderModules.includes(sub)
        ? "builder"
        : "feature";
    const subResult = await Bun.build({
      entrypoints: [sub.entry],
      outdir: `./dist/${sub.out}`,
      format: "esm",
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "none",
      naming: "index.js",
    });

    if (!subResult.success) {
      console.error(`\nSub-module build failed (${sub.out}):\n`);
      for (const log of subResult.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const subFile = Bun.file(`./dist/${sub.out}/index.js`);
    const subSize = (subFile.size / 1024).toFixed(1);
    subResults.push({ name: sub.out, size: subSize, type: moduleType });
  }

  // Build single-file modules
  for (const single of singleFileModules) {
    const singleResult = await Bun.build({
      entrypoints: [single.entry],
      outdir: "./dist",
      format: "esm",
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "none",
      naming: single.out,
    });

    if (!singleResult.success) {
      console.error(`\nSingle-file module build failed (${single.out}):\n`);
      for (const log of singleResult.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const singleFile = Bun.file(`./dist/${single.out}`);
    const singleSize = (singleFile.size / 1024).toFixed(1);
    const name = single.out.replace(".js", "");
    subResults.push({ name, size: singleSize, type: "core" });
  }

  const subTime = performance.now() - subStart;
  const subSummary = subResults
    .map((s) => `${s.name} (${s.size} KB)`)
    .join(", ");
  console.log(
    `  Sub-modules ${subTime.toFixed(0).padStart(6)}ms  ${subSummary}`,
  );

  // Adapters moved to separate packages - no longer built here

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
  minifyCss("./src/styles/vlist-extras.css", "./dist/vlist-extras.css");
  const cssTime = performance.now() - cssStart;
  const cssFile = Bun.file("./dist/vlist.css");
  const cssSize = (cssFile.size / 1024).toFixed(1);
  const extrasFile = Bun.file("./dist/vlist-extras.css");
  const extrasSize = (extrasFile.size / 1024).toFixed(1);
  console.log(
    `  CSS         ${cssTime.toFixed(0).padStart(6)}ms  dist/vlist.css (${cssSize} KB) + vlist-extras.css (${extrasSize} KB)`,
  );

  // Size summary
  const gzipBytes = async (path: string): Promise<string> => {
    const raw = await $`gzip -c ${path} | wc -c`.quiet().text();
    return (parseInt(raw.trim(), 10) / 1024).toFixed(1);
  };

  console.log("");
  console.log("  Core:");

  // Show core modules
  for (const sub of subResults.filter((s) => s.type === "core")) {
    let gzipSize;
    if (sub.name === "core-light") {
      gzipSize = await gzipBytes(`dist/${sub.name}.js`);
    } else {
      gzipSize = await gzipBytes(`dist/${sub.name}/index.js`);
    }
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSize} KB gzipped`,
    );
  }

  console.log("");
  console.log("  Builder:");

  // Show builder
  for (const sub of subResults.filter((s) => s.type === "builder")) {
    const gzipSize = await gzipBytes(`dist/${sub.name}/index.js`);
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSize} KB gzipped`,
    );
  }

  console.log("");
  console.log("  Plugins:");

  // Show plugins
  for (const sub of subResults.filter((s) => s.type === "plugin")) {
    const gzipSize = await gzipBytes(`dist/${sub.name}/index.js`);
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSize} KB gzipped`,
    );
  }

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
