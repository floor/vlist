/**
 * vlist — Compressed-mode scrollToFocus tests
 *
 * Covers the bottom-padding approach that replaced the near-bottom
 * interpolation hack, and validates the scrollToFocus boundary logic
 * in compressed mode.
 */

import { describe, it, expect } from "bun:test";
import { scrollToFocus } from "../../src/rendering/scroll";
import { createSizeCache } from "../../src/rendering/sizes";
import {
  getCompressionState,
  calculateCompressedVisibleRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
} from "../../src/rendering/scale";
import type { Range } from "../../src/types";

// =============================================================================
// Helpers
// =============================================================================

/** Compute the bottom padding that the scale feature adds to the content div. */
const bottomPadding = (containerSize: number, ratio: number): number =>
  Math.max(0, containerSize * (1 - ratio));

/** Effective maxScroll with bottom padding. */
const paddedMaxScroll = (
  virtualSize: number,
  containerSize: number,
  ratio: number,
): number =>
  virtualSize + bottomPadding(containerSize, ratio) - containerSize;

/** Compute visible range at a given scroll position. */
const visibleRangeAt = (
  scrollPos: number,
  containerSize: number,
  sizeCache: ReturnType<typeof createSizeCache>,
  totalItems: number,
  compression: ReturnType<typeof getCompressionState>,
): Range => {
  const out: Range = { start: 0, end: 0 };
  calculateCompressedVisibleRange(
    scrollPos,
    containerSize,
    sizeCache,
    totalItems,
    compression,
    out,
  );
  return out;
};

// =============================================================================
// Test constants — mirrors the "Velocity Loading" example
// =============================================================================

const TOTAL = 1_000_000;
const ITEM_HEIGHT = 72;
const CONTAINER = 598;

const cache = createSizeCache(ITEM_HEIGHT, TOTAL);
const comp = getCompressionState(TOTAL, cache);
const cis = comp.virtualSize / TOTAL; // compressedItemSize
const maxScroll = paddedMaxScroll(comp.virtualSize, CONTAINER, comp.ratio);
const fullyVisible = Math.floor(CONTAINER / ITEM_HEIGHT); // 8

// =============================================================================
// Bottom padding
// =============================================================================

describe("compressedBottomPadding", () => {
  it("should be containerSize * (1 - ratio)", () => {
    const pad = bottomPadding(CONTAINER, comp.ratio);
    expect(pad).toBeCloseTo(CONTAINER * (1 - comp.ratio), 2);
    expect(pad).toBeGreaterThan(0);
    expect(pad).toBeLessThan(CONTAINER);
  });

  it("should make last item reachable at maxScroll", () => {
    // At padded maxScroll the linear start index should be >= totalItems - fullyVisible - 1
    const startIndex = Math.floor((maxScroll / comp.virtualSize) * TOTAL);
    expect(startIndex).toBeGreaterThanOrEqual(TOTAL - fullyVisible - 1);
  });

  it("should place last item's bottom at viewport bottom at maxScroll", () => {
    // Position of item (TOTAL-1) at maxScroll
    const pos = calculateCompressedItemPosition(
      TOTAL - 1,
      maxScroll,
      cache,
      TOTAL,
      CONTAINER,
      comp,
    );
    // Its bottom edge should be at or near containerSize
    const bottom = pos + ITEM_HEIGHT;
    expect(bottom).toBeCloseTo(CONTAINER, 1);
  });
});

// =============================================================================
// calculateCompressedVisibleRange (without interpolation)
// =============================================================================

describe("calculateCompressedVisibleRange (no interpolation)", () => {
  it("should start at 0 when scrollPos = 0", () => {
    const range = visibleRangeAt(0, CONTAINER, cache, TOTAL, comp);
    expect(range.start).toBe(0);
  });

  it("should show last items at padded maxScroll", () => {
    const range = visibleRangeAt(maxScroll, CONTAINER, cache, TOTAL, comp);
    expect(range.end).toBe(TOTAL - 1);
    // start should be near the end
    expect(range.start).toBeGreaterThan(TOTAL - fullyVisible - 3);
  });

  it("should always return start <= end for any valid scroll position", () => {
    const positions = [0, 100, maxScroll / 2, maxScroll - 1, maxScroll];
    for (const pos of positions) {
      const range = visibleRangeAt(pos, CONTAINER, cache, TOTAL, comp);
      expect(range.start).toBeLessThanOrEqual(range.end);
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThan(TOTAL);
    }
  });

  it("should be purely linear (no discontinuities near bottom)", () => {
    // Sample scroll positions across the bottom region
    const steps = 20;
    const rangeStart = maxScroll - CONTAINER;
    const step = CONTAINER / steps;
    let prevStart = -1;

    for (let i = 0; i <= steps; i++) {
      const pos = rangeStart + i * step;
      const range = visibleRangeAt(pos, CONTAINER, cache, TOTAL, comp);
      // start should be monotonically non-decreasing
      expect(range.start).toBeGreaterThanOrEqual(prevStart);
      prevStart = range.start;
    }
  });
});

// =============================================================================
// scrollToFocus — compressed mode
// =============================================================================

describe("scrollToFocus — compressed mode", () => {
  describe("item already visible → no scroll", () => {
    it("should not scroll when arrow-down moves to next item from top", () => {
      // Focus moves from 0 to 1; item 1 is fully visible at scrollPos=0
      const vr: Range = { start: 0, end: 9 };
      const result = scrollToFocus(1, cache, 0, CONTAINER, 0, 0, comp, TOTAL, vr);
      expect(result).toBe(0); // no change
    });

    it("should not scroll when item is in the middle of the viewport", () => {
      const vr: Range = { start: 0, end: 9 };
      const result = scrollToFocus(4, cache, 0, CONTAINER, 0, 0, comp, TOTAL, vr);
      expect(result).toBe(0);
    });

    it("should not scroll when item equals visibleRange.start + 1", () => {
      // Regression: the old <= check with visibleRange.end - fullyVisible
      // would falsely scroll here
      const vr: Range = { start: 0, end: 9 };
      const result = scrollToFocus(1, cache, 0, CONTAINER, 0, 0, comp, TOTAL, vr);
      expect(result).toBe(0);
    });
  });

  describe("item below viewport → align to bottom edge", () => {
    it("should scroll when item is just past the fully-visible area", () => {
      const vr: Range = { start: 0, end: 9 };
      // fullyVisible = 8, so index 8 is at the boundary
      const result = scrollToFocus(8, cache, 0, CONTAINER, 0, 0, comp, TOTAL, vr);
      expect(result).toBeGreaterThan(0);
    });

    it("should use fractional alignment for precise bottom edge", () => {
      // PageDown: focus moves from 0 to 8
      const vr: Range = { start: 0, end: 9 };
      const result = scrollToFocus(8, cache, 0, CONTAINER, 0, 0, comp, TOTAL, vr);

      // The exact formula: wantStart = index + 1 - effectiveSize/itemSize
      // = 8 + 1 - 598/72 = 0.6944...
      const exactVisible = CONTAINER / ITEM_HEIGHT;
      const expectedStart = 8 + 1 - exactVisible;
      const expected = expectedStart * cis;

      expect(result).toBeCloseTo(expected, 4);
    });

    it("should position the focused item's bottom flush with viewport bottom", () => {
      const vr: Range = { start: 0, end: 9 };
      const newScroll = scrollToFocus(8, cache, 0, CONTAINER, 0, 0, comp, TOTAL, vr);

      // At the new scroll position, verify item 8's bottom is near containerSize
      const pos = calculateCompressedItemPosition(
        8,
        newScroll,
        cache,
        TOTAL,
        CONTAINER,
        comp,
      );
      const bottom = pos + ITEM_HEIGHT;
      expect(bottom).toBeCloseTo(CONTAINER, 0);
    });
  });

  describe("item above viewport → align to top edge", () => {
    it("should scroll when item is above visibleRange.start", () => {
      // Simulate: scrolled to index 100, item 99 is above viewport
      const scrollPos = 100 * cis;
      const vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      const result = scrollToFocus(
        vr.start - 1,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );
      expect(result).toBeLessThan(scrollPos);
    });

    it("should scroll when item equals visibleRange.start (partially clipped)", () => {
      // visibleRange.start might be partially clipped; focus on it should scroll
      const scrollPos = 100.5 * cis; // fractional → start item partially clipped
      const vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      const result = scrollToFocus(
        vr.start,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );
      // Should align item to top
      expect(result).toBeCloseTo(vr.start * cis, 2);
    });

    it("should place the item at index * compressedItemSize", () => {
      const targetIndex = 500;
      const scrollPos = 600 * cis;
      const vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      const result = scrollToFocus(
        targetIndex,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );
      expect(result).toBeCloseTo(targetIndex * cis, 4);
    });
  });
});

// =============================================================================
// End → repeated PageUp (the original bug scenario)
// =============================================================================

describe("End → repeated PageUp (issue #7)", () => {
  it("should produce monotonically decreasing scroll positions", () => {
    const pageSize = fullyVisible; // 8
    let focusIndex = TOTAL - 1; // End key

    // Simulate End key: scrollToFocus for last item
    let scrollPos = 0;
    let vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
    scrollPos = scrollToFocus(
      focusIndex,
      cache,
      scrollPos,
      CONTAINER,
      0,
      0,
      comp,
      TOTAL,
      vr,
    );

    expect(scrollPos).toBeGreaterThan(0);

    const positions: number[] = [scrollPos];

    // Press PageUp 10 times
    for (let i = 0; i < 10; i++) {
      focusIndex = Math.max(0, focusIndex - pageSize);
      vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      const newScroll = scrollToFocus(
        focusIndex,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );

      // If scrollToFocus decided to scroll, the position must decrease
      if (newScroll !== scrollPos) {
        expect(newScroll).toBeLessThan(scrollPos);
      }

      scrollPos = newScroll;
      positions.push(scrollPos);
    }

    // All positions should be monotonically non-increasing
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeLessThanOrEqual(positions[i - 1]!);
    }
  });

  it("should never produce an empty visible range during PageUp sequence", () => {
    const pageSize = fullyVisible;
    let focusIndex = TOTAL - 1;
    let scrollPos = 0;
    let vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
    scrollPos = scrollToFocus(
      focusIndex,
      cache,
      scrollPos,
      CONTAINER,
      0,
      0,
      comp,
      TOTAL,
      vr,
    );

    for (let i = 0; i < 15; i++) {
      focusIndex = Math.max(0, focusIndex - pageSize);
      vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);

      // The visible range must always contain items
      expect(vr.end).toBeGreaterThanOrEqual(vr.start);
      expect(vr.start).toBeGreaterThanOrEqual(0);
      expect(vr.end).toBeLessThan(TOTAL);

      const newScroll = scrollToFocus(
        focusIndex,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );
      scrollPos = newScroll;
    }
  });

  it("should keep the focused item within the visible range after scroll", () => {
    const pageSize = fullyVisible;
    let focusIndex = TOTAL - 1;
    let scrollPos = 0;
    let vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
    scrollPos = scrollToFocus(
      focusIndex,
      cache,
      scrollPos,
      CONTAINER,
      0,
      0,
      comp,
      TOTAL,
      vr,
    );

    for (let i = 0; i < 15; i++) {
      focusIndex = Math.max(0, focusIndex - pageSize);
      vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      scrollPos = scrollToFocus(
        focusIndex,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );

      // After scrollToFocus, recompute visible range at new position
      const newVr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);

      // The focused item must be within the visible range
      expect(focusIndex).toBeGreaterThanOrEqual(newVr.start);
      expect(focusIndex).toBeLessThanOrEqual(newVr.end);
    }
  });
});

// =============================================================================
// End → PageDown (return journey)
// =============================================================================

describe("PageUp then PageDown (round-trip near bottom)", () => {
  it("should produce increasing scroll positions on PageDown", () => {
    // Start at bottom, go up 5 times, then down 5 times
    const pageSize = fullyVisible;
    let focusIndex = TOTAL - 1;
    let scrollPos = 0;
    let vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
    scrollPos = scrollToFocus(focusIndex, cache, scrollPos, CONTAINER, 0, 0, comp, TOTAL, vr);

    // PageUp 5 times
    for (let i = 0; i < 5; i++) {
      focusIndex = Math.max(0, focusIndex - pageSize);
      vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      scrollPos = scrollToFocus(focusIndex, cache, scrollPos, CONTAINER, 0, 0, comp, TOTAL, vr);
    }

    const midPos = scrollPos;

    // PageDown 5 times — scroll should increase
    for (let i = 0; i < 5; i++) {
      focusIndex = Math.min(TOTAL - 1, focusIndex + pageSize);
      vr = visibleRangeAt(scrollPos, CONTAINER, cache, TOTAL, comp);
      const newScroll = scrollToFocus(
        focusIndex,
        cache,
        scrollPos,
        CONTAINER,
        0,
        0,
        comp,
        TOTAL,
        vr,
      );

      if (newScroll !== scrollPos) {
        expect(newScroll).toBeGreaterThan(scrollPos);
      }
      scrollPos = newScroll;
    }

    // Should have scrolled back down from the midpoint
    expect(scrollPos).toBeGreaterThan(midPos);
  });
});

// =============================================================================
// calculateCompressedScrollToIndex — no special case for End
// =============================================================================

describe("calculateCompressedScrollToIndex (no interpolation)", () => {
  it("should return 0 for first item with start alignment", () => {
    const pos = calculateCompressedScrollToIndex(0, cache, CONTAINER, TOTAL, comp, "start");
    expect(pos).toBe(0);
  });

  it("should return positive value for last item with start alignment", () => {
    const pos = calculateCompressedScrollToIndex(
      TOTAL - 1,
      cache,
      CONTAINER,
      TOTAL,
      comp,
      "start",
    );
    expect(pos).toBeGreaterThan(0);
    // Linear: (TOTAL-1)/TOTAL * virtualSize
    expect(pos).toBeCloseTo(((TOTAL - 1) / TOTAL) * comp.virtualSize, 0);
  });

  it("should return value within padded maxScroll for last item with end alignment", () => {
    const pos = calculateCompressedScrollToIndex(
      TOTAL - 1,
      cache,
      CONTAINER,
      TOTAL,
      comp,
      "end",
    );
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThanOrEqual(maxScroll + 1); // small tolerance
  });

  it("should produce monotonically increasing positions for increasing indices", () => {
    const indices = [0, 1000, 50000, 500000, 999000, 999999];
    let prev = -1;
    for (const idx of indices) {
      const pos = calculateCompressedScrollToIndex(idx, cache, CONTAINER, TOTAL, comp, "start");
      expect(pos).toBeGreaterThan(prev);
      prev = pos;
    }
  });
});

// =============================================================================
// Item positioning at various scroll positions
// =============================================================================

describe("calculateCompressedItemPosition (no interpolation)", () => {
  it("should position first item at 0 when scrollPos is 0", () => {
    const pos = calculateCompressedItemPosition(0, 0, cache, TOTAL, CONTAINER, comp);
    expect(pos).toBeCloseTo(0, 0);
  });

  it("should position items with correct spacing at any scroll position", () => {
    const scrollPos = 500000 * cis;
    const pos1 = calculateCompressedItemPosition(500000, scrollPos, cache, TOTAL, CONTAINER, comp);
    const pos2 = calculateCompressedItemPosition(500001, scrollPos, cache, TOTAL, CONTAINER, comp);
    // Adjacent items should be exactly itemHeight apart
    expect(pos2 - pos1).toBeCloseTo(ITEM_HEIGHT, 0);
  });

  it("should position items correctly at padded maxScroll", () => {
    const range = visibleRangeAt(maxScroll, CONTAINER, cache, TOTAL, comp);

    // All items in visible range should have positions within or near the viewport
    for (let i = range.start; i <= range.end; i++) {
      const pos = calculateCompressedItemPosition(i, maxScroll, cache, TOTAL, CONTAINER, comp);
      // Items should be positioned somewhere reasonable (within ±2 items of viewport)
      expect(pos).toBeGreaterThan(-ITEM_HEIGHT * 3);
      expect(pos).toBeLessThan(CONTAINER + ITEM_HEIGHT * 3);
    }
  });

  it("should have no discontinuity near the bottom", () => {
    // Sample positions approaching maxScroll — spacing should stay consistent
    const step = maxScroll / 100;
    for (let s = maxScroll - 10 * step; s <= maxScroll; s += step) {
      const range = visibleRangeAt(s, CONTAINER, cache, TOTAL, comp);
      if (range.start + 1 <= range.end) {
        const pos0 = calculateCompressedItemPosition(
          range.start,
          s,
          cache,
          TOTAL,
          CONTAINER,
          comp,
        );
        const pos1 = calculateCompressedItemPosition(
          range.start + 1,
          s,
          cache,
          TOTAL,
          CONTAINER,
          comp,
        );
        expect(pos1 - pos0).toBeCloseTo(ITEM_HEIGHT, 0);
      }
    }
  });
});

// =============================================================================
// Different configurations (item sizes, container sizes)
// =============================================================================

describe("compressed scroll with different configurations", () => {
  const configs = [
    { itemHeight: 40, containerSize: 600, total: 1_000_000, label: "40px items, 600px viewport" },
    { itemHeight: 72, containerSize: 400, total: 500_000, label: "72px items, 400px viewport" },
    { itemHeight: 100, containerSize: 800, total: 2_000_000, label: "100px items, 800px viewport" },
    { itemHeight: 24, containerSize: 300, total: 10_000_000, label: "24px items, 300px viewport, 10M items" },
  ];

  for (const cfg of configs) {
    describe(cfg.label, () => {
      const sc = createSizeCache(cfg.itemHeight, cfg.total);
      const co = getCompressionState(cfg.total, sc);

      if (!co.isCompressed) return; // skip if not actually compressed

      const ms = paddedMaxScroll(co.virtualSize, cfg.containerSize, co.ratio);
      const fv = Math.floor(cfg.containerSize / cfg.itemHeight);

      it("should reach the last item at padded maxScroll", () => {
        const range = visibleRangeAt(ms, cfg.containerSize, sc, cfg.total, co);
        expect(range.end).toBe(cfg.total - 1);
      });

      it("should place last item's bottom at viewport bottom at maxScroll", () => {
        const pos = calculateCompressedItemPosition(
          cfg.total - 1,
          ms,
          sc,
          cfg.total,
          cfg.containerSize,
          co,
        );
        const bottom = pos + cfg.itemHeight;
        expect(bottom).toBeCloseTo(cfg.containerSize, 1);
      });

      it("End → PageUp should keep focused item visible", () => {
        let focusIndex = cfg.total - 1;
        let scrollPos = 0;
        let vr = visibleRangeAt(scrollPos, cfg.containerSize, sc, cfg.total, co);
        scrollPos = scrollToFocus(
          focusIndex,
          sc,
          scrollPos,
          cfg.containerSize,
          0,
          0,
          co,
          cfg.total,
          vr,
        );

        for (let i = 0; i < 5; i++) {
          focusIndex = Math.max(0, focusIndex - fv);
          vr = visibleRangeAt(scrollPos, cfg.containerSize, sc, cfg.total, co);
          scrollPos = scrollToFocus(
            focusIndex,
            sc,
            scrollPos,
            cfg.containerSize,
            0,
            0,
            co,
            cfg.total,
            vr,
          );

          const newVr = visibleRangeAt(scrollPos, cfg.containerSize, sc, cfg.total, co);
          expect(focusIndex).toBeGreaterThanOrEqual(newVr.start);
          expect(focusIndex).toBeLessThanOrEqual(newVr.end);
        }
      });
    });
  }
});