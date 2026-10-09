#!/usr/bin/env bun
/**
 * vlist release script
 *
 * Usage: bun run release [patch|minor|major|<version>] [--from next|staging] [--dry-run]
 *
 * What it does:
 *   1. Resolves the source branch from the version being released
 *      (`next` for 3.x, `staging` for 2.x) and verifies a clean working tree
 *   2. Creates a release branch `chore/release-X.Y.Z` cut from the source branch
 *   3. Bumps the version in package.json (patch by default). A prerelease is
 *      never bumped: its stable release is named explicitly, so a bare
 *      `bun run release` on `next` cannot cut 3.0.0 by accident
 *   4. Updates the version badge in README.md
 *   5. Updates the CHANGELOG.md header stats (commit count, days, date range)
 *   6. Commits `chore(release): vX.Y.Z` and pushes the release branch (never source directly)
 *   7. Creates a PR chore/release-X.Y.Z → <source> and waits for it to merge
 *   8. Creates a PR <source> → main and waits for it to be merged
 *   9. Pulls main and pushes the version tag — triggering npm publish
 */

import { execSync } from "node:child_process";
import { nextTagCommand } from "./check-dist-tags";

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
  | { readonly kind: "bump"; readonly bumpType: BumpType; readonly from: ReleaseBranch | null; readonly dryRun?: boolean | undefined }
  | { readonly kind: "exact"; readonly version: string; readonly from: ReleaseBranch | null; readonly dryRun?: boolean | undefined };

export type ReleaseState =
  | "create-source-pr"
  | "await-source-pr"
  | "create-main-pr"
  | "await-main-pr"
  | "tag-release"
  | "already-tagged";

export interface ReleaseContext {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly isTagPresent: boolean;
  readonly sourcePr?: { readonly number: number; readonly state: "OPEN" | "MERGED" | "CLOSED" } | null | undefined;
  readonly mainPr?: { readonly number: number; readonly state: "OPEN" | "MERGED" | "CLOSED" } | null | undefined;
}

export interface PlanOptions {
  readonly targetVersion: string;
  readonly sourceBranch: ReleaseBranch;
  readonly state: ReleaseState;
  readonly sourcePrNumber?: number | undefined;
  readonly mainPrNumber?: number | undefined;
}

export interface ReleaseStep {
  readonly description: string;
  readonly command?: string;
}

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

export const BUMP_TYPES: readonly BumpType[] = ["patch", "minor", "major"];
export const RELEASE_BRANCHES: readonly ReleaseBranch[] = ["next", "staging"];

export const USAGE = "Usage: bun run release [patch|minor|major|<version>] [--from next|staging] [--dry-run]";

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
 * Increment a stable version. A prerelease is refused rather than bumped: every
 * bump of `3.0.0-next.2` would mean something different (`3.0.0`, `3.1.0`,
 * `4.0.0`), and a bare `bun run release` on `next` must never be the command
 * that cuts 3.0.0. Its stable release is named: `bun run release 3.0.0`.
 */
export const bumpVersion = (version: string, part: BumpType): string => {
  const v = parseVersion(version);
  if (v.prerelease !== null) {
    throw new Error(
      `v${version} is a prerelease; name the stable release explicitly: bun run release ${formatStable(v)}`,
    );
  }
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

/**
 * Order two versions. A stable version is above its own prereleases
 * (`3.0.0` > `3.0.0-next.2`); two prereleases of the same version compare equal,
 * which is enough here because a release is always stable.
 */
export const compareVersions = (a: string, b: string): number => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  if (x.prerelease === y.prerelease || (x.prerelease !== null && y.prerelease !== null)) return 0;
  return x.prerelease === null ? 1 : -1;
};

export const releaseBranchFor = (version: string): string => `chore/release-${version}`;

export interface ResolveVersionOptions {
  /** When true, allows target version to equal current version for re-entrancy. */
  readonly allowSame?: boolean;
  /** Whether the current package.json version is untagged on main. */
  readonly isCurrentUntagged?: boolean;
  /** Whether the target version is already tagged on main. */
  readonly isTagPresent?: boolean;
}

export const resolveNewVersion = (
  current: string,
  args: ReleaseArgs,
  options?: ResolveVersionOptions,
): string => {
  if (args.kind === "exact") {
    assertStableRelease(args.version);
    const cmp = compareVersions(args.version, current);
    if (cmp < 0) {
      throw new Error(`v${args.version} is not above the current v${current}`);
    }
    if (cmp === 0) {
      if (options?.isTagPresent) {
        throw new Error(`v${args.version} is already tagged on main`);
      }
      if (!options?.allowSame && !options?.isCurrentUntagged) {
        throw new Error(`v${args.version} is not above the current v${current}`);
      }
      return args.version;
    }
    return args.version;
  }

  // args.kind === "bump"
  if (options?.isCurrentUntagged) {
    assertStableRelease(current);
    return current;
  }

  const next = bumpVersion(current, args.bumpType);
  assertStableRelease(next);
  if (compareVersions(next, current) <= 0) {
    throw new Error(`v${next} is not above the current v${current}`);
  }
  return next;
};

export const detectReleaseState = (ctx: ReleaseContext): ReleaseState => {
  if (ctx.isTagPresent) {
    return "already-tagged";
  }
  if (ctx.mainPr?.state === "MERGED") {
    return "tag-release";
  }
  if (ctx.mainPr?.state === "OPEN") {
    return "await-main-pr";
  }
  if (ctx.sourcePr?.state === "MERGED" || ctx.currentVersion === ctx.targetVersion) {
    return "create-main-pr";
  }
  if (ctx.sourcePr?.state === "OPEN") {
    return "await-source-pr";
  }
  return "create-source-pr";
};

export const planRelease = (opts: PlanOptions): readonly ReleaseStep[] => {
  const branch = releaseBranchFor(opts.targetVersion);
  const steps: ReleaseStep[] = [];

  switch (opts.state) {
    case "already-tagged":
      steps.push({
        description: `v${opts.targetVersion} is already tagged on main`,
      });
      break;

    case "tag-release":
      steps.push(
        { description: "Check out main", command: "git checkout main" },
        { description: "Pull latest main", command: "git pull origin main" },
        { description: `Tag v${opts.targetVersion}`, command: `git tag v${opts.targetVersion}` },
        { description: `Push tag v${opts.targetVersion}`, command: `git push origin v${opts.targetVersion}` },
        { description: `Return to ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
      );
      break;

    case "await-main-pr":
      steps.push(
        { description: `Wait for PR #${opts.mainPrNumber ?? "<number>"} (${opts.sourceBranch} → main) to be merged` },
        { description: "Check out main", command: "git checkout main" },
        { description: "Pull latest main", command: "git pull origin main" },
        { description: `Tag v${opts.targetVersion}`, command: `git tag v${opts.targetVersion}` },
        { description: `Push tag v${opts.targetVersion}`, command: `git push origin v${opts.targetVersion}` },
        { description: `Return to ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
      );
      break;

    case "create-main-pr":
      steps.push(
        { description: `Ensure on ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
        { description: `Pull latest ${opts.sourceBranch}`, command: `git pull origin ${opts.sourceBranch}` },
        {
          description: `Create PR ${opts.sourceBranch} → main`,
          command: `gh pr create --base main --head ${opts.sourceBranch} --title "chore(release): v${opts.targetVersion}" --body "Version bump to v${opts.targetVersion}."`,
        },
        { description: `Wait for PR (${opts.sourceBranch} → main) to be merged` },
        { description: "Check out main", command: "git checkout main" },
        { description: "Pull latest main", command: "git pull origin main" },
        { description: `Tag v${opts.targetVersion}`, command: `git tag v${opts.targetVersion}` },
        { description: `Push tag v${opts.targetVersion}`, command: `git push origin v${opts.targetVersion}` },
        { description: `Return to ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
      );
      break;

    case "await-source-pr":
      steps.push(
        { description: `Wait for PR #${opts.sourcePrNumber ?? "<number>"} into ${opts.sourceBranch} to be merged` },
        { description: `Check out ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
        { description: `Pull latest ${opts.sourceBranch}`, command: `git pull origin ${opts.sourceBranch}` },
        {
          description: `Create PR ${opts.sourceBranch} → main`,
          command: `gh pr create --base main --head ${opts.sourceBranch} --title "chore(release): v${opts.targetVersion}" --body "Version bump to v${opts.targetVersion}."`,
        },
        { description: `Wait for PR (${opts.sourceBranch} → main) to be merged` },
        { description: "Check out main", command: "git checkout main" },
        { description: "Pull latest main", command: "git pull origin main" },
        { description: `Tag v${opts.targetVersion}`, command: `git tag v${opts.targetVersion}` },
        { description: `Push tag v${opts.targetVersion}`, command: `git push origin v${opts.targetVersion}` },
        { description: `Return to ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
      );
      break;

    case "create-source-pr":
      steps.push(
        { description: `Create and checkout branch ${branch}`, command: `git checkout -b ${branch}` },
        { description: `Bump version in package.json to ${opts.targetVersion}` },
        { description: `Update README.md version badge to v${opts.targetVersion}` },
        { description: "Update CHANGELOG.md stats" },
        { description: "Stage modified files", command: "git add package.json README.md CHANGELOG.md" },
        { description: `Commit release bump`, command: `git commit -m "chore(release): v${opts.targetVersion}"` },
        { description: `Push branch ${branch}`, command: `git push origin ${branch}` },
        {
          description: `Create PR ${branch} → ${opts.sourceBranch}`,
          command: `gh pr create --base ${opts.sourceBranch} --head ${branch} --title "chore(release): v${opts.targetVersion}" --body "Release commit for v${opts.targetVersion}."`,
        },
        { description: `Wait for PR into ${opts.sourceBranch} to be merged` },
        { description: `Check out ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
        { description: `Pull latest ${opts.sourceBranch}`, command: `git pull origin ${opts.sourceBranch}` },
        {
          description: `Create PR ${opts.sourceBranch} → main`,
          command: `gh pr create --base main --head ${opts.sourceBranch} --title "chore(release): v${opts.targetVersion}" --body "Version bump to v${opts.targetVersion}."`,
        },
        { description: `Wait for PR (${opts.sourceBranch} → main) to be merged` },
        { description: "Check out main", command: "git checkout main" },
        { description: "Pull latest main", command: "git pull origin main" },
        { description: `Tag v${opts.targetVersion}`, command: `git tag v${opts.targetVersion}` },
        { description: `Push tag v${opts.targetVersion}`, command: `git push origin v${opts.targetVersion}` },
        { description: `Return to ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
      );
      break;
  }

  return steps;
};

export const formatReleasePlan = (
  targetVersion: string,
  sourceBranch: ReleaseBranch,
  state: ReleaseState,
  steps: readonly ReleaseStep[],
): string => {
  const lines: string[] = [
    `Release plan for v${targetVersion} (from ${sourceBranch}):`,
    `State: ${state}`,
    "Commands / actions to execute:",
  ];
  let num = 1;
  for (const step of steps) {
    if (step.command) {
      lines.push(`  ${num++}. ${step.command} (${step.description})`);
    } else {
      lines.push(`  ${num++}. [action] ${step.description}`);
    }
  }
  return lines.join("\n");
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
  let dryRun = false;
  let positional = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
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
    return { kind: "exact", version: exactVersion, from, dryRun };
  }
  return { kind: "bump", bumpType: bumpType ?? "patch", from, dryRun };
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

  const checkTagExists = (tag: string): boolean => {
    try {
      const res = run(`git tag -l ${tag}`, { silent: true });
      return Boolean(res && res.split("\n").some((t) => t.trim() === tag));
    } catch {
      return false;
    }
  };

  const findPr = (head: string, base: string): { number: number; state: "OPEN" | "MERGED" | "CLOSED" } | null => {
    try {
      const out = run(`gh pr list --head ${head} --base ${base} --state all --json number,state --limit 1`, { silent: true });
      const list = JSON.parse(out) as Array<{ number: number; state: "OPEN" | "MERGED" | "CLOSED" }>;
      return list[0] ?? null;
    } catch {
      return null;
    }
  };

  // ── Guard: must be on the source branch for this version ──────────────────
  step(1, "Checking branch and working tree...");

  const pkg = JSON.parse(await Bun.file("package.json").text()) as { version: string };
  const oldVersion: string = pkg.version;
  const isCurrentUntagged = !checkTagExists("v" + oldVersion);

  let newVersion: string;
  let sourceBranch: ReleaseBranch;
  try {
    newVersion = resolveNewVersion(oldVersion, args, {
      allowSame: true,
      isCurrentUntagged: isCurrentUntagged && args.kind === "bump",
    });
    sourceBranch = resolveSourceBranch(newVersion, args.from);
    const currentBranch = run("git branch --show-current", { silent: true });
    if (!args.dryRun) {
      assertCurrentBranch(currentBranch, sourceBranch, newVersion);
    }
  } catch (err: unknown) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const releaseBranch = releaseBranchFor(newVersion);
  const isTargetTagPresent = checkTagExists("v" + newVersion);
  const sourcePr = !args.dryRun ? findPr(releaseBranch, sourceBranch) : null;
  const mainPr = !args.dryRun ? findPr(sourceBranch, "main") : null;

  const state = detectReleaseState({
    currentVersion: oldVersion,
    targetVersion: newVersion,
    isTagPresent: isTargetTagPresent,
    sourcePr,
    mainPr,
  });

  if (args.dryRun) {
    const plan = planRelease({
      targetVersion: newVersion,
      sourceBranch,
      state,
      sourcePrNumber: sourcePr?.number,
      mainPrNumber: mainPr?.number,
    });
    console.log(formatReleasePlan(newVersion, sourceBranch, state, plan));
    return;
  }

  const status = run("git status --porcelain", { silent: true });
  if (status) {
    console.error(`  ✗ Working tree is not clean — commit or stash changes first`);
    process.exit(1);
  }

  run(`git pull origin ${sourceBranch}`, { silent: true });
  console.log(`  ✓ On ${sourceBranch}, working tree clean, pulled latest`);

  if (state === "already-tagged") {
    console.log(`  ✓ v${newVersion} is already tagged on main.`);
    return;
  }

  // ── Step 1: Release commit on chore/release-X.Y.Z & PR into sourceBranch ──
  if (state === "create-source-pr") {
    step(2, `Creating release branch ${releaseBranch} and opening PR into ${sourceBranch}...`);

    run(`git checkout -b ${releaseBranch}`);

    pkg.version = newVersion;
    await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  ✓ package.json: ${oldVersion} → ${newVersion}`);

    const readme = await Bun.file("README.md").text();
    await Bun.write("README.md", updateReadmeVersion(readme, newVersion));
    console.log(`  ✓ README.md version badge updated`);

    const commitCount = parseInt(run("git rev-list --count HEAD", { silent: true }), 10);
    const firstDate = new Date(run("git log --format=%aI --reverse | head -1", { silent: true }));
    const today = new Date();
    const days = Math.round((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
    const firstShort = firstDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const todayFull = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const statsLine = `${commitCount} commits · ${days} days · ${firstShort} – ${todayFull}`;

    const changelog = await Bun.file("CHANGELOG.md").text();
    await Bun.write("CHANGELOG.md", updateChangelogStats(changelog, statsLine));
    console.log(`  ✓ CHANGELOG.md: ${statsLine}`);

    run(`git add package.json README.md CHANGELOG.md`);
    run(`git commit -m "chore(release): v${newVersion}"`);
    run(`git push origin ${releaseBranch}`);
    console.log(`  ✓ Pushed to ${releaseBranch}`);

    const prUrl = run(
      `gh pr create --base ${sourceBranch} --head ${releaseBranch} --title "chore(release): v${newVersion}" --body "Release commit for v${newVersion}."`,
      { silent: true },
    );
    const prNumber = prUrl.split("/").pop();
    console.log(`  ✓ PR #${prNumber} created: ${prUrl}`);

    log(`Waiting for PR #${prNumber} into ${sourceBranch} to be merged (CI must pass)...`);
    let merged = false;
    for (let i = 0; i < 60; i++) {
      await sleep(10_000);
      const prState = run(`gh pr view ${prNumber} --json state --jq '.state'`, { silent: true });
      if (prState === "MERGED") {
        merged = true;
        break;
      }
      process.stdout.write(".");
    }

    if (!merged) {
      console.error(`\n  ✗ Timed out waiting for PR #${prNumber} into ${sourceBranch} to merge.`);
      process.exit(1);
    }

    console.log(`\n  ✓ PR #${prNumber} merged into ${sourceBranch}`);
    run(`git checkout ${sourceBranch}`, { silent: true });
    run(`git pull origin ${sourceBranch}`, { silent: true });
  } else if (state === "await-source-pr") {
    const prNumber = sourcePr!.number;
    log(`Waiting for PR #${prNumber} into ${sourceBranch} to be merged (CI must pass)...`);
    let merged = false;
    for (let i = 0; i < 60; i++) {
      await sleep(10_000);
      const prState = run(`gh pr view ${prNumber} --json state --jq '.state'`, { silent: true });
      if (prState === "MERGED") {
        merged = true;
        break;
      }
      process.stdout.write(".");
    }

    if (!merged) {
      console.error(`\n  ✗ Timed out waiting for PR #${prNumber} into ${sourceBranch} to merge.`);
      process.exit(1);
    }

    console.log(`\n  ✓ PR #${prNumber} merged into ${sourceBranch}`);
    run(`git checkout ${sourceBranch}`, { silent: true });
    run(`git pull origin ${sourceBranch}`, { silent: true });
  }

  // ── Step 2: PR source → main ───────────────────────────────────────────────
  let mainPrNumber: string | number | undefined;
  if (state === "create-source-pr" || state === "await-source-pr" || state === "create-main-pr") {
    step(3, `Creating PR ${sourceBranch} → main...`);

    const prUrl = run(
      `gh pr create --base main --head ${sourceBranch} --title "chore(release): v${newVersion}" --body "Version bump to v${newVersion}."`,
      { silent: true },
    );
    mainPrNumber = prUrl.split("/").pop();
    console.log(`  ✓ PR #${mainPrNumber} created: ${prUrl}`);

    log(`Waiting for PR #${mainPrNumber} to be merged (CI must pass)...`);
    let merged = false;
    for (let i = 0; i < 60; i++) {
      await sleep(10_000);
      const prState = run(`gh pr view ${mainPrNumber} --json state --jq '.state'`, { silent: true });
      if (prState === "MERGED") {
        merged = true;
        break;
      }
      process.stdout.write(".");
    }

    if (!merged) {
      console.error(`\n  ✗ Timed out waiting for PR #${mainPrNumber} to merge. Merge it manually, then run:\n    git checkout main && git pull && git tag v${newVersion} && git push origin v${newVersion}`);
      process.exit(1);
    }

    console.log(`\n  ✓ PR #${mainPrNumber} merged`);
  } else if (state === "await-main-pr") {
    mainPrNumber = mainPr!.number;
    log(`Waiting for PR #${mainPrNumber} to be merged (CI must pass)...`);
    let merged = false;
    for (let i = 0; i < 60; i++) {
      await sleep(10_000);
      const prState = run(`gh pr view ${mainPrNumber} --json state --jq '.state'`, { silent: true });
      if (prState === "MERGED") {
        merged = true;
        break;
      }
      process.stdout.write(".");
    }

    if (!merged) {
      console.error(`\n  ✗ Timed out waiting for PR #${mainPrNumber} to merge. Merge it manually, then run:\n    git checkout main && git pull && git tag v${newVersion} && git push origin v${newVersion}`);
      process.exit(1);
    }

    console.log(`\n  ✓ PR #${mainPrNumber} merged`);
  }

  // ── Step 3: Pull main and push tag ─────────────────────────────────────────
  step(4, `Tagging v${newVersion} and pushing...`);

  run(`git checkout main`, { silent: true });
  run(`git pull origin main`, { silent: true });
  run(`git tag v${newVersion}`);
  run(`git push origin v${newVersion}`);
  run(`git checkout ${sourceBranch}`, { silent: true });

  console.log(`  ✓ Tag v${newVersion} pushed — publish workflow triggered`);

  log(`Done! v${newVersion} is publishing to npm.`);
  log(`Monitor: https://github.com/floor/vlist/actions`);
  // Trusted publishing moves `latest` only: `next` needs a maintainer.
  log(`Last step, once it is on npm: ${nextTagCommand(newVersion)}`);
};

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
