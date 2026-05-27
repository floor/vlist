/**
 * vlist v2 — scrollToIndex Alignment & Edge Case Tests
 *
 * Tests start/center/end alignment, index clamping,
 * empty list handling, and options-object form.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

function getViewport(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
}

function makeList(count = 100) {
  list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 50, template: simpleTemplate } },
    [],
  );
  return list;
}

// =============================================================================
// scrollToIndex — alignment
// =============================================================================

describe("scrollToIndex — alignment", () => {
  it("align=start scrolls item to top of viewport", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(20, "start");

    // index 20 * height 50 = offset 1000
    expect(viewport.scrollTop).toBe(1000);
  });

  it("align=center scrolls item to center of viewport", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(20, "center");

    // offset=1000, itemSize=50, containerSize=500
    // pos = offset - (containerSize - itemSize) / 2 = 1000 - 225 = 775
    expect(viewport.scrollTop).toBe(775);
  });

  it("align=end scrolls item to bottom of viewport", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(20, "end");

    // pos = offset + itemSize - containerSize = 1000 + 50 - 500 = 550
    expect(viewport.scrollTop).toBe(550);
  });

  it("default alignment is start", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(20);

    expect(viewport.scrollTop).toBe(1000);
  });

  it("options object form works", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(20, { align: "center" });

    expect(viewport.scrollTop).toBe(775);
  });
});

// =============================================================================
// scrollToIndex — clamping
// =============================================================================

describe("scrollToIndex — clamping", () => {
  it("negative index clamps to 0", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(-5, "start");

    expect(viewport.scrollTop).toBe(0);
  });

  it("index beyond total clamps to last item", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(999, "start");

    // Clamped to index 99, offset = 99 * 50 = 4950
    // But maxScroll = totalSize - containerSize = 5000 - 500 = 4500
    expect(viewport.scrollTop).toBe(4500);
  });

  it("scrollToIndex on first item sets scrollTop to 0", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    // First scroll somewhere else
    vlist.scrollToIndex(50, "start");
    expect(viewport.scrollTop).toBeGreaterThan(0);

    // Then back to 0
    vlist.scrollToIndex(0, "start");
    expect(viewport.scrollTop).toBe(0);
  });

  it("scrollToIndex on last item does not exceed max scroll", () => {
    const vlist = makeList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(99, "start");

    // maxScroll = 5000 - 500 = 4500
    expect(viewport.scrollTop).toBeLessThanOrEqual(4500);
  });
});

// =============================================================================
// scrollToIndex — edge cases
// =============================================================================

describe("scrollToIndex — edge cases", () => {
  it("no-op on empty list", () => {
    const vlist = makeList(0);
    const viewport = getViewport(container);

    vlist.scrollToIndex(0, "start");
    expect(viewport.scrollTop).toBe(0);
  });

  it("single item list scrolls to 0", () => {
    const vlist = makeList(1);
    const viewport = getViewport(container);

    vlist.scrollToIndex(0, "center");
    // Single item fits in viewport — scrollTop stays 0
    expect(viewport.scrollTop).toBe(0);
  });

  it("scrollToIndex after destroy does not throw", () => {
    const vlist = makeList(100);
    vlist.destroy();
    list = null;

    expect(() => vlist.scrollToIndex(50, "start")).not.toThrow();
  });
});
