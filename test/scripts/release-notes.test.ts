import { describe, it, expect } from "bun:test";
import { changelogSection, releaseNotes } from "../../scripts/release-notes";
import { resolve } from "node:path";

/** 3.1.5's real section, verbatim from CHANGELOG.md. */
const V315_SECTION = `## [3.1.5] - 2026-10-18

Search: a navigate-mode bar shows its match arrows only when there is a match to step (#106).

### Fixed

- In \`search()\`, the match navigation arrows of a \`navigate\`-mode bar stay
  hidden until the query has a match to step, instead of appearing as soon as
  the mode is \`navigate\`: an empty box and a query with no results now read as
  idle, the way the match counter and the clear button already did (#106).`;

const CHANGELOG = `# Changelog

## [Unreleased]

${V315_SECTION}

## [3.1.4] - 2026-10-16

### Fixed

- An older entry (#372).

[Unreleased]: https://github.com/floor/vlist/compare/v3.1.5...HEAD
[3.1.5]: https://github.com/floor/vlist/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/floor/vlist/compare/v3.1.3...v3.1.4
`;

const FOOTER =
  "\n\n---\n\n" +
  "npm: [`vlist@3.1.5`](https://www.npmjs.com/package/vlist/v/3.1.5) · " +
  "Docs: [vlist.io](https://vlist.io) · " +
  "Full history: [CHANGELOG.md](https://github.com/floor/vlist/blob/main/CHANGELOG.md)\n\n" +
  "**Full diff:** [v3.1.4...v3.1.5](https://github.com/floor/vlist/compare/v3.1.4...v3.1.5)\n";

describe("changelogSection", () => {
  it("returns 3.1.5's section without its heading, theme line first", () => {
    const section = changelogSection(CHANGELOG, "3.1.5");
    expect(section).toBe(V315_SECTION.slice(V315_SECTION.indexOf("\n\n") + 2));
    expect(section.startsWith("Search: a navigate-mode bar")).toBe(true);
    expect(section).not.toContain("## [3.1.5]");
    expect(section).not.toContain("An older entry");
  });

  it("refuses a version with no section", () => {
    expect(() => changelogSection(CHANGELOG, "9.9.9")).toThrow("CHANGELOG.md has no section for 9.9.9");
  });

  it("refuses a section with no body", () => {
    const empty = "# Changelog\n\n## [3.1.6] - 2026-10-19\n\n## [3.1.5] - 2026-10-18\n\nSomething.\n";
    expect(() => changelogSection(empty, "3.1.6")).toThrow("CHANGELOG.md's section for 3.1.6 is empty");
  });
});

describe("releaseNotes", () => {
  it("is the section plus the footer, with 3.1.5's compare link", () => {
    expect(releaseNotes(CHANGELOG, "3.1.5")).toBe(
      V315_SECTION.slice(V315_SECTION.indexOf("\n\n") + 2) + FOOTER,
    );
  });

  it("refuses a section with no compare link at the bottom", () => {
    const noLink = CHANGELOG.replace("[3.1.5]: https://github.com/floor/vlist/compare/v3.1.4...v3.1.5\n", "");
    expect(() => releaseNotes(noLink, "3.1.5")).toThrow("CHANGELOG.md has no compare link for 3.1.5");
  });

  it("refuses a compare link that is not a compare URL", () => {
    const bad = CHANGELOG.replace(
      "[3.1.5]: https://github.com/floor/vlist/compare/v3.1.4...v3.1.5",
      "[3.1.5]: https://example.com/",
    );
    expect(() => releaseNotes(bad, "3.1.5")).toThrow("CHANGELOG.md has no compare link for 3.1.5");
  });
});

const script = resolve(import.meta.dir, "../../scripts/release-notes.ts");

const run = async (args: string[]) => {
  const proc = Bun.spawn(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  return { exitCode, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
};

describe("release-notes CLI", () => {
  it("prints the real 3.1.5 notes from this repository's changelog", async () => {
    const { exitCode, stdout } = await run(["3.1.5"]);
    expect(exitCode).toBe(0);
    expect(stdout.startsWith("Search: a navigate-mode bar shows its match arrows only when there is a match to step (#106).")).toBe(true);
    expect(stdout).toContain("### Fixed");
    expect(stdout).toContain("**Full diff:** [v3.1.4...v3.1.5](https://github.com/floor/vlist/compare/v3.1.4...v3.1.5)");
  });

  it("exits 1 with a usage line when the version is missing", async () => {
    const { exitCode, stderr } = await run([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage: bun scripts/release-notes.ts <version>");
  });

  it("exits 1 when the changelog has no section for the version", async () => {
    const { exitCode, stderr } = await run(["9.9.9"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CHANGELOG.md has no section for 9.9.9");
  });
});
