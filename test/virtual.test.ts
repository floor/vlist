/**
 * vlist - Virtual Scrolling Tests
 * Tests for pure virtual scrolling calculation functions
 */

import { describe, it, expect } from "bun:test";
import {
  calculateVisibleRange,
  calculateRenderRange,
  calculateTotalHeight,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  getScrollDirection,
  createViewportState,
  updateViewportState,
  updateViewportItems,
  rangesEqual,
  isInRange,
  getRangeCount,
  diffRanges,
} from "../src/render/virtual";

describe("calculateVisibleRange", () => {
  it("should return empty range when totalItems is 0", () => {
    const result = calculateVisibleRange(0, 500, 50, 0);
    expect(result).toEqual({ start: 0, end: 0 });
  });

  it("should return empty range when itemHeight is 0", () => {
    const result = calculateVisibleRange(0, 500, 0, 100);
    expect(result).toEqual({ start: 0, end: 0 });
  });

  it("should calculate correct range at scroll position 0", () => {
    // Container: 500px, Item: 50px = ceil(500/50) = 10 visible items
    // Range is 0 to 10 (inclusive, so 11 items to ensure full coverage)
    const result = calculateVisibleRange(0, 500, 50, 100);
    expect(result.start).toBe(0);
    expect(result.end).toBe(10);
  });

  it("should calculate correct range when scrolled", () => {
    // Scrolled 250px = 5 items down
    // Container: 500px, Item: 50px = ceil(500/50) = 10 visible items
    // Range is 5 to 15 (start + visibleCount)
    const result = calculateVisibleRange(250, 500, 50, 100);
    expect(result.start).toBe(5);
    expect(result.end).toBe(15);
  });

  it("should clamp end to totalItems - 1", () => {
    // Scrolled near end, only 5 items left
    const result = calculateVisibleRange(4750, 500, 50, 100);
    expect(result.end).toBe(99);
  });

  it("should handle partial items", () => {
    // Container: 520px, Item: 50px = ceil(520/50) = 11 visible items
    // Range is 0 to 11 (start + visibleCount)
    const result = calculateVisibleRange(0, 520, 50, 100);
    expect(result.end).toBe(11);
  });

  it("should never return negative start", () => {
    const result = calculateVisibleRange(-100, 500, 50, 100);
    expect(result.start).toBeGreaterThanOrEqual(0);
  });
});

describe("calculateRenderRange", () => {
  it("should return empty range when totalItems is 0", () => {
    const visibleRange = { start: 0, end: 0 };
    const result = calculateRenderRange(visibleRange, 3, 0);
    expect(result).toEqual({ start: 0, end: 0 });
  });

  it("should add overscan to visible range", () => {
    const visibleRange = { start: 5, end: 14 };
    const result = calculateRenderRange(visibleRange, 3, 100);
    expect(result.start).toBe(2); // 5 - 3
    expect(result.end).toBe(17); // 14 + 3
  });

  it("should clamp start to 0", () => {
    const visibleRange = { start: 1, end: 10 };
    const result = calculateRenderRange(visibleRange, 5, 100);
    expect(result.start).toBe(0);
  });

  it("should clamp end to totalItems - 1", () => {
    const visibleRange = { start: 90, end: 99 };
    const result = calculateRenderRange(visibleRange, 5, 100);
    expect(result.end).toBe(99);
  });

  it("should handle zero overscan", () => {
    const visibleRange = { start: 5, end: 14 };
    const result = calculateRenderRange(visibleRange, 0, 100);
    expect(result).toEqual(visibleRange);
  });
});

describe("calculateTotalHeight", () => {
  it("should calculate total height correctly", () => {
    expect(calculateTotalHeight(100, 50)).toBe(5000);
  });

  it("should return 0 for 0 items", () => {
    expect(calculateTotalHeight(0, 50)).toBe(0);
  });

  it("should handle large numbers", () => {
    expect(calculateTotalHeight(100000, 48)).toBe(4800000);
  });
});

describe("calculateItemOffset", () => {
  it("should calculate offset for first item", () => {
    expect(calculateItemOffset(0, 50)).toBe(0);
  });

  it("should calculate offset correctly", () => {
    expect(calculateItemOffset(10, 50)).toBe(500);
  });

  it("should handle large indices", () => {
    expect(calculateItemOffset(1000, 48)).toBe(48000);
  });
});

describe("calculateScrollToIndex", () => {
  // Note: signature is (index, itemHeight, containerHeight, totalItems, align)
  // For small lists (no compression), result = index * itemHeight adjusted for alignment

  it("should scroll to start alignment", () => {
    const result = calculateScrollToIndex(10, 50, 500, 100, "start");
    expect(result).toBe(500); // 10 * 50
  });

  it("should scroll to center alignment", () => {
    const result = calculateScrollToIndex(10, 50, 500, 100, "center");
    // itemTop = 500, center = 500 - (500 - 50) / 2 = 500 - 225 = 275
    expect(result).toBe(275);
  });

  it("should scroll to end alignment", () => {
    const result = calculateScrollToIndex(10, 50, 500, 100, "end");
    // itemTop = 500, end = 500 - (500 - 50) = 50
    expect(result).toBe(50);
  });

  it("should default to start alignment", () => {
    const result = calculateScrollToIndex(10, 50, 500, 100);
    expect(result).toBe(500);
  });

  it("should handle compressed lists (1M+ items)", () => {
    // 1 million items at 40px = 40M pixels (exceeds 16M limit)
    // compressionRatio = 16M / 40M = 0.4
    // For index 500000: ratio = 500000/1000000 = 0.5
    // targetPosition = 0.5 * 16M = 8M
    const totalItems = 1_000_000;
    const itemHeight = 40;
    const containerHeight = 600;
    const result = calculateScrollToIndex(
      500_000,
      itemHeight,
      containerHeight,
      totalItems,
      "start",
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
    const state = createViewportState(500, 50, 100, 3);

    expect(state.scrollTop).toBe(0);
    expect(state.containerHeight).toBe(500);
    expect(state.totalHeight).toBe(5000);
    expect(state.visibleRange.start).toBe(0);
    expect(state.renderRange.start).toBe(0);
  });

  it("should include overscan in render range", () => {
    const state = createViewportState(500, 50, 100, 3);

    // Visible: 0-10, Render with overscan: 0-13
    expect(state.renderRange.end).toBe(13);
  });

  it("should handle empty list", () => {
    const state = createViewportState(500, 50, 0, 3);

    expect(state.totalHeight).toBe(0);
    expect(state.visibleRange).toEqual({ start: 0, end: 0 });
  });
});

describe("updateViewportState", () => {
  it("should update state after scroll", () => {
    const initial = createViewportState(500, 50, 100, 3);
    const updated = updateViewportState(initial, 250, 50, 100, 3);

    expect(updated.scrollTop).toBe(250);
    expect(updated.visibleRange.start).toBe(5);
  });

  it("should preserve containerHeight", () => {
    const initial = createViewportState(500, 50, 100, 3);
    const updated = updateViewportState(initial, 250, 50, 100, 3);

    expect(updated.containerHeight).toBe(500);
  });
});

describe("updateViewportItems", () => {
  it("should update total height when items change", () => {
    const initial = createViewportState(500, 50, 100, 3);
    const updated = updateViewportItems(initial, 50, 200, 3);

    expect(updated.totalHeight).toBe(10000);
  });

  it("should recalculate visible range", () => {
    const initial = createViewportState(500, 50, 100, 3);
    const updated = updateViewportItems(initial, 50, 50, 3);

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
