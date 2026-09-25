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
