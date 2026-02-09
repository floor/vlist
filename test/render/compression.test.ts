/**
 * Compression Module Tests
 * Tests for handling large lists that exceed browser height limits
 */

import { describe, it, expect } from "bun:test";
import {
  MAX_VIRTUAL_HEIGHT,
  getCompressionState,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  calculateIndexFromScrollPosition,
  needsCompression,
  getMaxItemsWithoutCompression,
  getCompressionInfo,
} from "../../src/render/compression";
import { createHeightCache } from "../../src/render/heights";

// =============================================================================
// Constants Tests
// =============================================================================

describe("MAX_VIRTUAL_HEIGHT", () => {
  it("should be 16 million pixels", () => {
    expect(MAX_VIRTUAL_HEIGHT).toBe(16_000_000);
  });
});

// =============================================================================
// getCompressionState Tests
// =============================================================================

describe("getCompressionState", () => {
  it("should not compress small lists", () => {
    const cache = createHeightCache(40, 1000);
    const state = getCompressionState(1000, cache);

    expect(state.isCompressed).toBe(false);
    expect(state.actualHeight).toBe(40_000);
    expect(state.virtualHeight).toBe(40_000);
    expect(state.ratio).toBe(1);
  });

  it("should compress lists exceeding MAX_VIRTUAL_HEIGHT", () => {
    // 1M items × 40px = 40M pixels > 16M limit
    const cache = createHeightCache(40, 1_000_000);
    const state = getCompressionState(1_000_000, cache);

    expect(state.isCompressed).toBe(true);
    expect(state.actualHeight).toBe(40_000_000);
    expect(state.virtualHeight).toBe(MAX_VIRTUAL_HEIGHT);
    expect(state.ratio).toBe(16_000_000 / 40_000_000); // 0.4
  });

  it("should handle edge case at exactly MAX_VIRTUAL_HEIGHT", () => {
    const itemHeight = 40;
    const exactItems = MAX_VIRTUAL_HEIGHT / itemHeight; // 400,000 items

    const cache = createHeightCache(itemHeight, exactItems);
    const state = getCompressionState(exactItems, cache);

    expect(state.isCompressed).toBe(false);
    expect(state.ratio).toBe(1);
  });

  it("should handle zero items", () => {
    const cache = createHeightCache(40, 0);
    const state = getCompressionState(0, cache);

    expect(state.isCompressed).toBe(false);
    expect(state.actualHeight).toBe(0);
    expect(state.virtualHeight).toBe(0);
    expect(state.ratio).toBe(1);
  });

  it("should handle very large lists (10M items)", () => {
    const cache = createHeightCache(40, 10_000_000);
    const state = getCompressionState(10_000_000, cache);

    expect(state.isCompressed).toBe(true);
    expect(state.actualHeight).toBe(400_000_000);
    expect(state.virtualHeight).toBe(MAX_VIRTUAL_HEIGHT);
    expect(state.ratio).toBe(16_000_000 / 400_000_000); // 0.04
  });
});

// =============================================================================
// calculateCompressedVisibleRange Tests
// =============================================================================

describe("calculateCompressedVisibleRange", () => {
  describe("without compression", () => {
    it("should calculate correct range at scroll position 0", () => {
      const cache = createHeightCache(40, 1000);
      const compression = getCompressionState(1000, cache);
      const out = { start: 0, end: 0 };
      const range = calculateCompressedVisibleRange(
        0,
        400,
        cache,
        1000,
        compression,
        out,
      );

      expect(range.start).toBe(0);
      // indexAtOffset(0)=0, indexAtOffset(400)=10, +1=11 → clamped
      expect(range.end).toBeGreaterThanOrEqual(10);
      expect(range.end).toBeLessThanOrEqual(11);
    });

    it("should calculate correct range when scrolled", () => {
      const cache = createHeightCache(40, 1000);
      const compression = getCompressionState(1000, cache);
      const out = { start: 0, end: 0 };
      const range = calculateCompressedVisibleRange(
        400,
        400,
        cache,
        1000,
        compression,
        out,
      );

      expect(range.start).toBe(10); // 400/40 = 10
      expect(range.end).toBeGreaterThanOrEqual(20);
      expect(range.end).toBeLessThanOrEqual(21);
    });
  });

  describe("with compression", () => {
    it("should map scroll position to correct item range", () => {
      // 1M items, compression ratio = 0.4
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll to middle (8M virtual = 50% of 16M)
      const scrollTop = 8_000_000;
      const range = calculateCompressedVisibleRange(
        scrollTop,
        containerHeight,
        cache,
        1_000_000,
        compression,
        out,
      );

      // At 50% scroll, should be around item 500,000
      expect(range.start).toBeGreaterThan(400_000);
      expect(range.start).toBeLessThan(600_000);
    });

    it("should handle near-bottom interpolation", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll to very end
      const maxScroll = compression.virtualHeight - containerHeight;
      const range = calculateCompressedVisibleRange(
        maxScroll,
        containerHeight,
        cache,
        1_000_000,
        compression,
        out,
      );

      // Should include the last item
      expect(range.end).toBe(999_999);
    });

    it("should never exceed totalItems - 1", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll past the end (shouldn't happen but test safety)
      const range = calculateCompressedVisibleRange(
        compression.virtualHeight,
        containerHeight,
        cache,
        1_000_000,
        compression,
        out,
      );

      expect(range.end).toBeLessThanOrEqual(999_999);
      expect(range.start).toBeGreaterThanOrEqual(0);
    });
  });

  it("should handle empty list", () => {
    const cache = createHeightCache(40, 0);
    const compression = getCompressionState(0, cache);
    const out = { start: 0, end: 0 };
    const range = calculateCompressedVisibleRange(
      0,
      400,
      cache,
      0,
      compression,
      out,
    );

    expect(range.start).toBe(0);
    expect(range.end).toBe(0);
  });
});

// =============================================================================
// calculateCompressedRenderRange Tests
// =============================================================================

describe("calculateCompressedRenderRange", () => {
  it("should add overscan to visible range", () => {
    const visibleRange = { start: 10, end: 20 };
    const out = { start: 0, end: 0 };
    const range = calculateCompressedRenderRange(visibleRange, 3, 100, out);

    expect(range.start).toBe(7); // 10 - 3
    expect(range.end).toBe(23); // 20 + 3
  });

  it("should clamp start to 0", () => {
    const visibleRange = { start: 1, end: 10 };
    const out = { start: 0, end: 0 };
    const range = calculateCompressedRenderRange(visibleRange, 5, 100, out);

    expect(range.start).toBe(0);
  });

  it("should clamp end to totalItems - 1", () => {
    const visibleRange = { start: 90, end: 99 };
    const out = { start: 0, end: 0 };
    const range = calculateCompressedRenderRange(visibleRange, 5, 100, out);

    expect(range.end).toBe(99);
  });

  it("should handle empty list", () => {
    const visibleRange = { start: 0, end: 0 };
    const out = { start: 0, end: 0 };
    const range = calculateCompressedRenderRange(visibleRange, 3, 0, out);

    expect(range.start).toBe(0);
    expect(range.end).toBe(0);
  });
});

// =============================================================================
// calculateCompressedItemPosition Tests
// =============================================================================

describe("calculateCompressedItemPosition", () => {
  describe("without compression", () => {
    it("should calculate absolute position in content space", () => {
      const cache = createHeightCache(40, 100);
      const compression = getCompressionState(100, cache);
      const position = calculateCompressedItemPosition(
        10,
        0,
        cache,
        100,
        400,
        compression,
        0, // rangeStart
      );

      // Absolute position (scroll handled by container)
      expect(position).toBe(400); // index 10 × 40px
    });

    it("should use absolute positioning (scroll handled by container)", () => {
      const cache = createHeightCache(40, 100);
      const compression = getCompressionState(100, cache);
      const position = calculateCompressedItemPosition(
        10,
        200,
        cache,
        100,
        400,
        compression,
        10, // rangeStart
      );

      // Non-compressed mode uses absolute positioning
      expect(position).toBe(400); // 10 × 40
    });
  });

  describe("with compression", () => {
    it("should position items relative to virtual scroll index", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;

      // At scroll position 8M (middle of 16M virtual), item 500000 should be near top
      const scrollTop = 8_000_000;
      const position = calculateCompressedItemPosition(
        500_000,
        scrollTop,
        cache,
        1_000_000,
        containerHeight,
        compression,
      );

      // Item 500000 at scroll 8M should be positioned near the top of viewport
      expect(position).toBeGreaterThanOrEqual(-50);
      expect(position).toBeLessThanOrEqual(50);
    });

    it("should position consecutive items with full item height spacing", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const scrollTop = 4_000_000;

      const pos1 = calculateCompressedItemPosition(
        250_000,
        scrollTop,
        cache,
        1_000_000,
        containerHeight,
        compression,
      );

      const pos2 = calculateCompressedItemPosition(
        250_001,
        scrollTop,
        cache,
        1_000_000,
        containerHeight,
        compression,
      );

      // Consecutive items should be exactly itemHeight apart (40px)
      expect(pos2 - pos1).toBe(40);
    });

    it("should handle near-bottom positioning", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const maxScroll = compression.virtualHeight - containerHeight;

      // Last item should be positioned within the viewport at max scroll
      const position = calculateCompressedItemPosition(
        999_999,
        maxScroll,
        cache,
        1_000_000,
        containerHeight,
        compression,
      );

      // Should be visible in the viewport (near-bottom interpolation)
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(containerHeight);
    });
  });
});

// =============================================================================
// calculateCompressedScrollToIndex Tests
// =============================================================================

describe("calculateCompressedScrollToIndex", () => {
  describe("without compression", () => {
    it("should scroll to start alignment", () => {
      const cache = createHeightCache(40, 100);
      const compression = getCompressionState(100, cache);
      const position = calculateCompressedScrollToIndex(
        10,
        cache,
        400,
        100,
        compression,
        "start",
      );

      expect(position).toBe(400); // 10 × 40
    });

    it("should scroll to center alignment", () => {
      const cache = createHeightCache(40, 100);
      const compression = getCompressionState(100, cache);
      const position = calculateCompressedScrollToIndex(
        10,
        cache,
        400,
        100,
        compression,
        "center",
      );

      // 400 - (400 - 40) / 2 = 400 - 180 = 220
      expect(position).toBe(220);
    });

    it("should scroll to end alignment", () => {
      const cache = createHeightCache(40, 100);
      const compression = getCompressionState(100, cache);
      const position = calculateCompressedScrollToIndex(
        10,
        cache,
        400,
        100,
        compression,
        "end",
      );

      // 400 - (400 - 40) = 40
      expect(position).toBe(40);
    });
  });

  describe("with compression", () => {
    it("should map index to compressed scroll position", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;

      // Scroll to item 500,000 (50% through list)
      const position = calculateCompressedScrollToIndex(
        500_000,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "start",
      );

      // Should be 50% of virtual height
      expect(position).toBe(8_000_000); // 0.5 × 16M
    });

    it("should clamp to valid scroll range", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;

      // Scroll to last item
      const position = calculateCompressedScrollToIndex(
        999_999,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "start",
      );

      // Should be clamped to max scroll
      const maxScroll = compression.virtualHeight - containerHeight;
      expect(position).toBeLessThanOrEqual(maxScroll);
    });

    it("should handle first item", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const position = calculateCompressedScrollToIndex(
        0,
        cache,
        600,
        1_000_000,
        compression,
        "start",
      );

      expect(position).toBe(0);
    });
  });

  it("should handle empty list", () => {
    const cache = createHeightCache(40, 0);
    const compression = getCompressionState(0, cache);
    const position = calculateCompressedScrollToIndex(
      0,
      cache,
      400,
      0,
      compression,
      "start",
    );

    expect(position).toBe(0);
  });
});

// =============================================================================
// calculateIndexFromScrollPosition Tests
// =============================================================================

describe("calculateIndexFromScrollPosition", () => {
  describe("without compression", () => {
    it("should calculate index from scroll position", () => {
      const cache = createHeightCache(40, 100);
      const compression = getCompressionState(100, cache);
      const index = calculateIndexFromScrollPosition(
        400,
        cache,
        100,
        compression,
      );

      expect(index).toBe(10); // 400 / 40
    });
  });

  describe("with compression", () => {
    it("should calculate index from compressed scroll position", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);

      // At 50% scroll (8M), should be around item 500,000
      const index = calculateIndexFromScrollPosition(
        8_000_000,
        cache,
        1_000_000,
        compression,
      );

      expect(index).toBe(500_000);
    });

    it("should handle scroll at start", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const index = calculateIndexFromScrollPosition(
        0,
        cache,
        1_000_000,
        compression,
      );

      expect(index).toBe(0);
    });

    it("should handle scroll at end", () => {
      const cache = createHeightCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const index = calculateIndexFromScrollPosition(
        compression.virtualHeight,
        cache,
        1_000_000,
        compression,
      );

      expect(index).toBe(1_000_000);
    });
  });

  it("should handle empty list", () => {
    const cache = createHeightCache(40, 0);
    const compression = getCompressionState(0, cache);
    const index = calculateIndexFromScrollPosition(0, cache, 0, compression);

    expect(index).toBe(0);
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe("needsCompression", () => {
  it("should return false for small lists", () => {
    expect(needsCompression(100, 40)).toBe(false);
    expect(needsCompression(100_000, 40)).toBe(false);
  });

  it("should return true for large lists", () => {
    expect(needsCompression(1_000_000, 40)).toBe(true);
    expect(needsCompression(500_000, 40)).toBe(true); // 20M > 16M
  });

  it("should consider item height", () => {
    // 400,000 items × 40px = 16M (exactly at limit)
    expect(needsCompression(400_000, 40)).toBe(false);

    // 400,001 items × 40px = 16,000,040 (just over limit)
    expect(needsCompression(400_001, 40)).toBe(true);

    // Smaller items allow more
    expect(needsCompression(1_000_000, 16)).toBe(false); // 16M exactly
  });

  it("should work with HeightCache", () => {
    const smallCache = createHeightCache(40, 100);
    expect(needsCompression(100, smallCache)).toBe(false);

    const largeCache = createHeightCache(40, 1_000_000);
    expect(needsCompression(1_000_000, largeCache)).toBe(true);
  });
});

describe("getMaxItemsWithoutCompression", () => {
  it("should calculate max items for given height", () => {
    expect(getMaxItemsWithoutCompression(40)).toBe(400_000);
    expect(getMaxItemsWithoutCompression(50)).toBe(320_000);
    expect(getMaxItemsWithoutCompression(100)).toBe(160_000);
  });

  it("should handle edge cases", () => {
    expect(getMaxItemsWithoutCompression(0)).toBe(0);
    expect(getMaxItemsWithoutCompression(1)).toBe(16_000_000);
  });
});

describe("getCompressionInfo", () => {
  it("should describe non-compressed list", () => {
    const cache = createHeightCache(40, 1000);
    const info = getCompressionInfo(1000, cache);

    expect(info).toContain("No compression");
    expect(info).toContain("1000");
  });

  it("should describe compressed list", () => {
    const cache = createHeightCache(40, 1_000_000);
    const info = getCompressionInfo(1_000_000, cache);

    expect(info).toContain("Compressed");
    expect(info).toContain("1000000");
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Compression Integration", () => {
  it("should maintain scroll position consistency", () => {
    const totalItems = 1_000_000;
    const itemHeight = 40;
    const containerHeight = 600;
    const cache = createHeightCache(itemHeight, totalItems);
    const compression = getCompressionState(totalItems, cache);

    // Scroll to item 500,000
    const scrollPos = calculateCompressedScrollToIndex(
      500_000,
      cache,
      containerHeight,
      totalItems,
      compression,
      "start",
    );

    // Calculate which item is at that scroll position
    const calculatedIndex = calculateIndexFromScrollPosition(
      scrollPos,
      cache,
      totalItems,
      compression,
    );

    // Should be close to 500,000
    expect(calculatedIndex).toBe(500_000);
  });

  it("should position visible items correctly in viewport", () => {
    const totalItems = 1_000_000;
    const itemHeight = 40;
    const containerHeight = 600;
    const cache = createHeightCache(itemHeight, totalItems);
    const compression = getCompressionState(totalItems, cache);

    // Get visible range at middle scroll
    const scrollTop = 8_000_000;
    const out = { start: 0, end: 0 };
    const range = calculateCompressedVisibleRange(
      scrollTop,
      containerHeight,
      cache,
      totalItems,
      compression,
      out,
    );

    // First visible item should be positioned near top of viewport
    const firstPosition = calculateCompressedItemPosition(
      range.start,
      scrollTop,
      cache,
      totalItems,
      containerHeight,
      compression,
    );

    // Should be within viewport (with some tolerance for overscan)
    expect(firstPosition).toBeGreaterThanOrEqual(-itemHeight * 3);
    expect(firstPosition).toBeLessThan(containerHeight);
  });

  it("should reach the end of very large lists", () => {
    const totalItems = 10_000_000; // 10 million items
    const itemHeight = 40;
    const containerHeight = 600;
    const cache = createHeightCache(itemHeight, totalItems);
    const compression = getCompressionState(totalItems, cache);

    // Scroll to maximum
    const maxScroll = compression.virtualHeight - containerHeight;
    const out = { start: 0, end: 0 };
    const range = calculateCompressedVisibleRange(
      maxScroll,
      containerHeight,
      cache,
      totalItems,
      compression,
      out,
    );

    // Should be able to see the last item
    expect(range.end).toBe(totalItems - 1);
  });
});

// =============================================================================
// Variable Height Compression Tests
// =============================================================================

describe("Compression with variable heights", () => {
  const alternatingHeight = (index: number) => (index % 2 === 0 ? 40 : 80);

  it("should work with variable heights in non-compressed mode", () => {
    // 100 items: 50×40 + 50×80 = 6000px (well under 16M)
    const cache = createHeightCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);

    expect(compression.isCompressed).toBe(false);
    expect(compression.actualHeight).toBe(6000);
  });

  it("should calculate correct visible range with variable heights", () => {
    const cache = createHeightCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);
    const out = { start: 0, end: 0 };

    const range = calculateCompressedVisibleRange(
      0,
      500,
      cache,
      100,
      compression,
      out,
    );

    expect(range.start).toBe(0);
    // With alternating 40/80, about 8-9 items fit in 500px
    expect(range.end).toBeGreaterThanOrEqual(7);
    expect(range.end).toBeLessThanOrEqual(12);
  });

  it("should position variable height items correctly", () => {
    const cache = createHeightCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);

    // Item 0 at offset 0
    const pos0 = calculateCompressedItemPosition(
      0,
      0,
      cache,
      100,
      500,
      compression,
    );
    expect(pos0).toBe(0);

    // Item 1 at offset 40 (after 40px item)
    const pos1 = calculateCompressedItemPosition(
      1,
      0,
      cache,
      100,
      500,
      compression,
    );
    expect(pos1).toBe(40);

    // Item 2 at offset 120 (after 40+80)
    const pos2 = calculateCompressedItemPosition(
      2,
      0,
      cache,
      100,
      500,
      compression,
    );
    expect(pos2).toBe(120);
  });

  it("should scroll to correct offset for variable height items", () => {
    const cache = createHeightCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);

    // Item 3 starts at 40+80+40 = 160
    const position = calculateCompressedScrollToIndex(
      3,
      cache,
      500,
      100,
      compression,
      "start",
    );
    expect(position).toBe(160);
  });

  it("should use correct item height for center alignment", () => {
    const cache = createHeightCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);

    // Item 1 (height 80) at offset 40
    // center = 40 - (500 - 80) / 2 = 40 - 210 = -170 → clamped to 0
    const position = calculateCompressedScrollToIndex(
      1,
      cache,
      500,
      100,
      compression,
      "center",
    );
    expect(position).toBe(0);

    // Item 20 (height 40, offset 1200)
    // center = 1200 - (500 - 40) / 2 = 1200 - 230 = 970
    const position2 = calculateCompressedScrollToIndex(
      20,
      cache,
      500,
      100,
      compression,
      "center",
    );
    expect(position2).toBe(970);
  });

  it("should find correct index from scroll position with variable heights", () => {
    const cache = createHeightCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);

    // Offset 120 is the start of item 2
    const index = calculateIndexFromScrollPosition(
      120,
      cache,
      100,
      compression,
    );
    expect(index).toBe(2);

    // Offset 160 is the start of item 3
    const index2 = calculateIndexFromScrollPosition(
      160,
      cache,
      100,
      compression,
    );
    expect(index2).toBe(3);
  });
});
