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
  detectReleaseState,
  execErrorMessage,
  formatReleasePlan,
  parseArgs,
  parseVersion,
  planRelease,
  releaseBranchFor,
  resolveNewVersion,
  resolveSourceBranch,
  sourceBranchFor,
  updateChangelogStats,
  updateReadmeVersion,
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
    expect(parseArgs([])).toEqual({ kind: "bump", bumpType: "patch", from: null, dryRun: false });
  });

  it("parses bump types and --from in either order", () => {
    expect(parseArgs(["minor"])).toEqual({ kind: "bump", bumpType: "minor", from: null, dryRun: false });
    expect(parseArgs(["major", "--from", "next"])).toEqual({
      kind: "bump",
      bumpType: "major",
      from: "next",
      dryRun: false,
    });
    expect(parseArgs(["--from", "staging", "patch"])).toEqual({
      kind: "bump",
      bumpType: "patch",
      from: "staging",
      dryRun: false,
    });
    expect(parseArgs(["--from=next"])).toEqual({ kind: "bump", bumpType: "patch", from: "next", dryRun: false });
  });

  it("parses an exact version", () => {
    expect(parseArgs(["3.0.0"])).toEqual({ kind: "exact", version: "3.0.0", from: null, dryRun: false });
    expect(parseArgs(["3.0.0", "--from", "next"])).toEqual({
      kind: "exact",
      version: "3.0.0",
      from: "next",
      dryRun: false,
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
    expect(parseArgs([])).toEqual({ kind: "bump", bumpType: "patch", from: null, dryRun: false });
  });

  it("parses --dry-run with bump types, exact versions, and --from", () => {
    expect(parseArgs(["--dry-run"])).toEqual({
      kind: "bump",
      bumpType: "patch",
      from: null,
      dryRun: true,
    });
    expect(parseArgs(["3.1.3", "--dry-run"])).toEqual({
      kind: "exact",
      version: "3.1.3",
      from: null,
      dryRun: true,
    });
    expect(parseArgs(["--dry-run", "minor", "--from", "next"])).toEqual({
      kind: "bump",
      bumpType: "minor",
      from: "next",
      dryRun: true,
    });
  });
});

describe("detectReleaseState", () => {
  it("detects already-tagged when tag exists on main", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        isTagPresent: true,
      }),
    ).toBe("already-tagged");
  });

  it("detects tag-release when PR into main is merged", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        isTagPresent: false,
        mainPr: { number: 360, state: "MERGED" },
      }),
    ).toBe("tag-release");
  });

  it("detects await-main-pr when PR into main is open", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        isTagPresent: false,
        mainPr: { number: 360, state: "OPEN" },
      }),
    ).toBe("await-main-pr");
  });

  it("detects create-main-pr when step 1 merged or package.json is already at target version", () => {
    // Case A: source PR merged
    expect(
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        isTagPresent: false,
        sourcePr: { number: 359, state: "MERGED" },
      }),
    ).toBe("create-main-pr");

    // Case B: package.json on sourceBranch already at targetVersion
    expect(
      detectReleaseState({
        currentVersion: "3.1.3",
        targetVersion: "3.1.3",
        isTagPresent: false,
      }),
    ).toBe("create-main-pr");
  });

  it("detects await-source-pr when PR into source branch is open", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        isTagPresent: false,
        sourcePr: { number: 359, state: "OPEN" },
      }),
    ).toBe("await-source-pr");
  });

  it("detects create-source-pr on fresh run", () => {
    expect(
      detectReleaseState({
        currentVersion: "3.1.2",
        targetVersion: "3.1.3",
        isTagPresent: false,
      }),
    ).toBe("create-source-pr");
  });
});

describe("planRelease", () => {
  it("plans create-source-pr: pushes release branch, never the source branch directly", () => {
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
    // Verifies tag is pushed
    expect(commands).toContain("git tag v3.1.3");
    expect(commands).toContain("git push origin v3.1.3");
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
  });

  it("plans tag-release when PR onto main is already merged", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
    });
    const commands = steps.map((s) => s.command).filter(Boolean);
    expect(commands).toEqual([
      "git checkout main",
      "git pull origin main",
      "git tag v3.1.3",
      "git push origin v3.1.3",
      "git checkout next",
    ]);
  });
});

describe("formatReleasePlan", () => {
  it("formats plan with state and numbered commands", () => {
    const steps = planRelease({
      targetVersion: "3.1.3",
      sourceBranch: "next",
      state: "tag-release",
    });
    const formatted = formatReleasePlan("3.1.3", "next", "tag-release", steps);
    expect(formatted).toContain("Release plan for v3.1.3 (from next)");
    expect(formatted).toContain("State: tag-release");
    expect(formatted).toContain("git tag v3.1.3");
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
