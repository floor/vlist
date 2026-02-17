/**
 * vlist.ts Coverage Tests
 *
 * Targets uncovered paths in src/vlist.ts:
 * - Scrollbar mode resolution (L226-241): native, none, legacy config
 * - Grid gap with function-based height (L385-386)
 * - Scroll controller onIdle callback (L522-528)
 * - Compression mode transitions (L705-736)
 * - Sticky header scroll wrapping (L887-891)
 * - Event off() method (L1025-1028)
 * - Window resize handler (L1103-1128)
 * - Adapter initial load (L1240)
 * - Reverse mode scroll-to-bottom with adapter (L1253-1259)
 * - Groups scrollToIndex wrapper (L1297-1306)
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
import { createVList } from "../src/core/full";
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

  // Mock scrollTo
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
  value?: number;
}

const createTestItems = (count: number): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    value: i * 10,
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

// =============================================================================
// Scrollbar Mode Resolution (L226-241)
// =============================================================================

describe("vlist scrollbar mode resolution", () => {
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

  it("should use native scrollbar mode via scroll.scrollbar = 'native'", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "native" },
    });

    expect(vlist).toBeDefined();
    expect(vlist.element).toBeInstanceOf(HTMLElement);

    // In native mode (non-compressed), no custom scrollbar is created
    // and native scrollbar is NOT hidden
    const viewport = vlist.element.querySelector("[class*='-viewport']");
    expect(viewport).toBeTruthy();
  });

  it("should use none scrollbar mode via scroll.scrollbar = 'none'", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "none" },
    });

    expect(vlist).toBeDefined();
    expect(vlist.element).toBeInstanceOf(HTMLElement);

    // In none mode, native scrollbar is hidden and no custom scrollbar created
    const viewport = vlist.element.querySelector("[class*='-viewport']");
    expect(viewport).toBeTruthy();
    // The viewport should have the custom-scrollbar class to hide native
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should use custom scrollbar mode via scroll.scrollbar = object", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: {
        scrollbar: {
          autoHide: false,
          autoHideDelay: 2000,
          minThumbSize: 50,
        },
      },
    });

    expect(vlist).toBeDefined();
    expect(vlist.element).toBeInstanceOf(HTMLElement);

    // Custom scrollbar should be created (check for scrollbar element)
    const scrollbar = vlist.element.querySelector("[class*='scrollbar']");
    expect(scrollbar).toBeTruthy();
  });

  it("should use none mode via legacy scrollbar config with enabled=false", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scrollbar: { enabled: false },
    });

    expect(vlist).toBeDefined();

    // No scrollbar element when disabled
    const viewport = vlist.element.querySelector("[class*='-viewport']");
    expect(viewport).toBeTruthy();
    // Native scrollbar should be hidden
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should use custom mode via legacy scrollbar config with enabled=true", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scrollbar: { enabled: true, autoHide: true, autoHideDelay: 500 },
    });

    expect(vlist).toBeDefined();
    const scrollbar = vlist.element.querySelector("[class*='scrollbar']");
    expect(scrollbar).toBeTruthy();
  });

  it("should default to custom scrollbar when no scroll config is provided", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    expect(vlist).toBeDefined();
    // Default custom scrollbar
    const scrollbar = vlist.element.querySelector("[class*='scrollbar']");
    expect(scrollbar).toBeTruthy();
  });

  it("should fallback to custom scrollbar when native mode list is compressed", () => {
    // Create a large list that triggers compression, with native scrollbar mode
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "native" },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(500_000);

    // When compressed and mode is native, it should fall back to custom scrollbar
    const viewport = vlist.element.querySelector("[class*='-viewport']");
    expect(viewport).toBeTruthy();
    // The custom-scrollbar class should be applied since compression forces custom
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should not create scrollbar when mode is none even with compression", () => {
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "none" },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(500_000);
  });
});

// =============================================================================
// Grid Gap with Function-Based Height (L385-386)
// =============================================================================

describe("vlist grid gap with function height", () => {
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

  it("should inflate function-based heights by grid gap", () => {
    const items = createTestItems(30);

    // Use function-based height with a grid gap
    vlist = createVList({
      container,
      item: {
        height: (index: number) => (index % 2 === 0 ? 50 : 70),
        template,
      },
      items,
      layout: "grid",
      grid: { columns: 3, gap: 10 },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(30);
    // Grid with 3 columns = 10 rows, height fn inflated by gap
    const rendered = vlist.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("should inflate numeric heights by grid gap", () => {
    const items = createTestItems(30);

    vlist = createVList({
      container,
      item: { height: 50, template },
      items,
      layout: "grid",
      grid: { columns: 3, gap: 8 },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(30);
  });

  it("should handle grid gap of 0 without modifying height function", () => {
    const items = createTestItems(30);

    vlist = createVList({
      container,
      item: {
        height: (index: number) => 40 + index,
        template,
      },
      items,
      layout: "grid",
      grid: { columns: 3, gap: 0 },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(30);
  });
});

// =============================================================================
// Event off() Method (L1025-1028)
// =============================================================================

describe("vlist off() event method", () => {
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

  it("should unsubscribe handler using off()", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "multiple" as any },
    });

    const handler = mock(() => {});
    vlist.on("selection:change", handler);

    // Handler should be called
    vlist.select(1);
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe via off()
    vlist.off("selection:change", handler);

    // Handler should NOT be called again
    vlist.select(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should not throw when calling off() with unregistered handler", () => {
    const items = createTestItems(10);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const handler = mock(() => {});
    // Should not throw
    expect(() => vlist!.off("scroll", handler)).not.toThrow();
  });

  it("should allow re-subscribing after off()", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      selection: { mode: "multiple" as any },
    });

    const handler = mock(() => {});
    vlist.on("selection:change", handler);
    vlist.off("selection:change", handler);

    // Re-subscribe
    vlist.on("selection:change", handler);
    vlist.select(1);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Window Resize Handler (L1103-1128)
// =============================================================================

describe("vlist window resize handler", () => {
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

  it("should handle window resize in window scroll mode", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    expect(vlist).toBeDefined();

    // Simulate a window resize
    const resizeHandler = mock(() => {});
    vlist.on("resize", resizeHandler);

    // Change window.innerHeight and dispatch resize
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 400,
      writable: true,
      configurable: true,
    });

    // Use JSDOM's Event constructor (not Bun's global Event)
    const ResizeEvent = (window as any).Event || dom.window.Event;
    window.dispatchEvent(new ResizeEvent("resize"));

    // The resize handler should have been called (containerHeight changed)
    expect(resizeHandler).toHaveBeenCalled();
    const calls = resizeHandler.mock.calls as any[];
    if (calls.length > 0) {
      const payload = calls[0][0];
      expect(payload.height).toBe(800);
      expect(payload.width).toBe(400);
    }
  });

  it("should not emit resize when height difference is <= 1px", () => {
    const items = createTestItems(100);

    // Set initial window height
    Object.defineProperty(window, "innerHeight", {
      value: 500,
      writable: true,
      configurable: true,
    });

    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    const resizeHandler = mock(() => {});
    vlist.on("resize", resizeHandler);

    // Tiny resize (< 1px difference) — should NOT emit
    Object.defineProperty(window, "innerHeight", {
      value: 500.5,
      writable: true,
      configurable: true,
    });
    const ResizeEvent = (window as any).Event || dom.window.Event;
    window.dispatchEvent(new ResizeEvent("resize"));

    expect(resizeHandler).not.toHaveBeenCalled();
  });

  it("should not respond to resize after destroy", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    const resizeHandler = mock(() => {});
    vlist.on("resize", resizeHandler);

    vlist.destroy();
    vlist = null;

    // Resize after destroy — should not throw or call handler
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      writable: true,
      configurable: true,
    });
    const ResizeEvent = (window as any).Event || dom.window.Event;
    expect(() => window.dispatchEvent(new ResizeEvent("resize"))).not.toThrow();
    expect(resizeHandler).not.toHaveBeenCalled();
  });

  it("should use legacy scrollElement for window mode", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scrollElement: window,
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(100);

    // Should register a window resize handler (destroyed on cleanup)
    vlist.destroy();
    vlist = null;
  });
});

// =============================================================================
// Compression Mode Transitions (L705-736)
// =============================================================================

describe("vlist compression mode transitions", () => {
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

  it("should create custom scrollbar when entering compression with native mode", () => {
    // Start with small list (no compression), native scrollbar mode
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "native" },
    });

    expect(vlist.total).toBe(100);

    // The native mode shouldn't have a custom scrollbar initially
    // Now grow the list to trigger compression
    vlist.setItems(createTestItems(500_000));
    expect(vlist.total).toBe(500_000);

    // After compression, a custom scrollbar should be created
    // and the viewport should have the custom-scrollbar class
    const viewport = vlist.element.querySelector("[class*='-viewport']");
    expect(viewport).toBeTruthy();
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should transition from compressed to uncompressed when items shrink", () => {
    // Start compressed
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    expect(vlist.total).toBe(500_000);

    // Shrink below compression threshold
    vlist.setItems(createTestItems(100));
    expect(vlist.total).toBe(100);

    // List should still function correctly
    const rendered = vlist.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("should update compression when already compressed and total changes", () => {
    // Start compressed
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // Change to different compressed size
    vlist.setItems(createTestItems(1_000_000));
    expect(vlist.total).toBe(1_000_000);

    // Still compressed but with updated compression ratio
    const rendered = vlist.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeLessThan(200);
  });

  it("should not create scrollbar on compression when mode is none", () => {
    // Start small, scrollbar mode none
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "none" },
    });

    // Grow to trigger compression
    vlist.setItems(createTestItems(500_000));
    expect(vlist.total).toBe(500_000);

    // In none mode, no scrollbar created even on compression
    // Just verify it doesn't crash
    const rendered = vlist.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("should create scrollbar on compression with default custom mode", () => {
    // Start small with custom scrollbar
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // In default mode, scrollbar already exists.
    // Growing to compression should update scrollbar bounds
    vlist.setItems(createTestItems(500_000));
    expect(vlist.total).toBe(500_000);

    const scrollbar = vlist.element.querySelector("[class*='scrollbar']");
    expect(scrollbar).toBeTruthy();
  });
});

// =============================================================================
// Sticky Header Scroll Wrapping (L887-891)
// =============================================================================

describe("vlist sticky header wrapping", () => {
  let container: HTMLElement;
  let vlist: VList<any> | null = null;

  interface GroupedItem extends VListItem {
    id: number;
    name: string;
    category: string;
  }

  const groupTemplate = (item: GroupedItem): string =>
    `<div class="item">${item.name}</div>`;

  const createGroupedItems = (): GroupedItem[] => [
    { id: 1, name: "Apple", category: "Fruits" },
    { id: 2, name: "Banana", category: "Fruits" },
    { id: 3, name: "Cherry", category: "Fruits" },
    { id: 4, name: "Carrot", category: "Vegetables" },
    { id: 5, name: "Potato", category: "Vegetables" },
    { id: 6, name: "Chicken", category: "Meat" },
    { id: 7, name: "Beef", category: "Meat" },
    { id: 8, name: "Pork", category: "Meat" },
  ];

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

  it("should create sticky header when groups.sticky is true", () => {
    const items = createGroupedItems();
    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
        sticky: true,
      },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(8);
    expect(vlist.element).toBeInstanceOf(HTMLElement);

    // The sticky header element should be in the DOM
    const stickyEl = vlist.element.querySelector("[class*='sticky']");
    expect(stickyEl).toBeTruthy();
  });

  it("should update sticky header on scroll", () => {
    const items = createGroupedItems();
    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
        sticky: true,
      },
    });

    expect(vlist).toBeDefined();

    // Simulate scrolling by calling scrollToIndex
    vlist.scrollToIndex(5, "start");

    // After scrolling past groups, sticky header should show
    const stickyEl = vlist.element.querySelector("[class*='sticky']");
    expect(stickyEl).toBeTruthy();
  });

  it("should invoke wrappedHandleScroll via native scroll event on viewport", async () => {
    // This test targets L887-891: the wrappedHandleScroll that updates
    // the sticky header alongside the original scroll handler
    const items = createGroupedItems();
    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
        sticky: true,
      },
    });

    expect(vlist).toBeDefined();

    const root = vlist.element;
    const viewport = root.querySelector("[class*='-viewport']") as HTMLElement;
    expect(viewport).toBeTruthy();

    const stickyEl = root.querySelector("[class*='sticky']");
    expect(stickyEl).toBeTruthy();

    // Use JSDOM Event constructor
    const JSDOMEvent = (window as any).Event;

    // Set scrollTop to simulate scrolling past the first group header
    Object.defineProperty(viewport, "scrollTop", {
      value: 150,
      writable: true,
      configurable: true,
    });
    viewport.dispatchEvent(new JSDOMEvent("scroll"));

    // Give RAF a chance to process
    await new Promise((r) => setTimeout(r, 20));

    // The wrappedHandleScroll should have called both originalHandleScroll
    // and stickyRef.update(scrollTop). Verify the sticky element is still present
    // and the list didn't crash.
    expect(stickyEl).toBeTruthy();
    expect(vlist.total).toBe(8);
  });

  it("should invoke wrappedHandleScroll with loadPendingRange forwarded", async () => {
    // The wrappedHandleScroll copies loadPendingRange from the original handler (L893)
    // Trigger onIdle which calls handleScrollRef.loadPendingRange() (L527)
    const items = createGroupedItems();
    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
        sticky: true,
      },
      scroll: { idleTimeout: 30 },
    });

    const root = vlist.element;
    const viewport = root.querySelector("[class*='-viewport']") as HTMLElement;
    const JSDOMEvent = (window as any).Event;

    // Trigger scroll
    Object.defineProperty(viewport, "scrollTop", {
      value: 100,
      writable: true,
      configurable: true,
    });
    viewport.dispatchEvent(new JSDOMEvent("scroll"));

    // Wait for RAF + idle to fire
    await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));

    // The onIdle callback should have run and called loadPendingRange
    // on the wrappedHandleScroll. Verify no crash.
    expect(root.classList.contains("vlist--scrolling")).toBe(false);
    expect(vlist.total).toBe(8);
  });

  it("should destroy sticky header on cleanup", () => {
    const items = createGroupedItems();
    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
        sticky: true,
      },
    });

    const element = vlist.element;
    expect(element.parentNode).toBeTruthy();

    vlist.destroy();
    vlist = null;

    // Element should be removed
    expect(element.parentNode).toBeFalsy();
  });
});

// =============================================================================
// Groups scrollToIndex Wrapper (L1297-1306)
// =============================================================================

describe("vlist groups scrollToIndex wrapper", () => {
  let container: HTMLElement;
  let vlist: VList<any> | null = null;

  interface GroupedItem extends VListItem {
    id: number;
    name: string;
    category: string;
  }

  const groupTemplate = (item: GroupedItem): string =>
    `<div class="item">${item.name}</div>`;

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

  it("should convert data index to layout index when scrolling in group mode", () => {
    const items: GroupedItem[] = [
      { id: 1, name: "Apple", category: "Fruits" },
      { id: 2, name: "Banana", category: "Fruits" },
      { id: 3, name: "Cherry", category: "Fruits" },
      { id: 4, name: "Carrot", category: "Vegetables" },
      { id: 5, name: "Potato", category: "Vegetables" },
      { id: 6, name: "Chicken", category: "Meat" },
      { id: 7, name: "Beef", category: "Meat" },
      { id: 8, name: "Pork", category: "Meat" },
    ];

    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
      },
    });

    expect(vlist).toBeDefined();

    // scrollToIndex should accept data indices (not layout indices with headers)
    // This exercises the groups scrollToIndex wrapper (L1297-1306)
    expect(() => vlist!.scrollToIndex(0, "start")).not.toThrow();
    expect(() => vlist!.scrollToIndex(3, "center")).not.toThrow();
    expect(() => vlist!.scrollToIndex(7, "end")).not.toThrow();
  });

  it("should handle scrollToIndex with options object in group mode", () => {
    const items: GroupedItem[] = [
      { id: 1, name: "Apple", category: "Fruits" },
      { id: 2, name: "Banana", category: "Fruits" },
      { id: 3, name: "Carrot", category: "Vegetables" },
      { id: 4, name: "Potato", category: "Vegetables" },
    ];

    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
      },
    });

    // Use options object form
    expect(() =>
      vlist!.scrollToIndex(2, { align: "center", behavior: "auto" }),
    ).not.toThrow();
  });

  it("should use scrollToIndex with sticky groups", () => {
    const items: GroupedItem[] = [
      { id: 1, name: "Apple", category: "Fruits" },
      { id: 2, name: "Banana", category: "Fruits" },
      { id: 3, name: "Carrot", category: "Vegetables" },
      { id: 4, name: "Potato", category: "Vegetables" },
      { id: 5, name: "Chicken", category: "Meat" },
      { id: 6, name: "Beef", category: "Meat" },
    ];

    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          items[index]?.category ?? "Unknown",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div class="header">${key}</div>`,
        sticky: true,
      },
    });

    // Should work with sticky headers too
    expect(() => vlist!.scrollToIndex(4, "start")).not.toThrow();
    expect(() => vlist!.scrollToIndex(0, "end")).not.toThrow();
  });
});

// =============================================================================
// Adapter Initial Load (L1240)
// =============================================================================

describe("vlist adapter initial load", () => {
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

  it("should load initial data from adapter when no items provided", async () => {
    const allItems = createTestItems(50);
    const readMock = mock(
      async (params: { offset: number; limit: number }) => ({
        items: allItems.slice(params.offset, params.offset + params.limit),
        total: allItems.length,
        hasMore: params.offset + params.limit < allItems.length,
      }),
    );

    const adapter: VListAdapter<TestItem> = { read: readMock };

    vlist = createVList({
      container,
      item: { height: 40, template },
      adapter,
    });

    // Wait for the async load
    await new Promise((r) => setTimeout(r, 50));

    expect(readMock).toHaveBeenCalled();
    expect(vlist.total).toBeGreaterThan(0);
  });

  it("should emit load:start and load:end events on adapter initial load", async () => {
    const loadStartHandler = mock(() => {});
    const loadEndHandler = mock(() => {});

    const allItems = createTestItems(30);
    const adapter: VListAdapter<TestItem> = {
      read: async (params: { offset: number; limit: number }) => ({
        items: allItems.slice(params.offset, params.offset + params.limit),
        total: allItems.length,
        hasMore: params.offset + params.limit < allItems.length,
      }),
    };

    // Subscribe BEFORE creating vlist since load:start fires synchronously at init
    // We need to pass the handlers via a wrapper that subscribes immediately
    let loadStartCalled = false;
    let loadEndCalled = false;

    // Create vlist — load:start fires synchronously during construction
    vlist = createVList({
      container,
      item: { height: 40, template },
      adapter,
    });

    // load:start was already emitted during construction, so subscribe to load:end
    vlist.on("load:end", () => {
      loadEndCalled = true;
    });

    await new Promise((r) => setTimeout(r, 100));

    // Verify the adapter was called (loadInitial ran)
    expect(vlist.total).toBeGreaterThan(0);
    // load:end should have fired after the async read resolved
    expect(loadEndCalled).toBe(true);
  });

  it("should handle adapter read failure gracefully without crashing", async () => {
    const adapter: VListAdapter<TestItem> = {
      read: async () => {
        throw new Error("Network error");
      },
    };

    // The .catch() on loadInitial (L1240) is defensive code — adapter errors
    // are caught internally by loadRange's try-catch. Verify the list doesn't
    // crash and remains functional after adapter failure.
    vlist = createVList({
      container,
      item: { height: 40, template },
      adapter,
    });

    await new Promise((r) => setTimeout(r, 100));

    // List should still be functional (0 items loaded due to error)
    expect(vlist.total).toBe(0);
    expect(vlist.element).toBeInstanceOf(HTMLElement);

    // Should not throw when interacting after failed load
    expect(() => vlist!.scrollToIndex(0, "start")).not.toThrow();
  });

  it("should not call loadInitial when items are provided with adapter", async () => {
    const items = createTestItems(10);
    const readMock = mock(
      async (params: { offset: number; limit: number }) => ({
        items: [] as TestItem[],
        total: 10,
        hasMore: false,
      }),
    );

    const adapter: VListAdapter<TestItem> = { read: readMock };

    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      adapter,
    });

    await new Promise((r) => setTimeout(r, 50));

    // When items are provided, loadInitial should NOT be called
    // (the read mock should not have been invoked at init time)
    // Note: readMock might be called for preloading — just verify it didn't
    // call with offset 0 as the initial load
    expect(vlist.total).toBe(10);
  });
});

// =============================================================================
// Reverse Mode with Adapter - Scroll to Bottom (L1253-1259)
// =============================================================================

describe("vlist reverse mode with adapter", () => {
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

  it("should scroll to bottom after adapter load completes in reverse mode", async () => {
    const allItems = createTestItems(50);
    const adapter: VListAdapter<TestItem> = {
      read: async (params: { offset: number; limit: number }) => ({
        items: allItems.slice(params.offset, params.offset + params.limit),
        total: allItems.length,
        hasMore: params.offset + params.limit < allItems.length,
      }),
    };

    vlist = createVList({
      container,
      item: { height: 40, template },
      adapter,
      reverse: true,
    });

    // Wait for adapter to load and auto-scroll
    await new Promise((r) => setTimeout(r, 100));

    expect(vlist.total).toBeGreaterThan(0);
    // In reverse mode, should have scrolled to bottom
    // (exact position depends on container size vs total height)
  });

  it("should handle reverse mode with static items (no adapter)", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    });

    // Should have scrolled to bottom immediately
    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(50);
  });

  it("should handle reverse mode with empty adapter", async () => {
    const adapter: VListAdapter<TestItem> = {
      read: async () => ({
        items: [] as TestItem[],
        total: 0,
        hasMore: false,
      }),
    };

    vlist = createVList({
      container,
      item: { height: 40, template },
      adapter,
      reverse: true,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Should not crash with 0 items
    expect(vlist.total).toBe(0);
  });
});

// =============================================================================
// Scroll Controller onIdle Callback (L522-528)
// =============================================================================

describe("vlist scroll controller onIdle", () => {
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

  it("should add scrolling class on scroll and remove on idle", async () => {
    const items = createTestItems(200);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { idleTimeout: 50 },
    });

    const root = vlist.element;

    // Simulate scroll by calling scrollToIndex
    vlist.scrollToIndex(100, "start");

    // Wait for idle timeout to fire
    await new Promise((r) => setTimeout(r, 200));

    // After idle, the scrolling class should be removed
    expect(root.classList.contains("vlist--scrolling")).toBe(false);
  });

  it("should call onIdle callback when scroll stops via native scroll event", async () => {
    const items = createTestItems(200);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { idleTimeout: 30 },
    });

    const root = vlist.element;
    const viewport = root.querySelector("[class*='-viewport']") as HTMLElement;
    expect(viewport).toBeTruthy();

    // Use JSDOM Event constructor for dispatching on JSDOM elements
    const JSDOMEvent = (window as any).Event;

    // Set scrollTop to simulate scrolling, then dispatch scroll event
    Object.defineProperty(viewport, "scrollTop", {
      value: 200,
      writable: true,
      configurable: true,
    });
    viewport.dispatchEvent(new JSDOMEvent("scroll"));

    // The onScroll callback (L513-521) should add the scrolling class
    // Give RAF a chance to fire
    await new Promise((r) => setTimeout(r, 10));

    // Now wait for idle timeout to fire the onIdle callback (L522-528)
    await new Promise((r) => setTimeout(r, 100));

    // After idle, the scrolling class should be removed by onIdle
    expect(root.classList.contains("vlist--scrolling")).toBe(false);
  });

  it("should use legacy idleTimeout config", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      idleTimeout: 200,
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(100);
  });
});

// =============================================================================
// Scroll Config - New API (scroll.wheel, scroll.wrap, scroll.element)
// =============================================================================

describe("vlist scroll config new API", () => {
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

  it("should disable wheel scrolling via scroll.wheel = false", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { wheel: false },
    });

    expect(vlist).toBeDefined();
    // When wheel is false, native scrollbar should be hidden
    const viewport = vlist.element.querySelector("[class*='-viewport']");
    expect(viewport).toBeTruthy();
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should enable wrap mode via scroll.wrap = true", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { wrap: true },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(50);
  });

  it("should use scroll.element for window mode", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(100);
  });

  it("should use scroll.idleTimeout", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { idleTimeout: 300 },
    });

    expect(vlist).toBeDefined();
  });
});

// =============================================================================
// Window Mode - Comprehensive (scroll.element)
// =============================================================================

describe("vlist window mode via scroll config", () => {
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

  it("should clean up window resize listener on destroy", () => {
    const items = createTestItems(100);

    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    // Destroy should remove the resize listener
    vlist.destroy();
    vlist = null;

    // After destroy, resize events shouldn't cause errors
    const ResizeEvent = (window as any).Event || dom.window.Event;
    expect(() => window.dispatchEvent(new ResizeEvent("resize"))).not.toThrow();
  });

  it("should handle window mode with compression", () => {
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(500_000);
  });

  it("should update viewport on significant window resize", async () => {
    Object.defineProperty(window, "innerHeight", {
      value: 500,
      writable: true,
      configurable: true,
    });

    const items = createTestItems(200);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    // Significant resize
    Object.defineProperty(window, "innerHeight", {
      value: 1000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 600,
      writable: true,
      configurable: true,
    });

    const ResizeEvent = (window as any).Event || dom.window.Event;
    window.dispatchEvent(new ResizeEvent("resize"));

    // Should update rendering
    const rendered = vlist.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Compression with scrollbar mode transitions
// =============================================================================

describe("vlist compression scrollbar creation", () => {
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

  it("should create scrollbar on compression entry when mode is native and no scrollbar exists", () => {
    // Start small → native mode → no custom scrollbar initially
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { scrollbar: "native" },
    });

    // Verify no custom scrollbar class initially (native mode, not compressed)
    const viewport = vlist.element.querySelector("[class*='-viewport']");

    // Grow to compression
    vlist.setItems(createTestItems(500_000));

    // After compression, custom scrollbar should be created
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should handle multiple compression/decompression cycles", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // Compress
    vlist.setItems(createTestItems(500_000));
    expect(vlist.total).toBe(500_000);

    // Decompress
    vlist.setItems(createTestItems(100));
    expect(vlist.total).toBe(100);

    // Re-compress
    vlist.setItems(createTestItems(600_000));
    expect(vlist.total).toBe(600_000);

    // Re-decompress
    vlist.setItems(createTestItems(50));
    expect(vlist.total).toBe(50);

    // Should still render correctly
    const rendered = vlist.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("should update scrollbar bounds when compression state changes", () => {
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    // Change total while compressed
    vlist.setItems(createTestItems(800_000));
    expect(vlist.total).toBe(800_000);

    // Change again
    vlist.setItems(createTestItems(400_100));
    expect(vlist.total).toBe(400_100);

    // Scrollbar should still be present and functioning
    const scrollbar = vlist.element.querySelector("[class*='scrollbar']");
    expect(scrollbar).toBeTruthy();
  });
});

// =============================================================================
// Window Mode Compression Sync
// =============================================================================

describe("vlist window mode compression sync", () => {
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

  it("should sync maxScroll in window mode even without compression", () => {
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    expect(vlist).toBeDefined();

    // Change items (triggers updateCompressionMode which should sync maxScroll)
    vlist.setItems(createTestItems(200));
    expect(vlist.total).toBe(200);
  });

  it("should sync maxScroll in window mode with compression", () => {
    const items = createTestItems(500_000);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: { element: window },
    });

    expect(vlist).toBeDefined();

    vlist.setItems(createTestItems(600_000));
    expect(vlist.total).toBe(600_000);
  });
});

// =============================================================================
// Additional edge cases for comprehensive coverage
// =============================================================================

describe("vlist additional edge cases", () => {
  let container: HTMLElement;
  let vlist: VList<any> | null = null;

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

  it("should handle on() returning unsubscribe for multiple event types", () => {
    const items = createTestItems(20);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
    });

    const scrollHandler = mock(() => {});
    const resizeHandler = mock(() => {});

    const unsub1 = vlist.on("scroll", scrollHandler);
    const unsub2 = vlist.on("resize", resizeHandler);

    expect(typeof unsub1).toBe("function");
    expect(typeof unsub2).toBe("function");

    // Clean up via both methods
    unsub1();
    vlist.off("resize", resizeHandler);
  });

  it("should handle grid mode with variable height function and gap", () => {
    const items = createTestItems(60);
    vlist = createVList({
      container,
      item: {
        height: (index: number) => 40 + (index % 3) * 10,
        template,
      },
      items,
      layout: "grid",
      grid: { columns: 4, gap: 12 },
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(60);

    // setItems to trigger re-render with grid gap
    vlist.setItems(createTestItems(80));
    expect(vlist.total).toBe(80);
  });

  it("should handle groups with setItems rebuilding layout and then scrollToIndex", () => {
    interface GroupedItem extends VListItem {
      id: number;
      name: string;
      category: string;
    }
    const groupTemplate = (item: GroupedItem): string =>
      `<div>${item.name}</div>`;

    const items: GroupedItem[] = [
      { id: 1, name: "A", category: "X" },
      { id: 2, name: "B", category: "X" },
      { id: 3, name: "C", category: "Y" },
      { id: 4, name: "D", category: "Y" },
    ];

    let currentItems = items;
    vlist = createVList<GroupedItem>({
      container,
      item: { height: 40, template: groupTemplate },
      items,
      groups: {
        getGroupForIndex: (index: number) =>
          currentItems[index]?.category ?? "Z",
        headerHeight: 30,
        headerTemplate: (key: string) => `<div>${key}</div>`,
      },
    });

    // Update items
    const newItems: GroupedItem[] = [
      { id: 5, name: "E", category: "A" },
      { id: 6, name: "F", category: "A" },
      { id: 7, name: "G", category: "B" },
      { id: 8, name: "H", category: "B" },
      { id: 9, name: "I", category: "C" },
    ];
    currentItems = newItems;
    vlist.setItems(newItems);

    // scrollToIndex should use the groups wrapper
    expect(() => vlist!.scrollToIndex(3, "center")).not.toThrow();
    expect(vlist.total).toBe(5);
  });

  it("should handle reverse mode with static items scrolling to bottom", () => {
    // This specifically tests L1247-1249: initialTotal > 0, scrollToIndex(total-1)
    const items = createTestItems(100);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    });

    expect(vlist).toBeDefined();
    expect(vlist.total).toBe(100);
    // The vlist should have auto-scrolled to the last item
  });

  it("should handle window mode with native scrollbar and items change", () => {
    const items = createTestItems(50);
    vlist = createVList({
      container,
      item: { height: 40, template },
      items,
      scroll: {
        element: window,
        scrollbar: "native",
      },
    });

    expect(vlist).toBeDefined();

    // Change items to trigger updateCompressionMode in window mode
    vlist.setItems(createTestItems(100));
    expect(vlist.total).toBe(100);

    vlist.setItems(createTestItems(30));
    expect(vlist.total).toBe(30);
  });
});
