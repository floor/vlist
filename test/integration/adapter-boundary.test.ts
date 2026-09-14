import { expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = join(import.meta.dir, "../../src/plugins");
const forbidden = new Set(["scrollPosition", "baseOffset", "prevBaseOffset"]);

// Migration debt, removed in PR b (motion) and PR c (readers). Counts prevent
// adding another direct access even in a plugin that is not migrated yet.
const allowed: Record<string, number> = {
  "a11y/plugin.ts": 2,
  "autosize/plugin.ts": 3,
  "carousel/plugin.ts": 8,
  "groups/plugin.ts": 10,
  "selection/plugin.ts": 1,
  "snapshots/plugin.ts": 2,
  "sortable/plugin.ts": 4,
  "transition/plugin.ts": 13,
  // Page is a scroll source: copy the previous position, then commit its input.
  "page/plugin.ts": 2,
};

it("keeps renderer coordinates behind the adapter and limits unmigrated accesses", () => {
  const found: Record<string, number> = {};
  const accesses: string[] = [];
  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!file.endsWith(".ts")) continue;
      const path = relative(root, file);
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        const member = ts.isPropertyAccessExpression(node) ? node.name.text
          : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text : undefined;
        if (member && forbidden.has(member)) {
          found[path] = (found[path] ?? 0) + 1;
          accesses.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText(source)}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(root);
  expect(found, accesses.join("\n")).toEqual(allowed);
});
