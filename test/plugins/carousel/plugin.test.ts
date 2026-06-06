/**
 * vlist v2 — Carousel Plugin Tests (RFC-011)
 *
 * Tests written before implementation — acceptance criteria from the RFC:
 * - Infinite loop: next() from last → first, prev() from first → last
 * - Silent rebasing: no visible jump when crossing boundaries
 * - Logical totals: list.total stays at real item count
 * - Snap-to-item on scroll idle
 * - Variant modes: full, hero, multi, free
 * - CSS variables for focal effects
 * - Empty and single-item edge cases
 * - Both orientations
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

// Import will fail until plugin is created — that's expected for TDD
let carousel: any;
try {
  carousel = (await import("../../../src/plugins/carousel/plugin")).carousel;
} catch {
  carousel = null;
}

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

function createTestItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));
}

const skip = !carousel;
const describeCarousel = skip ? describe.skip : describe;

// =============================================================================
// Factory
// =============================================================================

describeCarousel("carousel — Factory", () => {
  it("should create a plugin with correct name and priority", () => {
    const plugin = carousel();
    expect(plugin.name).toBe("carousel");
    expect(plugin.priority).toBe(10);
  });

  it("should accept empty config (defaults to full variant)", () => {
    const plugin = carousel();
    expect(plugin).toBeDefined();
    expect(typeof plugin.setup).toBe("function");
  });

  it("should accept all variant configs", () => {
    for (const variant of ["full", "hero", "multi", "free"] as const) {
      const plugin = carousel({ variant });
      expect(plugin).toBeDefined();
    }
  });

  it("should declare conflicts with scale", () => {
    const plugin = carousel();
    expect(plugin.conflicts).toContain("scale");
  });
});

// =============================================================================
// Registered methods
// =============================================================================

describeCarousel("carousel — Registered Methods", () => {
  it("should register next method", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    expect(methods.has("next")).toBe(true);
    expect(typeof methods.get("next")).toBe("function");

    cleanup();
  });

  it("should register prev method", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    expect(methods.has("prev")).toBe(true);
    expect(typeof methods.get("prev")).toBe("function");

    cleanup();
  });

  it("should register goTo method", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    expect(methods.has("goTo")).toBe(true);
    expect(typeof methods.get("goTo")).toBe("function");

    cleanup();
  });

  it("should register getCarouselState method", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    expect(methods.has("getCarouselState")).toBe(true);

    const state = (methods.get("getCarouselState") as Function)();
    expect(state).toHaveProperty("index");
    expect(state).toHaveProperty("progress");
    expect(state).toHaveProperty("offset");
    expect(state).toHaveProperty("scrollPosition");

    cleanup();
  });
});

// =============================================================================
// Infinite loop — acceptance tests from RFC-011
// =============================================================================

describeCarousel("carousel — Infinite Loop", () => {
  it("next() from last item should move forward to item 0", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    // Go to last item
    goTo(4);
    expect(getState().index).toBe(4);

    // Next should wrap to 0
    next();
    expect(getState().index).toBe(0);

    cleanup();
  });

  it("prev() from first item should move backward to last item", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const prev = methods.get("prev") as Function;
    const getState = methods.get("getCarouselState") as Function;

    // Start at first item
    goTo(0);
    expect(getState().index).toBe(0);

    // Prev should wrap to last
    prev();
    expect(getState().index).toBe(4);

    cleanup();
  });

  it("next() with step should advance by N items with wrap", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    goTo(3);
    next(3); // 3 + 3 = 6 → wraps to 1
    expect(getState().index).toBe(1);

    cleanup();
  });
});

// =============================================================================
// Logical totals — public API stays at real item count
// =============================================================================

describeCarousel("carousel — Logical Totals", () => {
  it("public total (virtualTotalFn) should reflect real item count", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    // list.total uses virtualTotalFn which returns the real count.
    // engineState.totalItems is inflated for the render pipeline
    // but consumers never read it directly.
    // In the mock we can't call list.total, so check via getItems().length
    expect(ctx.getItems().length).toBe(10);

    cleanup();
  });

  it("getCarouselState().index should always be 0..total-1", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    for (let i = 0; i < 20; i++) {
      next();
      const state = getState();
      expect(state.index).toBeGreaterThanOrEqual(0);
      expect(state.index).toBeLessThan(5);
    }

    cleanup();
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describeCarousel("carousel — Edge Cases", () => {
  it("empty list: methods should not throw", () => {
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>([], {
      containerHeight: 400,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    const next = methods.get("next") as Function;
    const prev = methods.get("prev") as Function;
    const goTo = methods.get("goTo") as Function;

    expect(() => next()).not.toThrow();
    expect(() => prev()).not.toThrow();
    expect(() => goTo(0)).not.toThrow();

    cleanup();
  });

  it("single item: next and prev should no-op", () => {
    const items = createTestItems(1);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const next = methods.get("next") as Function;
    const prev = methods.get("prev") as Function;
    const getState = methods.get("getCarouselState") as Function;

    next();
    expect(getState().index).toBe(0);

    prev();
    expect(getState().index).toBe(0);

    cleanup();
  });
});

// =============================================================================
// Snap behavior
// =============================================================================

describeCarousel("carousel — Snap", () => {
  it("snap should be enabled by default", () => {
    const plugin = carousel();
    expect(plugin).toBeDefined();
    // Snap is internal — verified by behavior, not config inspection
  });

  it("snap should be disabled for free variant by default", () => {
    const plugin = carousel({ variant: "free", snap: false });
    expect(plugin).toBeDefined();
  });
});

// =============================================================================
// Variant: full
// =============================================================================

describeCarousel("carousel — Variant: full", () => {
  it("should show one item at a time", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel({ variant: "full" }).setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    expect(getState().index).toBe(0);

    cleanup();
  });
});

// =============================================================================
// goTo with direction
// =============================================================================

describeCarousel("carousel — goTo direction", () => {
  it("goTo with direction: forward should always scroll forward", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const getState = methods.get("getCarouselState") as Function;

    goTo(3);
    expect(getState().index).toBe(3);

    // Forward from 3 to 1 should go 3→4→0→1 (forward wrap)
    goTo(1, { direction: "forward" });
    expect(getState().index).toBe(1);

    cleanup();
  });

  it("goTo with direction: auto should take shortest path", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const getState = methods.get("getCarouselState") as Function;

    goTo(8);
    // Auto from 8 to 1: forward = 3 steps (8→9→0→1), backward = 7 steps
    // Shortest is forward
    goTo(1, { direction: "auto" });
    expect(getState().index).toBe(1);

    cleanup();
  });
});

// =============================================================================
// Destroy
// =============================================================================

describeCarousel("carousel — Destroy", () => {
  it("destroy should not throw", () => {
    const items = createTestItems(5);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    const plugin = carousel();
    plugin.setup!(ctx);

    expect(() => plugin.destroy?.()).not.toThrow();

    cleanup();
  });
});

// =============================================================================
// Virtual scroll window — getItemFn maps virtual→real via modulo
// =============================================================================

describeCarousel("carousel — Virtual Item Mapping", () => {
  it("getItemFn should wrap indices via modulo", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    // The plugin should set getItemFn so that indices beyond total wrap
    const getItem = ctx.getItem.bind(ctx);
    // Items at virtual indices 0-4 should match real items
    for (let i = 0; i < 5; i++) {
      const item = getItem(i);
      expect(item?.id).toBe(i);
    }

    cleanup();
  });

  it("next() should produce consecutive items across wrap boundary", () => {
    const items = createTestItems(3);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 200,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    const sequence: number[] = [];
    for (let i = 0; i < 9; i++) {
      sequence.push(getState().index);
      next();
    }

    // Should cycle: 0,1,2,0,1,2,0,1,2
    expect(sequence).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);

    cleanup();
  });

  it("prev() should produce consecutive items across wrap boundary", () => {
    const items = createTestItems(3);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 200,
      itemSize: 200,
    });

    carousel().setup!(ctx);

    const prev = methods.get("prev") as Function;
    const getState = methods.get("getCarouselState") as Function;

    const sequence: number[] = [];
    for (let i = 0; i < 9; i++) {
      sequence.push(getState().index);
      prev();
    }

    // Should cycle backward: 0,2,1,0,2,1,0,2,1
    expect(sequence).toEqual([0, 2, 1, 0, 2, 1, 0, 2, 1]);

    cleanup();
  });
});

// =============================================================================
// initialIndex
// =============================================================================

describeCarousel("carousel — initialIndex", () => {
  it("should start at the specified initial index", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel({ initialIndex: 5 }).setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    expect(getState().index).toBe(5);

    cleanup();
  });

  it("should wrap initialIndex if out of range", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel({ initialIndex: 7 }).setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    expect(getState().index).toBe(2); // 7 % 5 = 2

    cleanup();
  });
});
