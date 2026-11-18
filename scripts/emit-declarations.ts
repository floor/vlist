import { dirname, relative, resolve } from "path";
import ts from "typescript";

export function emitDeclarations(outDir: string): void {
  const configPath = resolve("tsconfig.build.json");
  const host = ts.createCompilerHost({});
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.formatDiagnostics([config.error], host));

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), {
    outDir: resolve(outDir),
  }, configPath);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length > 0) throw new Error(ts.formatDiagnostics(diagnostics, host));

  const result = program.emit(undefined, undefined, undefined, true, {
    afterDeclarations: [explicitSpecifiers(parsed.options)],
  });
  if (result.emitSkipped || result.diagnostics.length > 0) {
    throw new Error(ts.formatDiagnostics(result.diagnostics, host) || "Declaration emit skipped");
  }
}

// Use the source program's resolution rules to distinguish a file from a
// directory barrel. Rewrite before the printer so declaration maps stay valid.
function explicitSpecifiers(options: ts.CompilerOptions): ts.TransformerFactory<ts.SourceFile | ts.Bundle> {
  const cache = ts.createModuleResolutionCache(ts.sys.getCurrentDirectory(), (file) => file, options);
  return (context) => (file) => {
    if (ts.isBundle(file)) return file;
    const { factory } = context;
    const rewrite = (literal: ts.StringLiteral): ts.StringLiteral => {
      const specifier = literal.text;
      if (!/^\.{1,2}(?:\/|$)/.test(specifier)) return literal;

      const target = ts.resolveModuleName(specifier, file.fileName, options, ts.sys, cache)
        .resolvedModule?.resolvedFileName;
      if (!target || !target.endsWith(".ts")) return literal;

      const path = relative(dirname(file.fileName), target).replace(/\\/g, "/")
        .replace(/(?:\.d)?\.ts$/, ".js");
      const explicit = path.startsWith("../") ? path : `./${path}`;
      if (explicit === specifier) return literal;
      return ts.setTextRange(factory.createStringLiteral(explicit), literal);
    };

    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        return factory.updateImportDeclaration(node, node.modifiers, node.importClause,
          rewrite(node.moduleSpecifier), node.attributes);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        return factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly,
          node.exportClause, rewrite(node.moduleSpecifier), node.attributes);
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        const argument = factory.updateLiteralTypeNode(node.argument, rewrite(node.argument.literal));
        return ts.visitEachChild(factory.updateImportTypeNode(node, argument, node.attributes,
          node.qualifier, node.typeArguments, node.isTypeOf), visit, context);
      }
      if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) {
        return factory.updateExternalModuleReference(node, rewrite(node.expression));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitEachChild(file, visit, context);
  };
}
