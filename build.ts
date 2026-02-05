// build.ts - Build vlist library
import { $ } from "bun";

const isDev = process.argv.includes("--watch");
const withTypes = process.argv.includes("--types");

async function build() {
  const totalStart = performance.now();
  console.log("Building vlist...\n");

  // Bundle TypeScript
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
  console.log(`  JS          ${bundleTime.toFixed(0).padStart(6)}ms  dist/index.js (${jsSize} KB)`);

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
    console.log(`  Types       ${dtsTime.toFixed(0).padStart(6)}ms  dist/*.d.ts`);
  }

  // Copy CSS
  const cssStart = performance.now();
  await $`cp ./src/styles/vlist.css ./dist/vlist.css`.quiet();
  const cssTime = performance.now() - cssStart;
  const cssFile = Bun.file("./dist/vlist.css");
  const cssSize = (cssFile.size / 1024).toFixed(1);
  console.log(`  CSS         ${cssTime.toFixed(0).padStart(6)}ms  dist/vlist.css (${cssSize} KB)`);

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
