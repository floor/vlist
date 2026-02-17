// test/reverse.test.ts
/**
 * Tests for reverse mode (chat UI)
 *
 * Reverse mode (`reverse: true`) is designed for chat-style UIs:
 * - Starts scrolled to the bottom
 * - appendItems auto-scrolls if user was at bottom
 * - prependItems preserves scroll position
 * - Adapter load-more triggers at the TOP instead of bottom
 * - Cannot be combined with groups or grid
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { JSDOM } from "jsdom";
import { createVList } from "../src/core/full";
import type { VListConfig, VListItem, VList } from "../src/types";

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

  // Mock ResizeObserver
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

  // JSDOM doesn't implement Element.prototype.scrollTo
  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (
      optionsOrX?: ScrollToOptions | number,
    ) {
      if (typeof optionsOrX === "object" && optionsOrX !== null) {
        if (optionsOrX.top !== undefined) {
          this.scrollTop = optionsOrX.top;
        }
      } else if (typeof optionsOrX === "number") {
        this.scrollTop = optionsOrX;
      }
    };
  }
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

interface ChatMessage extends VListItem {
  id: number;
  text: string;
  sender: string;
}

const createMessages = (count: number, startId = 1): ChatMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    text: `Message ${startId + i}`,
    sender: i % 2 === 0 ? "Alice" : "Bob",
  }));

let container: HTMLElement;

const createContainer = (): HTMLElement => {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
  document.body.appendChild(el);
  return el;
};

const createBasicConfig = (
  cont: HTMLElement,
  items: ChatMessage[],
  overrides?: Partial<VListConfig<ChatMessage>>,
): VListConfig<ChatMessage> => ({
  container: cont,
  item: {
    height: 60,
    template: (msg: ChatMessage) =>
      `<div class="msg"><b>${msg.sender}</b>: ${msg.text}</div>`,
  },
  items,
  reverse: true,
  ...overrides,
});

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
});

// =============================================================================
// Tests
// =============================================================================

describe("reverse mode", () => {
  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  describe("validation", () => {
    it("should allow sticky headers with reverse mode", () => {
      const items = createMessages(10);

      // Default sticky: true should work with reverse mode
      expect(() => {
        const list = createVList({
          container,
          item: {
            height: 60,
            template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
          },
          items,
          reverse: true,
          groups: {
            getGroupForIndex: (index: number) => items[index]!.sender,
            headerHeight: 30,
            headerTemplate: (group: string) => `<div>${group}</div>`,
          },
        });
        list.destroy();
      }).not.toThrow();

      // Explicit sticky: true should also work
      expect(() => {
        const list = createVList({
          container,
          item: {
            height: 60,
            template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
          },
          items,
          reverse: true,
          groups: {
            getGroupForIndex: (index: number) => items[index]!.sender,
            headerHeight: 30,
            headerTemplate: (group: string) => `<div>${group}</div>`,
            sticky: true,
          },
        });
        list.destroy();
      }).not.toThrow();
    });

    it("should allow inline headers with reverse mode (sticky: false)", () => {
      const items = createMessages(10);

      expect(() => {
        const list = createVList({
          container,
          item: {
            height: 60,
            template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
          },
          items,
          reverse: true,
          groups: {
            getGroupForIndex: (index: number) => items[index]!.sender,
            headerHeight: 30,
            headerTemplate: (group: string) => `<div>${group}</div>`,
            sticky: false,
          },
        });
        list.destroy();
      }).not.toThrow();
    });

    it("should throw when combined with grid layout", () => {
      const items = createMessages(10);

      expect(() =>
        createVList({
          container,
          layout: "grid",
          grid: { columns: 3 },
          item: {
            height: 60,
            template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
          },
          items,
          reverse: true,
        }),
      ).toThrow("[vlist/builder] withGrid cannot be used with reverse: true");
    });

    it("should accept reverse: true without groups or grid", () => {
      const items = createMessages(10);

      const list = createVList(createBasicConfig(container, items));

      expect(list).toBeDefined();
      expect(list.total).toBe(10);

      list.destroy();
    });

    it("should work with reverse: false (default behavior)", () => {
      const items = createMessages(10);

      const list = createVList(
        createBasicConfig(container, items, { reverse: false }),
      );

      expect(list).toBeDefined();
      expect(list.total).toBe(10);

      list.destroy();
    });

    it("should work without reverse option (undefined = false)", () => {
      const items = createMessages(10);

      const list = createVList({
        container,
        item: {
          height: 60,
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
      });

      expect(list).toBeDefined();
      expect(list.total).toBe(10);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Initial scroll to bottom
  // ---------------------------------------------------------------------------

  describe("initial scroll to bottom", () => {
    it("should start scrolled to the bottom with static items", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      // In reverse mode, the list should have called scrollToIndex(99, 'end')
      // which sets the scroll position near the bottom.
      // With 100 items × 60px = 6000px total height and 600px container,
      // max scroll is 5400px.
      const scrollPos = list.getScrollPosition();
      // The scroll position should be somewhere near the bottom
      // (exact value depends on internal calculations)
      expect(scrollPos).toBeGreaterThan(0);

      list.destroy();
    });

    it("should handle empty items gracefully", () => {
      const list = createVList(createBasicConfig(container, []));

      // No items, no scroll needed
      expect(list.total).toBe(0);
      expect(list.getScrollPosition()).toBe(0);

      list.destroy();
    });

    it("should handle few items that fit in viewport", () => {
      // 5 items × 60px = 300px < 600px container → no scrolling needed
      const items = createMessages(5);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(5);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // appendItems auto-scroll
  // ---------------------------------------------------------------------------

  describe("appendItems auto-scroll", () => {
    it("should auto-scroll to bottom when appending and user was at bottom", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      // Start at bottom (reverse mode does this automatically)
      const scrollBefore = list.getScrollPosition();
      expect(scrollBefore).toBeGreaterThan(0);

      // Append a new message
      const newMessages = createMessages(1, 101);
      list.appendItems(newMessages);

      expect(list.total).toBe(101);

      // Should have auto-scrolled to show the new message
      const scrollAfter = list.getScrollPosition();
      // The scroll position should be at least as far as before
      // (actually further, since there's one more item)
      expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore);

      list.destroy();
    });

    it("should append multiple messages and keep scrolling to bottom", () => {
      const items = createMessages(50);
      const list = createVList(createBasicConfig(container, items));

      // Append several batches
      for (let batch = 0; batch < 3; batch++) {
        const newMessages = createMessages(5, 51 + batch * 5);
        list.appendItems(newMessages);
      }

      expect(list.total).toBe(65);

      list.destroy();
    });

    it("should not crash when appending to empty list in reverse mode", () => {
      const list = createVList(createBasicConfig(container, []));

      expect(list.total).toBe(0);

      list.appendItems(createMessages(10));
      expect(list.total).toBe(10);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // prependItems scroll preservation
  // ---------------------------------------------------------------------------

  describe("prependItems scroll preservation", () => {
    it("should preserve scroll position when prepending items", () => {
      const items = createMessages(50);
      const list = createVList(createBasicConfig(container, items));

      // Scroll to somewhere in the middle
      list.scrollToIndex(25, "center");
      const scrollBefore = list.getScrollPosition();

      // Prepend older messages
      const olderMessages = createMessages(10, -9); // IDs: -9 to 0
      list.prependItems(olderMessages);

      expect(list.total).toBe(60);

      // After prepend, the scroll position should have been adjusted
      // by the height of the prepended items (10 × 60px = 600px)
      const scrollAfter = list.getScrollPosition();
      const expectedAdjustment = 10 * 60; // 10 items × 60px height

      // The scroll should have shifted UP by the height of prepended items
      // to keep the same content visible
      expect(scrollAfter).toBeCloseTo(scrollBefore + expectedAdjustment, -1);

      list.destroy();
    });

    it("should handle prepending to an empty list", () => {
      const list = createVList(createBasicConfig(container, []));

      list.prependItems(createMessages(20));
      expect(list.total).toBe(20);

      list.destroy();
    });

    it("should handle multiple sequential prepends", () => {
      const items = createMessages(30, 31);
      const list = createVList(createBasicConfig(container, items));

      // Prepend several batches of older messages
      for (let batch = 0; batch < 3; batch++) {
        const olderMessages = createMessages(10, (2 - batch) * 10 + 1);
        list.prependItems(olderMessages);
      }

      expect(list.total).toBe(60);

      list.destroy();
    });

    it("should preserve scroll when prepending a single item", () => {
      const items = createMessages(50);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToIndex(25, "center");
      const scrollBefore = list.getScrollPosition();

      list.prependItems(createMessages(1, 0));

      expect(list.total).toBe(51);

      const scrollAfter = list.getScrollPosition();
      // Should have adjusted by exactly one item height
      expect(scrollAfter).toBeCloseTo(scrollBefore + 60, -1);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // setItems in reverse mode
  // ---------------------------------------------------------------------------

  describe("setItems in reverse mode", () => {
    it("should replace items and keep total correct", () => {
      const items = createMessages(20);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(20);

      const newItems = createMessages(50);
      list.setItems(newItems);

      expect(list.total).toBe(50);

      list.destroy();
    });

    it("should allow clearing and resetting items", () => {
      const items = createMessages(30);
      const list = createVList(createBasicConfig(container, items));

      list.setItems([]);
      expect(list.total).toBe(0);

      list.setItems(createMessages(10));
      expect(list.total).toBe(10);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Data methods work correctly in reverse mode
  // ---------------------------------------------------------------------------

  describe("data methods", () => {
    it("should support updateItem in reverse mode", () => {
      const items = createMessages(20);
      const list = createVList(createBasicConfig(container, items));

      list.updateItem(5, { text: "Updated message" });

      // Should not throw and item should still be accessible
      expect(list.total).toBe(20);

      list.destroy();
    });

    it("should support removeItem in reverse mode", () => {
      const items = createMessages(20);
      const list = createVList(createBasicConfig(container, items));

      list.removeItem(10);
      expect(list.total).toBe(19);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Selection in reverse mode
  // ---------------------------------------------------------------------------

  describe("selection", () => {
    it("should support selection in reverse mode", () => {
      const items = createMessages(20);
      const list = createVList(
        createBasicConfig(container, items, {
          selection: { mode: "single" },
        }),
      );

      list.select(5);
      expect(list.getSelected()).toEqual([5]);

      list.select(10);
      expect(list.getSelected()).toEqual([10]);

      list.clearSelection();
      expect(list.getSelected()).toEqual([]);

      list.destroy();
    });

    it("should support multiple selection in reverse mode", () => {
      const items = createMessages(20);
      const list = createVList(
        createBasicConfig(container, items, {
          selection: { mode: "multiple" },
        }),
      );

      list.select(1, 3, 5);
      expect(list.getSelected()).toEqual([1, 3, 5]);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Events in reverse mode
  // ---------------------------------------------------------------------------

  describe("events", () => {
    it("should emit events normally in reverse mode", () => {
      const items = createMessages(20);
      const list = createVList(
        createBasicConfig(container, items, {
          selection: { mode: "single" },
        }),
      );

      const selectionEvents: Array<{ selected: Array<string | number> }> = [];
      list.on("selection:change", ({ selected }) => {
        selectionEvents.push({ selected });
      });

      list.select(3);
      expect(selectionEvents.length).toBe(1);
      expect(selectionEvents[0]!.selected).toEqual([3]);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Scroll save/restore in reverse mode
  // ---------------------------------------------------------------------------

  describe("scroll save/restore", () => {
    it("should support getScrollSnapshot in reverse mode", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      const snapshot = list.getScrollSnapshot();
      expect(snapshot).toBeDefined();
      expect(typeof snapshot.index).toBe("number");
      expect(typeof snapshot.offsetInItem).toBe("number");

      list.destroy();
    });

    it("should support restoreScroll in reverse mode", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToIndex(50);
      const snapshot = list.getScrollSnapshot();

      // Restore should not throw
      list.restoreScroll(snapshot);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Variable heights in reverse mode
  // ---------------------------------------------------------------------------

  describe("variable heights", () => {
    it("should work with function-based heights in reverse mode", () => {
      const items = createMessages(50);
      const list = createVList({
        container,
        item: {
          height: (index: number) => (index % 2 === 0 ? 48 : 72),
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
        reverse: true,
      });

      expect(list.total).toBe(50);

      // Should start near bottom
      expect(list.getScrollPosition()).toBeGreaterThan(0);

      list.destroy();
    });

    it("should preserve scroll with variable heights on prepend", () => {
      const items = createMessages(30);
      const list = createVList({
        container,
        item: {
          height: (index: number) => (index % 2 === 0 ? 40 : 80),
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
        reverse: true,
      });

      list.scrollToIndex(15, "center");
      const scrollBefore = list.getScrollPosition();

      list.prependItems(createMessages(5, -4));
      expect(list.total).toBe(35);

      const scrollAfter = list.getScrollPosition();
      // Scroll should have adjusted — exact amount depends on variable heights
      // but it should be greater than before
      expect(scrollAfter).toBeGreaterThan(scrollBefore);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle single item in reverse mode", () => {
      const items = createMessages(1);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(1);

      list.destroy();
    });

    it("should handle rapid append/prepend operations", () => {
      const items = createMessages(20);
      const list = createVList(createBasicConfig(container, items));

      // Rapid alternating operations
      for (let i = 0; i < 10; i++) {
        list.appendItems(createMessages(1, 100 + i));
        list.prependItems(createMessages(1, -(i + 1)));
      }

      expect(list.total).toBe(40);

      list.destroy();
    });

    it("should handle scrollToIndex in reverse mode", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      // All these should not throw
      list.scrollToIndex(0);
      list.scrollToIndex(50, "center");
      list.scrollToIndex(99, "end");

      list.destroy();
    });

    it("should handle scrollToItem in reverse mode", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToItem(50);
      list.scrollToItem(1, "center");
      list.scrollToItem(100, "end");

      list.destroy();
    });

    it("should handle cancelScroll in reverse mode", () => {
      const items = createMessages(100);
      const list = createVList(createBasicConfig(container, items));

      list.scrollToIndex(50, { behavior: "smooth", duration: 1000 });
      list.cancelScroll();

      list.destroy();
    });

    it("should handle destroy cleanly in reverse mode", () => {
      const items = createMessages(30);
      const list = createVList(createBasicConfig(container, items));

      list.destroy();

      // Double destroy should not throw
      list.destroy();
    });

    it("should work with overscan in reverse mode", () => {
      const items = createMessages(100);
      const list = createVList(
        createBasicConfig(container, items, { overscan: 10 }),
      );

      expect(list.total).toBe(100);

      list.destroy();
    });

    it("should work with large item counts", () => {
      const items = createMessages(10000);
      const list = createVList(createBasicConfig(container, items));

      expect(list.total).toBe(10000);
      expect(list.getScrollPosition()).toBeGreaterThan(0);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Non-reverse mode is unaffected
  // ---------------------------------------------------------------------------

  describe("non-reverse mode unaffected", () => {
    it("should not auto-scroll appendItems without reverse", () => {
      const items = createMessages(100);
      const list = createVList(
        createBasicConfig(container, items, { reverse: false }),
      );

      // Without reverse, scroll should start at 0
      expect(list.getScrollPosition()).toBe(0);

      list.appendItems(createMessages(5, 101));
      expect(list.total).toBe(105);

      // Scroll should still be at 0 (no auto-scroll behavior)
      expect(list.getScrollPosition()).toBe(0);

      list.destroy();
    });

    it("should not adjust scroll on prependItems without reverse", () => {
      const items = createMessages(50);
      const list = createVList(
        createBasicConfig(container, items, { reverse: false }),
      );

      const scrollBefore = list.getScrollPosition();

      list.prependItems(createMessages(10, -9));
      expect(list.total).toBe(60);

      // Without reverse, no scroll adjustment
      // (the viewport may or may not jump depending on implementation,
      //  but the key point is the behavior differs from reverse mode)
      const scrollAfter = list.getScrollPosition();
      // In non-reverse mode, scroll position is NOT adjusted
      expect(scrollAfter).toBe(scrollBefore);

      list.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Reverse mode with groups (sticky headers work!)
  // ---------------------------------------------------------------------------

  describe("with groups", () => {
    it("should allow reverse mode with non-sticky groups", () => {
      const items = createMessages(20);

      // This should NOT throw when sticky: false
      expect(() => {
        const list = createVList({
          container,
          item: {
            height: 60,
            template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
          },
          items,
          reverse: true,
          groups: {
            getGroupForIndex: (index: number) => items[index]!.sender,
            headerHeight: 30,
            headerTemplate: (group: string) =>
              `<div class="date-header">${group}</div>`,
            sticky: false, // KEY: Inline headers, not sticky
          },
        });
        list.destroy();
      }).not.toThrow();
    });

    it("should render inline headers in reverse mode", () => {
      const items = createMessages(20);

      const list = createVList({
        container,
        item: {
          height: 60,
          template: (msg: ChatMessage) =>
            `<div class="message">${msg.text}</div>`,
        },
        items,
        reverse: true,
        groups: {
          getGroupForIndex: (index: number) => items[index]!.sender,
          headerHeight: 30,
          headerTemplate: (group: string) =>
            `<div class="group-header">${group}</div>`,
          sticky: false,
        },
      });

      expect(list.total).toBe(20);

      // Check that group headers are rendered (they're part of the layout)
      const allItems = container.querySelectorAll("[data-index]");
      expect(allItems.length).toBeGreaterThan(0);

      // Should have some group headers
      const headers = container.querySelectorAll(".group-header");
      expect(headers.length).toBeGreaterThan(0);

      list.destroy();
    });

    it("should start at bottom with inline groups", () => {
      const items = createMessages(100);

      const list = createVList({
        container,
        item: {
          height: 60,
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
        reverse: true,
        groups: {
          getGroupForIndex: (index: number) => {
            // Group by tens for testing
            return `Group ${Math.floor(index / 10)}`;
          },
          headerHeight: 30,
          headerTemplate: (group: string) => `<div>${group}</div>`,
          sticky: false,
        },
      });

      const scrollTop = list.getScrollPosition();
      const maxScroll = container.scrollHeight - container.clientHeight;

      // Should be at or near bottom
      expect(scrollTop).toBeGreaterThan(maxScroll * 0.9);

      list.destroy();
    });

    it("should work with scrollToIndex when using inline groups", () => {
      const items = createMessages(30);

      const list = createVList({
        container,
        item: {
          height: 60,
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
        reverse: true,
        groups: {
          getGroupForIndex: (index: number) => items[index]!.sender,
          headerHeight: 30,
          headerTemplate: (group: string) => `<div>${group}</div>`,
          sticky: false,
        },
      });

      expect(list.total).toBe(30);

      // scrollToIndex should work with groups
      expect(() => {
        list.scrollToIndex(15, "center");
      }).not.toThrow();

      list.destroy();
    });

    it("should support data operations with inline groups", () => {
      const items = createMessages(20);

      const list = createVList({
        container,
        item: {
          height: 60,
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
        reverse: true,
        groups: {
          getGroupForIndex: (index: number) => items[index]!.sender,
          headerHeight: 30,
          headerTemplate: (group: string) => `<div>${group}</div>`,
          sticky: false,
        },
      });

      expect(list.total).toBe(20);

      // Should start at bottom
      const scrollBefore = list.getScrollPosition();
      const maxScrollBefore = container.scrollHeight - container.clientHeight;
      expect(scrollBefore).toBeGreaterThan(maxScrollBefore * 0.8);

      list.destroy();
    });

    it("should work with sticky headers in reverse mode", () => {
      const items = createMessages(20);

      // Sticky headers should work with reverse mode
      expect(() => {
        const list = createVList({
          container,
          item: {
            height: 60,
            template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
          },
          items,
          reverse: true,
          groups: {
            getGroupForIndex: (index: number) => items[index]!.sender,
            headerHeight: 30,
            headerTemplate: (group: string) => `<div>${group}</div>`,
            sticky: true, // Sticky headers work in reverse mode!
          },
        });
        list.destroy();
      }).not.toThrow();
    });

    it("should work with variable heights and inline groups", () => {
      const items = createMessages(30);

      const list = createVList({
        container,
        item: {
          height: (index: number) => {
            // Variable heights based on message content
            const msg = items[index]!;
            return msg.text.length > 20 ? 80 : 60;
          },
          template: (msg: ChatMessage) => `<div>${msg.text}</div>`,
        },
        items,
        reverse: true,
        groups: {
          getGroupForIndex: (index: number) => items[index]!.sender,
          headerHeight: 30,
          headerTemplate: (group: string) => `<div>${group}</div>`,
          sticky: false,
        },
      });

      expect(list.total).toBe(30);

      // Should still start at bottom
      const scrollTop = list.getScrollPosition();
      const maxScroll = container.scrollHeight - container.clientHeight;
      expect(scrollTop).toBeGreaterThan(maxScroll * 0.8);

      list.destroy();
    });
  });
});
