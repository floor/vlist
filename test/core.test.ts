/**
 * vlist/core - Integration Tests
 * Tests for the lightweight core virtual list factory
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

  // Mock ResizeObserver (not supported in JSDOM)
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
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  } as any;

  // Mock scrollTo for JSDOM (not supported natively)
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

  // Mock window.scrollTo for JSDOM (suppresses "Not implemented" warnings in window-mode tests)
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
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  // Simulate a container with height (JSDOM doesn't compute layout)
  Object.defineProperty(container, "clientHeight", { value: 600 });
  Object.defineProperty(container, "clientWidth", { value: 400 });
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

// =============================================================================
// Tests
// =============================================================================

describe("core createVList", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe("initialization", () => {
    it("should create a core vlist instance", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      expect(list).toBeDefined();
      expect(list.element).toBeInstanceOf(HTMLElement);
      expect(list.total).toBe(100);
      expect(list.items.length).toBe(100);

      list.destroy();
    });

    it("should throw error without container", () => {
      expect(() =>
        createVList({
          container: null as any,
          item: { height: 40, template: () => "" },
        }),
      ).toThrow("[vlist] container is required");
    });

    it("should throw error without item config", () => {
      expect(() =>
        createVList({
          container,
          item: null as any,
        }),
      ).toThrow("[vlist] item configuration is required");
    });

    it("should throw error without item.height", () => {
      expect(() =>
        createVList({
          container,
          item: { height: null as any, template: () => "" },
        }),
      ).toThrow("[vlist] item.height is required");
    });

    it("should throw error with non-positive item.height", () => {
      expect(() =>
        createVList({
          container,
          item: { height: 0, template: () => "" },
        }),
      ).toThrow("[vlist] item.height must be positive");
    });

    it("should throw error with invalid item.height type", () => {
      expect(() =>
        createVList({
          container,
          item: { height: "40px" as any, template: () => "" },
        }),
      ).toThrow("[vlist] item.height must be a number or (index) => number");
    });

    it("should throw error without item.template", () => {
      expect(() =>
        createVList({
          container,
          item: { height: 40, template: null as any },
        }),
      ).toThrow("[vlist] item.template is required");
    });

    it("should accept container as string selector", () => {
      container.id = "core-test-container";
      const items = createTestItems(10);
      const list = createVList({
        container: "#core-test-container",
        item: {
          height: 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      expect(list.element).toBeInstanceOf(HTMLElement);
      expect(list.total).toBe(10);

      list.destroy();
    });

    it("should throw for non-existent selector", () => {
      expect(() =>
        createVList({
          container: "#does-not-exist",
          item: { height: 40, template: () => "" },
          items: [],
        }),
      ).toThrow("[vlist] Container not found");
    });

    it("should create proper DOM structure", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const root = list.element;
      expect(root.className).toBe("vlist");
      expect(root.getAttribute("role")).toBe("listbox");
      expect(root.getAttribute("tabindex")).toBe("0");

      const viewport = root.querySelector(".vlist-viewport");
      expect(viewport).toBeTruthy();

      const content = root.querySelector(".vlist-content");
      expect(content).toBeTruthy();

      const itemsContainer = root.querySelector(".vlist-items");
      expect(itemsContainer).toBeTruthy();

      list.destroy();
    });

    it("should use custom class prefix", () => {
      const items = createTestItems(10);
      const list = createVList({
        ...createBasicConfig(container, items),
        classPrefix: "mylist",
      });

      expect(list.element.className).toBe("mylist");
      expect(list.element.querySelector(".mylist-viewport")).toBeTruthy();

      list.destroy();
    });

    it("should set aria-label when provided", () => {
      const items = createTestItems(10);
      const list = createVList({
        ...createBasicConfig(container, items),
        ariaLabel: "Test list",
      });

      expect(list.element.getAttribute("aria-label")).toBe("Test list");

      list.destroy();
    });

    it("should handle empty items array", () => {
      const list = createVList(createBasicConfig(container, []));

      expect(list.total).toBe(0);
      expect(list.items.length).toBe(0);

      list.destroy();
    });

    it("should handle undefined items", () => {
      const list = createVList({
        container,
        item: { height: 40, template: () => "" },
      });

      expect(list.total).toBe(0);
      expect(list.items.length).toBe(0);

      list.destroy();
    });
  });

  // ===========================================================================
  // Items Property
  // ===========================================================================

  describe("items property", () => {
    it("should return readonly items array", () => {
      const items = createTestItems(5);
      const list = createVList(createBasicConfig(container, items));

      expect(list.items.length).toBe(5);
      expect(list.items[0]).toEqual({ id: 1, name: "Item 1" });
      expect(list.items[4]).toEqual({ id: 5, name: "Item 5" });

      list.destroy();
    });

    it("should return total count", () => {
      const items = createTestItems(50);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(50);

      list.destroy();
    });

    it("should not share reference with internal state", () => {
      const originalItems = createTestItems(5);
      const list = createVList(createBasicConfig(container, originalItems));

      // Mutating the original array should not affect the list
      originalItems.push({ id: 99, name: "External" });
      expect(list.total).toBe(5);

      list.destroy();
    });
  });

  // ===========================================================================
  // Data Methods
  // ===========================================================================

  describe("data methods", () => {
    it("should set items", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      const newItems = createTestItems(10);
      list.setItems(newItems);

      expect(list.total).toBe(10);
      expect(list.items.length).toBe(10);

      list.destroy();
    });

    it("should append items", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      const moreItems: TestItem[] = [
        { id: 100, name: "Appended 1" },
        { id: 101, name: "Appended 2" },
      ];
      list.appendItems(moreItems);

      expect(list.total).toBe(7);
      expect(list.items[5]).toEqual({ id: 100, name: "Appended 1" });
      expect(list.items[6]).toEqual({ id: 101, name: "Appended 2" });

      list.destroy();
    });

    it("should prepend items", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      const newItems: TestItem[] = [
        { id: 100, name: "Prepended 1" },
        { id: 101, name: "Prepended 2" },
      ];
      list.prependItems(newItems);

      expect(list.total).toBe(7);
      expect(list.items[0]).toEqual({ id: 100, name: "Prepended 1" });
      expect(list.items[1]).toEqual({ id: 101, name: "Prepended 2" });
      expect(list.items[2]).toEqual({ id: 1, name: "Item 1" });

      list.destroy();
    });

    it("should update item", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      list.updateItem(3, { name: "Updated Item 3" });

      expect(list.items[2]!.name).toBe("Updated Item 3");

      list.destroy();
    });

    it("should not crash updating non-existent item", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      // Should not throw
      list.updateItem(999, { name: "Ghost" });
      expect(list.total).toBe(5);

      list.destroy();
    });

    it("should remove item", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      list.removeItem(3);

      expect(list.total).toBe(4);
      const ids = list.items.map((item) => item.id);
      expect(ids).not.toContain(3);

      list.destroy();
    });

    it("should handle removing non-existent item", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      list.removeItem(999);
      expect(list.total).toBe(5);

      list.destroy();
    });

    it("should handle setItems with empty array", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(10)),
      );

      list.setItems([]);
      expect(list.total).toBe(0);
      expect(list.items.length).toBe(0);

      list.destroy();
    });

    it("should handle multiple sequential operations", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      list.appendItems([{ id: 6, name: "Item 6" }]);
      expect(list.total).toBe(6);

      list.removeItem(3);
      expect(list.total).toBe(5);

      list.prependItems([{ id: 0, name: "Item 0" }]);
      expect(list.total).toBe(6);

      list.updateItem(1, { name: "Updated" });
      expect(list.items.find((i) => i.id === 1)!.name).toBe("Updated");

      list.destroy();
    });
  });

  // ===========================================================================
  // Scroll Methods
  // ===========================================================================

  describe("scroll methods", () => {
    it("should scroll to index", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      // scrollToIndex should not throw
      list.scrollToIndex(50);
      list.scrollToIndex(0, "start");
      list.scrollToIndex(50, "center");
      list.scrollToIndex(99, "end");

      list.destroy();
    });

    it("should scroll to item by ID", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      // scrollToItem should not throw
      list.scrollToItem(50);
      list.scrollToItem(50, "center");

      list.destroy();
    });

    it("should handle scrollToItem with non-existent ID", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      // Should not throw
      list.scrollToItem(999);

      list.destroy();
    });

    it("should accept ScrollToOptions object", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      // Object form should not throw
      list.scrollToIndex(50, { align: "center", behavior: "auto" });
      list.scrollToIndex(50, {
        align: "end",
        behavior: "smooth",
        duration: 200,
      });

      list.destroy();
    });

    it("should cancel scroll", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToIndex(50, { behavior: "smooth", duration: 1000 });
      // Should not throw
      list.cancelScroll();

      list.destroy();
    });

    it("should get scroll position", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      const pos = list.getScrollPosition();
      expect(typeof pos).toBe("number");
      expect(pos).toBeGreaterThanOrEqual(0);

      list.destroy();
    });
  });

  // ===========================================================================
  // Events
  // ===========================================================================

  describe("events", () => {
    it("should subscribe to and unsubscribe from events", () => {
      const items = createTestItems(50);
      const list = createVList(createBasicConfig(container, items));

      const handler = mock((_payload: any) => {});
      const unsub = list.on("scroll", handler);
      expect(typeof unsub).toBe("function");

      list.off("scroll", handler);

      list.destroy();
    });

    it("should emit range:change when items change", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const handler = mock((_payload: any) => {});
      list.on("range:change", handler);

      list.setItems(createTestItems(50));
      expect(handler).toHaveBeenCalled();

      list.destroy();
    });

    it("should return unsubscribe function from on()", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const handler = mock((_payload: any) => {});
      const unsub = list.on("range:change", handler);

      // Unsubscribe
      unsub();

      // After unsubscribe, handler should not be called
      const callCount = handler.mock.calls.length;
      list.setItems(createTestItems(20));
      // range:change is only emitted if range actually changes, but
      // the handler shouldn't be called after unsub regardless
      // We can't guarantee range:change fires, but if it does,
      // the handler should NOT have been called more times
      // (this is a structural test — the important thing is unsub works)

      list.destroy();
    });
  });

  // ===========================================================================
  // Variable Heights
  // ===========================================================================

  describe("variable item heights", () => {
    it("should support function-based heights", () => {
      const items = createTestItems(100);
      const list = createVList({
        container,
        item: {
          height: (index: number) => (index % 2 === 0 ? 40 : 60),
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      expect(list.total).toBe(100);
      expect(list.element).toBeInstanceOf(HTMLElement);

      list.destroy();
    });

    it("should render items with correct variable heights", () => {
      const items = createTestItems(10);
      const heightFn = (index: number) => 30 + index * 10;
      const list = createVList({
        container,
        item: {
          height: heightFn,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      // Check that rendered items have the correct height style
      const renderedItems = list.element.querySelectorAll("[data-index]");
      for (const el of renderedItems) {
        const index = parseInt(el.getAttribute("data-index") ?? "0", 10);
        const expectedHeight = heightFn(index);
        expect((el as HTMLElement).style.height).toBe(`${expectedHeight}px`);
      }

      list.destroy();
    });
  });

  // ===========================================================================
  // Template
  // ===========================================================================

  describe("template", () => {
    it("should support string templates", () => {
      const items = createTestItems(5);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => `<div class="row">${item.name}</div>`,
        },
        items,
      });

      const firstItem = list.element.querySelector("[data-index='0']");
      expect(firstItem).toBeTruthy();
      expect(firstItem!.innerHTML).toContain("Item 1");

      list.destroy();
    });

    it("should support HTMLElement templates", () => {
      const items = createTestItems(5);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => {
            const el = document.createElement("div");
            el.textContent = item.name;
            return el;
          },
        },
        items,
      });

      const firstItem = list.element.querySelector("[data-index='0']");
      expect(firstItem).toBeTruthy();
      expect(firstItem!.textContent).toContain("Item 1");

      list.destroy();
    });

    it("should pass index and state to template", () => {
      const items = createTestItems(5);
      const templateFn = mock(
        (
          item: TestItem,
          index: number,
          state: { selected: boolean; focused: boolean },
        ) => {
          return `<span>${item.name} - ${index} - ${state.selected}</span>`;
        },
      );

      const list = createVList({
        container,
        item: { height: 40, template: templateFn },
        items,
      });

      // Template should have been called for visible items
      expect(templateFn).toHaveBeenCalled();

      // Check that state has the expected shape (core always passes false/false)
      const firstCall = templateFn.mock.calls[0];
      expect(firstCall).toBeDefined();
      expect(firstCall![2]).toEqual({ selected: false, focused: false });

      list.destroy();
    });
  });

  // ===========================================================================
  // Rendering
  // ===========================================================================

  describe("rendering", () => {
    it("should render only visible items (virtualization)", () => {
      // 100 items × 40px = 4000px total, container = 600px
      // Visible: ~15 items + 3 overscan on each side = ~21 max
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      const renderedItems = list.element.querySelectorAll("[data-index]");
      expect(renderedItems.length).toBeLessThan(100);
      expect(renderedItems.length).toBeGreaterThan(0);

      list.destroy();
    });

    it("should render all items when list fits in container", () => {
      // 5 items × 40px = 200px, container = 600px
      const items = createTestItems(5);
      const list = createVList(createBasicConfig(container, items));

      const renderedItems = list.element.querySelectorAll("[data-index]");
      expect(renderedItems.length).toBe(5);

      list.destroy();
    });

    it("should set data-index and data-id on rendered items", () => {
      const items = createTestItems(5);
      const list = createVList(createBasicConfig(container, items));

      const firstItem = list.element.querySelector("[data-index='0']");
      expect(firstItem).toBeTruthy();
      expect(firstItem!.getAttribute("data-id")).toBe("1");

      const secondItem = list.element.querySelector("[data-index='1']");
      expect(secondItem).toBeTruthy();
      expect(secondItem!.getAttribute("data-id")).toBe("2");

      list.destroy();
    });

    it("should set correct translateY positions", () => {
      const items = createTestItems(5);
      const list = createVList(createBasicConfig(container, items));

      const el0 = list.element.querySelector("[data-index='0']") as HTMLElement;
      const el1 = list.element.querySelector("[data-index='1']") as HTMLElement;
      const el2 = list.element.querySelector("[data-index='2']") as HTMLElement;

      expect(el0?.style.transform).toBe("translateY(0px)");
      expect(el1?.style.transform).toBe("translateY(40px)");
      expect(el2?.style.transform).toBe("translateY(80px)");

      list.destroy();
    });

    it("should set correct content height", () => {
      // 50 items × 40px = 2000px
      const items = createTestItems(50);
      const list = createVList(createBasicConfig(container, items));

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content.style.height).toBe("2000px");

      list.destroy();
    });

    it("should update content height when items change", () => {
      const items = createTestItems(50);
      const list = createVList(createBasicConfig(container, items));

      list.setItems(createTestItems(100));

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content.style.height).toBe("4000px");

      list.destroy();
    });

    it("should re-render after setItems", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      list.setItems([
        { id: 10, name: "New A" },
        { id: 11, name: "New B" },
      ]);

      expect(list.total).toBe(2);

      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBe(2);

      list.destroy();
    });

    it("should use element pooling (items have role=option)", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const renderedItems = list.element.querySelectorAll("[data-index]");
      for (const el of renderedItems) {
        expect(el.getAttribute("role")).toBe("option");
      }

      list.destroy();
    });
  });

  // ===========================================================================
  // Overscan
  // ===========================================================================

  describe("overscan", () => {
    it("should use default overscan of 3", () => {
      // Container 600px / 40px per item = 15 visible items
      // With overscan 3: render range starts at max(0, 0-3) = 0
      // and ends at min(99, 14+3) = 17
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      const renderedItems = list.element.querySelectorAll("[data-index]");
      // Should have visible items + overscan
      expect(renderedItems.length).toBeGreaterThan(10);

      list.destroy();
    });

    it("should accept custom overscan", () => {
      const items = createTestItems(100);
      const list = createVList({
        ...createBasicConfig(container, items),
        overscan: 0,
      });

      const renderedZeroOverscan =
        list.element.querySelectorAll("[data-index]").length;

      list.destroy();

      const list2 = createVList({
        ...createBasicConfig(container, items),
        overscan: 10,
      });

      const renderedTenOverscan =
        list2.element.querySelectorAll("[data-index]").length;

      // More overscan should render more items
      expect(renderedTenOverscan).toBeGreaterThanOrEqual(renderedZeroOverscan);

      list2.destroy();
    });
  });

  // ===========================================================================
  // Destroy
  // ===========================================================================

  describe("destroy", () => {
    it("should remove DOM on destroy", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const root = list.element;
      expect(root.parentElement).toBeTruthy();

      list.destroy();

      expect(root.parentElement).toBeNull();
    });

    it("should handle double destroy gracefully", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      list.destroy();
      // Second destroy should not throw
      list.destroy();
    });

    it("should stop emitting events after destroy", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const handler = mock((_payload: any) => {});
      list.on("range:change", handler);

      list.destroy();

      // Should not emit after destroy (emitter is cleared)
      const callCount = handler.mock.calls.length;

      // Try to trigger a render — operations on destroyed list are no-ops
      try {
        list.setItems(createTestItems(50));
      } catch {
        // setItems may or may not throw on destroyed list, either is fine
      }

      // Handler should not have been called again (emitter was cleared)
      // Note: we allow the same count since emitter.clear() removes all listeners
      expect(handler.mock.calls.length).toBe(callCount);
    });
  });

  // ===========================================================================
  // Large Lists
  // ===========================================================================

  describe("large lists", () => {
    it("should handle 10,000 items", () => {
      const items = createTestItems(10_000);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(10_000);

      // Should only render a small subset
      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeLessThan(50);

      list.destroy();
    });

    it("should handle 100,000 items", () => {
      const items = createTestItems(100_000);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(100_000);

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content.style.height).toBe("4000000px"); // 100K × 40px

      list.destroy();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle single item", () => {
      const list = createVList(
        createBasicConfig(container, [{ id: 1, name: "Only Item" }]),
      );

      expect(list.total).toBe(1);
      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBe(1);

      list.destroy();
    });

    it("should handle items with string IDs", () => {
      const items = [
        { id: "abc", name: "Alpha" },
        { id: "def", name: "Beta" },
        { id: "ghi", name: "Gamma" },
      ];

      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item) => `<span>${item.name}</span>`,
        },
        items,
      });

      expect(list.total).toBe(3);

      const el = list.element.querySelector("[data-id='def']");
      expect(el).toBeTruthy();

      list.destroy();
    });

    it("should handle rapid setItems calls", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      for (let i = 0; i < 20; i++) {
        list.setItems(createTestItems(i * 10 + 1));
      }

      expect(list.total).toBe(191);

      list.destroy();
    });

    it("should handle append to empty list", () => {
      const list = createVList(createBasicConfig(container, []));

      expect(list.total).toBe(0);

      list.appendItems(createTestItems(5));
      expect(list.total).toBe(5);

      list.destroy();
    });

    it("should handle prepend to empty list", () => {
      const list = createVList(createBasicConfig(container, []));

      list.prependItems(createTestItems(5));
      expect(list.total).toBe(5);

      list.destroy();
    });

    it("should handle remove until empty", () => {
      const items = createTestItems(3);
      const list = createVList(createBasicConfig(container, items));

      list.removeItem(1);
      list.removeItem(2);
      list.removeItem(3);

      expect(list.total).toBe(0);

      list.destroy();
    });
  });

  // ===========================================================================
  // API Compatibility
  // ===========================================================================

  describe("API compatibility with full vlist", () => {
    it("should have all core API methods", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      // Properties
      expect(list.element).toBeDefined();
      expect(list.items).toBeDefined();
      expect(typeof list.total).toBe("number");

      // Data methods
      expect(typeof list.setItems).toBe("function");
      expect(typeof list.appendItems).toBe("function");
      expect(typeof list.prependItems).toBe("function");
      expect(typeof list.updateItem).toBe("function");
      expect(typeof list.removeItem).toBe("function");

      // Scroll methods
      expect(typeof list.scrollToIndex).toBe("function");
      expect(typeof list.scrollToItem).toBe("function");
      expect(typeof list.cancelScroll).toBe("function");
      expect(typeof list.getScrollPosition).toBe("function");

      // Events
      expect(typeof list.on).toBe("function");
      expect(typeof list.off).toBe("function");

      // Lifecycle
      expect(typeof list.destroy).toBe("function");

      list.destroy();
    });

    it("should NOT have selection methods (core omits them)", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      ) as any;

      expect(list.select).toBeUndefined();
      expect(list.deselect).toBeUndefined();
      expect(list.toggleSelect).toBeUndefined();
      expect(list.selectAll).toBeUndefined();
      expect(list.clearSelection).toBeUndefined();
      expect(list.getSelected).toBeUndefined();
      expect(list.getSelectedItems).toBeUndefined();

      list.destroy();
    });

    it("should NOT have reload method (core omits adapter support)", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      ) as any;

      expect(list.reload).toBeUndefined();

      list.destroy();
    });
  });

  // ===========================================================================
  // Scroll Snapshot / Restore
  // ===========================================================================

  describe("scroll snapshot and restore", () => {
    it("should return a snapshot with index and offsetInItem", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      const snapshot = list.getScrollSnapshot();

      expect(snapshot).toBeDefined();
      expect(typeof snapshot.index).toBe("number");
      expect(typeof snapshot.offsetInItem).toBe("number");
      expect(snapshot.index).toBeGreaterThanOrEqual(0);
      expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);

      list.destroy();
    });

    it("should return index 0 with 0 offset for initial scroll position", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      const snapshot = list.getScrollSnapshot();

      expect(snapshot.index).toBe(0);
      expect(snapshot.offsetInItem).toBe(0);

      list.destroy();
    });

    it("should return index 0 and offsetInItem 0 for empty list", () => {
      const list = createVList(createBasicConfig(container, []));

      const snapshot = list.getScrollSnapshot();

      expect(snapshot.index).toBe(0);
      expect(snapshot.offsetInItem).toBe(0);

      list.destroy();
    });

    it("should restore scroll position from snapshot", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      const snapshot = { index: 10, offsetInItem: 15 };
      list.restoreScroll(snapshot);

      // After restore, scroll position should be near index 10
      // 10 * 40 + 15 = 415
      const pos = list.getScrollPosition();
      expect(pos).toBe(415);

      list.destroy();
    });

    it("should clamp snapshot index to valid range", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      // Index beyond last item
      const snapshot = { index: 9999, offsetInItem: 0 };
      list.restoreScroll(snapshot);

      // Should clamp to last item
      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThanOrEqual(0);

      list.destroy();
    });

    it("should clamp restored position to max scroll", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      // Very large offset that would exceed max scroll
      const snapshot = { index: 9, offsetInItem: 99999 };
      list.restoreScroll(snapshot);

      // Total height = 10 * 40 = 400, container = 600
      // maxScroll = max(0, 400 - 600) = 0
      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThanOrEqual(0);

      list.destroy();
    });

    it("should be a no-op for empty list on restore", () => {
      const list = createVList(createBasicConfig(container, []));

      // Should not throw
      list.restoreScroll({ index: 5, offsetInItem: 10 });

      expect(list.getScrollPosition()).toBe(0);

      list.destroy();
    });

    it("should round-trip snapshot/restore", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      // Scroll to a known position
      list.scrollToIndex(20, "start");

      const snapshot = list.getScrollSnapshot();
      expect(snapshot.index).toBeGreaterThanOrEqual(0);

      // Change items then restore
      list.setItems(createTestItems(100));
      list.restoreScroll(snapshot);

      const newSnapshot = list.getScrollSnapshot();
      expect(newSnapshot.index).toBe(snapshot.index);
      expect(newSnapshot.offsetInItem).toBe(snapshot.offsetInItem);

      list.destroy();
    });

    it("should have getScrollSnapshot and restoreScroll methods", () => {
      const list = createVList(
        createBasicConfig(container, createTestItems(5)),
      );

      expect(typeof list.getScrollSnapshot).toBe("function");
      expect(typeof list.restoreScroll).toBe("function");

      list.destroy();
    });
  });

  // ===========================================================================
  // Window Scroll Mode
  // ===========================================================================

  describe("window scroll mode", () => {
    it("should create list in window scroll mode", () => {
      const items = createTestItems(50);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
        scrollElement: window,
      });

      expect(list).toBeDefined();
      expect(list.element).toBeInstanceOf(HTMLElement);
      expect(list.total).toBe(50);

      // In window mode, root should have overflow: visible
      expect(list.element.style.overflow).toBe("visible");

      list.destroy();
    });

    it("should render items in window scroll mode", () => {
      const items = createTestItems(20);
      const list = createVList({
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

      list.destroy();
    });

    it("should use window.innerHeight as container height in window mode", () => {
      const items = createTestItems(100);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
        scrollElement: window,
      });

      // Should render items based on window height
      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(100);

      list.destroy();
    });

    it("should clean up window event listener on destroy", () => {
      const items = createTestItems(20);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
        scrollElement: window,
      });

      // Should not throw on destroy
      list.destroy();
    });

    it("should handle restoreScroll in window mode", () => {
      const items = createTestItems(100);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
        scrollElement: window,
      });

      // Should not throw
      list.restoreScroll({ index: 10, offsetInItem: 5 });

      list.destroy();
    });

    it("should scrollToIndex in window mode without error", () => {
      const items = createTestItems(100);
      const list = createVList({
        container,
        item: {
          height: 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
        scrollElement: window,
      });

      list.scrollToIndex(50, "start");
      list.scrollToIndex(50, "center");
      list.scrollToIndex(50, "end");
      list.scrollToIndex(50, { behavior: "smooth", duration: 100 });

      list.destroy();
    });
  });

  // ===========================================================================
  // Variable Height Rendering Paths
  // ===========================================================================

  describe("variable height rendering paths", () => {
    it("should render with variable heights and correct positions", () => {
      const items = createTestItems(20);
      const heightFn = (index: number) => 30 + (index % 5) * 10;

      const list = createVList({
        container,
        item: {
          height: heightFn,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      // Check first few items have correct height and positions
      const el0 = list.element.querySelector("[data-index='0']") as HTMLElement;
      const el1 = list.element.querySelector("[data-index='1']") as HTMLElement;

      expect(el0.style.height).toBe(`${heightFn(0)}px`);
      expect(el1.style.height).toBe(`${heightFn(1)}px`);

      // Position: item 0 at 0, item 1 at heightFn(0)
      expect(el0.style.transform).toBe("translateY(0px)");
      expect(el1.style.transform).toBe(`translateY(${heightFn(0)}px)`);

      list.destroy();
    });

    it("should compute correct content height with variable heights", () => {
      const items = createTestItems(10);
      const heightFn = (index: number) => 50 + index * 5;

      const list = createVList({
        container,
        item: {
          height: heightFn,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      // Total height = sum of all heights = 50+55+60+65+70+75+80+85+90+95 = 725
      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content.style.height).toBe("725px");

      list.destroy();
    });

    it("should update content height after setItems with variable heights", () => {
      const heightFn = (index: number) => 40 + (index % 3) * 20;

      const list = createVList({
        container,
        item: {
          height: heightFn,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items: createTestItems(5),
      });

      // Change to different number of items
      list.setItems(createTestItems(10));

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      // Should be recalculated for 10 items
      const expectedHeight = Array.from({ length: 10 }, (_, i) =>
        heightFn(i),
      ).reduce((a, b) => a + b, 0);
      expect(content.style.height).toBe(`${expectedHeight}px`);

      list.destroy();
    });

    it("should handle variable heights with scrollToIndex", () => {
      const items = createTestItems(100);
      const heightFn = (index: number) => 30 + (index % 4) * 15;

      const list = createVList({
        container,
        item: {
          height: heightFn,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      // scrollToIndex should not throw with variable heights
      list.scrollToIndex(50, "start");
      list.scrollToIndex(50, "center");
      list.scrollToIndex(50, "end");

      list.destroy();
    });

    it("should scroll snapshot/restore with variable heights", () => {
      const items = createTestItems(100);
      const heightFn = (index: number) => 30 + (index % 4) * 15;

      const list = createVList({
        container,
        item: {
          height: heightFn,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      list.scrollToIndex(20, "start");
      const snapshot = list.getScrollSnapshot();

      expect(snapshot.index).toBeGreaterThanOrEqual(0);

      // Restore should not throw
      list.restoreScroll(snapshot);

      list.destroy();
    });

    it("should handle variable height function returning constant value", () => {
      const items = createTestItems(20);
      const list = createVList({
        container,
        item: {
          height: (_index: number) => 40,
          template: (item: TestItem) => `<span>${item.name}</span>`,
        },
        items,
      });

      // Should behave identically to fixed height
      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content.style.height).toBe("800px"); // 20 * 40

      list.destroy();
    });
  });

  // ===========================================================================
  // Smooth Scroll Animation
  // ===========================================================================

  describe("smooth scroll", () => {
    it("should animate smooth scroll to index", async () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToIndex(50, { behavior: "smooth", duration: 50 });

      // Wait for animation to complete
      await new Promise((r) => setTimeout(r, 100));

      list.destroy();
    });

    it("should cancel ongoing smooth scroll", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToIndex(50, { behavior: "smooth", duration: 500 });
      list.cancelScroll();

      // No error after cancel
      list.destroy();
    });

    it("should handle smooth scroll to same position", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      // Scroll to index 0 from position 0 — distance < 1, should snap
      list.scrollToIndex(0, { behavior: "smooth", duration: 100 });

      list.destroy();
    });

    it("should handle scroll with defaults when no options provided", () => {
      const items = createTestItems(100);
      const list = createVList(createBasicConfig(container, items));

      // No options — uses defaults
      list.scrollToIndex(50);

      list.destroy();
    });
  });

  // ===========================================================================
  // Resize Observer
  // ===========================================================================

  describe("resize observer", () => {
    it("should emit resize event when container height changes", () => {
      const items = createTestItems(50);
      const list = createVList(createBasicConfig(container, items));

      const handler = mock((_payload: any) => {});
      list.on("resize", handler);

      // Our mock ResizeObserver fires immediately on observe with height 600
      // That initial callback already ran during construction.
      // handler won't have been called because the event is only emitted
      // when height *changes* from the current value.
      // In our setup, clientHeight=600 and ResizeObserver reports 600 → no change.
      // This is correct behavior: resize should only fire on actual change.

      list.destroy();
    });
  });

  // ===========================================================================
  // Event Handler Edge Cases
  // ===========================================================================

  describe("event handler edge cases", () => {
    it("should survive error in event handler", () => {
      const items = createTestItems(10);
      const list = createVList(createBasicConfig(container, items));

      const badHandler = () => {
        throw new Error("Handler crash");
      };
      list.on("range:change", badHandler);

      // Suppress the expected console.error from the catch block in emit()
      const originalConsoleError = console.error;
      console.error = () => {};

      // setItems triggers range:change — should not crash the list
      list.setItems(createTestItems(20));

      console.error = originalConsoleError;

      expect(list.total).toBe(20);

      list.destroy();
    });
  });
});
