// Secondary entries import the core from dist/index.js instead of bundling a
// copy (scripts/shared-core.ts). Built standalone, an app using vlist and
// vlist/config shipped two cores.
import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { importsPackageRoot, sharedCore } from "../../scripts/shared-core";

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

  it("only an entry directly in src/ means the package root by \"./index\"", () => {
    const src = resolve(import.meta.dir, "../../src");
    expect(importsPackageRoot(`${src}/config.ts`)).toBe(true);
    // A nested module importing its own folder's index keeps resolving there.
    expect(importsPackageRoot(`${src}/plugins/grid/plugin.ts`)).toBe(false);
    expect(importsPackageRoot(`${src}/core/create.ts`)).toBe(false);
  });

  it("without the plugin the same entry carries a whole core", async () => {
    const text = await build([]);
    expect(text).toContain(CORE_MARKER);
  });
});
