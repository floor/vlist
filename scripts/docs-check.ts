#!/usr/bin/env bun
/**
 * vlist — two rules about what the public tree may say.
 *
 * **Renamed APIs.** A reader following the 3.0 migration notes writes code
 * against whatever they say. When `PluginContext` was grouped by capability,
 * the notes kept the flat names — `registerMethod`, `ctx.getMethod`,
 * `setScrollToIndexFn` — so the instructions described an API that had been
 * renamed in the same release. The rule needs no line numbers and no exception
 * list: a line that names an old API is wrong *unless it also names the
 * replacement*, because then it is describing the rename rather than
 * instructing with it. That distinction is the whole check. Only the
 * unreleased section of the changelog is examined: released entries are
 * history and are never rewritten.
 *
 * **Internal tracker ids.** The repository is public; its files cite work by
 * the public issue or pull request number (`#NNN`), never by the internal
 * tracker. Every tracked file is scanned — git decides what is tracked, so
 * scratch files and build output never count. An exemption is a file that
 * still carries an id, for a stated reason; every exemption is printed on
 * each run so it cannot rot unseen, and an exemption that skips nothing is
 * reported for removal.
 *
 * Usage: bun run scripts/docs-check.ts
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface Rename {
  /** The name that no longer exists. Matched whole, so `hooks.method` is safe. */
  readonly old: string;
  /** What replaced it. A line naming both is describing the rename. */
  readonly now: string;
}

/** The 3.0 renames a reader could still be following. */
const RENAMES: readonly Rename[] = [
  { old: "registerMethod", now: "hooks.method" },
  { old: "getMethod", now: "hooks.get" },
  { old: "setScrollToIndexFn", now: "setToIndexFn" },
  { old: "forceRender", now: "render.force" },
  { old: "sizeCache", now: "sizes.cache" },
  { old: "getItems", now: "items.all" },
  { old: "ctx.setBoundedWrap", now: "ctx.scroll.setWrap" },
  { old: "ctx.scroll.setBoundedWrap", now: "ctx.scroll.setWrap" },
];

interface Problem {
  readonly file: string;
  readonly line: number;
  readonly old: string;
  readonly now: string;
  readonly text: string;
}

const read = (path: string): string[] => {
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
};

/**
 * Lines of the changelog's unreleased section. Everything below the next
 * released heading is history.
 */
const unreleased = (lines: readonly string[]): Array<{ n: number; text: string }> => {
  const start = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (start < 0) return [];
  const out: Array<{ n: number; text: string }> = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i]!)) break;
    out.push({ n: i + 1, text: lines[i]! });
  }
  return out;
};

const all = (lines: readonly string[]): Array<{ n: number; text: string }> =>
  lines.map((text, i) => ({ n: i + 1, text }));

const scan = (
  file: string,
  rows: ReadonlyArray<{ n: number; text: string }>,
  problems: Problem[],
): void => {
  for (const { n, text } of rows) {
    for (const { old, now } of RENAMES) {
      if (!text.includes(old)) continue;
      // Naming the replacement on the same line means the line is *about* the
      // rename, which is correct. Only an unaccompanied old name misleads.
      if (text.includes(now)) continue;
      // The replacement may appear in its short form where the prose explains
      // the rename itself — "`registerMethod` to `method`". Accepted only as a
      // code span: the bare word is far too common to clear a line on, and one
      // entry that misinstructs says "a public method name" in plain prose.
      const segment = now.slice(now.lastIndexOf(".") + 1);
      if (text.includes(`\`${segment}\``)) continue;
      problems.push({ file, line: n, old, now, text: text.trim() });
    }
  }
};

/**
 * Tracker prefixes the public tree must not name (an id is `<prefix>-<digits>`).
 * Add a prefix here to extend the rule to another tracker.
 */
export const TRACKER_PREFIXES: readonly string[] = ["FLO"];

/** The id pattern for a set of prefixes; exported so tests can extend it. */
export const trackerIdPattern = (prefixes: readonly string[]): RegExp =>
  new RegExp(`(?:${prefixes.join("|")})-\\d+`);

/** A tracked file and its lines. */
export interface TrackedFile {
  readonly path: string;
  readonly lines: readonly string[];
}

/** A file allowed to carry a tracker id, with the reason — ideally none. */
export interface TrackerExemption {
  readonly file: string;
  readonly reason: string;
}

/**
 * Files that may still carry a tracker id. Every entry is printed on each run;
 * an entry that skips nothing is reported so it can be removed. Empty: the
 * tracked tree carries no id, so the rule needs no exception.
 */
export const TRACKER_EXEMPT: readonly TrackerExemption[] = [];

export interface TrackerHit {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  readonly text: string;
}

export interface TrackerScan {
  readonly hits: readonly TrackerHit[];
  /** Exemptions that actually skipped at least one id. */
  readonly exempted: readonly TrackerExemption[];
  /** Exemptions whose file carries no id (or is not tracked): remove them. */
  readonly unused: readonly TrackerExemption[];
}

/** Every occurrence of a tracker id, in tracked order; exempt files skipped. */
export const scanTrackerIds = (
  files: readonly TrackedFile[],
  exempt: readonly TrackerExemption[] = TRACKER_EXEMPT,
): TrackerScan => {
  const pattern = new RegExp(trackerIdPattern(TRACKER_PREFIXES).source, "g");
  const exemptFiles = new Set(exempt.map((e) => e.file));
  const hits: TrackerHit[] = [];
  const skipped = new Set<string>();
  for (const { path, lines } of files) {
    const isExempt = exemptFiles.has(path);
    for (let i = 0; i < lines.length; i++) {
      for (const match of lines[i]!.matchAll(pattern)) {
        if (isExempt) {
          skipped.add(path);
          continue;
        }
        hits.push({ file: path, line: i + 1, id: match[0], text: lines[i]!.trim() });
      }
    }
  }
  return {
    hits,
    exempted: exempt.filter((e) => skipped.has(e.file)),
    unused: exempt.filter((e) => !skipped.has(e.file)),
  };
};

/** The tracked files, from git itself, so untracked scratch never counts. */
const trackedFiles = (): readonly string[] =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((p) => p.length > 0);

const run = (): void => {
  const problems: Problem[] = [];
  scan("CHANGELOG.md", unreleased(read("CHANGELOG.md")), problems);
  scan("npm-readme.md", all(read("npm-readme.md")), problems);
  scan("README.md", all(read("README.md")), problems);

  const tracked = trackedFiles();
  const tracker = scanTrackerIds(tracked.map((path) => ({ path, lines: read(path) })));

  console.log("");
  if (problems.length === 0) {
    console.log(`  ✓ migration notes name no renamed API (${RENAMES.length} renames checked)`);
  } else {
    console.log(`  ✗ ${problems.length} line(s) name an API that no longer exists:`);
    console.log("");
    for (const p of problems) {
      console.log(`  ${p.file}:${p.line}`);
      console.log(`      "${p.old}" → should be "${p.now}"`);
      console.log(`      ${p.text.slice(0, 140)}`);
      console.log("");
    }
    console.log(`  A line may keep an old name only if it also names the replacement,`);
    console.log(`  which is how an entry describing the rename differs from one using it.`);
  }

  if (tracker.hits.length === 0) {
    console.log(`  ✓ no tracker id in ${tracked.length} tracked files (${TRACKER_PREFIXES.join(", ")})`);
  } else {
    console.log(`  ✗ ${tracker.hits.length} tracker id(s) in tracked files:`);
    console.log("");
    for (const hit of tracker.hits) {
      console.log(`  ${hit.file}:${hit.line}`);
      console.log(`      "${hit.id}" → cite the public issue or pull request ("#NNN")`);
      console.log(`      ${hit.text.slice(0, 140)}`);
      console.log("");
    }
    console.log(`  This repository is public: files cite work by its public number,`);
    console.log(`  or say it without a number — never by an internal tracker id.`);
  }
  for (const e of tracker.exempted) {
    console.log(`  ⚠ ${e.file} is exempt from the tracker-id rule: ${e.reason}`);
  }
  for (const e of tracker.unused) {
    console.log(`  ⚠ the exemption for ${e.file} skips nothing — remove it from the list (${e.reason})`);
  }
  console.log("");

  process.exit(problems.length === 0 && tracker.hits.length === 0 ? 0 : 1);
};

if (import.meta.main) run();
