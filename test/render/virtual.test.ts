/**
 * vlist - Virtual Scrolling Tests
 * Tests for pure virtual scrolling calculation functions
 */

import { describe, it, expect } from "bun:test";
import {
  calculateVisibleRange,
  calculateRenderRange,
  calculateTotalHeight,
  calculateActualHeight,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  getScrollDirection,
  createViewportState,
  updateViewportState,
  updateViewportSize,
  updateViewportItems,
  getCompressionState,
  rangesEqual,
  isInRange,
  getRangeCount,
  rangeToIndices,
  diffRanges,
} from "../../src/render/virtual";
import { createHeightCache } from "../../src/render/heights";

describe("calculateVisibleRange", () => {
  it("should return empty range when totalItems is 0", () => {
    const cache = createHeightCache(50, 0);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      0,
      500,
      cache,
      0,
      getCompressionState(0, cache),
      out,
    );
    expect(result).toEqual({ start: 0, end: -1 });
  });

  it("should return empty range when containerHeight is 0", () => {
    const cache = createHeightCache(50, 100);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      0,
      0,
      cache,
      100,
      getCompressionState(100, cache),
      out,
    );
    expect(result).toEqual({ start: 0, end: -1 });
  });

  it("should calculate correct range at scroll position 0", () => {
    // Container: 500px, Item: 50px = 10 visible items
    // indexAtOffset(0) = 0, indexAtOffset(500) = 10, +1 = 11 → clamped to 10
    const cache = createHeightCache(50, 100);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      0,
      500,
      cache,
      100,
      getCompressionState(100, cache),
      out,
    );
    expect(result.start).toBe(0);
    // End should include items that cover the viewport
    expect(result.end).toBeGreaterThanOrEqual(10);
    expect(result.end).toBeLessThanOrEqual(11);
  });

  it("should calculate correct range when scrolled", () => {
    // Scrolled 250px = 5 items down
    // Container: 500px, Item: 50px
    const cache = createHeightCache(50, 100);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      250,
      500,
      cache,
      100,
      getCompressionState(100, cache),
      out,
    );
    expect(result.start).toBe(5);
    expect(result.end).toBeGreaterThanOrEqual(15);
    expect(result.end).toBeLessThanOrEqual(16);
  });

  it("should clamp end to totalItems - 1", () => {
    // Scrolled near end, only 5 items left
    const cache = createHeightCache(50, 100);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      4750,
      500,
      cache,
      100,
      getCompressionState(100, cache),
      out,
    );
    expect(result.end).toBe(99);
  });

  it("should handle partial items", () => {
    // Container: 520px, Item: 50px
    const cache = createHeightCache(50, 100);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      0,
      520,
      cache,
      100,
      getCompressionState(100, cache),
      out,
    );
    expect(result.end).toBeGreaterThanOrEqual(10);
    expect(result.end).toBeLessThanOrEqual(12);
  });

  it("should never return negative start", () => {
    const cache = createHeightCache(50, 100);
    const out = { start: 0, end: 0 };
    const result = calculateVisibleRange(
      -100,
      500,
      cache,
      100,
      getCompressionState(100, cache),
      out,
    );
    expect(result.start).toBeGreaterThanOrEqual(0);
  });
});

describe("calculateRenderRange", () => {
  it("should return empty range when totalItems is 0", () => {
    const visibleRange = { start: 0, end: 0 };
    const out = { start: 0, end: 0 };
    const result = calculateRenderRange(visibleRange, 3, 0, out);
    expect(result).toEqual({ start: 0, end: -1 });
  });

  it("should add overscan to visible range", () => {
    const visibleRange = { start: 5, end: 14 };
    const out = { start: 0, end: 0 };
    const result = calculateRenderRange(visibleRange, 3, 100, out);
    expect(result.start).toBe(2); // 5 - 3
    expect(result.end).toBe(17); // 14 + 3
  });

  it("should clamp start to 0", () => {
    const visibleRange = { start: 1, end: 10 };
    const out = { start: 0, end: 0 };
    const result = calculateRenderRange(visibleRange, 5, 100, out);
    expect(result.start).toBe(0);
  });

  it("should clamp end to totalItems - 1", () => {
    const visibleRange = { start: 90, end: 99 };
    const out = { start: 0, end: 0 };
    const result = calculateRenderRange(visibleRange, 5, 100, out);
    expect(result.end).toBe(99);
  });

  it("should handle zero overscan", () => {
    const visibleRange = { start: 5, end: 14 };
    const out = { start: 0, end: 0 };
    const result = calculateRenderRange(visibleRange, 0, 100, out);
    expect(result).toEqual(visibleRange);
  });
});

describe("calculateTotalHeight", () => {
  it("should calculate total height correctly", () => {
    const cache = createHeightCache(50, 100);
    expect(calculateTotalHeight(100, cache)).toBe(5000);
  });

  it("should return 0 for 0 items", () => {
    const cache = createHeightCache(50, 0);
    expect(calculateTotalHeight(0, cache)).toBe(0);
  });

  it("should handle large numbers", () => {
    const cache = createHeightCache(48, 100000);
    expect(calculateTotalHeight(100000, cache)).toBe(4800000);
  });
});

describe("calculateItemOffset", () => {
  it("should calculate offset for first item", () => {
    const cache = createHeightCache(50, 100);
    expect(calculateItemOffset(0, cache)).toBe(0);
  });

  it("should calculate offset correctly", () => {
    const cache = createHeightCache(50, 100);
    expect(calculateItemOffset(10, cache)).toBe(500);
  });

  it("should handle large indices", () => {
    const cache = createHeightCache(48, 1001);
    expect(calculateItemOffset(1000, cache)).toBe(48000);
  });
});

describe("calculateActualHeight", () => {
  it("should return the raw total height from height cache", () => {
    const cache = createHeightCache(50, 100);
    const height = calculateActualHeight(100, cache);
    expect(height).toBe(5000); // 100 * 50
  });

  it("should return 0 for 0 items", () => {
    const cache = createHeightCache(50, 0);
    const height = calculateActualHeight(0, cache);
    expect(height).toBe(0);
  });

  it("should return actual height even for very large lists", () => {
    const cache = createHeightCache(50, 1_000_000);
    const height = calculateActualHeight(1_000_000, cache);
    // Actual height is 50M pixels — NOT capped by compression
    expect(height).toBe(50_000_000);
  });

  it("should return actual height with variable heights", () => {
    const heightFn = (index: number) => (index % 2 === 0 ? 40 : 80);
    const cache = createHeightCache(heightFn, 10);
    const height = calculateActualHeight(10, cache);
    // 5×40 + 5×80 = 600
    expect(height).toBe(600);
  });

  it("should ignore the totalItems parameter (uses cache only)", () => {
    const cache = createHeightCache(50, 100);
    // Even if we pass a different totalItems, the cache was built with 100
    const height = calculateActualHeight(50, cache);
    expect(height).toBe(5000); // Still 100 * 50 from the cache
  });
});

describe("calculateScrollToIndex", () => {
  it("should scroll to start alignment", () => {
    const cache = createHeightCache(50, 100);
    const result = calculateScrollToIndex(
      10,
      cache,
      500,
      100,
      "start",
      getCompressionState(100, cache),
    );
    expect(result).toBe(500); // 10 * 50
  });

  it("should scroll to center alignment", () => {
    const cache = createHeightCache(50, 100);
    const result = calculateScrollToIndex(
      10,
      cache,
      500,
      100,
      "center",
      getCompressionState(100, cache),
    );
    // itemTop = 500, center = 500 - (500 - 50) / 2 = 500 - 225 = 275
    expect(result).toBe(275);
  });

  it("should scroll to end alignment", () => {
    const cache = createHeightCache(50, 100);
    const result = calculateScrollToIndex(
      10,
      cache,
      500,
      100,
      "end",
      getCompressionState(100, cache),
    );
    // itemTop = 500, end = 500 - (500 - 50) = 50
    expect(result).toBe(50);
  });

  it("should default to start alignment", () => {
    const cache = createHeightCache(50, 100);
    const result = calculateScrollToIndex(
      10,
      cache,
      500,
      100,
      "start",
      getCompressionState(100, cache),
    );
    expect(result).toBe(500);
  });

  it("should handle compressed lists (1M+ items)", () => {
    const totalItems = 1_000_000;
    const itemHeight = 40;
    const containerHeight = 600;
    const cache = createHeightCache(itemHeight, totalItems);
    const result = calculateScrollToIndex(
      500_000,
      cache,
      containerHeight,
      totalItems,
      "start",
      getCompressionState(totalItems, cache),
    );

    // Should map to compressed position
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(16_000_000);
  });
});

describe("clampScrollPosition", () => {
  it("should clamp negative values to 0", () => {
    expect(clampScrollPosition(-100, 5000, 500)).toBe(0);
  });

  it("should clamp values exceeding max scroll", () => {
    // totalHeight: 5000, containerHeight: 500, maxScroll: 4500
    expect(clampScrollPosition(5000, 5000, 500)).toBe(4500);
  });

  it("should not modify values within range", () => {
    expect(clampScrollPosition(2000, 5000, 500)).toBe(2000);
  });

  it("should handle edge case where content is smaller than container", () => {
    expect(clampScrollPosition(100, 300, 500)).toBe(0);
  });
});

describe("getScrollDirection", () => {
  it("should return down when scrolling down", () => {
    expect(getScrollDirection(200, 100)).toBe("down");
  });

  it("should return up when scrolling up", () => {
    expect(getScrollDirection(100, 200)).toBe("up");
  });

  it("should return down when position unchanged", () => {
    expect(getScrollDirection(100, 100)).toBe("down");
  });
});

describe("createViewportState", () => {
  it("should create initial viewport state", () => {
    const cache = createHeightCache(50, 100);
    const state = createViewportState(
      500,
      cache,
      100,
      3,
      getCompressionState(100, cache),
    );

    expect(state.scrollTop).toBe(0);
    expect(state.containerHeight).toBe(500);
    expect(state.totalHeight).toBe(5000);
    expect(state.visibleRange.start).toBe(0);
    expect(state.renderRange.start).toBe(0);
  });

  it("should include overscan in render range", () => {
    const cache = createHeightCache(50, 100);
    const state = createViewportState(
      500,
      cache,
      100,
      3,
      getCompressionState(100, cache),
    );

    // Visible ends around 10-11, with overscan of 3 → render end around 13-14
    expect(state.renderRange.end).toBeGreaterThanOrEqual(13);
    expect(state.renderRange.end).toBeLessThanOrEqual(15);
  });

  it("should handle empty list", () => {
    const cache = createHeightCache(50, 0);
    const state = createViewportState(
      500,
      cache,
      0,
      3,
      getCompressionState(0, cache),
    );

    expect(state.totalHeight).toBe(0);
    expect(state.visibleRange).toEqual({ start: 0, end: -1 });
  });
});

describe("updateViewportState", () => {
  it("should update state after scroll", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);
    const updated = updateViewportState(
      initial,
      250,
      cache,
      100,
      3,
      compression,
    );

    expect(updated.scrollTop).toBe(250);
    expect(updated.visibleRange.start).toBe(5);
  });

  it("should preserve containerHeight", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);
    const updated = updateViewportState(
      initial,
      250,
      cache,
      100,
      3,
      compression,
    );

    expect(updated.containerHeight).toBe(500);
  });
});

describe("updateViewportSize", () => {
  it("should update container height in state", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);

    expect(initial.containerHeight).toBe(500);

    const updated = updateViewportSize(
      initial,
      800,
      cache,
      100,
      3,
      compression,
    );

    expect(updated.containerHeight).toBe(800);
  });

  it("should recalculate visible range for new container size", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(200, cache, 100, 3, compression);

    // With 200px container, fewer items visible
    const smallVisibleCount =
      initial.visibleRange.end - initial.visibleRange.start + 1;

    const updated = updateViewportSize(
      initial,
      600,
      cache,
      100,
      3,
      compression,
    );

    // With 600px container, more items visible
    const largeVisibleCount =
      updated.visibleRange.end - updated.visibleRange.start + 1;
    expect(largeVisibleCount).toBeGreaterThan(smallVisibleCount);
  });

  it("should update total height and compression fields", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);

    const updated = updateViewportSize(
      initial,
      800,
      cache,
      100,
      3,
      compression,
    );

    expect(updated.totalHeight).toBe(compression.virtualHeight);
    expect(updated.actualHeight).toBe(compression.actualHeight);
    expect(updated.isCompressed).toBe(compression.isCompressed);
    expect(updated.compressionRatio).toBe(compression.ratio);
  });

  it("should preserve scroll position when resizing", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);

    // Scroll down first
    updateViewportState(initial, 1000, cache, 100, 3, compression);
    expect(initial.scrollTop).toBe(1000);

    // Resize container
    const updated = updateViewportSize(
      initial,
      800,
      cache,
      100,
      3,
      compression,
    );

    // Scroll position should be preserved
    expect(updated.scrollTop).toBe(1000);
  });

  it("should handle resize to very small container", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);

    const updated = updateViewportSize(initial, 50, cache, 100, 3, compression);

    expect(updated.containerHeight).toBe(50);
    // Only 1 item visible in 50px with 50px item height
    const visibleCount =
      updated.visibleRange.end - updated.visibleRange.start + 1;
    expect(visibleCount).toBeGreaterThanOrEqual(1);
    expect(visibleCount).toBeLessThanOrEqual(3);
  });

  it("should handle resize with variable heights", () => {
    const heightFn = (index: number) => (index % 2 === 0 ? 40 : 80);
    const cache = createHeightCache(heightFn, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);

    const updated = updateViewportSize(
      initial,
      1000,
      cache,
      100,
      3,
      compression,
    );

    expect(updated.containerHeight).toBe(1000);
    // Total height = 50×40 + 50×80 = 6000
    expect(updated.totalHeight).toBe(6000);
  });

  it("should mutate state in place for performance", () => {
    const cache = createHeightCache(50, 100);
    const compression = getCompressionState(100, cache);
    const initial = createViewportState(500, cache, 100, 3, compression);

    const updated = updateViewportSize(
      initial,
      800,
      cache,
      100,
      3,
      compression,
    );

    // Should be the same object reference (mutation in place)
    expect(updated).toBe(initial);
  });

  it("should handle resize with empty list", () => {
    const cache = createHeightCache(50, 0);
    const compression = getCompressionState(0, cache);
    const initial = createViewportState(500, cache, 0, 3, compression);

    const updated = updateViewportSize(initial, 800, cache, 0, 3, compression);

    expect(updated.containerHeight).toBe(800);
    expect(updated.totalHeight).toBe(0);
  });
});

describe("updateViewportItems", () => {
  it("should update total height when items change", () => {
    const cache100 = createHeightCache(50, 100);
    const cache200 = createHeightCache(50, 200);
    const initial = createViewportState(
      500,
      cache100,
      100,
      3,
      getCompressionState(100, cache100),
    );
    const updated = updateViewportItems(
      initial,
      cache200,
      200,
      3,
      getCompressionState(200, cache200),
    );

    expect(updated.totalHeight).toBe(10000);
  });

  it("should recalculate visible range", () => {
    const cache100 = createHeightCache(50, 100);
    const cache50 = createHeightCache(50, 50);
    const initial = createViewportState(
      500,
      cache100,
      100,
      3,
      getCompressionState(100, cache100),
    );
    const updated = updateViewportItems(
      initial,
      cache50,
      50,
      3,
      getCompressionState(50, cache50),
    );

    // With only 50 items, end should be clamped
    expect(updated.visibleRange.end).toBeLessThanOrEqual(49);
  });
});

describe("rangesEqual", () => {
  it("should return true for equal ranges", () => {
    expect(rangesEqual({ start: 5, end: 15 }, { start: 5, end: 15 })).toBe(
      true,
    );
  });

  it("should return false for different starts", () => {
    expect(rangesEqual({ start: 5, end: 15 }, { start: 6, end: 15 })).toBe(
      false,
    );
  });

  it("should return false for different ends", () => {
    expect(rangesEqual({ start: 5, end: 15 }, { start: 5, end: 16 })).toBe(
      false,
    );
  });
});

describe("isInRange", () => {
  it("should return true for index within range", () => {
    expect(isInRange(10, { start: 5, end: 15 })).toBe(true);
  });

  it("should return true for index at start", () => {
    expect(isInRange(5, { start: 5, end: 15 })).toBe(true);
  });

  it("should return true for index at end", () => {
    expect(isInRange(15, { start: 5, end: 15 })).toBe(true);
  });

  it("should return false for index before range", () => {
    expect(isInRange(4, { start: 5, end: 15 })).toBe(false);
  });

  it("should return false for index after range", () => {
    expect(isInRange(16, { start: 5, end: 15 })).toBe(false);
  });
});

describe("getRangeCount", () => {
  it("should return correct count", () => {
    expect(getRangeCount({ start: 5, end: 15 })).toBe(11);
  });

  it("should return 1 for single item range", () => {
    expect(getRangeCount({ start: 5, end: 5 })).toBe(1);
  });

  it("should return 0 for invalid range", () => {
    expect(getRangeCount({ start: 15, end: 5 })).toBe(0);
  });
});

describe("rangeToIndices", () => {
  it("should create array of indices for a range", () => {
    const indices = rangeToIndices({ start: 3, end: 7 });
    expect(indices).toEqual([3, 4, 5, 6, 7]);
  });

  it("should return single element for same start and end", () => {
    const indices = rangeToIndices({ start: 5, end: 5 });
    expect(indices).toEqual([5]);
  });

  it("should return empty array for invalid range", () => {
    const indices = rangeToIndices({ start: 10, end: 5 });
    expect(indices).toEqual([]);
  });

  it("should handle range starting at 0", () => {
    const indices = rangeToIndices({ start: 0, end: 3 });
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("should handle large range", () => {
    const indices = rangeToIndices({ start: 0, end: 999 });
    expect(indices.length).toBe(1000);
    expect(indices[0]).toBe(0);
    expect(indices[999]).toBe(999);
  });
});

describe("diffRanges", () => {
  it("should find indices to add when scrolling down", () => {
    const oldRange = { start: 0, end: 10 };
    const newRange = { start: 5, end: 15 };
    const { add, remove } = diffRanges(oldRange, newRange);

    expect(add).toEqual([11, 12, 13, 14, 15]);
    expect(remove).toEqual([0, 1, 2, 3, 4]);
  });

  it("should find indices to add when scrolling up", () => {
    const oldRange = { start: 5, end: 15 };
    const newRange = { start: 0, end: 10 };
    const { add, remove } = diffRanges(oldRange, newRange);

    expect(add).toEqual([0, 1, 2, 3, 4]);
    expect(remove).toEqual([11, 12, 13, 14, 15]);
  });

  it("should return empty arrays for identical ranges", () => {
    const range = { start: 5, end: 15 };
    const { add, remove } = diffRanges(range, range);

    expect(add).toEqual([]);
    expect(remove).toEqual([]);
  });

  it("should handle non-overlapping ranges", () => {
    const oldRange = { start: 0, end: 5 };
    const newRange = { start: 10, end: 15 };
    const { add, remove } = diffRanges(oldRange, newRange);

    expect(add).toEqual([10, 11, 12, 13, 14, 15]);
    expect(remove).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

// =============================================================================
// Variable Height Tests
// =============================================================================

describe("Variable height support", () => {
  // Alternating heights: 40px and 80px
  const alternatingHeight = (index: number) => (index % 2 === 0 ? 40 : 80);

  describe("calculateTotalHeight with variable heights", () => {
    it("should return correct virtual height", () => {
      // 10 items: 5×40 + 5×80 = 600
      const cache = createHeightCache(alternatingHeight, 10);
      const height = calculateTotalHeight(10, cache);
      expect(height).toBe(600);
    });
  });

  describe("calculateItemOffset with variable heights", () => {
    it("should return prefix-sum based offsets", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(calculateItemOffset(0, cache)).toBe(0);
      expect(calculateItemOffset(1, cache)).toBe(40);
      expect(calculateItemOffset(2, cache)).toBe(120); // 40+80
      expect(calculateItemOffset(3, cache)).toBe(160); // 40+80+40
    });
  });

  describe("createViewportState with variable heights", () => {
    it("should create correct initial state", () => {
      const cache = createHeightCache(alternatingHeight, 100);
      const compression = getCompressionState(100, cache);
      const state = createViewportState(500, cache, 100, 3, compression);

      expect(state.scrollTop).toBe(0);
      expect(state.containerHeight).toBe(500);
      // Total height = 50×40 + 50×80 = 6000
      expect(state.totalHeight).toBe(6000);
      expect(state.visibleRange.start).toBe(0);
    });

    it("should calculate correct visible range with variable heights", () => {
      const cache = createHeightCache(alternatingHeight, 100);
      const compression = getCompressionState(100, cache);
      const state = createViewportState(500, cache, 100, 3, compression);

      // With alternating 40/80, the visible items starting from 0 should cover 500px
      // 40+80+40+80+40+80+40+80 = 480, next item (40) brings to 520
      // So roughly 8-9 items visible
      expect(state.visibleRange.start).toBe(0);
      expect(state.visibleRange.end).toBeGreaterThanOrEqual(7);
      expect(state.visibleRange.end).toBeLessThanOrEqual(10);
    });
  });

  describe("updateViewportState with variable heights", () => {
    it("should update correctly after scroll", () => {
      const cache = createHeightCache(alternatingHeight, 100);
      const compression = getCompressionState(100, cache);
      const initial = createViewportState(500, cache, 100, 3, compression);

      // Scroll to offset 120 → item 2 (offset 120 = 40+80)
      const updated = updateViewportState(
        initial,
        120,
        cache,
        100,
        3,
        compression,
      );

      expect(updated.scrollTop).toBe(120);
      expect(updated.visibleRange.start).toBe(2);
    });
  });

  describe("calculateScrollToIndex with variable heights", () => {
    it("should scroll to correct offset for variable height items", () => {
      const cache = createHeightCache(alternatingHeight, 100);
      const compression = getCompressionState(100, cache);

      // Item 3 offset = 40+80+40 = 160
      const result = calculateScrollToIndex(
        3,
        cache,
        500,
        100,
        "start",
        compression,
      );
      expect(result).toBe(160);
    });

    it("should center correctly for variable height items", () => {
      const cache = createHeightCache(alternatingHeight, 100);
      const compression = getCompressionState(100, cache);

      // Item 3 offset = 160, height = 80
      // center = 160 - (500 - 80) / 2 = 160 - 210 = -50 → clamped to 0
      const result = calculateScrollToIndex(
        3,
        cache,
        500,
        100,
        "center",
        compression,
      );
      expect(result).toBe(0);
    });

    it("should end-align correctly for variable height items", () => {
      const cache = createHeightCache(alternatingHeight, 100);
      const compression = getCompressionState(100, cache);

      // Item 20 offset = 10×40 + 10×80 = 1200, height = 40 (index 20 is even)
      // end = 1200 - (500 - 40) = 1200 - 460 = 740
      const result = calculateScrollToIndex(
        20,
        cache,
        500,
        100,
        "end",
        compression,
      );
      expect(result).toBe(740);
    });
  });
});
