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
import { dirname, resolve } from "path";

const SRC = resolve(import.meta.dir, "../src");

/**
 * Only an entry sitting directly in src/ means the package root by "./index".
 * A module deeper down (src/plugins/grid/…) importing its own folder's index
 * must keep resolving there.
 */
export const importsPackageRoot = (importer: string): boolean => dirname(importer) === SRC;

export const sharedCore: BunPlugin = {
  name: "shared-core",
  setup(build) {
    build.onResolve({ filter: /^\.\/index$/ }, (args) =>
      importsPackageRoot(args.importer) ? { path: "./index.js", external: true } : undefined,
    );
  },
};
