/**
 * vlist - Table Renderer Tests
 * Tests for the table renderer: render, pooling, change tracking,
 * grace-period release, column layout updates, and cell positioning.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { JSDOM } from "jsdom";
import { createTableRenderer, type TableRendererInstance } from "../../../src/features/table/renderer";
import { createTableLayout } from "../../../src/features/table/layout";
import { createSizeCache } from "../../../src/rendering/sizes";
import type { TableColumn, TableLayout } from "../../../src/features/table/types";
import type { VListItem } from "../../../src/types";

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
  global.DocumentFragment = dom.window.DocumentFragment;
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  email: string;
  role: string;
}

const makeItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@test.com`,
    role: i % 2 === 0 ? "admin" : "user",
  }));

const col = (key: string, opts: Partial<TableColumn<TestItem>> = {}): TableColumn<TestItem> => ({
  key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
  ...opts,
});

const EMPTY_SET: Set<string | number> = new Set();

function createTestRenderer(opts: {
  columns?: TableColumn<TestItem>[];
  totalItems?: number;
  rowHeight?: number;
  columnBorders?: boolean;
  rowBorders?: boolean;
} = {}) {
  const columns = opts.columns ?? [
    col("name", { width: 200 }),
    col("email", { width: 300 }),
    col("role", { width: 100 }),
  ];

  const totalItems = opts.totalItems ?? 100;
  const rowHeight = opts.rowHeight ?? 40;

  const container = document.createElement("div");
  document.body.appendChild(container);

  const sizeCache = createSizeCache(rowHeight, totalItems);

  const layout = createTableLayout<TestItem>(columns, 50, Infinity, true);
  layout.resolve(800);

  const renderer = createTableRenderer<TestItem>(
    container,
    sizeCache as any,
    layout,
    columns,
    "vlist",
    "vlist",
    opts.columnBorders ?? false,
    opts.rowBorders ?? true,
    () => totalItems,
  );

  return { container, sizeCache, layout, renderer, columns };
}

// =============================================================================
// Render Tests
// =============================================================================

describe("createTableRenderer", () => {
  it("should create a renderer with all required methods", () => {
    const { renderer, container } = createTestRenderer();
    expect(renderer.render).toBeFunction();
    expect(renderer.updateItem).toBeFunction();
    expect(renderer.updateItemClasses).toBeFunction();
    expect(renderer.getElement).toBeFunction();
    expect(renderer.updateColumnLayout).toBeFunction();
    expect(renderer.clear).toBeFunction();
    expect(renderer.destroy).toBeFunction();
    container.remove();
  });
});

describe("render", () => {
  it("should render rows for a range of items", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(10);

    renderer.render(items.slice(0, 5), { start: 0, end: 4 }, EMPTY_SET, -1);

    // Should have 5 row elements in the container
    const rows = container.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBe(5);

    container.remove();
  });

  it("should create cells for each column in each row", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBe(3);

    // Each row should have 3 cells (name, email, role)
    for (const row of rows) {
      const cells = row.querySelectorAll(".vlist-table-cell");
      expect(cells.length).toBe(3);
    }

    container.remove();
  });

  it("should render default cell content from item properties", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cells = container.querySelectorAll(".vlist-table-cell");
    expect(cells[0]!.textContent).toBe("User 0");
    expect(cells[1]!.textContent).toBe("user0@test.com");
    expect(cells[2]!.textContent).toBe("admin");

    container.remove();
  });

  it("should render custom cell template content", () => {
    const columns: TableColumn<TestItem>[] = [
      col("name", {
        width: 200,
        cell: (item) => `<strong>${item.name}</strong>`,
      }),
      col("email", { width: 300 }),
    ];

    const { renderer, container } = createTestRenderer({ columns });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cells = container.querySelectorAll(".vlist-table-cell");
    expect(cells[0]!.innerHTML).toBe("<strong>User 0</strong>");
    expect(cells[1]!.textContent).toBe("user0@test.com");

    container.remove();
  });

  it("should position rows with translateY from size cache", () => {
    const { renderer, container } = createTestRenderer({ rowHeight: 40 });
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).style.transform).toBe("translateY(0px)");
    expect((rows[1] as HTMLElement).style.transform).toBe("translateY(40px)");
    expect((rows[2] as HTMLElement).style.transform).toBe("translateY(80px)");

    container.remove();
  });

  it("should set row height from size cache", () => {
    const { renderer, container } = createTestRenderer({ rowHeight: 40 });
    const items = makeItems(2);

    renderer.render(items, { start: 0, end: 1 }, EMPTY_SET, -1);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).style.height).toBe("40px");
    expect((rows[1] as HTMLElement).style.height).toBe("40px");

    container.remove();
  });

  it("should position cells with left offset and width from layout", () => {
    const { renderer, container, layout } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cells = container.querySelectorAll(".vlist-table-cell");
    const cols = layout.columns;

    for (let i = 0; i < cols.length; i++) {
      const cell = cells[i] as HTMLElement;
      expect(cell.style.left).toBe(`${cols[i]!.offset}px`);
      expect(cell.style.width).toBe(`${cols[i]!.width}px`);
    }

    container.remove();
  });

  it("should set row width to total column width", () => {
    const { renderer, container, layout } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.style.width).toBe(`${layout.totalWidth}px`);

    container.remove();
  });

  it("should batch-insert new elements via DocumentFragment", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(5);

    // Before render, container should be empty
    expect(container.children.length).toBe(0);

    renderer.render(items, { start: 0, end: 4 }, EMPTY_SET, -1);

    // After render, all 5 elements should be present
    expect(container.children.length).toBe(5);

    container.remove();
  });

  it("should set ARIA attributes on rows", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(2);

    renderer.render(items, { start: 0, end: 1 }, EMPTY_SET, -1);

    const rows = container.querySelectorAll(".vlist-table-row");

    expect((rows[0] as HTMLElement).getAttribute("role")).toBe("row");
    expect((rows[0] as HTMLElement).getAttribute("data-id")).toBe("0");
    expect((rows[0] as HTMLElement).getAttribute("data-index")).toBe("0");
    expect((rows[0] as HTMLElement).getAttribute("aria-rowindex")).toBe("2"); // +2 for header
    expect((rows[0] as HTMLElement).id).toBe("vlist-0");

    expect((rows[1] as HTMLElement).getAttribute("aria-rowindex")).toBe("3");
    expect((rows[1] as HTMLElement).id).toBe("vlist-1");

    container.remove();
  });

  it("should set ARIA attributes on cells", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cells = container.querySelectorAll(".vlist-table-cell");

    expect((cells[0] as HTMLElement).getAttribute("role")).toBe("gridcell");
    expect((cells[0] as HTMLElement).getAttribute("aria-colindex")).toBe("1");
    expect((cells[1] as HTMLElement).getAttribute("aria-colindex")).toBe("2");
    expect((cells[2] as HTMLElement).getAttribute("aria-colindex")).toBe("3");

    container.remove();
  });

  it("should apply row borders when enabled", () => {
    const { renderer, container } = createTestRenderer({ rowBorders: true });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.style.borderBottom).toContain("1px solid");

    container.remove();
  });

  it("should apply column borders when enabled", () => {
    const { renderer, container } = createTestRenderer({ columnBorders: true });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cells = container.querySelectorAll(".vlist-table-cell");
    // First two cells should have right border (not the last one)
    expect((cells[0] as HTMLElement).style.borderRight).toContain("1px solid");
    expect((cells[1] as HTMLElement).style.borderRight).toContain("1px solid");
    // Last cell should NOT have a right border
    expect((cells[2] as HTMLElement).style.borderRight).toBe("");

    container.remove();
  });

  it("should not apply column borders when disabled", () => {
    const { renderer, container } = createTestRenderer({ columnBorders: false });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cells = container.querySelectorAll(".vlist-table-cell");
    for (const cell of cells) {
      expect((cell as HTMLElement).style.borderRight).toBe("");
    }

    container.remove();
  });
});

// =============================================================================
// Selection / Focus State
// =============================================================================

describe("selection and focus", () => {
  it("should apply selected class to selected rows", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);
    const selectedIds = new Set<string | number>([1]);

    renderer.render(items, { start: 0, end: 2 }, selectedIds, -1);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).classList.contains("vlist-item--selected")).toBe(false);
    expect((rows[1] as HTMLElement).classList.contains("vlist-item--selected")).toBe(true);
    expect((rows[2] as HTMLElement).classList.contains("vlist-item--selected")).toBe(false);

    container.remove();
  });

  it("should apply focused class to focused row", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, 2);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).classList.contains("vlist-item--focused")).toBe(false);
    expect((rows[1] as HTMLElement).classList.contains("vlist-item--focused")).toBe(false);
    expect((rows[2] as HTMLElement).classList.contains("vlist-item--focused")).toBe(true);

    container.remove();
  });

  it("should set aria-selected on selected rows", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(2);
    const selectedIds = new Set<string | number>([0]);

    renderer.render(items, { start: 0, end: 1 }, selectedIds, -1);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).getAttribute("aria-selected")).toBe("true");
    expect((rows[1] as HTMLElement).getAttribute("aria-selected")).toBeNull();

    container.remove();
  });

  it("should update selection state on re-render", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(2);

    // First render: item 0 selected
    renderer.render(items, { start: 0, end: 1 }, new Set([0]), -1);

    let rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).classList.contains("vlist-item--selected")).toBe(true);
    expect((rows[1] as HTMLElement).classList.contains("vlist-item--selected")).toBe(false);

    // Second render: item 1 selected instead
    renderer.render(items, { start: 0, end: 1 }, new Set([1]), -1);

    rows = container.querySelectorAll(".vlist-table-row");
    expect((rows[0] as HTMLElement).classList.contains("vlist-item--selected")).toBe(false);
    expect((rows[1] as HTMLElement).classList.contains("vlist-item--selected")).toBe(true);

    container.remove();
  });
});

// =============================================================================
// Change Tracking
// =============================================================================

describe("change tracking", () => {
  it("should skip template re-evaluation when item ID unchanged", () => {
    const columns: TableColumn<TestItem>[] = [
      col("name", {
        width: 200,
        cell: (item) => `<span>${item.name}</span>`,
      }),
    ];

    const { renderer, container } = createTestRenderer({ columns });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell")!;
    const originalHTML = cell.innerHTML;

    // Re-render with same item — template should not be re-evaluated
    // (we can verify by checking the same element is reused)
    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    expect(cell.innerHTML).toBe(originalHTML);

    container.remove();
  });

  it("should re-render cells when item ID changes at same index", () => {
    const { renderer, container } = createTestRenderer();
    const items1 = makeItems(1); // id: 0, name: "User 0"
    const items2: TestItem[] = [{ id: 999, name: "New User", email: "new@test.com", role: "superadmin" }];

    renderer.render(items1, { start: 0, end: 0 }, EMPTY_SET, -1);

    let cells = container.querySelectorAll(".vlist-table-cell");
    expect(cells[0]!.textContent).toBe("User 0");

    // Render with different item at same index
    renderer.render(items2, { start: 0, end: 0 }, EMPTY_SET, -1);

    cells = container.querySelectorAll(".vlist-table-cell");
    expect(cells[0]!.textContent).toBe("New User");
    expect(cells[1]!.textContent).toBe("new@test.com");

    container.remove();
  });

  it("should update position when transform changes", () => {
    const { renderer, container, sizeCache } = createTestRenderer({ rowHeight: 40 });
    const items = makeItems(2);

    // Render at range starting from index 5
    renderer.render(items, { start: 5, end: 6 }, EMPTY_SET, -1);

    const row = renderer.getElement(5);
    expect(row).toBeDefined();
    // Size cache for index 5 at height 40 → offset = 5 * 40 = 200
    expect(row!.style.transform).toBe("translateY(200px)");

    container.remove();
  });
});

// =============================================================================
// Grace Period Release
// =============================================================================

describe("grace period release", () => {
  it("should not immediately release rows that leave the range", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(10);

    // Render range 0-4
    renderer.render(items.slice(0, 5), { start: 0, end: 4 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(5);

    // Render range 3-7 — rows 0-2 left the range but should be in grace period
    renderer.render(items.slice(3, 8), { start: 3, end: 7 }, EMPTY_SET, -1);

    // Rows 0-2 still exist (grace period) + rows 3-7 = at least 5 visible
    // Grace period keeps old elements for a couple frames
    const rowCount = container.querySelectorAll(".vlist-table-row").length;
    expect(rowCount).toBeGreaterThanOrEqual(5);

    container.remove();
  });

  it("should release rows after grace period expires", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(20);

    // Render range 0-4
    renderer.render(items.slice(0, 5), { start: 0, end: 4 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(5);

    // Shift range several times to expire grace period (RELEASE_GRACE = 2)
    renderer.render(items.slice(5, 10), { start: 5, end: 9 }, EMPTY_SET, -1);
    renderer.render(items.slice(5, 10), { start: 5, end: 9 }, EMPTY_SET, -1);
    renderer.render(items.slice(5, 10), { start: 5, end: 9 }, EMPTY_SET, -1);

    // After 3+ frames, old rows 0-4 should be released
    const rowCount = container.querySelectorAll(".vlist-table-row").length;
    expect(rowCount).toBe(5); // Only the current range

    container.remove();
  });
});

// =============================================================================
// Element Pooling
// =============================================================================

describe("element pooling", () => {
  it("should reuse pooled elements after clear and re-render", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    // First render
    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(3);

    // Clear (returns to pool)
    renderer.clear();
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(0);

    // Re-render — should pick from pool
    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(3);

    container.remove();
  });
});

// =============================================================================
// getElement
// =============================================================================

describe("getElement", () => {
  it("should return element for rendered index", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);

    const el = renderer.getElement(1);
    expect(el).toBeDefined();
    expect(el!.getAttribute("data-id")).toBe("1");
    expect(el!.getAttribute("data-index")).toBe("1");

    container.remove();
  });

  it("should return undefined for non-rendered index", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);

    expect(renderer.getElement(10)).toBeUndefined();

    container.remove();
  });
});

// =============================================================================
// updateItem
// =============================================================================

describe("updateItem", () => {
  it("should update cell content when item changes", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const updatedItem: TestItem = { id: 999, name: "Updated", email: "updated@test.com", role: "superadmin" };
    renderer.updateItem(0, updatedItem, false, false);

    const cells = container.querySelectorAll(".vlist-table-cell");
    expect(cells[0]!.textContent).toBe("Updated");
    expect(cells[1]!.textContent).toBe("updated@test.com");
    expect(cells[2]!.textContent).toBe("superadmin");

    container.remove();
  });

  it("should update selection state on existing item", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    // Update to selected
    renderer.updateItem(0, items[0]!, true, false);

    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.classList.contains("vlist-item--selected")).toBe(true);
    expect(row.getAttribute("aria-selected")).toBe("true");

    container.remove();
  });

  it("should be a no-op for non-rendered indices", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    // Should not throw
    const updatedItem: TestItem = { id: 50, name: "Ghost", email: "ghost@test.com", role: "none" };
    renderer.updateItem(50, updatedItem, false, false);

    container.remove();
  });
});

// =============================================================================
// updateItemClasses
// =============================================================================

describe("updateItemClasses", () => {
  it("should update selected class without re-rendering content", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell")!;
    const originalContent = cell.textContent;

    renderer.updateItemClasses(0, true, false);

    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.classList.contains("vlist-item--selected")).toBe(true);
    // Content should be unchanged
    expect(cell.textContent).toBe(originalContent);

    container.remove();
  });

  it("should update focused class", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    renderer.updateItemClasses(0, false, true);

    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.classList.contains("vlist-item--focused")).toBe(true);

    container.remove();
  });

  it("should be a no-op for non-rendered indices", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    // Should not throw
    renderer.updateItemClasses(50, true, true);

    container.remove();
  });
});

// =============================================================================
// updateColumnLayout
// =============================================================================

describe("updateColumnLayout", () => {
  it("should update cell positions after column resize", () => {
    const { renderer, container, layout } = createTestRenderer();
    const items = makeItems(2);

    renderer.render(items, { start: 0, end: 1 }, EMPTY_SET, -1);

    // Resize the first column
    layout.resizeColumn(0, 300);

    renderer.updateColumnLayout(layout);

    // Check that cells updated
    const rows = container.querySelectorAll(".vlist-table-row");
    for (const row of rows) {
      const cells = row.querySelectorAll(".vlist-table-cell");
      const cols = layout.columns;

      for (let i = 0; i < cols.length; i++) {
        const cell = cells[i] as HTMLElement;
        expect(cell.style.left).toBe(`${cols[i]!.offset}px`);
        expect(cell.style.width).toBe(`${cols[i]!.width}px`);
      }
    }

    container.remove();
  });

  it("should update row width after column resize", () => {
    const { renderer, container, layout } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const originalWidth = layout.totalWidth;
    layout.resizeColumn(0, 400);

    renderer.updateColumnLayout(layout);

    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.style.width).toBe(`${layout.totalWidth}px`);
    expect(layout.totalWidth).not.toBe(originalWidth);

    container.remove();
  });
});

// =============================================================================
// clear and destroy
// =============================================================================

describe("clear", () => {
  it("should remove all rendered rows from the DOM", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(5);

    renderer.render(items, { start: 0, end: 4 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(5);

    renderer.clear();
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(0);

    container.remove();
  });

  it("should return undefined for getElement after clear", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);
    expect(renderer.getElement(0)).toBeDefined();

    renderer.clear();
    expect(renderer.getElement(0)).toBeUndefined();

    container.remove();
  });
});

describe("destroy", () => {
  it("should remove all rows and clean up", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(3);

    renderer.render(items, { start: 0, end: 2 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(3);

    renderer.destroy();
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(0);

    container.remove();
  });
});

// =============================================================================
// Cell Alignment
// =============================================================================

describe("cell alignment", () => {
  it("should apply left alignment by default", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    expect(cell.style.textAlign).toBe("left");

    container.remove();
  });

  it("should apply center alignment", () => {
    const columns: TableColumn<TestItem>[] = [
      col("name", { width: 200, align: "center" }),
    ];

    const { renderer, container } = createTestRenderer({ columns });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    expect(cell.style.textAlign).toBe("center");

    container.remove();
  });

  it("should apply right alignment", () => {
    const columns: TableColumn<TestItem>[] = [
      col("name", { width: 200, align: "right" }),
    ];

    const { renderer, container } = createTestRenderer({ columns });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    expect(cell.style.textAlign).toBe("right");

    container.remove();
  });
});

// =============================================================================
// Offset-based Rendering (non-zero start)
// =============================================================================

describe("offset-based rendering", () => {
  it("should render items starting from a non-zero offset", () => {
    const { renderer, container } = createTestRenderer({ rowHeight: 40 });
    const items = makeItems(20);

    // Render range 10-14 (simulating scrolled down)
    renderer.render(items.slice(10, 15), { start: 10, end: 14 }, EMPTY_SET, -1);

    const rows = container.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBe(5);

    // First row should be at index 10, offset = 10 * 40 = 400
    expect((rows[0] as HTMLElement).getAttribute("data-index")).toBe("10");
    expect((rows[0] as HTMLElement).style.transform).toBe("translateY(400px)");

    container.remove();
  });

  it("should correctly identify items by index for getElement", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(20);

    renderer.render(items.slice(10, 15), { start: 10, end: 14 }, EMPTY_SET, -1);

    expect(renderer.getElement(10)).toBeDefined();
    expect(renderer.getElement(14)).toBeDefined();
    expect(renderer.getElement(0)).toBeUndefined();
    expect(renderer.getElement(15)).toBeUndefined();

    container.remove();
  });
});

// =============================================================================
// Null / empty cell values
// =============================================================================

describe("null and undefined cell values", () => {
  it("should render empty string for null values", () => {
    const columns: TableColumn<TestItem>[] = [
      col("missing" as any, { width: 200 }),
    ];

    const { renderer, container } = createTestRenderer({ columns, totalItems: 1 });
    const items: TestItem[] = [{ id: 0, name: "Test", email: "t@t.com", role: "user" }];

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    expect(cell.textContent).toBe("");

    container.remove();
  });
});

// =============================================================================
// Multiple render cycles
// =============================================================================

describe("incremental rendering", () => {
  it("should handle scrolling through multiple ranges", () => {
    const { renderer, container } = createTestRenderer({ rowHeight: 40 });
    const items = makeItems(100);

    // Simulate scrolling: render successive ranges
    renderer.render(items.slice(0, 10), { start: 0, end: 9 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBeGreaterThanOrEqual(10);

    renderer.render(items.slice(5, 15), { start: 5, end: 14 }, EMPTY_SET, -1);
    // At least the current range should be present
    for (let i = 5; i <= 14; i++) {
      expect(renderer.getElement(i)).toBeDefined();
    }

    renderer.render(items.slice(10, 20), { start: 10, end: 19 }, EMPTY_SET, -1);
    for (let i = 10; i <= 19; i++) {
      expect(renderer.getElement(i)).toBeDefined();
    }

    container.remove();
  });

  it("should reuse existing rows when scrolling overlapping ranges", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(20);

    // First render: 0-9
    renderer.render(items.slice(0, 10), { start: 0, end: 9 }, EMPTY_SET, -1);
    const el5 = renderer.getElement(5);

    // Second render: 3-12 (overlap at 3-9)
    renderer.render(items.slice(3, 13), { start: 3, end: 12 }, EMPTY_SET, -1);
    const el5After = renderer.getElement(5);

    // Same element should be reused for index 5
    expect(el5After).toBe(el5);

    container.remove();
  });

  it("should handle empty range gracefully", () => {
    const { renderer, container } = createTestRenderer();

    // Render with empty items
    renderer.render([], { start: 0, end: -1 }, EMPTY_SET, -1);
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(0);

    container.remove();
  });
});