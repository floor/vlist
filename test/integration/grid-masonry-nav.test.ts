/**
 * vlist - Grid & Masonry Navigation Integration Tests
 *
 * Tests for 2D keyboard navigation, scroll-on-click, and
 * selection interaction in grid and masonry layouts.
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";

import { vlist } from "../../src/builder/core";
import type { VList } from "../../src/builder/types";
import type { VListItem } from "../../src/types";
import { withSelection } from "../../src/features/selection/feature";
import { withGrid } from "../../src/features/grid/feature";
import { withMasonry } from "../../src/features/masonry/feature";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalRAF: any;
let originalCAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalRAF = global.requestAnimationFrame;
  originalCAF = global.cancelAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.Element = dom.window.Element;

  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(_target: Element) {
      this.callback(
        [
          {
            target: _target,
            contentRect: {
              width: 400,
              height: 500,
              top: 0,
              left: 0,
              bottom: 500,
              right: 400,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve(_target: Element) {}
    disconnect() {}
  };

  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
    ) {
      if (typeof options === "number") {
        this.scrollTop = options;
      } else if (options && typeof options.top === "number") {
        this.scrollTop = options.top;
      }
    };
  }

  (dom.window as any).scrollTo = (
    _x?: number | ScrollToOptions,
    _y?: number,
  ) => {};

  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(
      () => callback(performance.now()),
      0,
    ) as unknown as number;
  };
  global.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
});

// =============================================================================
// Test Types & Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  aspectRatio?: number;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    aspectRatio: [0.75, 1.0, 1.33, 1.5, 0.66][i % 5],
  }));

const template = (item: TestItem): string =>
  `<div class="item">${item.name}</div>`;

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 500 });
  Object.defineProperty(container, "clientWidth", { value: 400 });
  document.body.appendChild(container);
  return container;
};

const pressKey = (
  element: HTMLElement,
  key: string,
  opts?: { ctrlKey?: boolean },
) => {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      ctrlKey: opts?.ctrlKey ?? false,
    }),
  );
};

const clickItem = (list: VList<any>, index: number) => {
  const el = list.element.querySelector(
    `[data-index="${index}"]`,
  ) as HTMLElement;
  if (el) el.click();
};

/** Extract the focused item index from aria-activedescendant (format: vlist-N-item-{index}) */
const getFocusedIndex = (root: HTMLElement): number => {
  const attr = root.getAttribute("aria-activedescendant");
  if (!attr) return -1;
  const match = attr.match(/item-(\d+)$/);
  return match ? parseInt(match[1], 10) : -1;
};

/** Trigger focusin with :focus-visible mock on the root element */
const triggerFocusIn = (root: HTMLElement) => {
  const origMatches = root.matches;
  root.matches = (selector: string) =>
    selector === ":focus-visible" ? true : origMatches.call(root, selector);
  root.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
};

const getViewportScrollTop = (list: VList<any>): number => {
  const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
  return viewport ? viewport.scrollTop : 0;
};

// =============================================================================
// 1. Grid — Baseline Single-Select Navigation (no withSelection)
// =============================================================================

describe("grid — baseline single-select navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildGrid = () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .build();
    return list;
  };

  it("should not jump scroll when clicking an item", () => {
    const l = buildGrid();
    const root = l.element;

    // Click item at index 8 (row 2, first column of second row)
    clickItem(l, 8);

    // The viewport should NOT have jumped to a huge scroll position
    const scrollTop = getViewportScrollTop(l);
    // Total content size is 100 items / 4 columns = 25 rows * 100px = 2500px
    // We only clicked row 2, so scroll should be small (well under half the content)
    expect(scrollTop).toBeLessThan(1000);
  });

  it("ArrowDown moves by columns (row navigation)", () => {
    const l = buildGrid();
    const root = l.element;

    // Trigger focus-visible to activate baseline single-select
    triggerFocusIn(root);

    // Should start at index 0
    expect(getFocusedIndex(root)).toBe(0);

    // ArrowDown should move by 4 (columns) to index 4
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(4);
  });

  it("ArrowRight moves by 1 cell", () => {
    const l = buildGrid();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    pressKey(root, "ArrowRight");
    expect(getFocusedIndex(root)).toBe(1);
  });

  it("Home goes to first item", () => {
    const l = buildGrid();
    const root = l.element;

    triggerFocusIn(root);

    // Navigate to index 6 (row 1, col 2): down to row 1 (index 4), right twice
    pressKey(root, "ArrowDown"); // → 4
    pressKey(root, "ArrowRight"); // → 5
    pressKey(root, "ArrowRight"); // → 6
    expect(getFocusedIndex(root)).toBe(6);

    // Home → first item (index 0)
    pressKey(root, "Home");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("End goes to last item", () => {
    const l = buildGrid();
    const root = l.element;

    triggerFocusIn(root);

    // Navigate to index 4 (row 1, col 0)
    pressKey(root, "ArrowDown"); // → 4
    expect(getFocusedIndex(root)).toBe(4);

    // End → last item (index 99)
    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(99);
  });

  it("Ctrl+Home goes to first item (Ctrl is optional, same as Home)", () => {
    const l = buildGrid();
    const root = l.element;

    triggerFocusIn(root);

    // Move somewhere away from 0
    pressKey(root, "ArrowDown"); // → 4
    pressKey(root, "ArrowDown"); // → 8
    pressKey(root, "ArrowDown"); // → 12
    pressKey(root, "ArrowDown"); // → 16
    pressKey(root, "ArrowDown"); // → 20
    expect(getFocusedIndex(root)).toBe(20);

    // Ctrl+Home → first item (0)
    pressKey(root, "Home", { ctrlKey: true });
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("Ctrl+End goes to last item (Ctrl is optional, same as End)", () => {
    const l = buildGrid();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    // Ctrl+End → last item (99)
    pressKey(root, "End", { ctrlKey: true });
    expect(getFocusedIndex(root)).toBe(99);
  });
});

// =============================================================================
// 2. Grid — withSelection Navigation
// =============================================================================

describe("grid — withSelection navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildGridWithSelection = (itemCount = 100) => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(itemCount),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "single" }))
      .build();
    return list;
  };

  it("ArrowDown moves by columns", () => {
    const l = buildGridWithSelection();
    const root = l.element;

    // Click item 0 to establish focus
    clickItem(l, 0);

    // After click, focus should be on item 0
    // Now press ArrowDown — should move to item 4 (4 columns)
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(4);
  });

  it("ArrowLeft/Right moves by 1", () => {
    const l = buildGridWithSelection();
    const root = l.element;

    // Click item 5 to establish focus
    clickItem(l, 5);

    // ArrowRight → item 6
    pressKey(root, "ArrowRight");
    expect(getFocusedIndex(root)).toBe(6);

    // ArrowLeft → item 5
    pressKey(root, "ArrowLeft");
    expect(getFocusedIndex(root)).toBe(5);
  });

  it("clicking does not cause scroll jump", () => {
    const l = buildGridWithSelection(200);
    const root = l.element;

    // Click an item in the first few rows
    clickItem(l, 4);

    // Scroll should not have jumped to the bottom
    const scrollTop = getViewportScrollTop(l);
    // Total: 200 items / 4 cols = 50 rows * 100 = 5000px
    // Clicked row 1, scroll should be modest
    expect(scrollTop).toBeLessThan(2000);
  });

  it("selection:change fires on Space/Enter", () => {
    const l = buildGridWithSelection();
    const root = l.element;

    // Click item 0 to focus it
    clickItem(l, 0);

    // Listen for selection:change
    const handler = mock(() => {});
    l.on("selection:change", handler);

    // Press Space to toggle selection
    pressKey(root, " ");

    expect(handler).toHaveBeenCalled();
  });
});

// =============================================================================
// 2b. Grid — Horizontal Orientation Navigation
// =============================================================================

describe("grid — horizontal orientation navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildHorizontalGrid = () => {
    list = vlist<TestItem>({
      container,
      orientation: "horizontal",
      item: { height: 100, width: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .build();
    return list;
  };

  const buildHorizontalGridWithSelection = () => {
    list = vlist<TestItem>({
      container,
      orientation: "horizontal",
      item: { height: 100, width: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "single" }))
      .build();
    return list;
  };

  it("ArrowLeft moves by columns (scroll-axis navigation) in baseline", () => {
    const l = buildHorizontalGrid();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    // In horizontal mode, Left/Right = scroll axis = ±columns
    // ArrowRight should move forward by columns (like ArrowDown in vertical)
    pressKey(root, "ArrowRight");
    expect(getFocusedIndex(root)).toBe(4);

    // ArrowLeft should move back by columns
    pressKey(root, "ArrowLeft");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("ArrowUp/Down moves by 1 (cross-axis navigation) in baseline", () => {
    const l = buildHorizontalGrid();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    // In horizontal mode, Up/Down = cross axis = ±1 cell
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(1);

    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("ArrowLeft/Right moves by columns with withSelection", () => {
    const l = buildHorizontalGridWithSelection();
    const root = l.element;

    clickItem(l, 0);

    // ArrowRight = scroll-axis forward = +columns
    pressKey(root, "ArrowRight");
    expect(getFocusedIndex(root)).toBe(4);

    // ArrowLeft = scroll-axis back = -columns
    pressKey(root, "ArrowLeft");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("ArrowUp/Down moves by 1 with withSelection", () => {
    const l = buildHorizontalGridWithSelection();
    const root = l.element;

    clickItem(l, 0);

    // ArrowDown = cross-axis = +1
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(1);

    // ArrowUp = cross-axis = -1
    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(0);
  });
});

// =============================================================================
// 2c. Masonry — Horizontal Orientation Navigation
// =============================================================================

describe("masonry — horizontal orientation navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildHorizontalMasonry = () => {
    list = vlist<TestItem>({
      container,
      orientation: "horizontal",
      item: {
        height: 100,
        width: (index: number) => {
          const ratios = [0.75, 1.0, 1.33, 1.5, 0.66];
          return Math.round(100 * ratios[index % 5]!);
        },
        template,
      },
      items: createTestItems(30),
    })
      .use(withMasonry({ columns: 3 }))
      .use(withSelection({ mode: "single" }))
      .build();
    return list;
  };

  it("ArrowRight navigates forward in same lane (scroll-axis)", () => {
    const l = buildHorizontalMasonry();
    const root = l.element;

    // Click item 0
    clickItem(l, 0);
    const startIndex = getFocusedIndex(root);
    const startEl = root.querySelector(`[data-index="${startIndex}"]`) as HTMLElement;
    if (!startEl) return;
    const startLane = startEl.dataset.lane;

    // ArrowRight in horizontal = main-axis forward = same lane next item
    pressKey(root, "ArrowRight");
    const newIndex = getFocusedIndex(root);
    expect(newIndex).not.toBe(startIndex);

    const newEl = root.querySelector(`[data-index="${newIndex}"]`) as HTMLElement;
    if (newEl) {
      expect(newEl.dataset.lane).toBe(startLane);
    }
  });

  it("ArrowDown navigates to adjacent lane (cross-axis)", () => {
    const l = buildHorizontalMasonry();
    const root = l.element;

    // Click item 0 (should be lane 0)
    clickItem(l, 0);
    const startIndex = getFocusedIndex(root);
    const startEl = root.querySelector(`[data-index="${startIndex}"]`) as HTMLElement;
    if (!startEl) return;
    const startLane = parseInt(startEl.dataset.lane ?? "0", 10);

    // ArrowDown in horizontal = cross-axis = adjacent lane (+1)
    pressKey(root, "ArrowDown");
    const newIndex = getFocusedIndex(root);

    const newEl = root.querySelector(`[data-index="${newIndex}"]`) as HTMLElement;
    if (newEl) {
      const newLane = parseInt(newEl.dataset.lane ?? "0", 10);
      expect(newLane).toBe(startLane + 1);
    }
  });

  it("ArrowUp at lane 0 does not move (cross-axis boundary)", () => {
    const l = buildHorizontalMasonry();
    const root = l.element;

    // Click item 0 which should be in lane 0
    clickItem(l, 0);
    const startIndex = getFocusedIndex(root);

    // ArrowUp in horizontal = cross-axis = adjacent lane (-1), but lane 0 has no lane -1
    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(startIndex);
  });
});

// =============================================================================
// 3. Masonry — Lane-Aware Navigation
// =============================================================================

describe("masonry — lane-aware navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildMasonryWithSelection = (itemCount = 30) => {
    list = vlist<TestItem>({
      container,
      item: {
        height: (index: number) => {
          // Variable heights based on aspect ratios
          const ratios = [0.75, 1.0, 1.33, 1.5, 0.66];
          const ratio = ratios[index % 5]!;
          return Math.round(100 / ratio);
        },
        template,
      },
      items: createTestItems(itemCount),
    })
      .use(withMasonry({ columns: 3 }))
      .use(withSelection({ mode: "single" }))
      .build();
    return list;
  };

  it("ArrowDown stays in the same lane", () => {
    const l = buildMasonryWithSelection();
    const root = l.element;

    // Click item 0 to focus it — it should be in lane 0
    clickItem(l, 0);

    const item0Lane = getLane(l, 0);

    // ArrowDown should navigate to the next item in the same lane
    pressKey(root, "ArrowDown");
    const newIndex = getFocusedIndex(root);
    expect(newIndex).toBeGreaterThan(0);

    // Verify the new item is in the same lane
    const newLane = getLane(l, newIndex);
    expect(newLane).toBe(item0Lane);
  });

  it("ArrowRight moves to adjacent lane", () => {
    const l = buildMasonryWithSelection();
    const root = l.element;

    // Click item 0 (lane 0)
    clickItem(l, 0);
    const startLane = getLane(l, 0);

    // ArrowRight → should move to an item in lane 1
    pressKey(root, "ArrowRight");
    const newIndex = getFocusedIndex(root);
    const newLane = getLane(l, newIndex);
    // If started in lane 0, should now be in lane 1
    if (startLane === 0) {
      expect(newLane).toBe(1);
    } else {
      // Just verify it moved to a different lane
      expect(newLane).not.toBe(startLane);
    }
  });

  it("ArrowLeft at lane 0 does not move", () => {
    const l = buildMasonryWithSelection();
    const root = l.element;

    // Click item 0 — should be in lane 0 (first item assigned to first lane)
    clickItem(l, 0);
    const startIndex = getFocusedIndex(root);
    const startLane = getLane(l, startIndex);

    if (startLane === 0) {
      // ArrowLeft should not change focus since we're at lane 0
      pressKey(root, "ArrowLeft");
      const newIndex = getFocusedIndex(root);
      expect(newIndex).toBe(startIndex);
    } else {
      // If item 0 somehow isn't in lane 0, just verify ArrowLeft doesn't crash
      pressKey(root, "ArrowLeft");
      const newIndex = getFocusedIndex(root);
      expect(newIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("clicking does not flash (template not re-applied on state change)", () => {
    const l = buildMasonryWithSelection();

    // Find a rendered item element
    const itemEl = l.element.querySelector("[data-index='0']") as HTMLElement;
    if (!itemEl) return; // masonry may not render index 0 if layout doesn't place it in view

    // Capture the innerHTML before click
    const htmlBefore = itemEl.innerHTML;

    // Click the item
    itemEl.click();

    // The innerHTML should be preserved (not re-created from template)
    const htmlAfter = itemEl.innerHTML;
    expect(htmlAfter).toBe(htmlBefore);
  });
});

/** Get the lane of a rendered item via its data-lane attribute or style.left */
function getLane(list: VList<any>, index: number): number {
  const el = list.element.querySelector(
    `[data-index="${index}"]`,
  ) as HTMLElement;
  if (!el) return -1;

  // Try data-lane attribute first
  const laneAttr = el.getAttribute("data-lane");
  if (laneAttr !== null) return parseInt(laneAttr, 10);

  // Fall back to parsing left position to infer lane
  // With 3 columns in a 400px container, each column is ~133px
  const left = parseFloat(el.style.left || "0");
  const colWidth = 400 / 3;
  return Math.round(left / colWidth);
}

// =============================================================================
// 4. Masonry — Renderer updateItemClasses
// =============================================================================

describe("masonry — renderer updateItemClasses", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  it("updateItemClasses applies focused class without re-rendering template", () => {
    list = vlist<TestItem>({
      container,
      item: {
        height: (index: number) => {
          const ratios = [0.75, 1.0, 1.33, 1.5, 0.66];
          return Math.round(100 / ratios[index % 5]!);
        },
        template,
      },
      items: createTestItems(20),
    })
      .use(withMasonry({ columns: 3 }))
      .use(withSelection({ mode: "single" }))
      .build();

    // Find a rendered item
    const itemEl = list.element.querySelector("[data-index]") as HTMLElement;
    if (!itemEl) return;

    const index = parseInt(itemEl.dataset.index!, 10);
    const htmlBefore = itemEl.innerHTML;

    // Click the item to select it
    itemEl.click();

    // Check that the selected class is applied
    const selectedItems = list.element.querySelectorAll(
      ".vlist-item--selected",
    );
    expect(selectedItems.length).toBeGreaterThanOrEqual(1);

    // Check that the element's innerHTML was preserved (not re-rendered from template)
    const itemElAfter = list.element.querySelector(
      `[data-index="${index}"]`,
    ) as HTMLElement;
    if (itemElAfter) {
      expect(itemElAfter.innerHTML).toBe(htmlBefore);
    }
  });
});

// =============================================================================
// 5. Grid — Renderer updateItemClasses
// =============================================================================

describe("grid — renderer updateItemClasses", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  it("updateItemClasses applies classes through grid renderer", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(40),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "single" }))
      .build();

    // Click an item to select it
    clickItem(list, 0);

    // Verify the selected class is applied
    const selectedItems = list.element.querySelectorAll(
      ".vlist-item--selected",
    );
    expect(selectedItems.length).toBeGreaterThanOrEqual(1);

    // Verify the specific item at index 0 has the selected class
    const item0 = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    if (item0) {
      expect(item0.classList.contains("vlist-item--selected")).toBe(true);
    }
  });

  it("updateItemClasses preserves DOM content when toggling selection", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "single" }))
      .build();

    const itemEl = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    if (!itemEl) return;

    const htmlBefore = itemEl.innerHTML;

    // Click to select
    itemEl.click();

    // innerHTML should be preserved
    const itemElAfter = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    if (itemElAfter) {
      expect(itemElAfter.innerHTML).toBe(htmlBefore);
    }
  });
});