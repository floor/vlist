/**
 * vlist — Coverage Threshold Check
 *
 * Runs `bun test --coverage` and verifies that line coverage meets
 * the minimum threshold. Exits with code 1 if any source file falls
 * below the threshold or if the overall average is too low.
 *
 * Usage:
 *   bun run scripts/check-coverage.ts
 *   bun run scripts/check-coverage.ts --threshold 95
 */

const DEFAULT_THRESHOLD = 90;

// ── Parse args ────────────────────────────────────────────────────

const thresholdArg = process.argv.find((a) => a.startsWith("--threshold"));
const threshold = thresholdArg
  ? Number(process.argv[process.argv.indexOf(thresholdArg) + 1])
  : DEFAULT_THRESHOLD;

if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
  console.error(`  ✗ Invalid threshold: ${threshold}`);
  process.exit(1);
}

// ── Run tests with coverage ───────────────────────────────────────

const proc = Bun.spawn(["bun", "test", "--coverage"], {
  stdout: "pipe",
  stderr: "pipe",
  cwd: import.meta.dir + "/..",
});

const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;

// Print test summary only (not individual pass/fail lines)
const lines = (stdout + stderr).split("\n");
for (const line of lines) {
  // Match only the final summary lines:
  //   " 2807 pass"  /  " 0 fail"  /  " 37780 expect() calls"  /  "Ran 2807 tests across 51 files."
  if (/^\s*\d+ (pass|fail)\s*$/.test(line) ||
      line.includes("expect() calls") ||
      line.includes("Ran ") && line.includes(" tests across ")) {
    console.log(line);
  }
}

if (exitCode !== 0) {
  console.error(`\n  ✗ Tests failed (exit code ${exitCode})`);
  process.exit(exitCode);
}

// ── Parse coverage table ──────────────────────────────────────────
//
// Bun coverage output looks like:
//   -------------------|---------|---------|-------------------
//    File              | % Funcs | % Lines | Uncovered Line #s
//   -------------------|---------|---------|-------------------
//    src/builder/api.ts |  100.00 |   99.50 | 42
//   ...

interface CoverageEntry {
  file: string;
  functions: number;
  lines: number;
}

const entries: CoverageEntry[] = [];
const coverageLineRegex =
  /^\s*(.+?\.ts)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/;

for (const line of lines) {
  const match = coverageLineRegex.exec(line);
  if (match) {
    const file = match[1]!.trim();
    const functions = parseFloat(match[2]!);
    const linesPercent = parseFloat(match[3]!);

    // Only check src/ files (skip test files if they leak in)
    if (file.startsWith("src/")) {
      entries.push({ file, functions, lines: linesPercent });
    }
  }
}

if (entries.length === 0) {
  console.error("\n  ✗ No coverage data found in output");
  console.error("    Make sure `bun test --coverage` produces a coverage table");
  process.exit(1);
}

// ── Check thresholds ──────────────────────────────────────────────

const failures: CoverageEntry[] = [];

for (const entry of entries) {
  if (entry.lines < threshold) {
    failures.push(entry);
  }
}

// Overall average
const avgLines =
  entries.reduce((sum, e) => sum + e.lines, 0) / entries.length;
const avgFunctions =
  entries.reduce((sum, e) => sum + e.functions, 0) / entries.length;

// ── Report ────────────────────────────────────────────────────────

console.log("");
console.log(
  `  Coverage: ${avgLines.toFixed(1)}% lines, ${avgFunctions.toFixed(1)}% functions (${entries.length} files)`,
);
console.log(`  Threshold: ${threshold}% lines`);

if (failures.length > 0) {
  console.log("");
  console.log(
    `  ✗ ${failures.length} file(s) below ${threshold}% line coverage:`,
  );
  console.log("");

  // Sort by coverage ascending (worst first)
  failures.sort((a, b) => a.lines - b.lines);

  for (const f of failures) {
    console.log(
      `    ${f.file.padEnd(45)} ${f.lines.toFixed(1)}%`,
    );
  }

  console.log("");
  process.exit(1);
}

if (avgLines < threshold) {
  console.log("");
  console.log(
    `  ✗ Overall average (${avgLines.toFixed(1)}%) below threshold (${threshold}%)`,
  );
  console.log("");
  process.exit(1);
}

console.log(`  ✓ All ${entries.length} source files meet ${threshold}% line coverage`);
console.log("");