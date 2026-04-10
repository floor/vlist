/**
 * Compression Module Tests
 * Tests for handling large lists that exceed browser height limits
 */

import { describe, it, expect } from "bun:test";
import {
  MAX_VIRTUAL_SIZE,
  getCompressionState,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  calculateIndexFromScrollPosition,
  needsCompression,
  getMaxItemsWithoutCompression,
  getCompressionInfo,
} from "../../src/rendering/scale";
import { createSizeCache } from "../../src/rendering/sizes";

// =============================================================================
// Constants Tests
// =============================================================================

describe("MAX_VIRTUAL_SIZE", () => {
  it("should be 16 million pixels", () => {
    expect(MAX_VIRTUAL_SIZE).toBe(16_000_000);
  });
});

// =============================================================================
// getCompressionState Tests
// =============================================================================

describe("getCompressionState", () => {
  it("should not compress small lists", () => {
    const cache = createSizeCache(40, 1000);
    const state = getCompressionState(1000, cache);

    expect(state.isCompressed).toBe(false);
    expect(state.actualSize).toBe(40_000);
    expect(state.virtualSize).toBe(40_000);
    expect(state.ratio).toBe(1);
  });

  it("should compress lists exceeding MAX_VIRTUAL_SIZE", () => {
    // 1M items × 40px = 40M pixels > 16M limit
    const cache = createSizeCache(40, 1_000_000);
    const state = getCompressionState(1_000_000, cache);

    expect(state.isCompressed).toBe(true);
    expect(state.actualSize).toBe(40_000_000);
    expect(state.virtualSize).toBe(MAX_VIRTUAL_SIZE);
    expect(state.ratio).toBe(16_000_000 / 40_000_000); // 0.4
  });

  it("should handle edge case at exactly MAX_VIRTUAL_SIZE", () => {
    const itemHeight = 40;
    const exactItems = MAX_VIRTUAL_SIZE / itemHeight; // 400,000 items

    const cache = createSizeCache(itemHeight, exactItems);
    const state = getCompressionState(exactItems, cache);

    expect(state.isCompressed).toBe(false);
    expect(state.ratio).toBe(1);
  });

  it("should handle zero items", () => {
    const cache = createSizeCache(40, 0);
    const state = getCompressionState(0, cache);

    expect(state.isCompressed).toBe(false);
    expect(state.actualSize).toBe(0);
    expect(state.virtualSize).toBe(0);
    expect(state.ratio).toBe(1);
  });

  it("should handle very large lists (10M items)", () => {
    const cache = createSizeCache(40, 10_000_000);
    const state = getCompressionState(10_000_000, cache);

    expect(state.isCompressed).toBe(true);
    expect(state.actualSize).toBe(400_000_000);
    expect(state.virtualSize).toBe(MAX_VIRTUAL_SIZE);
    expect(state.ratio).toBe(16_000_000 / 400_000_000); // 0.04
  });

  it("should force compressed mode on a small list when force is true", () => {
    const cache = createSizeCache(40, 100);
    const state = getCompressionState(100, cache, true);

    expect(state.isCompressed).toBe(true);
    // virtualSize equals actualSize since total is under the limit
    expect(state.actualSize).toBe(4_000);
    expect(state.virtualSize).toBe(4_000);
    expect(state.ratio).toBe(1);
  });

  it("should keep ratio 1 when forced on a list under the limit", () => {
    // 10K items × 40px = 400K pixels — well under 16M
    const cache = createSizeCache(40, 10_000);
    const state = getCompressionState(10_000, cache, true);

    expect(state.isCompressed).toBe(true);
    expect(state.virtualSize).toBe(400_000);
    expect(state.ratio).toBe(1);
  });

  it("should still cap virtualSize at MAX_VIRTUAL_SIZE when forced on a large list", () => {
    // 1M items × 40px = 40M — exceeds limit regardless of force
    const cache = createSizeCache(40, 1_000_000);
    const state = getCompressionState(1_000_000, cache, true);

    expect(state.isCompressed).toBe(true);
    expect(state.virtualSize).toBe(MAX_VIRTUAL_SIZE);
    expect(state.ratio).toBe(16_000_000 / 40_000_000);
  });

  it("should not force when force is false or undefined", () => {
    const cache = createSizeCache(40, 100);

    const stateDefault = getCompressionState(100, cache);
    expect(stateDefault.isCompressed).toBe(false);

    const stateExplicit = getCompressionState(100, cache, false);
    expect(stateExplicit.isCompressed).toBe(false);
  });
});

// =============================================================================
// calculateCompressedVisibleRange Tests
// =============================================================================

describe("calculateCompressedVisibleRange", () => {
  describe("without compression", () => {
    it("should calculate correct range at scroll position 0", () => {
      const cache = createSizeCache(40, 1000);
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
      const cache = createSizeCache(40, 1000);
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
      const cache = createSizeCache(40, 1_000_000);
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

    it("should reach last item with slack-adjusted maxScroll", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // With compression slack the effective maxScroll is higher than
      // virtualSize - containerHeight, allowing the linear formula
      // to reach the last items.
      const slack = Math.max(0, containerHeight * (1 - compression.ratio));
      const maxScroll = compression.virtualSize + slack - containerHeight;
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
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const out = { start: 0, end: 0 };

      // Scroll past the end (shouldn't happen but test safety)
      const range = calculateCompressedVisibleRange(
        compression.virtualSize,
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
    const cache = createSizeCache(40, 0);
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
    expect(range.end).toBe(-1);
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
    expect(range.end).toBe(-1);
  });
});

// =============================================================================
// calculateCompressedItemPosition Tests
// =============================================================================

describe("calculateCompressedItemPosition", () => {
  describe("without compression", () => {
    it("should calculate absolute position in content space", () => {
      const cache = createSizeCache(40, 100);
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
      const cache = createSizeCache(40, 100);
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
      const cache = createSizeCache(40, 1_000_000);
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
      const cache = createSizeCache(40, 1_000_000);
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
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      // With compression slack the effective maxScroll is higher
      const slack = Math.max(0, containerHeight * (1 - compression.ratio));
      const maxScroll = compression.virtualSize + slack - containerHeight;

      // Last item should be positioned within the viewport at padded max scroll
      const position = calculateCompressedItemPosition(
        999_999,
        maxScroll,
        cache,
        1_000_000,
        containerHeight,
        compression,
      );

      // Should be visible in the viewport
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(containerHeight);
    });

    it("should interpolate positions in the near-bottom zone (not at max scroll)", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const maxScroll = compression.virtualSize - containerHeight;

      // Scroll to near-bottom but NOT at max (halfway through the interpolation zone)
      // distanceFromBottom = maxScroll - scrollPosition
      // Interpolation zone is when distanceFromBottom <= containerHeight
      const scrollPosition = maxScroll - containerHeight / 2; // distanceFromBottom = 300

      const position = calculateCompressedItemPosition(
        999_990,
        scrollPosition,
        cache,
        1_000_000,
        containerHeight,
        compression,
      );

      // Should return a number (interpolated position)
      expect(typeof position).toBe("number");
      expect(Number.isFinite(position)).toBe(true);
    });
  });
});

// =============================================================================
// calculateCompressedScrollToIndex Tests
// =============================================================================

describe("calculateCompressedScrollToIndex", () => {
  describe("without compression", () => {
    it("should scroll to start alignment", () => {
      const cache = createSizeCache(40, 100);
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
      const cache = createSizeCache(40, 100);
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
      const cache = createSizeCache(40, 100);
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
      const cache = createSizeCache(40, 1_000_000);
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
      const cache = createSizeCache(40, 1_000_000);
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

      // With compression slack the linear formula can exceed the old
      // virtualSize - containerHeight limit, but must stay non-negative
      expect(position).toBeGreaterThanOrEqual(0);
    });

    it("should handle first item", () => {
      const cache = createSizeCache(40, 1_000_000);
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

    it("should scroll to max for last item with end alignment", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;

      const position = calculateCompressedScrollToIndex(
        999_999,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "end",
      );

      // With the linear formula (no special case), the last item with
      // "end" alignment should produce a position that, when rendered
      // with compression slack, places the last item at the viewport bottom.
      // The position should be positive and within the padded scroll range.
      const slack = Math.max(0, containerHeight * (1 - compression.ratio));
      const paddedMaxScroll = compression.virtualSize + slack - containerHeight;
      expect(position).toBeGreaterThan(0);
      expect(position).toBeLessThanOrEqual(paddedMaxScroll);
    });

    it("should handle center alignment with compression", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;

      const position = calculateCompressedScrollToIndex(
        500_000,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "center",
      );

      // 500000/1000000 * 16M = 8M, offset scaled by ratio: (600-40)/2 * 0.4 = 112
      expect(position).toBe(8_000_000 - 112);
    });

    it("should handle end alignment (non-last item) with compression", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;

      const position = calculateCompressedScrollToIndex(
        500_000,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "end",
      );

      // 500000/1000000 * 16M = 8M, offset scaled by ratio: (600-40) * 0.4 = 224
      expect(position).toBe(8_000_000 - 224);
    });

    it("center alignment should place target item in the middle of the visible range", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const targetIndex = 500_000;

      const scrollPos = calculateCompressedScrollToIndex(
        targetIndex,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "center",
      );

      // Round-trip: the scroll position should produce a visible range
      // that contains the target index near its center
      const range = { start: 0, end: 0 };
      calculateCompressedVisibleRange(
        scrollPos,
        containerHeight,
        cache,
        1_000_000,
        compression,
        range,
      );

      const visibleCount = range.end - range.start + 1;
      const positionInRange = targetIndex - range.start;

      // Target should be within the visible range
      expect(targetIndex).toBeGreaterThanOrEqual(range.start);
      expect(targetIndex).toBeLessThanOrEqual(range.end);

      // Target should be near the center (within 2 items of midpoint)
      const midpoint = visibleCount / 2;
      expect(Math.abs(positionInRange - midpoint)).toBeLessThan(2);
    });

    it("end alignment should place target item at the bottom of the visible range", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const targetIndex = 500_000;

      const scrollPos = calculateCompressedScrollToIndex(
        targetIndex,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "end",
      );

      const range = { start: 0, end: 0 };
      calculateCompressedVisibleRange(
        scrollPos,
        containerHeight,
        cache,
        1_000_000,
        compression,
        range,
      );

      // Target should be within the visible range
      expect(targetIndex).toBeGreaterThanOrEqual(range.start);
      expect(targetIndex).toBeLessThanOrEqual(range.end);

      // Target should be near the end (within 2 items of the last visible)
      expect(range.end - targetIndex).toBeLessThan(2);
    });

    it("start alignment should place target item at the top of the visible range", () => {
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 600;
      const targetIndex = 500_000;

      const scrollPos = calculateCompressedScrollToIndex(
        targetIndex,
        cache,
        containerHeight,
        1_000_000,
        compression,
        "start",
      );

      const range = { start: 0, end: 0 };
      calculateCompressedVisibleRange(
        scrollPos,
        containerHeight,
        cache,
        1_000_000,
        compression,
        range,
      );

      // Target should be at or very near the start
      expect(targetIndex).toBeGreaterThanOrEqual(range.start);
      expect(targetIndex - range.start).toBeLessThan(2);
    });

    it("round-trip should work at various indices", () => {
      const cache = createSizeCache(68, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const containerHeight = 700;
      const range = { start: 0, end: 0 };

      for (const targetIndex of [1_000, 250_000, 500_000, 750_000, 999_000]) {
        const scrollPos = calculateCompressedScrollToIndex(
          targetIndex,
          cache,
          containerHeight,
          1_000_000,
          compression,
          "center",
        );

        calculateCompressedVisibleRange(
          scrollPos,
          containerHeight,
          cache,
          1_000_000,
          compression,
          range,
        );

        // Target must be visible
        expect(targetIndex).toBeGreaterThanOrEqual(range.start);
        expect(targetIndex).toBeLessThanOrEqual(range.end);

        // And roughly centered
        const visibleCount = range.end - range.start + 1;
        const positionInRange = targetIndex - range.start;
        expect(Math.abs(positionInRange - visibleCount / 2)).toBeLessThan(2);
      }
    });
  });

  it("should handle empty list", () => {
    const cache = createSizeCache(40, 0);
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
      const cache = createSizeCache(40, 100);
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
      const cache = createSizeCache(40, 1_000_000);
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
      const cache = createSizeCache(40, 1_000_000);
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
      const cache = createSizeCache(40, 1_000_000);
      const compression = getCompressionState(1_000_000, cache);
      const index = calculateIndexFromScrollPosition(
        compression.virtualSize,
        cache,
        1_000_000,
        compression,
      );

      expect(index).toBe(1_000_000);
    });
  });

  it("should handle empty list", () => {
    const cache = createSizeCache(40, 0);
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

  it("should work with SizeCache", () => {
    const smallCache = createSizeCache(40, 100);
    expect(needsCompression(100, smallCache)).toBe(false);

    const largeCache = createSizeCache(40, 1_000_000);
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
    const cache = createSizeCache(40, 1000);
    const info = getCompressionInfo(1000, cache);

    expect(info).toContain("No compression");
    expect(info).toContain("1000");
  });

  it("should describe compressed list", () => {
    const cache = createSizeCache(40, 1_000_000);
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
    const cache = createSizeCache(itemHeight, totalItems);
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
    const cache = createSizeCache(itemHeight, totalItems);
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
    const cache = createSizeCache(itemHeight, totalItems);
    const compression = getCompressionState(totalItems, cache);

    // With compression slack the effective maxScroll reaches the last items
    const slack = Math.max(0, containerHeight * (1 - compression.ratio));
    const maxScroll = compression.virtualSize + slack - containerHeight;
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
    const cache = createSizeCache(alternatingHeight, 100);
    const compression = getCompressionState(100, cache);

    expect(compression.isCompressed).toBe(false);
    expect(compression.actualSize).toBe(6000);
  });

  it("should calculate correct visible range with variable heights", () => {
    const cache = createSizeCache(alternatingHeight, 100);
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
    const cache = createSizeCache(alternatingHeight, 100);
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
    const cache = createSizeCache(alternatingHeight, 100);
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
    const cache = createSizeCache(alternatingHeight, 100);
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
    const cache = createSizeCache(alternatingHeight, 100);
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
