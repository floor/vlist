// dist/version.json says which vlist a dist folder is. vlist.io reads it for
// its homepage badge and cache keys instead of a package.json read once at
// startup, which said next.3 for a week of newer bundles.
import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { versionStamp, shortCommit } from "../../scripts/version-stamp";

describe("scripts/version-stamp", () => {
  it("stamps the package version, the commit and the build time", () => {
    const root = join(process.cwd());
    const at = new Date("2026-09-25T12:00:00.000Z");
    const stamp = versionStamp(root, at);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string };
    expect(stamp.version).toBe(pkg.version);
    expect(stamp.builtAt).toBe("2026-09-25T12:00:00.000Z");
    // This test runs in a checkout; the commit is the short SHA of HEAD.
    expect(stamp.commit).toMatch(/^[0-9a-f]{7,}$/);
  });

  // Staging builds next, which carries the last released version until the
  // release bump: its badge said v3.0.0 on 3.0.1 work.
  describe("released", () => {
    const git = (cwd: string, ...args: string[]): void => {
      Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    };
    const repo = (tag?: string): string => {
      const dir = mkdtempSync(join(tmpdir(), "vlist-stamp-git-"));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "9.9.9" }));
      git(dir, "init", "-q");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "release");
      if (tag) git(dir, "tag", tag);
      return dir;
    };

    it("is true on the commit tagged v<version>", () => {
      const dir = repo("v9.9.9");
      try {
        expect(versionStamp(dir, new Date(0), {}).released).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("is false on any other commit: untagged, or tagged for another version", () => {
      for (const tag of [undefined, "v9.9.8"]) {
        const dir = repo(tag);
        try {
          const stamp = versionStamp(dir, new Date(0), {});
          expect(stamp.released).toBe(false);
          expect(stamp.commit).toMatch(/^[0-9a-f]{7,}$/);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    });

    it("is true in the publish workflow, whose tag push names the version", () => {
      const dir = repo();
      try {
        expect(versionStamp(dir, new Date(0), { GITHUB_REF_NAME: "v9.9.9" }).released).toBe(true);
        expect(versionStamp(dir, new Date(0), { GITHUB_REF_NAME: "next" }).released).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("reads the version from the root it is given, and has no commit outside git", () => {
    const dir = mkdtempSync(join(tmpdir(), "vlist-stamp-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "9.9.9-test.1" }));
      const stamp = versionStamp(dir, new Date(0));
      expect(stamp.version).toBe("9.9.9-test.1");
      expect(stamp.builtAt).toBe("1970-01-01T00:00:00.000Z");
      expect(shortCommit(dir)).toBe(stamp.commit);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// FLO-246: the stamp only helps a site if the package ships it. The `files`
// whitelist listed size.json and not version.json, so vlist.io production
// (installed from npm) read package.json instead.
describe("package.json files", () => {
  it("ships dist/version.json beside dist/size.json", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("dist/size.json");
    expect(pkg.files).toContain("dist/version.json");
  });
});
