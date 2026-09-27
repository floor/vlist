/**
 * scroll.mode loads the synthetic driver with `import("../synthetic/driver")`.
 * In a build that import stays lazy and points at `dist/synthetic-driver.js`,
 * a self-contained file built on its own. Letting the bundler split instead
 * moved the constants and helpers the driver shares with the core into a
 * common chunk, and the base paid 446 B gzipped for no longer inlining them.
 */
import type { BunPlugin } from "bun";

export const DRIVER_FILE = "synthetic-driver.js";

export const lazyDriver: BunPlugin = {
  name: "lazy-synthetic-driver",
  setup(build) {
    build.onResolve({ filter: /\/synthetic\/driver$/ }, (args) =>
      args.kind === "dynamic-import" ? { path: `./${DRIVER_FILE}`, external: true } : undefined,
    );
  },
};
