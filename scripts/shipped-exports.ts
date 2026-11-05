// Names a published entry actually provides at runtime, against the names its
// .d.ts declares as values. The build wrapper is derived from the same rule:
// a hand-kept list drifted, and `import { DEFAULT_SEARCH_TEXT } from "vlist"`
// failed at link time because the types named an export the bundle did not.

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import ts from "typescript";

export interface PackageEntry {
  readonly subpath: string;
  /** Path under the package root, as package.json writes it (`./dist/index.js`). */
  readonly jsRel: string;
  readonly dtsRel: string;
}

export interface EntryGap {
  readonly subpath: string;
  readonly missingAtRuntime: readonly string[];
  readonly onlyAtRuntime: readonly string[];
}

interface ParsedExports {
  readonly names: readonly string[];
  readonly stars: readonly string[];
}

let cachedProgram: { readonly root: string; readonly program: ts.Program } | undefined;

/** JS subpaths in `package.json` `exports`. Styles and `./package.json` are not modules. */
export function packageEntries(root: string): readonly PackageEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("exports" in parsed)) {
    throw new Error("package.json has no exports");
  }
  const exportsField = parsed.exports;
  if (typeof exportsField !== "object" || exportsField === null) {
    throw new Error("package.json exports is not an object");
  }
  const entries: PackageEntry[] = [];
  for (const [subpath, value] of Object.entries(exportsField)) {
    if (typeof value !== "object" || value === null) continue;
    if (!("types" in value) || !("import" in value)) continue;
    const types = value.types;
    const imported = value.import;
    if (typeof types !== "string" || typeof imported !== "string") continue;
    if (!types.endsWith(".d.ts") || !imported.endsWith(".js")) continue;
    entries.push({ subpath, jsRel: imported, dtsRel: types });
  }
  return entries;
}

/**
 * Value exports of a source entry. Const enums are values to the type system
 * and absent from the runtime emit (`preserveConstEnums` is off), so they are
 * not part of the set the bundle has to provide.
 */
export function sourceValueExports(root: string, entryAbs: string): readonly string[] {
  const program = sourceProgram(root);
  const file = sourceFile(program, entryAbs);
  return valueExportNames(program.getTypeChecker(), file);
}

/** Re-export every runtime value so Bun cannot tree-shake the barrel to a stub. */
export function forceInclusionWrapper(root: string, entryAbs: string): string {
  const names = sourceValueExports(root, entryAbs);
  if (names.length === 0) {
    throw new Error(`no value exports in ${entryAbs}`);
  }
  return `export { ${names.join(", ")} } from ${JSON.stringify(entryAbs)};\n`;
}

/**
 * Diff every package entry's declaration file in `distDir` against the JS
 * beside it. `missingAtRuntime` is a name the .d.ts declares as a value that
 * an ESM importer cannot bind. `onlyAtRuntime` is the reverse.
 */
export function diffShippedExports(packageRoot: string, distDir: string): readonly EntryGap[] {
  const entries = packageEntries(packageRoot);
  const dtsAbs = entries.map((entry) => distFile(distDir, entry.dtsRel));
  const program = ts.createProgram({
    rootNames: dtsAbs,
    options: {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      skipLibCheck: true,
      esModuleInterop: true,
    },
  });
  const checker = program.getTypeChecker();
  const gaps: EntryGap[] = [];
  for (const entry of entries) {
    const dts = distFile(distDir, entry.dtsRel);
    const js = distFile(distDir, entry.jsRel);
    const file = program.getSourceFile(dts);
    if (!file) {
      throw new Error(`declaration file was not loaded: ${dts}`);
    }
    const declared = valueExportNames(checker, file);
    const runtime = runtimeExportNames(js);
    const runtimeSet = new Set(runtime);
    const declaredSet = new Set(declared);
    const missingAtRuntime = declared.filter((name) => !runtimeSet.has(name));
    const onlyAtRuntime = runtime.filter((name) => !declaredSet.has(name));
    if (missingAtRuntime.length > 0 || onlyAtRuntime.length > 0) {
      gaps.push({ subpath: entry.subpath, missingAtRuntime, onlyAtRuntime });
    }
  }
  return gaps;
}

export function formatExportGaps(gaps: readonly EntryGap[]): string {
  return gaps
    .map((gap) => {
      const lines = [gap.subpath];
      if (gap.missingAtRuntime.length > 0) {
        lines.push(`  missing at runtime: ${gap.missingAtRuntime.join(", ")}`);
      }
      if (gap.onlyAtRuntime.length > 0) {
        lines.push(`  only at runtime: ${gap.onlyAtRuntime.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function sourceProgram(root: string): ts.Program {
  const abs = resolve(root);
  if (cachedProgram?.root === abs) return cachedProgram.program;
  const configPath = join(abs, "tsconfig.build.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, abs);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
  });
  cachedProgram = { root: abs, program };
  return program;
}

function sourceFile(program: ts.Program, entryAbs: string): ts.SourceFile {
  const want = resolve(entryAbs);
  const direct = program.getSourceFile(want);
  if (direct) return direct;
  const found = program.getSourceFiles().find((file) => resolve(file.fileName) === want);
  if (!found) throw new Error(`entry not in the type program: ${entryAbs}`);
  return found;
}

function valueExportNames(checker: ts.TypeChecker, file: ts.SourceFile): readonly string[] {
  const moduleSymbol = checker.getSymbolAtLocation(file);
  if (!moduleSymbol) throw new Error(`no module symbol for ${file.fileName}`);
  const names: string[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    if (isRuntimeValue(checker, exported)) names.push(exported.getName());
  }
  names.sort();
  return names;
}

function isRuntimeValue(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(current)) return false;
    seen.add(current);
    const next = checker.getAliasedSymbol(current);
    if (next === current) break;
    current = next;
  }
  if ((current.flags & ts.SymbolFlags.ConstEnum) !== 0) return false;
  return (current.flags & ts.SymbolFlags.Value) !== 0;
}

function distFile(distDir: string, exportPath: string): string {
  const normalized = exportPath.replace(/^\.\//, "");
  const prefix = "dist/";
  if (!normalized.startsWith(prefix)) {
    throw new Error(`export path is not under dist/: ${exportPath}`);
  }
  return resolve(distDir, normalized.slice(prefix.length));
}

function runtimeExportNames(fileAbs: string, seen: Set<string> = new Set()): readonly string[] {
  if (seen.has(fileAbs)) return [];
  seen.add(fileAbs);
  const parsed = parseRuntimeExports(fileAbs, readFileSync(fileAbs, "utf8"));
  const names = new Set<string>(parsed.names);
  for (const spec of parsed.stars) {
    if (!spec.startsWith(".")) {
      throw new Error(`non-relative export * in ${fileAbs}: ${spec}`);
    }
    for (const name of runtimeExportNames(resolve(dirname(fileAbs), spec), seen)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function parseRuntimeExports(fileName: string, text: string): ParsedExports {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const names = new Set<string>();
  const stars: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node)) {
      collectExportDeclaration(node, names, stars);
    } else if (ts.isExportAssignment(node)) {
      names.add("default");
    } else {
      collectExportedDeclaration(node, names);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { names: [...names], stars };
}

function collectExportDeclaration(node: ts.ExportDeclaration, names: Set<string>, stars: string[]): void {
  if (node.isTypeOnly) return;
  if (!node.exportClause) {
    const spec = node.moduleSpecifier;
    stars.push(spec && ts.isStringLiteral(spec) ? spec.text : "");
    return;
  }
  if (ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      if (!element.isTypeOnly) names.add(moduleExportName(element.name));
    }
    return;
  }
  names.add(moduleExportName(node.exportClause.name));
}

function collectExportedDeclaration(node: ts.Node, names: Set<string>): void {
  if (!ts.canHaveModifiers(node)) return;
  const modifiers = ts.getModifiers(node);
  if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return;
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
    names.add("default");
    return;
  }
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
    if (node.name) names.add(node.name.text);
    return;
  }
  if (!ts.isVariableStatement(node)) return;
  for (const declaration of node.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
  }
}

function moduleExportName(name: ts.ModuleExportName): string {
  return name.text;
}
