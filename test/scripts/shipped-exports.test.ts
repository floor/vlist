// A declared value export that the bundle does not provide fails the importer
// at link time (`does not provide an export named`), before any module code
// runs. The .d.ts is the contract; the runtime module has to match it.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import ts from "typescript";
import { build } from "../../build";
import { diffShippedExports, formatExportGaps } from "../../scripts/shipped-exports";

const root = resolve(import.meta.dir, "../..");

describe("shipped exports", () => {
  // it.serial: owns the module-level TypeScript program cache in
  // scripts/shipped-exports.ts, and emits declarations into its own directory.
  it.serial("matches runtime exports and resolves declarations under NodeNext", async () => {
    const outDir = mkdtempSync(join(root, "node_modules", ".vlist-exports-"));
    try {
      await build({ outDir, entriesOnly: true, types: true });
      const gaps = diffShippedExports(root, outDir);
      expect(formatExportGaps(gaps)).toBe("");

      // Check the entire emitted tree in the same ESM package scope as npm.
      writeFileSync(join(outDir, "package.json"), '{"type":"module"}');
      const declarations = [...new Bun.Glob("**/*.d.ts").scanSync(outDir)]
        .sort()
        .map((file) => join(outDir, file));
      const program = ts.createProgram(declarations, {
        module: ts.ModuleKind.NodeNext,
        target: ts.ScriptTarget.ES2020,
        lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        types: [],
        noEmit: true,
        strict: true,
      });
      const errors = ts.getPreEmitDiagnostics(program);
      expect(ts.formatDiagnostics(errors, {
        getCurrentDirectory: () => outDir,
        getCanonicalFileName: (file) => file,
        getNewLine: () => "\n",
      })).toBe("");
    } finally {
      // The CI runner has no `trash` binary. This is a temp dir the test
      // created, the same kind build.ts removes with rmSync.
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
