/**
 * vlist - Accessibility Tests
 * Tests for ARIA attributes, live regions, and screen reader support
 *
 * Covers:
 * - aria-setsize / aria-posinset on rendered items
 * - aria-activedescendant on root for keyboard focus tracking
 * - aria-busy during async data loading
 * - Live region for selection announcements
 * - Unique element IDs for aria-activedescendant references
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
import { createVList } from "../src/core/full";
import { createVList as createVListCore } from "../src/core/lite";
import type { VListItem, VList, VListAdapter } from "../src/types";

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
              width: 300,
              height: 500,
              top: 0,
              left: 0,
              bottom: 500,
              right: 300,
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

  // Mock requestAnimationFrame
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
  dom.window.close();
});

// =============================================================================
// Test Utilities
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));
};

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  container.style.height = "500px";
  container.style.width = "300px";
  document.body.appendChild(container);
  return container;
};

const cleanupContainer = (container: HTMLElement): void => {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
};

const template = (item: TestItem): string => {
  return `<div class="item">${item.name}</div>`;
};

/** Get all rendered item elements from a vlist root */
const getRenderedItems = (root: HTMLElement): HTMLElement[] => {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
};

// =============================================================================
// aria-setsize and aria-posinset
// =============================================================================

describe("aria-setsize and aria-posinset", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should set aria-setsize on all rendered items", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("100");
    }
  });

  it("should set aria-posinset (1-based) on all rendered items", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    for (const el of renderedItems) {
      const index = parseInt(el.dataset.index ?? "-1", 10);
      expect(index).toBeGreaterThanOrEqual(0);
      // aria-posinset is 1-based
      expect(el.getAttribute("aria-posinset")).toBe(String(index + 1));
    }
  });

  it("should update aria-setsize when items are appended", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // Initially 20 items
    let renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("20");
    }

    // Append 30 more items
    const moreItems = createTestItems(30).map((item) => ({
      ...item,
      id: item.id + 20,
      name: `Item ${item.id + 20}`,
    }));
    vlist.appendItems(moreItems);

    // After append, new items should have updated setsize
    renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("50");
    }
  });

  it("should update aria-setsize when items are replaced", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // Replace with fewer items
    const fewerItems = createTestItems(25);
    vlist.setItems(fewerItems);

    const renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("25");
    }
  });

  it("should handle single item correctly", () => {
    // Use enough items to guarantee at least one renders in JSDOM's mock viewport
    const items = createTestItems(5);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThanOrEqual(1);

    // First rendered item should have correct 1-based posinset
    const first = renderedItems[0]!;
    const index = parseInt(first.dataset.index ?? "-1", 10);
    expect(first.getAttribute("aria-setsize")).toBe("5");
    expect(first.getAttribute("aria-posinset")).toBe(String(index + 1));
  });

  it("should work with variable item heights", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: {
        height: (index: number) => 30 + (index % 3) * 10,
        template,
      },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("50");
      const index = parseInt(el.dataset.index ?? "-1", 10);
      expect(el.getAttribute("aria-posinset")).toBe(String(index + 1));
    }
  });
});

// =============================================================================
// Unique element IDs
// =============================================================================

describe("unique element IDs", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should assign unique IDs to rendered items", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    const ids = new Set<string>();
    for (const el of renderedItems) {
      expect(el.id).toBeTruthy();
      expect(ids.has(el.id)).toBe(false);
      ids.add(el.id);
    }
  });

  it("should include the item index in the element ID", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      const index = el.dataset.index;
      expect(el.id).toContain(`item-${index}`);
    }
  });

  it("should generate different ID prefixes for multiple instances", () => {
    const container2 = createContainer();
    const items = createTestItems(10);

    const vlist1 = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const vlist2 = createVList({
      container: container2,
      item: { height: 40, template },
      items,
    });

    const items1 = getRenderedItems(vlist1.element);
    const items2 = getRenderedItems(vlist2.element);

    expect(items1.length).toBeGreaterThan(0);
    expect(items2.length).toBeGreaterThan(0);

    // The ID prefixes should be different (different instance counters)
    // e.g. "vlist-0-item-0" vs "vlist-1-item-0"
    const id1 = items1[0]!.id;
    const id2 = items2[0]!.id;
    expect(id1).not.toBe(id2);

    vlist1.destroy();
    vlist2.destroy();
    cleanupContainer(container2);
    vlist = null; // prevent afterEach from double-destroying
  });
});

// =============================================================================
// aria-activedescendant (keyboard focus tracking)
// =============================================================================

describe("aria-activedescendant", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should not set aria-activedescendant initially", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    expect(vlist.element.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("should set aria-activedescendant on ArrowDown", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    // Simulate ArrowDown keypress
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    vlist.element.dispatchEvent(event);

    const activeId = vlist.element.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    // Should point to an item with index 0 (first ArrowDown from -1 goes to 0)
    expect(activeId).toContain("item-0");
  });

  it("should update aria-activedescendant as focus moves", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    // ArrowDown → focus index 0
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    const id0 = vlist.element.getAttribute("aria-activedescendant");
    expect(id0).toContain("item-0");

    // ArrowDown → focus index 1
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    const id1 = vlist.element.getAttribute("aria-activedescendant");
    expect(id1).toContain("item-1");
    expect(id1).not.toBe(id0);
  });

  it("should update aria-activedescendant on Home and End", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    // First ArrowDown to establish focus
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );

    // Home → focus index 0
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(vlist.element.getAttribute("aria-activedescendant")).toContain(
      "item-0",
    );

    // End → focus last item
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(vlist.element.getAttribute("aria-activedescendant")).toContain(
      "item-49",
    );
  });

  it("should reference an existing element with matching ID", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    // ArrowDown to focus first item
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );

    const activeId = vlist.element.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();

    // The referenced element should actually exist in the DOM
    const referencedElement = vlist.element.querySelector(`#${activeId}`);
    expect(referencedElement).not.toBeNull();
    expect(referencedElement?.getAttribute("role")).toBe("option");
  });

  it("should update aria-activedescendant on item click with selection", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    // Find a rendered item element and simulate click
    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    const targetItem = renderedItems[2]; // click on the 3rd rendered item
    if (targetItem) {
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      targetItem.dispatchEvent(clickEvent);

      const activeId = vlist.element.getAttribute("aria-activedescendant");
      expect(activeId).toBeTruthy();

      const index = targetItem.dataset.index;
      expect(activeId).toContain(`item-${index}`);
    }
  });

  it("should not set aria-activedescendant when selection mode is none", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      // No selection config = selection mode "none"
    });

    // ArrowDown should not update aria-activedescendant
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(vlist.element.hasAttribute("aria-activedescendant")).toBe(false);
  });
});

// =============================================================================
// aria-busy (loading state)
// =============================================================================

describe("aria-busy", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    cleanupContainer(container);
  });

  it("should not have aria-busy without adapter", () => {
    const items = createTestItems(20);
    const vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    expect(vlist.element.hasAttribute("aria-busy")).toBe(false);
    vlist.destroy();
  });

  it("should set aria-busy when adapter starts loading", async () => {
    let resolveRead: ((value: any) => void) | undefined;

    const adapter: VListAdapter<TestItem> = {
      read: () => {
        return new Promise<any>((resolve) => {
          resolveRead = resolve;
        });
      },
    };

    const vlist = createVList({
      container,
      item: { height: 40, template },
      adapter,
    });

    // The adapter triggers an initial load — aria-busy should be set
    // Give the event loop a chance to process
    await new Promise((r) => setTimeout(r, 10));
    expect(vlist.element.getAttribute("aria-busy")).toBe("true");

    // Resolve the load
    if (resolveRead) {
      resolveRead({
        items: createTestItems(20),
        total: 20,
        hasMore: false,
      });
    }

    await new Promise((r) => setTimeout(r, 10));
    // After loading completes, aria-busy should be removed
    expect(vlist.element.hasAttribute("aria-busy")).toBe(false);

    vlist.destroy();
  });
});

// =============================================================================
// Live region (selection announcements)
// =============================================================================

describe("live region", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should create a live region element", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.getAttribute("aria-atomic")).toBe("true");
  });

  it("should have the live region visually hidden", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    const liveRegion = vlist.element.querySelector(
      '[aria-live="polite"]',
    ) as HTMLElement;
    expect(liveRegion).not.toBeNull();
    // Check visually-hidden styles
    expect(liveRegion.style.position).toBe("absolute");
    expect(liveRegion.style.overflow).toBe("hidden");
  });

  it("should announce single selection", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    vlist.select(1);

    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe("1 item selected");
  });

  it("should announce multiple selections", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "multiple" },
    });

    vlist.select(1, 2, 3);

    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe("3 items selected");
  });

  it("should clear announcement when selection is cleared", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "multiple" },
    });

    vlist.select(1, 2);
    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe("2 items selected");

    vlist.clearSelection();
    expect(liveRegion?.textContent).toBe("");
  });

  it("should update announcement as selection changes", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "multiple" },
    });

    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');

    vlist.select(1);
    expect(liveRegion?.textContent).toBe("1 item selected");

    vlist.select(2);
    expect(liveRegion?.textContent).toBe("2 items selected");

    vlist.deselect(1);
    expect(liveRegion?.textContent).toBe("1 item selected");
  });

  it("should not create live region without selection mode", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // Live region should only exist when selection plugin is active
    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeNull();
  });

  it("should remove live region on destroy", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    const root = vlist.element;
    expect(root.querySelector('[aria-live="polite"]')).not.toBeNull();

    vlist.destroy();
    vlist = null;

    // After destroy, the entire root is removed from the DOM
    expect(root.parentNode).toBeNull();
  });
});

// =============================================================================
// Baseline ARIA (pre-existing features should still work)
// =============================================================================

describe("baseline ARIA attributes", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should have role=listbox on root", () => {
    vlist = createVList({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
    });

    expect(vlist.element.getAttribute("role")).toBe("listbox");
  });

  it("should have role=option on each item", () => {
    vlist = createVList({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
    });

    const items = getRenderedItems(vlist.element);
    expect(items.length).toBeGreaterThan(0);

    for (const el of items) {
      expect(el.getAttribute("role")).toBe("option");
    }
  });

  it("should have tabindex=0 on root for focusability", () => {
    vlist = createVList({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
    });

    expect(vlist.element.getAttribute("tabindex")).toBe("0");
  });

  it("should set aria-label when provided", () => {
    vlist = createVList({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      ariaLabel: "Contact list",
    });

    expect(vlist.element.getAttribute("aria-label")).toBe("Contact list");
  });

  it("should set aria-selected on items", () => {
    vlist = createVList({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      selection: { mode: "single" },
    });

    const items = getRenderedItems(vlist.element);
    for (const el of items) {
      expect(el.getAttribute("aria-selected")).toBe("false");
    }

    // Select first item
    vlist.select(1);

    const selectedItems = getRenderedItems(vlist.element);
    const selectedEl = selectedItems.find((el) => el.dataset.id === "1");
    if (selectedEl) {
      expect(selectedEl.getAttribute("aria-selected")).toBe("true");
    }
  });
});

// =============================================================================
// Core (lightweight) ARIA
// =============================================================================

describe("core vlist accessibility", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    cleanupContainer(container);
  });

  it("should set aria-setsize and aria-posinset on core items", () => {
    const items = createTestItems(30);
    const vlist = createVListCore({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("30");
      const index = parseInt(el.dataset.index ?? "-1", 10);
      expect(el.getAttribute("aria-posinset")).toBe(String(index + 1));
    }

    vlist.destroy();
  });

  it("should assign unique IDs to core items", () => {
    const items = createTestItems(20);
    const vlist = createVListCore({
      container,
      item: { height: 40, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    const ids = new Set<string>();

    for (const el of renderedItems) {
      expect(el.id).toBeTruthy();
      expect(ids.has(el.id)).toBe(false);
      ids.add(el.id);
    }

    vlist.destroy();
  });

  it("should update aria-setsize when core items change", () => {
    const items = createTestItems(10);
    const vlist = createVListCore({
      container,
      item: { height: 40, template },
      items,
    });

    let renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("10");
    }

    // Append items
    const moreItems = Array.from({ length: 5 }, (_, i) => ({
      id: 11 + i,
      name: `Item ${11 + i}`,
    }));
    vlist.appendItems(moreItems);

    renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("15");
    }

    vlist.destroy();
  });

  it("should have role=listbox and role=option in core mode", () => {
    const items = createTestItems(10);
    const vlist = createVListCore({
      container,
      item: { height: 40, template },
      items,
    });

    expect(vlist.element.getAttribute("role")).toBe("listbox");

    const renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      expect(el.getAttribute("role")).toBe("option");
    }

    vlist.destroy();
  });
});

// =============================================================================
// Grid mode ARIA
// =============================================================================

describe("grid mode accessibility", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should set aria-setsize to total items (not rows) in grid mode", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      layout: "grid",
      grid: { columns: 4, gap: 8 },
      item: { height: 100, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    expect(renderedItems.length).toBeGreaterThan(0);

    // aria-setsize should be 100 (total items), not 25 (total rows)
    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("100");
    }
  });

  it("should set aria-posinset based on flat item index in grid mode", () => {
    const items = createTestItems(40);
    vlist = createVList({
      container,
      layout: "grid",
      grid: { columns: 4, gap: 8 },
      item: { height: 100, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      const index = parseInt(el.dataset.index ?? "-1", 10);
      expect(el.getAttribute("aria-posinset")).toBe(String(index + 1));
    }
  });

  it("should assign unique IDs in grid mode", () => {
    const items = createTestItems(40);
    vlist = createVList({
      container,
      layout: "grid",
      grid: { columns: 4, gap: 8 },
      item: { height: 100, template },
      items,
    });

    const renderedItems = getRenderedItems(vlist.element);
    const ids = new Set<string>();

    for (const el of renderedItems) {
      expect(el.id).toBeTruthy();
      expect(ids.has(el.id)).toBe(false);
      ids.add(el.id);
    }
  });
});

// =============================================================================
// Combined keyboard + ARIA integration
// =============================================================================

describe("keyboard navigation ARIA integration", () => {
  let container: HTMLElement;
  let vlist: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (vlist) {
      vlist.destroy();
      vlist = null;
    }
    cleanupContainer(container);
  });

  it("should update both aria-activedescendant and selection announcement on Space", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "multiple" },
    });

    // Move focus down then select with Space
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    vlist.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );

    // aria-activedescendant should point to focused item
    const activeId = vlist.element.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();

    // Live region should announce the selection
    const liveRegion = vlist.element.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe("1 item selected");
  });

  it("should maintain all ARIA attributes during rapid keyboard navigation", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "single" },
    });

    // Rapidly press ArrowDown 10 times
    for (let i = 0; i < 10; i++) {
      vlist.element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    // aria-activedescendant should point to the 10th item (index 9)
    const activeId = vlist.element.getAttribute("aria-activedescendant");
    expect(activeId).toContain("item-9");

    // All rendered items should still have proper aria-setsize / aria-posinset
    const renderedItems = getRenderedItems(vlist.element);
    for (const el of renderedItems) {
      expect(el.getAttribute("aria-setsize")).toBe("50");
      const index = parseInt(el.dataset.index ?? "-1", 10);
      expect(el.getAttribute("aria-posinset")).toBe(String(index + 1));
    }
  });
});
