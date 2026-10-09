#!/usr/bin/env bun
/**
 * vlist release script
 *
 * Usage: bun run release [patch|minor|major|<version>] [--from next|staging] [--dry-run] [--tag]
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
  | { readonly kind: "bump"; readonly bumpType: BumpType; readonly from: ReleaseBranch | null; readonly dryRun?: boolean | undefined; readonly tag?: boolean | undefined }
  | { readonly kind: "exact"; readonly version: string; readonly from: ReleaseBranch | null; readonly dryRun?: boolean | undefined; readonly tag?: boolean | undefined };

export type ReleaseState =
  | "create-source-pr"
  | "await-source-pr"
  | "create-main-pr"
  | "await-main-pr"
  | "tag-release"
  | "push-local-tag"
  | "already-tagged";

export interface PrInfo {
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly mergedAt?: string | null | undefined;
  readonly mergeCommitOid?: string | null | undefined;
  readonly packageVersion?: string | null | undefined;
}

export interface CheckRunInfo {
  readonly name: string;
  readonly status: "queued" | "in_progress" | "completed";
  readonly conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null;
}

export interface ReleaseContext {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly remoteTagSha: string | null;
  readonly localTagSha: string | null;
  readonly tag?: boolean | undefined;
  readonly sourcePr?: PrInfo | null | undefined;
  readonly mainPr?: PrInfo | null | undefined;
  readonly blockingPr?: PrInfo | null | undefined;
  readonly remoteBranchExists?: boolean | undefined;
  readonly isMergeCommitAncestor?: boolean | undefined;
  readonly packageVersionAtMergeSha?: string | null | undefined;
  readonly checkRuns?: readonly CheckRunInfo[] | undefined;
}

export interface PlanOptions {
  readonly targetVersion: string;
  readonly sourceBranch: ReleaseBranch;
  readonly state: ReleaseState;
  readonly tag?: boolean | undefined;
  readonly sourcePr?: PrInfo | null | undefined;
  readonly mainPr?: PrInfo | null | undefined;
  readonly blockingPr?: PrInfo | null | undefined;
  readonly verifiedSha?: string | null | undefined;
  readonly remoteTagSha?: string | null | undefined;
  readonly localTagSha?: string | null | undefined;
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

export const USAGE = "Usage: bun run release [patch|minor|major|<version>] [--from next|staging] [--dry-run] [--tag]";

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
  const releaseBranch = releaseBranchFor(version);
  if (current !== source && current !== releaseBranch) {
    const on = currentBranchLabel(current);
    throw new Error(
      `Must be on ${source} to release v${version} (currently on '${on}')`,
    );
  }
};

/**
 * Fail-closed PR selector.
 * Matches candidate PRs by head and base, filtering by packageVersion matching targetVersion.
 * Stops if multiple match, or if any matching PR is closed unmerged.
 */
export const selectPullRequest = (
  candidates: readonly PrInfo[],
  head: string,
  base: string,
  targetVersion: string,
): PrInfo | null => {
  const filtered = candidates.filter(
    (pr) => pr.headRefName === head && pr.baseRefName === base,
  );

  const matching = filtered.filter(
    (pr) => pr.packageVersion === targetVersion,
  );

  const closedUnmerged = matching.find(
    (pr) => pr.state === "CLOSED" && !pr.mergedAt,
  );
  if (closedUnmerged) {
    throw new Error(
      `Pull request #${closedUnmerged.number} (${head} → ${base}) was closed without merging`,
    );
  }

  if (matching.length > 1) {
    const numbers = matching.map((pr) => `#${pr.number}`).join(", ");
    throw new Error(
      `Multiple matching pull requests found for ${head} → ${base}: ${numbers}`,
    );
  }

  return matching[0] ?? null;
};

/**
 * Detects whether an unrelated open release PR on sourceBranch exists that blocks a new release.
 */
export const detectBlockingPr = (
  candidates: readonly PrInfo[],
  sourceBranch: ReleaseBranch,
  targetVersion: string,
): PrInfo | null => {
  return (
    candidates.find(
      (pr) =>
        pr.headRefName === sourceBranch &&
        pr.baseRefName === "main" &&
        pr.state === "OPEN" &&
        pr.packageVersion !== null &&
        pr.packageVersion !== undefined &&
        pr.packageVersion !== targetVersion,
    ) ?? null
  );
};

/**
 * Fail-closed check runs verification.
 * Verifies all check runs are completed and successful.
 */
export const verifyCheckRuns = (
  checkRuns: readonly CheckRunInfo[],
  commitSha: string,
): void => {
  const failingOrPending = checkRuns.filter(
    (run) =>
      run.status !== "completed" ||
      (run.conclusion !== "success" &&
        run.conclusion !== "neutral" &&
        run.conclusion !== "skipped"),
  );

  if (failingOrPending.length > 0) {
    const list = failingOrPending
      .map(
        (run) =>
          `  • ${run.name}: ${run.status} (${run.conclusion ?? "pending"})`,
      )
      .join("\n");
    throw new Error(`Checks on ${commitSha} are not passing:\n${list}`);
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
  if (ctx.remoteTagSha || (ctx as unknown as { isTagPresent?: boolean }).isTagPresent) {
    return "already-tagged";
  }

  if (ctx.tag) {
    if (!ctx.mainPr) {
      throw new Error(`Cannot tag v${ctx.targetVersion}: no pull request into main found`);
    }
    if (ctx.mainPr.state === "OPEN") {
      throw new Error(
        `Cannot tag v${ctx.targetVersion}: pull request #${ctx.mainPr.number} into main is still open`,
      );
    }
    if (ctx.mainPr.state === "CLOSED" && !ctx.mainPr.mergedAt) {
      throw new Error(
        `Pull request #${ctx.mainPr.number} (${ctx.mainPr.headRefName} → ${ctx.mainPr.baseRefName}) was closed without merging`,
      );
    }
  }

  // Check main PR
  if (ctx.mainPr) {
    if (ctx.mainPr.state === "CLOSED" && !ctx.mainPr.mergedAt) {
      throw new Error(
        `Pull request #${ctx.mainPr.number} (${ctx.mainPr.headRefName} → ${ctx.mainPr.baseRefName}) was closed without merging`,
      );
    }

    if (ctx.mainPr.state === "MERGED") {
      const mergeSha =
        ctx.mainPr.mergeCommitOid ??
        (ctx.mainPr as unknown as { mergeCommit?: { oid: string } }).mergeCommit?.oid;

      if (!mergeSha) {
        throw new Error(
          `Merge commit for PR #${ctx.mainPr.number} could not be determined`,
        );
      }

      if (ctx.isMergeCommitAncestor === false) {
        throw new Error(
          `Merge commit ${mergeSha} from PR #${ctx.mainPr.number} is not an ancestor of origin/main`,
        );
      }

      if (
        ctx.packageVersionAtMergeSha &&
        ctx.packageVersionAtMergeSha !== ctx.targetVersion
      ) {
        throw new Error(
          `package.json at merge commit ${mergeSha} is v${ctx.packageVersionAtMergeSha}, not target v${ctx.targetVersion}`,
        );
      }

      if (ctx.checkRuns && ctx.checkRuns.length > 0) {
        verifyCheckRuns(ctx.checkRuns, mergeSha);
      }

      if (ctx.localTagSha !== null && ctx.localTagSha !== undefined) {
        if (ctx.localTagSha !== mergeSha) {
          throw new Error(
            `Local tag v${ctx.targetVersion} points to ${ctx.localTagSha}, but verified merge commit is ${mergeSha}`,
          );
        }
        return "push-local-tag";
      }

      return "tag-release";
    }

    if (ctx.mainPr.state === "OPEN") {
      return "await-main-pr";
    }
  }

  if (ctx.tag) {
    throw new Error(`Cannot tag v${ctx.targetVersion}: main pull request is not merged`);
  }

  // If local tag exists but main PR is not merged, local tag is invalid
  if (ctx.localTagSha !== null && ctx.localTagSha !== undefined) {
    throw new Error(
      `Local tag v${ctx.targetVersion} exists at ${ctx.localTagSha}, but target version is not merged onto main`,
    );
  }

  // Check source PR
  if (ctx.sourcePr) {
    if (ctx.sourcePr.state === "CLOSED" && !ctx.sourcePr.mergedAt) {
      throw new Error(
        `Pull request #${ctx.sourcePr.number} (${ctx.sourcePr.headRefName} → ${ctx.sourcePr.baseRefName}) was closed without merging`,
      );
    }

    if (ctx.sourcePr.state === "MERGED") {
      return "create-main-pr";
    }

    if (ctx.sourcePr.state === "OPEN") {
      return "await-source-pr";
    }
  }

  // When currentVersion on sourceBranch is already targetVersion
  if (ctx.currentVersion === ctx.targetVersion) {
    return "create-main-pr";
  }

  // Check remote release branch collision
  if (ctx.remoteBranchExists && !ctx.sourcePr) {
    const branch = releaseBranchFor(ctx.targetVersion);
    throw new Error(
      `Remote branch ${branch} exists on origin, but no open or merged pull request matches it`,
    );
  }

  return "create-source-pr";
};

export const planRelease = (opts: PlanOptions): readonly ReleaseStep[] => {
  const branch = releaseBranchFor(opts.targetVersion);
  const steps: ReleaseStep[] = [];
  const verifiedSha = opts.verifiedSha ?? "<sha>";
  const isTag = opts.tag === true;

  switch (opts.state) {
    case "already-tagged":
      steps.push({
        description: `v${opts.targetVersion} is already released on remote${opts.remoteTagSha ? ` at ${opts.remoteTagSha}` : ""}`,
      });
      break;

    case "push-local-tag":
      if (isTag) {
        steps.push(
          {
            description: `Push existing verified local tag v${opts.targetVersion}`,
            command: `git push origin v${opts.targetVersion}`,
          },
          {
            description: `Return to ${opts.sourceBranch}`,
            command: `git checkout ${opts.sourceBranch}`,
          },
        );
      } else {
        steps.push({
          description: `Local tag v${opts.targetVersion} verified at ${verifiedSha}. Run 'bun run release ${opts.targetVersion} --tag' to push.`,
        });
      }
      break;

    case "tag-release":
      if (isTag) {
        steps.push(
          { description: "Check out main", command: "git checkout main" },
          { description: "Pull latest main", command: "git pull origin main" },
          {
            description: `Tag v${opts.targetVersion} at verified commit ${verifiedSha}`,
            command: `git tag -a v${opts.targetVersion} ${verifiedSha} -m v${opts.targetVersion}`,
          },
          { description: `Push tag v${opts.targetVersion}`, command: `git push origin v${opts.targetVersion}` },
          { description: `Return to ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
        );
      } else {
        steps.push({
          description: `Main PR merged and verified at ${verifiedSha}. Run 'bun run release ${opts.targetVersion} --tag' to tag and push.`,
        });
      }
      break;

    case "await-main-pr":
      steps.push(
        {
          description: `Wait for PR #${opts.mainPr?.number ?? opts.mainPrNumber ?? "<number>"} (${opts.sourceBranch} → main, ${opts.targetVersion}) to be merged`,
        },
        {
          description: `Run 'bun run release ${opts.targetVersion} --tag' once PR is merged and verified`,
        },
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
        {
          description: `Run 'bun run release ${opts.targetVersion} --tag' once PR is merged and verified`,
        },
      );
      break;

    case "await-source-pr":
      steps.push(
        {
          description: `Wait for PR #${opts.sourcePr?.number ?? opts.sourcePrNumber ?? "<number>"} into ${opts.sourceBranch} to be merged`,
        },
        { description: `Check out ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
        { description: `Pull latest ${opts.sourceBranch}`, command: `git pull origin ${opts.sourceBranch}` },
        {
          description: `Create PR ${opts.sourceBranch} → main`,
          command: `gh pr create --base main --head ${opts.sourceBranch} --title "chore(release): v${opts.targetVersion}" --body "Version bump to v${opts.targetVersion}."`,
        },
        { description: `Wait for PR (${opts.sourceBranch} → main) to be merged` },
        {
          description: `Run 'bun run release ${opts.targetVersion} --tag' once PR is merged and verified`,
        },
      );
      break;

    case "create-source-pr":
      steps.push(
        { description: `Create and checkout branch ${branch}`, command: `git checkout -b ${branch}` },
        { description: `Bump version in package.json to ${opts.targetVersion}` },
        { description: `Update README.md version badge to v${opts.targetVersion}` },
        { description: "Update CHANGELOG.md stats" },
        { description: "Stage modified files", command: "git add package.json README.md CHANGELOG.md" },
        { description: "Commit release bump", command: `git commit -m "chore(release): v${opts.targetVersion}"` },
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
        {
          description: `Run 'bun run release ${opts.targetVersion} --tag' once PR is merged and verified`,
        },
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
  options?: {
    evidence?: readonly string[] | undefined;
    blockingPr?: PrInfo | null | undefined;
  },
): string => {
  const lines: string[] = [
    `Release plan for v${targetVersion} (from ${sourceBranch}):`,
    `State: ${state}`,
  ];

  if (options?.evidence && options.evidence.length > 0) {
    lines.push("Evidence:");
    for (const ev of options.evidence) {
      lines.push(`  • ${ev}`);
    }
  }

  if (options?.blockingPr) {
    lines.push(
      `Warning: a ${targetVersion} release cannot start while ${options.blockingPr.packageVersion ?? "prior version"}'s release (PR #${options.blockingPr.number}) is unmerged.`,
    );
  }

  lines.push("Commands / actions to execute:");
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
  let tag = false;
  let positional = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--tag") {
      tag = true;
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
    return { kind: "exact", version: exactVersion, from, dryRun, tag };
  }
  return { kind: "bump", bumpType: bumpType ?? "patch", from, dryRun, tag };
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
// Live Git / GitHub readers
// =============================================================================

export const parseLsRemoteTags = (output: string, tag: string): string | null => {
  const lines = output.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  let directSha: string | null = null;
  let peeledSha: string | null = null;
  for (const line of lines) {
    const [sha, ref] = line.split(/\s+/);
    if (!sha || !ref) continue;
    if (ref === `refs/tags/${tag}^{}`) {
      peeledSha = sha;
    } else if (ref === `refs/tags/${tag}`) {
      directSha = sha;
    }
  }
  return peeledSha ?? directSha;
};

export const getRemoteTag = (version: string): string | null => {
  const output = run(
    `git ls-remote --tags origin refs/tags/v${version} "refs/tags/v${version}^{}"`,
    { silent: true },
  );
  return parseLsRemoteTags(output, `v${version}`);
};

export const getLocalTag = (version: string): string | null => {
  const list = run(`git tag -l "v${version}"`, { silent: true });
  if (!list.split("\n").some((t) => t.trim() === `v${version}`)) {
    return null;
  }
  return run(`git rev-parse -q --verify refs/tags/v${version}^{commit}`, { silent: true });
};

export const checkRemoteBranchExists = (branch: string): boolean => {
  const out = run(`git ls-remote --heads origin "refs/heads/${branch}"`, { silent: true });
  return out.trim().length > 0;
};

export const readPackageVersionAtSha = (sha: string): string => {
  try {
    const raw = run(`git show ${sha}:package.json`, { silent: true });
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version !== "string") {
      throw new Error(`package.json at commit ${sha} does not contain a valid version string`);
    }
    return parsed.version;
  } catch (err: unknown) {
    try {
      const rawBase64 = run(
        `gh api repos/floor/vlist/contents/package.json?ref=${sha} --jq .content`,
        { silent: true },
      );
      const decoded = Buffer.from(rawBase64, "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as { version?: unknown };
      if (typeof parsed.version !== "string") {
        throw new Error(`package.json at commit ${sha} does not contain a valid version string`);
      }
      return parsed.version;
    } catch {
      throw new Error(
        `Could not read package.json at commit ${sha}: ${execErrorMessage(err)}`,
      );
    }
  }
};

export const fetchCheckRuns = (commitSha: string): CheckRunInfo[] => {
  const raw = run(`gh api repos/floor/vlist/commits/${commitSha}/check-runs`, { silent: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse check-runs API response: ${execErrorMessage(err)}`);
  }
  const data = parsed as {
    check_runs?: Array<{
      name?: unknown;
      status?: unknown;
      conclusion?: unknown;
    }>;
  };
  if (!Array.isArray(data.check_runs)) {
    throw new Error(`Invalid response from check-runs API for commit ${commitSha}`);
  }
  return data.check_runs.map((r) => ({
    name: String(r.name ?? "unnamed"),
    status: (r.status as CheckRunInfo["status"]) ?? "in_progress",
    conclusion: (r.conclusion as CheckRunInfo["conclusion"]) ?? null,
  }));
};

export const isCommitAncestorOf = (commitSha: string, targetRef: string): boolean => {
  try {
    execSync(`git merge-base --is-ancestor ${commitSha} ${targetRef}`, {
      stdio: "pipe",
    });
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err) {
      const status = (err as { status: unknown }).status;
      if (status === 1) return false;
    }
    throw new Error(
      `Failed to check if ${commitSha} is ancestor of ${targetRef}: ${execErrorMessage(err)}`,
    );
  }
};

export const fetchPrCandidates = (
  sourceBranch: ReleaseBranch,
  releaseBranch: string,
): PrInfo[] => {
  const raw = run(
    `gh pr list --state all --limit 100 --json number,title,state,headRefName,baseRefName,headRefOid,mergedAt,mergeCommit`,
    { silent: true },
  );
  let parsedList: unknown;
  try {
    parsedList = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse PR list from GitHub: ${execErrorMessage(err)}`);
  }
  if (!Array.isArray(parsedList)) {
    throw new Error("Invalid PR list response from GitHub");
  }

  const results: PrInfo[] = [];
  for (const item of parsedList) {
    const pr = item as {
      number: number;
      title: string;
      state: "OPEN" | "MERGED" | "CLOSED";
      headRefName: string;
      baseRefName: string;
      headRefOid: string;
      mergedAt?: string | null;
      mergeCommit?: { oid: string } | null;
    };

    const isSourceCandidate =
      pr.headRefName === releaseBranch && pr.baseRefName === sourceBranch;
    const isMainCandidate =
      pr.headRefName === sourceBranch && pr.baseRefName === "main";

    if (isSourceCandidate || isMainCandidate) {
      let packageVersion: string | null = null;
      if (pr.headRefOid) {
        packageVersion = readPackageVersionAtSha(pr.headRefOid);
      }
      results.push({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        headRefOid: pr.headRefOid,
        mergedAt: pr.mergedAt ?? null,
        mergeCommitOid: pr.mergeCommit?.oid ?? null,
        packageVersion,
      });
    }
  }
  return results;
};

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

  step(1, "Checking release state and preconditions...");

  const pkg = JSON.parse(await Bun.file("package.json").text()) as { version: string };
  const oldVersion: string = pkg.version;
  const currentRemoteTagSha = getRemoteTag(oldVersion);
  const isCurrentUntagged = currentRemoteTagSha === null;

  let newVersion: string;
  let sourceBranch: ReleaseBranch;
  let releaseBranch: string;

  try {
    newVersion = resolveNewVersion(oldVersion, args, {
      allowSame: true,
      isCurrentUntagged: isCurrentUntagged && args.kind === "bump",
      isTagPresent: !isCurrentUntagged,
    });
    sourceBranch = resolveSourceBranch(newVersion, args.from);
    releaseBranch = releaseBranchFor(newVersion);

    const currentBranch = run("git branch --show-current", { silent: true });
    if (!args.dryRun) {
      assertCurrentBranch(currentBranch, sourceBranch, newVersion);
    }
  } catch (err: unknown) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const remoteTagSha = getRemoteTag(newVersion);
  const localTagSha = getLocalTag(newVersion);
  const remoteBranchExists = checkRemoteBranchExists(releaseBranch);
  const candidates = fetchPrCandidates(sourceBranch, releaseBranch);
  const sourcePr = selectPullRequest(candidates, releaseBranch, sourceBranch, newVersion);
  const mainPr = selectPullRequest(candidates, sourceBranch, "main", newVersion);
  const blockingPr = detectBlockingPr(candidates, sourceBranch, newVersion);

  let isMergeCommitAncestor: boolean | undefined;
  let packageVersionAtMergeSha: string | null | undefined;
  let checkRuns: CheckRunInfo[] | undefined;
  const mergeSha = mainPr?.mergeCommitOid;

  if (mainPr?.state === "MERGED" && mergeSha) {
    isMergeCommitAncestor = isCommitAncestorOf(mergeSha, "origin/main");
    packageVersionAtMergeSha = readPackageVersionAtSha(mergeSha);
    checkRuns = fetchCheckRuns(mergeSha);
  }

  let state: ReleaseState;
  try {
    state = detectReleaseState({
      currentVersion: oldVersion,
      targetVersion: newVersion,
      remoteTagSha,
      localTagSha,
      sourcePr,
      mainPr,
      blockingPr,
      remoteBranchExists,
      isMergeCommitAncestor,
      packageVersionAtMergeSha,
      checkRuns,
      tag: args.tag,
    });
  } catch (err: unknown) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const evidence: string[] = [];
  if (remoteTagSha) {
    evidence.push(`Remote tag v${newVersion} exists (${remoteTagSha})`);
  } else {
    evidence.push(`Remote tag v${newVersion}: not found`);
  }
  if (localTagSha) {
    evidence.push(`Local tag v${newVersion} exists (${localTagSha})`);
  } else {
    evidence.push(`Local tag v${newVersion}: not found`);
  }
  if (sourcePr) {
    evidence.push(
      `Pull request #${sourcePr.number} (${sourcePr.headRefName} → ${sourcePr.baseRefName}, ${newVersion}) is ${sourcePr.state.toLowerCase()}` +
        (sourcePr.headRefOid ? ` (head: ${sourcePr.headRefOid.slice(0, 8)})` : ""),
    );
  }
  if (mainPr) {
    evidence.push(
      `Pull request #${mainPr.number} (${mainPr.headRefName} → ${mainPr.baseRefName}, ${newVersion}) is ${mainPr.state.toLowerCase()}: wait for it to merge` +
        (mainPr.headRefOid ? ` (head: ${mainPr.headRefOid.slice(0, 8)})` : ""),
    );
    if (mainPr.state === "MERGED" && mergeSha) {
      evidence.push(`Merge commit: ${mergeSha} (ancestor of origin/main: ${isMergeCommitAncestor ? "yes" : "no"})`);
      evidence.push(`package.json at merge commit: v${packageVersionAtMergeSha}`);
      evidence.push(`Check runs on merge commit: ${checkRuns?.length ?? 0} runs completed and successful`);
    }
  }
  if (blockingPr) {
    evidence.push(
      `Unrelated release PR #${blockingPr.number} (${blockingPr.headRefName} → ${blockingPr.baseRefName}, ${blockingPr.packageVersion}) is ${blockingPr.state.toLowerCase()}`,
    );
  }

  if (args.dryRun) {
    const plan = planRelease({
      targetVersion: newVersion,
      sourceBranch,
      state,
      tag: args.tag,
      verifiedSha: mergeSha,
      remoteTagSha,
      localTagSha,
      sourcePr,
      mainPr,
      blockingPr,
    });
    console.log(formatReleasePlan(newVersion, sourceBranch, state, plan, { evidence, blockingPr }));
    return;
  }

  // Live run assertions
  if (blockingPr) {
    console.error(
      `  ✗ A ${newVersion} release cannot start while ${blockingPr.packageVersion ?? "prior version"}'s release (PR #${blockingPr.number}) is unmerged.`,
    );
    process.exit(1);
  }

  const status = run("git status --porcelain", { silent: true });
  if (status) {
    console.error(`  ✗ Working tree is not clean — commit or stash changes first`);
    process.exit(1);
  }

  // If already tagged
  if (state === "already-tagged") {
    console.log(`  ✓ v${newVersion} is already released on remote.`);
    return;
  }

  // If tag flag passed and ready to tag
  if (args.tag) {
    if (state === "push-local-tag") {
      step(2, `Pushing existing verified tag v${newVersion}...`);
      run(`git push origin v${newVersion}`);
      run(`git checkout ${sourceBranch}`, { silent: true });
      console.log(`  ✓ Tag v${newVersion} pushed — publish workflow triggered`);
      log(`Done! v${newVersion} is publishing to npm.`);
      log(`Monitor: https://github.com/floor/vlist/actions`);
      log(`Last step, once it is on npm: ${nextTagCommand(newVersion)}`);
      return;
    }
    if (state === "tag-release") {
      step(2, `Tagging v${newVersion} at verified commit ${mergeSha} and pushing...`);
      run(`git checkout main`, { silent: true });
      run(`git pull origin main`, { silent: true });
      run(`git tag -a v${newVersion} ${mergeSha} -m v${newVersion}`);
      run(`git push origin v${newVersion}`);
      run(`git checkout ${sourceBranch}`, { silent: true });
      console.log(`  ✓ Tag v${newVersion} pushed — publish workflow triggered`);
      log(`Done! v${newVersion} is publishing to npm.`);
      log(`Monitor: https://github.com/floor/vlist/actions`);
      log(`Last step, once it is on npm: ${nextTagCommand(newVersion)}`);
      return;
    }
    console.error(`  ✗ Cannot tag v${newVersion}: state is ${state}`);
    process.exit(1);
  }

  // If state is tag-release or push-local-tag without --tag: print message and exit 0
  if (state === "tag-release") {
    console.log(`  ✓ Main pull request #${mainPr?.number} is merged and verified at ${mergeSha}.`);
    console.log(`\nNext step to create and push the tag:\n  bun run release ${newVersion} --tag`);
    return;
  }
  if (state === "push-local-tag") {
    console.log(`  ✓ Local tag v${newVersion} is verified at ${mergeSha}.`);
    console.log(`\nNext step to push the tag:\n  bun run release ${newVersion} --tag`);
    return;
  }

  run(`git pull origin ${sourceBranch}`, { silent: true });
  console.log(`  ✓ On ${sourceBranch}, working tree clean, pulled latest`);

  // ── Step 1: Release commit on chore/release-X.Y.Z & PR into sourceBranch ──
  if (state === "create-source-pr") {
    const localBranchExists = run(`git branch --list ${releaseBranch}`, { silent: true });
    if (localBranchExists) {
      console.error(
        `  ✗ Local branch ${releaseBranch} already exists from an earlier run.\n` +
          `    Switch to it (\`git checkout ${releaseBranch}\`) to continue, or delete it (\`git branch -D ${releaseBranch}\`) to restart from ${sourceBranch}.`,
      );
      process.exit(1);
    }

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
      console.error(
        `\n  ✗ Timed out waiting for PR #${mainPrNumber} to merge. Merge it manually, then run:\n    bun run release ${newVersion} --tag`,
      );
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
      console.error(
        `\n  ✗ Timed out waiting for PR #${mainPrNumber} to merge. Merge it manually, then run:\n    bun run release ${newVersion} --tag`,
      );
      process.exit(1);
    }

    console.log(`\n  ✓ PR #${mainPrNumber} merged`);
  }

  // ── Step 3: Verify and prompt for tag ───────────────────────────────────────
  step(4, `Verifying merge commit and checks on main...`);
  const freshPrRaw = run(`gh pr view ${mainPrNumber} --json mergeCommit`, { silent: true });
  const freshPr = JSON.parse(freshPrRaw) as { mergeCommit?: { oid?: string } };
  const freshMergeSha = freshPr.mergeCommit?.oid;
  if (!freshMergeSha) {
    console.error(`\n  ✗ Could not retrieve merge commit SHA for PR #${mainPrNumber}`);
    process.exit(1);
  }
  if (!isCommitAncestorOf(freshMergeSha, "origin/main")) {
    console.error(`\n  ✗ Merge commit ${freshMergeSha} is not an ancestor of origin/main`);
    process.exit(1);
  }
  const pkgVer = readPackageVersionAtSha(freshMergeSha);
  if (pkgVer !== newVersion) {
    console.error(`\n  ✗ package.json at merge commit ${freshMergeSha} is v${pkgVer}, not target v${newVersion}`);
    process.exit(1);
  }
  const freshChecks = fetchCheckRuns(freshMergeSha);
  verifyCheckRuns(freshChecks, freshMergeSha);

  console.log(`  ✓ Merge commit ${freshMergeSha} verified with all passing checks.`);
  console.log(`\nNext step to create and push the tag:\n  bun run release ${newVersion} --tag`);
};

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
