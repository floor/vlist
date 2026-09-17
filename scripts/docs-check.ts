#!/usr/bin/env bun
/**
 * vlist — the migration notes must not name an API that no longer exists.
 *
 * A reader following the 3.0 migration notes writes code against whatever they
 * say. When `PluginContext` was grouped by capability, the notes kept the flat
 * names — `registerMethod`, `ctx.getMethod`, `setScrollToIndexFn` — so the
 * instructions described an API that had been renamed in the same release.
 *
 * The rule needs no line numbers and no exception list: a line that names an
 * old API is wrong *unless it also names the replacement*, because then it is
 * describing the rename rather than instructing with it. That distinction is
 * the whole check.
 *
 * Only the unreleased section of the changelog is examined. Released entries
 * are history and are never rewritten.
 *
 * Usage: bun run scripts/docs-check.ts
 */

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
  { old: "ctx.setBoundedWrap", now: "ctx.scroll.setBoundedWrap" },
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

const problems: Problem[] = [];
scan("CHANGELOG.md", unreleased(read("CHANGELOG.md")), problems);
scan("npm-readme.md", all(read("npm-readme.md")), problems);
scan("README.md", all(read("README.md")), problems);

console.log("");
if (problems.length === 0) {
  console.log(`  ✓ migration notes name no renamed API (${RENAMES.length} renames checked)`);
  console.log("");
  process.exit(0);
}

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
console.log("");
process.exit(1);
