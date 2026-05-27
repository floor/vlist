/**
 * vlist v2 — Horizontal Mode Tests
 *
 * Tests orientation="horizontal": DOM structure, scroll axis,
 * content sizing, scrollToIndex, and ARIA orientation.
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
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 300, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 500, configurable: true });
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
  container = createContainer({ width: 500, height: 300 });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

function getViewport(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
}

function getContent(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-content")!;
}

function makeHList(count = 100) {
  list = createVList<TestItem>(
    {
      container,
      items: createTestItems(count),
      orientation: "horizontal",
      item: { width: 80, template: simpleTemplate },
    },
    [],
  );
  return list;
}

// =============================================================================
// DOM structure
// =============================================================================

describe("horizontal — DOM structure", () => {
  it("root has --horizontal modifier class", () => {
    const vlist = makeHList(10);
    expect(vlist.element.classList.contains("vlist--horizontal")).toBe(true);
  });

  it("viewport has horizontal overflow style", () => {
    const vlist = makeHList(10);
    const viewport = getViewport(container);
    expect(viewport.style.overflowX).toBe("auto");
    expect(viewport.style.overflowY).toBe("hidden");
  });

  it("content has aria-orientation=horizontal", () => {
    const vlist = makeHList(10);
    const content = getContent(container);
    expect(content.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("content width reflects total size", () => {
    const vlist = makeHList(20);
    const content = getContent(container);
    const width = parseInt(content.style.width, 10);
    // 20 items * 80px = 1600
    expect(width).toBe(1600);
  });
});

// =============================================================================
// Scrolling
// =============================================================================

describe("horizontal — scrolling", () => {
  it("scrollToIndex sets scrollLeft, not scrollTop", () => {
    const vlist = makeHList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(10, "start");

    // index 10 * width 80 = 800
    expect(viewport.scrollLeft).toBe(800);
  });

  it("scrollToIndex center alignment", () => {
    const vlist = makeHList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(10, "center");

    // offset=800, itemSize=80, containerSize=500
    // pos = 800 - (500 - 80) / 2 = 800 - 210 = 590
    expect(viewport.scrollLeft).toBe(590);
  });

  it("scrollToIndex end alignment", () => {
    const vlist = makeHList(100);
    const viewport = getViewport(container);

    vlist.scrollToIndex(10, "end");

    // pos = 800 + 80 - 500 = 380
    expect(viewport.scrollLeft).toBe(380);
  });

  it("scroll event reports position from scrollLeft", () => {
    const vlist = makeHList(100);
    const viewport = getViewport(container);

    const positions: number[] = [];
    vlist.on("scroll", (e) => positions.push(e.scrollPosition));

    Object.defineProperty(viewport, "scrollLeft", {
      value: 400,
      writable: true,
      configurable: true,
    });
    viewport.dispatchEvent(new Event("scroll", { bubbles: false }));

    expect(positions.length).toBe(1);
    expect(positions[0]).toBe(400);
  });
});

// =============================================================================
// Rendering
// =============================================================================

describe("horizontal — rendering", () => {
  it("renders items within visible range", () => {
    const vlist = makeHList(100);
    const content = getContent(container);

    // containerSize=500, itemWidth=80 → ~6-7 visible + overscan
    expect(content.children.length).toBeGreaterThan(0);
    expect(content.children.length).toBeLessThanOrEqual(15);
  });

  it("empty horizontal list renders 0 items", () => {
    const vlist = makeHList(0);
    const content = getContent(container);
    expect(content.children.length).toBe(0);
  });
});
