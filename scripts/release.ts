#!/usr/bin/env bun
/**
 * vlist release script
 *
 * Usage: bun run release [patch|minor|major]
 *
 * What it does:
 *   1. Verifies you're on staging with a clean working tree
 *   2. Bumps the version in package.json (patch by default)
 *   3. Updates the version badge in README.md
 *   4. Updates the changelog.txt header stats (commit count, days, date range)
 *   5. Commits `chore(release): vX.Y.Z` and pushes to staging
 *   6. Creates a PR staging → main and waits for it to be merged
 *   7. Pulls main and pushes the version tag — triggering npm publish
 */

import { execSync } from "child_process";

// =============================================================================
// Helpers
// =============================================================================

const run = (cmd: string, opts: { silent?: boolean } = {}): string => {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: opts.silent ? ["pipe", "pipe", "pipe"] : ["inherit", "pipe", "inherit"],
    }).trim();
  } catch (err: any) {
    throw new Error(err.stderr?.trim() || err.message);
  }
};

const log = (msg: string) => console.log(`\n${msg}`);
const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =============================================================================
// Version bump
// =============================================================================

const bumpVersion = (version: string, part: "patch" | "minor" | "major"): string => {
  const [maj, min, pat] = version.split(".").map(Number);
  if (part === "major") return `${maj! + 1}.0.0`;
  if (part === "minor") return `${maj}.${min! + 1}.0`;
  return `${maj}.${min}.${pat! + 1}`;
};

// =============================================================================
// Main
// =============================================================================

const main = async () => {
  const bumpType = (process.argv[2] ?? "patch") as "patch" | "minor" | "major";
  if (!["patch", "minor", "major"].includes(bumpType)) {
    console.error(`Usage: bun run release [patch|minor|major]`);
    process.exit(1);
  }

  // ── Guard: must be on staging ──────────────────────────────────────────────
  step(1, "Checking branch and working tree...");

  const branch = run("git branch --show-current", { silent: true });
  if (branch !== "staging") {
    console.error(`  ✗ Must be on staging (currently on '${branch}')`);
    process.exit(1);
  }

  const status = run("git status --porcelain", { silent: true });
  if (status) {
    console.error(`  ✗ Working tree is not clean — commit or stash changes first`);
    process.exit(1);
  }

  run("git pull origin staging", { silent: true });
  console.log("  ✓ On staging, working tree clean, pulled latest");

  // ── Bump version ──────────────────────────────────────────────────────────
  step(2, "Bumping version...");

  const pkg = JSON.parse(await Bun.file("package.json").text());
  const oldVersion: string = pkg.version;
  const newVersion = bumpVersion(oldVersion, bumpType);
  pkg.version = newVersion;

  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ✓ package.json: ${oldVersion} → ${newVersion}`);

  // ── Update README version badge ────────────────────────────────────────────
  step(3, "Updating README.md...");

  let readme = await Bun.file("README.md").text();
  readme = readme.replace(/\*\*v[\d.]+\*\* — \[Changelog\]/, `**v${newVersion}** — [Changelog]`);
  await Bun.write("README.md", readme);
  console.log(`  ✓ README.md version badge updated`);

  // ── Update changelog.txt header stats ─────────────────────────────────────
  step(4, "Updating changelog.txt stats...");

  const commitCount = parseInt(run("git rev-list --count HEAD", { silent: true }));
  const firstDate = new Date(run("git log --format=%aI --reverse | head -1", { silent: true }));
  const today = new Date();
  const days = Math.round((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

  const firstDateStr = firstDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const todayStr = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Header format: "577 commits · 83 days · Feb 2 – Apr 27, 2026"
  const firstShort = firstDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const todayFull = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const statsLine = `${commitCount} commits · ${days} days · ${firstShort} – ${todayFull}`;

  let changelog = await Bun.file("changelog.txt").text();
  changelog = changelog.replace(/^\d+ commits · \d+ days · .+$/m, statsLine);
  await Bun.write("changelog.txt", changelog);
  console.log(`  ✓ changelog.txt: ${statsLine}`);

  // ── Commit and push to staging ─────────────────────────────────────────────
  step(5, `Committing chore(release): v${newVersion}...`);

  run(`git add package.json README.md changelog.txt`);
  run(`git commit -m "chore(release): v${newVersion}"`);
  run(`git push origin staging`);
  console.log(`  ✓ Pushed to staging`);

  // ── Create PR staging → main ───────────────────────────────────────────────
  step(6, "Creating PR staging → main...");

  const prUrl = run(
    `gh pr create --base main --head staging --title "chore(release): v${newVersion}" --body "Version bump to v${newVersion}."`,
    { silent: true },
  );
  const prNumber = prUrl.split("/").pop();
  console.log(`  ✓ PR #${prNumber} created: ${prUrl}`);

  // ── Wait for PR to be merged ───────────────────────────────────────────────
  log(`Waiting for PR #${prNumber} to be merged (CI must pass)...`);

  let merged = false;
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    const state = run(`gh pr view ${prNumber} --json state,mergedAt --jq '.state'`, { silent: true });
    if (state === "MERGED") {
      merged = true;
      break;
    }
    process.stdout.write(".");
  }

  if (!merged) {
    console.error(`\n  ✗ Timed out waiting for PR to merge. Merge it manually, then run:\n    git checkout main && git pull && git tag v${newVersion} && git push origin v${newVersion}`);
    process.exit(1);
  }

  console.log(`\n  ✓ PR #${prNumber} merged`);

  // ── Pull main and push tag ─────────────────────────────────────────────────
  step(7, `Tagging v${newVersion} and pushing...`);

  run(`git checkout main`, { silent: true });
  run(`git pull origin main`, { silent: true });
  run(`git tag v${newVersion}`);
  run(`git push origin v${newVersion}`);
  run(`git checkout staging`, { silent: true });

  console.log(`  ✓ Tag v${newVersion} pushed — publish workflow triggered`);

  log(`Done! v${newVersion} is publishing to npm.`);
  log(`Monitor: https://github.com/floor/vlist/actions`);
};

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
