// build.ts - Auto-discover and build all sandbox examples in parallel
import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  watch,
} from "fs";
import { join } from "path";

const isWatch = process.argv.includes("--watch");

const SANDBOX_DIR = "./sandbox";
const BUILD_OPTIONS = {
  minify: true,
  format: "esm" as const,
  target: "browser" as const,
  sourcemap: "none" as const,
};

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "") // strip comments
    .replace(/\s*([{}:;,>~+])\s*/g, "$1") // collapse around symbols
    .replace(/;\}/g, "}") // drop trailing semicolons
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function gzipSize(path: string): number {
  const raw = readFileSync(path);
  return Bun.gzipSync(new Uint8Array(raw)).byteLength;
}

interface SizeInfo {
  jsMin: number;
  jsGzip: number;
  css: number;
}

interface BuildResult {
  name: string;
  success: boolean;
  time: number;
  error?: string;
  size?: SizeInfo;
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

    // Minify CSS if styles.css exists
    const cssPath = join(SANDBOX_DIR, name, "styles.css");
    let cssSize = 0;
    if (existsSync(cssPath)) {
      const raw = readFileSync(cssPath, "utf-8");
      const minified = minifyCss(raw);
      writeFileSync(join(outdir, "styles.css"), minified);
      cssSize = Buffer.byteLength(minified, "utf-8");
    }

    // Measure JS bundle size
    const jsPath = join(outdir, "script.js");
    const jsMin = Bun.file(jsPath).size;
    const jsGzip = gzipSize(jsPath);

    return {
      name,
      success: true,
      time: performance.now() - start,
      size: { jsMin, jsGzip, css: cssSize },
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

function printResult(result: BuildResult): void {
  const icon = result.success ? "✅" : "❌";
  const time = `${result.time.toFixed(0)}ms`;

  if (result.success && result.size) {
    const { jsMin, jsGzip, css } = result.size;
    const sizeStr = `${formatKB(jsMin)} KB → ${formatKB(jsGzip)} KB gzip`;
    const cssStr = css > 0 ? `  css ${formatKB(css)} KB` : "";
    console.log(
      `${icon} ${result.name.padEnd(20)} ${time.padStart(5)}   ${sizeStr}${cssStr}`,
    );
  } else {
    console.log(`${icon} ${result.name.padEnd(20)} ${time.padStart(5)}`);
    if (result.error) {
      console.log(`   └─ ${result.error}`);
    }
  }
}

function printSizeTable(results: BuildResult[]): void {
  const successful = results.filter((r) => r.success && r.size);
  if (successful.length === 0) return;

  console.log("");
  console.log(
    `${"  Example".padEnd(24)} ${"JS min".padStart(9)} ${"JS gzip".padStart(9)} ${"CSS".padStart(9)} ${"Total".padStart(9)}`,
  );
  console.log(`  ${"─".repeat(58)}`);

  let totalJsMin = 0;
  let totalJsGzip = 0;
  let totalCss = 0;

  for (const r of successful) {
    const s = r.size!;
    const total = s.jsGzip + s.css;
    totalJsMin += s.jsMin;
    totalJsGzip += s.jsGzip;
    totalCss += s.css;

    console.log(
      `  ${r.name.padEnd(22)} ${(formatKB(s.jsMin) + " KB").padStart(9)} ${(formatKB(s.jsGzip) + " KB").padStart(9)} ${s.css > 0 ? (formatKB(s.css) + " KB").padStart(9) : "—".padStart(9)} ${(formatKB(total) + " KB").padStart(9)}`,
    );
  }

  const grandTotal = totalJsGzip + totalCss;
  console.log(`  ${"─".repeat(58)}`);
  console.log(
    `  ${"Total".padEnd(22)} ${(formatKB(totalJsMin) + " KB").padStart(9)} ${(formatKB(totalJsGzip) + " KB").padStart(9)} ${(formatKB(totalCss) + " KB").padStart(9)} ${(formatKB(grandTotal) + " KB").padStart(9)}`,
  );
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
    printResult(result);
  }

  // Size summary table
  printSizeTable(results);

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
      if (
        filename &&
        !filename.includes("dist") &&
        !filename.includes("node_modules")
      ) {
        console.log(`\n📝 ${name}/${filename} changed`);
        const result = await buildExample(name);
        printResult(result);
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
