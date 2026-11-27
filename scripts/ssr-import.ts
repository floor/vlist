/**
 * Import every built JS entry with no DOM globals.
 *
 * This is what a user's SSR server does: load the package before any window
 * exists. The list is package.json `exports`, so a new JS entry is covered
 * without editing the script. build.ts does not emit a separate file per
 * plugin; any dist JS that is not an export and not the lazy driver chunk is
 * treated as one of those entries the day it appears.
 *
 * Framework entries keep their peer imports external. This process resolves
 * them the way that server would, and does not bundle React, Vue, Svelte or
 * Solid into the check.
 *
 * Run after `bun run build`. Wired into CI behind the build step.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DRIVER_FILE } from "./lazy-driver";

const DOM_GLOBALS = ["window", "document", "HTMLElement", "ResizeObserver", "requestAnimationFrame"] as const;

export interface JsEntry {
  readonly specifier: string;
  readonly file: string;
}

/** The JS file an export points at, or null for CSS, types and the package.json path. */
export const jsFileFromExport = (value: unknown): string | null => {
  if (typeof value === "string") return value.endsWith(".js") ? value : null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const chosen = record.import ?? record.default;
  if (typeof chosen === "string" && chosen.endsWith(".js")) return chosen;
  return null;
};

/** Every JS entry in the exports map. Specifiers stay in map order. */
export const jsEntriesFromExports = (exportsMap: Record<string, unknown>): readonly JsEntry[] => {
  const entries: JsEntry[] = [];
  for (const [specifier, value] of Object.entries(exportsMap)) {
    const file = jsFileFromExport(value);
    if (file) entries.push({ specifier, file });
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

const assertNoDom = (): void => {
  for (const name of DOM_GLOBALS) {
    const value = (globalThis as Record<string, unknown>)[name];
    if (value != null) {
      throw new Error(`DOM global ${name} is set; this check must run in a process with no DOM`);
    }
  }
};

const root = resolve(import.meta.dir, "..");

if (import.meta.main) {
  assertNoDom();
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { exports?: Record<string, unknown> };
  if (!pkg.exports) throw new Error("package.json has no exports");
  const shipped = jsEntriesFromExports(pkg.exports);
  const plugins = pluginEntryFiles(resolve(root, "dist"), shipped.map((entry) => entry.file), DRIVER_FILE);
  const entries = [...shipped, ...plugins];
  if (shipped.length === 0) throw new Error("package.json exports no JS entries");

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
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`${entries.length} entries imported with no DOM`);
}
