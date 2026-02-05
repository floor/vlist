// build.ts - Auto-discover and build all sandbox examples in parallel
import { readdirSync, existsSync, watch } from "fs";
import { join } from "path";

const isWatch = process.argv.includes("--watch");

const SANDBOX_DIR = "./sandbox";
const BUILD_OPTIONS = {
  minify: true,
  format: "esm" as const,
  target: "browser" as const,
  sourcemap: "none" as const,
};

interface BuildResult {
  name: string;
  success: boolean;
  time: number;
  error?: string;
}

async function discoverExamples(): Promise<string[]> {
  const entries = readdirSync(SANDBOX_DIR, { withFileTypes: true });
  const examples: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const scriptPath = join(SANDBOX_DIR, entry.name, "script.js");
      if (existsSync(scriptPath)) {
        examples.push(entry.name);
      }
    }
  }

  return examples.sort();
}

async function buildExample(name: string): Promise<BuildResult> {
  const start = performance.now();
  const entrypoint = join(SANDBOX_DIR, name, "script.js");
  const outdir = join(SANDBOX_DIR, name, "dist");

  try {
    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir,
      ...BUILD_OPTIONS,
    });

    if (!result.success) {
      const errors = result.logs.map((log) => log.message).join("\n");
      return {
        name,
        success: false,
        time: performance.now() - start,
        error: errors,
      };
    }

    return {
      name,
      success: true,
      time: performance.now() - start,
    };
  } catch (err) {
    return {
      name,
      success: false,
      time: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const totalStart = performance.now();

  console.log("🔨 Building sandbox...\n");

  // Discover all examples
  const examples = await discoverExamples();

  if (examples.length === 0) {
    console.log("⚠️  No examples found in", SANDBOX_DIR);
    process.exit(0);
  }

  console.log(`📦 Found ${examples.length} examples: ${examples.join(", ")}\n`);

  // Build all examples in parallel
  const results = await Promise.all(examples.map(buildExample));

  // Report results
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  for (const result of results) {
    const icon = result.success ? "✅" : "❌";
    const time = result.time.toFixed(0);
    console.log(`${icon} ${result.name.padEnd(20)} ${time}ms`);
    if (result.error) {
      console.log(`   └─ ${result.error}`);
    }
  }

  const totalTime = (performance.now() - totalStart).toFixed(0);

  console.log("\n" + "─".repeat(40));
  console.log(
    `✨ Built ${successful.length}/${results.length} examples in ${totalTime}ms`,
  );

  if (failed.length > 0) {
    console.log(`\n⚠️  ${failed.length} example(s) failed to build`);
    process.exit(1);
  }
}

async function watchMode() {
  console.log("👀 Watching sandbox for changes...\n");

  // Initial build
  await main();

  // Watch each sandbox directory
  const examples = await discoverExamples();
  for (const name of examples) {
    const dir = join(SANDBOX_DIR, name);
    watch(dir, { recursive: true }, async (event, filename) => {
      if (filename && !filename.includes("dist") && !filename.includes("node_modules")) {
        console.log(`\n📝 ${name}/${filename} changed`);
        const result = await buildExample(name);
        const icon = result.success ? "✅" : "❌";
        console.log(`${icon} Rebuilt ${name} in ${result.time.toFixed(0)}ms`);
        if (result.error) {
          console.log(`   └─ ${result.error}`);
        }
      }
    });
  }
}

if (isWatch) {
  watchMode().catch((err) => {
    console.error("❌ Watch failed:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("❌ Build failed:", err);
    process.exit(1);
  });
}
