// dist/version.json says which vlist a dist folder is. vlist.io reads it for
// its homepage badge and cache keys instead of a package.json read once at
// startup, which said next.3 for a week of newer bundles.
import { afterAll, beforeAll, describe, it, expect } from "bun:test";
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

  // A build of `next` carries the last released version until the release
  // bump: its badge said v3.0.0 on 3.0.1 work.
  describe("released", () => {
    // versionStamp shells out twice (`tag --points-at`, `rev-parse --short`).
    // Setup is init + add + commit, plus a tag on two of the three repos.
    const readMs = 10_000;
    const setupMs = 30_000;
    const dirs: string[] = [];
    let tagged = "";
    let other = "";
    let plain = "";

    // Own env, not `process.env`: this shell injects GitHub credential config
    // through GIT_CONFIG_*, and the fixture must not carry it. Signing is
    // forced off so setup cannot wait on a key.
    const gitEnv: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    };
    if (process.env.TMPDIR !== undefined) gitEnv.TMPDIR = process.env.TMPDIR;

    const git = (cwd: string, ...args: string[]): void => {
      const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd, env: gitEnv });
      if (result.exitCode !== 0) {
        const detail = result.stderr.toString().trim();
        throw new Error(`git ${args.join(" ")} exited ${String(result.exitCode)}: ${detail}`);
      }
    };
    const repo = (tag?: string): string => {
      const dir = mkdtempSync(join(tmpdir(), "vlist-stamp-git-"));
      dirs.push(dir);
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "9.9.9" }));
      git(dir, "init", "-q");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "release");
      if (tag) git(dir, "tag", tag);
      return dir;
    };

    // Under --concurrent each case used to build its repo inside the test.
    // That chain passed the 5s default on a loaded machine, and a spawn that
    // returned no sha looked like a null commit because the helper ignored
    // git's status. One repo per case. Not it.serial: these are not a process
    // global; after this hook the repos are only read.
    beforeAll(() => {
      tagged = repo("v9.9.9");
      other = repo("v9.9.8");
      plain = repo();
    }, setupMs);

    afterAll(() => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });

    it("fails setup when git exits non-zero, instead of leaving a repo with no commit", () => {
      const dir = mkdtempSync(join(tmpdir(), "vlist-stamp-git-"));
      try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "9.9.9" }));
        expect(() => git(dir, "commit", "-q", "-m", "release")).toThrow(/exited/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("is true on the commit tagged v<version>", () => {
      expect(versionStamp(tagged, new Date(0), {}).released).toBe(true);
    }, readMs);

    it("is false on any other commit: untagged, or tagged for another version", () => {
      for (const dir of [plain, other]) {
        const stamp = versionStamp(dir, new Date(0), {});
        expect(stamp.released).toBe(false);
        expect(stamp.commit).toMatch(/^[0-9a-f]{7,}$/);
      }
    }, readMs);

    it("is true in the publish workflow, whose tag push names the version", () => {
      expect(versionStamp(plain, new Date(0), { GITHUB_REF_NAME: "v9.9.9" }).released).toBe(true);
      expect(versionStamp(plain, new Date(0), { GITHUB_REF_NAME: "next" }).released).toBe(false);
    }, readMs);
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

// #315: the stamp only helps a site if the package ships it. The `files`
// whitelist listed size.json and not version.json, so vlist.io production
// (installed from npm) read package.json instead.
describe("package.json files", () => {
  it("ships dist/version.json beside dist/size.json", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("dist/size.json");
    expect(pkg.files).toContain("dist/version.json");
  });
});
