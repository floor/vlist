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
  opts: { allowSame?: boolean; isCurrentUntagged?: boolean } = {},
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

  if (opts.isCurrentUntagged) {
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

  // Conflicting local tag vs remote tag: stop with both SHAs in every state
  if (ctx.remoteTagSha && ctx.localTagSha && ctx.remoteTagSha !== ctx.localTagSha) {
    throw new Error(
      `Local tag v${ctx.targetVersion} points to ${ctx.localTagSha}, but remote tag is at ${ctx.remoteTagSha}`,
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
// Declarative Schema Engine & Unified Reader
// =============================================================================

export type FieldType =
  | "string"
  | "non-empty-string"
  | "number"
  | "positive-integer"
  | "non-negative-integer"
  | "sha40"
  | "semver"
  | "boolean";

export interface FieldBase {
  readonly requiredWhen?: (obj: Record<string, unknown>) => boolean;
  readonly optionalReason?: string;
}

export interface ScalarFieldDef extends FieldBase {
  readonly kind: "scalar";
  readonly type: FieldType;
}

export interface EnumFieldDef extends FieldBase {
  readonly kind: "enum";
  readonly values: readonly string[];
}

export interface ObjectFieldDef extends FieldBase {
  readonly kind: "object";
  readonly schema: ObjectSchema;
}

export interface ArrayFieldDef extends FieldBase {
  readonly kind: "array";
  readonly elementSchema: ObjectSchema;
}

export type FieldDef = ScalarFieldDef | EnumFieldDef | ObjectFieldDef | ArrayFieldDef;

export interface ObjectSchema {
  readonly kind: "object";
  readonly name: string;
  readonly fields: Record<string, FieldDef>;
}

export interface ArraySchema {
  readonly kind: "array";
  readonly name: string;
  readonly elementSchema: ObjectSchema;
}

export interface CustomJsonSchema<T> {
  readonly kind: "custom-json";
  readonly name: string;
  readonly parse: (data: unknown, cmd: string) => T;
}

export interface TextSchema<T = string> {
  readonly kind: "text";
  readonly name: string;
  readonly parse: (raw: string, cmd: string) => T;
}

export type Schema<T = any> = ObjectSchema | ArraySchema | CustomJsonSchema<T> | TextSchema<T>;

const validateScalar = (value: unknown, type: FieldType, path: string, cmd: string): void => {
  if (type === "string" && typeof value !== "string") {
    throw new Error(`Invalid response from ${cmd}: field '${path}' expected string, got ${typeof value}`);
  }
  if (type === "non-empty-string" && (typeof value !== "string" || !value.trim())) {
    throw new Error(`Invalid response from ${cmd}: field '${path}' is missing or empty`);
  }
  if (type === "number" && (typeof value !== "number" || Number.isNaN(value))) {
    throw new Error(`Invalid response from ${cmd}: field '${path}' expected number, got ${typeof value}`);
  }
  if (type === "positive-integer" && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
    throw new Error(`Invalid response from ${cmd}: field '${path}' expected positive integer, got ${String(value)}`);
  }
  if (type === "non-negative-integer" && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
    throw new Error(`Invalid response from ${cmd}: field '${path}' expected non-negative integer, got ${String(value)}`);
  }
  if (type === "sha40" && (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value))) {
    throw new Error(`Invalid response from ${cmd}: field '${path}' is missing or not a 40-hex SHA (got ${String(value)})`);
  }
  if (type === "semver" && (typeof value !== "string" || !VERSION_RE.test(value.trim()))) {
    throw new Error(`Invalid response from ${cmd}: field '${path}' is missing or not a valid semver string (got ${String(value)})`);
  }
  if (type === "boolean" && typeof value !== "boolean") {
    throw new Error(`Invalid response from ${cmd}: field '${path}' expected boolean, got ${typeof value}`);
  }
};

export const validateValue = (
  raw: unknown,
  schema: ObjectSchema,
  cmd: string,
  parentPath = "",
): Record<string, any> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const at = parentPath ? ` at '${parentPath}'` : "";
    throw new Error(`Invalid response from ${cmd}: expected object${at}`);
  }
  const obj = raw as Record<string, unknown>;
  const result: Record<string, any> = {};

  for (const [key, def] of Object.entries(schema.fields)) {
    const fieldPath = parentPath ? `${parentPath}.${key}` : key;
    const value = obj[key];
    const isRequired = def.requiredWhen ? def.requiredWhen(obj) : !def.optionalReason;

    if (value === undefined || value === null) {
      if (isRequired) {
        throw new Error(`Invalid response from ${cmd}: field '${fieldPath}' is missing`);
      }
      result[key] = value ?? null;
      continue;
    }

    switch (def.kind) {
      case "scalar": {
        validateScalar(value, def.type, fieldPath, cmd);
        result[key] = value;
        break;
      }
      case "enum": {
        if (typeof value !== "string" || !def.values.includes(value)) {
          throw new Error(
            `Invalid response from ${cmd}: field '${fieldPath}' is invalid (got ${String(value)})`,
          );
        }
        result[key] = value;
        break;
      }
      case "object": {
        result[key] = validateValue(value, def.schema, cmd, fieldPath);
        break;
      }
      case "array": {
        if (!Array.isArray(value)) {
          throw new Error(`Invalid response from ${cmd}: field '${fieldPath}' is not an array`);
        }
        result[key] = value.map((item, idx) =>
          validateValue(item, def.elementSchema, cmd, `${fieldPath}[${idx}]`),
        );
        break;
      }
    }
  }

  return result;
};

export const validate = <T = any>(raw: string, schema: Schema<any>, cmd: string): T => {
  if (schema.kind === "text") {
    return schema.parse(raw, cmd) as unknown as T;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Failed to parse response from ${cmd}: ${execErrorMessage(err)}`);
  }
  if (schema.kind === "custom-json") {
    return schema.parse(parsed, cmd) as unknown as T;
  }
  if (schema.kind === "array") {
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid response from ${cmd}: expected array`);
    }
    return parsed.map((item, idx) =>
      validateValue(item, schema.elementSchema, cmd, `[${idx}]`),
    ) as unknown as T;
  }
  return validateValue(parsed, schema, cmd) as unknown as T;
};

export const read = <T = any>(
  cmd: string,
  schema: Schema<any>,
  opts: { timeout?: number } = {},
): T => {
  const raw = opts.timeout !== undefined
    ? execCommand(cmd, { silent: true, timeout: opts.timeout })
    : execCommand(cmd, { silent: true });
  return validate<T>(raw, schema, cmd);
};

// ── Declarative Schemas ──────────────────────────────────────────────────────

export const mergeCommitOidSchema: ObjectSchema = {
  kind: "object",
  name: "merge_commit",
  fields: {
    oid: { kind: "scalar", type: "sha40" },
  },
};

export const PR_STATES = ["OPEN", "MERGED", "CLOSED"] as const;
export type PrState = (typeof PR_STATES)[number];

export const prCandidateSchema: ObjectSchema = {
  kind: "object",
  name: "pr_candidate",
  fields: {
    number: { kind: "scalar", type: "positive-integer" },
    title: { kind: "scalar", type: "string" },
    state: {
      kind: "enum",
      values: PR_STATES,
    },
    headRefName: { kind: "scalar", type: "non-empty-string" },
    baseRefName: { kind: "scalar", type: "non-empty-string" },
    headRefOid: { kind: "scalar", type: "sha40" },
    mergedAt: {
      kind: "scalar",
      type: "string",
      requiredWhen: (obj) => obj.state === "MERGED",
      optionalReason: "required when state is MERGED, absent otherwise",
    },
    mergeCommit: {
      kind: "object",
      schema: mergeCommitOidSchema,
      requiredWhen: (obj) => obj.state === "MERGED",
      optionalReason: "required when state is MERGED, absent otherwise",
    },
  },
};

export const prCandidateListSchema: ArraySchema = {
  kind: "array",
  name: "pr_candidate_list",
  elementSchema: prCandidateSchema,
};

export const prStateSchema: ObjectSchema = {
  kind: "object",
  name: "pr_state",
  fields: {
    state: {
      kind: "enum",
      values: PR_STATES,
    },
  },
};

export const prMergeCommitSchema: ObjectSchema = {
  kind: "object",
  name: "pr_merge_commit",
  fields: {
    mergeCommit: {
      kind: "object",
      schema: mergeCommitOidSchema,
    },
  },
};

export const checkRunAppSchema: ObjectSchema = {
  kind: "object",
  name: "app",
  fields: {
    slug: { kind: "scalar", type: "non-empty-string" },
    name: { kind: "scalar", type: "string", optionalReason: "display only, GitHub API occasionally omits" },
  },
};

export const CHECK_RUN_STATUSES = ["queued", "in_progress", "completed"] as const;
export const CHECK_RUN_CONCLUSIONS = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "timed_out",
  "action_required",
  "skipped",
] as const;

export const checkRunItemSchema: ObjectSchema = {
  kind: "object",
  name: "check_run",
  fields: {
    name: { kind: "scalar", type: "non-empty-string" },
    status: {
      kind: "enum",
      values: CHECK_RUN_STATUSES,
    },
    conclusion: {
      kind: "enum",
      values: CHECK_RUN_CONCLUSIONS,
      requiredWhen: (obj) => obj.status === "completed",
      optionalReason: "required when status is completed, absent otherwise",
    },
    app: {
      kind: "object",
      schema: checkRunAppSchema,
    },
  },
};

export const checkRunsPageSchema: ObjectSchema = {
  kind: "object",
  name: "check_runs_page",
  fields: {
    total_count: { kind: "scalar", type: "non-negative-integer" },
    check_runs: {
      kind: "array",
      elementSchema: checkRunItemSchema,
    },
  },
};

export const checkRunsSlurpSchema = (commitSha: string): Schema<CheckRunInfo[]> => ({
  kind: "custom-json",
  name: "check_runs_slurp",
  parse: (parsed: unknown, cmd: string) => {
    const pagesRaw = Array.isArray(parsed) ? parsed : [parsed];
    if (pagesRaw.length === 0) {
      throw new Error(`Invalid response from check-runs API for commit ${commitSha}: empty response (${cmd})`);
    }
    let expectedTotal: number | null = null;
    const allRuns: CheckRunInfo[] = [];
    for (const pageRaw of pagesRaw) {
      const page = validateValue(pageRaw, checkRunsPageSchema, cmd) as {
        total_count: number;
        check_runs: CheckRunInfo[];
      };
      if (expectedTotal === null) {
        expectedTotal = page.total_count;
      } else if (page.total_count !== expectedTotal) {
        throw new Error(
          `Inconsistent check-runs API response for commit ${commitSha}: total_count mismatch across pages (${expectedTotal} vs ${page.total_count}) (${cmd})`,
        );
      }
      allRuns.push(...page.check_runs);
    }
    if (expectedTotal === null || allRuns.length < expectedTotal) {
      throw new Error(
        `Incomplete check-runs read for commit ${commitSha}: read ${allRuns.length} of ${expectedTotal ?? "unknown"} runs (${cmd})`,
      );
    }
    return allRuns;
  },
});

export const COMPARE_STATUSES = ["ahead", "behind", "identical", "diverged"] as const;
export type CompareStatus = (typeof COMPARE_STATUSES)[number];

export const compareSchema: ObjectSchema = {
  kind: "object",
  name: "compare",
  fields: {
    status: {
      kind: "enum",
      values: COMPARE_STATUSES,
    },
    ahead_by: { kind: "scalar", type: "non-negative-integer" },
    behind_by: { kind: "scalar", type: "non-negative-integer" },
    merge_base_commit: {
      kind: "object",
      schema: {
        kind: "object",
        name: "merge_base_commit",
        fields: {
          sha: { kind: "scalar", type: "sha40" },
        },
      },
    },
  },
};

export const packageJsonSchema: ObjectSchema = {
  kind: "object",
  name: "package_json",
  fields: {
    version: { kind: "scalar", type: "semver" },
  },
};

export const ghContentSchema: ObjectSchema = {
  kind: "object",
  name: "gh_content",
  fields: {
    content: { kind: "scalar", type: "string" },
  },
};

// ── Text / Line Readers ──────────────────────────────────────────────────────

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
  const cmd = `git ls-remote --tags origin refs/tags/v${version} "refs/tags/v${version}^{}"`;
  return read(cmd, {
    kind: "text",
    name: "ls_remote_tag",
    parse: (raw) => parseLsRemoteTags(raw, `v${version}`),
  });
};

export const getLocalTag = (version: string): string | null => {
  const list = read<string>(`git tag -l "v${version}"`, {
    kind: "text",
    name: "git_tag_list",
    parse: (raw: string) => raw.trim(),
  });
  if (!list.split("\n").some((t: string) => t.trim() === `v${version}`)) {
    return null;
  }
  return read<string>(`git rev-parse -q --verify refs/tags/v${version}^{commit}`, {
    kind: "text",
    name: "rev_parse_tag",
    parse: (raw: string) => {
      const trimmedRev = raw.trim();
      if (!/^[0-9a-f]{40}$/.test(trimmedRev)) {
        throw new Error(`Malformed git rev-parse output for local tag v${version}: ${JSON.stringify(raw)}`);
      }
      return trimmedRev;
    },
  });
};

export const parseRemoteBranchSha = (output: string, branch: string): string | null => {
  const trimmed = output.trim();
  if (trimmed === "") return null;
  const match = trimmed.match(/^([0-9a-f]{40})\s+/m);
  if (!match?.[1]) {
    throw new Error(
      `Malformed git ls-remote output for branch ${branch}: expected 40-hex SHA, got ${JSON.stringify(output)}`,
    );
  }
  return match[1];
};

export const getRemoteBranchSha = (branch: string): string | null => {
  const cmd = `git ls-remote --heads origin "refs/heads/${branch}"`;
  return read(cmd, {
    kind: "text",
    name: "ls_remote_branch",
    parse: (raw) => parseRemoteBranchSha(raw, branch),
  });
};

export const checkRemoteBranchExists = (branch: string): boolean => {
  return getRemoteBranchSha(branch) !== null;
};

export const parsePackageJsonVersion = (raw: string, source: string): string => {
  const v = validate(raw, packageJsonSchema, `package.json at ${source}`);
  return v.version;
};

export const readPackageVersionAtSha = (sha: string): string => {
  const cmd = `git show ${sha}:package.json`;
  try {
    const { version } = read(cmd, packageJsonSchema);
    return version;
  } catch (err: unknown) {
    const apiCmd = `gh api repos/floor/vlist/contents/package.json?ref=${sha}`;
    try {
      const { content: rawBase64 } = read(apiCmd, ghContentSchema);
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

export const parseCheckRunItem = (raw: unknown, cmd: string): CheckRunInfo => {
  const v = validateValue(raw, checkRunItemSchema, cmd);
  return {
    name: v.name,
    status: v.status,
    conclusion: v.conclusion ?? null,
    app: {
      slug: v.app.slug,
      name: typeof v.app.name === "string" ? v.app.name : undefined,
    },
  };
};

export const parseCheckRunsResponse = (
  raw: string,
  commitSha: string,
  cmd = "gh api",
): CheckRunInfo[] => {
  return validate(raw, checkRunsSlurpSchema(commitSha), cmd);
};

export const fetchCheckRuns = (
  commitSha: string,
  owner = "floor",
  repo = "vlist",
): CheckRunInfo[] => {
  const cmd = `gh api --paginate --slurp repos/${owner}/${repo}/commits/${commitSha}/check-runs`;
  return read(cmd, checkRunsSlurpSchema(commitSha));
};

export const parseCompareResponse = (
  raw: string,
  cmd: string,
): { status: CompareStatus; ahead_by: number; behind_by: number; merge_base_commit: { sha: string } } => {
  return validate(raw, compareSchema, cmd);
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
  const parsed = read(cmd, compareSchema);

  if (parsed.status === "identical") return true;
  if (parsed.status === "ahead" && parsed.behind_by === 0) {
    return parsed.merge_base_commit.sha === commitSha;
  }
  return false;
};

export const parsePrCandidate = (raw: unknown, cmd: string): PrInfo => {
  const v = validateValue(raw, prCandidateSchema, cmd);
  return {
    number: v.number,
    title: v.title,
    state: v.state,
    headRefName: v.headRefName,
    baseRefName: v.baseRefName,
    headRefOid: v.headRefOid,
    mergedAt: v.mergedAt ?? null,
    mergeCommitOid: v.mergeCommit?.oid ?? null,
    packageVersion: typeof v.packageVersion === "string" ? v.packageVersion : undefined,
  };
};

export const parsePrCandidatesResponse = (raw: string, cmd: string): PrInfo[] => {
  const list = validate(raw, prCandidateListSchema, cmd);
  if (list.length >= PR_QUERY_LIMIT) {
    throw new Error(
      `PR query (${cmd}) returned ${list.length} results, which reaches the limit (${PR_QUERY_LIMIT}). Cannot guarantee all matching candidates were examined.`,
    );
  }
  return list.map((item: any) => parsePrCandidate(item, cmd));
};

export const fetchPrCandidatesForBranches = (
  headBranch: string,
  baseBranch: string,
): PrInfo[] => {
  const cmd = `gh pr list --state all --head ${headBranch} --base ${baseBranch} --limit ${PR_QUERY_LIMIT} --json number,title,state,headRefName,baseRefName,headRefOid,mergedAt,mergeCommit`;
  const rawList = read(cmd, prCandidateListSchema) as Array<{
    number: number;
    title: string;
    state: PrState;
    headRefName: string;
    baseRefName: string;
    headRefOid: string;
    mergedAt: string | null;
    mergeCommit: { oid: string } | null;
  }>;
  return rawList.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    headRefOid: pr.headRefOid,
    mergedAt: pr.mergedAt ?? null,
    mergeCommitOid: pr.mergeCommit?.oid ?? null,
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
    const { state: prState } = read(`gh pr view ${prNumber} --json state`, prStateSchema);
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

  const { version: oldVersion } = read("cat package.json", packageJsonSchema);
  const currentRemoteTagSha = getRemoteTag(oldVersion);
  const isCurrentUntagged = currentRemoteTagSha === null;

  let newVersion: string;
  let sourceBranch: ReleaseBranch;
  let releaseBranch: string;
  const currentBranch = read("git branch --show-current", {
    kind: "text",
    name: "git_current_branch",
    parse: (raw) => raw.trim(),
  });

  try {
    newVersion = resolveNewVersion(oldVersion, args, {
      allowSame: true,
      isCurrentUntagged: isCurrentUntagged && args.kind === "bump",
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

<<<<<<< HEAD
      const pkgContent = read("cat package.json", { kind: "text", name: "cat_package_json", parse: (raw) => raw });
      const updatedPkg = pkgContent.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
      await Bun.write("package.json", updatedPkg);
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
  const { mergeCommit: freshMergeCommit } = read(
    `gh pr view ${mainPrNumber} --json mergeCommit`,
    prMergeCommitSchema,
  );
  const freshMergeSha = freshMergeCommit.oid;
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
