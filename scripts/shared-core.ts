/**
 * Entries other than the root import the core instead of bundling it.
 *
 * Source modules import values from "./index" (src/index.ts). In the build of
 * a secondary entry (dist/config.js, the framework entries) that import stays
 * external and points at the root bundle, `./index.js`, so an app using
 * several entries ships one core, one set of plugins and one driver cache,
 * and its bundler tree-shakes them once. Built standalone, every entry
 * carried its own copy: `createVListFromConfig` beside `createVList` was two
 * cores.
 */
import type { BunPlugin } from "bun";

export const sharedCore: BunPlugin = {
  name: "shared-core",
  setup(build) {
    build.onResolve({ filter: /^\.\/index$/ }, (args) =>
      args.importer.includes("/src/") ? { path: "./index.js", external: true } : undefined,
    );
  },
};
