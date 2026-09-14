import { expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = join(import.meta.dir, "../../src/plugins");
const forbidden = new Set(["scrollPosition", "baseOffset", "prevBaseOffset"]);

// Plugins use the adapter and core commit seam for all scroll coordinates.
const allowed: Record<string, number> = {};

it("rejects direct engine scroll coordinates in every plugin", () => {
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
