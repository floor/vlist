/**
 * vlist/scale — Keyboard navigation integration tests
 *
 * Verifies that Home/End/ArrowDown/ArrowUp/PageDown/PageUp work correctly
 * when the scale feature is active (compressed scroll mode).
 *
 * The baseline a11y uses scrollToFocusSimple which operates in uncompressed
 * space. The scale feature registers _scrollItemIntoView to override this
 * with compression-aware scrollToFocus. These tests ensure that override
 * works and that focus navigation doesn't break the scroll state.
 *
 * Covers:
 * - Baseline a11y + withScale (no withSelection)
 * - withSelection + withScale
 * - Home/End navigate to first/last item without corrupting scroll state
 * - ArrowDown/ArrowUp move focus one item at a time
 * - PageDown/PageUp jump by a page of items
 * - Scroll position stays within compressed bounds after navigation
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";

import { vlist } from "../../src/builder/core";
import type { VList } from "../../src/builder/types";
import type { VListItem } from "../../src/types";
import { withScale } from "../../src/features/scale/feature";
import { withSelection } from "../../src/features/selection/feature";
import { withScrollbar } from "../../src/features/scrollbar/feature";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: typeof globalThis.document;
let originalWindow: typeof globalThis.window;
let originalRAF: typeof globalThis.requestAnimationFrame;
let originalCAF: typeof globalThis.cancelAnimationFrame;

const CONTAINER_HEIGHT = 500;
const CONTAINER_WIDTH = 300;
const ITEM_HEIGHT = 40;

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
    observe(_target: Element): void {
      this.callback(
        [
          {
            target: _target,
            contentRect: {
              width: CONTAINER_WIDTH,
              height: CONTAINER_HEIGHT,
              top: 0,
              left: 0,
              bottom: CONTAINER_HEIGHT,
              right: CONTAINER_WIDTH,
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
    unobserve(_target: Element): void {}
    disconnect(): void {}
  };

  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
    ): void {
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
  ): void => {};
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const template = (item: TestItem) => `<span>${item.name}</span>`;

/** Generate N items with sequential IDs */
const createItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: CONTAINER_HEIGHT });
  Object.defineProperty(container, "clientWidth", { value: CONTAINER_WIDTH });
  document.body.appendChild(container);
  return container;
};

/** Dispatch a keydown event on an element */
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

/** Extract the focused item index from aria-activedescendant */
const getFocusedIndex = (root: HTMLElement): number => {
  const attr = root.getAttribute("aria-activedescendant");
  if (!attr) return -1;
  const match = attr.match(/item-(\d+)$/);
  return match ? parseInt(match[1], 10) : -1;
};

/**
 * Trigger focusin on the root element, mocking :focus-visible.
 * The baseline a11y's onFocusIn checks root.matches(":focus-visible").
 */
const triggerFocusIn = (root: HTMLElement) => {
  const origMatches = root.matches;
  root.matches = (selector: string) =>
    selector === ":focus-visible" ? true : origMatches.call(root, selector);
  root.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
};

/**
 * Get the virtual scroll position from the list.
 * In compressed mode this is the virtualScrollPosition, not native scrollTop.
 */
const getScrollPosition = (list: VList<TestItem>): number =>
  list.getScrollPosition();

/**
 * Compute the maximum valid scroll position for compressed mode.
 * totalHeight = items * itemHeight; if > 16.7M, compression is active.
 * virtualSize ≈ 16_777_216 (browser max), maxScroll = virtualSize - containerHeight.
 */
const BROWSER_MAX_HEIGHT = 16_777_216;

// =============================================================================
// 1. Baseline a11y + withScale (no withSelection)
// =============================================================================

describe("scale + baseline a11y — keyboard navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  // 1M items × 40px = 40M → compressed at ~2.4× ratio
  const ITEM_COUNT = 1_000_000;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildList = () => {
    list = vlist<TestItem>({
      container,
      item: { height: ITEM_HEIGHT, template },
      items: createItems(ITEM_COUNT),
    })
      .use(withScale())
      .use(withScrollbar({ autoHide: true }))
      .build();
    return list!;
  };

  it("focusIn sets initial focus to item 0", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("ArrowDown moves focus from 0 to 1", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(1);
  });

  it("ArrowDown then ArrowUp returns to original position", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(3);

    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(2);

    pressKey(root, "ArrowUp");
    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("ArrowUp at item 0 does not go negative", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("Home navigates to first item", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    // Move down a few items first
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(3);

    pressKey(root, "Home");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("End navigates to last item without corrupting scroll state", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);

    // Scroll position must be within the compressed virtual size.
    // With 1M items × 40px = 40M total, compressed to ~16.7M.
    // maxScroll ≈ 16.7M - 500 (container height).
    const scrollPos = getScrollPosition(l);
    expect(scrollPos).toBeGreaterThan(0);
    expect(scrollPos).toBeLessThanOrEqual(BROWSER_MAX_HEIGHT);
  });

  it("End then Home round-trips correctly", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);

    pressKey(root, "Home");
    expect(getFocusedIndex(root)).toBe(0);

    const scrollPos = getScrollPosition(l);
    expect(scrollPos).toBe(0);
  });

  it("PageDown advances focus by approximately one page of items", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);

    pressKey(root, "PageDown");
    const focused = getFocusedIndex(root);

    // One page ≈ containerHeight / itemHeight = 500 / 40 = 12 items
    expect(focused).toBeGreaterThanOrEqual(10);
    expect(focused).toBeLessThanOrEqual(15);
  });

  it("PageUp from partway down moves focus back by a page", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    // Move down two pages
    pressKey(root, "PageDown");
    pressKey(root, "PageDown");
    const afterTwoPages = getFocusedIndex(root);
    expect(afterTwoPages).toBeGreaterThan(15);

    // Move up one page
    pressKey(root, "PageUp");
    const afterPageUp = getFocusedIndex(root);
    expect(afterPageUp).toBeLessThan(afterTwoPages);
    expect(afterPageUp).toBeGreaterThanOrEqual(0);
  });

  it("sequential ArrowDown keeps scroll position within compressed bounds", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    // Press ArrowDown many times — past the initial viewport
    for (let i = 0; i < 30; i++) {
      pressKey(root, "ArrowDown");
    }

    expect(getFocusedIndex(root)).toBe(30);

    const scrollPos = getScrollPosition(l);
    // Must be a reasonable compressed-space value, not an uncompressed offset
    // Item 30 at 40px each = 1200px uncompressed, well within viewport limits
    expect(scrollPos).toBeGreaterThanOrEqual(0);
    expect(scrollPos).toBeLessThanOrEqual(BROWSER_MAX_HEIGHT);
  });
});

// =============================================================================
// 2. withSelection + withScale
// =============================================================================

describe("scale + withSelection — keyboard navigation", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  const ITEM_COUNT = 1_000_000;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildList = () => {
    list = vlist<TestItem>({
      container,
      item: { height: ITEM_HEIGHT, template },
      items: createItems(ITEM_COUNT),
    })
      .use(withScale())
      .use(withSelection({ mode: "single" }))
      .use(withScrollbar({ autoHide: true }))
      .build();
    return list!;
  };

  it("focusIn sets initial focus to item 0", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("ArrowDown moves focus from 0 to 1", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(1);
  });

  it("ArrowUp at item 0 does not go negative", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("End navigates to last item without corrupting scroll state", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);

    const scrollPos = getScrollPosition(l);
    expect(scrollPos).toBeGreaterThan(0);
    expect(scrollPos).toBeLessThanOrEqual(BROWSER_MAX_HEIGHT);
  });

  it("Home navigates to first item", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(3);

    pressKey(root, "Home");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("End then Home round-trips correctly", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);

    pressKey(root, "Home");
    expect(getFocusedIndex(root)).toBe(0);

    const scrollPos = getScrollPosition(l);
    expect(scrollPos).toBe(0);
  });

  it("PageDown advances focus by approximately one page", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "PageDown");
    const focused = getFocusedIndex(root);

    // One page ≈ 500 / 40 = 12 items
    expect(focused).toBeGreaterThanOrEqual(10);
    expect(focused).toBeLessThanOrEqual(15);
  });

  it("PageUp moves focus back toward the beginning", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "PageDown");
    pressKey(root, "PageDown");
    const afterTwoPages = getFocusedIndex(root);

    pressKey(root, "PageUp");
    const afterPageUp = getFocusedIndex(root);
    expect(afterPageUp).toBeLessThan(afterTwoPages);
    expect(afterPageUp).toBeGreaterThanOrEqual(0);
  });

  it("Space/Enter selects the focused item after End", () => {
    const l = buildList();
    const root = l.element;

    let lastEvent: any = null;
    l.on("selection:change", (e: any) => { lastEvent = e; });

    triggerFocusIn(root);

    // Navigate to last item and select
    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);

    pressKey(root, "Enter");
    expect(lastEvent).not.toBeNull();
    expect(lastEvent.selected.length).toBe(1);
  });

  it("sequential ArrowDown keeps scroll within compressed bounds", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    for (let i = 0; i < 30; i++) {
      pressKey(root, "ArrowDown");
    }

    expect(getFocusedIndex(root)).toBe(30);

    const scrollPos = getScrollPosition(l);
    expect(scrollPos).toBeGreaterThanOrEqual(0);
    expect(scrollPos).toBeLessThanOrEqual(BROWSER_MAX_HEIGHT);
  });
});

// =============================================================================
// 3. Scale + smaller dataset (non-compressed) — regression guard
// =============================================================================

describe("scale feature with small dataset — keyboard nav unchanged", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  // 100 items × 40px = 4000px — well under 16.7M, no compression
  const ITEM_COUNT = 100;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    list?.destroy();
    list = null;
    container.remove();
  });

  const buildList = () => {
    list = vlist<TestItem>({
      container,
      item: { height: ITEM_HEIGHT, template },
      items: createItems(ITEM_COUNT),
    })
      .use(withScale())
      .build();
    return list!;
  };

  it("Home goes to item 0", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");

    pressKey(root, "Home");
    expect(getFocusedIndex(root)).toBe(0);
  });

  it("End goes to last item", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);
    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);
  });

  it("ArrowDown/ArrowUp navigate normally", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "ArrowDown");
    pressKey(root, "ArrowDown");
    expect(getFocusedIndex(root)).toBe(2);

    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(1);
  });

  it("End then ArrowUp focuses second-to-last item", () => {
    const l = buildList();
    const root = l.element;

    triggerFocusIn(root);

    pressKey(root, "End");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 1);

    pressKey(root, "ArrowUp");
    expect(getFocusedIndex(root)).toBe(ITEM_COUNT - 2);
  });
});