import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

function rule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

test("rows and headers do not request a compositor layer", () => {
  const list = readFileSync(join(root, "src/styles/vlist.css"), "utf8");
  const table = readFileSync(join(root, "src/styles/vlist-table.css"), "utf8");

  expect(rule(list, ".vlist-item,\n.vlist-group-header {")).not.toContain("will-change");
  expect(rule(table, ".vlist-table-row {")).not.toContain("will-change");
  expect(rule(table, "\n.vlist-table-header {\n")).toContain("will-change: scroll-position");
  expect(rule(table, ".vlist-table-drop-indicator {")).toContain("will-change: transform");
});
