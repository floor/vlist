import { expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { jsEntriesFromExports } from "../../scripts/ssr-import";

const script = resolve(import.meta.dir, "../../scripts/ssr-import.ts");

const filesOf = (exportsMap: Record<string, unknown>): readonly string[] =>
  jsEntriesFromExports(exportsMap).map((entry) => entry.file);

it("reads a require branch as its own runtime target", () => {
  expect(filesOf({
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      require: "./dist/index.cjs",
      default: "./dist/index.js",
    },
    "./styles": "./dist/vlist.css",
    "./package.json": "./package.json",
  })).toEqual(["./dist/index.js", "./dist/index.cjs"]);
});

it("reads nested condition branches", () => {
  expect(filesOf({
    ".": {
      node: { import: "./dist/node.js", require: "./dist/node.cjs" },
      browser: "./dist/browser.js",
      default: "./dist/index.js",
    },
  })).toEqual(["./dist/node.js", "./dist/node.cjs", "./dist/browser.js", "./dist/index.js"]);
});

it("skips a null condition and a types path", () => {
  expect(filesOf({
    ".": { browser: null, default: "./dist/index.js", types: "./dist/evil.js" },
  })).toEqual(["./dist/index.js"]);
});

it("refuses an export shape it cannot parse", () => {
  expect(() => filesOf({ ".": { import: 1 } })).toThrow("Unsupported export");
  expect(() => filesOf({ ".": "./dist/entry.wasm" })).toThrow("Unsupported export");
});

/** Run the gate against a fixture package. The real package is not the subject. */
const gate = (root: string) => {
  const result = Bun.spawnSync([process.execPath, script, root], {
    cwd: resolve(import.meta.dir, "../.."),
    env: process.env,
    timeout: 20_000,
  });
  return {
    exitCode: result.exitCode,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
};

const fixture = (files: Record<string, string>, exportsMap: Record<string, unknown>): string => {
  const root = mkdtempSync(join(tmpdir(), "vlist-ssr-import-"));
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "ssr-fixture", type: "module", exports: exportsMap }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
};

it("imports a fixture package instead of the real one", () => {
  const root = fixture(
    { "dist/entry.js": "export const ready = true;\n" },
    { ".": "./dist/entry.js" },
  );
  try {
    const result = gate(root);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("1 entries imported with no DOM");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("fails a top-level navigator read because navigator is removed first", () => {
  const root = fixture(
    { "dist/entry.js": "void navigator.userAgent;\n" },
    { ".": "./dist/entry.js" },
  );
  try {
    const result = gate(root);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("navigator is not defined");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("imports a require branch, so a DOM read there fails the gate", () => {
  const root = fixture(
    {
      "dist/entry.js": "export const ready = true;\n",
      "dist/entry.cjs": "void document.title;\n",
    },
    {
      ".": {
        import: "./dist/entry.js",
        require: "./dist/entry.cjs",
        default: "./dist/entry.js",
      },
    },
  );
  try {
    const result = gate(root);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("document is not defined");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
