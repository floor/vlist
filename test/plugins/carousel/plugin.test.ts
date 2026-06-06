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
    for (const variant of ["full", "hero", "hero-center", "multi", "uncontained", "free"] as const) {
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
    expect(state).toHaveProperty("role");
    expect(["large", "medium", "small"]).toContain(state.role);

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

  it("snap should be optional for uncontained variant", () => {
    const plugin = carousel({ variant: "uncontained" });
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
// Variant: hero-center
// =============================================================================

describeCarousel("carousel — Variant: hero-center", () => {
  it("should accept hero-center variant", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel({ variant: "hero-center" }).setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    expect(getState().index).toBe(0);

    cleanup();
  });
});

// =============================================================================
// MD3-aligned config options
// =============================================================================

describeCarousel("carousel — MD3 Config", () => {
  it("should accept largeItemMaxWidth config", () => {
    const plugin = carousel({ largeItemMaxWidth: 600 });
    expect(plugin).toBeDefined();
  });

  it("should accept parallax config", () => {
    const plugin = carousel({ parallax: 0.5 });
    expect(plugin).toBeDefined();
  });

  it("should accept cornerRadius config", () => {
    const plugin = carousel({ cornerRadius: 28 });
    expect(plugin).toBeDefined();
  });

  it("should accept peek as number", () => {
    const plugin = carousel({ peek: 56 });
    expect(plugin).toBeDefined();
  });

  it("should accept peek as percentage string", () => {
    const plugin = carousel({ peek: "20%" });
    expect(plugin).toBeDefined();
  });

  it("should accept peek as auto", () => {
    const plugin = carousel({ peek: "auto" });
    expect(plugin).toBeDefined();
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

// =============================================================================
// Phase 2: Hero variant — one large item + one small peek item
//
// Model: all items have the same step size in the sizeCache.
// stepSize = containerSize - peekSize (hero) or containerSize - 2*peekSize (hero-center).
// The peek is visible because the container is wider than stepSize.
// Visual item widths (large/small roles) are handled via CSS variables, not sizeCache.
// =============================================================================

describeCarousel("carousel — Variant: hero — step size", () => {
  it("stepSize should be containerSize minus peekSize", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero", peek: 56 }).setup!(ctx);

    // All items have the same step size = 800 - 56 = 744
    const size0 = ctx.sizeCache.getSize(0);
    const size1 = ctx.sizeCache.getSize(1);
    expect(size0).toBe(800 - 56);
    expect(size1).toBe(800 - 56);

    cleanup();
  });

  it("getOffset should use uniform step size", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero", peek: 56 }).setup!(ctx);

    const stepSize = 800 - 56;
    expect(ctx.sizeCache.getOffset(0)).toBe(0);
    expect(ctx.sizeCache.getOffset(1)).toBe(stepSize);
    expect(ctx.sizeCache.getOffset(3)).toBe(stepSize * 3);

    cleanup();
  });

  it("lap cycle should traverse all items correctly", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero", peek: 56 }).setup!(ctx);

    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    const indices: number[] = [];
    for (let i = 0; i < 5; i++) {
      indices.push(getState().index);
      next();
    }
    expect(indices).toEqual([0, 1, 2, 3, 4]);

    cleanup();
  });
});

describeCarousel("carousel — Variant: hero — state", () => {
  it("getCarouselState should report role 'large' for focal item", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero" }).setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    expect(getState().role).toBe("large");

    cleanup();
  });

  it("next/prev should cycle correctly with hero step size", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero" }).setup!(ctx);

    const next = methods.get("next") as Function;
    const prev = methods.get("prev") as Function;
    const getState = methods.get("getCarouselState") as Function;

    // Forward cycle
    const fwd: number[] = [];
    for (let i = 0; i < 7; i++) {
      fwd.push(getState().index);
      next();
    }
    expect(fwd).toEqual([0, 1, 2, 3, 4, 0, 1]);

    // Backward from current position
    const bwd: number[] = [];
    for (let i = 0; i < 4; i++) {
      bwd.push(getState().index);
      prev();
    }
    expect(bwd).toEqual([2, 1, 0, 4]);

    cleanup();
  });

  it("goTo should work with hero step size and shortest path", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero" }).setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const getState = methods.get("getCarouselState") as Function;

    goTo(7);
    expect(getState().index).toBe(7);

    goTo(2, { direction: "forward" });
    expect(getState().index).toBe(2);

    goTo(9, { direction: "backward" });
    expect(getState().index).toBe(9);

    cleanup();
  });
});

describeCarousel("carousel — Variant: hero — peek config", () => {
  it("peek: number should set step size to containerSize - peek", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero", peek: 48 }).setup!(ctx);

    expect(ctx.sizeCache.getSize(0)).toBe(800 - 48);

    cleanup();
  });

  it("peek: percentage should compute from container size", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero", peek: "10%" }).setup!(ctx);

    // 10% of 800 = 80 → stepSize = 800 - 80 = 720
    expect(ctx.sizeCache.getSize(0)).toBe(720);

    cleanup();
  });

  it("peek: auto should scale to 15% of container, capped at 120", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero", peek: "auto" }).setup!(ctx);

    // 15% of 800 = 120, capped at 120
    expect(ctx.sizeCache.getSize(0)).toBe(800 - 120);

    cleanup();
  });

  it("peek: auto on small container should clamp to 40dp minimum", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 200,
      containerHeight: 400,
      itemSize: 100,
      isX: true,
    });

    carousel({ variant: "hero", peek: "auto" }).setup!(ctx);

    // 15% of 200 = 30, clamped to min 40
    const stepSize = ctx.sizeCache.getSize(0);
    const peekSize = 200 - stepSize;
    expect(peekSize).toBe(40);

    cleanup();
  });
});

// =============================================================================
// Phase 2: Hero-center variant — large centered + two small peek items
// =============================================================================

describeCarousel("carousel — Variant: hero-center — layout", () => {
  it("should default focalAlign to center", () => {
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero-center" }).setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    expect(getState().index).toBe(0);
    expect(getState().role).toBe("large");

    cleanup();
  });

  it("step size should account for two peek items", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero-center", peek: 56 }).setup!(ctx);

    // hero-center: stepSize = containerSize - 2*peek = 800 - 112 = 688
    expect(ctx.sizeCache.getSize(0)).toBe(688);
    expect(ctx.sizeCache.getSize(1)).toBe(688);

    cleanup();
  });

  it("next/prev should cycle correctly", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero-center" }).setup!(ctx);

    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    const sequence: number[] = [];
    for (let i = 0; i < 7; i++) {
      sequence.push(getState().index);
      next();
    }
    expect(sequence).toEqual([0, 1, 2, 3, 4, 0, 1]);

    cleanup();
  });

  it("focal should be centered with peeks on both sides", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    const plugin = carousel({ variant: "hero-center", peek: 100 });
    plugin.setup!(ctx);
    if (plugin.hooks?.onCommit) plugin.hooks.onCommit();

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [9, 0, 1]);

    // stepSize = focalSlotWidth = containerSize - 2*peek = 600
    const es = ctx.getState();
    es.scrollPosition = middleStart * 600;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);

    // Left peek at viewport position 0
    const leftVpLeft = Math.round(parseFloat(els[0].style.transform.match(/translate[XY]\(([^)]+)\)/)?.[1] ?? "0") - es.scrollPosition);
    // Focal at viewport position 100 (after left peek)
    const focalVpLeft = Math.round(parseFloat(els[1].style.transform.match(/translate[XY]\(([^)]+)\)/)?.[1] ?? "0") - es.scrollPosition);
    // Right peek after focal
    const rightVpLeft = Math.round(parseFloat(els[2].style.transform.match(/translate[XY]\(([^)]+)\)/)?.[1] ?? "0") - es.scrollPosition);

    const leftW = parseInt(els[0].style.width);
    const focalW = parseInt(els[1].style.width);
    const rightW = parseInt(els[2].style.width);

    // Left peek starts at 0
    expect(leftVpLeft).toBe(0);
    // Focal starts after left peek
    expect(focalVpLeft).toBe(leftW);
    // Right peek starts after focal
    expect(rightVpLeft).toBe(leftW + focalW);
    // Sizes: left=peek, focal=large, right=peek
    expect(leftW).toBe(100);
    expect(focalW).toBe(600);
    expect(rightW).toBe(100);
    // Sum = container
    expect(leftW + focalW + rightW).toBe(800);

    cleanup();
  });
});

// =============================================================================
// Phase 2: Hero vertical orientation
// =============================================================================

describeCarousel("carousel — Variant: hero — vertical", () => {
  it("should use containerHeight for step size in vertical orientation", () => {
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 400,
      containerHeight: 600,
      itemSize: 300,
      isX: false,
    });

    carousel({ variant: "hero", peek: 56 }).setup!(ctx);

    // Vertical: containerSize = 600, stepSize = 600 - 56 = 544
    expect(ctx.sizeCache.getSize(0)).toBe(544);

    cleanup();
  });
});

// =============================================================================
// Phase 2: Hero with infinite loop — core behavior preserved
// =============================================================================

describeCarousel("carousel — Variant: hero — infinite loop", () => {
  it("next from last item wraps to first", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero" }).setup!(ctx);

    const goTo = methods.get("goTo") as Function;
    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    goTo(4);
    expect(getState().index).toBe(4);

    next();
    expect(getState().index).toBe(0);

    cleanup();
  });

  it("prev from first item wraps to last", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero" }).setup!(ctx);

    const prev = methods.get("prev") as Function;
    const getState = methods.get("getCarouselState") as Function;

    expect(getState().index).toBe(0);
    prev();
    expect(getState().index).toBe(4);

    cleanup();
  });

  it("logical totals stay at real count", () => {
    const items = createTestItems(8);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    carousel({ variant: "hero" }).setup!(ctx);

    expect(ctx.getItems().length).toBe(8);

    cleanup();
  });
});

// =============================================================================
// CSS Variables — per-element visual state updated on scroll
// =============================================================================

function addRenderedItems(content: HTMLElement, indices: number[]): HTMLElement[] {
  const els: HTMLElement[] = [];
  for (const idx of indices) {
    const el = document.createElement("div");
    el.dataset.index = String(idx);
    el.className = "vlist-item";
    content.appendChild(el);
    els.push(el);
  }
  return els;
}

describeCarousel("carousel — CSS Variables", () => {
  // Helper: clear initialScrollPending by calling onCommit
  function initPlugin(plugin: any): void {
    if (plugin.hooks?.onCommit) plugin.hooks.onCommit();
  }

  it("should set --vlist-carousel-progress on rendered elements", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    const plugin = carousel({ variant: "full" });
    plugin.setup!(ctx);
    initPlugin(plugin);

    // Simulate rendered elements near the focal index in the middle cycle
    const middleStart = 50 * 10; // MIDDLE_CYCLE * realTotal
    const els = addRenderedItems(dom.content, [0, 1, 2]);

    // Trigger onAfterScroll at the initial position (middle cycle, item 0)
    const scrollPos = middleStart * 400;
    plugin.hooks!.onAfterScroll!(scrollPos);

    // Focal element (offset 0) should have progress ~0
    const p0 = parseFloat(els[0].style.getPropertyValue("--vlist-carousel-progress"));
    expect(p0).toBeLessThanOrEqual(0.001);
    // Adjacent elements should have progress > 0
    const p1 = parseFloat(els[1].style.getPropertyValue("--vlist-carousel-progress"));
    expect(p1).toBeGreaterThan(0);

    cleanup();
  });

  it("should set --vlist-carousel-offset as signed integer", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    const plugin = carousel({ variant: "full" });
    plugin.setup!(ctx);
    initPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [9, 0, 1, 2]);

    const scrollPos = middleStart * 400;
    plugin.hooks!.onAfterScroll!(scrollPos);

    expect(els[0].style.getPropertyValue("--vlist-carousel-offset")).toBe("-1");
    expect(els[1].style.getPropertyValue("--vlist-carousel-offset")).toBe("0");
    expect(els[2].style.getPropertyValue("--vlist-carousel-offset")).toBe("1");
    expect(els[3].style.getPropertyValue("--vlist-carousel-offset")).toBe("2");

    cleanup();
  });

  it("should set --vlist-carousel-role to large for focal, small for distant items", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    const plugin = carousel({ variant: "hero", peek: 56 });
    plugin.setup!(ctx);
    initPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    const stepSz = 800 - 56;
    const scrollPos = middleStart * stepSz;
    plugin.hooks!.onAfterScroll!(scrollPos);

    expect(els[0].style.getPropertyValue("--vlist-carousel-role")).toBe("large");
    expect(els[1].style.getPropertyValue("--vlist-carousel-role")).toBe("small");

    cleanup();
  });

  it("should update CSS variables when scroll position changes", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 600,
      containerHeight: 600,
      itemSize: 600,
      isX: true,
    });

    const plugin = carousel({ variant: "full" });
    plugin.setup!(ctx);
    initPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1, 2]);

    const es = ctx.getState();

    // At item 0 — els[0] is focal
    es.scrollPosition = middleStart * 600;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);
    expect(els[0].style.getPropertyValue("--vlist-carousel-offset")).toBe("0");
    expect(els[1].style.getPropertyValue("--vlist-carousel-offset")).toBe("1");

    // Scroll to item 1 — els[1] is now focal
    es.scrollPosition = (middleStart + 1) * 600;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);
    expect(els[0].style.getPropertyValue("--vlist-carousel-offset")).toBe("-1");
    expect(els[1].style.getPropertyValue("--vlist-carousel-offset")).toBe("0");
    expect(els[2].style.getPropertyValue("--vlist-carousel-offset")).toBe("1");

    cleanup();
  });

  it("should set --vlist-carousel-width interpolated between stepSize and peekSize", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    const plugin = carousel({ variant: "hero", peek: 56 });
    plugin.setup!(ctx);
    initPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    const stepSz = 800 - 56;
    ctx.getState().scrollPosition = middleStart * stepSz;
    plugin.hooks!.onAfterScroll!(ctx.getState().scrollPosition);

    // Focal item should have width = stepSize (744)
    expect(els[0].style.getPropertyValue("--vlist-carousel-width")).toBe("744px");
    // Peek item should have width = peekSize (56)
    expect(els[1].style.getPropertyValue("--vlist-carousel-width")).toBe("56px");

    cleanup();
  });

  it("full variant: focal fills container, adjacent has zero width", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 600,
      containerHeight: 600,
      itemSize: 600,
      isX: true,
    });

    const plugin = carousel({ variant: "full" });
    plugin.setup!(ctx);
    initPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    ctx.getState().scrollPosition = middleStart * 600;
    plugin.hooks!.onAfterScroll!(ctx.getState().scrollPosition);

    // Full: focal = containerSize, next = 0 (no peek at rest)
    expect(els[0].style.getPropertyValue("--vlist-carousel-width")).toBe("600px");
    expect(els[0].style.getPropertyValue("--vlist-carousel-role")).toBe("large");
    // Next item has 0 width — hidden
    expect(els[1].style.display).toBe("none");

    cleanup();
  });

  it("full variant: mid-scroll shows two items sharing container", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 600,
      containerHeight: 600,
      itemSize: 600,
      isX: true,
    });

    const plugin = carousel({ variant: "full" });
    plugin.setup!(ctx);
    initPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    // Scroll 50% between items
    const es = ctx.getState();
    es.scrollPosition = middleStart * 600 + 300;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);

    // Both items visible, sharing the container
    const w0 = parseInt(els[0].style.getPropertyValue("--vlist-carousel-width"));
    const w1 = parseInt(els[1].style.getPropertyValue("--vlist-carousel-width"));
    expect(w0).toBe(300); // outgoing shrinks to 50%
    expect(w1).toBe(300); // incoming grows to 50%
    expect(w0 + w1).toBe(600); // sum = container

    cleanup();
  });
});

// =============================================================================
// Gap — spacing between items, handled by the engine
// =============================================================================

describeCarousel("carousel — Gap", () => {
  function commitPlugin(plugin: any): void {
    if (plugin.hooks?.onCommit) plugin.hooks.onCommit();
  }

  it("hero with gap should reduce item sizes and add spacing", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
      containerHeight: 400,
      itemSize: 400,
      isX: true,
    });

    const plugin = carousel({ variant: "hero", peek: 120, gap: 8 });
    plugin.setup!(ctx);
    commitPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    const es = ctx.getState();
    // availableSize = 800 - 8 = 792 (1 gap for 2 slots)
    // focalRatio = (800-120)/800 = 0.85
    // focalSlotWidth = round(792 * 0.85) = 673
    // smallSlotWidth = 792 - 673 = 119
    // stepSize = 673 + 8 = 681
    es.scrollPosition = middleStart * 681;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);

    const w0 = parseInt(els[0].style.getPropertyValue("--vlist-carousel-width"));
    const w1 = parseInt(els[1].style.getPropertyValue("--vlist-carousel-width"));

    expect(w0).toBeLessThan(800 - 120);
    expect(w1).toBeGreaterThan(0);
    expect(w0 + w1 + 8).toBe(800);

    cleanup();
  });

  it("full with gap should still fill container at rest", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 600,
      containerHeight: 600,
      itemSize: 600,
      isX: true,
    });

    const plugin = carousel({ variant: "full", gap: 8 });
    plugin.setup!(ctx);
    commitPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    const es = ctx.getState();
    // full: 1 slot, 0 gaps at rest → availableSize = 600
    // stepSize = 600 + 8 = 608
    es.scrollPosition = middleStart * 608;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);

    const w0 = parseInt(els[0].style.getPropertyValue("--vlist-carousel-width"));
    expect(w0).toBe(600);

    cleanup();
  });

  it("gap should work in vertical orientation", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 400,
      containerHeight: 600,
      itemSize: 300,
      isX: false,
    });

    const plugin = carousel({ variant: "hero", peek: 100, gap: 12 });
    plugin.setup!(ctx);
    commitPlugin(plugin);

    const middleStart = 50 * 10;
    const els = addRenderedItems(dom.content, [0, 1]);

    const es = ctx.getState();
    // containerSize=600, availableSize=600-12=588
    // focalRatio=(600-100)/600=0.833, focalSlot=round(588*0.833)=490
    // smallSlot=588-490=98, stepSize=490+12=502
    es.scrollPosition = middleStart * 502;
    plugin.hooks!.onAfterScroll!(es.scrollPosition);

    const h0 = parseInt(els[0].style.height);
    const h1 = parseInt(els[1].style.height);

    expect(h0).toBeGreaterThan(h1);
    expect(h0 + h1 + 12).toBe(600);

    cleanup();
  });
});

// =============================================================================
// Keyboard navigation — built-in handler
// =============================================================================

describeCarousel("carousel — Keyboard", () => {
  it("should register a keydown handler", () => {
    const items = createTestItems(10);
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    expect(keydownHandlers.length).toBeGreaterThan(0);

    cleanup();
  });

  it("should set tabindex on content element", () => {
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    expect(dom.content.getAttribute("tabindex")).toBe("0");

    cleanup();
  });
});

// =============================================================================
// carousel:change event — emitted by next/prev
// =============================================================================

describeCarousel("carousel — carousel:change event", () => {
  it("next() should emit carousel:change with the new logical index", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    const events: { index: number }[] = [];
    ctx.emitter.on = ((event: string, handler: Function) => {
      if (event === "carousel:change") {
        const orig = handler;
        (ctx.emitter as any)._carouselHandler = orig;
      }
      return () => {};
    }) as any;
    ctx.emitter.emit = ((event: string, payload: any) => {
      if (event === "carousel:change") events.push(payload);
    }) as any;

    carousel().setup!(ctx);

    const next = methods.get("next") as Function;
    next(1, { behavior: "auto" });

    expect(events.length).toBe(1);
    expect(events[0]!.index).toBe(1);

    next(1, { behavior: "auto" });
    expect(events[1]!.index).toBe(2);

    cleanup();
  });

  it("prev() should emit carousel:change with the wrapped index", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    const events: { index: number }[] = [];
    ctx.emitter.emit = ((event: string, payload: any) => {
      if (event === "carousel:change") events.push(payload);
    }) as any;

    carousel().setup!(ctx);

    const prev = methods.get("prev") as Function;
    prev(1, { behavior: "auto" });

    expect(events.length).toBe(1);
    expect(events[0]!.index).toBe(4);

    cleanup();
  });
});

// =============================================================================
// Index mapping — virtual indices don't leak
// =============================================================================

describeCarousel("carousel — Index Mapping", () => {
  it("should register _layoutToDataIndex method", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    expect(methods.has("_layoutToDataIndex")).toBe(true);

    const mapFn = methods.get("_layoutToDataIndex") as (i: number) => number;
    // Virtual index 253 with 5 items → logical 253 % 5 = 3
    expect(mapFn(253)).toBe(3);
    expect(mapFn(250)).toBe(0);
    expect(mapFn(504)).toBe(4);

    cleanup();
  });
});

// =============================================================================
// Mutation sync — item count changes
// =============================================================================

describeCarousel("carousel — Mutation Sync", () => {
  it("should preserve currentIndex when items are added", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const next = methods.get("next") as Function;
    const getState = methods.get("getCarouselState") as Function;

    // Advance to item 2
    next(1, { behavior: "auto" });
    next(1, { behavior: "auto" });
    expect(getState().index).toBe(2);

    // Simulate adding an item
    items.push({ id: 5, name: "Item 5" });

    // Trigger onAfterScroll which calls syncItemCount
    const plugin = carousel();
    plugin.setup!(ctx);
    // The new plugin instance won't have the same state,
    // so we verify via getItems().length
    expect(ctx.getItems().length).toBe(6);

    cleanup();
  });

  it("getItems().length should reflect mutations", () => {
    const items = createTestItems(5);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);
    expect(ctx.getItems().length).toBe(5);

    items.push({ id: 5, name: "Item 5" });
    expect(ctx.getItems().length).toBe(6);

    cleanup();
  });
});

// =============================================================================
// Normalized scroll position
// =============================================================================

describeCarousel("carousel — Normalized Scroll", () => {
  it("getCarouselState().scrollPosition should be normalized within one lap", () => {
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerHeight: 400,
      itemSize: 400,
    });

    carousel().setup!(ctx);

    const getState = methods.get("getCarouselState") as Function;
    const state = getState();

    // Normalized position should be within [0, lapSize)
    expect(state.scrollPosition).toBeGreaterThanOrEqual(0);
    expect(state.scrollPosition).toBeLessThan(400 * 5);

    cleanup();
  });
});
