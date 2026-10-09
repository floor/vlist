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
 *   9. Verifies merge commit, package.json, and passing check runs on main
 *  10. Stops before the tag by default; with explicit --tag, creates annotated tag and pushes
 */

import { execSync } from "node:child_process";
import { nextTagCommand } from "./check-dist-tags";

// =============================================================================
// Constants & Types
// =============================================================================

export const READ_COMMAND_TIMEOUT_MS = 15000;
export const PR_QUERY_LIMIT = 30;

/**
 * Required check runs defined in .github/workflows/ci.yml:
 * - "Test & Build" (.github/workflows/ci.yml:15)
 * - "Browser suites" (.github/workflows/ci.yml:99)
 */
export const REQUIRED_CHECK_NAMES = ["Test & Build", "Browser suites"] as const;

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
  readonly status: "queued" | "in_progress" | "completed" | string;
  readonly conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | string | null;
  readonly app?: { readonly slug?: string | undefined; readonly name?: string | undefined } | null | undefined;
}

export interface ReleaseContext {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly remoteTagSha: string | null;
  readonly localTagSha: string | null;
  readonly tag?: boolean | undefined;
  readonly sourceBranch?: ReleaseBranch | undefined;
  readonly currentBranch?: string | undefined;
  readonly sourcePr?: PrInfo | null | undefined;
  readonly mainPr?: PrInfo | null | undefined;
  readonly blockingPr?: PrInfo | null | undefined;
  readonly remoteBranchExists?: boolean | undefined;
  readonly isMergeCommitAncestor?: boolean | undefined;
  readonly packageVersionAtMergeSha?: string | null | undefined;
  readonly checkRuns?: readonly CheckRunInfo[] | undefined;
  readonly originSourceVersion?: string | null | undefined;
  readonly releaseBranchCommitVersion?: string | null | undefined;
  readonly isReleaseBranchPushed?: boolean | undefined;
}

export interface PlanOptions {
  readonly targetVersion: string;
  readonly sourceBranch: ReleaseBranch;
  readonly currentBranch?: string | undefined;
  readonly state: ReleaseState;
  readonly tag?: boolean | undefined;
  readonly sourcePr?: PrInfo | null | undefined;
  readonly mainPr?: PrInfo | null | undefined;
  readonly verifiedSha?: string | null | undefined;
  readonly remoteTagSha?: string | null | undefined;
  readonly localTagSha?: string | null | undefined;
  readonly isReleaseBranchPushed?: boolean | undefined;
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
// Helpers & Command Execution
// =============================================================================

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

export const execCommand = (
  cmd: string,
  opts: { silent?: boolean; timeout?: number } = {},
): string => {
  const timeout = opts.timeout ?? READ_COMMAND_TIMEOUT_MS;
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: opts.silent ? ["pipe", "pipe", "pipe"] : ["inherit", "pipe", "inherit"],
      timeout,
    }).trim();
  } catch (err: unknown) {
    const msg = execErrorMessage(err);
    throw new Error(`Command failed [timeout ${timeout}ms] (${cmd}): ${msg}`);
  }
};

const run = execCommand;

const log = (msg: string): void => console.log(`\n${msg}`);
const step = (n: number, msg: string): void => console.log(`\n[${n}] ${msg}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isBumpType = (s: string): s is BumpType =>
  (BUMP_TYPES as readonly string[]).includes(s);

const isReleaseBranch = (s: string): s is ReleaseBranch =>
  (RELEASE_BRANCHES as readonly string[]).includes(s);

// =============================================================================
// Pure Helpers
// =============================================================================

export const parseVersion = (version: string): ParsedVersion => {
  const match = VERSION_RE.exec(version);
  if (!match) throw new Error(`Invalid version '${version}'`);
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
};

export const bumpVersion = (version: string, part: BumpType): string => {
  const parsed = parseVersion(version);
  if (parsed.prerelease !== null) {
    throw new Error(
      `v${version} is a prerelease; name the stable release explicitly: bun run release ${parsed.major}.${parsed.minor}.${parsed.patch}`,
    );
  }
  switch (part) {
    case "patch":
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case "major":
      return `${parsed.major + 1}.0.0`;
  }
};

export const sourceBranchFor = (version: string): ReleaseBranch =>
  parseVersion(version).major >= 3 ? "next" : "staging";

export const resolveSourceBranch = (
  version: string,
  fromFlag: ReleaseBranch | null,
): ReleaseBranch => {
  const derived = sourceBranchFor(version);
  if (fromFlag && fromFlag !== derived) {
    throw new Error(`v${version} releases from '${derived}', not '${fromFlag}'`);
  }
  return derived;
};

export const assertStableRelease = (version: string): void => {
  if (parseVersion(version).prerelease !== null) {
    throw new Error("bun run release cuts a stable version; prereleases are tagged by hand");
  }
};

export const currentBranchLabel = (branch: string): string => branch || "detached HEAD";

export const assertCurrentBranch = (
  current: string,
  expected: ReleaseBranch,
  version: string,
): void => {
  const releaseBranch = releaseBranchFor(version);
  if (current !== expected && current !== releaseBranch) {
    throw new Error(
      `Must be on ${expected} to release v${version} (currently on '${currentBranchLabel(current)}')`,
    );
  }
};

export const releaseBranchFor = (version: string): string => `chore/release-${version}`;

export const compareVersions = (a: string, b: string): number => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return 0;
};

export const resolveNewVersion = (
  current: string,
  args: ReleaseArgs,
  opts: { allowSame?: boolean; isCurrentUntagged?: boolean; isTagPresent?: boolean } = {},
): string => {
  if (args.kind === "exact") {
    assertStableRelease(args.version);
    const comparison = compareVersions(args.version, current);
    if (comparison === 0 && opts.allowSame) {
      return args.version;
    }
    if (comparison <= 0) {
      throw new Error(`v${args.version} is not above the current v${current}`);
    }
    return args.version;
  }

  if (opts.isCurrentUntagged || (opts.allowSame && opts.isCurrentUntagged)) {
    return current;
  }

  const next = bumpVersion(current, args.bumpType);
  assertStableRelease(next);
  if (compareVersions(next, current) <= 0) {
    throw new Error(`v${next} is not above the current v${current}`);
  }
  return next;
};

// =============================================================================
// Fail-Closed Verifications & PR Identification
// =============================================================================

export const selectPullRequest = (
  candidates: readonly PrInfo[],
  head: string,
  base: string,
  targetVersion: string,
): PrInfo | null => {
  const filtered = candidates.filter(
    (pr) => pr.headRefName === head && pr.baseRefName === base,
  );

  for (const pr of filtered) {
    if (!pr.headRefOid) {
      throw new Error(
        `Pull request #${pr.number} (${head} → ${base}) returned no headRefOid from GitHub`,
      );
    }
    if (pr.packageVersion === null || pr.packageVersion === undefined) {
      throw new Error(
        `Could not determine package.json version for pull request #${pr.number} (${head} → ${base}) at commit ${pr.headRefOid}`,
      );
    }
  }

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

export const verifyCheckRuns = (
  checkRuns: readonly CheckRunInfo[],
  commitSha: string,
): { formattedEvidence: string } => {
  if (checkRuns.length === 0) {
    throw new Error(
      `Precondition failed: commit ${commitSha} has 0 check runs (required: ${REQUIRED_CHECK_NAMES.join(", ")})`,
    );
  }

  const uncompletedOrUnsuccessful = checkRuns.filter(
    (run) => run.status !== "completed" || run.conclusion !== "success",
  );

  const runsSummary = checkRuns
    .map((r) => `${r.name} (${r.status}${r.conclusion ? `/${r.conclusion}` : ""})`)
    .join(", ");

  if (uncompletedOrUnsuccessful.length > 0) {
    const list = uncompletedOrUnsuccessful
      .map((r) => `${r.name}: ${r.status} (${r.conclusion ?? "none"})`)
      .join("; ");
    throw new Error(
      `Precondition failed: commit ${commitSha} has non-successful check runs: [${list}] (all runs: [${runsSummary}])`,
    );
  }

  // A check run without app identity is unreadable evidence: stop
  const missingApp = checkRuns.filter((r) => !r.app || !r.app.slug);
  if (missingApp.length > 0) {
    const list = missingApp.map((r) => r.name).join(", ");
    throw new Error(
      `Precondition failed: commit ${commitSha} has check runs without app identity: [${list}]`,
    );
  }

  const successfulGhActionsNames = new Set(
    checkRuns
      .filter((r) => {
        const isGhActions = r.app?.slug === "github-actions";
        return isGhActions && r.status === "completed" && r.conclusion === "success";
      })
      .map((r) => r.name),
  );

  const missingRequired = REQUIRED_CHECK_NAMES.filter(
    (req) => !successfulGhActionsNames.has(req),
  );

  if (missingRequired.length > 0) {
    throw new Error(
      `Precondition failed: commit ${commitSha} is missing required successful GitHub Actions check runs: [${missingRequired.join(
        ", ",
      )}] (found runs: [${runsSummary}])`,
    );
  }

  const formattedEvidence = checkRuns
    .map((r) => `${r.name} (${r.conclusion})`)
    .join(", ");

  return { formattedEvidence };
};

// =============================================================================
// Release State Detection & Planning
// =============================================================================

export const detectReleaseState = (ctx: ReleaseContext): ReleaseState => {
  // 1. A blocked release stops immediately — dry-run and live both go through it
  if (ctx.blockingPr) {
    throw new Error(
      `A ${ctx.targetVersion} release cannot start while ${ctx.blockingPr.packageVersion ?? "prior version"}'s release (PR #${ctx.blockingPr.number}) is unmerged`,
    );
  }

  // 2. Remote tag verification (Finding 4)
  if (ctx.remoteTagSha) {
    if (!ctx.mainPr || ctx.mainPr.state !== "MERGED") {
      throw new Error(
        `Remote tag v${ctx.targetVersion} exists at ${ctx.remoteTagSha}, but no merged pull request into main was found to verify it against`,
      );
    }
    const mergeSha = ctx.mainPr.mergeCommitOid;
    if (!mergeSha) {
      throw new Error(`Merge commit for PR #${ctx.mainPr.number} could not be determined`);
    }
    if (ctx.remoteTagSha !== mergeSha) {
      throw new Error(
        `Remote tag v${ctx.targetVersion} points to ${ctx.remoteTagSha}, but verified merge commit from PR #${ctx.mainPr.number} is ${mergeSha}`,
      );
    }
    if (ctx.packageVersionAtMergeSha && ctx.packageVersionAtMergeSha !== ctx.targetVersion) {
      throw new Error(
        `package.json at merge commit ${mergeSha} is v${ctx.packageVersionAtMergeSha}, not target v${ctx.targetVersion}`,
      );
    }
    return "already-tagged";
  }

  // 3. Remote branch collision check (Finding 3)
  // Must be checked BEFORE any "version already equals target -> create-main-pr" shortcut
  if (ctx.remoteBranchExists && !ctx.sourcePr) {
    const branch = releaseBranchFor(ctx.targetVersion);
    const sourceBranch = ctx.sourceBranch ?? resolveSourceBranch(ctx.targetVersion, null);
    const resumeCmd = `gh pr create --base ${sourceBranch} --head ${branch} --title "chore(release): v${ctx.targetVersion}"`;
    throw new Error(
      `Remote branch ${branch} exists on origin, but no open or merged pull request matches it. ` +
        `If the previous release run was interrupted after pushing the release branch, verify that origin/${branch}'s ` +
        `package.json version is ${ctx.targetVersion} and its head commit subject is "chore(release): v${ctx.targetVersion}". ` +
        `If verified, resume by opening the pull request: '${resumeCmd}'. ` +
        `Otherwise, if it is a foreign or conflicting branch, delete or rename it before proceeding.`,
    );
  }

  // 4. Main PR verification
  if (ctx.mainPr) {
    if (ctx.mainPr.state === "CLOSED" && !ctx.mainPr.mergedAt) {
      throw new Error(
        `Pull request #${ctx.mainPr.number} (${ctx.mainPr.headRefName} → ${ctx.mainPr.baseRefName}) was closed without merging`,
      );
    }

    if (ctx.mainPr.state === "MERGED") {
      const mergeSha = ctx.mainPr.mergeCommitOid;
      if (!mergeSha) {
        throw new Error(`Merge commit for PR #${ctx.mainPr.number} could not be determined`);
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

      if (ctx.checkRuns) {
        verifyCheckRuns(ctx.checkRuns, mergeSha);
      } else if (ctx.tag) {
        throw new Error(
          `Cannot tag v${ctx.targetVersion}: no check runs available for commit ${mergeSha}`,
        );
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
      if (ctx.tag) {
        throw new Error(
          `Cannot tag v${ctx.targetVersion}: pull request #${ctx.mainPr.number} into main is still open`,
        );
      }
      return "await-main-pr";
    }
  }

  if (ctx.tag) {
    if (!ctx.mainPr) {
      throw new Error(`Cannot tag v${ctx.targetVersion}: no pull request into main found`);
    }
    throw new Error(`Cannot tag v${ctx.targetVersion}: main pull request is not merged`);
  }

  // If local tag exists but main PR is not merged, local tag is invalid
  if (ctx.localTagSha !== null && ctx.localTagSha !== undefined) {
    throw new Error(
      `Local tag v${ctx.targetVersion} exists at ${ctx.localTagSha}, but target version is not merged onto main`,
    );
  }

  // 5. Source PR checks
  if (ctx.sourcePr) {
    if (ctx.sourcePr.state === "CLOSED" && !ctx.sourcePr.mergedAt) {
      throw new Error(
        `Pull request #${ctx.sourcePr.number} (${ctx.sourcePr.headRefName} → ${ctx.sourcePr.baseRefName}) was closed without merging`,
      );
    }

    if (ctx.sourcePr.state === "MERGED") {
      if (ctx.originSourceVersion && ctx.originSourceVersion !== ctx.targetVersion) {
        throw new Error(
          `Pull request #${ctx.sourcePr.number} into ${ctx.sourceBranch ?? "source"} is merged, but origin/${ctx.sourceBranch ?? "source"} package.json is v${ctx.originSourceVersion}, not target v${ctx.targetVersion}`,
        );
      }
      return "create-main-pr";
    }

    if (ctx.sourcePr.state === "OPEN") {
      return "await-source-pr";
    }
  }

  // 6. Interrupted local release branch handling (Finding 3)
  const releaseBranch = releaseBranchFor(ctx.targetVersion);
  if (ctx.currentBranch && ctx.currentBranch === releaseBranch) {
    if (ctx.releaseBranchCommitVersion !== ctx.targetVersion) {
      throw new Error(
        `Release branch ${releaseBranch} is checked out, but release commit for v${ctx.targetVersion} is not committed. Switch to ${ctx.sourceBranch ?? "source branch"} or commit the release bump.`,
      );
    }
    if (ctx.isReleaseBranchPushed === false) {
      return "create-source-pr";
    }
  }

  // 7. Verify origin source branch before create-main-pr
  if (ctx.originSourceVersion) {
    if (ctx.originSourceVersion === ctx.targetVersion) {
      return "create-main-pr";
    }
  } else if (ctx.currentVersion === ctx.targetVersion) {
    return "create-main-pr";
  }

  return "create-source-pr";
};

export const planRelease = (opts: PlanOptions): readonly ReleaseStep[] => {
  const branch = releaseBranchFor(opts.targetVersion);
  const steps: ReleaseStep[] = [];
  const verifiedSha = opts.verifiedSha ?? "<sha>";
  const isTag = opts.tag === true;
  const onReleaseBranch = opts.currentBranch === branch;

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
      if (onReleaseBranch) {
        steps.push(
          { description: `Check out ${opts.sourceBranch}`, command: `git checkout ${opts.sourceBranch}` },
        );
      }
      steps.push(
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
      if (onReleaseBranch) {
        if (opts.isReleaseBranchPushed === false) {
          steps.push({ description: `Push branch ${branch}`, command: `git push origin ${branch}` });
        }
      } else {
        steps.push(
          { description: `Create and checkout branch ${branch}`, command: `git checkout -b ${branch}` },
          { description: `Bump version in package.json to ${opts.targetVersion}` },
          { description: `Update README.md version badge to v${opts.targetVersion}` },
          { description: "Update CHANGELOG.md stats" },
          { description: "Stage modified files", command: "git add package.json README.md CHANGELOG.md" },
          { description: "Commit release bump", command: `git commit -m "chore(release): v${opts.targetVersion}"` },
          { description: `Push branch ${branch}`, command: `git push origin ${branch}` },
        );
      }
      steps.push(
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
// CLI Args & File Rewrites
// =============================================================================

const takeFromValue = (value: string | undefined): ReleaseBranch => {
  if (value === undefined || !isReleaseBranch(value)) {
    throw new Error(USAGE);
  }
  return value;
};

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

const README_VERSION_RE =
  /\*\*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\*\*(?: \(prerelease on the npm `next` tag\))?/;

export const updateReadmeVersion = (readme: string, newVersion: string): string => {
  const next = readme.replace(README_VERSION_RE, `**v${newVersion}**`);
  if (next === readme) {
    throw new Error("README.md version marker not found");
  }
  return next;
};

export const updateChangelogStats = (changelog: string, statsLine: string): string =>
  changelog.replace(
    /\d+ commits? · \d+ days? · [A-Za-z]+ \d+ – [A-Za-z]+ \d+, \d{4}/,
    statsLine,
  );

// =============================================================================
// Remote Git & GitHub API Readers
// =============================================================================

export const parseLsRemoteTags = (output: string, tag: string): string | null => {
  const trimmed = output.trim();
  if (trimmed === "") return null;
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  let directSha: string | null = null;
  let peeledSha: string | null = null;
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2 || !/^[0-9a-f]{40}$/.test(parts[0]!)) {
      throw new Error(`Malformed git ls-remote tag output: ${JSON.stringify(line)}`);
    }
    const sha = parts[0]!;
    const ref = parts[1]!;
    if (ref === `refs/tags/${tag}^{}`) {
      peeledSha = sha;
    } else if (ref === `refs/tags/${tag}`) {
      directSha = sha;
    } else {
      throw new Error(`Unexpected ref in git ls-remote output for ${tag}: ${ref}`);
    }
  }
  return peeledSha ?? directSha;
};

export const getRemoteTag = (version: string): string | null => {
  const output = execCommand(
    `git ls-remote --tags origin refs/tags/v${version} "refs/tags/v${version}^{}"`,
    { silent: true },
  );
  return parseLsRemoteTags(output, `v${version}`);
};

export const getLocalTag = (version: string): string | null => {
  const list = execCommand(`git tag -l "v${version}"`, { silent: true });
  if (!list.split("\n").some((t) => t.trim() === `v${version}`)) {
    return null;
  }
  const rev = execCommand(`git rev-parse -q --verify refs/tags/v${version}^{commit}`, { silent: true });
  const trimmedRev = rev.trim();
  if (!/^[0-9a-f]{40}$/.test(trimmedRev)) {
    throw new Error(`Malformed git rev-parse output for local tag v${version}: ${JSON.stringify(rev)}`);
  }
  return trimmedRev;
};

export const parseRemoteBranchSha = (output: string, branch: string): string | null => {
  const trimmed = output.trim();
  if (trimmed === "") {
    return null;
  }
  const match = trimmed.match(/^([0-9a-f]{40})\s+/m);
  if (!match?.[1]) {
    throw new Error(
      `Malformed git ls-remote output for branch ${branch}: expected 40-hex SHA, got ${JSON.stringify(output)}`,
    );
  }
  return match[1];
};

export const getRemoteBranchSha = (branch: string): string | null => {
  const out = execCommand(`git ls-remote --heads origin "refs/heads/${branch}"`, { silent: true });
  return parseRemoteBranchSha(out, branch);
};

export const checkRemoteBranchExists = (branch: string): boolean => {
  return getRemoteBranchSha(branch) !== null;
};

export const parsePackageJsonVersion = (raw: string, source: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse package.json from ${source}: ${execErrorMessage(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid package.json from ${source}: expected object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "string" || !obj.version.trim()) {
    throw new Error(`package.json at ${source} does not contain a valid version string`);
  }
  return obj.version.trim();
};

export const readPackageVersionAtSha = (sha: string): string => {
  const cmd = `git show ${sha}:package.json`;
  try {
    const raw = execCommand(cmd, { silent: true });
    return parsePackageJsonVersion(raw, `commit ${sha}`);
  } catch (err: unknown) {
    const apiCmd = `gh api repos/floor/vlist/contents/package.json?ref=${sha} --jq .content`;
    try {
      const rawBase64 = execCommand(apiCmd, { silent: true });
      const decoded = Buffer.from(rawBase64, "base64").toString("utf8");
      return parsePackageJsonVersion(decoded, `commit ${sha} via api`);
    } catch (apiErr: unknown) {
      throw new Error(
        `Could not read package.json at commit ${sha} (tried '${cmd}' and '${apiCmd}'): ${execErrorMessage(
          err,
        )}; ${execErrorMessage(apiErr)}`,
      );
    }
  }
};

const CHECK_RUN_STATUSES = new Set([
  "completed",
  "in_progress",
  "queued",
  "waiting",
  "requested",
  "pending",
] as const);

export const parseCheckRunItem = (raw: unknown, cmd: string): CheckRunInfo => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid check run in response from ${cmd}: expected object`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string" || !obj.name.trim()) {
    throw new Error(`Invalid check run in response from ${cmd}: field 'name' is missing or empty`);
  }
  if (typeof obj.status !== "string" || !CHECK_RUN_STATUSES.has(obj.status as any)) {
    throw new Error(
      `Invalid check run in response from ${cmd}: field 'status' is missing or invalid (got ${String(obj.status)})`,
    );
  }
  if (obj.conclusion !== null && obj.conclusion !== undefined && typeof obj.conclusion !== "string") {
    throw new Error(`Invalid check run in response from ${cmd}: field 'conclusion' must be string or null`);
  }
  if (!obj.app || typeof obj.app !== "object" || Array.isArray(obj.app)) {
    throw new Error(
      `Invalid check run in response from ${cmd}: field 'app' is missing or not an object for check '${obj.name}'`,
    );
  }
  const appObj = obj.app as Record<string, unknown>;
  if (typeof appObj.slug !== "string" || !appObj.slug.trim()) {
    throw new Error(
      `Invalid check run in response from ${cmd}: field 'app.slug' is missing or empty for check '${obj.name}'`,
    );
  }

  return {
    name: obj.name,
    status: obj.status,
    conclusion: (obj.conclusion as string | null) ?? null,
    app: {
      slug: appObj.slug,
      name: typeof appObj.name === "string" ? appObj.name : undefined,
    },
  };
};

export const parseCheckRunsResponse = (
  raw: string,
  commitSha: string,
  cmd = "gh api",
): CheckRunInfo[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse check-runs API response (${cmd}): ${execErrorMessage(err)}`);
  }

  const pages = Array.isArray(parsed) ? parsed : [parsed];
  if (pages.length === 0) {
    throw new Error(`Invalid response from check-runs API for commit ${commitSha}: empty response (${cmd})`);
  }

  let expectedTotal: number | null = null;
  const allRuns: CheckRunInfo[] = [];

  for (const page of pages) {
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error(`Invalid response from check-runs API for commit ${commitSha}: page is not an object (${cmd})`);
    }
    const p = page as { total_count?: unknown; check_runs?: unknown };
    if (typeof p.total_count !== "number" || !Number.isInteger(p.total_count) || p.total_count < 0) {
      throw new Error(
        `Invalid response from check-runs API for commit ${commitSha}: missing total_count (${cmd})`,
      );
    }
    if (expectedTotal === null) {
      expectedTotal = p.total_count;
    } else if (p.total_count !== expectedTotal) {
      throw new Error(
        `Inconsistent check-runs API response for commit ${commitSha}: total_count mismatch across pages (${expectedTotal} vs ${p.total_count}) (${cmd})`,
      );
    }

    if (!Array.isArray(p.check_runs)) {
      throw new Error(
        `Invalid response from check-runs API for commit ${commitSha}: field 'check_runs' is not an array (${cmd})`,
      );
    }

    for (const item of p.check_runs) {
      allRuns.push(parseCheckRunItem(item, cmd));
    }
  }

  if (expectedTotal === null || allRuns.length < expectedTotal) {
    throw new Error(
      `Incomplete check-runs read for commit ${commitSha}: read ${allRuns.length} of ${expectedTotal ?? "unknown"} runs (${cmd})`,
    );
  }

  return allRuns;
};

export const fetchCheckRuns = (
  commitSha: string,
  owner = "floor",
  repo = "vlist",
): CheckRunInfo[] => {
  const cmd = `gh api --paginate --slurp repos/${owner}/${repo}/commits/${commitSha}/check-runs`;
  const raw = execCommand(cmd, { silent: true });
  return parseCheckRunsResponse(raw, commitSha, cmd);
};

const COMPARE_STATUSES = new Set(["ahead", "behind", "identical", "diverged"] as const);
type CompareStatus = "ahead" | "behind" | "identical" | "diverged";

export const parseCompareResponse = (
  raw: string,
  cmd: string,
): { status: CompareStatus; behind_by?: number | undefined; merge_base_commit?: { sha?: string } | undefined } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse GitHub compare API response (${cmd}): ${execErrorMessage(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid compare API response (${cmd}): expected object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.status !== "string" || !COMPARE_STATUSES.has(obj.status as CompareStatus)) {
    throw new Error(
      `Invalid compare API response (${cmd}): field 'status' is missing or invalid (got ${String(obj.status)})`,
    );
  }
  let merge_base_commit: { sha?: string } | undefined;
  if (obj.merge_base_commit && typeof obj.merge_base_commit === "object" && !Array.isArray(obj.merge_base_commit)) {
    const mbc = obj.merge_base_commit as { sha?: unknown };
    if (typeof mbc.sha === "string" && /^[0-9a-f]{40}$/i.test(mbc.sha)) {
      merge_base_commit = { sha: mbc.sha };
    }
  }
  return {
    status: obj.status as CompareStatus,
    behind_by: typeof obj.behind_by === "number" ? obj.behind_by : undefined,
    merge_base_commit,
  };
};

export const isCommitAncestorOfRemoteMain = (
  commitSha: string,
  owner = "floor",
  repo = "vlist",
): boolean => {
  const remoteMainSha = getRemoteBranchSha("main");
  if (!remoteMainSha) {
    throw new Error(`Could not determine remote main branch SHA via git ls-remote origin refs/heads/main`);
  }

  if (commitSha === remoteMainSha) {
    return true;
  }

  const cmd = `gh api repos/${owner}/${repo}/compare/${commitSha}...${remoteMainSha}`;
  const raw = execCommand(cmd, { silent: true });
  const parsed = parseCompareResponse(raw, cmd);

  if (parsed.status === "identical") return true;
  if (parsed.status === "ahead" && parsed.behind_by === 0) {
    return parsed.merge_base_commit?.sha === commitSha;
  }
  return false;
};

const PR_STATES = new Set(["OPEN", "MERGED", "CLOSED"] as const);
type PrState = "OPEN" | "MERGED" | "CLOSED";

export const parsePrCandidate = (raw: unknown, cmd: string): PrInfo => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid PR response from ${cmd}: expected object`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.number !== "number" || !Number.isInteger(obj.number) || obj.number <= 0) {
    throw new Error(`Invalid PR response from ${cmd}: field 'number' is missing or not a positive integer`);
  }
  if (typeof obj.title !== "string") {
    throw new Error(`Invalid PR response from ${cmd}: field 'title' is missing or not a string`);
  }
  if (typeof obj.state !== "string" || !PR_STATES.has(obj.state as PrState)) {
    throw new Error(
      `Invalid PR response from ${cmd}: field 'state' is missing or invalid (expected OPEN|MERGED|CLOSED, got ${String(obj.state)})`,
    );
  }
  if (typeof obj.headRefName !== "string" || !obj.headRefName.trim()) {
    throw new Error(`Invalid PR response from ${cmd}: field 'headRefName' is missing or empty`);
  }
  if (typeof obj.baseRefName !== "string" || !obj.baseRefName.trim()) {
    throw new Error(`Invalid PR response from ${cmd}: field 'baseRefName' is missing or empty`);
  }
  if (typeof obj.headRefOid !== "string" || !/^[0-9a-f]{40}$/i.test(obj.headRefOid)) {
    throw new Error(
      `Invalid PR response from ${cmd}: field 'headRefOid' is missing or not a 40-hex SHA (got ${String(obj.headRefOid)})`,
    );
  }
  if (obj.mergedAt !== null && obj.mergedAt !== undefined && typeof obj.mergedAt !== "string") {
    throw new Error(`Invalid PR response from ${cmd}: field 'mergedAt' must be string or null`);
  }
  let mergeCommitOid: string | null = null;
  if (obj.mergeCommit && typeof obj.mergeCommit === "object" && !Array.isArray(obj.mergeCommit)) {
    const mc = obj.mergeCommit as { oid?: unknown };
    if (mc.oid !== null && mc.oid !== undefined) {
      if (typeof mc.oid !== "string" || !/^[0-9a-f]{40}$/i.test(mc.oid)) {
        throw new Error(`Invalid PR response from ${cmd}: field 'mergeCommit.oid' is not a 40-hex SHA`);
      }
      mergeCommitOid = mc.oid;
    }
  } else if (obj.mergeCommitOid !== null && obj.mergeCommitOid !== undefined) {
    if (typeof obj.mergeCommitOid !== "string" || !/^[0-9a-f]{40}$/i.test(obj.mergeCommitOid)) {
      throw new Error(`Invalid PR response from ${cmd}: field 'mergeCommitOid' is not a 40-hex SHA`);
    }
    mergeCommitOid = obj.mergeCommitOid;
  }

  return {
    number: obj.number,
    title: obj.title,
    state: obj.state as PrState,
    headRefName: obj.headRefName,
    baseRefName: obj.baseRefName,
    headRefOid: obj.headRefOid,
    mergedAt: (obj.mergedAt as string | null) ?? null,
    mergeCommitOid,
    packageVersion: typeof obj.packageVersion === "string" ? obj.packageVersion : undefined,
  };
};

export const parsePrCandidatesResponse = (raw: string, cmd: string): PrInfo[] => {
  let parsedList: unknown;
  try {
    parsedList = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse PR list from GitHub (${cmd}): ${execErrorMessage(err)}`);
  }
  if (!Array.isArray(parsedList)) {
    throw new Error(`Invalid PR list response from GitHub (${cmd}): expected array`);
  }
  if (parsedList.length >= PR_QUERY_LIMIT) {
    throw new Error(
      `PR query (${cmd}) returned ${parsedList.length} results, which reaches the limit (${PR_QUERY_LIMIT}). Cannot guarantee all matching candidates were examined.`,
    );
  }
  return parsedList.map((item) => parsePrCandidate(item, cmd));
};

export const fetchPrCandidatesForBranches = (
  headBranch: string,
  baseBranch: string,
): PrInfo[] => {
  const cmd = `gh pr list --state all --head ${headBranch} --base ${baseBranch} --limit ${PR_QUERY_LIMIT} --json number,title,state,headRefName,baseRefName,headRefOid,mergedAt,mergeCommit`;
  const raw = execCommand(cmd, { silent: true });
  const candidates = parsePrCandidatesResponse(raw, cmd);
  return candidates.map((pr) => ({
    ...pr,
    packageVersion: readPackageVersionAtSha(pr.headRefOid),
  }));
};

export const fetchPrCandidates = (
  sourceBranch: ReleaseBranch,
  releaseBranch: string,
): PrInfo[] => {
  const sourceCandidates = fetchPrCandidatesForBranches(releaseBranch, sourceBranch);
  const mainCandidates = fetchPrCandidatesForBranches(sourceBranch, "main");
  return [...sourceCandidates, ...mainCandidates];
};

const waitForPrMerge = async (
  prNumber: number,
  description: string,
  targetVersion: string,
): Promise<void> => {
  log(`Waiting for PR #${prNumber} (${description}) to be merged (CI must pass)...`);
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    const prState = execCommand(`gh pr view ${prNumber} --json state --jq .state`, { silent: true });
    if (prState === "MERGED") {
      console.log(`\n  ✓ PR #${prNumber} merged`);
      return;
    }
    process.stdout.write(".");
  }
  throw new Error(
    `Timed out waiting for PR #${prNumber} (${description}) to merge. Merge it manually, then run:\n  bun run release ${targetVersion} --tag`,
  );
};

// =============================================================================
// Main Orchestration
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
  const currentBranch = run("git branch --show-current", { silent: true });

  try {
    newVersion = resolveNewVersion(oldVersion, args, {
      allowSame: true,
      isCurrentUntagged: isCurrentUntagged && args.kind === "bump",
      isTagPresent: !isCurrentUntagged,
    });
    sourceBranch = resolveSourceBranch(newVersion, args.from);
    releaseBranch = releaseBranchFor(newVersion);

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
  const remoteSourceSha = getRemoteBranchSha(sourceBranch);
  const originSourceVersion = remoteSourceSha ? readPackageVersionAtSha(remoteSourceSha) : null;

  let releaseBranchCommitVersion: string | null = null;
  let isReleaseBranchPushed: boolean | undefined = undefined;
  if (currentBranch === releaseBranch) {
    try {
      releaseBranchCommitVersion = readPackageVersionAtSha("HEAD");
    } catch {
      releaseBranchCommitVersion = null;
    }
    const localHeadSha = run("git rev-parse HEAD", { silent: true });
    const remoteReleaseBranchSha = getRemoteBranchSha(releaseBranch);
    isReleaseBranchPushed = remoteReleaseBranchSha === localHeadSha;
  }

  const candidates = fetchPrCandidates(sourceBranch, releaseBranch);
  const sourcePr = selectPullRequest(candidates, releaseBranch, sourceBranch, newVersion);
  const mainPr = selectPullRequest(candidates, sourceBranch, "main", newVersion);
  const blockingPr = detectBlockingPr(candidates, sourceBranch, newVersion);

  let isMergeCommitAncestor: boolean | undefined;
  let packageVersionAtMergeSha: string | null | undefined;
  let checkRuns: CheckRunInfo[] | undefined;
  let checkRunsEvidence = "";
  const mergeSha = mainPr?.mergeCommitOid;

  if (mainPr?.state === "MERGED" && mergeSha) {
    isMergeCommitAncestor = isCommitAncestorOfRemoteMain(mergeSha);
    packageVersionAtMergeSha = readPackageVersionAtSha(mergeSha);
    checkRuns = fetchCheckRuns(mergeSha);
    try {
      const verified = verifyCheckRuns(checkRuns, mergeSha);
      checkRunsEvidence = verified.formattedEvidence;
    } catch (err: unknown) {
      if (args.tag) throw err;
      checkRunsEvidence = checkRuns.map((r) => `${r.name} (${r.conclusion ?? r.status})`).join(", ");
    }
  }

  let state: ReleaseState;
  try {
    state = detectReleaseState({
      currentVersion: oldVersion,
      targetVersion: newVersion,
      remoteTagSha,
      localTagSha,
      sourceBranch,
      currentBranch,
      sourcePr,
      mainPr,
      blockingPr,
      remoteBranchExists,
      isMergeCommitAncestor,
      packageVersionAtMergeSha,
      checkRuns,
      originSourceVersion,
      releaseBranchCommitVersion,
      isReleaseBranchPushed,
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
      `Pull request #${mainPr.number} (${mainPr.headRefName} → ${mainPr.baseRefName}, ${newVersion}) is ${mainPr.state.toLowerCase()}` +
        (mainPr.state === "OPEN" ? ": wait for it to merge" : "") +
        (mainPr.headRefOid ? ` (head: ${mainPr.headRefOid.slice(0, 8)})` : ""),
    );
    if (mainPr.state === "MERGED" && mergeSha) {
      evidence.push(`Merge commit: ${mergeSha} (ancestor of origin/main: ${isMergeCommitAncestor ? "yes" : "no"})`);
      evidence.push(`package.json at merge commit: v${packageVersionAtMergeSha}`);
      evidence.push(`Check runs on merge commit: ${checkRunsEvidence}`);
    }
  }

  if (args.dryRun) {
    const plan = planRelease({
      targetVersion: newVersion,
      sourceBranch,
      currentBranch,
      state,
      tag: args.tag,
      verifiedSha: mergeSha,
      remoteTagSha,
      localTagSha,
      sourcePr,
      mainPr,
      isReleaseBranchPushed,
    });
    console.log(formatReleasePlan(newVersion, sourceBranch, state, plan, { evidence }));
    return;
  }

  const status = run("git status --porcelain", { silent: true });
  if (status) {
    console.error(`  ✗ Working tree is not clean — commit or stash changes first`);
    process.exit(1);
  }

  if (state === "already-tagged") {
    console.log(`  ✓ v${newVersion} is already released at verified commit ${remoteTagSha}.`);
    return;
  }

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

  // ── Step 1: Release commit on chore/release-X.Y.Z & PR into sourceBranch ──
  if (state === "create-source-pr") {
    if (currentBranch === releaseBranch) {
      if (isReleaseBranchPushed === false) {
        step(2, `Pushing release branch ${releaseBranch}...`);
        run(`git push origin ${releaseBranch}`);
        console.log(`  ✓ Pushed to ${releaseBranch}`);
      }
    } else {
      const localBranchExists = run(`git branch --list ${releaseBranch}`, { silent: true });
      if (localBranchExists) {
        console.error(
          `  ✗ Local branch ${releaseBranch} already exists from an earlier run.\n` +
            `    Switch to it (\`git checkout ${releaseBranch}\`) to continue, or delete it (\`git branch -D ${releaseBranch}\`) to restart from ${sourceBranch}.`,
        );
        process.exit(1);
      }

      run(`git pull origin ${sourceBranch}`, { silent: true });
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
    }

    const prUrl = run(
      `gh pr create --base ${sourceBranch} --head ${releaseBranch} --title "chore(release): v${newVersion}" --body "Release commit for v${newVersion}."`,
      { silent: true },
    );
    const prNumber = parseInt(prUrl.split("/").pop() ?? "0", 10);
    console.log(`  ✓ PR #${prNumber} created: ${prUrl}`);

    await waitForPrMerge(prNumber, `${releaseBranch} → ${sourceBranch}`, newVersion);
    run(`git checkout ${sourceBranch}`, { silent: true });
    run(`git pull origin ${sourceBranch}`, { silent: true });
  } else if (state === "await-source-pr") {
    const prNumber = sourcePr!.number;
    await waitForPrMerge(prNumber, `${releaseBranch} → ${sourceBranch}`, newVersion);
    run(`git checkout ${sourceBranch}`, { silent: true });
    run(`git pull origin ${sourceBranch}`, { silent: true });
  }

  // ── Step 2: PR source → main ───────────────────────────────────────────────
  let mainPrNumber: number | undefined;
  if (state === "create-source-pr" || state === "await-source-pr" || state === "create-main-pr") {
    if (currentBranch !== sourceBranch) {
      run(`git checkout ${sourceBranch}`, { silent: true });
      run(`git pull origin ${sourceBranch}`, { silent: true });
    }
    step(3, `Creating PR ${sourceBranch} → main...`);

    const prUrl = run(
      `gh pr create --base main --head ${sourceBranch} --title "chore(release): v${newVersion}" --body "Version bump to v${newVersion}."`,
      { silent: true },
    );
    mainPrNumber = parseInt(prUrl.split("/").pop() ?? "0", 10);
    console.log(`  ✓ PR #${mainPrNumber} created: ${prUrl}`);

    await waitForPrMerge(mainPrNumber, `${sourceBranch} → main`, newVersion);
  } else if (state === "await-main-pr") {
    mainPrNumber = mainPr!.number;
    await waitForPrMerge(mainPrNumber, `${sourceBranch} → main`, newVersion);
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
  if (!isCommitAncestorOfRemoteMain(freshMergeSha)) {
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
