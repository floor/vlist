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
  createHeightCache,
  resolveContainer,
  type Renderer,
} from "../../src/render";
import { createElementPool } from "../../src/render/renderer";
import type { VListItem, ItemTemplate, ItemState } from "../../src/types";

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
    const heightCache = createHeightCache(40, 20);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      heightCache,
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
    const heightCache = createHeightCache(40, 10);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      heightCache,
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
    const heightCache = createHeightCache(40, 20);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      heightCache,
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
    const heightCache = createHeightCache(40, 30);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      heightCache,
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
    const heightCache = createHeightCache(40, 10);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      heightCache,
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
    const heightCache = createHeightCache(40, 10);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      template,
      heightCache,
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

    const heightCache = createHeightCache(40, 5);
    const renderer = createRenderer<TestItem>(
      itemsContainer,
      elementTemplate,
      heightCache,
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
    const heightCache = createHeightCache(40, 10);

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      (item) => `<span>${item.name}</span>`,
      heightCache,
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

    const heightCache = createHeightCache(40, 10);

    const renderer = createRenderer<TestItem>(
      itemsContainer,
      (item) => `<span>${item.name}</span>`,
      heightCache,
      "vlist",
    );

    // Render with placeholder-like items
    const placeholders: TestItem[] = [
      { id: "placeholder-0", name: "Loading..." },
      { id: "placeholder-1", name: "Loading..." },
    ];
    renderer.render(placeholders, { start: 0, end: 1 }, new Set(), -1);

    const el0Before = renderer.getElement(0);
    expect(el0Before!.dataset.id).toBe("placeholder-0");
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
