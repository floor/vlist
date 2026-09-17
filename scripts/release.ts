#!/usr/bin/env bun
/**
 * vlist release script
 *
 * Usage: bun run release [patch|minor|major|<version>] [--from next|staging]
 *
 * What it does:
 *   1. Resolves the source branch from the version being released
 *      (`next` for 3.x, `staging` for 2.x) and verifies a clean working tree
 *   2. Bumps the version in package.json (patch by default; a prerelease
 *      graduates to its stable version rather than incrementing past it)
 *   3. Updates the version badge in README.md
 *   4. Updates the CHANGELOG.md header stats (commit count, days, date range)
 *   5. Commits `chore(release): vX.Y.Z` and pushes the source branch
 *   6. Creates a PR <source> → main and waits for it to be merged
 *   7. Pulls main and pushes the version tag — triggering npm publish
 */

import { execSync } from "node:child_process";

// =============================================================================
// Types
// =============================================================================

/** SemVer increment, matching `npm version`. */
export type BumpType = "patch" | "minor" | "major";

/**
 * Integration branch that may open a release PR against `main`.
 * `next` is the 3.x line; `staging` is frozen 2.x maintenance.
 */
export type ReleaseBranch = "next" | "staging";

export type ReleaseArgs =
  | { readonly kind: "bump"; readonly bumpType: BumpType; readonly from: ReleaseBranch | null }
  | { readonly kind: "exact"; readonly version: string; readonly from: ReleaseBranch | null };

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

export const BUMP_TYPES: readonly BumpType[] = ["patch", "minor", "major"];
export const RELEASE_BRANCHES: readonly ReleaseBranch[] = ["next", "staging"];

export const USAGE = "Usage: bun run release [patch|minor|major|<version>] [--from next|staging]";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

// =============================================================================
// Helpers
// =============================================================================

const run = (cmd: string, opts: { silent?: boolean } = {}): string => {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: opts.silent ? ["pipe", "pipe", "pipe"] : ["inherit", "pipe", "inherit"],
    }).trim();
  } catch (err: unknown) {
    throw new Error(execErrorMessage(err));
  }
};

/** Prefer stderr from a failed command; fall back to the Error message. */
export const execErrorMessage = (err: unknown): string => {
  if (typeof err === "object" && err !== null && "stderr" in err) {
    const stderr = (err as { stderr: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
    if (stderr instanceof Uint8Array) {
      const text = new TextDecoder().decode(stderr).trim();
      if (text) return text;
    }
  }
  return err instanceof Error ? err.message : String(err);
};

const log = (msg: string): void => console.log(`\n${msg}`);
const step = (n: number, msg: string): void => console.log(`\n[${n}] ${msg}`);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isBumpType = (value: string): value is BumpType =>
  (BUMP_TYPES as readonly string[]).includes(value);

const isReleaseBranch = (value: string): value is ReleaseBranch =>
  (RELEASE_BRANCHES as readonly string[]).includes(value);

// =============================================================================
// Version
// =============================================================================

/** Parse a semver string, including an optional prerelease suffix. */
export const parseVersion = (version: string): ParsedVersion => {
  const match = VERSION_RE.exec(version);
  if (!match) {
    throw new Error(`Invalid version '${version}'`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
};

const formatStable = (v: ParsedVersion): string => `${v.major}.${v.minor}.${v.patch}`;

/**
 * Increment a stable version, or graduate a prerelease to the version it
 * already names. `3.0.0-next.2` + any bump is `3.0.0`, not `4.0.0` — the
 * major bump happened when the prerelease line started, and cutting the
 * stable release means dropping the suffix.
 */
export const bumpVersion = (version: string, part: BumpType): string => {
  const v = parseVersion(version);
  if (v.prerelease !== null) return formatStable(v);
  if (part === "major") return `${v.major + 1}.0.0`;
  if (part === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
};

/**
 * Source branch for a stable version: 3.x and above ship from `next`,
 * 2.x from `staging`.
 */
export const sourceBranchFor = (version: string): ReleaseBranch =>
  parseVersion(version).major >= 3 ? "next" : "staging";

/**
 * Resolve the release source branch. `--from` is an explicit confirmation
 * of the derived branch, not an override — releasing 3.x from `staging`
 * would publish the frozen 2.x line under a 3.x version.
 */
export const resolveSourceBranch = (
  version: string,
  from: ReleaseBranch | null,
): ReleaseBranch => {
  const derived = sourceBranchFor(version);
  if (from !== null && from !== derived) {
    throw new Error(`v${version} releases from '${derived}', not '${from}'`);
  }
  return derived;
};

/** Stable cuts only. Prereleases are tagged by hand — see RELEASING.md. */
export const assertStableRelease = (version: string): void => {
  if (parseVersion(version).prerelease !== null) {
    throw new Error("bun run release cuts a stable version; prereleases are tagged by hand");
  }
};

/** `git branch --show-current` is empty in detached HEAD. */
export const currentBranchLabel = (branch: string): string => branch || "detached HEAD";

export const assertCurrentBranch = (
  current: string,
  source: ReleaseBranch,
  version: string,
): void => {
  if (current !== source) {
    throw new Error(
      `Must be on ${source} to release v${version} (currently on '${currentBranchLabel(current)}')`,
    );
  }
};

export const resolveNewVersion = (current: string, args: ReleaseArgs): string => {
  const next = args.kind === "exact" ? args.version : bumpVersion(current, args.bumpType);
  assertStableRelease(next);
  return next;
};

// =============================================================================
// Args
// =============================================================================

const takeFromValue = (value: string | undefined): ReleaseBranch => {
  if (value === undefined || !isReleaseBranch(value)) {
    throw new Error(USAGE);
  }
  return value;
};

/** Parse `process.argv` after the script name. */
export const parseArgs = (argv: readonly string[]): ReleaseArgs => {
  let bumpType: BumpType | null = null;
  let exactVersion: string | null = null;
  let from: ReleaseBranch | null = null;
  let positional = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--from") {
      from = takeFromValue(argv[++i]);
      continue;
    }
    if (arg.startsWith("--from=")) {
      from = takeFromValue(arg.slice("--from=".length));
      continue;
    }
    if (positional) {
      throw new Error(USAGE);
    }
    if (isBumpType(arg)) {
      bumpType = arg;
      positional = true;
      continue;
    }
    if (VERSION_RE.test(arg)) {
      exactVersion = arg;
      positional = true;
      continue;
    }
    throw new Error(USAGE);
  }

  if (exactVersion !== null) {
    return { kind: "exact", version: exactVersion, from };
  }
  return { kind: "bump", bumpType: bumpType ?? "patch", from };
};

// =============================================================================
// File rewrites
// =============================================================================

const README_VERSION_RE =
  /\*\*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\*\*(?: \(prerelease on the npm `next` tag\))?/;

/** Replace the leading `**vX.Y.Z**` marker, dropping a leftover prerelease note. */
export const updateReadmeVersion = (readme: string, newVersion: string): string => {
  const next = readme.replace(README_VERSION_RE, `**v${newVersion}**`);
  if (next === readme) {
    throw new Error("README.md version marker not found");
  }
  return next;
};

export const updateChangelogStats = (changelog: string, statsLine: string): string =>
  changelog.replace(/^\d+ commits · \d+ days · .+$/m, statsLine);

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  let args: ReleaseArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── Guard: must be on the source branch for this version ──────────────────
  step(1, "Checking branch and working tree...");

  const pkg = JSON.parse(await Bun.file("package.json").text()) as { version: string };
  const oldVersion: string = pkg.version;
  let newVersion: string;
  let sourceBranch: ReleaseBranch;
  try {
    newVersion = resolveNewVersion(oldVersion, args);
    sourceBranch = resolveSourceBranch(newVersion, args.from);
    assertCurrentBranch(run("git branch --show-current", { silent: true }), sourceBranch, newVersion);
  } catch (err: unknown) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const status = run("git status --porcelain", { silent: true });
  if (status) {
    console.error(`  ✗ Working tree is not clean — commit or stash changes first`);
    process.exit(1);
  }

  run(`git pull origin ${sourceBranch}`, { silent: true });
  console.log(`  ✓ On ${sourceBranch}, working tree clean, pulled latest`);

  // ── Bump version ──────────────────────────────────────────────────────────
  step(2, "Bumping version...");

  pkg.version = newVersion;
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const graduated = parseVersion(oldVersion).prerelease !== null;
  console.log(
    `  ✓ package.json: ${oldVersion} → ${newVersion}${graduated ? " (prerelease graduation)" : ""}`,
  );

  // ── Update README version badge ────────────────────────────────────────────
  step(3, "Updating README.md...");

  const readme = await Bun.file("README.md").text();
  await Bun.write("README.md", updateReadmeVersion(readme, newVersion));
  console.log(`  ✓ README.md version badge updated`);

  // ── Update CHANGELOG.md header stats ─────────────────────────────────────
  step(4, "Updating CHANGELOG.md stats...");

  const commitCount = parseInt(run("git rev-list --count HEAD", { silent: true }), 10);
  const firstDate = new Date(run("git log --format=%aI --reverse | head -1", { silent: true }));
  const today = new Date();
  const days = Math.round((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

  // Header format: "577 commits · 83 days · Feb 2 – Apr 27, 2026"
  const firstShort = firstDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const todayFull = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const statsLine = `${commitCount} commits · ${days} days · ${firstShort} – ${todayFull}`;

  const changelog = await Bun.file("CHANGELOG.md").text();
  await Bun.write("CHANGELOG.md", updateChangelogStats(changelog, statsLine));
  console.log(`  ✓ CHANGELOG.md: ${statsLine}`);

  // ── Commit and push the source branch ─────────────────────────────────────
  step(5, `Committing chore(release): v${newVersion}...`);

  run(`git add package.json README.md CHANGELOG.md`);
  run(`git commit -m "chore(release): v${newVersion}"`);
  run(`git push origin ${sourceBranch}`);
  console.log(`  ✓ Pushed to ${sourceBranch}`);

  // ── Create PR source → main ───────────────────────────────────────────────
  step(6, `Creating PR ${sourceBranch} → main...`);

  const prUrl = run(
    `gh pr create --base main --head ${sourceBranch} --title "chore(release): v${newVersion}" --body "Version bump to v${newVersion}."`,
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
  run(`git checkout ${sourceBranch}`, { silent: true });

  console.log(`  ✓ Tag v${newVersion} pushed — publish workflow triggered`);

  log(`Done! v${newVersion} is publishing to npm.`);
  log(`Monitor: https://github.com/floor/vlist/actions`);
};

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
