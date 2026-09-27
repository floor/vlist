/**
 * The stamp `bun run build` writes to dist/version.json: which vlist a dist
 * folder is. A site that serves a built bundle can then say its version from
 * the bundle itself rather than from a package.json read once at startup --
 * vlist.io's homepage badge said next.3 for a week of next.4 and next.5
 * bundles because of that read.
 */
import { readFileSync } from "fs";
import { join } from "path";

export interface VersionStamp {
  /** package.json's version at build time. */
  readonly version: string;
  /** The short commit the build ran on, or null outside a git checkout. */
  readonly commit: string | null;
  /** ISO time of the build. */
  readonly builtAt: string;
  /**
   * Whether this build is the release `version` names: built from the tag
   * `v<version>`. False for a build of `next` between releases, which still
   * carries the last released version: staging's badge said v3.0.0 on 3.0.1
   * work. A site shows the commit for those.
   */
  readonly released: boolean;
}

/** Runs `git rev-parse --short HEAD` in `root`; null when git or the checkout is missing. */
export const shortCommit = (root: string): string | null => {
  try {
    const out = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root });
    const sha = out.stdout.toString().trim();
    return /^[0-9a-f]{7,}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
};

/** Tags on HEAD in `root`; none when git or the checkout is missing. */
export const tagsAtHead = (root: string): string[] => {
  try {
    const out = Bun.spawnSync(["git", "tag", "--points-at", "HEAD"], { cwd: root });
    return out.exitCode === 0 ? out.stdout.toString().split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
};

export const versionStamp = (
  root: string,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): VersionStamp => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version?: string };
  const version = pkg.version ?? "0.0.0";
  // publish.yml builds on the tag push, and checks the tag names this version.
  const released = env.GITHUB_REF_NAME === `v${version}` || tagsAtHead(root).includes(`v${version}`);
  return { version, commit: shortCommit(root), builtAt: now.toISOString(), released };
};
