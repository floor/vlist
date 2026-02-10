// build.ts - Build vlist library
import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";

const isDev = process.argv.includes("--watch");
const withTypes = process.argv.includes("--types");

async function build() {
  const totalStart = performance.now();
  console.log("Building vlist...\n");

  // Build main bundle (full library)
  const bundleStart = performance.now();
  const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    outdir: "./dist",
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
  });

  if (!result.success) {
    console.error("\nBuild failed:\n");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  const bundleTime = performance.now() - bundleStart;
  const jsFile = Bun.file("./dist/index.js");
  const jsSize = (jsFile.size / 1024).toFixed(1);
  console.log(
    `  JS          ${bundleTime.toFixed(0).padStart(6)}ms  dist/index.js (${jsSize} KB)`,
  );

  // Build sub-module bundles for tree-shaking
  const subStart = performance.now();

  const subModules = [
    { entry: "./src/core.ts", out: "core" },
    { entry: "./src/data/index.ts", out: "data" },
    { entry: "./src/compression.ts", out: "compression" },
    { entry: "./src/selection/index.ts", out: "selection" },
    { entry: "./src/scroll/index.ts", out: "scroll" },
    { entry: "./src/groups/index.ts", out: "groups" },
    { entry: "./src/grid/index.ts", out: "grid" },
  ];

  // Framework adapters — built with externals so framework imports
  // are left as bare specifiers (resolved by the consumer's bundler).
  const adapterModules = [
    {
      entry: "./src/adapters/react.ts",
      out: "react",
      externals: ["react", "vlist"],
    },
    { entry: "./src/adapters/vue.ts", out: "vue", externals: ["vue", "vlist"] },
    { entry: "./src/adapters/svelte.ts", out: "svelte", externals: ["vlist"] },
  ];

  const subResults: { name: string; size: string }[] = [];

  for (const sub of subModules) {
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
    subResults.push({ name: sub.out, size: subSize });
  }

  const subTime = performance.now() - subStart;
  const subSummary = subResults
    .map((s) => `${s.name} (${s.size} KB)`)
    .join(", ");
  console.log(
    `  Sub-modules ${subTime.toFixed(0).padStart(6)}ms  ${subSummary}`,
  );

  // Build framework adapters (with external framework imports)
  const adapterStart = performance.now();
  const adapterResults: { name: string; size: string }[] = [];

  for (const adapter of adapterModules) {
    const adapterResult = await Bun.build({
      entrypoints: [adapter.entry],
      outdir: `./dist/${adapter.out}`,
      format: "esm",
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "none",
      naming: "index.js",
      external: adapter.externals,
    });

    if (!adapterResult.success) {
      console.error(`\nAdapter build failed (${adapter.out}):\n`);
      for (const log of adapterResult.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const adapterFile = Bun.file(`./dist/${adapter.out}/index.js`);
    const adapterSize = (adapterFile.size / 1024).toFixed(1);
    adapterResults.push({ name: adapter.out, size: adapterSize });
  }

  const adapterTime = performance.now() - adapterStart;
  const adapterSummary = adapterResults
    .map((a) => `${a.name} (${a.size} KB)`)
    .join(", ");
  console.log(
    `  Adapters    ${adapterTime.toFixed(0).padStart(6)}ms  ${adapterSummary}`,
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
  const gzipSize = await gzipBytes("dist/index.js");
  console.log(`  Full bundle: ${jsSize} KB minified, ${gzipSize} KB gzipped`);

  for (const sub of subResults) {
    const gzipSubSize = await gzipBytes(`dist/${sub.name}/index.js`);
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSubSize} KB gzipped`,
    );
  }

  console.log("");
  console.log("  Adapters:");
  for (const adapter of adapterResults) {
    const gzipAdapterSize = await gzipBytes(`dist/${adapter.name}/index.js`);
    console.log(
      `  ${adapter.name.padEnd(13)} ${adapter.size} KB minified, ${gzipAdapterSize} KB gzipped`,
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
