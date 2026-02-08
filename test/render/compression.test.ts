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
    const state = getCompressionState(1000, 40);

    expect(state.isCompressed).toBe(false);
    expect(state.actualHeight).toBe(40_000);
    expect(state.virtualHeight).toBe(40_000);
    expect(state.ratio).toBe(1);
  });

  it("should compress lists exceeding MAX_VIRTUAL_HEIGHT", () => {
    // 1M items × 40px = 40M pixels > 16M limit
    const state = getCompressionState(1_000_000, 40);

    expect(state.isCompressed).toBe(true);
    expect(state.actualHeight).toBe(40_000_000);
    expect(state.virtualHeight).toBe(MAX_VIRTUAL_HEIGHT);
    expect(state.ratio).toBe(16_000_000 / 40_000_000); // 0.4
  });

  it("should handle edge case at exactly MAX_VIRTUAL_HEIGHT", () => {
    const itemHeight = 40;
    const exactItems = MAX_VIRTUAL_HEIGHT / itemHeight; // 400,000 items

    const state = getCompressionState(exactItems, itemHeight);

    expect(state.isCompressed).toBe(false);
    expect(state.ratio).toBe(1);
  });

  it("should handle zero items", () => {
    const state = getCompressionState(0, 40);

    expect(state.isCompressed).toBe(false);
    expect(state.actualHeight).toBe(0);
    expect(state.virtualHeight).toBe(0);
    expect(state.ratio).toBe(1);
  });

  it("should handle very large lists (10M items)", () => {
    const state = getCompressionState(10_000_000, 40);

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
      const compression = getCompressionState(1000, 40);
      const out = { start: 0, end: 0 };
      const range = calculateCompressedVisibleRange(
        0,
        400,
        40,
        1000,
        compression,
        out,
      );

      expect(range.start).toBe(0);
      expect(range.end).toBe(10); // ceil(400/40) = 10 items visible (0-10)
    });

    it("should calculate correct range when scrolled", () => {
      const compression = getCompressionState(1000, 40);
      const out = { start: 0, end: 0 };
      const range = calculateCompressedVisibleRange(
        400,
        400,
        40,
        1000,
        compression,
        out,
      );

      expect(range.start).toBe(10); // 400/40 = 10
      expect(range.end).toBe(20); // start + ceil(400/40)
    });
  });

  describe("with compression", () => {
    it("should map scroll position to correct item range", () => {
      // 1M items, compression ratio = 0.4
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll to middle (8M virtual = 50% of 16M)
      const scrollTop = 8_000_000;
      const range = calculateCompressedVisibleRange(
        scrollTop,
        containerHeight,
        40,
        1_000_000,
        compression,
        out,
      );

      // At 50% scroll, should be around item 500,000
      expect(range.start).toBeGreaterThan(400_000);
      expect(range.start).toBeLessThan(600_000);
    });

    it("should handle near-bottom interpolation", () => {
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll to very end
      const maxScroll = compression.virtualHeight - containerHeight;
      const range = calculateCompressedVisibleRange(
        maxScroll,
        containerHeight,
        40,
        1_000_000,
        compression,
        out,
      );

      // Should include the last item
      expect(range.end).toBe(999_999);
    });

    it("should never exceed totalItems - 1", () => {
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll past the end (shouldn't happen but test safety)
      const range = calculateCompressedVisibleRange(
        compression.virtualHeight,
        containerHeight,
        40,
        1_000_000,
        compression,
        out,
      );

      expect(range.end).toBeLessThanOrEqual(999_999);
      expect(range.start).toBeGreaterThanOrEqual(0);
    });
  });

  it("should handle empty list", () => {
    const compression = getCompressionState(0, 40);
    const out = { start: 0, end: 0 };
    const range = calculateCompressedVisibleRange(
      0,
      400,
      40,
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
      const compression = getCompressionState(100, 40);
      const position = calculateCompressedItemPosition(
        10,
        0,
        40,
        100,
        400,
        compression,
        0, // rangeStart
      );

      // Absolute position (scroll handled by container)
      expect(position).toBe(400); // index 10 × 40px
    });

    it("should use absolute positioning (scroll handled by container)", () => {
      const compression = getCompressionState(100, 40);
      const position = calculateCompressedItemPosition(
        10,
        200,
        40,
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
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;

      // At scroll position 8M (middle of 16M virtual), item 500000 should be near top
      // scrollRatio = 8M/16M = 0.5, virtualIndex = 0.5 * 1M = 500000
      // position = (500000 - 500000) * 40 = 0
      const scrollTop = 8_000_000;
      const position = calculateCompressedItemPosition(
        500_000,
        scrollTop,
        40,
        1_000_000,
        containerHeight,
        compression,
      );

      // Item 500000 at scroll 8M should be positioned near the top of viewport
      expect(position).toBeGreaterThanOrEqual(-50);
      expect(position).toBeLessThanOrEqual(50);
    });

    it("should position consecutive items with full item height spacing", () => {
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;
      const scrollTop = 4_000_000;

      const pos1 = calculateCompressedItemPosition(
        250_000,
        scrollTop,
        40,
        1_000_000,
        containerHeight,
        compression,
      );

      const pos2 = calculateCompressedItemPosition(
        250_001,
        scrollTop,
        40,
        1_000_000,
        containerHeight,
        compression,
      );

      // Consecutive items should be exactly itemHeight apart (40px)
      expect(pos2 - pos1).toBe(40);
    });

    it("should handle near-bottom positioning", () => {
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;
      const maxScroll = compression.virtualHeight - containerHeight;

      // Last item should be positioned within the viewport at max scroll
      const position = calculateCompressedItemPosition(
        999_999,
        maxScroll,
        40,
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
      const compression = getCompressionState(100, 40);
      const position = calculateCompressedScrollToIndex(
        10,
        40,
        400,
        100,
        compression,
        "start",
      );

      expect(position).toBe(400); // 10 × 40
    });

    it("should scroll to center alignment", () => {
      const compression = getCompressionState(100, 40);
      const position = calculateCompressedScrollToIndex(
        10,
        40,
        400,
        100,
        compression,
        "center",
      );

      // 400 - (400 - 40) / 2 = 400 - 180 = 220
      expect(position).toBe(220);
    });

    it("should scroll to end alignment", () => {
      const compression = getCompressionState(100, 40);
      const position = calculateCompressedScrollToIndex(
        10,
        40,
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
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;

      // Scroll to item 500,000 (50% through list)
      const position = calculateCompressedScrollToIndex(
        500_000,
        40,
        containerHeight,
        1_000_000,
        compression,
        "start",
      );

      // Should be 50% of virtual height
      expect(position).toBe(8_000_000); // 0.5 × 16M
    });

    it("should clamp to valid scroll range", () => {
      const compression = getCompressionState(1_000_000, 40);
      const containerHeight = 600;

      // Scroll to last item
      const position = calculateCompressedScrollToIndex(
        999_999,
        40,
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
      const compression = getCompressionState(1_000_000, 40);
      const position = calculateCompressedScrollToIndex(
        0,
        40,
        600,
        1_000_000,
        compression,
        "start",
      );

      expect(position).toBe(0);
    });
  });

  it("should handle empty list", () => {
    const compression = getCompressionState(0, 40);
    const position = calculateCompressedScrollToIndex(
      0,
      40,
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
      const compression = getCompressionState(100, 40);
      const index = calculateIndexFromScrollPosition(400, 40, 100, compression);

      expect(index).toBe(10); // 400 / 40
    });
  });

  describe("with compression", () => {
    it("should calculate index from compressed scroll position", () => {
      const compression = getCompressionState(1_000_000, 40);

      // At 50% scroll (8M), should be around item 500,000
      const index = calculateIndexFromScrollPosition(
        8_000_000,
        40,
        1_000_000,
        compression,
      );

      expect(index).toBe(500_000);
    });

    it("should handle scroll at start", () => {
      const compression = getCompressionState(1_000_000, 40);
      const index = calculateIndexFromScrollPosition(
        0,
        40,
        1_000_000,
        compression,
      );

      expect(index).toBe(0);
    });

    it("should handle scroll at end", () => {
      const compression = getCompressionState(1_000_000, 40);
      const index = calculateIndexFromScrollPosition(
        compression.virtualHeight,
        40,
        1_000_000,
        compression,
      );

      expect(index).toBe(1_000_000);
    });
  });

  it("should handle empty list", () => {
    const compression = getCompressionState(0, 40);
    const index = calculateIndexFromScrollPosition(0, 40, 0, compression);

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
    const info = getCompressionInfo(1000, 40);

    expect(info).toContain("No compression");
    expect(info).toContain("1000");
    expect(info).toContain("40px");
  });

  it("should describe compressed list", () => {
    const info = getCompressionInfo(1_000_000, 40);

    expect(info).toContain("Compressed");
    expect(info).toContain("1000000");
    expect(info).toContain("40px");
    expect(info).toContain("40"); // 40% or 40M
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
    const compression = getCompressionState(totalItems, itemHeight);

    // Scroll to item 500,000
    const scrollPos = calculateCompressedScrollToIndex(
      500_000,
      itemHeight,
      containerHeight,
      totalItems,
      compression,
      "start",
    );

    // Calculate which item is at that scroll position
    const calculatedIndex = calculateIndexFromScrollPosition(
      scrollPos,
      itemHeight,
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
    const compression = getCompressionState(totalItems, itemHeight);

    // Get visible range at middle scroll
    const scrollTop = 8_000_000;
    const out = { start: 0, end: 0 };
    const range = calculateCompressedVisibleRange(
      scrollTop,
      containerHeight,
      itemHeight,
      totalItems,
      compression,
      out,
    );

    // First visible item should be positioned near top of viewport
    const firstPosition = calculateCompressedItemPosition(
      range.start,
      scrollTop,
      itemHeight,
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
    const compression = getCompressionState(totalItems, itemHeight);

    // Scroll to maximum
    const maxScroll = compression.virtualHeight - containerHeight;
    const out = { start: 0, end: 0 };
    const range = calculateCompressedVisibleRange(
      maxScroll,
      containerHeight,
      itemHeight,
      totalItems,
      compression,
      out,
    );

    // Should be able to see the last item
    expect(range.end).toBe(totalItems - 1);
  });
});
