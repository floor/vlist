/**
 * vlist — Release script
 *
 * The 3.0 line integrates on `next` and the 2.x line stays on `staging`.
 * These tests pin the branch derivation, prerelease graduation, and README
 * rewrite so cutting 3.0.0 cannot fail at the first guard again.
 */

import { describe, expect, it } from "bun:test";
import {
  USAGE,
  assertCurrentBranch,
  assertStableRelease,
  bumpVersion,
  currentBranchLabel,
  execErrorMessage,
  parseArgs,
  parseVersion,
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

  it("graduates a prerelease to its stable version for any bump", () => {
    expect(bumpVersion("3.0.0-next.2", "patch")).toBe("3.0.0");
    expect(bumpVersion("3.0.0-next.2", "minor")).toBe("3.0.0");
    expect(bumpVersion("3.0.0-next.2", "major")).toBe("3.0.0");
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

  it("graduates 3.0.0-next.2 to 3.0.0", () => {
    expect(resolveNewVersion("3.0.0-next.2", { kind: "bump", bumpType: "major", from: null })).toBe(
      "3.0.0",
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
    expect(parseArgs([])).toEqual({ kind: "bump", bumpType: "patch", from: null });
  });

  it("parses bump types and --from in either order", () => {
    expect(parseArgs(["minor"])).toEqual({ kind: "bump", bumpType: "minor", from: null });
    expect(parseArgs(["major", "--from", "next"])).toEqual({
      kind: "bump",
      bumpType: "major",
      from: "next",
    });
    expect(parseArgs(["--from", "staging", "patch"])).toEqual({
      kind: "bump",
      bumpType: "patch",
      from: "staging",
    });
    expect(parseArgs(["--from=next"])).toEqual({ kind: "bump", bumpType: "patch", from: "next" });
  });

  it("parses an exact version", () => {
    expect(parseArgs(["3.0.0"])).toEqual({ kind: "exact", version: "3.0.0", from: null });
    expect(parseArgs(["3.0.0", "--from", "next"])).toEqual({
      kind: "exact",
      version: "3.0.0",
      from: "next",
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
    const readme = await Bun.file("README.md").text();
    const next = updateReadmeVersion(readme, "3.0.0");
    expect(next).toContain("**v3.0.0**");
    expect(next).not.toContain("**v3.0.0-next.2**");
    expect(next).not.toContain("(prerelease on the npm `next` tag)");
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
