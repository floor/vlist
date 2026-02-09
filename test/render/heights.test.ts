/**
 * vlist - Height Cache Tests
 * Tests for fixed and variable height cache implementations
 */

import { describe, it, expect } from "bun:test";
import {
  createHeightCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
  type HeightCache,
} from "../../src/render/heights";

// =============================================================================
// Fixed Height Cache
// =============================================================================

describe("createHeightCache (fixed)", () => {
  it("should create a fixed height cache from a number", () => {
    const cache = createHeightCache(50, 100);
    expect(cache.isVariable()).toBe(false);
  });

  it("should return correct total item count", () => {
    const cache = createHeightCache(50, 100);
    expect(cache.getTotal()).toBe(100);
  });

  describe("getOffset", () => {
    it("should return 0 for first item", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.getOffset(0)).toBe(0);
    });

    it("should calculate offset using multiplication", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.getOffset(10)).toBe(500);
    });

    it("should handle large indices", () => {
      const cache = createHeightCache(48, 1000);
      expect(cache.getOffset(999)).toBe(999 * 48);
    });
  });

  describe("getHeight", () => {
    it("should return fixed height for any index", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.getHeight(0)).toBe(50);
      expect(cache.getHeight(50)).toBe(50);
      expect(cache.getHeight(99)).toBe(50);
    });
  });

  describe("indexAtOffset", () => {
    it("should return 0 for offset 0", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.indexAtOffset(0)).toBe(0);
    });

    it("should calculate index using division", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.indexAtOffset(250)).toBe(5);
    });

    it("should floor partial items", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.indexAtOffset(275)).toBe(5);
    });

    it("should clamp to 0 for negative offsets", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.indexAtOffset(-100)).toBe(0);
    });

    it("should clamp to last index for large offsets", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.indexAtOffset(999999)).toBe(99);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(50, 0);
      expect(cache.indexAtOffset(100)).toBe(0);
    });

    it("should handle exact boundary offsets", () => {
      const cache = createHeightCache(50, 100);
      // Offset 500 is the start of item 10
      expect(cache.indexAtOffset(500)).toBe(10);
    });
  });

  describe("getTotalHeight", () => {
    it("should return total * height", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.getTotalHeight()).toBe(5000);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(50, 0);
      expect(cache.getTotalHeight()).toBe(0);
    });
  });

  describe("rebuild", () => {
    it("should update total after rebuild", () => {
      const cache = createHeightCache(50, 100);
      expect(cache.getTotalHeight()).toBe(5000);

      cache.rebuild(200);
      expect(cache.getTotal()).toBe(200);
      expect(cache.getTotalHeight()).toBe(10000);
    });

    it("should handle rebuild to 0", () => {
      const cache = createHeightCache(50, 100);
      cache.rebuild(0);
      expect(cache.getTotalHeight()).toBe(0);
      expect(cache.getTotal()).toBe(0);
    });
  });
});

// =============================================================================
// Variable Height Cache
// =============================================================================

describe("createHeightCache (variable)", () => {
  // Simple pattern: alternating 40px and 80px heights
  const alternatingHeight = (index: number) => (index % 2 === 0 ? 40 : 80);

  // Headers and items: first item is 64px header, rest are 48px
  const headerHeight = (index: number) => (index === 0 ? 64 : 48);

  it("should create a variable height cache from a function", () => {
    const cache = createHeightCache(alternatingHeight, 10);
    expect(cache.isVariable()).toBe(true);
  });

  it("should return correct total item count", () => {
    const cache = createHeightCache(alternatingHeight, 10);
    expect(cache.getTotal()).toBe(10);
  });

  describe("getOffset", () => {
    it("should return 0 for first item", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.getOffset(0)).toBe(0);
    });

    it("should compute prefix sum offsets correctly", () => {
      // Heights: [40, 80, 40, 80, 40, 80, 40, 80, 40, 80]
      // Offsets: [0, 40, 120, 160, 240, 280, 360, 400, 480, 520]
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(1)).toBe(40);
      expect(cache.getOffset(2)).toBe(120);
      expect(cache.getOffset(3)).toBe(160);
      expect(cache.getOffset(4)).toBe(240);
      expect(cache.getOffset(5)).toBe(280);
    });

    it("should handle header + items pattern", () => {
      // Heights: [64, 48, 48, 48, ...]
      // Offsets: [0, 64, 112, 160, ...]
      const cache = createHeightCache(headerHeight, 5);
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(1)).toBe(64);
      expect(cache.getOffset(2)).toBe(112);
      expect(cache.getOffset(3)).toBe(160);
      expect(cache.getOffset(4)).toBe(208);
    });

    it("should clamp for index <= 0", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.getOffset(-1)).toBe(0);
    });

    it("should return total height for index >= total", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.getOffset(10)).toBe(cache.getTotalHeight());
      expect(cache.getOffset(100)).toBe(cache.getTotalHeight());
    });
  });

  describe("getHeight", () => {
    it("should return correct height for each index", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.getHeight(0)).toBe(40);
      expect(cache.getHeight(1)).toBe(80);
      expect(cache.getHeight(2)).toBe(40);
      expect(cache.getHeight(3)).toBe(80);
    });

    it("should delegate to the height function", () => {
      const cache = createHeightCache(headerHeight, 5);
      expect(cache.getHeight(0)).toBe(64);
      expect(cache.getHeight(1)).toBe(48);
    });
  });

  describe("indexAtOffset", () => {
    it("should return 0 for offset 0", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.indexAtOffset(0)).toBe(0);
    });

    it("should find correct item via binary search", () => {
      // Heights: [40, 80, 40, 80, ...]
      // Offsets: [0, 40, 120, 160, 240]
      const cache = createHeightCache(alternatingHeight, 10);

      // Offset 0 → item 0 (starts at 0)
      expect(cache.indexAtOffset(0)).toBe(0);

      // Offset 20 → item 0 (within [0, 40))
      expect(cache.indexAtOffset(20)).toBe(0);

      // Offset 40 → item 1 (starts at 40)
      expect(cache.indexAtOffset(40)).toBe(1);

      // Offset 100 → item 1 (within [40, 120))
      expect(cache.indexAtOffset(100)).toBe(1);

      // Offset 120 → item 2 (starts at 120)
      expect(cache.indexAtOffset(120)).toBe(2);

      // Offset 160 → item 3 (starts at 160)
      expect(cache.indexAtOffset(160)).toBe(3);
    });

    it("should handle offset within items (not on boundary)", () => {
      const cache = createHeightCache(headerHeight, 5);
      // Offsets: [0, 64, 112, 160, 208]
      // Offset 32 → within item 0 [0, 64)
      expect(cache.indexAtOffset(32)).toBe(0);

      // Offset 80 → within item 1 [64, 112)
      expect(cache.indexAtOffset(80)).toBe(1);

      // Offset 130 → within item 2 [112, 160)
      expect(cache.indexAtOffset(130)).toBe(2);
    });

    it("should return 0 for negative offsets", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.indexAtOffset(-100)).toBe(0);
    });

    it("should return last index for offsets beyond total height", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.indexAtOffset(999999)).toBe(9);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(alternatingHeight, 0);
      expect(cache.indexAtOffset(100)).toBe(0);
    });

    it("should handle single item", () => {
      const cache = createHeightCache(alternatingHeight, 1);
      expect(cache.indexAtOffset(0)).toBe(0);
      expect(cache.indexAtOffset(20)).toBe(0);
      expect(cache.indexAtOffset(40)).toBe(0); // at boundary
      expect(cache.indexAtOffset(100)).toBe(0); // beyond
    });

    it("should handle exact boundary between items", () => {
      // Heights: [40, 80, 40, ...], boundaries at 0, 40, 120, 160
      const cache = createHeightCache(alternatingHeight, 10);

      // At boundary 40 → start of item 1
      expect(cache.indexAtOffset(40)).toBe(1);

      // At boundary 120 → start of item 2
      expect(cache.indexAtOffset(120)).toBe(2);
    });
  });

  describe("getTotalHeight", () => {
    it("should return sum of all heights", () => {
      // 10 items: 5 × 40 + 5 × 80 = 200 + 400 = 600
      const cache = createHeightCache(alternatingHeight, 10);
      expect(cache.getTotalHeight()).toBe(600);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(alternatingHeight, 0);
      expect(cache.getTotalHeight()).toBe(0);
    });

    it("should handle header pattern", () => {
      // 5 items: 64 + 4 × 48 = 64 + 192 = 256
      const cache = createHeightCache(headerHeight, 5);
      expect(cache.getTotalHeight()).toBe(256);
    });
  });

  describe("rebuild", () => {
    it("should rebuild prefix sums with new total", () => {
      const cache = createHeightCache(alternatingHeight, 5);
      // 5 items: 40+80+40+80+40 = 280
      expect(cache.getTotalHeight()).toBe(280);

      cache.rebuild(10);
      // 10 items: 5×40 + 5×80 = 600
      expect(cache.getTotal()).toBe(10);
      expect(cache.getTotalHeight()).toBe(600);
    });

    it("should handle rebuild to 0", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      cache.rebuild(0);
      expect(cache.getTotal()).toBe(0);
      expect(cache.getTotalHeight()).toBe(0);
    });

    it("should maintain correct offsets after rebuild", () => {
      const cache = createHeightCache(alternatingHeight, 5);
      cache.rebuild(10);
      // Verify offsets are still correct after rebuild
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(1)).toBe(40);
      expect(cache.getOffset(2)).toBe(120);
    });

    it("should maintain correct binary search after rebuild", () => {
      const cache = createHeightCache(alternatingHeight, 5);
      cache.rebuild(10);
      expect(cache.indexAtOffset(40)).toBe(1);
      expect(cache.indexAtOffset(120)).toBe(2);
    });
  });
});

// =============================================================================
// Consistency: Fixed vs Variable with uniform heights
// =============================================================================

describe("Fixed vs Variable consistency", () => {
  const ITEM_HEIGHT = 50;
  const TOTAL = 100;

  const fixedCache = createHeightCache(ITEM_HEIGHT, TOTAL);
  const variableCache = createHeightCache(() => ITEM_HEIGHT, TOTAL);

  it("should have same isVariable results", () => {
    expect(fixedCache.isVariable()).toBe(false);
    expect(variableCache.isVariable()).toBe(true);
  });

  it("should produce same offsets", () => {
    for (const i of [0, 1, 10, 50, 99]) {
      expect(variableCache.getOffset(i)).toBe(fixedCache.getOffset(i));
    }
  });

  it("should produce same heights", () => {
    for (const i of [0, 1, 10, 50, 99]) {
      expect(variableCache.getHeight(i)).toBe(fixedCache.getHeight(i));
    }
  });

  it("should produce same indexAtOffset results", () => {
    for (const offset of [0, 49, 50, 100, 250, 4950, 4999]) {
      expect(variableCache.indexAtOffset(offset)).toBe(
        fixedCache.indexAtOffset(offset),
      );
    }
  });

  it("should produce same total height", () => {
    expect(variableCache.getTotalHeight()).toBe(fixedCache.getTotalHeight());
  });

  it("should produce same total count", () => {
    expect(variableCache.getTotal()).toBe(fixedCache.getTotal());
  });
});

// =============================================================================
// countVisibleItems
// =============================================================================

describe("countVisibleItems", () => {
  describe("fixed heights", () => {
    it("should calculate using ceil division", () => {
      const cache = createHeightCache(50, 100);
      // 500 / 50 = 10, ceil = 10
      expect(countVisibleItems(cache, 0, 500, 100)).toBe(10);
    });

    it("should ceil for partial items", () => {
      const cache = createHeightCache(50, 100);
      // 520 / 50 = 10.4, ceil = 11
      expect(countVisibleItems(cache, 0, 520, 100)).toBe(11);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(50, 0);
      expect(countVisibleItems(cache, 0, 500, 0)).toBe(0);
    });
  });

  describe("variable heights", () => {
    const alternatingHeight = (index: number) =>
      index % 2 === 0 ? 40 : 80;

    it("should count items that fit in container", () => {
      const cache = createHeightCache(alternatingHeight, 20);
      // From index 0: heights = [40, 80, 40, 80, ...]
      // 40+80 = 120, +40 = 160, +80 = 240, +40 = 280
      // Container 250px: 40+80+40+80 = 240 (4 items), next 40 would be 280 > 250
      // But the loop includes items while accumulated < containerHeight
      // 40 < 250, 120 < 250, 160 < 250, 240 < 250, 280 >= 250 → 5 items accumulated
      // Actually: accumulated starts at 0
      // iter 0: accumulated = 40, 40 < 250, count = 1
      // iter 1: accumulated = 120, 120 < 250, count = 2
      // iter 2: accumulated = 160, 160 < 250, count = 3
      // iter 3: accumulated = 240, 240 < 250, count = 4
      // iter 4: accumulated = 280, 280 >= 250 → loop ends? No, the check is < containerHeight
      //   accumulated (240) < 250, so we enter: accumulated = 280, count = 5
      //   then accumulated (280) >= 250, loop exits
      expect(countVisibleItems(cache, 0, 250, 20)).toBe(5);
    });

    it("should start counting from given index", () => {
      const cache = createHeightCache(alternatingHeight, 20);
      // From index 1: heights = [80, 40, 80, 40, ...]
      // 80 < 250, 120 < 250, 200 < 250, 240 < 250, 320 >= 250
      // Count: 5 items (80+40+80+40+80=320, but loop exits when accumulated >= 250)
      // iter 0: accumulated = 80, count = 1
      // iter 1: accumulated = 120, count = 2
      // iter 2: accumulated = 200, count = 3
      // iter 3: accumulated = 240, count = 4
      // iter 4: accumulated = 320, count = 5
      expect(countVisibleItems(cache, 1, 250, 20)).toBe(5);
    });

    it("should not exceed total items", () => {
      const cache = createHeightCache(alternatingHeight, 3);
      // Only 3 items total, container is huge
      expect(countVisibleItems(cache, 0, 10000, 3)).toBe(3);
    });

    it("should return at least 1 for non-empty list", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // Even with tiny container, return at least 1
      expect(countVisibleItems(cache, 0, 1, 10)).toBeGreaterThanOrEqual(1);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(alternatingHeight, 0);
      expect(countVisibleItems(cache, 0, 500, 0)).toBe(0);
    });
  });
});

// =============================================================================
// countItemsFittingFromBottom
// =============================================================================

describe("countItemsFittingFromBottom", () => {
  describe("fixed heights", () => {
    it("should calculate using floor division", () => {
      const cache = createHeightCache(50, 100);
      // 500 / 50 = 10
      expect(countItemsFittingFromBottom(cache, 500, 100)).toBe(10);
    });

    it("should floor for partial items", () => {
      const cache = createHeightCache(50, 100);
      // 520 / 50 = 10.4, floor = 10
      expect(countItemsFittingFromBottom(cache, 520, 100)).toBe(10);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(50, 0);
      expect(countItemsFittingFromBottom(cache, 500, 0)).toBe(0);
    });
  });

  describe("variable heights", () => {
    const alternatingHeight = (index: number) =>
      index % 2 === 0 ? 40 : 80;

    it("should count items from the bottom that fit", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // Items from end: index 9 (80), 8 (40), 7 (80), 6 (40), 5 (80), ...
      // Container 250: 80+40=120, +80=200, +40=240, +80=320 > 250
      // So 4 items fit (indices 9,8,7,6 = heights 80+40+80+40=240)
      expect(countItemsFittingFromBottom(cache, 250, 10)).toBe(4);
    });

    it("should handle all items fitting", () => {
      const cache = createHeightCache(alternatingHeight, 3);
      // 3 items: 40+80+40 = 160, container 500
      expect(countItemsFittingFromBottom(cache, 500, 3)).toBe(3);
    });

    it("should return at least 1 for non-empty list", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // Tiny container, but at least 1
      expect(countItemsFittingFromBottom(cache, 1, 10)).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(alternatingHeight, 0);
      expect(countItemsFittingFromBottom(cache, 500, 0)).toBe(0);
    });
  });
});

// =============================================================================
// getOffsetForVirtualIndex
// =============================================================================

describe("getOffsetForVirtualIndex", () => {
  describe("fixed heights", () => {
    it("should return integer index * height for integer indices", () => {
      const cache = createHeightCache(50, 100);
      expect(getOffsetForVirtualIndex(cache, 10, 100)).toBe(500);
    });

    it("should interpolate for fractional indices", () => {
      const cache = createHeightCache(50, 100);
      // 5.5 → offset(5) + 0.5 * height(5) = 250 + 25 = 275
      expect(getOffsetForVirtualIndex(cache, 5.5, 100)).toBe(275);
    });

    it("should return 0 for index 0", () => {
      const cache = createHeightCache(50, 100);
      expect(getOffsetForVirtualIndex(cache, 0, 100)).toBe(0);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(50, 0);
      expect(getOffsetForVirtualIndex(cache, 5, 0)).toBe(0);
    });
  });

  describe("variable heights", () => {
    const alternatingHeight = (index: number) =>
      index % 2 === 0 ? 40 : 80;

    it("should return correct offset for integer index", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // offset(3) = 40+80+40 = 160
      expect(getOffsetForVirtualIndex(cache, 3, 10)).toBe(160);
    });

    it("should interpolate for fractional indices", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // 2.5 → offset(2) + 0.5 * height(2) = 120 + 0.5 * 40 = 140
      expect(getOffsetForVirtualIndex(cache, 2.5, 10)).toBe(140);
    });

    it("should interpolate correctly for fractional into large item", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // 1.5 → offset(1) + 0.5 * height(1) = 40 + 0.5 * 80 = 80
      expect(getOffsetForVirtualIndex(cache, 1.5, 10)).toBe(80);
    });

    it("should return 0 for index 0", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      expect(getOffsetForVirtualIndex(cache, 0, 10)).toBe(0);
    });

    it("should clamp to valid range for large index", () => {
      const cache = createHeightCache(alternatingHeight, 10);
      // Index beyond total → clamps to last item
      const result = getOffsetForVirtualIndex(cache, 15, 10);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it("should return 0 for empty list", () => {
      const cache = createHeightCache(alternatingHeight, 0);
      expect(getOffsetForVirtualIndex(cache, 5, 0)).toBe(0);
    });
  });

  describe("consistency with fixed heights", () => {
    it("should match index * height for fixed caches", () => {
      const cache = createHeightCache(50, 100);

      // For fixed heights: virtualIndex * height
      expect(getOffsetForVirtualIndex(cache, 0, 100)).toBe(0);
      expect(getOffsetForVirtualIndex(cache, 10, 100)).toBe(500);
      expect(getOffsetForVirtualIndex(cache, 10.5, 100)).toBe(525);
      expect(getOffsetForVirtualIndex(cache, 99, 100)).toBe(4950);
    });

    it("should match for uniform variable heights", () => {
      const fixedCache = createHeightCache(50, 100);
      const varCache = createHeightCache(() => 50, 100);

      for (const idx of [0, 5, 10.5, 50, 99.9]) {
        expect(getOffsetForVirtualIndex(varCache, idx, 100)).toBeCloseTo(
          getOffsetForVirtualIndex(fixedCache, idx, 100),
          10,
        );
      }
    });
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
  it("should handle single item list (fixed)", () => {
    const cache = createHeightCache(50, 1);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getHeight(0)).toBe(50);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(25)).toBe(0);
    expect(cache.indexAtOffset(50)).toBe(0); // clamped
    expect(cache.getTotalHeight()).toBe(50);
  });

  it("should handle single item list (variable)", () => {
    const cache = createHeightCache(() => 100, 1);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getHeight(0)).toBe(100);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(50)).toBe(0);
    expect(cache.indexAtOffset(100)).toBe(0); // at/past end → last item
    expect(cache.getTotalHeight()).toBe(100);
  });

  it("should handle very large item counts (fixed)", () => {
    const cache = createHeightCache(48, 1_000_000);
    expect(cache.getTotalHeight()).toBe(48_000_000);
    expect(cache.getOffset(500_000)).toBe(24_000_000);
    expect(cache.indexAtOffset(24_000_000)).toBe(500_000);
  });

  it("should handle variable heights with all same value", () => {
    const cache = createHeightCache(() => 48, 1000);
    expect(cache.getTotalHeight()).toBe(48_000);
    expect(cache.getOffset(500)).toBe(24_000);
    expect(cache.indexAtOffset(24_000)).toBe(500);
  });

  it("should handle variable heights with extreme variation", () => {
    // Some items are 1px, some are 1000px
    const extremeHeight = (i: number) => (i % 10 === 0 ? 1000 : 1);
    const cache = createHeightCache(extremeHeight, 100);

    // 10 large items (1000px each) + 90 small items (1px each) = 10000 + 90 = 10090
    expect(cache.getTotalHeight()).toBe(10090);

    // Item 0 starts at 0, height 1000
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.indexAtOffset(500)).toBe(0); // within first large item

    // Item 1 starts at 1000
    expect(cache.getOffset(1)).toBe(1000);
    expect(cache.indexAtOffset(1000)).toBe(1);

    // Item 10 (second large item) starts at 1000 + 9*1 = 1009
    expect(cache.getOffset(10)).toBe(1009);
  });

  it("should correctly rebuild variable cache multiple times", () => {
    let currentSize = 5;
    const heightFn = (i: number) => (i < currentSize ? (i + 1) * 10 : 10);
    const cache = createHeightCache(heightFn, currentSize);

    // Heights: [10, 20, 30, 40, 50] → total = 150
    expect(cache.getTotalHeight()).toBe(150);

    currentSize = 3;
    cache.rebuild(3);
    // Heights: [10, 20, 30] → total = 60
    expect(cache.getTotalHeight()).toBe(60);
    expect(cache.getTotal()).toBe(3);

    currentSize = 7;
    cache.rebuild(7);
    // Heights: [10, 20, 30, 40, 50, 60, 70] → total = 280
    expect(cache.getTotalHeight()).toBe(280);
    expect(cache.getTotal()).toBe(7);
  });
});

// =============================================================================
// Binary Search Stress Tests
// =============================================================================

describe("Binary search correctness", () => {
  it("should find correct index for every offset in a small list", () => {
    // Heights: [10, 20, 30, 40, 50]
    // Offsets: [0, 10, 30, 60, 100, 150]
    const heightFn = (i: number) => (i + 1) * 10;
    const cache = createHeightCache(heightFn, 5);

    // Item 0: [0, 10)
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(5)).toBe(0);
    expect(cache.indexAtOffset(9)).toBe(0);

    // Item 1: [10, 30)
    expect(cache.indexAtOffset(10)).toBe(1);
    expect(cache.indexAtOffset(20)).toBe(1);
    expect(cache.indexAtOffset(29)).toBe(1);

    // Item 2: [30, 60)
    expect(cache.indexAtOffset(30)).toBe(2);
    expect(cache.indexAtOffset(45)).toBe(2);
    expect(cache.indexAtOffset(59)).toBe(2);

    // Item 3: [60, 100)
    expect(cache.indexAtOffset(60)).toBe(3);
    expect(cache.indexAtOffset(80)).toBe(3);
    expect(cache.indexAtOffset(99)).toBe(3);

    // Item 4: [100, 150)
    expect(cache.indexAtOffset(100)).toBe(4);
    expect(cache.indexAtOffset(125)).toBe(4);
    expect(cache.indexAtOffset(149)).toBe(4);

    // Beyond end
    expect(cache.indexAtOffset(150)).toBe(4);
    expect(cache.indexAtOffset(200)).toBe(4);
  });

  it("should be consistent: indexAtOffset(getOffset(i)) === i", () => {
    const heightFn = (i: number) => 20 + (i % 7) * 10; // varying heights
    const cache = createHeightCache(heightFn, 200);

    for (let i = 0; i < 200; i++) {
      const offset = cache.getOffset(i);
      const foundIndex = cache.indexAtOffset(offset);
      expect(foundIndex).toBe(i);
    }
  });

  it("should be consistent: getOffset(indexAtOffset(y)) <= y", () => {
    const heightFn = (i: number) => 30 + (i % 5) * 15;
    const cache = createHeightCache(heightFn, 100);
    const totalHeight = cache.getTotalHeight();

    for (let y = 0; y < totalHeight; y += 7) {
      const idx = cache.indexAtOffset(y);
      const startOffset = cache.getOffset(idx);
      expect(startOffset).toBeLessThanOrEqual(y);
      // Also, the next item should start after y (or idx is the last item)
      if (idx < 99) {
        const nextOffset = cache.getOffset(idx + 1);
        expect(nextOffset).toBeGreaterThan(y);
      }
    }
  });
});
