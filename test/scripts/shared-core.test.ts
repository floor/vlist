// Secondary entries import the core from dist/index.js instead of bundling a
// copy (scripts/shared-core.ts). Built standalone, an app using vlist and
// vlist/config shipped two cores.
import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { sharedCore } from "../../scripts/shared-core";

const CORE_MARKER = "horizontal RTL lists are not supported";
const build = async (plugins: import("bun").BunPlugin[]): Promise<string> => {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../../src/config.ts")],
    target: "browser", format: "esm", minify: true, plugins,
  });
  expect(result.success).toBe(true);
  return result.outputs[0]!.text();
};

describe("shared core", () => {
  it("vlist/config imports the core from ./index.js and carries none of it", async () => {
    const text = await build([sharedCore]);
    expect(text).toMatch(/from\s*"\.\/index\.js"/);
    expect(text).not.toContain(CORE_MARKER);
  });

  it("without the plugin the same entry carries a whole core", async () => {
    const text = await build([]);
    expect(text).toContain(CORE_MARKER);
  });
});
