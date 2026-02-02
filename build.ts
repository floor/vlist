import { $ } from "bun";

const isDev = process.argv.includes("--watch");

async function build() {
  console.log("🔨 Building vlist...");

  // Clean dist
  await $`rm -rf dist`.quiet();
  await $`mkdir -p dist`.quiet();

  // Build TypeScript
  const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    outdir: "./dist",
    format: "esm",
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
  });

  if (!result.success) {
    console.error("❌ Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Generate declarations
  await $`bunx tsc -p tsconfig.build.json`.quiet();

  // Copy CSS (no processing needed - it's plain CSS with custom properties)
  await $`cp ./src/styles/vlist.css ./dist/vlist.css`.quiet();

  console.log("✅ Build complete!");
}

if (isDev) {
  console.log("👀 Watching for changes...");

  // Watch src directory
  const { watch } = await import("fs");
  watch("./src", { recursive: true }, async (_event, filename) => {
    if (filename && !filename.includes("node_modules")) {
      console.log(`\n📝 ${filename} changed`);
      await build();
    }
  });

  // Initial build
  await build();
} else {
  await build();
}
