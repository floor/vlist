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

export const versionStamp = (root: string, now: Date = new Date()): VersionStamp => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version?: string };
  return { version: pkg.version ?? "0.0.0", commit: shortCommit(root), builtAt: now.toISOString() };
};
