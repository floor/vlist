/**
 * vlist - Builder Range Tests
 * Tests for range calculations (visible range, overscan, scroll-to-index)
 */

import { describe, it, expect } from "bun:test";
import { createSizeCache } from "../../src/rendering/sizes";
import {
  calcVisibleRange,
  applyOverscan,
  calcScrollToPosition,
} from "../../src/builder/range";
import type { Range } from "../../src/types";

// =============================================================================
// calcVisibleRange
// =============================================================================

describe("calcVisibleRange", () => {
  it("should calculate visible range at scroll position 0", () => {
    const hc = createSizeCache(50, 100); // 100 items, 50px each
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(0, 500, hc, 100, out);

    expect(out.start).toBe(0);
    expect(out.end).toBeGreaterThanOrEqual(9); // At least 10 items visible (500/50)
  });

  it("should calculate visible range when scrolled", () => {
    const hc = createSizeCache(50, 100);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(1000, 500, hc, 100, out); // Scrolled to item 20

    expect(out.start).toBe(20);
    expect(out.end).toBeGreaterThanOrEqual(29);
  });

  it("should handle empty list", () => {
    const hc = createSizeCache(50, 0);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(0, 500, hc, 0, out);

    expect(out.start).toBe(0);
    expect(out.end).toBe(0);
  });

  it("should handle zero container height", () => {
    const hc = createSizeCache(50, 100);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(0, 0, hc, 100, out);

    expect(out.start).toBe(0);
    expect(out.end).toBe(0);
  });

  it("should clamp start to 0", () => {
    const hc = createSizeCache(50, 100);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(-100, 500, hc, 100, out);

    expect(out.start).toBe(0);
  });

  it("should clamp end to totalItems - 1", () => {
    const hc = createSizeCache(50, 100);
    const out: Range = { start: 0, end: 0 };

    // Scroll to bottom
    calcVisibleRange(4500, 500, hc, 100, out);

    expect(out.end).toBeLessThanOrEqual(99);
  });

  it("should work with variable heights", () => {
    const hc = createSizeCache((i) => (i % 2 === 0 ? 50 : 100), 100);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(0, 500, hc, 100, out);

    expect(out.start).toBe(0);
    expect(out.end).toBeGreaterThan(0);
  });

  it("should reuse output range object", () => {
    const hc = createSizeCache(50, 100);
    const out: Range = { start: 999, end: 999 };

    calcVisibleRange(0, 500, hc, 100, out);

    expect(out.start).toBe(0);
    expect(out.end).toBeGreaterThan(0);
  });

  it("should handle single item", () => {
    const hc = createSizeCache(50, 1);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(0, 500, hc, 1, out);

    expect(out.start).toBe(0);
    expect(out.end).toBe(0);
  });

  it("should handle very large scroll position", () => {
    const hc = createSizeCache(50, 1000);
    const out: Range = { start: 0, end: 0 };

    calcVisibleRange(50000, 500, hc, 1000, out);

    expect(out.start).toBeLessThanOrEqual(999);
    expect(out.end).toBe(999);
  });
});

// =============================================================================
// applyOverscan
// =============================================================================

describe("applyOverscan", () => {
  it("should apply overscan to both sides", () => {
    const visible: Range = { start: 10, end: 20 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 3, 100, out);

    expect(out.start).toBe(7); // 10 - 3
    expect(out.end).toBe(23); // 20 + 3
  });

  it("should clamp overscan start to 0", () => {
    const visible: Range = { start: 2, end: 10 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 5, 100, out);

    expect(out.start).toBe(0); // 2 - 5 = -3, clamped to 0
    expect(out.end).toBe(15);
  });

  it("should clamp overscan end to totalItems - 1", () => {
    const visible: Range = { start: 90, end: 95 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 10, 100, out);

    expect(out.start).toBe(80);
    expect(out.end).toBe(99); // 95 + 10 = 105, clamped to 99
  });

  it("should handle zero overscan", () => {
    const visible: Range = { start: 10, end: 20 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 0, 100, out);

    expect(out.start).toBe(10);
    expect(out.end).toBe(20);
  });

  it("should handle large overscan", () => {
    const visible: Range = { start: 50, end: 60 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 100, 100, out);

    expect(out.start).toBe(0);
    expect(out.end).toBe(99);
  });

  it("should handle empty list", () => {
    const visible: Range = { start: 0, end: 0 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 3, 0, out);

    expect(out.start).toBe(0);
    expect(out.end).toBe(0);
  });

  it("should handle visible range at start", () => {
    const visible: Range = { start: 0, end: 10 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 5, 100, out);

    expect(out.start).toBe(0);
    expect(out.end).toBe(15);
  });

  it("should handle visible range at end", () => {
    const visible: Range = { start: 90, end: 99 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 5, 100, out);

    expect(out.start).toBe(85);
    expect(out.end).toBe(99);
  });

  it("should reuse output range object", () => {
    const visible: Range = { start: 10, end: 20 };
    const out: Range = { start: 999, end: 999 };

    applyOverscan(visible, 3, 100, out);

    expect(out.start).toBe(7);
    expect(out.end).toBe(23);
  });

  it("should handle single item visible range", () => {
    const visible: Range = { start: 50, end: 50 };
    const out: Range = { start: 0, end: 0 };

    applyOverscan(visible, 3, 100, out);

    expect(out.start).toBe(47);
    expect(out.end).toBe(53);
  });
});

// =============================================================================
// calcScrollToPosition
// =============================================================================

describe("calcScrollToPosition", () => {
  it("should scroll to start alignment", () => {
    const hc = createSizeCache(50, 100);

    const pos = calcScrollToPosition(10, hc, 500, 100, "start");

    expect(pos).toBe(500); // Item 10 offset = 10 * 50
  });

  it("should scroll to center alignment", () => {
    const hc = createSizeCache(50, 100);

    const pos = calcScrollToPosition(10, hc, 500, 100, "center");

    // offset = 500, itemHeight = 50, containerHeight = 500
    // pos = 500 - (500 - 50) / 2 = 500 - 225 = 275
    expect(pos).toBe(275);
  });

  it("should scroll to end alignment", () => {
    const hc = createSizeCache(50, 100);

    const pos = calcScrollToPosition(10, hc, 500, 100, "end");

    // offset = 500, itemHeight = 50, containerHeight = 500
    // pos = 500 - 500 + 50 = 50
    expect(pos).toBe(50);
  });

  it("should clamp to 0 for negative positions", () => {
    const hc = createSizeCache(50, 100);

    const pos = calcScrollToPosition(0, hc, 500, 100, "center");

    expect(pos).toBe(0);
  });

  it("should clamp to maxScroll for positions beyond content", () => {
    const hc = createSizeCache(50, 100);

    const pos = calcScrollToPosition(99, hc, 500, 100, "end");

    const maxScroll = 50 * 100 - 500; // 4500
    expect(pos).toBeLessThanOrEqual(maxScroll);
  });

  it("should handle empty list", () => {
    const hc = createSizeCache(50, 0);

    const pos = calcScrollToPosition(0, hc, 500, 0, "start");

    expect(pos).toBe(0);
  });

  it("should clamp index to valid range", () => {
    const hc = createSizeCache(50, 100);

    const pos1 = calcScrollToPosition(-10, hc, 500, 100, "start");
    const pos2 = calcScrollToPosition(1000, hc, 500, 100, "start");

    expect(pos1).toBe(0); // Index -10 clamped to 0
    expect(pos2).toBeGreaterThan(0); // Index 1000 clamped to 99
  });

  it("should work with variable heights", () => {
    const hc = createSizeCache((i) => (i % 2 === 0 ? 50 : 100), 100);

    const pos = calcScrollToPosition(10, hc, 500, 100, "start");

    expect(pos).toBeGreaterThan(0);
  });

  it("should handle very tall items", () => {
    const hc = createSizeCache(1000, 100);

    const pos = calcScrollToPosition(5, hc, 500, 100, "start");

    expect(pos).toBe(5000); // 5 * 1000
  });

  it("should handle first item with all alignments", () => {
    const hc = createSizeCache(50, 100);

    const start = calcScrollToPosition(0, hc, 500, 100, "start");
    const center = calcScrollToPosition(0, hc, 500, 100, "center");
    const end = calcScrollToPosition(0, hc, 500, 100, "end");

    expect(start).toBe(0);
    expect(center).toBe(0); // Clamped
    expect(end).toBe(0); // Clamped
  });

  it("should handle last item with all alignments", () => {
    const hc = createSizeCache(50, 100);
    const maxScroll = 50 * 100 - 500; // 4500

    const start = calcScrollToPosition(99, hc, 500, 100, "start");
    const center = calcScrollToPosition(99, hc, 500, 100, "center");
    const end = calcScrollToPosition(99, hc, 500, 100, "end");

    expect(start).toBeLessThanOrEqual(maxScroll);
    expect(center).toBeLessThanOrEqual(maxScroll);
    expect(end).toBeLessThanOrEqual(maxScroll);
  });

  it("should handle container taller than content", () => {
    const hc = createSizeCache(50, 10); // Only 500px total height

    const pos = calcScrollToPosition(5, hc, 1000, 10, "start");

    expect(pos).toBe(0); // maxScroll = 0 (content fits)
  });

  it("should default to start alignment for unknown alignment", () => {
    const hc = createSizeCache(50, 100);

    const pos = calcScrollToPosition(10, hc, 500, 100, "start");
    const posDefault = calcScrollToPosition(10, hc, 500, 100, "start");

    expect(pos).toBe(posDefault);
  });
});

// =============================================================================
// Integration tests
// =============================================================================

describe("range calculations integration", () => {
  it("should work together: visible + overscan", () => {
    const hc = createSizeCache(50, 100);
    const visible: Range = { start: 0, end: 0 };
    const render: Range = { start: 0, end: 0 };

    calcVisibleRange(1000, 500, hc, 100, visible);
    applyOverscan(visible, 3, 100, render);

    expect(render.start).toBeLessThan(visible.start);
    expect(render.end).toBeGreaterThan(visible.end);
  });

  it("should maintain consistency when scrolling", () => {
    const hc = createSizeCache(50, 100);
    const visible: Range = { start: 0, end: 0 };

    // Scroll through list
    for (let scroll = 0; scroll < 4000; scroll += 100) {
      calcVisibleRange(scroll, 500, hc, 100, visible);

      expect(visible.start).toBeGreaterThanOrEqual(0);
      expect(visible.end).toBeLessThanOrEqual(99);
      expect(visible.end).toBeGreaterThanOrEqual(visible.start);
    }
  });

  it("should handle scroll-to-index then calculate visible range", () => {
    const hc = createSizeCache(50, 100);
    const visible: Range = { start: 0, end: 0 };

    // Scroll to index 50
    const scrollPos = calcScrollToPosition(50, hc, 500, 100, "start");
    calcVisibleRange(scrollPos, 500, hc, 100, visible);

    expect(visible.start).toBeLessThanOrEqual(50);
    expect(visible.end).toBeGreaterThanOrEqual(50);
  });
});
