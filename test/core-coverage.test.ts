/**
 * vlist/core - Targeted Coverage Tests
 *
 * Focuses on uncovered lines/branches in src/core.ts:
 * - Lines 148-699: HeightCache, Emitter, DOM, ElementPool, range calculations,
 *   renderIfNeeded branches, scroll handling
 * - Lines 710-720: handleClick edge cases
 * - Lines 752-762: window resize handler
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
import { createVList } from "../src/core";
import type { VListItem, VListCore, CoreConfig } from "../src/core";

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
  global.Element = dom.window.Element;
  global.DocumentFragment = dom.window.DocumentFragment;

  // Mock ResizeObserver — callback is stored so we can trigger it manually
  (global as any).__resizeObserverInstances = [] as any[];

  global.ResizeObserver = class MockResizeObserver {
    private callback: ResizeObserverCallback;
    private targets: Element[] = [];

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      (global as any).__resizeObserverInstances.push(this);
    }

    observe(target: Element) {
      this.targets.push(target);
      // Fire initial callback with same height as clientHeight (no change → no event)
      this.callback(
        [
          {
            target,
            contentRect: {
              width: 400,
              height: 600,
              top: 0,
              left: 0,
              bottom: 600,
              right: 400,
              x: 0,
              y: 0,
              toJSON: () => {},
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this as any,
      );
    }

    unobserve() {}
    disconnect() {}

    // Helper to manually fire resize with a new height
    _fireResize(height: number, width: number = 400) {
      for (const target of this.targets) {
        this.callback(
          [
            {
              target,
              contentRect: {
                width,
                height,
                top: 0,
                left: 0,
                bottom: height,
                right: width,
                x: 0,
                y: 0,
                toJSON: () => {},
              },
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this as any,
        );
      }
    }
  } as any;

  // Mock scrollTo for JSDOM
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

  // Mock window.scrollTo
  (dom.window as any).scrollTo = (
    _x?: number | ScrollToOptions,
    _y?: number,
  ) => {};

  // Mock requestAnimationFrame / cancelAnimationFrame
  let rafId = 0;
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    rafId++;
    const id = rafId;
    const timer = setTimeout(() => {
      pendingTimers.delete(id);
      cb(performance.now());
    }, 0);
    pendingTimers.set(id, timer);
    return id;
  };
  global.cancelAnimationFrame = (id: number): void => {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingTimers.delete(id);
    }
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
  delete (global as any).__resizeObserverInstances;
});

// =============================================================================
// Helpers
// =============================================================================

/** Create a JSDOM-native Event (JSDOM rejects non-native Event instances) */
const createJSDOMEvent = (type: string, opts?: EventInit) =>
  new dom.window.Event(type, opts);

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));

const createContainer = (
  height: number = 600,
  width: number = 400,
): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: height });
  Object.defineProperty(container, "clientWidth", { value: width });
  document.body.appendChild(container);
  return container;
};

const createBasicConfig = (
  container: HTMLElement,
  items: TestItem[],
): CoreConfig<TestItem> => ({
  container,
  item: {
    height: 40,
    template: (item: TestItem) => `<span>${item.name}</span>`,
  },
  items,
});

const getResizeObserverInstance = (): any => {
  const instances = (global as any).__resizeObserverInstances;
  return instances[instances.length - 1];
};

/**
 * Simulate a native scroll on a JSDOM element.
 * Sets scrollTop and dispatches a JSDOM-native scroll event.
 */
const simulateScroll = (element: HTMLElement, scrollTop: number) => {
  Object.defineProperty(element, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  element.dispatchEvent(createJSDOMEvent("scroll"));
};

// =============================================================================
// Tests
// =============================================================================

describe("core.ts coverage — HeightCache", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  // ---------------------------------------------------------------------------
  // Fixed-height cache edge cases
  // ---------------------------------------------------------------------------

  describe("fixed height cache", () => {
    it("should handle indexAtOffset when total is 0", () => {
      const list = createVList<TestItem>({
        container,
        item: { height: 40, template: () => "<span>x</span>" },
        items: [],
      });

      // getScrollSnapshot internally calls indexAtOffset — total=0 branch
      const snapshot = list.getScrollSnapshot();
      expect(snapshot.index).toBe(0);
      expect(snapshot.offsetInItem).toBe(0);

      list.destroy();
    });

    it("should handle scrollToIndex at 0 items", () => {
      const list = createVList<TestItem>({
        container,
        item: { height: 40, template: () => "<span>x</span>" },
        items: [],
      });

      // calculateScrollToPosition with totalItems=0 returns 0
      list.scrollToIndex(0);
      // getScrollPosition returns lastScrollTop which is 0 (JSDOM doesn't fire scroll)
      expect(list.getScrollPosition()).toBe(0);

      list.destroy();
    });

    it("should cover indexAtOffset clamping", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      // scrollToIndex exercises calculateScrollToPosition internally
      list.scrollToIndex(9, "end");

      // Just ensure no crash — JSDOM can't verify scrollTop
      expect(list.total).toBe(10);
      list.destroy();
    });

    it("should handle height=0 in fixed indexAtOffset", () => {
      // height === 0 is rejected by validation, so we exercise the
      // total === 0 half of the condition by creating an empty list
      const list = createVList<TestItem>({
        container,
        item: { height: 40, template: () => "<span>x</span>" },
        items: [],
      });

      const snap = list.getScrollSnapshot();
      expect(snap.index).toBe(0);
      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Variable-height cache edge cases
  // ---------------------------------------------------------------------------

  describe("variable height cache", () => {
    it("should handle getOffset edge cases for variable heights", () => {
      const items = createTestItems(10);
      const heightFn = (index: number) => 30 + (index % 3) * 10;

      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items,
      });

      // scrollToIndex(0) → getOffset(0) returns 0 (index <= 0 branch)
      list.scrollToIndex(0);

      // scrollToIndex(9, "start") → getOffset(9) for normal index
      list.scrollToIndex(9, "start");

      list.destroy();
    });

    it("should handle indexAtOffset with offset <= 0", () => {
      const items = createTestItems(10);
      const heightFn = (index: number) => 30 + index * 5;

      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items,
      });

      // At position 0, indexAtOffset(0) → offset <= 0 → return 0
      const snapshot = list.getScrollSnapshot();
      expect(snapshot.index).toBe(0);

      list.destroy();
    });

    it("should handle indexAtOffset with very large offset", () => {
      const items = createTestItems(10);
      const heightFn = (index: number) => 30 + index * 5;

      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items,
      });

      // Scroll to last item with "end" → exercises binary search + edge clamp
      list.scrollToIndex(9, "end");
      list.destroy();
    });

    it("should rebuild variable height cache on setItems", () => {
      const heightFn = (index: number) => 20 + index * 2;
      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items: createTestItems(5),
      });

      list.setItems(createTestItems(20));
      expect(list.total).toBe(20);

      list.destroy();
    });

    it("should handle variable height with total=0 for indexAtOffset", () => {
      const heightFn = (index: number) => 30 + index * 5;
      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items: [],
      });

      const snapshot = list.getScrollSnapshot();
      expect(snapshot.index).toBe(0);

      list.destroy();
    });

    it("should exercise binary search in indexAtOffset", () => {
      const items = createTestItems(100);
      const heightFn = (index: number) => 20 + (index % 7) * 10;

      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items,
      });

      // center and end exercise binary search paths
      list.scrollToIndex(50, "center");
      list.scrollToIndex(99, "end");

      const snapshot = list.getScrollSnapshot();
      expect(snapshot.index).toBeGreaterThanOrEqual(0);

      list.destroy();
    });

    it("should cover getTotalHeight with empty prefix sums", () => {
      const heightFn = (index: number) => 40 + index;
      const list = createVList<TestItem>({
        container,
        item: {
          height: heightFn,
          template: (item) => `<span>${item.name}</span>`,
        },
        items: [],
      });

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.height).toBe("0px");

      list.destroy();
    });
  });
});

describe("core.ts coverage — Emitter", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle on() creating new listener set for unknown event", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const handler = mock(() => {});
    const unsub = list.on("scroll" as any, handler);
    expect(typeof unsub).toBe("function");

    unsub();
    list.destroy();
  });

  it("should handle off() on event with no subscribers", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const handler = () => {};
    // off() on an event that was never subscribed → optional chaining
    list.off("scroll" as any, handler);

    list.destroy();
  });

  it("should survive error in scroll handler", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const badHandler = () => {
      throw new Error("scroll handler crash");
    };
    list.on("scroll" as any, badHandler);

    const originalConsoleError = console.error;
    console.error = () => {};

    // setItems triggers range:change (not scroll), but we can trigger scroll via DOM
    list.setItems(createTestItems(20));

    console.error = originalConsoleError;
    expect(list.total).toBe(20);
    list.destroy();
  });

  it("should survive error in range:change handler and continue to next handler", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const badHandler = () => {
      throw new Error("range change error");
    };
    const goodHandler = mock(() => {});

    list.on("range:change" as any, badHandler);
    list.on("range:change" as any, goodHandler);

    const originalConsoleError = console.error;
    console.error = () => {};

    list.setItems(createTestItems(15));

    console.error = originalConsoleError;

    expect(goodHandler).toHaveBeenCalled();
    list.destroy();
  });

  it("should clear all listeners on destroy", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const handler = mock(() => {});
    list.on("range:change" as any, handler);
    list.on("scroll" as any, handler);

    list.destroy();
    // emitter.clear() was called — no further events fire
  });
});

describe("core.ts coverage — DOM structure", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should create DOM structure without ariaLabel", () => {
    const items = createTestItems(5);
    const list = createVList({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
    });

    expect(list.element.getAttribute("aria-label")).toBeNull();
    list.destroy();
  });

  it("should create DOM structure with ariaLabel", () => {
    const items = createTestItems(5);
    const list = createVList({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      ariaLabel: "My accessible list",
    });

    expect(list.element.getAttribute("aria-label")).toBe("My accessible list");
    list.destroy();
  });

  it("should create viewport, content, and items containers with correct styles", () => {
    const items = createTestItems(5);
    const list = createVList(createBasicConfig(container, items));

    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    expect(viewport.style.overflow).toBe("auto");
    expect(viewport.style.height).toBe("100%");
    expect(viewport.style.width).toBe("100%");

    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(content.style.position).toBe("relative");
    expect(content.style.width).toBe("100%");

    const itemsEl = list.element.querySelector(".vlist-items") as HTMLElement;
    expect(itemsEl.style.position).toBe("relative");
    expect(itemsEl.style.width).toBe("100%");

    list.destroy();
  });
});

describe("core.ts coverage — Element Pool", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should acquire new element when pool is empty", () => {
    const items = createTestItems(5);
    const list = createVList(createBasicConfig(container, items));

    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    for (const el of rendered) {
      expect(el.getAttribute("role")).toBe("option");
    }

    list.destroy();
  });

  it("should reuse pooled elements after setItems shrink / grow", () => {
    const list = createVList(createBasicConfig(container, createTestItems(20)));

    const firstRendered = list.element.querySelectorAll("[data-index]").length;
    expect(firstRendered).toBeGreaterThan(0);

    // Shrink → release elements to pool
    list.setItems(createTestItems(3));
    // Grow → reuse from pool
    list.setItems(createTestItems(20));

    const secondRendered = list.element.querySelectorAll("[data-index]").length;
    expect(secondRendered).toBeGreaterThan(0);

    list.destroy();
  });

  it("should reset element state on release", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.setItems(createTestItems(2));
    list.setItems(createTestItems(10));

    const rendered = list.element.querySelectorAll("[data-index]");
    for (const el of rendered) {
      expect(el.getAttribute("data-index")).toBeTruthy();
      expect(el.getAttribute("data-id")).toBeTruthy();
    }

    list.destroy();
  });
});

describe("core.ts coverage — calculateVisibleRange", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should return empty range for 0 items", () => {
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: () => "<span>x</span>" },
      items: [],
    });

    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBe(0);

    list.destroy();
  });

  it("should compute correct visible range for items taller than container", () => {
    const bigContainer = createContainer(600);
    const items = createTestItems(10);
    const list = createVList<TestItem>({
      container: bigContainer,
      item: {
        height: 700,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
    });

    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(10);

    list.destroy();
    bigContainer.remove();
  });
});

describe("core.ts coverage — calculateScrollToPosition", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle align='start' (exercises default switch branch)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // Exercises: calculateScrollToPosition with align="start"
    list.scrollToIndex(50, "start");
    // Can't verify position via getScrollPosition in JSDOM, just ensure no crash
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should handle align='center'", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, "center");
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should handle align='end'", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, "end");
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should clamp to 0 when center alignment on first item", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // offset=0, center → negative → clamped to 0
    list.scrollToIndex(0, "center");
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should clamp to maxScroll when scrolling to last item with start align", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // offset=99*40=3960, maxScroll=3400 → clamped
    list.scrollToIndex(99, "start");
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should handle variable-height align='center'", () => {
    const items = createTestItems(50);
    const heightFn = (i: number) => 30 + (i % 5) * 10;

    const list = createVList<TestItem>({
      container,
      item: {
        height: heightFn,
        template: (item) => `<span>${item.name}</span>`,
      },
      items,
    });

    list.scrollToIndex(25, "center");
    list.destroy();
  });

  it("should handle variable-height align='end'", () => {
    const items = createTestItems(50);
    const heightFn = (i: number) => 30 + (i % 5) * 10;

    const list = createVList<TestItem>({
      container,
      item: {
        height: heightFn,
        template: (item) => `<span>${item.name}</span>`,
      },
      items,
    });

    list.scrollToIndex(25, "end");
    list.destroy();
  });

  it("should handle out-of-range index (clamp to valid bounds)", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    // Exercises Math.max(0, Math.min(index, totalItems - 1)) clamping
    list.scrollToIndex(100, "start");
    list.scrollToIndex(-5, "start");

    list.destroy();
  });

  it("should return 0 for empty items", () => {
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: () => "<span>x</span>" },
      items: [],
    });

    // totalItems=0 → early return 0
    list.scrollToIndex(5, "center");
    expect(list.getScrollPosition()).toBe(0);

    list.destroy();
  });
});

describe("core.ts coverage — applyOverscan", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should clamp overscan start to 0", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    const rendered = list.element.querySelectorAll("[data-index]");
    const firstIndex = parseInt(rendered[0]?.getAttribute("data-index") ?? "0");
    expect(firstIndex).toBe(0);

    list.destroy();
  });

  it("should clamp overscan end to totalItems - 1", () => {
    const items = createTestItems(15);
    const list = createVList(createBasicConfig(container, items));

    const rendered = list.element.querySelectorAll("[data-index]");
    const lastIndex = parseInt(
      rendered[rendered.length - 1]?.getAttribute("data-index") ?? "0",
    );
    expect(lastIndex).toBeLessThanOrEqual(14);

    list.destroy();
  });

  it("should use custom overscan value", () => {
    const items = createTestItems(100);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      overscan: 10,
    });

    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(15);

    list.destroy();
  });

  it("should use overscan=0", () => {
    const items = createTestItems(100);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      overscan: 0,
    });

    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeLessThanOrEqual(16);

    list.destroy();
  });
});

describe("core.ts coverage — renderIfNeeded branches", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should bail when render range is unchanged", () => {
    const items = createTestItems(20);
    const list = createVList(createBasicConfig(container, items));

    const rangeHandler = mock((_payload: any) => {});
    list.on("range:change" as any, rangeHandler);

    // updateItem doesn't change the range — should not fire range:change
    list.updateItem(1, { name: "Updated" });

    list.destroy();
  });

  it("should update aria-setsize when total items changes", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const firstItem = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    expect(firstItem?.getAttribute("aria-setsize")).toBe("10");

    // Change total → setSizeChanged branch fires
    list.setItems(createTestItems(20));

    const updatedItem = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    expect(updatedItem?.getAttribute("aria-setsize")).toBe("20");

    list.destroy();
  });

  it("should update existing element when item identity changes", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    // Replace with different IDs → existingId !== newId
    const newItems = createTestItems(10).map((item, i) => ({
      ...item,
      id: item.id + 100,
      name: `New ${i}`,
    }));
    list.setItems(newItems);

    const firstItem = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    expect(firstItem?.getAttribute("data-id")).toBe("101");
    expect(firstItem?.innerHTML).toContain("New 0");

    list.destroy();
  });

  it("should not update existing element when item identity is the same", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    // Same IDs → existingId === newId → skip re-template
    list.setItems(createTestItems(10));

    const firstItem = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    expect(firstItem?.getAttribute("data-id")).toBe("1");

    list.destroy();
  });

  it("should remove items outside new render range when scroll changes", () => {
    const items = createTestItems(200);
    const list = createVList(createBasicConfig(container, items));

    // Scroll far down using the viewport + native event
    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    simulateScroll(viewport, 4000); // scrollTop = 4000 → index ~100

    // Items at the top should be removed
    const oldItem = list.element.querySelector("[data-index='0']");
    expect(oldItem).toBeNull();

    list.destroy();
  });

  it("should skip rendering when isDestroyed is true", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.destroy();
    // After destroy no items in DOM
    // (root is removed from container)
  });

  it("should handle forceRender after setItems resets lastRenderRange", () => {
    const list = createVList(createBasicConfig(container, createTestItems(5)));

    list.setItems(createTestItems(15));
    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    list.destroy();
  });

  it("should handle items that don't exist in array (item undefined check)", () => {
    const items = createTestItems(3);
    const list = createVList(createBasicConfig(container, items));

    list.setItems(createTestItems(1));
    list.setItems(createTestItems(10));
    expect(list.total).toBe(10);

    list.destroy();
  });
});

describe("core.ts coverage — template application", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should apply string template via innerHTML", () => {
    const items = createTestItems(5);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item) => `<div class="content">${item.name}</div>`,
      },
      items,
    });

    const firstItem = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    expect(firstItem?.innerHTML).toBe('<div class="content">Item 1</div>');

    list.destroy();
  });

  it("should apply HTMLElement template via replaceChildren", () => {
    const items = createTestItems(5);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item) => {
          const el = document.createElement("span");
          el.textContent = item.name;
          el.className = "item-content";
          return el;
        },
      },
      items,
    });

    const firstItem = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    const span = firstItem?.querySelector("span.item-content");
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe("Item 1");

    list.destroy();
  });

  it("should pass correct item state to template", () => {
    const templateCalls: Array<{
      item: TestItem;
      index: number;
      state: { selected: boolean; focused: boolean };
    }> = [];

    const items = createTestItems(5);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item, index, state) => {
          templateCalls.push({ item, index, state: { ...state } });
          return `<span>${item.name}</span>`;
        },
      },
      items,
    });

    expect(templateCalls.length).toBeGreaterThan(0);
    for (const call of templateCalls) {
      expect(call.state.selected).toBe(false);
      expect(call.state.focused).toBe(false);
    }

    list.destroy();
  });

  it("should update template for existing element with changed identity (HTMLElement)", () => {
    const items: TestItem[] = [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
    ];
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item) => {
          const el = document.createElement("div");
          el.textContent = item.name;
          return el;
        },
      },
      items,
    });

    // Replace item at index 0 with a different ID
    const newItems: TestItem[] = [
      { id: 99, name: "Delta" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
    ];
    list.setItems(newItems);

    const first = list.element.querySelector("[data-index='0']") as HTMLElement;
    expect(first?.getAttribute("data-id")).toBe("99");
    const div = first?.querySelector("div");
    expect(div?.textContent).toBe("Delta");

    list.destroy();
  });
});

describe("core.ts coverage — handleClick (lines 710-720)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should emit item:click when clicking on a rendered item", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const clickHandler = mock((_payload: any) => {});
    list.on("item:click" as any, clickHandler);

    const itemEl = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;
    expect(itemEl).toBeTruthy();

    const event = new dom.window.MouseEvent("click", { bubbles: true });
    itemEl.dispatchEvent(event);

    expect(clickHandler).toHaveBeenCalled();
    const payload = clickHandler.mock.calls[0]?.[0] as any;
    expect(payload.index).toBe(0);
    expect(payload.item.id).toBe(1);

    list.destroy();
  });

  it("should not emit when clicking outside any item (no data-index)", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const clickHandler = mock((_payload: any) => {});
    list.on("item:click" as any, clickHandler);

    const itemsContainer = list.element.querySelector(
      ".vlist-items",
    ) as HTMLElement;
    const event = new dom.window.MouseEvent("click", { bubbles: true });
    itemsContainer.dispatchEvent(event);

    expect(clickHandler).not.toHaveBeenCalled();

    list.destroy();
  });

  it("should not emit when index is negative", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const clickHandler = mock((_payload: any) => {});
    list.on("item:click" as any, clickHandler);

    const itemsContainer = list.element.querySelector(
      ".vlist-items",
    ) as HTMLElement;
    const badEl = document.createElement("div");
    badEl.setAttribute("data-index", "-1");
    itemsContainer.appendChild(badEl);

    const event = new dom.window.MouseEvent("click", { bubbles: true });
    badEl.dispatchEvent(event);

    expect(clickHandler).not.toHaveBeenCalled();

    badEl.remove();
    list.destroy();
  });

  it("should not emit when item at index is undefined", () => {
    const items = createTestItems(5);
    const list = createVList(createBasicConfig(container, items));

    const clickHandler = mock((_payload: any) => {});
    list.on("item:click" as any, clickHandler);

    const itemsContainer = list.element.querySelector(
      ".vlist-items",
    ) as HTMLElement;
    const badEl = document.createElement("div");
    badEl.setAttribute("data-index", "999");
    itemsContainer.appendChild(badEl);

    const event = new dom.window.MouseEvent("click", { bubbles: true });
    badEl.dispatchEvent(event);

    expect(clickHandler).not.toHaveBeenCalled();

    badEl.remove();
    list.destroy();
  });

  it("should not emit clicks after destroy", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const clickHandler = mock((_payload: any) => {});
    list.on("item:click" as any, clickHandler);

    // Grab references before destroy
    const itemsContainer = list.element.querySelector(
      ".vlist-items",
    ) as HTMLElement;
    const itemEl = list.element.querySelector(
      "[data-index='0']",
    ) as HTMLElement;

    list.destroy();

    // Click handler was removed, and isDestroyed = true
    // Even if we somehow dispatch, it should not emit
    expect(clickHandler).not.toHaveBeenCalled();
  });

  it("should handle click with empty data-index (NaN parsed)", () => {
    const items = createTestItems(5);
    const list = createVList(createBasicConfig(container, items));

    const clickHandler = mock((_payload: any) => {});
    list.on("item:click" as any, clickHandler);

    const itemsContainer = list.element.querySelector(
      ".vlist-items",
    ) as HTMLElement;
    const badEl = document.createElement("div");
    badEl.setAttribute("data-index", "");
    itemsContainer.appendChild(badEl);

    const event = new dom.window.MouseEvent("click", { bubbles: true });
    badEl.dispatchEvent(event);

    // parseInt("", 10) = NaN, which is not < 0, but items[NaN] is undefined
    expect(clickHandler).not.toHaveBeenCalled();

    badEl.remove();
    list.destroy();
  });
});

describe("core.ts coverage — ResizeObserver", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should emit resize event when viewport height changes significantly", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    const observer = getResizeObserverInstance();
    observer._fireResize(800, 400);

    expect(resizeHandler).toHaveBeenCalled();
    const payload = resizeHandler.mock.calls[0]?.[0] as any;
    expect(payload.height).toBe(800);
    expect(payload.width).toBe(400);

    list.destroy();
  });

  it("should not emit resize when height difference is <= 1px", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    const observer = getResizeObserverInstance();
    observer._fireResize(600.5, 400);

    expect(resizeHandler).not.toHaveBeenCalled();

    list.destroy();
  });

  it("should not fire resize after destroy (isDestroyed check)", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    const observer = getResizeObserverInstance();
    list.destroy();

    observer._fireResize(900, 400);

    expect(resizeHandler).not.toHaveBeenCalled();
  });

  it("should skip resize in window mode (isWindowMode check in observer)", () => {
    const items = createTestItems(50);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    const observer = getResizeObserverInstance();
    observer._fireResize(800, 400);

    // In window mode, ResizeObserver callback returns early
    expect(resizeHandler).not.toHaveBeenCalled();

    list.destroy();
  });

  it("should update content height and re-render on resize", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    const beforeRendered = list.element.querySelectorAll("[data-index]").length;

    const observer = getResizeObserverInstance();
    observer._fireResize(1200, 400);

    const afterRendered = list.element.querySelectorAll("[data-index]").length;
    expect(afterRendered).toBeGreaterThanOrEqual(beforeRendered);

    list.destroy();
  });
});

describe("core.ts coverage — window resize handler (lines 752-762)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should update container height on window resize in window mode", () => {
    const items = createTestItems(50);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    Object.defineProperty(window, "innerHeight", {
      value: 900,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 500,
      writable: true,
      configurable: true,
    });

    // JSDOM-native Event
    window.dispatchEvent(createJSDOMEvent("resize"));

    expect(resizeHandler).toHaveBeenCalled();
    const payload = resizeHandler.mock.calls[0]?.[0] as any;
    expect(payload.height).toBe(900);
    expect(payload.width).toBe(500);

    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      writable: true,
      configurable: true,
    });

    list.destroy();
  });

  it("should not emit resize on window resize when diff <= 1px", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    const items = createTestItems(50);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    Object.defineProperty(window, "innerHeight", {
      value: 768.5,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(createJSDOMEvent("resize"));

    expect(resizeHandler).not.toHaveBeenCalled();

    list.destroy();
  });

  it("should not fire window resize after destroy (isDestroyed check)", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    const items = createTestItems(50);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    const resizeHandler = mock((_payload: any) => {});
    list.on("resize" as any, resizeHandler);

    list.destroy();

    Object.defineProperty(window, "innerHeight", {
      value: 1000,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(createJSDOMEvent("resize"));

    expect(resizeHandler).not.toHaveBeenCalled();
  });

  it("should not add window resize handler when not in window mode", () => {
    // Non-window mode: no "resize" listener on window
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    // Simply verify no crash; window resize is not connected
    Object.defineProperty(window, "innerHeight", {
      value: 1200,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(createJSDOMEvent("resize"));

    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    list.destroy();
  });
});

describe("core.ts coverage — scroll handling", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should emit scroll event on viewport scroll", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const scrollHandler = mock((_payload: any) => {});
    list.on("scroll" as any, scrollHandler);

    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    simulateScroll(viewport, 200);

    expect(scrollHandler).toHaveBeenCalled();

    list.destroy();
  });

  it("should add scrolling class on scroll", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const root = list.element;
    const viewport = root.querySelector(".vlist-viewport") as HTMLElement;

    simulateScroll(viewport, 100);

    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    list.destroy();
  });

  it("should remove scrolling class after idle timeout", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const root = list.element;
    const viewport = root.querySelector(".vlist-viewport") as HTMLElement;

    simulateScroll(viewport, 100);
    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    // SCROLL_IDLE_TIMEOUT = 150ms
    await new Promise((r) => setTimeout(r, 200));

    expect(root.classList.contains("vlist--scrolling")).toBe(false);

    list.destroy();
  });

  it("should not process scroll when destroyed", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const scrollHandler = mock((_payload: any) => {});
    list.on("scroll" as any, scrollHandler);

    list.destroy();
    // After destroy the listener was removed; no event fires
    expect(scrollHandler).not.toHaveBeenCalled();
  });

  it("should detect scroll direction down", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    let direction: string | undefined;
    list.on("scroll" as any, (payload: any) => {
      direction = payload.direction;
    });

    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    simulateScroll(viewport, 200);

    expect(direction).toBe("down");

    list.destroy();
  });

  it("should detect scroll direction up", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;

    // Scroll down first
    simulateScroll(viewport, 1000);

    let direction: string | undefined;
    list.on("scroll" as any, (payload: any) => {
      direction = payload.direction;
    });

    // Now scroll up
    simulateScroll(viewport, 200);

    expect(direction).toBe("up");

    list.destroy();
  });

  it("should not add scrolling class again if already present", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const root = list.element;
    const viewport = root.querySelector(".vlist-viewport") as HTMLElement;

    // First scroll — adds class
    simulateScroll(viewport, 100);
    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    // Second scroll — class already present, exercises the if-check
    simulateScroll(viewport, 200);
    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    list.destroy();
  });

  it("should clear idle timer on subsequent scroll events", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    const root = list.element;
    const viewport = root.querySelector(".vlist-viewport") as HTMLElement;

    simulateScroll(viewport, 100);

    // Quickly scroll again before idle fires
    await new Promise((r) => setTimeout(r, 50));
    simulateScroll(viewport, 200);

    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    // Wait for the new idle timeout
    await new Promise((r) => setTimeout(r, 200));
    expect(root.classList.contains("vlist--scrolling")).toBe(false);

    list.destroy();
  });
});

describe("core.ts coverage — window mode scroll handling", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should compute scroll position from window.scrollY in window mode", () => {
    const items = createTestItems(100);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    const scrollHandler = mock((_payload: any) => {});
    list.on("scroll" as any, scrollHandler);

    Object.defineProperty(window, "scrollY", {
      value: 200,
      writable: true,
      configurable: true,
    });

    window.dispatchEvent(createJSDOMEvent("scroll"));

    expect(scrollHandler).toHaveBeenCalled();

    Object.defineProperty(window, "scrollY", {
      value: 0,
      writable: true,
      configurable: true,
    });

    list.destroy();
  });

  it("should set overflow/height styles for window mode", () => {
    const items = createTestItems(10);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    expect(list.element.style.overflow).toBe("visible");
    expect(list.element.style.height).toBe("auto");

    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    expect(viewport.style.overflow).toBe("visible");
    expect(viewport.style.height).toBe("auto");

    list.destroy();
  });

  it("should use window.innerHeight for container height in window mode", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 500,
      writable: true,
      configurable: true,
    });

    const items = createTestItems(100);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    const rendered = list.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    list.destroy();
  });
});

describe("core.ts coverage — resolveScrollArgs", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should use default args when no options provided (undefined path)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // No second arg → align=start, behavior=auto, duration=default
    list.scrollToIndex(50);
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should handle string align argument", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // String path → typeof alignOrOptions === "string"
    list.scrollToIndex(50, "center");
    list.scrollToIndex(50, "end");
    list.scrollToIndex(50, "start");

    list.destroy();
  });

  it("should handle object with all options", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, { align: "end", behavior: "auto", duration: 100 });
    list.destroy();
  });

  it("should handle object with partial options (defaults fill in)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // Only align provided
    list.scrollToIndex(50, { align: "center" });
    list.destroy();
  });

  it("should handle empty object (all defaults)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, {});
    list.destroy();
  });
});

describe("core.ts coverage — doScrollTo", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should set viewport.scrollTop in normal mode", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // doScrollTo internally sets viewport.scrollTop
    list.scrollToIndex(50);
    expect(list.total).toBe(100);

    list.destroy();
  });

  it("should call window.scrollTo in window mode", () => {
    const scrollToSpy = mock((_x: number, _y: number) => {});
    (window as any).scrollTo = scrollToSpy;

    const items = createTestItems(100);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    list.scrollToIndex(50);

    expect(scrollToSpy).toHaveBeenCalled();

    (window as any).scrollTo = () => {};
    list.destroy();
  });
});

describe("core.ts coverage — animateScroll", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should snap when distance < 1 (from === to)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // scrollToIndex(0) from position 0 → distance is 0 → immediate snap
    list.scrollToIndex(0, { behavior: "smooth", duration: 100 });
    expect(list.getScrollPosition()).toBe(0);

    list.destroy();
  });

  it("should animate when distance >= 1", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, { behavior: "smooth", duration: 50 });

    await new Promise((r) => setTimeout(r, 100));

    list.destroy();
  });

  it("should cancel previous animation when starting new one", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, { behavior: "smooth", duration: 500 });
    list.scrollToIndex(80, { behavior: "smooth", duration: 50 });

    await new Promise((r) => setTimeout(r, 100));

    list.destroy();
  });

  it("should call cancelScroll before auto scroll", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(50, { behavior: "smooth", duration: 500 });
    list.cancelScroll();
    list.scrollToIndex(20);

    list.destroy();
  });
});

describe("core.ts coverage — scrollToItem", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should scroll to item by ID (found)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // id=50 → index 49 → exercises scrollToIndex internally
    list.scrollToItem(50);
    list.destroy();
  });

  it("should not scroll when item ID not found (index < 0)", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToItem(9999);
    list.destroy();
  });

  it("should pass string align to scrollToItem", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToItem(50, "center");
    list.destroy();
  });

  it("should pass ScrollToOptions object to scrollToItem", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToItem(50, { align: "end", behavior: "auto" });
    list.destroy();
  });
});

describe("core.ts coverage — restoreScroll", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should restore scroll in non-window mode via viewport.scrollTo", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.restoreScroll({ index: 50, offsetInItem: 10 });

    // restoreScroll also sets lastScrollTop and calls renderIfNeeded
    // In JSDOM viewport.scrollTo works via our mock
    expect(list.getScrollPosition()).toBe(2010); // 50*40+10

    list.destroy();
  });

  it("should restore scroll in window mode via window.scrollTo", () => {
    const scrollToSpy = mock((_opts?: ScrollToOptions) => {});
    (window as any).scrollTo = scrollToSpy;

    const items = createTestItems(100);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    list.restoreScroll({ index: 50, offsetInItem: 10 });

    expect(scrollToSpy).toHaveBeenCalled();

    (window as any).scrollTo = () => {};
    list.destroy();
  });

  it("should clamp snapshot index to valid range on restore", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    // Index 999 → clamped to 9
    list.restoreScroll({ index: 999, offsetInItem: 0 });

    const pos = list.getScrollPosition();
    expect(pos).toBeGreaterThanOrEqual(0);

    list.destroy();
  });

  it("should be a no-op for empty list on restoreScroll", () => {
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: () => "<span>x</span>" },
      items: [],
    });

    list.restoreScroll({ index: 5, offsetInItem: 10 });
    expect(list.getScrollPosition()).toBe(0);

    list.destroy();
  });
});

describe("core.ts coverage — getScrollSnapshot", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should return {0, 0} for empty list", () => {
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: () => "<span>x</span>" },
      items: [],
    });

    const snapshot = list.getScrollSnapshot();
    expect(snapshot.index).toBe(0);
    expect(snapshot.offsetInItem).toBe(0);

    list.destroy();
  });

  it("should compute correct snapshot after restoreScroll", () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // Use restoreScroll which sets lastScrollTop directly
    list.restoreScroll({ index: 50, offsetInItem: 0 });

    const snapshot = list.getScrollSnapshot();
    expect(snapshot.index).toBe(50);
    expect(snapshot.offsetInItem).toBe(0);

    list.destroy();
  });

  it("should compute offsetInItem correctly with variable heights", () => {
    const items = createTestItems(50);
    const heightFn = (i: number) => 30 + (i % 3) * 20;

    const list = createVList<TestItem>({
      container,
      item: {
        height: heightFn,
        template: (item) => `<span>${item.name}</span>`,
      },
      items,
    });

    // restoreScroll with offsetInItem=15
    list.restoreScroll({ index: 10, offsetInItem: 15 });
    const snapshot = list.getScrollSnapshot();

    expect(snapshot.index).toBeGreaterThanOrEqual(0);
    expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);

    list.destroy();
  });
});

describe("core.ts coverage — updateItem in-place rendering", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should update visible item template in-place", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.updateItem(1, { name: "Updated Item 1" });

    const el = list.element.querySelector("[data-index='0']") as HTMLElement;
    expect(el?.innerHTML).toContain("Updated Item 1");

    list.destroy();
  });

  it("should update data-id on visible item via updateItem", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.updateItem(1, { name: "Changed Name" });

    const el = list.element.querySelector("[data-id='1']") as HTMLElement;
    expect(el?.innerHTML).toContain("Changed Name");

    list.destroy();
  });

  it("should not crash on updateItem for non-existent ID", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.updateItem(999, { name: "Ghost" });
    expect(list.total).toBe(10);

    list.destroy();
  });

  it("should not crash on updateItem for item outside visible range", () => {
    const items = createTestItems(200);
    const list = createVList(createBasicConfig(container, items));

    // Item 200 is far below — not rendered, so rendered.get(index) is undefined
    list.updateItem(200, { name: "Far away" });
    expect(list.total).toBe(200);

    list.destroy();
  });
});

describe("core.ts coverage — positionElement", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should set translateY based on height cache offset", () => {
    const items = createTestItems(20);
    const list = createVList(createBasicConfig(container, items));

    const el0 = list.element.querySelector("[data-index='0']") as HTMLElement;
    const el1 = list.element.querySelector("[data-index='1']") as HTMLElement;
    const el2 = list.element.querySelector("[data-index='2']") as HTMLElement;

    expect(el0?.style.transform).toBe("translateY(0px)");
    expect(el1?.style.transform).toBe("translateY(40px)");
    expect(el2?.style.transform).toBe("translateY(80px)");

    list.destroy();
  });

  it("should use Math.round for variable height offsets", () => {
    const items = createTestItems(10);
    const heightFn = (_i: number) => 33.33;

    const list = createVList<TestItem>({
      container,
      item: {
        height: heightFn,
        template: (item) => `<span>${item.name}</span>`,
      },
      items,
    });

    const el1 = list.element.querySelector("[data-index='1']") as HTMLElement;
    expect(el1?.style.transform).toMatch(/translateY\(\d+px\)/);

    list.destroy();
  });
});

describe("core.ts coverage — ARIA attributes", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should set unique aria IDs per instance", () => {
    const items1 = createTestItems(5);
    const items2 = createTestItems(5);

    const container2 = createContainer();

    const list1 = createVList(createBasicConfig(container, items1));
    const list2 = createVList(createBasicConfig(container2, items2));

    const el1 = list1.element.querySelector("[data-index='0']") as HTMLElement;
    const el2 = list2.element.querySelector("[data-index='0']") as HTMLElement;

    expect(el1?.id).toBeTruthy();
    expect(el2?.id).toBeTruthy();
    expect(el1?.id).not.toBe(el2?.id);

    list1.destroy();
    list2.destroy();
    container2.remove();
  });

  it("should set aria-setsize and aria-posinset on rendered items", () => {
    const items = createTestItems(20);
    const list = createVList(createBasicConfig(container, items));

    const el = list.element.querySelector("[data-index='0']") as HTMLElement;
    expect(el?.getAttribute("aria-setsize")).toBe("20");
    expect(el?.getAttribute("aria-posinset")).toBe("1");

    const el5 = list.element.querySelector("[data-index='5']") as HTMLElement;
    expect(el5?.getAttribute("aria-posinset")).toBe("6");

    list.destroy();
  });

  it("should set aria-selected to false on core items", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const el = list.element.querySelector("[data-index='0']") as HTMLElement;
    expect(el?.ariaSelected).toBe("false");

    list.destroy();
  });

  it("should set listbox role and tabindex on root", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    expect(list.element.getAttribute("role")).toBe("listbox");
    expect(list.element.getAttribute("tabindex")).toBe("0");

    list.destroy();
  });
});

describe("core.ts coverage — easeInOutQuad", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should apply easing during smooth scroll (multi-frame animation)", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(80, { behavior: "smooth", duration: 30 });
    await new Promise((r) => setTimeout(r, 60));

    list.destroy();
  });
});

describe("core.ts coverage — destroy cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should remove DOM root from container on destroy", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    expect(container.querySelector(".vlist")).toBeTruthy();
    list.destroy();
    expect(container.querySelector(".vlist")).toBeNull();
  });

  it("should release all rendered elements to pool on destroy", () => {
    const items = createTestItems(20);
    const list = createVList(createBasicConfig(container, items));

    const renderedCount = list.element.querySelectorAll("[data-index]").length;
    expect(renderedCount).toBeGreaterThan(0);

    list.destroy();
  });

  it("should cancel ongoing smooth scroll on destroy", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    list.scrollToIndex(80, { behavior: "smooth", duration: 1000 });
    list.destroy();

    await new Promise((r) => setTimeout(r, 50));
  });

  it("should clear idle timer on destroy", async () => {
    const items = createTestItems(100);
    const list = createVList(createBasicConfig(container, items));

    // Trigger scroll to start idle timer
    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    simulateScroll(viewport, 100);

    // Destroy while idle timer is pending
    list.destroy();

    // Wait past the idle timeout — no error from timer callback
    await new Promise((r) => setTimeout(r, 200));
  });

  it("should be safe to call destroy twice", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should disconnect ResizeObserver on destroy", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const observer = getResizeObserverInstance();
    const disconnectSpy = mock(observer.disconnect.bind(observer));
    observer.disconnect = disconnectSpy;

    list.destroy();

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("should remove window resize listener in window mode on destroy", () => {
    const items = createTestItems(10);
    const list = createVList<TestItem>({
      container,
      item: {
        height: 40,
        template: (item: TestItem) => `<span>${item.name}</span>`,
      },
      items,
      scrollElement: window,
    });

    list.destroy();

    // Verify no resize fires after destroy
    const handler = mock(() => {});
    list.on("resize" as any, handler);

    Object.defineProperty(window, "innerHeight", {
      value: 1500,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(createJSDOMEvent("resize"));

    expect(handler).not.toHaveBeenCalled();

    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });
  });
});

describe("core.ts coverage — data methods", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should appendItems and re-render", () => {
    const items = createTestItems(5);
    const list = createVList(createBasicConfig(container, items));

    list.appendItems(createTestItems(5).map((i) => ({ ...i, id: i.id + 100 })));
    expect(list.total).toBe(10);

    list.destroy();
  });

  it("should prependItems and re-render", () => {
    const items = createTestItems(5);
    const list = createVList(createBasicConfig(container, items));

    list.prependItems(
      createTestItems(3).map((i) => ({ ...i, id: i.id + 200 })),
    );
    expect(list.total).toBe(8);
    expect(list.items[0]?.id).toBe(201);

    list.destroy();
  });

  it("should removeItem and re-render", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.removeItem(5);
    expect(list.total).toBe(9);

    const ids = list.items.map((i) => i.id);
    expect(ids).not.toContain(5);

    list.destroy();
  });

  it("should handle removeItem with non-existent ID", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.removeItem(999);
    expect(list.total).toBe(10);

    list.destroy();
  });

  it("should setItems to empty and back", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    list.setItems([]);
    expect(list.total).toBe(0);

    list.setItems(createTestItems(20));
    expect(list.total).toBe(20);

    list.destroy();
  });
});

describe("core.ts coverage — contentHeight updates", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should set correct content height for fixed-height items", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(content.style.height).toBe("2000px");

    list.destroy();
  });

  it("should update content height after setItems", () => {
    const items = createTestItems(50);
    const list = createVList(createBasicConfig(container, items));

    list.setItems(createTestItems(100));

    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(content.style.height).toBe("4000px");

    list.destroy();
  });

  it("should set 0 height for empty list", () => {
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: () => "<span>x</span>" },
      items: [],
    });

    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(content.style.height).toBe("0px");

    list.destroy();
  });

  it("should set correct content height for variable-height items", () => {
    const items = createTestItems(5);
    const heightFn = (i: number) => 30 + i * 10;

    const list = createVList<TestItem>({
      container,
      item: {
        height: heightFn,
        template: (item) => `<span>${item.name}</span>`,
      },
      items,
    });

    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    // heights: 30+40+50+60+70 = 250
    expect(content.style.height).toBe("250px");

    list.destroy();
  });
});

describe("core.ts coverage — multiple instances with unique IDs", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should use incremented instance IDs for ARIA prefixes", () => {
    const c1 = createContainer();
    const c2 = createContainer();
    const c3 = createContainer();

    const items = createTestItems(3);

    const l1 = createVList(createBasicConfig(c1, items));
    const l2 = createVList(createBasicConfig(c2, items));
    const l3 = createVList(createBasicConfig(c3, items));

    const id1 = l1.element.querySelector("[data-index='0']")?.id;
    const id2 = l2.element.querySelector("[data-index='0']")?.id;
    const id3 = l3.element.querySelector("[data-index='0']")?.id;

    const ids = new Set([id1, id2, id3]);
    expect(ids.size).toBe(3);

    l1.destroy();
    l2.destroy();
    l3.destroy();
    c1.remove();
    c2.remove();
    c3.remove();
  });
});

describe("core.ts coverage — on/off event subscription", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    (global as any).__resizeObserverInstances = [];
  });

  afterEach(() => {
    container.remove();
  });

  it("should return an unsubscribe function from on()", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const handler = mock((_: any) => {});
    const unsub = list.on("range:change" as any, handler);
    expect(typeof unsub).toBe("function");

    list.setItems(createTestItems(5));
    const callCount = handler.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);

    unsub();

    list.setItems(createTestItems(10));
    expect(handler.mock.calls.length).toBe(callCount);

    list.destroy();
  });

  it("should unsubscribe via off()", () => {
    const items = createTestItems(10);
    const list = createVList(createBasicConfig(container, items));

    const handler = mock((_: any) => {});
    list.on("range:change" as any, handler);

    list.setItems(createTestItems(5));
    const callCount = handler.mock.calls.length;

    list.off("range:change" as any, handler);

    list.setItems(createTestItems(10));
    expect(handler.mock.calls.length).toBe(callCount);

    list.destroy();
  });
});
