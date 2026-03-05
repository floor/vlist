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
    () => sizeCache as any,
    layout,
    columns,
    "vlist",
    "vlist",
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

    // Row borders are now applied via CSS class on the root element
    // (.vlist--table-row-borders .vlist-table-row), not inline styles.
    // The renderer no longer sets border styles — verify no inline border.
    const row = container.querySelector(".vlist-table-row") as HTMLElement;
    expect(row.style.borderBottom).toBe("");

    container.remove();
  });

  it("should not apply column borders inline (handled via CSS class on root)", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    // Column borders are now applied via CSS class on the root element
    // (.vlist--table-col-borders .vlist-table-cell), not inline styles.
    const cells = container.querySelectorAll(".vlist-table-cell");
    for (const cell of cells) {
      expect((cell as HTMLElement).style.borderRight).toBe("");
    }

    container.remove();
  });

  it("should not set inline border styles on cells", () => {
    const { renderer, container } = createTestRenderer();
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
  it("should apply left alignment by default (no alignment class)", () => {
    const { renderer, container } = createTestRenderer();
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    // Left alignment is the default — no modifier class needed
    expect(cell.classList.contains("vlist-table-cell--center")).toBe(false);
    expect(cell.classList.contains("vlist-table-cell--right")).toBe(false);

    container.remove();
  });

  it("should apply center alignment via CSS class", () => {
    const columns: TableColumn<TestItem>[] = [
      col("name", { width: 200, align: "center" }),
    ];

    const { renderer, container } = createTestRenderer({ columns });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    expect(cell.classList.contains("vlist-table-cell--center")).toBe(true);
    expect(cell.classList.contains("vlist-table-cell--right")).toBe(false);

    container.remove();
  });

  it("should apply right alignment via CSS class", () => {
    const columns: TableColumn<TestItem>[] = [
      col("name", { width: 200, align: "right" }),
    ];

    const { renderer, container } = createTestRenderer({ columns });
    const items = makeItems(1);

    renderer.render(items, { start: 0, end: 0 }, EMPTY_SET, -1);

    const cell = container.querySelector(".vlist-table-cell") as HTMLElement;
    expect(cell.classList.contains("vlist-table-cell--right")).toBe(true);
    expect(cell.classList.contains("vlist-table-cell--center")).toBe(false);

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

// =============================================================================
// Group Header Tests
// =============================================================================

/**
 * Helper: create a renderer with group headers enabled.
 *
 * Simulates what happens when withGroups is active:
 * - A grouped size function (headers = 32px, rows = 40px)
 * - A size cache built for layout items (data + headers interleaved)
 * - setGroupHeaderFn configured on the renderer
 *
 * Layout for 6 data items in 2 groups of 3:
 *   [header-A, item0, item1, item2, header-B, item3, item4, item5]
 *   index: 0       1     2     3       4        5     6     7
 */

interface GroupTestItem extends VListItem {
  id: string | number;
  name: string;
  email: string;
  role: string;
  __groupHeader?: true;
  groupKey?: string;
  groupIndex?: number;
}

const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 40;

function makeGroupHeader(groupIndex: number, key: string): GroupTestItem {
  return {
    id: `__group_header_${groupIndex}`,
    name: "",
    email: "",
    role: "",
    __groupHeader: true,
    groupKey: key,
    groupIndex,
  };
}

function makeGroupedItems(): GroupTestItem[] {
  // Layout: [headerA, item0, item1, item2, headerB, item3, item4, item5]
  return [
    makeGroupHeader(0, "Admins"),
    { id: 0, name: "Alice", email: "alice@test.com", role: "admin" },
    { id: 1, name: "Bob", email: "bob@test.com", role: "admin" },
    { id: 2, name: "Carol", email: "carol@test.com", role: "admin" },
    makeGroupHeader(1, "Users"),
    { id: 3, name: "Dave", email: "dave@test.com", role: "user" },
    { id: 4, name: "Eve", email: "eve@test.com", role: "user" },
    { id: 5, name: "Frank", email: "frank@test.com", role: "user" },
  ];
}

function createGroupedRenderer() {
  const columns: TableColumn<GroupTestItem>[] = [
    { key: "name", label: "Name", width: 200 },
    { key: "email", label: "Email", width: 300 },
    { key: "role", label: "Role", width: 100 },
  ];

  const totalItems = 8; // 6 data + 2 headers
  const container = document.createElement("div");
  document.body.appendChild(container);

  // Grouped size function: headers get HEADER_HEIGHT, data rows get ROW_HEIGHT
  const groupedSizeFn = (index: number): number => {
    return (index === 0 || index === 4) ? HEADER_HEIGHT : ROW_HEIGHT;
  };

  const sizeCache = createSizeCache(groupedSizeFn, totalItems);

  const layout = createTableLayout<GroupTestItem>(columns, 50, Infinity, true);
  layout.resolve(800);

  const renderer = createTableRenderer<GroupTestItem>(
    container,
    () => sizeCache,
    layout,
    columns,
    "vlist",
    "vlist",
    () => totalItems,
  );

  // Configure group header detection + template
  renderer.setGroupHeaderFn(
    (item) => !!(item as any).__groupHeader,
    (key, _groupIndex) => `<span class="group-label">${key}</span>`,
  );

  return { container, sizeCache, layout, renderer, columns };
}

describe("group headers", () => {
  describe("setGroupHeaderFn", () => {
    it("should accept a header check function and template", () => {
      const { renderer, container } = createTestRenderer();

      // Should not throw
      renderer.setGroupHeaderFn(
        () => false,
        (key) => `<span>${key}</span>`,
      );

      // Should also accept null to clear
      renderer.setGroupHeaderFn(null, null);

      container.remove();
    });
  });

  describe("rendering group header rows", () => {
    it("should render group headers as full-width rows without cells", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // Index 0 = header A
      const headerEl = renderer.getElement(0);
      expect(headerEl).toBeDefined();
      expect(headerEl!.classList.contains("vlist-table-group-header")).toBe(true);

      // No cells inside the header row
      expect(headerEl!.querySelectorAll(".vlist-table-cell").length).toBe(0);

      // Has a single content container
      expect(headerEl!.querySelectorAll(".vlist-table-group-header-content").length).toBe(1);

      container.remove();
    });

    it("should render the header template content", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const headerEl = renderer.getElement(0)!;
      const content = headerEl.querySelector(".vlist-table-group-header-content")!;
      expect(content.innerHTML).toContain("Admins");

      const headerEl2 = renderer.getElement(4)!;
      const content2 = headerEl2.querySelector(".vlist-table-group-header-content")!;
      expect(content2.innerHTML).toContain("Users");

      container.remove();
    });

    it("should use headerHeight for group header rows", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const headerEl = renderer.getElement(0)!;
      expect(headerEl.style.height).toBe(`${HEADER_HEIGHT}px`);

      // Data row should use ROW_HEIGHT
      const dataEl = renderer.getElement(1)!;
      expect(dataEl.style.height).toBe(`${ROW_HEIGHT}px`);

      container.remove();
    });

    it("should set role=presentation on group headers", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const headerEl = renderer.getElement(0)!;
      expect(headerEl.getAttribute("role")).toBe("presentation");

      // Data rows should have role=row
      const dataEl = renderer.getElement(1)!;
      expect(dataEl.getAttribute("role")).toBe("row");

      container.remove();
    });

    it("should not set aria-selected on group headers", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();
      const selected = new Set<string | number>(["__group_header_0"]);

      renderer.render(items, { start: 0, end: 7 }, selected, -1);

      const headerEl = renderer.getElement(0)!;
      expect(headerEl.hasAttribute("aria-selected")).toBe(false);

      container.remove();
    });
  });

  describe("mixed data rows and group headers", () => {
    it("should render both data rows and group headers in the same range", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // 2 headers + 6 data rows = 8 total elements
      let headerCount = 0;
      let dataCount = 0;
      for (let i = 0; i <= 7; i++) {
        const el = renderer.getElement(i);
        expect(el).toBeDefined();
        if (el!.classList.contains("vlist-table-group-header")) {
          headerCount++;
        } else if (el!.classList.contains("vlist-table-row")) {
          dataCount++;
        }
      }
      expect(headerCount).toBe(2);
      expect(dataCount).toBe(6);

      container.remove();
    });

    it("should render data row cells correctly alongside group headers", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // Index 1 = first data row (Alice)
      const dataEl = renderer.getElement(1)!;
      const cells = dataEl.querySelectorAll(".vlist-table-cell");
      expect(cells.length).toBe(3); // name, email, role

      container.remove();
    });

    it("should position rows correctly with mixed heights", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // Index 0: header A at offset 0
      const h0 = renderer.getElement(0)!;
      expect(h0.style.transform).toBe("translateY(0px)");

      // Index 1: first data row at offset HEADER_HEIGHT (32)
      const d1 = renderer.getElement(1)!;
      expect(d1.style.transform).toBe(`translateY(${HEADER_HEIGHT}px)`);

      // Index 4: header B at offset 32 + 3*40 = 152
      const h4 = renderer.getElement(4)!;
      const expectedOffset = HEADER_HEIGHT + 3 * ROW_HEIGHT;
      expect(h4.style.transform).toBe(`translateY(${expectedOffset}px)`);

      container.remove();
    });
  });

  describe("type transitions", () => {
    it("should replace a data row with a group header when type changes at same index", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      // First render: index 0 is a group header
      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);
      const originalEl = renderer.getElement(0)!;
      expect(originalEl.classList.contains("vlist-table-group-header")).toBe(true);

      // Create new items where index 0 is a data row (no groups)
      const noGroupItems: GroupTestItem[] = [
        { id: 100, name: "Zack", email: "z@test.com", role: "admin" },
        ...items.slice(1),
      ];

      // Temporarily disable group headers
      renderer.setGroupHeaderFn(null, null);
      renderer.render(noGroupItems, { start: 0, end: 7 }, EMPTY_SET, -1);

      const newEl = renderer.getElement(0)!;
      // Should now be a data row, not a header
      expect(newEl.classList.contains("vlist-table-group-header")).toBe(false);
      expect(newEl.classList.contains("vlist-table-row")).toBe(true);

      container.remove();
    });

    it("should replace a group header with a data row when setGroupHeaderFn is cleared", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 3 }, EMPTY_SET, -1);
      expect(renderer.getElement(0)!.classList.contains("vlist-table-group-header")).toBe(true);

      // Clear group headers and re-render
      renderer.setGroupHeaderFn(null, null);
      renderer.render(items, { start: 0, end: 3 }, EMPTY_SET, -1);

      // Index 0 should now be a regular row (group header item rendered as data row)
      expect(renderer.getElement(0)!.classList.contains("vlist-table-group-header")).toBe(false);

      container.remove();
    });
  });

  describe("updateItem with group headers", () => {
    it("should be a no-op for group header rows", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const headerEl = renderer.getElement(0)!;
      const htmlBefore = headerEl.innerHTML;

      // updateItem should skip group headers gracefully
      renderer.updateItem(0, items[0]!, true, false);

      // Content should be unchanged — no selection class applied
      expect(headerEl.innerHTML).toBe(htmlBefore);
      expect(headerEl.classList.contains("vlist-item--selected")).toBe(false);

      container.remove();
    });

    it("should still work for data rows when groups are active", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // Update a data row (index 1 = Alice)
      renderer.updateItem(1, items[1]!, true, false);

      const dataEl = renderer.getElement(1)!;
      expect(dataEl.classList.contains("vlist-item--selected")).toBe(true);

      container.remove();
    });
  });

  describe("updateItemClasses with group headers", () => {
    it("should be a no-op for group header rows", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const headerEl = renderer.getElement(0)!;
      const classBefore = headerEl.className;

      renderer.updateItemClasses(0, true, true);

      // Classes should be unchanged — no selected/focused applied
      expect(headerEl.className).toBe(classBefore);

      container.remove();
    });

    it("should still work for data rows when groups are active", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      renderer.updateItemClasses(1, false, true);

      const dataEl = renderer.getElement(1)!;
      expect(dataEl.classList.contains("vlist-item--focused")).toBe(true);

      container.remove();
    });
  });

  describe("updateColumnLayout with group headers", () => {
    it("should update row width for both data rows and group headers", () => {
      const { renderer, container, layout } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // Resize a column
      layout.resizeColumn(0, 300); // name: 200 → 300

      renderer.updateColumnLayout(layout);

      const headerEl = renderer.getElement(0)!;
      const dataEl = renderer.getElement(1)!;

      // Both should have the new total width
      expect(headerEl.style.width).toBe(dataEl.style.width);
      expect(headerEl.style.width).toBe(`${layout.totalWidth}px`);

      container.remove();
    });

    it("should update cell positions on data rows but not create cells on headers", () => {
      const { renderer, container, layout } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      layout.resizeColumn(0, 300);
      renderer.updateColumnLayout(layout);

      // Header should still have no cells
      const headerEl = renderer.getElement(0)!;
      expect(headerEl.querySelectorAll(".vlist-table-cell").length).toBe(0);

      // Data row cells should have updated positions
      const dataEl = renderer.getElement(1)!;
      const cells = dataEl.querySelectorAll(".vlist-table-cell");
      expect(cells.length).toBe(3);

      container.remove();
    });
  });

  describe("sizeCache getter pattern", () => {
    it("should use updated sizeCache when reference changes", () => {
      const columns: TableColumn<GroupTestItem>[] = [
        { key: "name", label: "Name", width: 200 },
        { key: "email", label: "Email", width: 300 },
        { key: "role", label: "Role", width: 100 },
      ];

      const container = document.createElement("div");
      document.body.appendChild(container);

      // Start with a flat sizeCache (all rows = 40px)
      let sizeCache = createSizeCache(40, 8);

      const layout = createTableLayout<GroupTestItem>(columns, 50, Infinity, true);
      layout.resolve(800);

      const renderer = createTableRenderer<GroupTestItem>(
        container,
        () => sizeCache, // Getter — always returns current ref
        layout,
        columns,
        "vlist",
        "vlist",
        () => 8,
      );

      const items = makeGroupedItems();

      // Render with flat sizes (no groups yet)
      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const elBefore = renderer.getElement(0)!;
      expect(elBefore.style.height).toBe("40px"); // Flat height

      // Now swap to a grouped sizeCache (headers = 32px)
      const groupedSizeFn = (index: number): number => {
        return (index === 0 || index === 4) ? HEADER_HEIGHT : ROW_HEIGHT;
      };
      sizeCache = createSizeCache(groupedSizeFn, 8);

      // Enable group headers
      renderer.setGroupHeaderFn(
        (item) => !!(item as any).__groupHeader,
        (key) => `<span>${key}</span>`,
      );

      // Clear and re-render with new sizeCache
      renderer.clear();
      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      const elAfter = renderer.getElement(0)!;
      expect(elAfter.style.height).toBe(`${HEADER_HEIGHT}px`); // Grouped height

      container.remove();
    });
  });

  describe("group header change tracking", () => {
    it("should skip re-rendering when same group header is at same index", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);
      const headerEl = renderer.getElement(0)!;
      const contentHtml = headerEl.querySelector(".vlist-table-group-header-content")!.innerHTML;

      // Re-render same items — header should be reused
      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);
      const headerEl2 = renderer.getElement(0)!;

      // Same DOM element
      expect(headerEl2).toBe(headerEl);
      // Content unchanged
      expect(headerEl2.querySelector(".vlist-table-group-header-content")!.innerHTML).toBe(contentHtml);

      container.remove();
    });

    it("should re-render content when group header ID changes at same index", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      // Replace the header at index 0 with a different group (different groupIndex → different ID).
      // In real usage, changing groups rebuilds the entire layout with new IDs.
      const newItems = [...items];
      newItems[0] = makeGroupHeader(99, "Managers");

      renderer.render(newItems, { start: 0, end: 7 }, EMPTY_SET, -1);

      const headerEl = renderer.getElement(0)!;
      const content = headerEl.querySelector(".vlist-table-group-header-content")!;
      expect(content.innerHTML).toContain("Managers");

      container.remove();
    });
  });

  describe("clear and destroy with group headers", () => {
    it("should clear all rows including group headers", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);
      expect(container.children.length).toBe(8);

      renderer.clear();

      // All elements should be removed
      expect(container.children.length).toBe(0);
      expect(renderer.getElement(0)).toBeUndefined();
      expect(renderer.getElement(1)).toBeUndefined();

      container.remove();
    });

    it("should be able to re-render after clear", () => {
      const { renderer, container } = createGroupedRenderer();
      const items = makeGroupedItems();

      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);
      renderer.clear();
      renderer.render(items, { start: 0, end: 7 }, EMPTY_SET, -1);

      expect(renderer.getElement(0)).toBeDefined();
      expect(renderer.getElement(0)!.classList.contains("vlist-table-group-header")).toBe(true);
      expect(renderer.getElement(1)).toBeDefined();
      expect(renderer.getElement(1)!.classList.contains("vlist-table-row")).toBe(true);

      container.remove();
    });
  });
});