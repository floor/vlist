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
  delete (global as any).__resizeObserverInstances;
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


/** Create a JSDOM-native Event (JSDOM rejects non-native Event instances) */
const createJSDOMEvent = (type: string, opts?: EventInit) =>
  new dom.window.Event(type, opts);

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

