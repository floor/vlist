// build.ts - Build vlist library
import { $ } from "bun";
import { readFileSync, writeFileSync, existsSync } from "fs";

const isDev = process.argv.includes("--watch");
const withTypes = process.argv.includes("--types");

async function build() {
  const totalStart = performance.now();
  console.log("Building vlist...\n");

  // Build sub-module bundles for tree-shaking
  const subStart = performance.now();

  const coreModules = [{ entry: "./src/core.ts", out: "core", folder: true }];

  const builderModules = [
    { entry: "./src/builder/index.ts", out: "builder", folder: true },
  ];

  const mainModule = { entry: "./src/index.ts", out: "index.js" };

  const pluginModules = [
    { entry: "./src/plugins/data/index.ts", out: "data", folder: true },
    {
      entry: "./src/plugins/compression/index.ts",
      out: "compression",
      folder: true,
    },
    {
      entry: "./src/plugins/selection/index.ts",
      out: "selection",
      folder: true,
    },
    { entry: "./src/plugins/scroll/index.ts", out: "scroll", folder: true },
    { entry: "./src/plugins/groups/index.ts", out: "groups", folder: true },
    { entry: "./src/plugins/grid/index.ts", out: "grid", folder: true },
    {
      entry: "./src/plugins/snapshots/index.ts",
      out: "snapshots",
      folder: true,
    },
    { entry: "./src/plugins/window/index.ts", out: "window", folder: true },
  ];

  const allModules = [...coreModules, ...builderModules, ...pluginModules];

  // Single-file builds (no folder structure)
  const singleFileModules = [
    mainModule,
    { entry: "./src/core-light.ts", out: "core-light.js" },
  ];

  // Framework adapters — built with externals so framework imports
  // are left as bare specifiers (resolved by the consumer's bundler).
  const adapterModules = [
    {
      entry: "./src/adapters/react.ts",
      out: "react",
      externals: ["react", "vlist"],
    },
    { entry: "./src/adapters/vue.ts", out: "vue", externals: ["vue", "vlist"] },
    { entry: "./src/adapters/svelte.ts", out: "svelte", externals: ["vlist"] },
  ];

  const subResults: { name: string; size: string; type: string }[] = [];

  for (const sub of allModules) {
    const moduleType = coreModules.includes(sub)
      ? "core"
      : builderModules.includes(sub)
        ? "builder"
        : "plugin";
    const subResult = await Bun.build({
      entrypoints: [sub.entry],
      outdir: `./dist/${sub.out}`,
      format: "esm",
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "none",
      naming: "index.js",
    });

    if (!subResult.success) {
      console.error(`\nSub-module build failed (${sub.out}):\n`);
      for (const log of subResult.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const subFile = Bun.file(`./dist/${sub.out}/index.js`);
    const subSize = (subFile.size / 1024).toFixed(1);
    subResults.push({ name: sub.out, size: subSize, type: moduleType });
  }

  // Build single-file modules
  for (const single of singleFileModules) {
    const singleResult = await Bun.build({
      entrypoints: [single.entry],
      outdir: "./dist",
      format: "esm",
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "none",
      naming: single.out,
    });

    if (!singleResult.success) {
      console.error(`\nSingle-file module build failed (${single.out}):\n`);
      for (const log of singleResult.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const singleFile = Bun.file(`./dist/${single.out}`);
    const singleSize = (singleFile.size / 1024).toFixed(1);
    const name = single.out.replace(".js", "");
    subResults.push({ name, size: singleSize, type: "core" });
  }

  const subTime = performance.now() - subStart;
  const subSummary = subResults
    .map((s) => `${s.name} (${s.size} KB)`)
    .join(", ");
  console.log(
    `  Sub-modules ${subTime.toFixed(0).padStart(6)}ms  ${subSummary}`,
  );

  // Build framework adapters (with external framework imports)
  const adapterStart = performance.now();
  const adapterResults: { name: string; size: string }[] = [];

  for (const adapter of adapterModules) {
    const adapterResult = await Bun.build({
      entrypoints: [adapter.entry],
      outdir: `./dist/${adapter.out}`,
      format: "esm",
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "none",
      naming: "index.js",
      external: adapter.externals,
    });

    if (!adapterResult.success) {
      console.error(`\nAdapter build failed (${adapter.out}):\n`);
      for (const log of adapterResult.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const adapterFile = Bun.file(`./dist/${adapter.out}/index.js`);
    const adapterSize = (adapterFile.size / 1024).toFixed(1);
    adapterResults.push({ name: adapter.out, size: adapterSize });
  }

  const adapterTime = performance.now() - adapterStart;
  const adapterSummary = adapterResults
    .map((a) => `${a.name} (${a.size} KB)`)
    .join(", ");
  console.log(
    `  Adapters    ${adapterTime.toFixed(0).padStart(6)}ms  ${adapterSummary}`,
  );

  // Generate type declarations (optional)
  if (withTypes) {
    const dtsStart = performance.now();
    const tsc = await $`bunx tsc -p tsconfig.build.json`.quiet().nothrow();
    if (tsc.exitCode !== 0) {
      console.error("\nTypeScript declaration generation failed:\n");
      console.error(tsc.stderr.toString());
      process.exit(1);
    }
    const dtsTime = performance.now() - dtsStart;
    console.log(
      `  Types       ${dtsTime.toFixed(0).padStart(6)}ms  dist/*.d.ts`,
    );
  }

  // Minify and copy CSS
  const cssStart = performance.now();
  const minifyCss = (src: string, dest: string) => {
    const raw = readFileSync(src, "utf-8");
    const minified = raw
      .replace(/\/\*[\s\S]*?\*\//g, "") // strip comments
      .replace(/\s*([{}:;,>~+])\s*/g, "$1") // collapse around symbols
      .replace(/;\}/g, "}") // drop trailing semicolons
      .replace(/\s+/g, " ") // collapse whitespace
      .trim();
    writeFileSync(dest, minified);
  };
  minifyCss("./src/styles/vlist.css", "./dist/vlist.css");
  minifyCss("./src/styles/vlist-extras.css", "./dist/vlist-extras.css");
  const cssTime = performance.now() - cssStart;
  const cssFile = Bun.file("./dist/vlist.css");
  const cssSize = (cssFile.size / 1024).toFixed(1);
  const extrasFile = Bun.file("./dist/vlist-extras.css");
  const extrasSize = (extrasFile.size / 1024).toFixed(1);
  console.log(
    `  CSS         ${cssTime.toFixed(0).padStart(6)}ms  dist/vlist.css (${cssSize} KB) + vlist-extras.css (${extrasSize} KB)`,
  );

  // Size summary
  const gzipBytes = async (path: string): Promise<string> => {
    const raw = await $`gzip -c ${path} | wc -c`.quiet().text();
    return (parseInt(raw.trim(), 10) / 1024).toFixed(1);
  };

  console.log("");
  console.log("  Core:");

  // Show core modules
  for (const sub of subResults.filter((s) => s.type === "core")) {
    let gzipSize;
    if (sub.name === "core-light") {
      gzipSize = await gzipBytes(`dist/${sub.name}.js`);
    } else {
      gzipSize = await gzipBytes(`dist/${sub.name}/index.js`);
    }
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSize} KB gzipped`,
    );
  }

  console.log("");
  console.log("  Builder:");

  // Show builder
  for (const sub of subResults.filter((s) => s.type === "builder")) {
    const gzipSize = await gzipBytes(`dist/${sub.name}/index.js`);
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSize} KB gzipped`,
    );
  }

  console.log("");
  console.log("  Plugins:");

  // Show plugins
  for (const sub of subResults.filter((s) => s.type === "plugin")) {
    const gzipSize = await gzipBytes(`dist/${sub.name}/index.js`);
    console.log(
      `  ${sub.name.padEnd(13)} ${sub.size} KB minified, ${gzipSize} KB gzipped`,
    );
  }

  console.log("");
  console.log("  Adapters:");
  for (const adapter of adapterResults) {
    const gzipAdapterSize = await gzipBytes(`dist/${adapter.name}/index.js`);
    console.log(
      `  ${adapter.name.padEnd(13)} ${adapter.size} KB minified, ${gzipAdapterSize} KB gzipped`,
    );
  }

  const totalTime = performance.now() - totalStart;
  console.log(`\nDone in ${totalTime.toFixed(0)}ms`);

  // Post-process: Add line breaks for esbuild-wasm compatibility
  if (!isDev) {
    console.log("\nAdding line breaks for bundler compatibility...");
    const filesToFix = [
      "./dist/index.js",
      "./dist/core-light.js",
      ...allModules.map((m) => `./dist/${m.out}/index.js`),
      ...adapterModules.map((a) => `./dist/${a.out}/index.js`),
    ];

    // Smart line breaking that avoids breaking strings
    const addLineBreaks = (code: string): string => {
      let result = "";
      let inString = false;
      let stringChar = "";
      let inTemplate = false;
      let templateDepth = 0;

      for (let i = 0; i < code.length; i++) {
        const char = code[i];
        const prev = code[i - 1];
        const next = code[i + 1];

        // Track string state
        if (!inTemplate && (char === '"' || char === "'") && prev !== "\\") {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
            stringChar = "";
          }
        }

        // Track template literal state
        if (char === "`" && prev !== "\\") {
          if (!inTemplate) {
            inTemplate = true;
            templateDepth = 1;
          } else {
            templateDepth--;
            if (templateDepth === 0) {
              inTemplate = false;
            }
          }
        }

        // Track nested templates
        if (inTemplate && char === "{" && prev === "$") {
          templateDepth++;
        } else if (inTemplate && char === "}" && templateDepth > 1) {
          templateDepth--;
        }

        result += char;

        // Add line breaks after semicolons and braces, but only outside strings
        if (!inString && !inTemplate) {
          if (
            (char === ";" || char === "}") &&
            next &&
            /[a-zA-Z$_]/.test(next)
          ) {
            result += "\n";
          }
        }
      }

      return result;
    };

    for (const file of filesToFix) {
      if (existsSync(file)) {
        let content = readFileSync(file, "utf-8");
        content = addLineBreaks(content);
        writeFileSync(file, content);
      }
    }
    console.log("✓ Line breaks added");
  }
}

if (isDev) {
  console.log("Watching for changes...\n");

  const { watch } = await import("fs");
  watch("./src", { recursive: true }, async (_event, filename) => {
    if (filename && !filename.includes("node_modules")) {
      console.log(`\n${filename} changed\n`);
      await build();
    }
  });

  await build();
} else {
  await build();
}
