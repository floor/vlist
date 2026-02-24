/**
 * vlist - Measured Size Cache Tests
 * Tests for auto-measurement size cache (Mode B)
 */

import { describe, it, expect } from "bun:test";
import {
  createMeasuredSizeCache,
  type MeasuredSizeCache,
} from "../../src/rendering/measured";

// =============================================================================
// Factory & Defaults
// =============================================================================

describe("createMeasuredSizeCache", () => {
  it("should create a measured size cache", () => {
    const cache = createMeasuredSizeCache(50, 100);
    expect(cache).toBeDefined();
    expect(cache.isVariable()).toBe(true);
  });

  it("should return correct total item count", () => {
    const cache = createMeasuredSizeCache(50, 100);
    expect(cache.getTotal()).toBe(100);
  });

  it("should return estimated size as the default", () => {
    const cache = createMeasuredSizeCache(50, 100);
    expect(cache.getEstimatedSize()).toBe(50);
  });

  it("should start with zero measured items", () => {
    const cache = createMeasuredSizeCache(50, 100);
    expect(cache.measuredCount()).toBe(0);
  });

  it("should report all items as unmeasured initially", () => {
    const cache = createMeasuredSizeCache(50, 10);
    for (let i = 0; i < 10; i++) {
      expect(cache.isMeasured(i)).toBe(false);
    }
  });
});

// =============================================================================
// getSize — Estimated vs Measured
// =============================================================================

describe("getSize", () => {
  it("should return estimated size for unmeasured items", () => {
    const cache = createMeasuredSizeCache(48, 100);
    expect(cache.getSize(0)).toBe(48);
    expect(cache.getSize(50)).toBe(48);
    expect(cache.getSize(99)).toBe(48);
  });

  it("should return measured size after setMeasuredSize", () => {
    const cache = createMeasuredSizeCache(48, 100);
    cache.setMeasuredSize(5, 72);
    expect(cache.getSize(5)).toBe(72);
  });

  it("should not affect other items when one is measured", () => {
    const cache = createMeasuredSizeCache(48, 100);
    cache.setMeasuredSize(5, 72);
    expect(cache.getSize(4)).toBe(48);
    expect(cache.getSize(6)).toBe(48);
  });

  it("should allow overwriting a measured size", () => {
    const cache = createMeasuredSizeCache(48, 100);
    cache.setMeasuredSize(3, 60);
    expect(cache.getSize(3)).toBe(60);
    cache.setMeasuredSize(3, 80);
    expect(cache.getSize(3)).toBe(80);
  });
});

// =============================================================================
// setMeasuredSize & isMeasured
// =============================================================================

describe("setMeasuredSize / isMeasured", () => {
  it("should track measurement state correctly", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.isMeasured(3)).toBe(false);
    cache.setMeasuredSize(3, 70);
    expect(cache.isMeasured(3)).toBe(true);
  });

  it("should increment measuredCount for each unique index", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(0, 40);
    expect(cache.measuredCount()).toBe(1);
    cache.setMeasuredSize(5, 60);
    expect(cache.measuredCount()).toBe(2);
    cache.setMeasuredSize(9, 55);
    expect(cache.measuredCount()).toBe(3);
  });

  it("should not increment measuredCount when overwriting same index", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(2, 40);
    expect(cache.measuredCount()).toBe(1);
    cache.setMeasuredSize(2, 60);
    expect(cache.measuredCount()).toBe(1);
  });

  it("should handle measuring index 0", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(0, 100);
    expect(cache.isMeasured(0)).toBe(true);
    expect(cache.getSize(0)).toBe(100);
  });

  it("should handle measuring the last item", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(4, 30);
    expect(cache.isMeasured(4)).toBe(true);
    expect(cache.getSize(4)).toBe(30);
  });
});

// =============================================================================
// getOffset — Prefix Sums with Mixed Sizes
// =============================================================================

describe("getOffset", () => {
  it("should return 0 for first item", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.getOffset(0)).toBe(0);
  });

  it("should use estimated sizes when nothing is measured", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.getOffset(5)).toBe(250); // 5 * 50
  });

  it("should incorporate measured sizes after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(2, 100); // item 2 is 100 instead of 50
    cache.rebuild(10);
    // offsets: [0]=0, [1]=50, [2]=100, [3]=200, [4]=250, [5]=300
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getOffset(1)).toBe(50);
    expect(cache.getOffset(2)).toBe(100);
    expect(cache.getOffset(3)).toBe(200); // 50 + 50 + 100
    expect(cache.getOffset(4)).toBe(250);
    expect(cache.getOffset(5)).toBe(300);
  });

  it("should handle multiple measured items after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(0, 30);
    cache.setMeasuredSize(2, 80);
    cache.setMeasuredSize(4, 20);
    cache.rebuild(5);
    // sizes: [30, 50, 80, 50, 20]
    // offsets: [0, 30, 80, 160, 210]
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getOffset(1)).toBe(30);
    expect(cache.getOffset(2)).toBe(80);
    expect(cache.getOffset(3)).toBe(160);
    expect(cache.getOffset(4)).toBe(210);
  });

  it("should clamp for index <= 0", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getOffset(-1)).toBe(0);
  });

  it("should return total size for index >= total", () => {
    const cache = createMeasuredSizeCache(50, 10);
    const totalSize = cache.getTotalSize();
    expect(cache.getOffset(10)).toBe(totalSize);
    expect(cache.getOffset(100)).toBe(totalSize);
  });
});

// =============================================================================
// getTotalSize
// =============================================================================

describe("getTotalSize", () => {
  it("should return estimated total when nothing is measured", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.getTotalSize()).toBe(500); // 10 * 50
  });

  it("should reflect measured sizes after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(0, 100); // +50 diff
    cache.rebuild(10);
    expect(cache.getTotalSize()).toBe(550); // 9*50 + 100
  });

  it("should handle all items measured after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 3);
    cache.setMeasuredSize(0, 30);
    cache.setMeasuredSize(1, 40);
    cache.setMeasuredSize(2, 60);
    cache.rebuild(3);
    expect(cache.getTotalSize()).toBe(130); // 30 + 40 + 60
  });

  it("should return 0 for empty list", () => {
    const cache = createMeasuredSizeCache(50, 0);
    expect(cache.getTotalSize()).toBe(0);
  });
});

// =============================================================================
// indexAtOffset — Binary Search with Mixed Sizes
// =============================================================================

describe("indexAtOffset", () => {
  it("should return 0 for offset 0", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.indexAtOffset(0)).toBe(0);
  });

  it("should find correct item with estimated sizes", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.indexAtOffset(125)).toBe(2); // offset 125 is within item 2 (100-150)
  });

  it("should find correct item with mixed measured/estimated sizes after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(0, 30);
    cache.setMeasuredSize(2, 80);
    cache.rebuild(5);
    // sizes: [30, 50, 80, 50, 50]
    // offsets: [0, 30, 80, 160, 210]
    expect(cache.indexAtOffset(0)).toBe(0);   // within item 0 (0–30)
    expect(cache.indexAtOffset(29)).toBe(0);  // last pixel of item 0
    expect(cache.indexAtOffset(30)).toBe(1);  // start of item 1 (30–80)
    expect(cache.indexAtOffset(80)).toBe(2);  // start of item 2 (80–160)
    expect(cache.indexAtOffset(159)).toBe(2); // last pixel of item 2
    expect(cache.indexAtOffset(160)).toBe(3); // start of item 3 (160–210)
  });

  it("should return 0 for negative offsets", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.indexAtOffset(-100)).toBe(0);
  });

  it("should return last index for offsets beyond total size", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.indexAtOffset(9999)).toBe(9);
  });

  it("should return 0 for empty list", () => {
    const cache = createMeasuredSizeCache(50, 0);
    expect(cache.indexAtOffset(100)).toBe(0);
  });

  it("should handle single item list", () => {
    const cache = createMeasuredSizeCache(50, 1);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(25)).toBe(0);
    expect(cache.indexAtOffset(100)).toBe(0);
  });
});

// =============================================================================
// rebuild — Preserves Measured, Discards Out-of-Range
// =============================================================================

describe("rebuild", () => {
  it("should preserve measured sizes for existing indices", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(3, 75);
    cache.rebuild(10);
    expect(cache.isMeasured(3)).toBe(true);
    expect(cache.getSize(3)).toBe(75);
  });

  it("should discard measured sizes for removed indices (shrink)", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(3, 75);
    cache.setMeasuredSize(8, 60);
    cache.rebuild(5); // shrink to 5 items — index 8 removed
    expect(cache.isMeasured(3)).toBe(true);
    expect(cache.isMeasured(8)).toBe(false);
    expect(cache.measuredCount()).toBe(1);
  });

  it("should update total after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.rebuild(20);
    expect(cache.getTotal()).toBe(20);
    expect(cache.getTotalSize()).toBe(1000); // 20 * 50
  });

  it("should handle rebuild to 0", () => {
    const cache = createMeasuredSizeCache(50, 10);
    cache.setMeasuredSize(5, 75);
    cache.rebuild(0);
    expect(cache.getTotal()).toBe(0);
    expect(cache.getTotalSize()).toBe(0);
    expect(cache.measuredCount()).toBe(0);
  });

  it("should handle rebuild with growth (new items use estimated)", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(2, 100);
    cache.rebuild(10);
    expect(cache.getTotal()).toBe(10);
    expect(cache.isMeasured(2)).toBe(true);
    expect(cache.getSize(2)).toBe(100);
    expect(cache.getSize(7)).toBe(50); // new items use estimated
  });

  it("should update prefix sums correctly after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(1, 100);
    cache.rebuild(5);
    // sizes: [50, 100, 50, 50, 50]
    // total = 300
    expect(cache.getTotalSize()).toBe(300);
    expect(cache.getOffset(2)).toBe(150); // 50 + 100
  });

  it("should maintain correct binary search after rebuild", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(1, 100);
    cache.rebuild(5);
    // offsets: [0, 50, 150, 200, 250], total=300
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(50)).toBe(1);
    expect(cache.indexAtOffset(149)).toBe(1);
    expect(cache.indexAtOffset(150)).toBe(2);
    expect(cache.indexAtOffset(200)).toBe(3);
  });
});

// =============================================================================
// Consistency: indexAtOffset(getOffset(i)) === i
// =============================================================================

describe("consistency", () => {
  it("should be consistent: indexAtOffset(getOffset(i)) === i (estimated only)", () => {
    const cache = createMeasuredSizeCache(48, 100);
    for (let i = 0; i < 100; i++) {
      const offset = cache.getOffset(i);
      const foundIndex = cache.indexAtOffset(offset);
      expect(foundIndex).toBe(i);
    }
  });

  it("should be consistent: indexAtOffset(getOffset(i)) === i (with measurements)", () => {
    const cache = createMeasuredSizeCache(50, 20);
    // Measure some items with varying sizes
    cache.setMeasuredSize(0, 30);
    cache.setMeasuredSize(3, 100);
    cache.setMeasuredSize(7, 20);
    cache.setMeasuredSize(15, 80);
    cache.rebuild(20);

    for (let i = 0; i < 20; i++) {
      const offset = cache.getOffset(i);
      const foundIndex = cache.indexAtOffset(offset);
      expect(foundIndex).toBe(i);
    }
  });

  it("should be consistent: getOffset(indexAtOffset(y)) <= y", () => {
    const cache = createMeasuredSizeCache(50, 20);
    cache.setMeasuredSize(2, 80);
    cache.setMeasuredSize(5, 30);
    cache.setMeasuredSize(10, 120);
    cache.rebuild(20);

    const totalSize = cache.getTotalSize();
    for (let y = 0; y < totalSize; y += 7) {
      const idx = cache.indexAtOffset(y);
      const startOffset = cache.getOffset(idx);
      expect(startOffset).toBeLessThanOrEqual(y);

      // The next item's offset should be > y (item contains the point)
      if (idx < 19) {
        const nextOffset = cache.getOffset(idx + 1);
        expect(nextOffset).toBeGreaterThan(y);
      }
    }
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  it("should handle single item list — unmeasured", () => {
    const cache = createMeasuredSizeCache(50, 1);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getSize(0)).toBe(50);
    expect(cache.getTotalSize()).toBe(50);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(25)).toBe(0);
  });

  it("should handle single item list — measured", () => {
    const cache = createMeasuredSizeCache(50, 1);
    cache.setMeasuredSize(0, 100);
    cache.rebuild(1);
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getSize(0)).toBe(100);
    expect(cache.getTotalSize()).toBe(100);
    expect(cache.indexAtOffset(0)).toBe(0);
    expect(cache.indexAtOffset(50)).toBe(0);
  });

  it("should handle empty list", () => {
    const cache = createMeasuredSizeCache(50, 0);
    expect(cache.getTotal()).toBe(0);
    expect(cache.getTotalSize()).toBe(0);
    expect(cache.measuredCount()).toBe(0);
  });

  it("should handle measuring all items", () => {
    const cache = createMeasuredSizeCache(50, 5);
    const sizes = [30, 60, 40, 80, 20];
    for (let i = 0; i < 5; i++) {
      cache.setMeasuredSize(i, sizes[i]!);
    }
    cache.rebuild(5);

    expect(cache.measuredCount()).toBe(5);
    expect(cache.getTotalSize()).toBe(230); // 30+60+40+80+20
    expect(cache.getOffset(0)).toBe(0);
    expect(cache.getOffset(1)).toBe(30);
    expect(cache.getOffset(2)).toBe(90);
    expect(cache.getOffset(3)).toBe(130);
    expect(cache.getOffset(4)).toBe(210);
  });

  it("should handle very large estimated size", () => {
    const cache = createMeasuredSizeCache(10000, 5);
    expect(cache.getTotalSize()).toBe(50000);
    cache.setMeasuredSize(2, 500);
    cache.rebuild(5);
    expect(cache.getTotalSize()).toBe(40500); // 4*10000 + 500
  });

  it("should handle very small estimated size", () => {
    const cache = createMeasuredSizeCache(1, 100);
    expect(cache.getTotalSize()).toBe(100);
    cache.setMeasuredSize(50, 200);
    cache.rebuild(100);
    expect(cache.getTotalSize()).toBe(299); // 99*1 + 200
  });

  it("should handle measured size of 0", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(2, 0);
    cache.rebuild(5);
    // sizes: [50, 50, 0, 50, 50]
    expect(cache.getSize(2)).toBe(0);
    expect(cache.getTotalSize()).toBe(200);
    expect(cache.getOffset(2)).toBe(100);
    expect(cache.getOffset(3)).toBe(100); // same as item 2 since it has 0 height
  });

  it("should handle measured size matching estimated size", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(2, 50); // same as estimated
    cache.rebuild(5);
    expect(cache.isMeasured(2)).toBe(true);
    expect(cache.getTotalSize()).toBe(250); // unchanged
  });

  it("should handle large item count with sparse measurements", () => {
    const cache = createMeasuredSizeCache(48, 10000);
    expect(cache.getTotalSize()).toBe(480000);

    // Measure only a few items
    cache.setMeasuredSize(0, 100);
    cache.setMeasuredSize(5000, 200);
    cache.setMeasuredSize(9999, 10);
    cache.rebuild(10000);

    expect(cache.measuredCount()).toBe(3);
    // Total = 9997*48 + 100 + 200 + 10 = 479856 + 310 = 480166
    // Actually: (10000-3)*48 + 100 + 200 + 10 = 9997*48 + 310
    expect(cache.getTotalSize()).toBe(9997 * 48 + 310);
  });

  it("should handle multiple rebuilds correctly", () => {
    const cache = createMeasuredSizeCache(50, 5);
    cache.setMeasuredSize(2, 100);
    cache.rebuild(5);
    expect(cache.getTotalSize()).toBe(300); // 4*50 + 100

    cache.setMeasuredSize(4, 75);
    cache.rebuild(5);
    expect(cache.getTotalSize()).toBe(325); // 3*50 + 100 + 75

    cache.rebuild(3); // shrink — removes index 4
    expect(cache.getTotalSize()).toBe(200); // 2*50 + 100
    expect(cache.measuredCount()).toBe(1); // only index 2 remains
  });

  it("should handle rebuild after measuring then growing", () => {
    const cache = createMeasuredSizeCache(50, 3);
    cache.setMeasuredSize(0, 80);
    cache.setMeasuredSize(1, 60);
    cache.setMeasuredSize(2, 40);
    cache.rebuild(3);
    expect(cache.getTotalSize()).toBe(180); // 80+60+40

    // Grow to 6 items
    cache.rebuild(6);
    expect(cache.getTotalSize()).toBe(330); // 80+60+40 + 3*50
    expect(cache.measuredCount()).toBe(3); // old measurements preserved
    expect(cache.isMeasured(3)).toBe(false);
    expect(cache.getSize(3)).toBe(50); // estimated
  });
});

// =============================================================================
// isVariable
// =============================================================================

describe("isVariable", () => {
  it("should always return true", () => {
    const cache = createMeasuredSizeCache(50, 10);
    expect(cache.isVariable()).toBe(true);
  });

  it("should return true even when all items are measured", () => {
    const cache = createMeasuredSizeCache(50, 3);
    cache.setMeasuredSize(0, 50);
    cache.setMeasuredSize(1, 50);
    cache.setMeasuredSize(2, 50);
    cache.rebuild(3);
    expect(cache.isVariable()).toBe(true);
  });
});

// =============================================================================
// getEstimatedSize
// =============================================================================

describe("getEstimatedSize", () => {
  it("should return the initial estimated size", () => {
    const cache = createMeasuredSizeCache(48, 100);
    expect(cache.getEstimatedSize()).toBe(48);
  });

  it("should not change after measurements", () => {
    const cache = createMeasuredSizeCache(48, 100);
    cache.setMeasuredSize(0, 100);
    cache.rebuild(100);
    expect(cache.getEstimatedSize()).toBe(48);
  });

  it("should not change after rebuilds", () => {
    const cache = createMeasuredSizeCache(48, 100);
    cache.rebuild(50);
    expect(cache.getEstimatedSize()).toBe(48);
    cache.rebuild(200);
    expect(cache.getEstimatedSize()).toBe(48);
  });
});