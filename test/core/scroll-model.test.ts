/**
 * vlist — Logical Scroll Model Tests (RFC-012)
 *
 * Pure module: conversions between pixel offsets and logical { index, offsetPx },
 * normalization across item boundaries, and the ScrollAdapter boundary.
 */

import { describe, it, expect } from "bun:test";
import { createSizeCache } from "../../src/rendering/sizes";
import {
  pixelToLogical,
  logicalToPixel,
  normalizeLogical,
  createScrollAdapter,
} from "../../src/core/scroll-model";

// =============================================================================
// pixelToLogical
// =============================================================================

describe("pixelToLogical (fixed sizes)", () => {
  const cache = createSizeCache(48, 1000);

  it("maps offset 0 to index 0, offsetPx 0", () => {
    expect(pixelToLogical(cache, 0)).toEqual({ index: 0, offsetPx: 0 });
  });

  it("maps an exact item boundary to that item with offsetPx 0", () => {
    expect(pixelToLogical(cache, 480)).toEqual({ index: 10, offsetPx: 0 });
  });

  it("maps a mid-item offset to index + remainder", () => {
    expect(pixelToLogical(cache, 500)).toEqual({ index: 10, offsetPx: 20 });
  });

  it("clamps negative pixels to the top", () => {
    expect(pixelToLogical(cache, -100)).toEqual({ index: 0, offsetPx: 0 });
  });

  it("clamps beyond the end to the last item", () => {
    const res = pixelToLogical(cache, 48 * 1000 + 999);
    expect(res.index).toBe(999);
  });

  it("returns origin for an empty list", () => {
    expect(pixelToLogical(createSizeCache(48, 0), 100)).toEqual({ index: 0, offsetPx: 0 });
  });
});

describe("pixelToLogical (variable sizes)", () => {
  // sizes: 10, 20, 30, 40, ... -> offsets: 0, 10, 30, 60, 100, ...
  const cache = createSizeCache((i) => (i + 1) * 10, 100);

  it("maps offset within the third item", () => {
    // offset 60 is the start of item 3; 75 is 15px into item 3 (size 40)
    expect(pixelToLogical(cache, 75)).toEqual({ index: 3, offsetPx: 15 });
  });

  it("maps an exact boundary", () => {
    expect(pixelToLogical(cache, 30)).toEqual({ index: 2, offsetPx: 0 });
  });
});

// =============================================================================
// logicalToPixel — round trips
// =============================================================================

describe("logicalToPixel", () => {
  it("round-trips with pixelToLogical (fixed)", () => {
    const cache = createSizeCache(48, 1000);
    for (const px of [0, 47, 48, 500, 12345, 48 * 999]) {
      expect(logicalToPixel(cache, pixelToLogical(cache, px))).toBe(px);
    }
  });

  it("round-trips with pixelToLogical (variable)", () => {
    const cache = createSizeCache((i) => (i + 1) * 10, 100);
    for (const px of [0, 5, 30, 75, 100, 250]) {
      expect(logicalToPixel(cache, pixelToLogical(cache, px))).toBe(px);
    }
  });

  it("normalizes an overflowing offsetPx before converting", () => {
    const cache = createSizeCache(48, 1000);
    // index 10 + 100px overflow -> 480 + 100 = 580
    expect(logicalToPixel(cache, { index: 10, offsetPx: 100 })).toBe(580);
  });
});

// =============================================================================
// normalizeLogical
// =============================================================================

describe("normalizeLogical", () => {
  const cache = createSizeCache(48, 1000);

  it("carries positive overflow forward across items", () => {
    // 48*2 = 96 overflow past item 5 -> item 7, 0 remainder
    expect(normalizeLogical(cache, { index: 5, offsetPx: 96 })).toEqual({ index: 7, offsetPx: 0 });
  });

  it("carries partial overflow", () => {
    expect(normalizeLogical(cache, { index: 5, offsetPx: 60 })).toEqual({ index: 6, offsetPx: 12 });
  });

  it("borrows negative underflow backward across items", () => {
    expect(normalizeLogical(cache, { index: 5, offsetPx: -60 })).toEqual({ index: 3, offsetPx: 36 });
  });

  it("clamps an index below the start to the origin", () => {
    expect(normalizeLogical(cache, { index: -5, offsetPx: 30 })).toEqual({ index: 0, offsetPx: 0 });
  });

  it("clamps an index past the end and preserves offset", () => {
    expect(normalizeLogical(cache, { index: 5000, offsetPx: 30 })).toEqual({ index: 999, offsetPx: 30 });
  });

  it("does not carry past the final item", () => {
    // huge overflow on a 1000-item list stops at index 999
    const res = normalizeLogical(cache, { index: 998, offsetPx: 48 * 10 });
    expect(res.index).toBe(999);
  });

  it("preserves the anchor pixel when an upstream item is remeasured (autosize stability)", () => {
    // The point of offsetPx over fraction: the anchor's pixel offset within its
    // own item is unaffected by sizes elsewhere changing.
    const c = createSizeCache((i) => (i === 0 ? 200 : 48), 100);
    const before = normalizeLogical(c, { index: 5, offsetPx: 20 });
    expect(before).toEqual({ index: 5, offsetPx: 20 });
  });
});

// =============================================================================
// ScrollAdapter
// =============================================================================

describe("createScrollAdapter", () => {
  function setup(total = 1000, itemSize = 48, containerSize = 600) {
    const sizeCache = createSizeCache(itemSize, total);
    let pixel = 0;
    const adapter = createScrollAdapter({
      sizeCache,
      getPixel: () => pixel,
      setPixel: (px) => { pixel = px; },
      getContainerSize: () => containerSize,
    });
    return { adapter, getPixel: () => pixel };
  }

  it("getPixelEquivalent reflects the source", () => {
    const { adapter } = setup();
    adapter.setPixelEquivalent(500);
    expect(adapter.getPixelEquivalent()).toBe(500);
  });

  it("getLogical derives from the pixel source", () => {
    const { adapter } = setup();
    adapter.setPixelEquivalent(500);
    expect(adapter.getLogical()).toEqual({ index: 10, offsetPx: 20 });
  });

  it("setLogical writes the pixel equivalent", () => {
    const { adapter, getPixel } = setup();
    adapter.setLogical({ index: 10, offsetPx: 20 });
    expect(getPixel()).toBe(500);
  });

  it("getMaxPixelEquivalent is totalSize - containerSize", () => {
    const { adapter } = setup(1000, 48, 600);
    expect(adapter.getMaxPixelEquivalent()).toBe(48 * 1000 - 600);
  });

  it("clamps setPixelEquivalent to [0, max]", () => {
    const { adapter, getPixel } = setup(1000, 48, 600);
    adapter.setPixelEquivalent(-100);
    expect(getPixel()).toBe(0);
    adapter.setPixelEquivalent(1e9);
    expect(getPixel()).toBe(adapter.getMaxPixelEquivalent());
  });

  it("clamps setLogical past the end", () => {
    const { adapter, getPixel } = setup(1000, 48, 600);
    adapter.setLogical({ index: 5000, offsetPx: 0 });
    expect(getPixel()).toBe(adapter.getMaxPixelEquivalent());
  });

  it("scrollByPx advances and clamps", () => {
    const { adapter, getPixel } = setup(1000, 48, 600);
    adapter.setPixelEquivalent(100);
    adapter.scrollByPx(50);
    expect(getPixel()).toBe(150);
    adapter.scrollByPx(-1000);
    expect(getPixel()).toBe(0);
  });

  it("returns a zero max when content fits the container", () => {
    const { adapter } = setup(5, 48, 600);
    expect(adapter.getMaxPixelEquivalent()).toBe(0);
  });
});
