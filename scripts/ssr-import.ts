/**
 * Import every built JavaScript entry with no browser globals.
 *
 * This is what a user's SSR server does: load the package before any window
 * exists. The list is package.json `exports`, so a new JavaScript entry is
 * covered without editing the script. Every condition branch is a target.
 * import and require that point at different files are both loaded. A shape
 * this walk cannot parse fails the gate instead of being skipped. build.ts
 * does not emit a separate file per plugin; any dist JS that is not an export
 * and not the lazy driver chunk is treated as one of those entries the day
 * it appears.
 *
 * Bun defines `navigator`, so the globals are removed before the imports.
 * A top-level read of one then fails the same way `document` does.
 *
 * Framework entries keep their peer imports external. This process resolves
 * them the way that server would, and does not bundle React, Vue, Svelte or
 * Solid into the check.
 *
 * Run after `bun run build`. Wired into CI behind the build step.
 * `bun scripts/ssr-import.ts <package root>` checks that package instead.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DRIVER_FILE } from "./lazy-driver";

/** Browser globals removed before the imports. Bun provides `navigator`. */
export const BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "ResizeObserver",
  "MutationObserver",
  "IntersectionObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "CSS",
  "customElements",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "getComputedStyle",
  "matchMedia",
] as const;

export interface JsEntry {
  readonly specifier: string;
  readonly file: string;
}

const NON_JS_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts", ".css", ".json"] as const;
const JS_EXTENSIONS = [".mjs", ".cjs", ".js"] as const;
const TYPE_CONDITIONS = new Set(["types", "typings"]);

const isNonJsPath = (file: string): boolean =>
  NON_JS_EXTENSIONS.some((extension) => file.endsWith(extension));

const isJsPath = (file: string): boolean =>
  !isNonJsPath(file) && JS_EXTENSIONS.some((extension) => file.endsWith(extension));

/**
 * JavaScript files one export value can load. `null` is an absent condition.
 * `types` is not a runtime branch. CSS, declarations and package.json are not
 * JavaScript. Anything else is refused.
 */
export const jsTargetsFromExport = (value: unknown, path: string): readonly string[] => {
  if (value === null) return [];
  if (typeof value === "string") {
    if (isNonJsPath(value)) return [];
    if (isJsPath(value)) return [value];
    throw new Error(`Unsupported export at ${path}: ${JSON.stringify(value)}`);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Unsupported export at ${path}: ${JSON.stringify(value)}`);
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (TYPE_CONDITIONS.has(key)) continue;
    found.push(...jsTargetsFromExport(child, `${path}[${JSON.stringify(key)}]`));
  }
  return found;
};

/** Every distinct JavaScript file in the exports map. Specifiers stay in map order. */
export const jsEntriesFromExports = (exportsMap: Record<string, unknown>): readonly JsEntry[] => {
  const entries: JsEntry[] = [];
  const seen = new Set<string>();
  for (const [specifier, value] of Object.entries(exportsMap)) {
    for (const file of jsTargetsFromExport(value, specifier)) {
      if (seen.has(file)) continue;
      seen.add(file);
      entries.push({ specifier, file });
    }
  }
  return entries;
};

/**
 * Plugin bundles written next to the package entries. The lazy driver chunk is
 * not one: index.js loads it only when a list asks for synthetic input.
 */
export const pluginEntryFiles = (
  distDir: string,
  exportedFiles: readonly string[],
  driverFile: string,
): readonly JsEntry[] => {
  if (!existsSync(distDir)) return [];
  const exported = new Set(exportedFiles.map((file) => file.slice(file.lastIndexOf("/") + 1)));
  return readdirSync(distDir)
    .filter((name) => name.endsWith(".js") && !exported.has(name) && name !== driverFile)
    .sort()
    .map((name) => ({ specifier: `./${name}`, file: `./dist/${name}` }));
};

/** Delete browser globals, then poison any that remain so a read throws. */
export const clearBrowserGlobals = (): void => {
  const realm = globalThis as Record<string, unknown>;
  for (const name of BROWSER_GLOBALS) {
    try {
      delete realm[name];
    } catch {
      // A non-configurable global is poisoned below.
    }
    if (realm[name] == null) continue;
    try {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: false,
        get() {
          throw new ReferenceError(`${name} is not defined`);
        },
      });
    } catch {
      throw new Error(`browser global ${name} is still set; this check must run with no browser globals`);
    }
  }
  for (const name of BROWSER_GLOBALS) {
    let value: unknown;
    try {
      value = realm[name];
    } catch {
      continue;
    }
    if (value != null) {
      throw new Error(`browser global ${name} is still set; this check must run with no browser globals`);
    }
  }
};

export const runSsrImport = async (root: string): Promise<void> => {
  clearBrowserGlobals();
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { exports?: Record<string, unknown> };
  if (!pkg.exports) throw new Error("package.json has no exports");
  const shipped = jsEntriesFromExports(pkg.exports);
  const plugins = pluginEntryFiles(resolve(root, "dist"), shipped.map((entry) => entry.file), DRIVER_FILE);
  const entries = [...shipped, ...plugins];
  if (shipped.length === 0) throw new Error("package.json exports no JavaScript entries");

  const failures: string[] = [];
  for (const entry of entries) {
    const abs = resolve(root, entry.file);
    if (!existsSync(abs)) {
      failures.push(`${entry.specifier}: missing ${entry.file}; run bun run build first`);
      continue;
    }
    try {
      await import(abs);
      console.log(`ok ${entry.specifier}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${entry.specifier} (${entry.file}): ${message}`);
    }
  }
  if (plugins.length === 0) console.log("plugin entries: none emitted");
  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log(`${entries.length} entries imported with no DOM`);
};

if (import.meta.main) {
  const root = process.argv[2] ?? resolve(import.meta.dir, "..");
  runSsrImport(root).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
