/**
 * A shipped browser bundle must not log plugin setup failures.
 *
 * The production guard used to treat a missing `process` as development
 * (`typeof process === "undefined" || NODE_ENV !== "production"`). Browser
 * bundles have no `process`, so the first disjunct was always true and a
 * built library logged in production. `process.env.NODE_ENV` (no optional
 * chaining) is what the dist `define` replaces, so the log is dropped.
 */

import { describe, it, expect } from "bun:test";

describe("production console.error guard", () => {
  it("does not treat a missing process as a reason to log", async () => {
    const src = await Bun.file(`${import.meta.dir}/../../src/core/create.ts`).text();
    expect(src).not.toMatch(/typeof process === ["']undefined["']\s*\|\|/);
    expect(src).not.toContain("process.env?.NODE_ENV");
  });

  it("the shipped dist builds define NODE_ENV, not only the size scenarios", async () => {
    const src = await Bun.file(`${import.meta.dir}/../../build.ts`).text();
    const shipped = src.slice(0, src.indexOf("Size measurement"));
    expect(shipped).toContain('"process.env.NODE_ENV"');
  });

  it("a production browser bundle drops the plugin-setup console.error", async () => {
    const result = await Bun.build({
      entrypoints: ["prod-console"],
      target: "browser",
      format: "esm",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "entry",
        setup(build) {
          build.onResolve({ filter: /^prod-console$/ }, () => ({ path: "entry", namespace: "gate" }));
          build.onLoad({ filter: /.*/, namespace: "gate" }, () => ({
            loader: "ts",
            contents: `import { createVList } from "${import.meta.dir}/../../src/core/create.ts"; globalThis._v = createVList;`,
          }));
        },
      }],
    });
    expect(result.success).toBe(true);
    const code = await result.outputs[0]!.text();
    expect(code).not.toContain("setup failed");
    expect(code).not.toMatch(/typeof process>"u"\|\|/);
  });
});
