/**
 * vlist v2 — Benchmark runner
 *
 * Thin wrapper around vlist.io's CI benchmark runner.
 * Starts the vlist.io dev server if needed, runs benchmarks via Puppeteer,
 * and optionally compares against baseline or stores results to SQLite.
 *
 * Usage:
 *   bun run bench                          # default: all suites @ 10K + 100K
 *   bun run bench --quick                  # smoke (render + scrollto) @ 10K
 *   bun run bench --full                   # all suites @ 10K + 100K + 1M
 *   bun run bench --compare                # run + compare against baseline
 *   bun run bench --store                  # run + store to SQLite
 *   bun run bench --suite=render           # single suite
 *   bun run bench --items=100000           # custom item count
 *   bun run bench --dry-run                # validate environment only
 */

import { resolve } from "path";
import { existsSync } from "fs";

const root = resolve(import.meta.dir, "..");
const vlistIoDir = resolve(root, process.env.VLIST_IO_DIR ?? "../vlist.io");

const SMOKE_SUITES = "render-vanilla,scrollto-vanilla";
const DEFAULT_SUITES = "render-vanilla,scroll-vanilla,scrollto-vanilla,memory-vanilla";
const QUICK_ITEMS = "10000";
const DEFAULT_ITEMS = "10000,100000";
const FULL_ITEMS = "10000,100000,1000000";
const SERVER_PORT = 3338;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 300;

interface Args {
  quick: boolean;
  full: boolean;
  compare: boolean;
  store: boolean;
  dryRun: boolean;
  suite: string | null;
  items: string | null;
}

function parseArgs(): Args {
  const flags: Args = {
    quick: false,
    full: false,
    compare: false,
    store: false,
    dryRun: false,
    suite: null,
    items: null,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--quick") flags.quick = true;
    else if (arg === "--full") flags.full = true;
    else if (arg === "--compare") flags.compare = true;
    else if (arg === "--store") flags.store = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--suite=")) flags.suite = arg.slice(8);
    else if (arg.startsWith("--items=")) flags.items = arg.slice(8);
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }

  return flags;
}

function preflight(): void {
  if (!existsSync(vlistIoDir)) {
    console.error(`vlist.io not found at ${vlistIoDir}`);
    console.error(`Set VLIST_IO_DIR to the correct path.`);
    process.exit(1);
  }

  if (!existsSync(resolve(vlistIoDir, "node_modules"))) {
    console.error(`vlist.io dependencies not installed. Run: cd ${vlistIoDir} && bun install`);
    process.exit(1);
  }

  const runner = resolve(vlistIoDir, "benchmarks/ci/runner.mjs");
  if (!existsSync(runner)) {
    console.error(`CI runner not found at ${runner}`);
    process.exit(1);
  }

  const baseline = resolve(vlistIoDir, "benchmarks/baselines/main.json");
  if (!existsSync(baseline)) {
    console.warn(`Warning: no baseline found at ${baseline} — --compare will show absolute values only`);
  }
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(SERVER_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer(): Promise<Bun.Subprocess> {
  console.log(`Starting vlist.io server on port ${SERVER_PORT}...`);
  const proc = Bun.spawn(["bun", "run", "start"], {
    cwd: vlistIoDir,
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, PORT: String(SERVER_PORT) },
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServerRunning()) {
      console.log(`Server ready at ${SERVER_URL}`);
      return proc;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  proc.kill();
  console.error(`Server failed to start within ${STARTUP_TIMEOUT_MS / 1000}s`);
  process.exit(1);
}

async function run(cmd: string[], cwd: string, label: string): Promise<void> {
  console.log(`\n→ ${label}`);
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`${label} failed with exit code ${code}`);
    process.exit(code);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const suites = args.suite ?? (args.quick ? SMOKE_SUITES : DEFAULT_SUITES);
  const items = args.items ?? (args.quick ? QUICK_ITEMS : args.full ? FULL_ITEMS : DEFAULT_ITEMS);

  const mode = args.quick ? "quick" : args.full ? "full" : "default";

  console.log("═══════════════════════════════════════════════");
  console.log("  vlist benchmark");
  console.log("═══════════════════════════════════════════════");
  console.log(`  mode:    ${mode}`);
  console.log(`  suites:  ${suites}`);
  console.log(`  items:   ${items.split(",").map((n: string) => Number(n).toLocaleString()).join(", ")}`);
  console.log(`  compare: ${args.compare}`);
  console.log(`  store:   ${args.store}`);
  console.log(`  vlist.io: ${vlistIoDir}`);
  console.log();

  preflight();

  if (args.dryRun) {
    console.log("Dry run — environment validated. Ready to benchmark.");
    return;
  }

  let serverProc: Bun.Subprocess | null = null;
  const serverWasRunning = await isServerRunning();

  if (!serverWasRunning) {
    serverProc = await startServer();
  } else {
    console.log(`Using existing server at ${SERVER_URL}`);
  }

  try {
    await run(
      [
        "bun", "run", "bench:ci", "--",
        "--skip-build",
        `--url=${SERVER_URL}`,
        `--item-counts=${items}`,
        `--suites=${suites}`,
      ],
      vlistIoDir,
      "Running benchmarks",
    );

    if (args.compare) {
      const baseline = resolve(vlistIoDir, "benchmarks/baselines/main.json");
      const compareArgs = ["bun", "run", "bench:compare"];
      if (existsSync(baseline)) {
        compareArgs.push("--", `--baseline=${baseline}`);
      }
      await run(compareArgs, vlistIoDir, "Comparing against baseline");
    }

    if (args.store) {
      await run(["bun", "run", "bench:store"], vlistIoDir, "Storing results to SQLite");
    }

    const summaryPath = resolve(vlistIoDir, "benchmarks/results/summary.md");
    if (existsSync(summaryPath)) {
      console.log("\n" + await Bun.file(summaryPath).text());
    }

    const comparisonPath = resolve(vlistIoDir, "benchmarks/results/comparison.md");
    if (args.compare && existsSync(comparisonPath)) {
      console.log(await Bun.file(comparisonPath).text());
    }
  } finally {
    if (serverProc) {
      console.log("Stopping server...");
      serverProc.kill();
    }
  }
}

main();
