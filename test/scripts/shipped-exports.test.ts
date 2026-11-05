// A declared value export that the bundle does not provide fails the importer
// at link time (`does not provide an export named`), before any module code
// runs. The .d.ts is the contract; the runtime module has to match it.
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { build } from "../../build";
import { diffShippedExports, formatExportGaps } from "../../scripts/shipped-exports";

const root = resolve(import.meta.dir, "../..");

describe("shipped exports", () => {
  // it.serial: owns the module-level TypeScript program cache in
  // scripts/shipped-exports.ts, and one tsc emit into its own temp directory.
  it.serial("matches .d.ts value exports to the runtime module", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "vlist-exports-"));
    try {
      await build({ outDir, entriesOnly: true, types: true });
      const gaps = diffShippedExports(root, outDir);
      expect(formatExportGaps(gaps)).toBe("");
    } finally {
      const trashed = Bun.spawnSync(["trash", outDir]);
      if (trashed.exitCode !== 0) {
        throw new Error(`trash ${outDir} exited ${trashed.exitCode}`);
      }
    }
  }, 120_000);
});
