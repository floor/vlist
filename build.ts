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
  const gzipSize = async (path: string): Promise<string> => {
    const content = await Bun.file(path).arrayBuffer();
    const compressed = Bun.gzipSync(new Uint8Array(content));
    return (compressed.byteLength / 1024).toFixed(1);
  };

  const gzipped = await gzipSize("./dist/index.js");

  console.log("");
  console.log(`  index.js    ${bundleSize} KB minified, ${gzipped} KB gzipped`);

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
