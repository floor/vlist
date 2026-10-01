// Registers Happy DOM once, before any test file's module scope runs. See the
// note on registerDOM in helpers/dom.ts for why this is process-wide.
// native.ts must be evaluated before the DOM registers: it captures Bun's
// Response for the tests that run a real server in-process.
import "./helpers/native";
import { registerDOM } from "./helpers/dom";
registerDOM();

// solid-js picks its server build under Bun's default conditions ("node"):
// onMount never runs and the solid entry (src/solid.ts) would never build a
// list. vlist-solidjs ran `bun test --conditions browser`; Bun 1.4 reads no
// conditions from bunfig and its runtime plugins do not see bare package
// specifiers, so the flag would have to reach every CI command and
// scripts/coverage.ts. Instead, loading a server build serves a module that
// re-exports the browser build: `bun test` stays as it is, and the entry, the
// test and solid-js/web share one browser Solid.
Bun.plugin({
  name: "solid-browser",
  setup(build) {
    build.onLoad({ filter: /\/solid-js\/(web\/)?dist\/server\.js$/ }, ({ path }) => ({
      contents: `export * from ${JSON.stringify(path.replace(/server\.js$/, path.includes("/web/") ? "web.js" : "solid.js"))};`,
      loader: "js",
    }));
  },
});
