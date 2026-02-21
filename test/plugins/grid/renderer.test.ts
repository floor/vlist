/**
 * vlist - Grid Renderer Tests
 * Tests for the grid-mode renderer: positioning, sizing, resize, lifecycle
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { JSDOM } from "jsdom";
import { createGridRenderer } from "../../../src/features/grid/renderer";
import { createGridLayout } from "../../../src/features/grid/layout";
import { createSizeCache } from "../../../src/rendering/sizes";
import type { GridRenderer } from "../../../src/features/grid/renderer";
import type { GridLayout } from "../../../src/features/grid/types";
import type {
  VListItem,
  ItemTemplate,
  ItemState,
  Range,
} from "../../../src/types";
import type { SizeCache } from "../../../src/rendering/sizes";

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
// Test Types & Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number, startId: number = 1): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `Item ${startId + i}`,
  }));

const createItemsContainer = (): HTMLElement => {
  const container = document.createElement("div");
  container.className = "vlist-items";
  document.body.appendChild(container);
  return container;
};

/**
 * Create a mock SizeCache for grid rows.
 * In grid mode, height cache operates on ROW indices.
 */
const createMockSizeCache = (rowHeight: number): SizeCache => ({
  getOffset: (index: number): number => index * rowHeight,
  getSize: (_index: number): number => rowHeight,
  indexAtOffset: (offset: number): number => Math.floor(offset / rowHeight),
  getTotalSize: (): number => 0, // not used directly by grid renderer
  getTotal: (): number => 0, // not used directly by grid renderer
  rebuild: (_totalItems: number): void => {},
  isVariable: (): boolean => false,
});

const defaultTemplate: ItemTemplate<TestItem> = (
  item: TestItem,
  _index: number,
  _state: ItemState,
): string => {
  return `<span>${item.name}</span>`;
};

const template: ItemTemplate<TestItem> = defaultTemplate;

// =============================================================================
// Factory & Initialization
// =============================================================================

describe("createGridRenderer", () => {
  let container: HTMLElement;
  let gridLayout: GridLayout;
  let sizeCache: SizeCache;

  beforeEach(() => {
    container = createItemsContainer();
    gridLayout = createGridLayout({ columns: 4, gap: 8 });
    sizeCache = createMockSizeCache(100); // 100px per row (including gap)
  });

  afterEach(() => {
    container.remove();
  });

  describe("initialization", () => {
    it("should create a grid renderer", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      expect(renderer).toBeDefined();
      expect(typeof renderer.render).toBe("function");
      expect(typeof renderer.updatePositions).toBe("function");
      expect(typeof renderer.updateItem).toBe("function");
      expect(typeof renderer.updateItemClasses).toBe("function");
      expect(typeof renderer.getElement).toBe("function");
      expect(typeof renderer.updateContainerWidth).toBe("function");
      expect(typeof renderer.clear).toBe("function");
      expect(typeof renderer.destroy).toBe("function");

      renderer.destroy();
    });

    it("should create renderer with aria options", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
        () => 100,
        "grid-0",
      );

      expect(renderer).toBeDefined();
      renderer.destroy();
    });
  });

  // ===========================================================================
  // render()
  // ===========================================================================

  describe("render", () => {
    it("should render items in the given range", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(8);
      const range: Range = { start: 0, end: 7 };
      const selectedIds = new Set<string | number>();

      renderer.render(items, range, selectedIds, -1);

      const rendered = container.querySelectorAll("[data-index]");
      expect(rendered.length).toBe(8);

      renderer.destroy();
    });

    it("should set data-index and data-id on rendered items", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0).toBeTruthy();
      expect(el0.getAttribute("data-id")).toBe("1");

      const el3 = container.querySelector("[data-index='3']") as HTMLElement;
      expect(el3).toBeTruthy();
      expect(el3.getAttribute("data-id")).toBe("4");

      renderer.destroy();
    });

    it("should set data-row and data-col attributes", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(8);
      renderer.render(items, { start: 0, end: 7 }, new Set(), -1);

      // Item 0: row 0, col 0
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.getAttribute("data-row")).toBe("0");
      expect(el0.getAttribute("data-col")).toBe("0");

      // Item 5: row 1, col 1 (4 columns)
      const el5 = container.querySelector("[data-index='5']") as HTMLElement;
      expect(el5.getAttribute("data-row")).toBe("1");
      expect(el5.getAttribute("data-col")).toBe("1");

      renderer.destroy();
    });

    it("should apply template content", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.innerHTML).toContain("Item 1");

      renderer.destroy();
    });

    it("should support HTMLElement templates", () => {
      const elementTemplate: ItemTemplate<TestItem> = (item) => {
        const el = document.createElement("div");
        el.textContent = item.name;
        return el;
      };

      const renderer = createGridRenderer<TestItem>(
        container,
        elementTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(2);
      renderer.render(items, { start: 0, end: 1 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.textContent).toContain("Item 1");

      renderer.destroy();
    });

    it("should apply selected class to selected items", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      const selectedIds = new Set<string | number>([2, 4]);

      renderer.render(items, { start: 0, end: 3 }, selectedIds, -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.classList.contains("vlist-item--selected")).toBe(false);

      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.classList.contains("vlist-item--selected")).toBe(true);

      const el3 = container.querySelector("[data-index='3']") as HTMLElement;
      expect(el3.classList.contains("vlist-item--selected")).toBe(true);

      renderer.destroy();
    });

    it("should apply focused class to focused item", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), 2);

      const el2 = container.querySelector("[data-index='2']") as HTMLElement;
      expect(el2.classList.contains("vlist-item--focused")).toBe(true);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.classList.contains("vlist-item--focused")).toBe(false);

      renderer.destroy();
    });

    it("should set aria-selected attribute", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      const selectedIds = new Set<string | number>([1]);

      renderer.render(items, { start: 0, end: 3 }, selectedIds, -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.ariaSelected).toBe("true");

      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.ariaSelected).toBe("false");

      renderer.destroy();
    });

    it("should set role=option on rendered items", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.getAttribute("role")).toBe("option");

      renderer.destroy();
    });

    it("should apply base CSS classes", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(2);
      renderer.render(items, { start: 0, end: 1 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.classList.contains("vlist-item")).toBe(true);
      expect(el0.classList.contains("vlist-grid-item")).toBe(true);

      renderer.destroy();
    });

    it("should position items with translate(x, y)", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(8);
      renderer.render(items, { start: 0, end: 7 }, new Set(), -1);

      // Item 0: col 0, row 0 → translate(0, 0)
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.style.transform).toBe("translate(0px, 0px)");

      // Item 4: col 0, row 1 → translate(0, 100)
      const el4 = container.querySelector("[data-index='4']") as HTMLElement;
      expect(el4.style.transform).toBe("translate(0px, 100px)");

      renderer.destroy();
    });

    it("should calculate column offsets with gap", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // With 4 columns, 8px gap, 800px width:
      // columnWidth = (800 - 3*8) / 4 = 194
      // col 0 offset = 0
      // col 1 offset = 1 * (194 + 8) = 202
      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.style.transform).toBe("translate(202px, 0px)");

      renderer.destroy();
    });

    it("should set width and height on items", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // columnWidth = (800 - 3*8) / 4 = 194
      // rowHeight from cache = 100, minus gap 8 = 92
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.style.width).toBe("194px");
      expect(el0.style.height).toBe("92px");

      renderer.destroy();
    });

    it("should remove items outside new range", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(12);

      // Render items 0-7
      renderer.render(items.slice(0, 8), { start: 0, end: 7 }, new Set(), -1);
      expect(container.querySelectorAll("[data-index]").length).toBe(8);

      // Render items 4-11 (removes 0-3, keeps 4-7, adds 8-11)
      renderer.render(items.slice(4, 12), { start: 4, end: 11 }, new Set(), -1);

      // Items 0-3 should be removed
      expect(container.querySelector("[data-index='0']")).toBeNull();
      expect(container.querySelector("[data-index='1']")).toBeNull();
      expect(container.querySelector("[data-index='2']")).toBeNull();
      expect(container.querySelector("[data-index='3']")).toBeNull();

      // Items 4-11 should be present
      expect(container.querySelector("[data-index='4']")).toBeTruthy();
      expect(container.querySelector("[data-index='11']")).toBeTruthy();

      renderer.destroy();
    });

    it("should update existing items when data changes", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      // Render initial items
      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // Update item at index 1 with a different item
      const newItems: TestItem[] = [
        items[0]!,
        { id: 99, name: "Replaced Item" },
        items[2]!,
        items[3]!,
      ];
      renderer.render(newItems, { start: 0, end: 3 }, new Set(), -1);

      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.getAttribute("data-id")).toBe("99");
      expect(el1.innerHTML).toContain("Replaced Item");

      renderer.destroy();
    });

    it("should skip undefined items in the array", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items: (TestItem | undefined)[] = [
        createTestItems(1)[0],
        undefined,
        createTestItems(1, 3)[0],
      ];

      renderer.render(items as TestItem[], { start: 0, end: 2 }, new Set(), -1);

      // Item at index 1 is undefined — should not be rendered
      const rendered = container.querySelectorAll("[data-index]");
      expect(rendered.length).toBe(2);

      renderer.destroy();
    });

    it("should update selection on existing items without re-template", () => {
      const templateMock = mock(
        (item: TestItem, _index: number, _state: ItemState): string => {
          return `<span>${item.name}</span>`;
        },
      );

      const renderer = createGridRenderer<TestItem>(
        container,
        templateMock,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);

      // First render
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);
      const callsAfterFirst = templateMock.mock.calls.length;

      // Second render with same items but different selection
      const selectedIds = new Set<string | number>([2]);
      renderer.render(items, { start: 0, end: 3 }, selectedIds, -1);

      // Template should NOT have been called again for unchanged items
      // (same data-id means no re-template)
      expect(templateMock.mock.calls.length).toBe(callsAfterFirst);

      // But selection should be updated
      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.classList.contains("vlist-item--selected")).toBe(true);

      renderer.destroy();
    });

    it("should set aria-setsize and aria-posinset when totalItemsGetter provided", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
        () => 100,
        "grid-aria",
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.getAttribute("aria-setsize")).toBe("100");
      expect(el0.getAttribute("aria-posinset")).toBe("1");

      const el3 = container.querySelector("[data-index='3']") as HTMLElement;
      expect(el3.getAttribute("aria-posinset")).toBe("4");

      renderer.destroy();
    });

    it("should set element id when ariaIdPrefix provided", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
        () => 50,
        "grid-test",
      );

      const items = createTestItems(2);
      renderer.render(items, { start: 0, end: 1 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.id).toBe("grid-test-item-0");

      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.id).toBe("grid-test-item-1");

      renderer.destroy();
    });

    it("should update aria-setsize on existing items when total changes", () => {
      let total = 50;
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
        () => total,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.getAttribute("aria-setsize")).toBe("50");

      // Change total and re-render same range
      total = 200;
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      expect(el0.getAttribute("aria-setsize")).toBe("200");

      renderer.destroy();
    });

    it("should handle non-zero start range", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      // Items for range [4, 7] — second row of a 4-column grid
      const items = createTestItems(4, 5);
      renderer.render(items, { start: 4, end: 7 }, new Set(), -1);

      const el4 = container.querySelector("[data-index='4']") as HTMLElement;
      expect(el4).toBeTruthy();
      expect(el4.getAttribute("data-id")).toBe("5");
      expect(el4.getAttribute("data-row")).toBe("1");
      expect(el4.getAttribute("data-col")).toBe("0");

      renderer.destroy();
    });
  });

  // ===========================================================================
  // updatePositions()
  // ===========================================================================

  describe("updatePositions", () => {
    it("should update positions of all rendered items", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // Get original position
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      const originalTransform = el0.style.transform;

      // Update positions with a compression context (no compression active)
      renderer.updatePositions({
        scrollTop: 0,
        containerHeight: 600,
        totalItems: 2, // totalRows in grid mode
        rangeStart: 0,
      });

      // Positions should still be set (may or may not change depending on compression)
      expect(el0.style.transform).toBeTruthy();

      renderer.destroy();
    });
  });

  // ===========================================================================
  // updateItem()
  // ===========================================================================

  describe("updateItem", () => {
    it("should update a single rendered item", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // Update item at index 2
      const updatedItem: TestItem = { id: 99, name: "Updated" };
      renderer.updateItem(2, updatedItem, true, false);

      const el2 = container.querySelector("[data-index='2']") as HTMLElement;
      expect(el2.innerHTML).toContain("Updated");
      expect(el2.getAttribute("data-id")).toBe("99");
      expect(el2.ariaSelected).toBe("true");
      expect(el2.classList.contains("vlist-item--selected")).toBe(true);

      renderer.destroy();
    });

    it("should be a no-op for non-rendered index", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // Update index that's not rendered — should not throw
      renderer.updateItem(100, { id: 999, name: "Ghost" }, false, false);

      expect(container.querySelectorAll("[data-index]").length).toBe(4);

      renderer.destroy();
    });

    it("should update size styles on item update", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      const originalWidth = el0.style.width;
      const originalHeight = el0.style.height;

      // Update item — should re-apply size styles
      renderer.updateItem(0, items[0]!, false, false);

      expect(el0.style.width).toBe(originalWidth);
      expect(el0.style.height).toBe(originalHeight);

      renderer.destroy();
    });
  });

  // ===========================================================================
  // updateItemClasses()
  // ===========================================================================

  describe("updateItemClasses", () => {
    it("should toggle selected class", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.classList.contains("vlist-item--selected")).toBe(false);

      renderer.updateItemClasses(0, true, false);
      expect(el0.classList.contains("vlist-item--selected")).toBe(true);

      renderer.updateItemClasses(0, false, false);
      expect(el0.classList.contains("vlist-item--selected")).toBe(false);

      renderer.destroy();
    });

    it("should toggle focused class", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el1 = container.querySelector("[data-index='1']") as HTMLElement;

      renderer.updateItemClasses(1, false, true);
      expect(el1.classList.contains("vlist-item--focused")).toBe(true);

      renderer.updateItemClasses(1, false, false);
      expect(el1.classList.contains("vlist-item--focused")).toBe(false);

      renderer.destroy();
    });

    it("should be a no-op for non-rendered index", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // Should not throw for index not in rendered map
      renderer.updateItemClasses(999, true, true);

      renderer.destroy();
    });
  });

  // ===========================================================================
  // getElement()
  // ===========================================================================

  describe("getElement", () => {
    it("should return element for rendered index", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el = renderer.getElement(0);
      expect(el).toBeTruthy();
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el!.getAttribute("data-index")).toBe("0");

      renderer.destroy();
    });

    it("should return undefined for non-rendered index", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      expect(renderer.getElement(100)).toBeUndefined();

      renderer.destroy();
    });

    it("should return undefined after element is removed by range change", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(12);

      renderer.render(items.slice(0, 8), { start: 0, end: 7 }, new Set(), -1);
      expect(renderer.getElement(0)).toBeTruthy();

      // Move range so item 0 is removed
      renderer.render(items.slice(4, 12), { start: 4, end: 11 }, new Set(), -1);
      expect(renderer.getElement(0)).toBeUndefined();

      renderer.destroy();
    });
  });

  // ===========================================================================
  // updateContainerWidth()
  // ===========================================================================

  describe("updateContainerWidth", () => {
    it("should re-size and reposition items when width changes", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      const originalWidth = el0.style.width;

      // Change container width
      renderer.updateContainerWidth(1200);

      // Width should be recalculated: (1200 - 3*8) / 4 = 294
      expect(el0.style.width).toBe("294px");
      expect(el0.style.width).not.toBe(originalWidth);

      renderer.destroy();
    });

    it("should update column offsets for non-first columns", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      const originalTransform = el1.style.transform;

      // Change container width
      renderer.updateContainerWidth(1200);

      // Position should be updated
      // New columnWidth = (1200 - 24) / 4 = 294
      // Col 1 offset = 1 * (294 + 8) = 302
      expect(el1.style.transform).toBe("translate(302px, 0px)");
      expect(el1.style.transform).not.toBe(originalTransform);

      renderer.destroy();
    });

    it("should be a no-op when width change is < 1px", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      const originalWidth = el0.style.width;

      // Tiny change less than 1px
      renderer.updateContainerWidth(800.5);

      expect(el0.style.width).toBe(originalWidth);

      renderer.destroy();
    });

    it("should handle resize with no rendered items", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      // Resize without rendering anything — should not throw
      renderer.updateContainerWidth(1200);

      renderer.destroy();
    });
  });

  // ===========================================================================
  // clear()
  // ===========================================================================

  describe("clear", () => {
    it("should remove all rendered items from DOM", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(8);
      renderer.render(items, { start: 0, end: 7 }, new Set(), -1);
      expect(container.querySelectorAll("[data-index]").length).toBe(8);

      renderer.clear();

      expect(container.querySelectorAll("[data-index]").length).toBe(0);

      renderer.destroy();
    });

    it("should allow re-rendering after clear", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      renderer.clear();
      expect(container.querySelectorAll("[data-index]").length).toBe(0);

      // Re-render
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);
      expect(container.querySelectorAll("[data-index]").length).toBe(4);

      renderer.destroy();
    });
  });

  // ===========================================================================
  // destroy()
  // ===========================================================================

  describe("destroy", () => {
    it("should remove all elements and clear pool", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(8);
      renderer.render(items, { start: 0, end: 7 }, new Set(), -1);
      expect(container.querySelectorAll("[data-index]").length).toBe(8);

      renderer.destroy();

      expect(container.querySelectorAll("[data-index]").length).toBe(0);
    });
  });

  // ===========================================================================
  // Custom class prefix
  // ===========================================================================

  describe("custom class prefix", () => {
    it("should use custom prefix for item classes", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "mylist",
        800,
      );

      const items = createTestItems(2);
      const selectedIds = new Set<string | number>([1]);
      renderer.render(items, { start: 0, end: 1 }, selectedIds, 0);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.classList.contains("mylist-item")).toBe(true);
      expect(el0.classList.contains("mylist-grid-item")).toBe(true);
      expect(el0.classList.contains("mylist-item--selected")).toBe(true);
      expect(el0.classList.contains("mylist-item--focused")).toBe(true);

      renderer.destroy();
    });
  });

  // ===========================================================================
  // Element pooling
  // ===========================================================================

  describe("element pooling", () => {
    it("should reuse pooled elements when items leave and re-enter range", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(16);

      // Render first 8 items
      renderer.render(items.slice(0, 8), { start: 0, end: 7 }, new Set(), -1);

      // Move range so items 0-3 are released to pool
      renderer.render(items.slice(4, 12), { start: 4, end: 11 }, new Set(), -1);

      // Move back — should reuse pooled elements
      renderer.render(items.slice(0, 8), { start: 0, end: 7 }, new Set(), -1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0).toBeTruthy();
      expect(el0.getAttribute("data-id")).toBe("1");

      renderer.destroy();
    });
  });

  // ===========================================================================
  // Grid layout variations
  // ===========================================================================

  describe("grid layout variations", () => {
    it("should work with 1 column (degenerates to list)", () => {
      const singleColLayout = createGridLayout({ columns: 1 });
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        singleColLayout,
        "vlist",
        800,
      );

      const items = createTestItems(3);
      renderer.render(items, { start: 0, end: 2 }, new Set(), -1);

      // All items should be in column 0
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      const el2 = container.querySelector("[data-index='2']") as HTMLElement;

      expect(el0.getAttribute("data-col")).toBe("0");
      expect(el1.getAttribute("data-col")).toBe("0");
      expect(el2.getAttribute("data-col")).toBe("0");

      // All should be at x=0
      expect(el0.style.transform).toBe("translate(0px, 0px)");
      expect(el1.style.transform).toBe("translate(0px, 100px)");
      expect(el2.style.transform).toBe("translate(0px, 200px)");

      renderer.destroy();
    });

    it("should work with many columns", () => {
      const wideLayout = createGridLayout({ columns: 8 });
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        wideLayout,
        "vlist",
        800,
      );

      const items = createTestItems(8);
      renderer.render(items, { start: 0, end: 7 }, new Set(), -1);

      // All items should be in row 0
      for (let i = 0; i < 8; i++) {
        const el = container.querySelector(
          `[data-index='${i}']`,
        ) as HTMLElement;
        expect(el.getAttribute("data-row")).toBe("0");
        expect(el.getAttribute("data-col")).toBe(String(i));
      }

      renderer.destroy();
    });

    it("should handle grid with gap = 0", () => {
      const noGapLayout = createGridLayout({ columns: 4, gap: 0 });
      const noGapSizeCache = createMockSizeCache(50); // no gap in row height

      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        noGapSizeCache,
        noGapLayout,
        "vlist",
        800,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // columnWidth = 800 / 4 = 200
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.style.width).toBe("200px");

      // col 1 offset = 1 * (200 + 0) = 200
      const el1 = container.querySelector("[data-index='1']") as HTMLElement;
      expect(el1.style.transform).toBe("translate(200px, 0px)");

      renderer.destroy();
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle empty items array", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      // Render with empty range
      renderer.render([], { start: 0, end: -1 }, new Set(), -1);
      expect(container.querySelectorAll("[data-index]").length).toBe(0);

      renderer.destroy();
    });

    it("should handle single item", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(1);
      renderer.render(items, { start: 0, end: 0 }, new Set(), -1);

      expect(container.querySelectorAll("[data-index]").length).toBe(1);

      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.getAttribute("data-row")).toBe("0");
      expect(el0.getAttribute("data-col")).toBe("0");

      renderer.destroy();
    });

    it("should handle rapid render calls", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        800,
      );

      const items = createTestItems(20);

      for (let i = 0; i < 10; i++) {
        const start = i * 2;
        const end = Math.min(start + 7, 19);
        renderer.render(
          items.slice(start, end + 1),
          { start, end },
          new Set(),
          -1,
        );
      }

      // Should have items for the last rendered range
      const rendered = container.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);

      renderer.destroy();
    });

    it("should handle container width of 0", () => {
      const renderer = createGridRenderer<TestItem>(
        container,
        defaultTemplate,
        sizeCache,
        gridLayout,
        "vlist",
        0,
      );

      const items = createTestItems(4);
      renderer.render(items, { start: 0, end: 3 }, new Set(), -1);

      // Should render without errors, widths will be 0
      const el0 = container.querySelector("[data-index='0']") as HTMLElement;
      expect(el0.style.width).toBe("0px");

      renderer.destroy();
    });
  });
});

describe("grid renderer compressed positioning", () => {
  let itemsContainer: HTMLElement;

  beforeEach(() => {
    itemsContainer = document.createElement("div");
    itemsContainer.className = "vlist-items";
    document.body.appendChild(itemsContainer);
  });

  afterEach(() => {
    itemsContainer.remove();
  });

  it("should use compressed positioning for large grids", () => {
    // Create grid layout and height cache for a very large grid
    // that would trigger compression
    const gridLayout = createGridLayout({ columns: 4, gap: 8 });
    const totalItems = 2_000_000;
    const totalRows = gridLayout.getTotalRows(totalItems);
    const rowHeight = 50 + 8; // item height + gap

    const sizeCache = createSizeCache(rowHeight, totalRows);

    const gridRenderer = createGridRenderer<TestItem>(
      itemsContainer,
      template,
      sizeCache,
      gridLayout,
      "vlist",
      800, // containerWidth
    );

    // Create a small set of items for the visible range
    const items = createTestItems(20);

    // Render with compression context (simulating a compressed scroll state)
    const compressionCtx = {
      scrollTop: 5_000_000,
      totalItems: totalRows,
      containerHeight: 500,
      rangeStart: 100000,
    };

    // L231-239: When compressionCtx is provided and compression is active,
    // calculateRowOffset should use calculateCompressedItemPosition
    gridRenderer.render(
      items,
      { start: 100000, end: 100019 },
      new Set(),
      -1,
      compressionCtx,
    );

    // Verify items were rendered
    const rendered = itemsContainer.querySelectorAll("[data-index]");
    expect(rendered.length).toBe(20);

    gridRenderer.destroy();
  });
});
