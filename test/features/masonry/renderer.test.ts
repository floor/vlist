/**
 * vlist - Masonry Renderer Tests
 * Tests for the masonry renderer: absolute positioning, sizing, element pool,
 * selection/focus classes, horizontal mode, lifecycle, and edge cases.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { JSDOM } from "jsdom";
import { createMasonryRenderer } from "../../../src/features/masonry/renderer";
import type { MasonryRenderer } from "../../../src/features/masonry/renderer";
import type { ItemPlacement } from "../../../src/features/masonry/types";
import type { VListItem, ItemTemplate, ItemState } from "../../../src/types";

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

const defaultTemplate: ItemTemplate<TestItem> = (
  item: TestItem,
  _index: number,
  _state: ItemState,
): string => {
  return `<span>${item.name}</span>`;
};

/**
 * Create a placement for testing.
 * Defaults produce a vertical placement in lane 0.
 */
const createPlacement = (
  index: number,
  options?: Partial<{
    x: number;
    y: number;
    lane: number;
    size: number;
    crossSize: number;
  }>,
): ItemPlacement => ({
  index,
  position: {
    x: options?.x ?? 0,
    y: options?.y ?? index * 100,
    lane: options?.lane ?? 0,
  },
  size: options?.size ?? 100,
  crossSize: options?.crossSize ?? 200,
});

/**
 * Create placements simulating a 2-column masonry layout.
 * Even indices → lane 0, odd indices → lane 1.
 */
const createTwoColumnPlacements = (
  count: number,
  colWidth: number = 200,
  gap: number = 0,
): ItemPlacement[] => {
  const laneSizes = [0, 0];
  const placements: ItemPlacement[] = [];

  for (let i = 0; i < count; i++) {
    const lane = laneSizes[0]! <= laneSizes[1]! ? 0 : 1;
    const y = laneSizes[lane]!;
    const x = lane * (colWidth + gap);
    const size = 100 + (i % 3) * 50; // heights: 100, 150, 200, 100, ...

    placements.push({
      index: i,
      position: { x, y, lane },
      size,
      crossSize: colWidth,
    });

    laneSizes[lane]! += size + gap;
  }

  return placements;
};

// =============================================================================
// Initialization
// =============================================================================

describe("createMasonryRenderer", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should create a renderer with all required methods", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );

    expect(renderer.render).toBeInstanceOf(Function);
    expect(renderer.updateItem).toBeInstanceOf(Function);
    expect(renderer.updateItemClasses).toBeInstanceOf(Function);
    expect(renderer.getElement).toBeInstanceOf(Function);
    expect(renderer.clear).toBeInstanceOf(Function);
    expect(renderer.destroy).toBeInstanceOf(Function);
  });

  it("should create renderer with aria options", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
      () => 50,
      "vlist-1",
    );

    expect(renderer).toBeDefined();
  });
});

// =============================================================================
// render — basic rendering
// =============================================================================

describe("render", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should render items into the container", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0, { lane: 0, y: 0, x: 0 }),
      createPlacement(1, { lane: 1, y: 0, x: 200 }),
      createPlacement(2, { lane: 0, y: 100, x: 0 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    expect(container.children.length).toBe(3);
  });

  it("should apply template content to rendered items", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [
      createPlacement(0, { y: 0 }),
      createPlacement(1, { y: 100 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.innerHTML).toBe("<span>Item 1</span>");
  });

  it("should support HTMLElement templates", () => {
    const elementTemplate: ItemTemplate<TestItem> = (item) => {
      const el = document.createElement("div");
      el.textContent = item.name;
      return el;
    };

    const renderer = createMasonryRenderer<TestItem>(
      container,
      elementTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0, { y: 0 })];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.textContent).toBe("Item 1");
  });

  it("should set data-index and data-id attributes", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [
      createPlacement(0, { y: 0 }),
      createPlacement(1, { y: 100 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.dataset.index).toBe("0");
    expect(el0.dataset.id).toBe("1");

    const el1 = container.children[1] as HTMLElement;
    expect(el1.dataset.index).toBe("1");
    expect(el1.dataset.id).toBe("2");
  });

  it("should set data-lane attribute", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0, { lane: 0 }),
      createPlacement(1, { lane: 1 }),
      createPlacement(2, { lane: 2 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    expect((container.children[0] as HTMLElement).dataset.lane).toBe("0");
    expect((container.children[1] as HTMLElement).dataset.lane).toBe("1");
    expect((container.children[2] as HTMLElement).dataset.lane).toBe("2");
  });

  it("should set role=option on rendered items", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.getAttribute("role")).toBe("option");
  });

  it("should apply base CSS classes including masonry-item", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.classList.contains("vlist-item")).toBe(true);
    expect(el0.classList.contains("vlist-masonry-item")).toBe(true);
  });

  it("should skip undefined items in the sparse array", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );

    // Sparse array: only index 5 has a value
    const items: TestItem[] = [];
    items[5] = { id: 6, name: "Item 6" };

    const placements = [createPlacement(5, { y: 500 })];

    renderer.render(items, placements, new Set(), -1);

    expect(container.children.length).toBe(1);
    const el = container.children[0] as HTMLElement;
    expect(el.dataset.index).toBe("5");
    expect(el.innerHTML).toBe("<span>Item 6</span>");
  });
});

// =============================================================================
// render — positioning
// =============================================================================

describe("render - positioning", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should position items with translate(x, y) in vertical mode", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [
      createPlacement(0, { x: 0, y: 0 }),
      createPlacement(1, { x: 200, y: 50 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.style.transform).toBe("translate(0px, 0px)");

    const el1 = container.children[1] as HTMLElement;
    expect(el1.style.transform).toBe("translate(200px, 50px)");
  });

  it("should swap axes in horizontal mode", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      true, // horizontal
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0, { x: 50, y: 300 })];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    // horizontal: translate(y, x) — main axis (y) becomes X, cross axis (x) becomes Y
    expect(el0.style.transform).toBe("translate(300px, 50px)");
  });

  it("should round coordinates to integers", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0, { x: 103.333, y: 206.667 })];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.style.transform).toBe("translate(103px, 207px)");
  });
});

// =============================================================================
// render — sizing
// =============================================================================

describe("render - sizing", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should set width and height in vertical mode", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0, { size: 250, crossSize: 194 })];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    // vertical: width = crossSize, height = size
    expect(el0.style.width).toBe("194px");
    expect(el0.style.height).toBe("250px");
  });

  it("should swap width and height in horizontal mode", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      true, // horizontal
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0, { size: 300, crossSize: 150 })];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    // horizontal: width = size, height = crossSize
    expect(el0.style.width).toBe("300px");
    expect(el0.style.height).toBe("150px");
  });

  it("should apply different sizes per item", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0, { size: 200, crossSize: 194 }),
      createPlacement(1, { size: 300, crossSize: 194 }),
      createPlacement(2, { size: 150, crossSize: 194 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    expect((container.children[0] as HTMLElement).style.height).toBe("200px");
    expect((container.children[1] as HTMLElement).style.height).toBe("300px");
    expect((container.children[2] as HTMLElement).style.height).toBe("150px");
  });
});

// =============================================================================
// render — selection and focus
// =============================================================================

describe("render - selection and focus", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should apply selected class to selected items", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0),
      createPlacement(1),
      createPlacement(2),
    ];
    const selectedIds = new Set<string | number>([1, 3]); // item ids 1 and 3

    renderer.render(items, placements, selectedIds, -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.classList.contains("vlist-item--selected")).toBe(true);

    const el1 = container.children[1] as HTMLElement;
    expect(el1.classList.contains("vlist-item--selected")).toBe(false);

    const el2 = container.children[2] as HTMLElement;
    expect(el2.classList.contains("vlist-item--selected")).toBe(true);
  });

  it("should apply focused class to focused item", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0),
      createPlacement(1),
      createPlacement(2),
    ];

    renderer.render(items, placements, new Set(), 1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.classList.contains("vlist-item--focused")).toBe(false);

    const el1 = container.children[1] as HTMLElement;
    expect(el1.classList.contains("vlist-item--focused")).toBe(true);

    const el2 = container.children[2] as HTMLElement;
    expect(el2.classList.contains("vlist-item--focused")).toBe(false);
  });

  it("should set aria-selected attribute", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];
    const selectedIds = new Set<string | number>([2]); // item id 2

    renderer.render(items, placements, selectedIds, -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.ariaSelected).toBe("false");

    const el1 = container.children[1] as HTMLElement;
    expect(el1.ariaSelected).toBe("true");
  });
});

// =============================================================================
// render — ARIA attributes
// =============================================================================

describe("render - ARIA", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should set aria-setsize and aria-posinset when totalItemsGetter provided", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
      () => 100,
      "vlist-1",
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.getAttribute("aria-setsize")).toBe("100");
    expect(el0.getAttribute("aria-posinset")).toBe("1");

    const el1 = container.children[1] as HTMLElement;
    expect(el1.getAttribute("aria-posinset")).toBe("2");
  });

  it("should set element id when ariaIdPrefix provided", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
      () => 50,
      "vlist-7",
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.id).toBe("vlist-7-item-0");

    const el1 = container.children[1] as HTMLElement;
    expect(el1.id).toBe("vlist-7-item-1");
  });

  it("should not set aria-setsize if no totalItemsGetter", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.getAttribute("aria-setsize")).toBeNull();
  });
});

// =============================================================================
// render — recycling (items leaving / entering)
// =============================================================================

describe("render - recycling", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should remove items no longer in the visible set", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(6);

    // First render: items 0-2
    const placements1 = [
      createPlacement(0, { y: 0 }),
      createPlacement(1, { y: 100 }),
      createPlacement(2, { y: 200 }),
    ];
    renderer.render(items, placements1, new Set(), -1);
    expect(container.children.length).toBe(3);

    // Second render: items 3-5 (0-2 should be recycled)
    const placements2 = [
      createPlacement(3, { y: 300 }),
      createPlacement(4, { y: 400 }),
      createPlacement(5, { y: 500 }),
    ];
    renderer.render(items, placements2, new Set(), -1);
    expect(container.children.length).toBe(3);

    // Verify new items are rendered
    const indices = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(indices).toContain("3");
    expect(indices).toContain("4");
    expect(indices).toContain("5");
    expect(indices).not.toContain("0");
  });

  it("should update existing items that remain visible", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(4);
    const placements = [
      createPlacement(0, { y: 0 }),
      createPlacement(1, { y: 100 }),
      createPlacement(2, { y: 200 }),
    ];

    renderer.render(items, placements, new Set(), -1);
    expect(container.children.length).toBe(3);

    // Re-render with items 1-3 (item 1 and 2 remain, item 0 removed, item 3 added)
    const placements2 = [
      createPlacement(1, { y: 100 }),
      createPlacement(2, { y: 200 }),
      createPlacement(3, { y: 300 }),
    ];
    renderer.render(items, placements2, new Set(), -1);
    expect(container.children.length).toBe(3);

    const indices = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(indices).toContain("1");
    expect(indices).toContain("2");
    expect(indices).toContain("3");
  });

  it("should handle completely new set of items", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(10);

    // Render items 0-2
    renderer.render(
      items,
      [createPlacement(0), createPlacement(1), createPlacement(2)],
      new Set(),
      -1,
    );

    // Render items 7-9 (no overlap)
    renderer.render(
      items,
      [createPlacement(7, { y: 700 }), createPlacement(8, { y: 800 }), createPlacement(9, { y: 900 })],
      new Set(),
      -1,
    );

    expect(container.children.length).toBe(3);
    const indices = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(indices).toContain("7");
    expect(indices).toContain("8");
    expect(indices).toContain("9");
  });
});

// =============================================================================
// updateItem
// =============================================================================

describe("updateItem", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should update a single rendered item", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0),
      createPlacement(1),
      createPlacement(2),
    ];

    renderer.render(items, placements, new Set(), -1);

    const updatedItem: TestItem = { id: 2, name: "Updated Item 2" };
    const updatedPlacement = createPlacement(1, { y: 150 });
    renderer.updateItem(1, updatedItem, updatedPlacement, false, false);

    const el1 = renderer.getElement(1)!;
    expect(el1.innerHTML).toBe("<span>Updated Item 2</span>");
    expect(el1.style.transform).toBe("translate(0px, 150px)");
  });

  it("should be a no-op for non-rendered index", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];

    renderer.render(items, placements, new Set(), -1);

    // Index 5 is not rendered — should not throw
    const updatedItem: TestItem = { id: 6, name: "Ghost" };
    renderer.updateItem(5, updatedItem, createPlacement(5), false, false);

    // Nothing changed
    expect(container.children.length).toBe(2);
  });

  it("should update selection and focus state on item update", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = renderer.getElement(0)!;
    expect(el0.classList.contains("vlist-item--selected")).toBe(false);
    expect(el0.classList.contains("vlist-item--focused")).toBe(false);

    renderer.updateItem(0, items[0]!, placements[0]!, true, true);

    expect(el0.classList.contains("vlist-item--selected")).toBe(true);
    expect(el0.classList.contains("vlist-item--focused")).toBe(true);
  });
});

// =============================================================================
// updateItemClasses
// =============================================================================

describe("updateItemClasses", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should toggle selected class", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    const el0 = renderer.getElement(0)!;
    expect(el0.classList.contains("vlist-item--selected")).toBe(false);

    renderer.updateItemClasses(0, true, false);
    expect(el0.classList.contains("vlist-item--selected")).toBe(true);

    renderer.updateItemClasses(0, false, false);
    expect(el0.classList.contains("vlist-item--selected")).toBe(false);
  });

  it("should toggle focused class", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    renderer.updateItemClasses(0, false, true);
    const el0 = renderer.getElement(0)!;
    expect(el0.classList.contains("vlist-item--focused")).toBe(true);

    renderer.updateItemClasses(0, false, false);
    expect(el0.classList.contains("vlist-item--focused")).toBe(false);
  });

  it("should update aria-selected attribute", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    renderer.updateItemClasses(0, true, false);
    expect(renderer.getElement(0)!.ariaSelected).toBe("true");

    renderer.updateItemClasses(0, false, false);
    expect(renderer.getElement(0)!.ariaSelected).toBe("false");
  });

  it("should be a no-op for non-rendered index", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    // Should not throw
    renderer.updateItemClasses(99, true, true);
    expect(container.children.length).toBe(1);
  });
});

// =============================================================================
// getElement
// =============================================================================

describe("getElement", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should return element for rendered index", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];

    renderer.render(items, placements, new Set(), -1);

    const el = renderer.getElement(0);
    expect(el).toBeDefined();
    expect(el!.dataset.index).toBe("0");
  });

  it("should return undefined for non-rendered index", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);

    expect(renderer.getElement(5)).toBeUndefined();
  });

  it("should return undefined after element is recycled", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(4);

    // Render items 0-1
    renderer.render(
      items,
      [createPlacement(0), createPlacement(1)],
      new Set(),
      -1,
    );
    expect(renderer.getElement(0)).toBeDefined();

    // Render items 2-3 (0-1 recycled)
    renderer.render(
      items,
      [createPlacement(2, { y: 200 }), createPlacement(3, { y: 300 })],
      new Set(),
      -1,
    );
    expect(renderer.getElement(0)).toBeUndefined();
    expect(renderer.getElement(2)).toBeDefined();
  });
});

// =============================================================================
// clear
// =============================================================================

describe("clear", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should remove all rendered items from DOM", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0),
      createPlacement(1),
      createPlacement(2),
    ];

    renderer.render(items, placements, new Set(), -1);
    expect(container.children.length).toBe(3);

    renderer.clear();
    expect(container.children.length).toBe(0);
  });

  it("should clear element tracking so getElement returns undefined", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];

    renderer.render(items, placements, new Set(), -1);
    expect(renderer.getElement(0)).toBeDefined();

    renderer.clear();
    expect(renderer.getElement(0)).toBeUndefined();
  });

  it("should allow re-rendering after clear", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];

    renderer.render(items, placements, new Set(), -1);
    renderer.clear();

    renderer.render(items, placements, new Set(), -1);
    expect(container.children.length).toBe(2);
  });
});

// =============================================================================
// destroy
// =============================================================================

describe("destroy", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should remove all elements and clear pool", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0),
      createPlacement(1),
      createPlacement(2),
    ];

    renderer.render(items, placements, new Set(), -1);
    expect(container.children.length).toBe(3);

    renderer.destroy();
    expect(container.children.length).toBe(0);
    expect(renderer.getElement(0)).toBeUndefined();
  });
});

// =============================================================================
// Custom class prefix
// =============================================================================

describe("custom class prefix", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should use custom prefix for item classes", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "mylist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0)];
    const selectedIds = new Set<string | number>([1]);

    renderer.render(items, placements, selectedIds, 0);

    const el0 = container.children[0] as HTMLElement;
    expect(el0.classList.contains("mylist-item")).toBe(true);
    expect(el0.classList.contains("mylist-masonry-item")).toBe(true);
    expect(el0.classList.contains("mylist-item--selected")).toBe(true);
    expect(el0.classList.contains("mylist-item--focused")).toBe(true);
  });
});

// =============================================================================
// Element pooling
// =============================================================================

describe("element pooling", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should reuse pooled elements when items leave and re-enter", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(6);

    // Render items 0-2
    renderer.render(
      items,
      [createPlacement(0), createPlacement(1), createPlacement(2)],
      new Set(),
      -1,
    );
    const domCount1 = container.children.length;
    expect(domCount1).toBe(3);

    // Replace with items 3-5
    renderer.render(
      items,
      [createPlacement(3, { y: 300 }), createPlacement(4, { y: 400 }), createPlacement(5, { y: 500 })],
      new Set(),
      -1,
    );
    expect(container.children.length).toBe(3);

    // Back to items 0-2 — pool should supply recycled elements
    renderer.render(
      items,
      [createPlacement(0), createPlacement(1), createPlacement(2)],
      new Set(),
      -1,
    );
    expect(container.children.length).toBe(3);

    const el0 = renderer.getElement(0)!;
    expect(el0.innerHTML).toBe("<span>Item 1</span>");
  });
});

// =============================================================================
// Horizontal mode — full flow
// =============================================================================

describe("horizontal mode", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should swap width/height and transform axes", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      true,
    );
    const items = createTestItems(2);
    const placements = [
      createPlacement(0, { x: 50, y: 0, size: 200, crossSize: 150 }),
      createPlacement(1, { x: 50, y: 210, size: 300, crossSize: 150 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    const el0 = container.children[0] as HTMLElement;
    // horizontal: width = size (main axis), height = crossSize (cross axis)
    expect(el0.style.width).toBe("200px");
    expect(el0.style.height).toBe("150px");
    // horizontal: translate(y, x) — y is main axis (horizontal scroll)
    expect(el0.style.transform).toBe("translate(0px, 50px)");

    const el1 = container.children[1] as HTMLElement;
    expect(el1.style.width).toBe("300px");
    expect(el1.style.height).toBe("150px");
    expect(el1.style.transform).toBe("translate(210px, 50px)");
  });
});

// =============================================================================
// Multi-column layout rendering
// =============================================================================

describe("multi-column rendering", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should render items across multiple lanes with correct positions", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(6);
    const placements = createTwoColumnPlacements(6, 200);

    renderer.render(items, placements, new Set(), -1);

    expect(container.children.length).toBe(6);

    // Verify each item is in its correct lane
    for (let i = 0; i < 6; i++) {
      const el = renderer.getElement(i)!;
      expect(el.dataset.lane).toBe(String(placements[i]!.position.lane));
      expect(el.dataset.index).toBe(String(i));
    }
  });

  it("should correctly position items with gap in multi-column layout", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(4);
    const gap = 8;
    const colWidth = 196; // (400 - 8) / 2
    const placements = createTwoColumnPlacements(4, colWidth, gap);

    renderer.render(items, placements, new Set(), -1);

    // Items in lane 1 should have x offset = colWidth + gap
    for (const p of placements) {
      if (p.position.lane === 1) {
        const el = renderer.getElement(p.index)!;
        expect(el.style.transform).toContain(`${colWidth + gap}px`);
      }
    }
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle empty placements array", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );

    renderer.render([], [], new Set(), -1);
    expect(container.children.length).toBe(0);
  });

  it("should handle single item", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(1);
    const placements = [createPlacement(0, { y: 0, x: 0, size: 250 })];

    renderer.render(items, placements, new Set(), -1);

    expect(container.children.length).toBe(1);
    const el0 = container.children[0] as HTMLElement;
    expect(el0.style.height).toBe("250px");
  });

  it("should handle rapid render calls", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(10);

    // Rapid sequential renders with shifting windows
    for (let i = 0; i < 10; i++) {
      const start = i;
      const end = Math.min(i + 3, 9);
      const placements = [];
      for (let j = start; j <= end; j++) {
        placements.push(createPlacement(j, { y: j * 100 }));
      }
      renderer.render(items, placements, new Set(), -1);
    }

    // Last render window is items 9 (start=9, end=min(12,9)=9 → single item)
    // Verify the renderer is in a consistent state after rapid updates
    const renderedCount = container.children.length;
    expect(renderedCount).toBeGreaterThan(0);

    // Item 9 must be present (it was in the last render call)
    const indices = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(indices).toContain("9");
  });

  it("should handle item with undefined in items array", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );

    // Sparse array — item at index 2 is undefined
    const items: TestItem[] = [];
    items[0] = { id: 1, name: "First" };
    items[2] = { id: 3, name: "Third" };

    const placements = [
      createPlacement(0, { y: 0 }),
      createPlacement(1, { y: 100 }), // will be skipped — items[1] is undefined
      createPlacement(2, { y: 200 }),
    ];

    renderer.render(items, placements, new Set(), -1);

    // Only 2 items rendered (index 1 skipped because undefined)
    expect(container.children.length).toBe(2);
  });

  it("should handle rendering same items again (idempotent)", () => {
    const renderer = createMasonryRenderer<TestItem>(
      container,
      defaultTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(3);
    const placements = [
      createPlacement(0),
      createPlacement(1),
      createPlacement(2),
    ];

    renderer.render(items, placements, new Set(), -1);
    expect(container.children.length).toBe(3);

    // Render same items again
    renderer.render(items, placements, new Set(), -1);
    expect(container.children.length).toBe(3);

    // Content should still be correct
    const el0 = renderer.getElement(0)!;
    expect(el0.innerHTML).toBe("<span>Item 1</span>");
  });
});

// =============================================================================
// Template state
// =============================================================================

describe("template receives correct state", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createItemsContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should pass selected=true to template for selected items", () => {
    let capturedState: ItemState | null = null;
    const statefulTemplate: ItemTemplate<TestItem> = (item, _index, state) => {
      if (item.id === 2) capturedState = { ...state };
      return `<span>${item.name}</span>`;
    };

    const renderer = createMasonryRenderer<TestItem>(
      container,
      statefulTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];
    const selectedIds = new Set<string | number>([2]); // item id 2

    renderer.render(items, placements, selectedIds, -1);

    expect(capturedState).not.toBeNull();
    expect(capturedState!.selected).toBe(true);
    expect(capturedState!.focused).toBe(false);
  });

  it("should pass focused=true to template for focused item", () => {
    let capturedState: ItemState | null = null;
    const statefulTemplate: ItemTemplate<TestItem> = (item, _index, state) => {
      if (item.id === 1) capturedState = { ...state };
      return `<span>${item.name}</span>`;
    };

    const renderer = createMasonryRenderer<TestItem>(
      container,
      statefulTemplate,
      "vlist",
      false,
    );
    const items = createTestItems(2);
    const placements = [createPlacement(0), createPlacement(1)];

    renderer.render(items, placements, new Set(), 0); // index 0 focused

    expect(capturedState).not.toBeNull();
    expect(capturedState!.focused).toBe(true);
    expect(capturedState!.selected).toBe(false);
  });
});