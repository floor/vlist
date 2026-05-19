/**
 * vlist v2 - Core Range Tests
 * Tests for range calculations (visible range, overscan)
 */

import { describe, it, expect } from "bun:test";
import { createSizeCache } from "../../src/rendering/sizes";
import {
  calcVisibleRange,
  applyOverscan,
} from "../../src/core/range";

// =============================================================================
// calcVisibleRange
// =============================================================================

describe("calcVisibleRange", () => {
  it("should calculate visible range at scroll position 0", () => {
    const hc = createSizeCache(50, 100); // 100 items, 50px each
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(0, 500, hc, 100, outStart, outEnd);

    expect(outStart.value).toBe(0);
    expect(outEnd.value).toBeGreaterThanOrEqual(9); // At least 10 items visible (500/50)
  });

  it("should calculate visible range when scrolled", () => {
    const hc = createSizeCache(50, 100);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(1000, 500, hc, 100, outStart, outEnd); // Scrolled to item 20

    expect(outStart.value).toBe(20);
    expect(outEnd.value).toBeGreaterThanOrEqual(29);
  });

  it("should handle empty list", () => {
    const hc = createSizeCache(50, 0);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(0, 500, hc, 0, outStart, outEnd);

    expect(outStart.value).toBe(0);
    expect(outEnd.value).toBe(-1);
  });

  it("should handle zero container height", () => {
    const hc = createSizeCache(50, 100);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(0, 0, hc, 100, outStart, outEnd);

    expect(outStart.value).toBe(0);
    expect(outEnd.value).toBe(-1);
  });

  it("should clamp start to 0", () => {
    const hc = createSizeCache(50, 100);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(-100, 500, hc, 100, outStart, outEnd);

    expect(outStart.value).toBe(0);
  });

  it("should clamp end to totalItems - 1", () => {
    const hc = createSizeCache(50, 100);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    // Scroll to bottom
    calcVisibleRange(4500, 500, hc, 100, outStart, outEnd);

    expect(outEnd.value).toBeLessThanOrEqual(99);
  });

  it("should work with variable heights", () => {
    const hc = createSizeCache((i) => (i % 2 === 0 ? 50 : 100), 100);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(0, 500, hc, 100, outStart, outEnd);

    expect(outStart.value).toBe(0);
    expect(outEnd.value).toBeGreaterThan(0);
  });

  it("should reuse output range object", () => {
    const hc = createSizeCache(50, 100);
    const outStart = { value: 999 };
    const outEnd = { value: 999 };

    calcVisibleRange(0, 500, hc, 100, outStart, outEnd);

    expect(outStart.value).toBe(0);
    expect(outEnd.value).toBeGreaterThan(0);
  });

  it("should handle single item", () => {
    const hc = createSizeCache(50, 1);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(0, 500, hc, 1, outStart, outEnd);

    expect(outStart.value).toBe(0);
    expect(outEnd.value).toBe(0);
  });

  it("should handle very large scroll position", () => {
    const hc = createSizeCache(50, 1000);
    const outStart = { value: 0 };
    const outEnd = { value: 0 };

    calcVisibleRange(50000, 500, hc, 1000, outStart, outEnd);

    expect(outStart.value).toBeLessThanOrEqual(999);
    expect(outEnd.value).toBe(999);
  });
});

// =============================================================================
// applyOverscan
// =============================================================================

describe("applyOverscan", () => {
  it("should apply overscan to both sides", () => {
    const result = applyOverscan(10, 20, 3, 100);

    expect(result.start).toBe(7); // 10 - 3
    expect(result.end).toBe(23); // 20 + 3
  });

  it("should clamp overscan start to 0", () => {
    const result = applyOverscan(2, 10, 5, 100);

    expect(result.start).toBe(0); // 2 - 5 = -3, clamped to 0
    expect(result.end).toBe(15);
  });

  it("should clamp overscan end to totalItems - 1", () => {
    const result = applyOverscan(90, 95, 10, 100);

    expect(result.start).toBe(80);
    expect(result.end).toBe(99); // 95 + 10 = 105, clamped to 99
  });

  it("should handle zero overscan", () => {
    const result = applyOverscan(10, 20, 0, 100);

    expect(result.start).toBe(10);
    expect(result.end).toBe(20);
  });

  it("should handle large overscan", () => {
    const result = applyOverscan(50, 60, 100, 100);

    expect(result.start).toBe(0);
    expect(result.end).toBe(99);
  });

  it("should handle empty list", () => {
    const result = applyOverscan(0, -1, 3, 0);

    expect(result.start).toBe(0);
    expect(result.end).toBe(-1);
  });

  it("should handle visible range at start", () => {
    const result = applyOverscan(0, 10, 5, 100);

    expect(result.start).toBe(0);
    expect(result.end).toBe(15);
  });

  it("should handle visible range at end", () => {
    const result = applyOverscan(90, 99, 5, 100);

    expect(result.start).toBe(85);
    expect(result.end).toBe(99);
  });

  it("should handle single item visible range", () => {
    const result = applyOverscan(50, 50, 3, 100);

    expect(result.start).toBe(47);
    expect(result.end).toBe(53);
  });
});

// =============================================================================
// Integration tests
// =============================================================================

describe("range calculations integration", () => {
  it("should work together: visible + overscan", () => {
    const hc = createSizeCache(50, 100);
    const visibleStart = { value: 0 };
    const visibleEnd = { value: 0 };

    calcVisibleRange(1000, 500, hc, 100, visibleStart, visibleEnd);
    const render = applyOverscan(visibleStart.value, visibleEnd.value, 3, 100);

    expect(render.start).toBeLessThan(visibleStart.value);
    expect(render.end).toBeGreaterThan(visibleEnd.value);
  });

  it("should maintain consistency when scrolling", () => {
    const hc = createSizeCache(50, 100);
    const visibleStart = { value: 0 };
    const visibleEnd = { value: 0 };

    // Scroll through list
    for (let scroll = 0; scroll < 4000; scroll += 100) {
      calcVisibleRange(scroll, 500, hc, 100, visibleStart, visibleEnd);

      expect(visibleStart.value).toBeGreaterThanOrEqual(0);
      expect(visibleEnd.value).toBeLessThanOrEqual(99);
      expect(visibleEnd.value).toBeGreaterThanOrEqual(visibleStart.value);
    }
  });
});
