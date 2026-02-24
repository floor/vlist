/**
 * vlist - Builder Context Tests
 *
 * NOTE: createBuilderContext (src/builder/context.ts) is extensively tested
 * through builder/index.test.ts (233 tests, 531 assertions). Every call to
 * vlist().build() creates a BuilderContext internally, so the factory is
 * exercised across all feature combinations, lifecycle phases, and edge cases.
 *
 * Coverage is achieved indirectly because:
 * - Every builder integration test creates a context via .build()
 * - Feature setup tests exercise ctx.replaceRenderer, ctx.replaceDataManager,
 *   ctx.setVirtualTotalFn, ctx.rebuildSizeCache, ctx.setSizeConfig, etc.
 * - Handler registration (afterScroll, clickHandlers, keydownHandlers,
 *   resizeHandlers, destroyHandlers) is tested through feature wiring
 * - Render helpers (renderIfNeeded, forceRender, getItemsForRange) are
 *   tested through scroll and data integration tests
 * - Compression helpers (getCachedCompression, getCompressionContext,
 *   updateCompressionMode) are tested through scale/compression tests
 *
 * This file exists to maintain the 1:1 source↔test mapping convention.
 * Add unit tests here for context internals not reachable through the
 * builder integration tests.
 */

import { describe, it, expect } from "bun:test";
import { createBuilderContext } from "../../src/builder/context";

// =============================================================================
// Smoke Tests
// =============================================================================

describe("builder/context.ts (see index.test.ts for full coverage)", () => {
  it("should export createBuilderContext function", () => {
    expect(typeof createBuilderContext).toBe("function");
  });
});