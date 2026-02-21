/**
 * vlist - Size Cache Tests
 * Tests for fixed and variable size cache implementations
 */

import { describe, it, expect } from "bun:test";
import {
  createSizeCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
  type SizeCache,
} from "../../src/rendering/sizes";

// =============================================================================
// Fixed Size Cache
// =============================================================================

describe("createSizeCache (fixed)", () => {
  it("should create a fixed size cache from a number", () => {
    const cache = createSizeCache(50, 100);
    expect(cache.isVariable()).toBe(false);
  });

  it("should return correct total item count", () => {
    const cache = createSizeCache(50, 100);
    expect(cache.getTotal()).toBe(100);
  });

  describe("getOffset", () => {
    it("should return 0 for first item", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.getOffset(0)).toBe(0);
    });

    it("should calculate offset using multiplication", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.getOffset(10)).toBe(500);
    });

    it("should handle large indices", () => {
      const cache = createSizeCache(48, 1000);
      expect(cache.getOffset(999)).toBe(999 * 48);
    });
  });

  describe("getSize", () => {
    it("should return fixed size for any index", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.getSize(0)).toBe(50);
      expect(cache.getSize(50)).toBe(50);
      expect(cache.getSize(99)).toBe(50);
    });
  });

  describe("indexAtOffset", () => {
    it("should return 0 for offset 0", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.indexAtOffset(0)).toBe(0);
    });

    it("should calculate index using division", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.indexAtOffset(500)).toBe(10);
    });

    it("should floor partial items", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.indexAtOffset(525)).toBe(10);
    });

    it("should clamp to 0 for negative offsets", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.indexAtOffset(-10)).toBe(0);
    });

    it("should clamp to last index for large offsets", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.indexAtOffset(10000)).toBe(99);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(50, 0);
      expect(cache.indexAtOffset(100)).toBe(0);
    });

    it("should handle exact boundary offsets", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.indexAtOffset(50)).toBe(1);
      expect(cache.indexAtOffset(100)).toBe(2);
    });
  });

  describe("getTotalSize", () => {
    it("should return total * size", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.getTotalSize()).toBe(5000);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(50, 0);
      expect(cache.getTotalSize()).toBe(0);
    });
  });

  describe("rebuild", () => {
    it("should update total after rebuild", () => {
      const cache = createSizeCache(50, 100);
      expect(cache.getTotal()).toBe(100);
      cache.rebuild(200);
      expect(cache.getTotal()).toBe(200);
      expect(cache.getTotalSize()).toBe(10000);
    });

    it("should handle rebuild to 0", () => {
      const cache = createSizeCache(50, 100);
      cache.rebuild(0);
      expect(cache.getTotal()).toBe(0);
      expect(cache.getTotalSize()).toBe(0);
    });
  });
});

// =============================================================================
// Variable Size Cache
// =============================================================================

describe("createSizeCache (variable)", () => {
  // Alternating between 50 and 100
  const alternatingSize = (i: number) => (i % 2 === 0 ? 50 : 100);
  // Header (100) followed by items (50 each)
  const headerSize = (i: number) => (i === 0 ? 100 : 50);

  it("should create a variable size cache from a function", () => {
    const cache = createSizeCache(alternatingSize, 10);
    expect(cache.isVariable()).toBe(true);
  });

  it("should return correct total item count", () => {
    const cache = createSizeCache(alternatingSize, 10);
    expect(cache.getTotal()).toBe(10);
  });

  describe("getOffset", () => {
    it("should return 0 for first item", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.getOffset(0)).toBe(0);
    });

    it("should compute prefix sum offsets correctly", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // 0: 0
      // 1: 50 (item 0 = 50)
      // 2: 150 (item 0 = 50, item 1 = 100)
      // 3: 200 (items 0,1,2 = 50+100+50)
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(1)).toBe(50);
      expect(cache.getOffset(2)).toBe(150);
      expect(cache.getOffset(3)).toBe(200);
    });

    it("should handle header + items pattern", () => {
      const cache = createSizeCache(headerSize, 10);
      // 0: 0
      // 1: 100 (header)
      // 2: 150 (header + item)
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(1)).toBe(100);
      expect(cache.getOffset(2)).toBe(150);
    });

    it("should clamp for index <= 0", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(-5)).toBe(0);
    });

    it("should return total size for index >= total", () => {
      const cache = createSizeCache(alternatingSize, 10);
      const totalSize = cache.getTotalSize();
      expect(cache.getOffset(10)).toBe(totalSize);
      expect(cache.getOffset(100)).toBe(totalSize);
    });
  });

  describe("getSize", () => {
    it("should return correct size for each index", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.getSize(0)).toBe(50);
      expect(cache.getSize(1)).toBe(100);
      expect(cache.getSize(2)).toBe(50);
    });

    it("should delegate to the size function", () => {
      const cache = createSizeCache(headerSize, 10);
      expect(cache.getSize(0)).toBe(100);
      expect(cache.getSize(1)).toBe(50);
      expect(cache.getSize(5)).toBe(50);
    });
  });

  describe("indexAtOffset", () => {
    it("should return 0 for offset 0", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.indexAtOffset(0)).toBe(0);
    });

    it("should find correct item via binary search", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Sizes: [50, 100, 50, 100, 50, 100, 50, 100, 50, 100]
      // Offsets: [0, 50, 150, 200, 300, 350, 450, 500, 600, 650, 750]
      expect(cache.indexAtOffset(0)).toBe(0);
      expect(cache.indexAtOffset(25)).toBe(0); // inside item 0
      expect(cache.indexAtOffset(49)).toBe(0); // end of item 0
      expect(cache.indexAtOffset(50)).toBe(1); // start of item 1
      expect(cache.indexAtOffset(100)).toBe(1); // inside item 1
      expect(cache.indexAtOffset(149)).toBe(1); // end of item 1
      expect(cache.indexAtOffset(150)).toBe(2); // start of item 2
      expect(cache.indexAtOffset(175)).toBe(2); // inside item 2
      expect(cache.indexAtOffset(199)).toBe(2); // end of item 2
      expect(cache.indexAtOffset(200)).toBe(3); // start of item 3
    });

    it("should handle offset within items (not on boundary)", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Item 4 spans [300, 350)
      expect(cache.indexAtOffset(320)).toBe(4);
      // Item 5 spans [350, 450)
      expect(cache.indexAtOffset(400)).toBe(5);
      // Item 7 spans [500, 600)
      expect(cache.indexAtOffset(550)).toBe(7);
    });

    it("should return 0 for negative offsets", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.indexAtOffset(-10)).toBe(0);
    });

    it("should return last index for offsets beyond total size", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.indexAtOffset(10000)).toBe(9);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(alternatingSize, 0);
      expect(cache.indexAtOffset(100)).toBe(0);
    });

    it("should handle single item", () => {
      const cache = createSizeCache(() => 50, 1);
      expect(cache.indexAtOffset(0)).toBe(0);
      expect(cache.indexAtOffset(25)).toBe(0);
      expect(cache.indexAtOffset(49)).toBe(0);
      expect(cache.indexAtOffset(50)).toBe(0);
    });

    it("should handle exact boundary between items", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Boundary at 50 (start of item 1)
      expect(cache.indexAtOffset(50)).toBe(1);
      // Boundary at 150 (start of item 2)
      expect(cache.indexAtOffset(150)).toBe(2);
      // Boundary at 200 (start of item 3)
      expect(cache.indexAtOffset(200)).toBe(3);
    });
  });

  describe("getTotalSize", () => {
    it("should return sum of all sizes", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // 5 * 50 + 5 * 100 = 750
      expect(cache.getTotalSize()).toBe(750);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(alternatingSize, 0);
      expect(cache.getTotalSize()).toBe(0);
    });

    it("should handle header pattern", () => {
      const cache = createSizeCache(headerSize, 10);
      // 100 + 9 * 50 = 550
      expect(cache.getTotalSize()).toBe(550);
    });
  });

  describe("rebuild", () => {
    it("should rebuild prefix sums with new total", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(cache.getTotalSize()).toBe(750);
      cache.rebuild(5);
      expect(cache.getTotal()).toBe(5);
      expect(cache.getTotalSize()).toBe(350); // 3 * 50 + 2 * 100
    });

    it("should handle rebuild to 0", () => {
      const cache = createSizeCache(alternatingSize, 10);
      cache.rebuild(0);
      expect(cache.getTotal()).toBe(0);
      expect(cache.getTotalSize()).toBe(0);
    });

    it("should maintain correct offsets after rebuild", () => {
      const cache = createSizeCache(alternatingSize, 10);
      cache.rebuild(4);
      expect(cache.getOffset(0)).toBe(0);
      expect(cache.getOffset(1)).toBe(50);
      expect(cache.getOffset(2)).toBe(150);
    });

    it("should maintain correct binary search after rebuild", () => {
      const cache = createSizeCache(alternatingSize, 10);
      cache.rebuild(4);
      expect(cache.indexAtOffset(25)).toBe(0);
      expect(cache.indexAtOffset(100)).toBe(1);
    });
  });
});

// =============================================================================
// Fixed vs Variable Consistency
// =============================================================================

describe("Fixed vs Variable consistency", () => {
  const ITEM_SIZE = 48;
  const TOTAL = 100;

  const fixedCache = createSizeCache(ITEM_SIZE, TOTAL);
  const variableCache = createSizeCache(() => ITEM_SIZE, TOTAL);

  it("should have same isVariable results", () => {
    expect(fixedCache.isVariable()).toBe(false);
    expect(variableCache.isVariable()).toBe(true);
  });

  it("should produce same offsets", () => {
    for (let i = 0; i < TOTAL; i += 10) {
      expect(fixedCache.getOffset(i)).toBe(variableCache.getOffset(i));
    }
  });

  it("should produce same sizes", () => {
    for (let i = 0; i < TOTAL; i += 10) {
      expect(fixedCache.getSize(i)).toBe(variableCache.getSize(i));
    }
  });

  it("should produce same indexAtOffset results", () => {
    const totalSize = fixedCache.getTotalSize();
    for (let offset = 0; offset < totalSize; offset += 200) {
      expect(fixedCache.indexAtOffset(offset)).toBe(
        variableCache.indexAtOffset(offset),
      );
    }
  });

  it("should produce same total size", () => {
    expect(fixedCache.getTotalSize()).toBe(variableCache.getTotalSize());
  });

  it("should produce same total count", () => {
    expect(fixedCache.getTotal()).toBe(variableCache.getTotal());
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

describe("countVisibleItems", () => {
  describe("fixed sizes", () => {
    it("should calculate using ceil division", () => {
      const cache = createSizeCache(50, 1000);
      expect(countVisibleItems(cache, 0, 200, 1000)).toBe(4);
    });

    it("should ceil for partial items", () => {
      const cache = createSizeCache(50, 1000);
      expect(countVisibleItems(cache, 0, 225, 1000)).toBe(5);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(50, 0);
      expect(countVisibleItems(cache, 0, 200, 0)).toBe(0);
    });
  });

  describe("variable sizes", () => {
    const alternatingSize = (i: number): number =>
      i % 2 === 0 ? 50 : 100;

    it("should count items that fit in container", () => {
      const cache = createSizeCache(alternatingSize, 1000);
      // From index 0, sizes: [50, 100, 50, 100, ...]
      // In 200px: 50 + 100 + 50 = 200 exactly (3 items)
      // But we should get at least 1 more because we ceil
      const count = countVisibleItems(cache, 0, 200, 1000);
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(4);
    });

    it("should start counting from given index", () => {
      const cache = createSizeCache(alternatingSize, 1000);
      // From index 2 (size 50): [50, 100, 50, ...]
      const count = countVisibleItems(cache, 2, 200, 1000);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it("should not exceed total items", () => {
      const cache = createSizeCache(alternatingSize, 5);
      expect(countVisibleItems(cache, 0, 10000, 5)).toBe(5);
    });

    it("should return at least 1 for non-empty list", () => {
      const cache = createSizeCache(() => 1000, 10);
      expect(countVisibleItems(cache, 0, 10, 10)).toBe(1);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(alternatingSize, 0);
      expect(countVisibleItems(cache, 0, 200, 0)).toBe(0);
    });
  });
});

describe("countItemsFittingFromBottom", () => {
  describe("fixed sizes", () => {
    it("should calculate using floor division", () => {
      const cache = createSizeCache(50, 1000);
      expect(countItemsFittingFromBottom(cache, 200, 1000)).toBe(4);
    });

    it("should floor for partial items", () => {
      const cache = createSizeCache(50, 1000);
      expect(countItemsFittingFromBottom(cache, 225, 1000)).toBe(4);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(50, 0);
      expect(countItemsFittingFromBottom(cache, 200, 0)).toBe(0);
    });
  });

  describe("variable sizes", () => {
    const alternatingSize = (i: number): number =>
      i % 2 === 0 ? 50 : 100;

    it("should count items from the bottom that fit", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Last items: [100 (idx 9), 50 (idx 8), 100 (idx 7), 50 (idx 6)]
      // In 200px: 100 + 50 + 50 = 200 (3 items: 9, 8, 7 partial)
      expect(countItemsFittingFromBottom(cache, 200, 10)).toBe(2);
    });

    it("should handle all items fitting", () => {
      const cache = createSizeCache(alternatingSize, 3);
      expect(countItemsFittingFromBottom(cache, 10000, 3)).toBe(3);
    });

    it("should return at least 1 for non-empty list", () => {
      const cache = createSizeCache(() => 1000, 10);
      // Even if no items fit, return 1
      expect(countItemsFittingFromBottom(cache, 10, 10)).toBe(1);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(alternatingSize, 0);
      expect(countItemsFittingFromBottom(cache, 200, 0)).toBe(0);
    });
  });
});

describe("getOffsetForVirtualIndex", () => {
  describe("fixed sizes", () => {
    it("should return integer index * size for integer indices", () => {
      const cache = createSizeCache(50, 100);
      expect(getOffsetForVirtualIndex(cache, 10, 100)).toBe(500);
    });

    it("should interpolate for fractional indices", () => {
      const cache = createSizeCache(50, 100);
      // 5.5 = offset(5) + 0.5 * size(5) = 250 + 25 = 275
      expect(getOffsetForVirtualIndex(cache, 5.5, 100)).toBe(275);
    });

    it("should return 0 for index 0", () => {
      const cache = createSizeCache(50, 100);
      expect(getOffsetForVirtualIndex(cache, 0, 100)).toBe(0);
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(50, 0);
      expect(getOffsetForVirtualIndex(cache, 5, 0)).toBe(0);
    });
  });

  describe("variable sizes", () => {
    const alternatingSize = (i: number): number =>
      i % 2 === 0 ? 50 : 100;

    it("should return correct offset for integer index", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Index 2: offset = 150 (item 0 = 50, item 1 = 100)
      expect(getOffsetForVirtualIndex(cache, 2, 10)).toBe(150);
    });

    it("should interpolate for fractional indices", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Index 1.5: offset(1) + 0.5 * size(1) = 50 + 50 = 100
      expect(getOffsetForVirtualIndex(cache, 1.5, 10)).toBe(100);
    });

    it("should interpolate correctly for fractional into large item", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Index 1.75: offset(1) + 0.75 * size(1) = 50 + 75 = 125
      expect(getOffsetForVirtualIndex(cache, 1.75, 10)).toBe(125);
    });

    it("should return 0 for index 0", () => {
      const cache = createSizeCache(alternatingSize, 10);
      expect(getOffsetForVirtualIndex(cache, 0, 10)).toBe(0);
    });

    it("should clamp to valid range for large index", () => {
      const cache = createSizeCache(alternatingSize, 10);
      // Index 15 (> total) should clamp to index 9
      const result = getOffsetForVirtualIndex(cache, 15, 10);
      expect(result).toBe(cache.getOffset(9));
    });

    it("should return 0 for empty list", () => {
      const cache = createSizeCache(alternatingSize, 0);
      expect(getOffsetForVirtualIndex(cache, 5, 0)).toBe(0);
    });
  });

  describe("consistency with fixed sizes", () => {
    it("should match index * size for fixed caches", () => {
      const cache = createSizeCache(48, 100);
      for (let i = 0; i < 100; i += 10) {
        expect(getOffsetForVirtualIndex(cache, i, 100)).toBe(i * 48);
      }
    });

    it("should match for uniform variable sizes", () => {
      const fixedCache = createSizeCache(48, 100);
      const varCache = createSizeCache(() => 48, 100);
      for (let i = 0; i < 100; i += 10) {
        expect(getOffsetForVirtualIndex(fixedCache, i, 100)).toBe(
          getOffsetForVirtualIndex(varCache, i, 100),
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
    const cache = createSizeCache(50, 1);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getTotalSize()).toBe(50);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(25)).toBe(0);
    expect(cache.indexAtOffset(50)).toBe(0);
  });

  it("should handle single item list (variable)", () => {
    const cache = createSizeCache(() => 75, 1);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getTotalSize()).toBe(75);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(50)).toBe(0);
    expect(cache.indexAtOffset(75)).toBe(0);
  });

  it("should handle very large item counts (fixed)", () => {
    const cache = createSizeCache(48, 1_000_000);
    expect(cache.getOffset(999_999)).toBe(999_999 * 48);
    expect(cache.getTotalSize()).toBe(1_000_000 * 48);
  });

  it("should handle variable sizes with all same value", () => {
    const cache = createSizeCache(() => 50, 100);
    expect(cache.getTotalSize()).toBe(5000);
    expect(cache.indexAtOffset(2500)).toBe(50);
  });

  it("should handle variable sizes with extreme variation", () => {
    // Small items except one huge item
    const extremeSize = (i: number): number => (i === 5 ? 10000 : 10);
    const cache = createSizeCache(extremeSize, 10);
    expect(cache.getSize(5)).toBe(10000);
    expect(cache.getOffset(5)).toBe(50); // 5 * 10
    expect(cache.getOffset(6)).toBe(10050); // 5 * 10 + 10000
    expect(cache.getTotalSize()).toBe(10090); // 9 * 10 + 10000

    // Binary search should find the huge item
    expect(cache.indexAtOffset(50)).toBe(5);
    expect(cache.indexAtOffset(5000)).toBe(5);
    expect(cache.indexAtOffset(10049)).toBe(5);
    expect(cache.indexAtOffset(10050)).toBe(6);
  });

  it("should correctly rebuild variable cache multiple times", () => {
    let currentSize = 50;
    const sizeFn = (i: number): number => (i === 0 ? currentSize : 30);
    const cache = createSizeCache(sizeFn, 10);

    expect(cache.getTotalSize()).toBe(50 + 9 * 30); // 320

    // Rebuild with same total
    cache.rebuild(10);
    expect(cache.getTotalSize()).toBe(320);

    // Rebuild with different total
    cache.rebuild(5);
    expect(cache.getTotalSize()).toBe(50 + 4 * 30); // 170

    // Rebuild to larger
    cache.rebuild(20);
    expect(cache.getTotalSize()).toBe(50 + 19 * 30); // 620
  });
});

// =============================================================================
// Binary Search Correctness
// =============================================================================

describe("Binary search correctness", () => {
  it("should find correct index for every offset in a small list", () => {
    // Sizes: [10, 20, 30, 40, 50]
    // Offsets: [0, 10, 30, 60, 100, 150]
    const sizeFn = (i: number): number => (i + 1) * 10;
    const cache = createSizeCache(sizeFn, 5);

    // Test every pixel offset
    const expected = [
      // Item 0: [0, 10)
      [0, 0],
      [5, 0],
      [9, 0],
      // Item 1: [10, 30)
      [10, 1],
      [20, 1],
      [29, 1],
      // Item 2: [30, 60)
      [30, 2],
      [45, 2],
      [59, 2],
      // Item 3: [60, 100)
      [60, 3],
      [80, 3],
      [99, 3],
      // Item 4: [100, 150)
      [100, 4],
      [125, 4],
      [149, 4],
    ];

    for (const [offset, expectedIndex] of expected) {
      expect(cache.indexAtOffset(offset)).toBe(expectedIndex);
    }
  });

  it("should be consistent: indexAtOffset(getOffset(i)) === i", () => {
    const sizeFn = (i: number): number => 50 + (i % 3) * 25;
    const cache = createSizeCache(sizeFn, 100);

    for (let i = 0; i < 100; i++) {
      const offset = cache.getOffset(i);
      const foundIndex = cache.indexAtOffset(offset);
      expect(foundIndex).toBe(i);
    }
  });

  it("should be consistent: getOffset(indexAtOffset(y)) <= y", () => {
    const sizeFn = (i: number): number => 50 + (i % 5) * 10;
    const cache = createSizeCache(sizeFn, 50);
    const totalSize = cache.getTotalSize();

    for (let y = 0; y < totalSize; y += 10) {
      const idx = cache.indexAtOffset(y);
      const startOffset = cache.getOffset(idx);
      expect(startOffset).toBeLessThanOrEqual(y);

      // Also verify y is before the next item
      if (idx < 49) {
        const nextOffset = cache.getOffset(idx + 1);
        expect(y).toBeLessThan(nextOffset);
      }
    }
  });
});
