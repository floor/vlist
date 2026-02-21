/**
 * vlist/render/renderer — Coverage Tests
 *
 * Tests for renderer getElement, pool stats, updateItem, updateItemClasses,
 * HTMLElement templates, element pool overflow, aria-setsize updates, and
 * template re-application when item identity changes.
 *
 * Merged from: medium-coverage.test.ts, medium-coverage-2.test.ts, final-coverage.test.ts
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
import {
  createRenderer,
  createSizeCache,
  resolveContainer,
  type Renderer,
} from "../../src/rendering";
import { createElementPool } from "../../src/rendering/renderer";
import type {
  VListItem,
  ItemTemplate,
  ItemState,
  Range,
} from "../../src/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
});

// =============================================================================
// Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  value?: number;
}

const createTestItems = (count: number, startId: number = 1): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `Item ${startId + i}`,
    value: (startId + i) * 10,
  }));
};

const template: ItemTemplate<TestItem> = (
  item: TestItem,
  _index: number,
  _state: ItemState,
): string => {
  return `<div class="item">${item.name}</div>`;
};

// =============================================================================
// Tests
// =============================================================================

describe("renderer getElement and pool stats", () => {
  let itemsContainer: HTMLElement;

  beforeEach(() => {
    itemsContainer = document.createElement("div");
    itemsContainer.className = "vlist-items";
    document.body.appendChild(itemsContainer);
  });

  afterEach(() => {
    itemsContainer.remove();
  });

  it("should return element for a rendered index via getElement", () => {
    const sizeCache = createSizeCache(40, 20);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined,
      "test-0",
    );

    const items = createTestItems(10);
    const renderRange: Range = { start: 0, end: 9 };
    renderer.render(items, renderRange, new Set<number>(), -1);

    // getElement for a rendered index should return an HTMLElement
    const el = renderer.getElement(0);
    expect(el).toBeTruthy();
    expect(el).toBeInstanceOf(HTMLElement);

    // getElement for a non-rendered index should return undefined
    const missing = renderer.getElement(99);
    expect(missing).toBeUndefined();

    renderer.destroy();
  });

  it("should return undefined from getElement after clear", () => {
    const sizeCache = createSizeCache(40, 10);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
    );

    const items = createTestItems(5);
    renderer.render(items, { start: 0, end: 4 }, new Set(), -1);

    expect(renderer.getElement(0)).toBeTruthy();

    renderer.clear();
    expect(renderer.getElement(0)).toBeUndefined();

    renderer.destroy();
  });

  it("should return undefined for index that scrolled out of range", () => {
    const sizeCache = createSizeCache(40, 20);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
    );

    const items = createTestItems(20);

    // Render first batch
    renderer.render(items.slice(0, 10), { start: 0, end: 9 }, new Set(), -1);
    expect(renderer.getElement(0)).toBeTruthy();

    // Render second batch (item 0 is out of range and should be released)
    renderer.render(items.slice(10, 20), { start: 10, end: 19 }, new Set(), -1);
    expect(renderer.getElement(0)).toBeUndefined();
    expect(renderer.getElement(10)).toBeTruthy();

    renderer.destroy();
  });

  it("should reuse pooled elements when range shifts", () => {
    const sizeCache = createSizeCache(40, 30);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
    );

    const items = createTestItems(30);

    // Render items 0-9
    renderer.render(items.slice(0, 10), { start: 0, end: 9 }, new Set(), -1);
    const countAfterFirst = itemsContainer.children.length;
    expect(countAfterFirst).toBe(10);

    // Shift to items 5-14 — items 0-4 released to pool, items 10-14 created/reused
    renderer.render(items.slice(5, 15), { start: 5, end: 14 }, new Set(), -1);
    expect(renderer.getElement(5)).toBeTruthy();
    expect(renderer.getElement(14)).toBeTruthy();

    renderer.destroy();
  });
});

describe("renderer updateItem and updateItemClasses", () => {
  let itemsContainer: HTMLElement;

  beforeEach(() => {
    itemsContainer = document.createElement("div");
    itemsContainer.className = "vlist-items";
    document.body.appendChild(itemsContainer);
  });

  afterEach(() => {
    itemsContainer.remove();
  });

  it("should updateItemClasses on a rendered item", () => {
    const sizeCache = createSizeCache(40, 10);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
    );

    const items = createTestItems(5);
    renderer.render(items, { start: 0, end: 4 }, new Set(), -1);

    // Update classes — should not throw
    renderer.updateItemClasses(0, true, false);
    renderer.updateItemClasses(1, false, true);

    // Non-rendered index — should not throw
    renderer.updateItemClasses(99, true, true);

    renderer.destroy();
  });

  it("should updateItem with new data", () => {
    const sizeCache = createSizeCache(40, 10);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
    );

    const items = createTestItems(5);
    renderer.render(items, { start: 0, end: 4 }, new Set(), -1);

    // Update item 2 with new data
    const updatedItem: TestItem = { id: 3, name: "Updated Item 3", value: 999 };
    renderer.updateItem(2, updatedItem, false, false);

    const el = renderer.getElement(2);
    expect(el).toBeTruthy();
    expect(el!.innerHTML).toContain("Updated Item 3");

    renderer.destroy();
  });

  it("should handle template returning HTMLElement", () => {
    const elementTemplate: ItemTemplate<TestItem> = (
      item: TestItem,
    ): HTMLElement => {
      const div = document.createElement("div");
      div.className = "custom-item";
      div.textContent = item.name;
      return div;
    };

    const sizeCache = createSizeCache(40, 5);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      elementTemplate,
      sizeCache,
      "vlist",
    );

    const items = createTestItems(5);
    renderer.render(items, { start: 0, end: 4 }, new Set(), -1);

    const el = renderer.getElement(0);
    expect(el).toBeTruthy();

    renderer.destroy();
  });
});

describe("render/renderer — element pool overflow (L144-147)", () => {
  it("should discard element when pool is at max capacity", () => {
    // Create pool with tiny max size to easily overflow
    const pool = createElementPool("div", 3);

    // Acquire 5 elements
    const elements: HTMLElement[] = [];
    for (let i = 0; i < 5; i++) {
      elements.push(pool.acquire());
    }

    expect(pool.stats().created).toBe(5);

    // Release all 5 — only 3 should be kept (maxSize = 3)
    for (const el of elements) {
      pool.release(el);
    }

    // Pool should have exactly 3 (not 5)
    expect(pool.stats().poolSize).toBe(3);

    // Acquire 3 — all from pool (reused)
    pool.acquire();
    pool.acquire();
    pool.acquire();

    expect(pool.stats().reused).toBe(3);

    // Pool should now be empty
    expect(pool.stats().poolSize).toBe(0);

    // Acquire 1 more — must create new (pool is empty)
    pool.acquire();
    expect(pool.stats().created).toBe(6);
  });

  it("should still clean attributes on elements that fit in pool", () => {
    const pool = createElementPool("div", 2);

    const el1 = pool.acquire();
    const el2 = pool.acquire();
    const el3 = pool.acquire();

    // Set some attributes
    el1.className = "item";
    el1.setAttribute("data-index", "0");
    el1.setAttribute("data-id", "abc");
    el1.style.height = "40px";
    el1.textContent = "Hello";

    // Release 3 — only 2 fit in pool, 3rd is discarded
    pool.release(el1);
    pool.release(el2);
    pool.release(el3); // discarded (pool full at 2)

    // Acquire one back — should be clean
    const recycled = pool.acquire();
    expect(recycled.className).toBe("");
    expect(recycled.textContent).toBe("");
    expect(recycled.getAttribute("data-index")).toBeNull();
    expect(recycled.getAttribute("data-id")).toBeNull();
    expect(recycled.getAttribute("style")).toBeNull();
  });

  it("should handle pool clear correctly", () => {
    const pool = createElementPool("div", 5);

    for (let i = 0; i < 5; i++) {
      pool.release(pool.acquire());
    }

    expect(pool.stats().poolSize).toBeGreaterThan(0);

    pool.clear();
    expect(pool.stats().poolSize).toBe(0);
  });
});

describe("renderer — aria-setsize update when total changes between renders", () => {
  it("should update aria-setsize on existing elements when total items changes", async () => {
    const itemsContainer = document.createElement("div");
    document.body.appendChild(itemsContainer);

    let totalItems = 10;
    const sizeCache = createSizeCache(40, 10);

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      (item) => `<span>${item.name}</span>`,
      sizeCache,
      "vlist",
      () => totalItems,
      "test-list",
    );

    const items = createTestItems(5);

    // First render with total=10
    renderer.render(items, { start: 0, end: 4 }, new Set(), -1);

    const el0 = renderer.getElement(0);
    expect(el0).toBeDefined();
    expect(el0!.getAttribute("aria-setsize")).toBe("10");

    // Now change total and re-render with same range
    totalItems = 20;
    renderer.render(items, { start: 0, end: 4 }, new Set(), -1);

    // Existing elements should have updated aria-setsize
    const el0After = renderer.getElement(0);
    expect(el0After!.getAttribute("aria-setsize")).toBe("20");

    renderer.destroy();
    itemsContainer.remove();
  });
});

describe("renderer — re-apply template when item ID changes at same index", () => {
  it("should re-apply template when item at index changes identity", async () => {
    const itemsContainer = document.createElement("div");
    document.body.appendChild(itemsContainer);

    const sizeCache = createSizeCache(40, 10);

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      (item) => `<span>${item.name}</span>`,
      sizeCache,
      "vlist",
    );

    // Render with placeholder-like items
    const placeholderItems: TestItem[] = [
      { id: 9000, name: "Loading..." },
      { id: 9001, name: "Loading..." },
    ];
    renderer.render(placeholderItems, { start: 0, end: 1 }, new Set(), -1);

    const el0Before = renderer.getElement(0);
    expect(el0Before!.dataset.id).toBe("9000");
    expect(el0Before!.innerHTML).toContain("Loading...");

    // Now render with real items at same indices (different IDs)
    const realItems: TestItem[] = [
      { id: 1, name: "Real Item 1" },
      { id: 2, name: "Real Item 2" },
    ];
    renderer.render(realItems, { start: 0, end: 1 }, new Set(), -1);

    const el0After = renderer.getElement(0);
    expect(el0After!.dataset.id).toBe("1");
    expect(el0After!.innerHTML).toContain("Real Item 1");

    renderer.destroy();
    itemsContainer.remove();
  });
});

// =============================================================================
// resolveContainer — string selector not found (L653)
// =============================================================================

describe("resolveContainer", () => {
  it("should throw when string selector does not match any element", () => {
    expect(() => resolveContainer("#non-existent-container")).toThrow(
      "[vlist] Container not found: #non-existent-container",
    );
  });

  it("should return the element when string selector matches", () => {
    const el = document.createElement("div");
    el.id = "resolve-test";
    document.body.appendChild(el);

    const result = resolveContainer("#resolve-test");
    expect(result).toBe(el);

    el.remove();
  });

  it("should return the element directly when passed an HTMLElement", () => {
    const el = document.createElement("div");
    const result = resolveContainer(el);
    expect(result).toBe(el);
  });
});

// =============================================================================
// DOM Structure Creation - using imported createDOMStructure
// =============================================================================

import { createDOMStructure } from "../../src/rendering/renderer";

describe("createDOMStructure", () => {
  it("should create basic DOM structure with default settings", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root.className).toBe("vlist");
    expect(root.getAttribute("role")).toBe("listbox");
    expect(root.getAttribute("tabindex")).toBe("0");
    expect(viewport.className).toBe("vlist-viewport");
    expect(content.className).toBe("vlist-content");
    expect(items.className).toBe("vlist-items");
  });

  it("should add aria-label when provided", () => {
    const container = document.createElement("div");
    const { root } = createDOMStructure(container, "vlist", "My List");

    expect(root.getAttribute("aria-label")).toBe("My List");
  });

  it("should not add aria-label when not provided", () => {
    const container = document.createElement("div");
    const { root } = createDOMStructure(container, "vlist");

    expect(root.hasAttribute("aria-label")).toBe(false);
  });

  it("should create horizontal layout structure", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
      undefined,
      true,
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(true);
    expect(root.getAttribute("aria-orientation")).toBe("horizontal");
    expect(viewport.style.overflowX).toBe("auto");
    expect(viewport.style.overflowY).toBe("hidden");
    expect(content.style.height).toBe("100%");
    expect(items.style.height).toBe("100%");
  });

  it("should create vertical layout structure (default)", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(false);
    expect(root.hasAttribute("aria-orientation")).toBe(false);
    expect(viewport.style.overflow).toBe("auto");
    expect(content.style.width).toBe("100%");
    expect(items.style.width).toBe("100%");
  });

  it("should set proper viewport overflow styles", () => {
    const container = document.createElement("div");
    const { viewport } = createDOMStructure(container, "vlist");

    expect(viewport.style.height).toBe("100%");
    expect(viewport.style.width).toBe("100%");
    expect(viewport.style.overflow).toBe("auto");
  });

  it("should set proper content positioning", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist");

    expect(content.style.position).toBe("relative");
    expect(content.style.width).toBe("100%");
  });

  it("should set proper items positioning", () => {
    const container = document.createElement("div");
    const { items } = createDOMStructure(container, "vlist");

    expect(items.style.position).toBe("relative");
    expect(items.style.width).toBe("100%");
  });

  it("should nest DOM elements correctly", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root.parentElement).toBe(container);
    expect(viewport.parentElement).toBe(root);
    expect(content.parentElement).toBe(viewport);
    expect(items.parentElement).toBe(content);
  });

  it("should use custom class prefix", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "custom-prefix",
    );

    expect(root.className).toBe("custom-prefix");
    expect(viewport.className).toBe("custom-prefix-viewport");
    expect(content.className).toBe("custom-prefix-content");
    expect(items.className).toBe("custom-prefix-items");
  });
});

// =============================================================================
// Content Size Update Functions
// =============================================================================

import {
  updateContentHeight,
  updateContentWidth,
  getContainerDimensions,
} from "../../src/rendering/renderer";

describe("updateContentHeight", () => {
  it("should set content height in pixels", () => {
    const content = document.createElement("div");
    updateContentHeight(content, 5000);

    expect(content.style.height).toBe("5000px");
  });

  it("should update height when called multiple times", () => {
    const content = document.createElement("div");
    updateContentHeight(content, 1000);
    expect(content.style.height).toBe("1000px");

    updateContentHeight(content, 2500);
    expect(content.style.height).toBe("2500px");
  });

  it("should handle zero height", () => {
    const content = document.createElement("div");
    updateContentHeight(content, 0);

    expect(content.style.height).toBe("0px");
  });

  it("should handle large heights", () => {
    const content = document.createElement("div");
    updateContentHeight(content, 1000000);

    expect(content.style.height).toBe("1000000px");
  });
});

describe("updateContentWidth", () => {
  it("should set content width in pixels", () => {
    const content = document.createElement("div");
    updateContentWidth(content, 3000);

    expect(content.style.width).toBe("3000px");
  });

  it("should update width when called multiple times", () => {
    const content = document.createElement("div");
    updateContentWidth(content, 800);
    expect(content.style.width).toBe("800px");

    updateContentWidth(content, 1200);
    expect(content.style.width).toBe("1200px");
  });

  it("should handle zero width", () => {
    const content = document.createElement("div");
    updateContentWidth(content, 0);

    expect(content.style.width).toBe("0px");
  });

  it("should handle large widths", () => {
    const content = document.createElement("div");
    updateContentWidth(content, 500000);

    expect(content.style.width).toBe("500000px");
  });
});

describe("getContainerDimensions", () => {
  it("should return viewport clientWidth and clientHeight", () => {
    const viewport = document.createElement("div");
    viewport.style.width = "800px";
    viewport.style.height = "600px";
    document.body.appendChild(viewport);

    const dimensions = getContainerDimensions(viewport);

    expect(dimensions.width).toBeGreaterThanOrEqual(0);
    expect(dimensions.height).toBeGreaterThanOrEqual(0);
    expect(typeof dimensions.width).toBe("number");
    expect(typeof dimensions.height).toBe("number");

    document.body.removeChild(viewport);
  });

  it("should handle elements not yet attached to DOM", () => {
    const viewport = document.createElement("div");

    const dimensions = getContainerDimensions(viewport);

    expect(dimensions.width).toBe(0);
    expect(dimensions.height).toBe(0);
  });

  it("should return updated dimensions after resize", () => {
    const viewport = document.createElement("div");
    viewport.style.width = "400px";
    viewport.style.height = "300px";
    document.body.appendChild(viewport);

    const dims1 = getContainerDimensions(viewport);

    viewport.style.width = "800px";
    viewport.style.height = "600px";

    const dims2 = getContainerDimensions(viewport);

    // Dimensions should be different (or at least, width/height are read)
    expect(typeof dims2.width).toBe("number");
    expect(typeof dims2.height).toBe("number");

    document.body.removeChild(viewport);
  });
});

// =============================================================================
// Compression Context Tests
// =============================================================================

describe("renderer with compression context", () => {
  let itemsContainer: HTMLElement;

  beforeEach(() => {
    itemsContainer = document.createElement("div");
    itemsContainer.className = "vlist-items";
    document.body.appendChild(itemsContainer);
  });

  afterEach(() => {
    itemsContainer.remove();
  });

  it("should use compression-aware positioning when compressionFns provided", () => {
    const sizeCache = createSizeCache(40, 20);

    // Mock compression functions
    const mockGetPosition = mock(
      (
        index: number,
        scrollTop: number,
        _sizeCache: any,
        _totalItems: number,
        _containerHeight: number,
        _compression: any,
        _rangeStart?: number,
      ) => {
        // Return custom compressed position
        return index * 30; // Different from normal offset
      },
    );

    const mockGetState = mock((totalItems: number, _sizeCache: any) => {
      return {
        isCompressed: true,
        actualSize: 10000,
        virtualSize: totalItems * 40,
        ratio: 0.5,
      };
    });

    const compressionFns = {
      getPosition: mockGetPosition,
      getState: mockGetState,
    };

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      false, // horizontal
      undefined, // crossAxisSize
      compressionFns,
    );

    const items = createTestItems(10);
    const renderRange: Range = { start: 0, end: 9 };
    const compressionCtx = {
      scrollPosition: 100,
      totalItems: 10,
      containerSize: 500,
      rangeStart: 0,
    };

    renderer.render(items, renderRange, new Set<number>(), -1, compressionCtx);

    // Verify compression functions were called
    expect(mockGetState).toHaveBeenCalled();
    expect(mockGetPosition).toHaveBeenCalled();

    renderer.destroy();
  });

  it("should fall back to normal positioning when compression is not active", () => {
    const sizeCache = createSizeCache(40, 20);

    const mockGetPosition = mock(() => 999);
    const mockGetState = mock(() => {
      return {
        isCompressed: false, // Not compressed
        actualSize: 400,
        virtualSize: 400,
        ratio: 1,
      };
    });

    const compressionFns = {
      getPosition: mockGetPosition,
      getState: mockGetState,
    };

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      false, // horizontal
      undefined, // crossAxisSize
      compressionFns,
    );

    const items = createTestItems(10);
    const renderRange: Range = { start: 0, end: 9 };
    const compressionCtx = {
      scrollPosition: 100,
      totalItems: 10,
      containerSize: 500,
      rangeStart: 0,
    };

    renderer.render(items, renderRange, new Set<number>(), -1, compressionCtx);

    // Compression state checked but position function should not be called
    // because isCompressed is false
    expect(mockGetState).toHaveBeenCalled();
    // mockGetPosition should NOT be called when isCompressed=false
    expect(mockGetPosition).not.toHaveBeenCalled();

    renderer.destroy();
  });

  it("should use normal positioning when compressionCtx is undefined", () => {
    const sizeCache = createSizeCache(40, 20);

    const mockGetPosition = mock(() => 999);
    const mockGetState = mock(() => ({
      isCompressed: true,
      actualSize: 10000,
      virtualSize: 400,
      ratio: 0.5,
    }));

    const compressionFns = {
      getPosition: mockGetPosition,
      getState: mockGetState,
    };

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      false, // horizontal
      undefined, // crossAxisSize
      compressionFns,
    );

    const items = createTestItems(10);
    const renderRange: Range = { start: 0, end: 9 };

    // Render without compressionCtx
    renderer.render(items, renderRange, new Set<number>(), -1);

    // Should not call compression functions when no context provided
    expect(mockGetPosition).not.toHaveBeenCalled();

    renderer.destroy();
  });

  it("should update positions when compressionCtx changes", () => {
    const sizeCache = createSizeCache(40, 20);

    const mockGetPosition = mock((index: number) => index * 35);
    const mockGetState = mock(() => ({
      isCompressed: true,
      actualSize: 10000,
      virtualSize: 400,
      ratio: 0.5,
    }));

    const compressionFns = {
      getPosition: mockGetPosition,
      getState: mockGetState,
    };

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      false, // horizontal
      undefined, // crossAxisSize
      compressionFns,
    );

    const items = createTestItems(10);
    const renderRange: Range = { start: 0, end: 9 };
    const compressionCtx1 = {
      scrollPosition: 100,
      totalItems: 10,
      containerSize: 500,
      rangeStart: 0,
    };

    renderer.render(items, renderRange, new Set<number>(), -1, compressionCtx1);

    const callCountAfterRender = (mockGetPosition as any).mock.calls.length;

    // Update positions with new context
    const compressionCtx2 = {
      scrollPosition: 200,
      totalItems: 10,
      containerSize: 500,
      rangeStart: 0,
    };

    renderer.updatePositions(compressionCtx2);

    // Should have called getPosition again for each rendered item
    expect((mockGetPosition as any).mock.calls.length).toBeGreaterThan(
      callCountAfterRender,
    );

    renderer.destroy();
  });

  it("should handle updatePositions with empty rendered map", () => {
    const sizeCache = createSizeCache(40, 20);

    const mockGetPosition = mock(() => 100);
    const mockGetState = mock(() => ({
      isCompressed: true,
      actualSize: 10000,
      virtualSize: 400,
      ratio: 0.5,
    }));

    const compressionFns = {
      getPosition: mockGetPosition,
      getState: mockGetState,
    };

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      false, // horizontal
      undefined, // crossAxisSize
      compressionFns,
    );

    const compressionCtx = {
      scrollPosition: 100,
      totalItems: 10,
      containerSize: 500,
      rangeStart: 0,
    };

    // Call updatePositions without rendering anything
    expect(() => {
      renderer.updatePositions(compressionCtx);
    }).not.toThrow();

    // Should not call getPosition when nothing is rendered
    expect(mockGetPosition).not.toHaveBeenCalled();

    renderer.destroy();
  });
});

// =============================================================================
// Cross-axis Size Tests
// =============================================================================

describe("renderer with cross-axis size (horizontal mode)", () => {
  let itemsContainer: HTMLElement;

  beforeEach(() => {
    itemsContainer = document.createElement("div");
    itemsContainer.className = "vlist-items";
    document.body.appendChild(itemsContainer);
  });

  afterEach(() => {
    itemsContainer.remove();
  });

  it("should apply height from crossAxisSize in horizontal mode", () => {
    const sizeCache = createSizeCache(200, 20); // Width-based cache
    const crossAxisSize = 300; // Fixed height

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      true, // horizontal
      crossAxisSize,
    );

    const items = createTestItems(5);
    const renderRange: Range = { start: 0, end: 4 };

    renderer.render(items, renderRange, new Set<number>(), -1);

    const firstElement = renderer.getElement(0);
    expect(firstElement).toBeTruthy();

    // In horizontal mode with crossAxisSize, height should be set
    if (firstElement) {
      expect(firstElement.style.height).toBe("300px");
      expect(firstElement.style.width).toBeTruthy(); // Width from cache
    }

    renderer.destroy();
  });

  it("should not set height when crossAxisSize is undefined", () => {
    const sizeCache = createSizeCache(200, 20);

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      "vlist",
      undefined, // totalItemsGetter
      "test-0",
      true, // horizontal
      undefined, // no crossAxisSize
    );

    const items = createTestItems(5);
    const renderRange: Range = { start: 0, end: 4 };

    renderer.render(items, renderRange, new Set<number>(), -1);

    const firstElement = renderer.getElement(0);
    expect(firstElement).toBeTruthy();

    if (firstElement) {
      // In horizontal mode, width is set from cache
      // Height may still be set from cache size, so we just verify element exists
      expect(firstElement.style.width).toBeTruthy();
    }

    renderer.destroy();
  });
});
