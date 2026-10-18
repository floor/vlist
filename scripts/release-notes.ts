#!/usr/bin/env bun
/**
 * A release's notes, from CHANGELOG.md: the version's section without its
 * heading (the theme line first, then its entries), and a footer carrying the
 * version's compare link.
 *
 *   bun scripts/release-notes.ts 3.1.5 > notes.md
 *
 * A version with no section, or an empty one, fails: a release without notes
 * is a CHANGELOG that was not updated, which is worth stopping for. So does a
 * version with no compare link in the link list at the bottom of the file:
 * the release roll writes `[X.Y.Z]: …/compare/vPREV...vX.Y.Z`, and the footer
 * carries it as "Full diff".
 */

const COMPARE_PREFIX = "https://github.com/floor/vlist/compare/";

/** The version's section of the changelog, its `## [x.y.z]` heading left out. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
  const body = lines.slice(start + 1, next === -1 ? undefined : next).join("\n").trim();
  if (!body) throw new Error(`CHANGELOG.md's section for ${version} is empty`);
  return body;
}

/** The version's compare URL from the changelog's bottom link list. */
export function compareLink(changelog: string, version: string): string {
  const prefix = `[${version}]: `;
  const line = changelog.split("\n").find((candidate) => candidate.startsWith(prefix));
  const url = line?.slice(prefix.length).trim() ?? "";
  if (!url.startsWith(COMPARE_PREFIX) || !url.slice(COMPARE_PREFIX.length) || /\s/.test(url)) {
    throw new Error(`CHANGELOG.md has no compare link for ${version}`);
  }
  return url;
}

/** The section and the footer a GitHub Release carries. */
export function releaseNotes(changelog: string, version: string): string {
  const section = changelogSection(changelog, version);
  const compare = compareLink(changelog, version);
  const footer = [
    `npm: [\`vlist@${version}\`](https://www.npmjs.com/package/vlist/v/${version})`,
    "Docs: [vlist.io](https://vlist.io)",
    "Full history: [CHANGELOG.md](https://github.com/floor/vlist/blob/main/CHANGELOG.md)",
  ].join(" · ");
  const range = compare.slice(COMPARE_PREFIX.length);
  return `${section}\n\n---\n\n${footer}\n\n**Full diff:** [${range}](${compare})\n`;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: bun scripts/release-notes.ts <version>");
    process.exit(1);
  }
  try {
    const changelog = await Bun.file(new URL("../CHANGELOG.md", import.meta.url)).text();
    process.stdout.write(releaseNotes(changelog, version));
  } catch (err: unknown) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
