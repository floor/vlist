/**
 * vlist — Release script
 *
 * The 3.0 line integrates on `next` and the 2.x line stays on `staging`.
 * These tests pin the branch derivation, the explicit stable release of a
 * prerelease, and the README rewrite — so cutting 3.0.0 cannot fail at the
 * first guard again, and cannot happen by a bare `bun run release` either.
 */

import { describe, expect, it } from "bun:test";
import {
  USAGE,
  assertCurrentBranch,
  assertStableRelease,
  bumpVersion,
  compareVersions,
  currentBranchLabel,
  detectBlockingPr,
  detectReleaseState,
  execErrorMessage,
  formatReleasePlan,
  parseArgs,
  parseLsRemoteTags,
  parseVersion,
  planRelease,
  releaseBranchFor,
  resolveNewVersion,
  resolveSourceBranch,
  selectPullRequest,
  sourceBranchFor,
  updateChangelogStats,
  updateReadmeVersion,
  verifyCheckRuns,
} from "../../scripts/release";

describe("parseVersion", () => {
  it("parses a stable version", () => {
    expect(parseVersion("2.8.1")).toEqual({
      major: 2,
      minor: 8,
      patch: 1,
      prerelease: null,
    });
  });

  it("parses a prerelease suffix", () => {
    expect(parseVersion("3.0.0-next.2")).toEqual({
      major: 3,
      minor: 0,
      patch: 0,
      prerelease: "next.2",
    });
  });

  it("rejects a non-semver string", () => {
    expect(() => parseVersion("v3.0.0")).toThrow("Invalid version 'v3.0.0'");
    expect(() => parseVersion("3")).toThrow("Invalid version '3'");
  });
});

describe("bumpVersion", () => {
  it("increments a stable patch, minor, and major", () => {
    expect(bumpVersion("2.8.1", "patch")).toBe("2.8.2");
    expect(bumpVersion("2.8.1", "minor")).toBe("2.9.0");
    expect(bumpVersion("2.8.1", "major")).toBe("3.0.0");
  });

  it("refuses to bump a prerelease and names the explicit command", () => {
    for (const part of ["patch", "minor", "major"] as const) {
      expect(() => bumpVersion("3.0.0-next.2", part)).toThrow(
        "v3.0.0-next.2 is a prerelease; name the stable release explicitly: bun run release 3.0.0",
      );
    }
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("3.0.0", "2.8.1")).toBeGreaterThan(0);
    expect(compareVersions("2.9.0", "2.10.0")).toBeLessThan(0);
    expect(compareVersions("2.8.1", "2.8.1")).toBe(0);
  });

  it("puts a stable version above its own prereleases", () => {
    expect(compareVersions("3.0.0", "3.0.0-next.2")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0-next.2", "3.0.0")).toBeLessThan(0);
    expect(compareVersions("2.8.1", "3.0.0-next.2")).toBeLessThan(0);
  });
});

describe("sourceBranchFor", () => {
  it("sends 2.x through staging and 3.x through next", () => {
    expect(sourceBranchFor("2.8.1")).toBe("staging");
    expect(sourceBranchFor("2.8.2")).toBe("staging");
    expect(sourceBranchFor("3.0.0")).toBe("next");
    expect(sourceBranchFor("3.0.0-next.2")).toBe("next");
    expect(sourceBranchFor("4.0.0")).toBe("next");
  });
});

describe("resolveSourceBranch", () => {
  it("derives the branch when --from is omitted", () => {
    expect(resolveSourceBranch("3.0.0", null)).toBe("next");
    expect(resolveSourceBranch("2.8.2", null)).toBe("staging");
  });

  it("accepts --from when it matches the derived branch", () => {
    expect(resolveSourceBranch("3.0.0", "next")).toBe("next");
    expect(resolveSourceBranch("2.8.2", "staging")).toBe("staging");
  });

  it("refuses to cut 3.x from staging or 2.x from next", () => {
    expect(() => resolveSourceBranch("3.0.0", "staging")).toThrow(
      "v3.0.0 releases from 'next', not 'staging'",
    );
    expect(() => resolveSourceBranch("2.8.2", "next")).toThrow(
      "v2.8.2 releases from 'staging', not 'next'",
    );
  });
});

describe("assertCurrentBranch", () => {
  it("accepts the source branch", () => {
    expect(() => assertCurrentBranch("next", "next", "3.0.0")).not.toThrow();
    expect(() => assertCurrentBranch("staging", "staging", "2.8.2")).not.toThrow();
  });

  it("refuses staging when cutting 3.0.0", () => {
    expect(() => assertCurrentBranch("staging", "next", "3.0.0")).toThrow(
      "Must be on next to release v3.0.0 (currently on 'staging')",
    );
  });

  it("names detached HEAD instead of an empty branch", () => {
    expect(currentBranchLabel("")).toBe("detached HEAD");
    expect(() => assertCurrentBranch("", "next", "3.0.0")).toThrow(
      "Must be on next to release v3.0.0 (currently on 'detached HEAD')",
    );
  });
});

describe("assertStableRelease", () => {
  it("allows a stable cut", () => {
    expect(() => assertStableRelease("3.0.0")).not.toThrow();
  });

  it("rejects tagging a prerelease through the release script", () => {
    expect(() => assertStableRelease("3.0.0-next.3")).toThrow(
      "bun run release cuts a stable version; prereleases are tagged by hand",
    );
  });
});

describe("resolveNewVersion", () => {
  it("defaults a 2.x patch bump", () => {
    expect(resolveNewVersion("2.8.1", { kind: "bump", bumpType: "patch", from: null })).toBe(
      "2.8.2",
    );
  });

  it("will not cut 3.0.0 from a bare bump on a prerelease", () => {
    expect(() =>
      resolveNewVersion("3.0.0-next.2", { kind: "bump", bumpType: "patch", from: null }),
    ).toThrow("name the stable release explicitly");
  });

  it("refuses a version that is not above the current one", () => {
    expect(() => resolveNewVersion("2.8.1", { kind: "exact", version: "2.8.1", from: null })).toThrow(
      "v2.8.1 is not above the current v2.8.1",
    );
    expect(() => resolveNewVersion("2.8.1", { kind: "exact", version: "2.8.0", from: null })).toThrow(
      "is not above",
    );
  });

  it("accepts an exact stable version", () => {
    expect(resolveNewVersion("3.0.0-next.2", { kind: "exact", version: "3.0.0", from: "next" })).toBe(
      "3.0.0",
    );
  });

  it("rejects an exact prerelease", () => {
    expect(() =>
      resolveNewVersion("3.0.0-next.2", { kind: "exact", version: "3.0.0-next.3", from: null }),
    ).toThrow("bun run release cuts a stable version; prereleases are tagged by hand");
  });
});

describe("parseArgs", () => {
  it("defaults to a patch bump with no --from", () => {
    expect(parseArgs([])).toEqual({ kind: "bump", bumpType: "patch", from: null, dryRun: false, tag: false });
  });

  it("parses bump types and --from in either order", () => {
    expect(parseArgs(["minor"])).toEqual({ kind: "bump", bumpType: "minor", from: null, dryRun: false, tag: false });
    expect(parseArgs(["major", "--from", "next"])).toEqual({
      kind: "bump",
      bumpType: "major",
      from: "next",
      dryRun: false,
      tag: false,
    });
    expect(parseArgs(["--from", "staging", "patch"])).toEqual({
      kind: "bump",
      bumpType: "patch",
      from: "staging",
      dryRun: false,
      tag: false,
    });
    expect(parseArgs(["--from=next"])).toEqual({ kind: "bump", bumpType: "patch", from: "next", dryRun: false, tag: false });
  });

  it("parses an exact version", () => {
    expect(parseArgs(["3.0.0"])).toEqual({ kind: "exact", version: "3.0.0", from: null, dryRun: false, tag: false });
    expect(parseArgs(["3.0.0", "--from", "next"])).toEqual({
      kind: "exact",
      version: "3.0.0",
      from: "next",
      dryRun: false,
      tag: false,
    });
  });

  it("parses --tag flag", () => {
    expect(parseArgs(["--tag"])).toEqual({
      kind: "bump",
      bumpType: "patch",
      from: null,
      dryRun: false,
      tag: true,
    });
    expect(parseArgs(["3.1.3", "--tag"])).toEqual({
      kind: "exact",
      version: "3.1.3",
      from: null,
      dryRun: false,
      tag: true,
    });
    expect(parseArgs(["3.1.3", "--tag", "--dry-run"])).toEqual({
      kind: "exact",
      version: "3.1.3",
      from: null,
      dryRun: true,
      tag: true,
    });
  });

  it("rejects unknown flags, extra positionals, and a bare --from", () => {
    expect(() => parseArgs(["foo"])).toThrow(USAGE);
    expect(() => parseArgs(["patch", "minor"])).toThrow(USAGE);
    expect(() => parseArgs(["--from"])).toThrow(USAGE);
    expect(() => parseArgs(["--from", "main"])).toThrow(USAGE);
  });
});

describe("updateReadmeVersion", () => {
  it("rewrites the 2.x changelog badge", () => {
    const readme = "**v2.8.1** — [Changelog](CHANGELOG.md)\n";
    expect(updateReadmeVersion(readme, "2.8.2")).toBe("**v2.8.2** — [Changelog](CHANGELOG.md)\n");
  });

  it("graduates the 3.0 prerelease marker and drops the leftover note", () => {
    const readme =
      "**v3.0.0-next.2** (prerelease on the npm `next` tag) — Native scrolling by default.\n";
    expect(updateReadmeVersion(readme, "3.0.0")).toBe(
      "**v3.0.0** — Native scrolling by default.\n",
    );
  });

  it("matches the current README.md version marker", async () => {
    // A version the README can never already carry: the function refuses a
    // no-op rewrite as "marker not found", and this test read the live README
    // with "3.0.0" -- green through every prerelease, red the minute the
    // release commit made the README say **v3.0.0**. It failed the release
    // PR's own CI (2026-09-25).
    const readme = await Bun.file("README.md").text();
    const next = updateReadmeVersion(readme, "999.0.0");
    expect(next).toContain("**v999.0.0**");
    expect(next).not.toMatch(/\*\*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\*\* \(prerelease/);
  });

  it("throws when the marker is missing", () => {
    expect(() => updateReadmeVersion("# vlist\n", "3.0.0")).toThrow(
      "README.md version marker not found",
    );
  });
});

describe("updateChangelogStats", () => {
  it("replaces a header stats line", () => {
    const changelog = "577 commits · 83 days · Feb 2 – Apr 27, 2026\n\n## [Unreleased]\n";
    expect(updateChangelogStats(changelog, "600 commits · 90 days · Feb 2 – May 4, 2026")).toBe(
      "600 commits · 90 days · Feb 2 – May 4, 2026\n\n## [Unreleased]\n",
    );
  });

  it("leaves the changelog unchanged when there is no stats line", async () => {
    const changelog = await Bun.file("CHANGELOG.md").text();
    expect(updateChangelogStats(changelog, "1 commits · 1 days · Jan 1 – Jan 2, 2026")).toBe(
      changelog,
    );
  });
});

describe("execErrorMessage", () => {
  it("prefers stderr from a failed command", () => {
    expect(execErrorMessage({ stderr: "  boom  ", message: "ignored" })).toBe("boom");
    expect(execErrorMessage(new Error("fallback"))).toBe("fallback");
    expect(execErrorMessage("plain")).toBe("plain");
  });
});

describe("releaseBranchFor", () => {
  it("names the release branch from the target version", () => {
    expect(releaseBranchFor("3.1.3")).toBe("chore/release-3.1.3");
    expect(releaseBranchFor("2.8.2")).toBe("chore/release-2.8.2");
  });
});

describe("parseArgs — --dry-run", () => {
  it("defaults dryRun to false", () => {
    expect(parseArgs([])).toEqual({ kind: "bump", bumpType: "patch", from: null, dryRun: false, tag: false });
  });

  it("parses --dry-run with bump types, exact versions, and --from", () => {
    expect(parseArgs(["--dry-run"])).toEqual({
      kind: "bump",
      bumpType: "patch",
      from: null,
      dryRun: true,
      tag: false,
    });
    expect(parseArgs(["3.1.3", "--dry-run"])).toEqual({
      kind: "exact",
      version: "3.1.3",
      from: null,
      dryRun: true,
      tag: false,
    });
    expect(parseArgs(["--dry-run", "minor", "--from", "next"])).toEqual({
      kind: "bump",
      bumpType: "minor",
      from: "next",
      dryRun: true,
      tag: false,
    });
  });
});

describe("detectReleaseState", () => {
  it("detects already-tagged when tag exists on main matching verified merge commit", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: "b626354e1d91e73ecbe4adbd2c81a49e4611c0bd",
        localTagSha: null,
        mainPr: {
          number: 360,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "b626354e1d91e73ecbe4adbd2c81a49e4611c0bd",
          packageVersion: "3.1.3",
        },
        packageVersionAtMergeSha: "3.1.3",
      }),
    ).toBe("already-tagged");
  });

  it("detects tag-release when PR into main is merged", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 360,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
          packageVersion: "3.1.3",
        },
      }),
    ).toBe("tag-release");
  });

  it("detects await-main-pr when PR into main is open", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 360,
          title: "chore(release): v3.1.3",
          state: "OPEN",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          packageVersion: "3.1.3",
        },
      }),
    ).toBe("await-main-pr");
  });

  it("detects create-main-pr when step 1 merged or package.json is already at target version", () => {
    // Case A: source PR merged
    expect(
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        sourcePr: {
          number: 359,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "chore/release-3.1.3",
          baseRefName: "next",
          headRefOid: "111",
          packageVersion: "3.1.3",
        },
      }),
    ).toBe("create-main-pr");

    // Case B: package.json on sourceBranch already at targetVersion
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
      }),
    ).toBe("create-main-pr");
  });

  it("detects await-source-pr when PR into source branch is open", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        sourcePr: {
          number: 359,
          title: "chore(release): v3.1.3",
          state: "OPEN",
          headRefName: "chore/release-3.1.3",
          baseRefName: "next",
          headRefOid: "111",
          packageVersion: "3.1.3",
        },
      }),
    ).toBe("await-source-pr");
  });

  it("detects create-source-pr on fresh run", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
      }),
    ).toBe("create-source-pr");
  });
});

describe("planRelease", () => {
  it("plans create-source-pr: pushes release branch, never the source branch directly, and never tags without --tag", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "create-source-pr",
    });
    const commands = steps.map((s) => s.command).filter(Boolean);

    // Verifies it cuts chore/release-3.1.3
    expect(commands).toContain("git checkout -b chore/release-3.1.3");
    // Verifies it pushes chore/release-3.1.3
    expect(commands).toContain("git push origin chore/release-3.1.3");
    // CRITICAL: Verifies it NEVER pushes next directly!
    expect(commands).not.toContain("git push origin next");
    // Verifies PR chore/release-3.1.3 -> next is opened
    expect(
      commands.some((c) => c?.includes("gh pr create --base next --head chore/release-3.1.3")),
    ).toBe(true);
    // Verifies PR next -> main is opened
    expect(
      commands.some((c) => c?.includes("gh pr create --base main --head next")),
    ).toBe(true);
    // Verifies NO tag commands without --tag
    expect(commands.some((c) => c?.startsWith("git tag"))).toBe(false);
    expect(commands.some((c) => c?.startsWith("git push origin v"))).toBe(false);
    expect(steps.some((s) => s.description.includes("bun run release 3.1.3 --tag"))).toBe(true);
  });

  it("plans create-main-pr when resuming with package.json already bumped", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "create-main-pr",
    });
    const commands = steps.map((s) => s.command).filter(Boolean);

    // Does NOT cut chore/release-3.1.3 or push it again
    expect(commands).not.toContain("git checkout -b chore/release-3.1.3");
    expect(commands).not.toContain("git push origin chore/release-3.1.3");
    // Opens PR next -> main
    expect(
      commands.some((c) => c?.includes("gh pr create --base main --head next")),
    ).toBe(true);
    // Verifies NO tag commands without --tag
    expect(commands.some((c) => c?.startsWith("git tag"))).toBe(false);
    expect(steps.some((s) => s.description.includes("bun run release 3.1.3 --tag"))).toBe(true);
  });

  it("plans tag-release without --tag: prompts to run with --tag and issues no tag command", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
    });
    const commands = steps.map((s) => s.command).filter(Boolean);
    expect(commands).toEqual([]);
    expect(steps[0]?.description).toContain("Run 'bun run release 3.1.3 --tag' to tag and push");
  });

  it("plans tag-release with --tag: issues annotated tag and push commands", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
      tag: true,
      verifiedSha: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
    });
    const commands = steps.map((s) => s.command).filter(Boolean);
    expect(commands).toEqual([
      "git checkout main",
      "git pull origin main",
      "git tag -a v3.1.3 425ecd4b9d6de757f5678a27df9da0fa7ec27b66 -m v3.1.3",
      "git push origin v3.1.3",
      "git checkout next",
    ]);
  });
});

describe("formatReleasePlan", () => {
  it("formats plan with state and numbered commands when --tag is passed", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
      tag: true,
      verifiedSha: "425ecd4b",
    });
    const formatted = formatReleasePlan("3.1.3", "next", "tag-release", steps);
    expect(formatted).toContain("Release plan for v3.1.3 (from next)");
    expect(formatted).toContain("State: tag-release");
    expect(formatted).toContain("git tag -a v3.1.3");
  });

  it("formats plan prompting for --tag when no flag is passed", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
      verifiedSha: "425ecd4b",
    });
    const formatted = formatReleasePlan("3.1.3", "next", "tag-release", steps);
    expect(formatted).toContain("Release plan for v3.1.3 (from next)");
    expect(formatted).toContain("State: tag-release");
    expect(formatted).toContain("bun run release 3.1.3 --tag");
  });
});

describe("resolveNewVersion — re-entrancy", () => {
  it("picks up current version when package.json is already at target version", () => {
    // When resuming with exact version matching current package.json
    expect(
      resolveNewVersion(
        "3.1.3",
        { kind: "exact", version: "3.1.3", from: "next", dryRun: false },
        { allowSame: true },
      ),
    ).toBe("3.1.3");

    // When resuming with bump but current package.json is untagged
    expect(
      resolveNewVersion(
        "3.1.3",
        { kind: "bump", bumpType: "patch", from: "next", dryRun: false },
        { isCurrentUntagged: true },
      ),
    ).toBe("3.1.3");
  });

  it("refuses if the target version is already tagged", () => {
    expect(() =>
      resolveNewVersion(
        "3.1.3",
        { kind: "exact", version: "3.1.3", from: "next", dryRun: false },
        { allowSame: true, isTagPresent: true },
      ),
    ).toThrow("already tagged");
  });
});

describe("pull request identification (fail-closed)", () => {
  it("target ≠ the open main pull request's version: does not attach", () => {
    const candidates = [
      {
        number: 360,
        title: "chore(release): v3.1.2",
        state: "OPEN" as const,
        headRefName: "next",
        baseRefName: "main",
        headRefOid: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
        mergedAt: null,
        packageVersion: "3.1.2",
      },
    ];
    expect(selectPullRequest(candidates, "next", "main", "3.1.3")).toBeNull();
    expect(selectPullRequest(candidates, "next", "main", "3.1.2")).toEqual(candidates[0]!);
  });

  it("an old merged pull request for another version: does not attach", () => {
    const candidates = [
      {
        number: 354,
        title: "chore(release): v3.1.1",
        state: "MERGED" as const,
        headRefName: "next",
        baseRefName: "main",
        headRefOid: "e16296a882831a7aebf2e1fe60609e834368ad91",
        mergedAt: "2026-10-02T22:56:04Z",
        mergeCommitOid: "b626354e1d91e73ecbe4adbd2c81a49e4611c0bd",
        packageVersion: "3.1.1",
      },
    ];
    expect(selectPullRequest(candidates, "next", "main", "3.1.3")).toBeNull();
  });

  it("two candidates: stops and names all matching candidates", () => {
    const candidates = [
      {
        number: 400,
        title: "chore(release): v3.1.3",
        state: "OPEN" as const,
        headRefName: "chore/release-3.1.3",
        baseRefName: "next",
        headRefOid: "aaa1",
        mergedAt: null,
        packageVersion: "3.1.3",
      },
      {
        number: 401,
        title: "chore(release): v3.1.3",
        state: "OPEN" as const,
        headRefName: "chore/release-3.1.3",
        baseRefName: "next",
        headRefOid: "aaa2",
        mergedAt: null,
        packageVersion: "3.1.3",
      },
    ];
    expect(() =>
      selectPullRequest(candidates, "chore/release-3.1.3", "next", "3.1.3"),
    ).toThrow("Multiple matching pull requests found for chore/release-3.1.3 → next: #400, #401");
  });

  it("a closed-unmerged candidate: stops and names the closed PR", () => {
    const candidates = [
      {
        number: 399,
        title: "chore(release): v3.1.3",
        state: "CLOSED" as const,
        headRefName: "chore/release-3.1.3",
        baseRefName: "next",
        headRefOid: "deadbeef",
        mergedAt: null,
        packageVersion: "3.1.3",
      },
    ];
    expect(() =>
      selectPullRequest(candidates, "chore/release-3.1.3", "next", "3.1.3"),
    ).toThrow("Pull request #399 (chore/release-3.1.3 → next) was closed without merging");
  });

  it("a candidate without headRefOid: stops and names the unreadable PR", () => {
    const candidates = [
      {
        number: 402,
        title: "chore(release): v3.1.3",
        state: "OPEN" as const,
        headRefName: "chore/release-3.1.3",
        baseRefName: "next",
        headRefOid: "",
        mergedAt: null,
        packageVersion: "3.1.3",
      },
    ];
    expect(() =>
      selectPullRequest(candidates, "chore/release-3.1.3", "next", "3.1.3"),
    ).toThrow("Pull request #402 (chore/release-3.1.3 → next) returned no headRefOid from GitHub");
  });

  it("a candidate with unreadable packageVersion: stops and names the PR", () => {
    const candidates = [
      {
        number: 403,
        title: "chore(release): v3.1.3",
        state: "OPEN" as const,
        headRefName: "chore/release-3.1.3",
        baseRefName: "next",
        headRefOid: "deadbeef",
        mergedAt: null,
        packageVersion: null,
      },
    ];
    expect(() =>
      selectPullRequest(candidates, "chore/release-3.1.3", "next", "3.1.3"),
    ).toThrow("Could not determine package.json version for pull request #403 (chore/release-3.1.3 → next) at commit deadbeef");
  });

  it("detects an unrelated open release PR on source branch as blocking", () => {
    const candidates = [
      {
        number: 360,
        title: "chore(release): v3.1.2",
        state: "OPEN" as const,
        headRefName: "next",
        baseRefName: "main",
        headRefOid: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
        mergedAt: null,
        packageVersion: "3.1.2",
      },
    ];
    const blocking = detectBlockingPr(candidates, "next", "3.1.3");
    expect(blocking).toEqual(candidates[0]!);
  });
});

describe("check runs verification (fail-closed)", () => {
  it("zero check runs: throws error", () => {
    expect(() => verifyCheckRuns([], "abc1234")).toThrow(
      "Precondition failed: commit abc1234 has 0 check runs (required: Test & Build, Browser suites)",
    );
  });

  it("a check pending: throws and lists the pending check", () => {
    expect(() =>
      verifyCheckRuns(
        [
          { name: "Browser suites", status: "completed", conclusion: "success" },
          { name: "Test & Build", status: "in_progress", conclusion: null },
        ],
        "abc1234",
      ),
    ).toThrow("Precondition failed: commit abc1234 has non-successful check runs");
  });

  it("a check failed: throws and lists the failed check", () => {
    expect(() =>
      verifyCheckRuns(
        [
          { name: "Browser suites", status: "completed", conclusion: "failure" },
          { name: "Test & Build", status: "completed", conclusion: "success" },
        ],
        "abc1234",
      ),
    ).toThrow("Precondition failed: commit abc1234 has non-successful check runs");
  });

  it("a check skipped: throws and lists the skipped check", () => {
    expect(() =>
      verifyCheckRuns(
        [
          { name: "Browser suites", status: "completed", conclusion: "skipped" },
          { name: "Test & Build", status: "completed", conclusion: "success" },
        ],
        "abc1234",
      ),
    ).toThrow("Precondition failed: commit abc1234 has non-successful check runs");
  });

  it("a check neutral: throws and lists the neutral check", () => {
    expect(() =>
      verifyCheckRuns(
        [
          { name: "Browser suites", status: "completed", conclusion: "neutral" },
          { name: "Test & Build", status: "completed", conclusion: "success" },
        ],
        "abc1234",
      ),
    ).toThrow("Precondition failed: commit abc1234 has non-successful check runs");
  });

  it("a run from another app only: throws missing required project checks", () => {
    expect(() =>
      verifyCheckRuns(
        [
          {
            name: "Other App Check",
            status: "completed",
            conclusion: "success",
            app: { slug: "other-app" },
          },
        ],
        "abc1234",
      ),
    ).toThrow(
      "Precondition failed: commit abc1234 is missing required successful GitHub Actions check runs: [Test & Build, Browser suites]",
    );
  });

  it("missing a required check name: throws listing missing checks", () => {
    expect(() =>
      verifyCheckRuns(
        [
          {
            name: "Test & Build",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
          },
        ],
        "abc1234",
      ),
    ).toThrow(
      "Precondition failed: commit abc1234 is missing required successful GitHub Actions check runs: [Browser suites]",
    );
  });

  it("all required checks completed and successful: returns formatted evidence", () => {
    const result = verifyCheckRuns(
      [
        {
          name: "Test & Build",
          status: "completed",
          conclusion: "success",
          app: { slug: "github-actions" },
        },
        {
          name: "Browser suites",
          status: "completed",
          conclusion: "success",
          app: { slug: "github-actions" },
        },
      ],
      "abc1234",
    );
    expect(result.formattedEvidence).toContain("Test & Build (success)");
    expect(result.formattedEvidence).toContain("Browser suites (success)");
  });
});

describe("tag and branch verification (fail-closed)", () => {
  it("remote tag present with no merged main PR: stops because tag is unverified", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.2",
        remoteTagSha: "b626354e1d91e73ecbe4adbd2c81a49e4611c0bd",
        localTagSha: null,
      }),
    ).toThrow(
      "Remote tag v3.1.2 exists at b626354e1d91e73ecbe4adbd2c81a49e4611c0bd, but no merged pull request into main was found to verify it against",
    );
  });

  it("remote tag at a wrong SHA: stops and reports mismatch", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: "cccc111122223333444455556666777788889999",
        localTagSha: null,
        mainPr: {
          number: 370,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "bbbb111122223333444455556666777788889999",
          packageVersion: "3.1.3",
        },
        packageVersionAtMergeSha: "3.1.3",
      }),
    ).toThrow(
      "Remote tag v3.1.3 points to cccc111122223333444455556666777788889999, but verified merge commit from PR #370 is bbbb111122223333444455556666777788889999",
    );
  });

  it("remote tag present matching verified merge commit: detects already-tagged", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: "bbbb111122223333444455556666777788889999",
        localTagSha: null,
        mainPr: {
          number: 370,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "bbbb111122223333444455556666777788889999",
          packageVersion: "3.1.3",
        },
        packageVersionAtMergeSha: "3.1.3",
      }),
    ).toBe("already-tagged");
  });

  it("blocked release: stops immediately when an unrelated release PR is open", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        blockingPr: {
          number: 360,
          title: "chore(release): v3.1.2",
          state: "OPEN",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
          packageVersion: "3.1.2",
        },
      }),
    ).toThrow(
      "A 3.1.3 release cannot start while 3.1.2's release (PR #360) is unmerged",
    );
  });

  it("collision before version shortcut: remote release branch exists without PR when package.json is already target version", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        remoteBranchExists: true,
        sourcePr: null,
      }),
    ).toThrow(
      "Remote branch chore/release-3.1.3 exists on origin, but no open or merged pull request matches it",
    );
  });

  it("merge sha not on main: stops when mergeCommit is not an ancestor of origin/main", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 370,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "222",
          packageVersion: "3.1.3",
        },
        isMergeCommitAncestor: false,
        packageVersionAtMergeSha: "3.1.3",
        checkRuns: [{ name: "CI", status: "completed", conclusion: "success" }],
      }),
    ).toThrow("Merge commit 222 from PR #370 is not an ancestor of origin/main");
  });

  it("package.json at the sha ≠ target: stops when package.json at merge SHA does not match target", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 370,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "222",
          packageVersion: "3.1.3",
        },
        isMergeCommitAncestor: true,
        packageVersionAtMergeSha: "3.1.2",
        checkRuns: [{ name: "CI", status: "completed", conclusion: "success" }],
      }),
    ).toThrow("package.json at merge commit 222 is v3.1.2, not target v3.1.3");
  });

  it("local-only tag at the right sha: detects push-local-tag", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: "222",
        mainPr: {
          number: 370,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "222",
          packageVersion: "3.1.3",
        },
        isMergeCommitAncestor: true,
        packageVersionAtMergeSha: "3.1.3",
        checkRuns: [
          { name: "Test & Build", status: "completed", conclusion: "success" },
          { name: "Browser suites", status: "completed", conclusion: "success" },
        ],
      }),
    ).toBe("push-local-tag");
  });

  it("local-only tag at a wrong sha: stops and reports the mismatch", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: "999",
        mainPr: {
          number: 370,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "222",
          packageVersion: "3.1.3",
        },
        isMergeCommitAncestor: true,
        packageVersionAtMergeSha: "3.1.3",
        checkRuns: [
          { name: "Test & Build", status: "completed", conclusion: "success" },
          { name: "Browser suites", status: "completed", conclusion: "success" },
        ],
      }),
    ).toThrow("Local tag v3.1.3 points to 999, but verified merge commit is 222");
  });

  it("remote release branch without a pull request: stops on collision", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        remoteBranchExists: true,
        sourcePr: null,
      }),
    ).toThrow("Remote branch chore/release-3.1.3 exists on origin, but no open or merged pull request matches it");
  });

  it("interruption on release branch without commit: stops with instructions", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        currentBranch: "chore/release-3.1.3",
        releaseBranchCommitVersion: "3.1.2",
        remoteTagSha: null,
        localTagSha: null,
      }),
    ).toThrow(
      "Release branch chore/release-3.1.3 is checked out, but release commit for v3.1.3 is not committed. Switch to source branch or commit the release bump.",
    );
  });

  it("interruption on release branch with commit but not pushed: detects create-source-pr", () => {
    const state = detectReleaseState({
      currentVersion: "3.1.2",
      targetVersion: "3.1.3",
      currentBranch: "chore/release-3.1.3",
      releaseBranchCommitVersion: "3.1.3",
      isReleaseBranchPushed: false,
      remoteTagSha: null,
      localTagSha: null,
    });
    expect(state).toBe("create-source-pr");

    const plan = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      currentBranch: "chore/release-3.1.3",
      state,
      isReleaseBranchPushed: false,
    });
    const cmds = plan.map((p) => p.command).filter(Boolean);
    // Pushes existing branch, does NOT checkout -b or commit again
    expect(cmds).not.toContain("git checkout -b chore/release-3.1.3");
    expect(cmds).toContain("git push origin chore/release-3.1.3");
  });

  it("interruption on release branch with PR merged but origin/<source> package.json below target: stops", () => {
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        currentBranch: "chore/release-3.1.3",
        sourceBranch: "next",
        sourcePr: {
          number: 359,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "chore/release-3.1.3",
          baseRefName: "next",
          headRefOid: "111",
          packageVersion: "3.1.3",
        },
        originSourceVersion: "3.1.2",
        remoteTagSha: null,
        localTagSha: null,
      }),
    ).toThrow(
      "Pull request #359 into next is merged, but origin/next package.json is v3.1.2, not target v3.1.3",
    );
  });

  it("assertCurrentBranch accepts release branch of target version", () => {
    expect(() => assertCurrentBranch("chore/release-3.1.3", "next", "3.1.3")).not.toThrow();
    expect(() => assertCurrentBranch("chore/release-3.1.2", "next", "3.1.3")).toThrow(
      "Must be on next to release v3.1.3 (currently on 'chore/release-3.1.2')",
    );
  });
});

describe("stop before the tag — ruled behavior", () => {
  it("no flag: never a tag command in the plan across all states", () => {
    const states = [
      "create-source-pr",
      "await-source-pr",
      "create-main-pr",
      "await-main-pr",
      "tag-release",
      "push-local-tag",
    ] as const;

    for (const state of states) {
      const steps = planRelease({
        targetVersion: "3.1.3",
        sourceBranch: "next",
        state,
      });
      const commands = steps.map((s) => s.command).filter(Boolean);
      for (const cmd of commands) {
        expect(cmd).not.toMatch(/^git tag/);
        expect(cmd).not.toMatch(/^git push origin v/);
      }
      expect(steps.some((s) => s.description.includes("bun run release 3.1.3 --tag"))).toBe(true);
    }
  });

  it("with --tag flag on verified release: includes tag and push commands", () => {
    const tagSteps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
      tag: true,
      verifiedSha: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
    });
    const tagCommands = tagSteps.map((s) => s.command).filter(Boolean);
    expect(tagCommands).toContain(
      "git tag -a v3.1.3 425ecd4b9d6de757f5678a27df9da0fa7ec27b66 -m v3.1.3",
    );
    expect(tagCommands).toContain("git push origin v3.1.3");

    const pushSteps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "push-local-tag",
      tag: true,
      verifiedSha: "425ecd4b9d6de757f5678a27df9da0fa7ec27b66",
    });
    const pushCommands = pushSteps.map((s) => s.command).filter(Boolean);
    expect(pushCommands).toEqual([
      "git push origin v3.1.3",
      "git checkout next",
    ]);
  });

  it("with --tag flag and a failing precondition: stops with reason", () => {
    // Failing precondition 1: main PR is not merged yet (OPEN)
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 360,
          title: "chore(release): v3.1.3",
          state: "OPEN",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          packageVersion: "3.1.3",
        },
        tag: true,
      }),
    ).toThrow("Cannot tag v3.1.3: pull request #360 into main is still open");

    // Failing precondition 2: no main PR found
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: null,
        tag: true,
      }),
    ).toThrow("Cannot tag v3.1.3: no pull request into main found");

    // Failing precondition 3: check runs pending
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 360,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "222",
          packageVersion: "3.1.3",
        },
        isMergeCommitAncestor: true,
        packageVersionAtMergeSha: "3.1.3",
        checkRuns: [{ name: "CI", status: "in_progress", conclusion: null }],
        tag: true,
      }),
    ).toThrow("Precondition failed: commit 222 has non-successful check runs");

    // Failing precondition 4: merge commit not on main
    expect(() =>
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        remoteTagSha: null,
        localTagSha: null,
        mainPr: {
          number: 360,
          title: "chore(release): v3.1.3",
          state: "MERGED",
          headRefName: "next",
          baseRefName: "main",
          headRefOid: "111",
          mergeCommitOid: "222",
          packageVersion: "3.1.3",
        },
        isMergeCommitAncestor: false,
        packageVersionAtMergeSha: "3.1.3",
        checkRuns: [{ name: "CI", status: "completed", conclusion: "success" }],
        tag: true,
      }),
    ).toThrow("Merge commit 222 from PR #360 is not an ancestor of origin/main");
  });
});

describe("parseLsRemoteTags", () => {
  it("extracts peeled sha when annotated tag is present", () => {
    const raw = "b93cb2bd74070eafe390b3c619aeadb293dca23f\trefs/tags/v3.1.1\nb626354e1d91e73ecbe4adbd2c81a49e4611c0bd\trefs/tags/v3.1.1^{}";
    expect(parseLsRemoteTags(raw, "v3.1.1")).toBe("b626354e1d91e73ecbe4adbd2c81a49e4611c0bd");
  });

  it("extracts direct sha for lightweight tag", () => {
    const raw = "b93cb2bd74070eafe390b3c619aeadb293dca23f\trefs/tags/v3.1.1";
    expect(parseLsRemoteTags(raw, "v3.1.1")).toBe("b93cb2bd74070eafe390b3c619aeadb293dca23f");
  });

  it("returns null when tag is not found", () => {
    expect(parseLsRemoteTags("", "v3.1.2")).toBeNull();
  });
});
