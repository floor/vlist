/** Marginal bundle attribution for RFC-014 review; variants are never written to src/. */
import ts from "typescript";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const path = resolve(root, "src/synthetic/handler.ts");
const source = readFileSync(path, "utf8");
const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const scratch = mkdtempSync("/tmp/vlist-synthetic-size-");
const entry = resolve(scratch, "entry.ts");
writeFileSync(entry, `import { createVList } from "${resolve(root, "src/synthetic.ts")}"; globalThis._v = [createVList];`);
function without(functions: string[], methods: string[] = [], multitouch = false): string {
  const edits: { start: number; end: number }[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && functions.includes(node.name.text)) {
      edits.push({ start: node.body.getStart(parsed), end: node.body.end }); return;
    }
    if (ts.isMethodDeclaration(node) && node.body && methods.includes(node.name.getText(parsed))) {
      edits.push({ start: node.body.getStart(parsed), end: node.body.end }); return;
    }
    if (multitouch && ts.isIfStatement(node) && node.expression.getText(parsed) === "pointers.size > 1") {
      edits.push({ start: node.getStart(parsed), end: node.end }); return;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + "{}" + result.slice(edit.end);
  return result;
}
async function measure(contents: string): Promise<{ min: number; gz: number }> {
  const build = await Bun.build({
    entrypoints: [entry], minify: true, format: "esm", target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "in-memory-ablation", setup(builder) {
      builder.onLoad({ filter: /synthetic\/handler\.ts$/ }, () => ({ contents, loader: "ts" }));
    } }],
  });
  if (!build.success) throw new Error(build.logs.map(String).join("\n"));
  const bytes = new Uint8Array(await build.outputs[0]!.arrayBuffer());
  return { min: bytes.byteLength, gz: Bun.gzipSync(bytes).byteLength };
}
try {
  const full = await measure(source);
  console.log(`Full synthetic entry: ${full.min} minified bytes; ${full.gz} gzip bytes`);
  console.log("Component ablated | Minified bytes removed | Gzip bytes removed | Remaining gzip bytes");
  const cases: [string, string][] = [
    ["Pointer sampling/capture/release", without(["down", "move", "end"])],
    ["Multitouch (second-pointer guard + outside handler)", without(["outsideDown"], [], true)],
    ["Click suppression callback", without(["click"])],
    ["Keyboard callback", without(["key"])],
    ["Wheel callback", without(["wheel"])],
    ["Attach/detach + exclusively reachable callees", without([], ["attach", "detach"])],
  ];
  for (const [name, contents] of cases) {
    const cut = await measure(contents);
    console.log(`${name} | ${full.min - cut.min} | ${full.gz - cut.gz} | ${cut.gz}`);
  }
  console.log("Marginal in-memory ablations, not additive component sizes: shared state, dead-code elimination and gzip interact.");
  console.log("Lifecycle ablation includes any tree-shaking of exclusively reachable callees, not only literal registration code.");
  writeFileSync(entry, `import { createMotion } from "${resolve(root, "src/synthetic/motion.ts")}"; globalThis._v = [createMotion];`);
  const model = await measure(source);
  console.log(`Standalone motion model (separately compressed, not additive): ${model.min} minified bytes; ${model.gz} gzip bytes`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
