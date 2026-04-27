/**
 * vlist - Table Header Tests
 *
 * Tests for createTableHeader: DOM setup, cell creation, sort indicators,
 * resize interaction, scroll sync, visibility, and destroy.
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { JSDOM } from "jsdom";

import { createTableHeader } from "../../../src/features/table/header";
import { createTableLayout } from "../../../src/features/table/layout";
import type { TableColumn, TableLayout } from "../../../src/features/table/types";
import type { VListItem } from "../../../src/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let jsdom: JSDOM;
let originalDocument: any;
let originalWindow: any;

beforeAll(() => {
  jsdom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;

  global.document = jsdom.window.document;
  global.window = jsdom.window as any;
  global.HTMLElement = jsdom.window.HTMLElement;
  global.MouseEvent = jsdom.window.MouseEvent;
  global.PointerEvent = (jsdom.window as any).PointerEvent ?? jsdom.window.MouseEvent;
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
  value: number;
}

const col = (key: string, opts: Partial<TableColumn<TestItem>> = {}): TableColumn<TestItem> => ({
  key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
  ...opts,
});

function createTestDOM() {
  const root = document.createElement("div");
  root.className = "vlist";
  const viewport = document.createElement("div");
  viewport.className = "vlist__viewport";
  root.appendChild(viewport);
  document.body.appendChild(root);
  return { root, viewport };
}

function createResolvedLayout(columns: TableColumn<TestItem>[], containerWidth = 600): TableLayout<TestItem> {
  const layout = createTableLayout<TestItem>(columns);
  layout.resolve(containerWidth);
  return layout;
}

// =============================================================================
// DOM Setup
// =============================================================================

describe("createTableHeader - DOM setup", () => {
  it("should insert header rowgroup before viewport", () => {
    const { root, viewport } = createTestDOM();
    createTableHeader(root, viewport, 40, "vlist", mock());

    const rowgroup = root.firstChild as HTMLElement;
    expect(rowgroup.getAttribute("role")).toBe("rowgroup");
    expect(rowgroup.nextSibling).toBe(viewport);
  });

  it("should create header row element with correct ARIA", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader(root, viewport, 40, "vlist", mock());

    expect(header.element.getAttribute("role")).toBe("row");
    expect(header.element.getAttribute("aria-rowindex")).toBe("1");
    expect(header.element.className).toBe("vlist-table-header");
  });

  it("should set header height from config", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader(root, viewport, 36, "vlist", mock());
    expect(header.element.style.height).toBe("36px");
  });

  it("should create scroll container inside header", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader(root, viewport, 40, "vlist", mock());
    const scrollContainer = header.element.firstChild as HTMLElement;
    expect(scrollContainer.className).toBe("vlist-table-header-scroll");
    expect(scrollContainer.getAttribute("role")).toBe("presentation");
  });

  it("should set header height CSS variable on root for scrollbar offset", () => {
    const { root, viewport } = createTestDOM();
    createTableHeader(root, viewport, 48, "vlist", mock());

    // Layout is now handled by CSS flex — no inline styles on viewport.
    // The CSS variable on root allows the custom scrollbar to offset its track.
    expect(root.style.getPropertyValue('--vlist-table-header-height')).toBe("48px");
    expect(viewport.style.position).toBe("");
  });

  it("should use custom class prefix", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader(root, viewport, 40, "mytable", mock());
    expect(header.element.className).toBe("mytable-table-header");
  });
});

// =============================================================================
// Cell Creation & Rebuild
// =============================================================================

describe("createTableHeader - rebuild", () => {
  it("should create cells for each column", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name"), col("value")]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect(scrollContainer.children.length).toBe(2);
  });

  it("should set columnheader role and aria-colindex on cells", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name"), col("value")]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const firstCell = scrollContainer.children[0] as HTMLElement;
    const secondCell = scrollContainer.children[1] as HTMLElement;

    expect(firstCell.getAttribute("role")).toBe("columnheader");
    expect(firstCell.getAttribute("aria-colindex")).toBe("1");
    expect(secondCell.getAttribute("aria-colindex")).toBe("2");
  });

  it("should set data-column-key on cells", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name"), col("value")]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const firstCell = scrollContainer.children[0] as HTMLElement;
    expect(firstCell.dataset.columnKey).toBe("name");
  });

  it("should render string labels as text content", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name", { label: "Full Name" })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    const content = cell.querySelector(".vlist-table-header-content") as HTMLElement;
    expect(content.textContent).toBe("Full Name");
  });

  it("should render DOM element labels by appending", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const labelEl = document.createElement("strong");
    labelEl.textContent = "Bold";

    const layout = createResolvedLayout([col("name", { label: labelEl as any })]);
    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    const content = cell.querySelector(".vlist-table-header-content") as HTMLElement;
    expect(content.querySelector("strong")).toBeTruthy();
    expect(content.textContent).toBe("Bold");
  });

  it("should use custom header template when provided", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    const layout = createResolvedLayout([
      col("name", { header: (c) => `Custom: ${c.label}` }),
    ]);
    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const content = scrollContainer.querySelector(".vlist-table-header-content") as HTMLElement;
    expect(content.textContent).toBe("Custom: Name");
  });

  it("should use custom header template returning DOM element", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    const layout = createResolvedLayout([
      col("name", {
        header: () => {
          const el = document.createElement("em");
          el.textContent = "Italic";
          return el;
        },
      }),
    ]);
    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const content = scrollContainer.querySelector(".vlist-table-header-content") as HTMLElement;
    expect(content.querySelector("em")!.textContent).toBe("Italic");
  });

  it("should add alignment modifier class for center", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("value", { align: "center" })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    expect(cell.classList.contains("vlist-table-header-cell--center")).toBe(true);
  });

  it("should add alignment modifier class for right", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("value", { align: "right" })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    expect(cell.classList.contains("vlist-table-header-cell--right")).toBe(true);
  });

  it("should not add alignment class for left (default)", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name", { align: "left" })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    expect(cell.classList.contains("vlist-table-header-cell--center")).toBe(false);
    expect(cell.classList.contains("vlist-table-header-cell--right")).toBe(false);
  });

  it("should add sortable class and sort indicator for sortable columns", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name", { sortable: true })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    expect(cell.classList.contains("vlist-table-header-cell--sortable")).toBe(true);

    const sortIndicator = cell.querySelector(".vlist-table-header-sort") as HTMLElement;
    expect(sortIndicator).toBeTruthy();
    expect(sortIndicator.getAttribute("aria-hidden")).toBe("true");
  });

  it("should not add sort indicator for non-sortable columns", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name")]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    expect(cell.querySelector(".vlist-table-header-sort")).toBeNull();
  });

  it("should add resize handles for resizable columns", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([
      col("name", { width: 200, resizable: true }),
      col("value", { width: 200, resizable: false }),
    ]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell0 = scrollContainer.children[0] as HTMLElement;
    const cell1 = scrollContainer.children[1] as HTMLElement;

    expect(cell0.querySelector(".vlist-table-header-resize")).toBeTruthy();
    // Second column is not resizable by default in the layout unless global resizable is set
    // The layout resolves resizable based on column def + global config
  });

  it("should clear existing cells on rebuild", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    const layout1 = createResolvedLayout([col("a"), col("b"), col("c")]);
    header.rebuild(layout1);

    const layout2 = createResolvedLayout([col("x"), col("y")]);
    header.rebuild(layout2);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect(scrollContainer.children.length).toBe(2);
  });

  it("should restore sort indicator after rebuild", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    const layout = createResolvedLayout([
      col("name", { sortable: true }),
      col("value", { sortable: true }),
    ]);

    header.rebuild(layout);
    header.updateSort("name", "asc");

    // Rebuild again — sort should be restored
    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell0 = scrollContainer.children[0] as HTMLElement;
    const sortIndicator = cell0.querySelector(".vlist-table-header-sort") as HTMLElement;
    expect(sortIndicator.textContent).toBe("\u25B2"); // ▲
  });
});

// =============================================================================
// Update (widths)
// =============================================================================

describe("createTableHeader - update", () => {
  it("should set scroll container width to layout totalWidth", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([
      col("name", { width: 200 }),
      col("value", { width: 300 }),
    ]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect(scrollContainer.style.width).toBe(`${layout.totalWidth}px`);
  });

  it("should set individual cell widths", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([
      col("name", { width: 200 }),
      col("value", { width: 300 }),
    ]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect((scrollContainer.children[0] as HTMLElement).style.width).toBe("200px");
    expect((scrollContainer.children[1] as HTMLElement).style.width).toBe("300px");
  });

  it("should update widths when called with new layout", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const columns = [
      col("name", { width: 200 }),
      col("value", { width: 300 }),
    ];
    const layout = createResolvedLayout(columns);

    header.rebuild(layout);

    // Resize column
    layout.resizeColumn(0, 250);
    header.update(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect((scrollContainer.children[0] as HTMLElement).style.width).toBe("250px");
  });
});

// =============================================================================
// Sort Indicators
// =============================================================================

describe("createTableHeader - sort", () => {
  it("should show ascending indicator", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([
      col("name", { sortable: true }),
      col("value", { sortable: true }),
    ]);

    header.rebuild(layout);
    header.updateSort("name", "asc");

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    const indicator = cell.querySelector(".vlist-table-header-sort") as HTMLElement;

    expect(indicator.textContent).toBe("\u25B2");
    expect(indicator.style.opacity).toBe("0.7");
    expect(cell.getAttribute("aria-sort")).toBe("ascending");
  });

  it("should show descending indicator", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name", { sortable: true })]);

    header.rebuild(layout);
    header.updateSort("name", "desc");

    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    const indicator = cell.querySelector(".vlist-table-header-sort") as HTMLElement;

    expect(indicator.textContent).toBe("\u25BC");
    expect(cell.getAttribute("aria-sort")).toBe("descending");
  });

  it("should clear indicator when sorting different column", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([
      col("name", { sortable: true }),
      col("value", { sortable: true }),
    ]);

    header.rebuild(layout);
    header.updateSort("name", "asc");
    header.updateSort("value", "desc");

    const scrollContainer = header.element.firstChild as HTMLElement;
    const nameCell = scrollContainer.children[0] as HTMLElement;
    const valueCell = scrollContainer.children[1] as HTMLElement;

    const nameIndicator = nameCell.querySelector(".vlist-table-header-sort") as HTMLElement;
    const valueIndicator = valueCell.querySelector(".vlist-table-header-sort") as HTMLElement;

    expect(nameIndicator.textContent).toBe("");
    expect(nameIndicator.style.opacity).toBe("0");
    expect(nameCell.getAttribute("aria-sort")).toBeNull();

    expect(valueIndicator.textContent).toBe("\u25BC");
    expect(valueIndicator.style.opacity).toBe("0.7");
  });

  it("should clear all indicators when key is null", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([col("name", { sortable: true })]);

    header.rebuild(layout);
    header.updateSort("name", "asc");
    header.updateSort(null, "asc");

    const scrollContainer = header.element.firstChild as HTMLElement;
    const indicator = (scrollContainer.children[0] as HTMLElement).querySelector(
      ".vlist-table-header-sort",
    ) as HTMLElement;

    expect(indicator.textContent).toBe("");
    expect(indicator.style.opacity).toBe("0");
  });

  it("should handle updateSort before rebuild (no layout)", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    // Should not throw
    expect(() => header.updateSort("name", "asc")).not.toThrow();
  });
});

// =============================================================================
// Scroll Sync
// =============================================================================

describe("createTableHeader - syncScroll", () => {
  it("should translate scroll container by negative scrollLeft", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock()) as any;

    header.syncScroll(150);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect(scrollContainer.style.transform).toBe("translateX(-150px)");
  });

  it("should handle zero scroll", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock()) as any;

    header.syncScroll(0);

    const scrollContainer = header.element.firstChild as HTMLElement;
    expect(scrollContainer.style.transform).toBe("translateX(0px)");
  });
});

// =============================================================================
// Click Interaction (Sort)
// =============================================================================

describe("createTableHeader - click interaction", () => {
  it("should call onSort when clicking a sortable header cell", () => {
    const { root, viewport } = createTestDOM();
    const onSort = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock(), onSort);
    const layout = createResolvedLayout([col("name", { sortable: true })]);

    header.rebuild(layout);

    // Click the content element inside the cell
    const scrollContainer = header.element.firstChild as HTMLElement;
    const cell = scrollContainer.children[0] as HTMLElement;
    const content = cell.querySelector(".vlist-table-header-content") as HTMLElement;

    const event = new MouseEvent("click", { bubbles: true });
    content.dispatchEvent(event);

    expect(onSort).toHaveBeenCalledWith({
      key: "name",
      index: 0,
      direction: "asc",
    });
  });

  it("should call onClick when clicking any header cell", () => {
    const { root, viewport } = createTestDOM();
    const onClick = mock(() => {});
    const header = createTableHeader<TestItem>(
      root, viewport, 40, "vlist", mock(), undefined, onClick,
    );
    const layout = createResolvedLayout([col("name")]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const content = (scrollContainer.children[0] as HTMLElement).querySelector(
      ".vlist-table-header-content",
    ) as HTMLElement;

    const event = new MouseEvent("click", { bubbles: true });
    content.dispatchEvent(event);

    expect(onClick).toHaveBeenCalled();
    const call = (onClick as any).mock.calls[0][0];
    expect(call.key).toBe("name");
    expect(call.index).toBe(0);
  });

  it("should cycle sort: asc → desc → null", () => {
    const { root, viewport } = createTestDOM();
    const sortCalls: any[] = [];
    const onSort = mock((e: any) => sortCalls.push(e));
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock(), onSort);
    const layout = createResolvedLayout([col("name", { sortable: true })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const content = (scrollContainer.children[0] as HTMLElement).querySelector(
      ".vlist-table-header-content",
    ) as HTMLElement;

    // First click: asc (no current sort key)
    content.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sortCalls[0].direction).toBe("asc");

    // Update internal sort state
    header.updateSort("name", "asc");

    // Second click: desc
    content.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sortCalls[1].direction).toBe("desc");

    // Update internal sort state
    header.updateSort("name", "desc");

    // Third click: null (clear)
    content.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sortCalls[2].direction).toBeNull();
  });

  it("should not emit sort for non-sortable columns", () => {
    const { root, viewport } = createTestDOM();
    const onSort = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock(), onSort);
    const layout = createResolvedLayout([col("name", { sortable: false })]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const content = (scrollContainer.children[0] as HTMLElement).querySelector(
      ".vlist-table-header-content",
    ) as HTMLElement;
    content.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSort).not.toHaveBeenCalled();
  });

  it("should ignore clicks on resize handles", () => {
    const { root, viewport } = createTestDOM();
    const onSort = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock(), onSort);
    const layout = createResolvedLayout([
      col("name", { width: 200, sortable: true, resizable: true }),
    ]);

    header.rebuild(layout);

    const scrollContainer = header.element.firstChild as HTMLElement;
    const handle = scrollContainer.querySelector(".vlist-table-header-resize") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSort).not.toHaveBeenCalled();
  });

  it("should handle click when no layout is set", () => {
    const { root, viewport } = createTestDOM();
    const onSort = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock(), onSort);

    // Click with no cells — should not throw
    const event = new MouseEvent("click", { bubbles: true });
    expect(() => header.element.dispatchEvent(event)).not.toThrow();
    expect(onSort).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Resize Interaction (Pointer Events)
// =============================================================================

describe("createTableHeader - resize interaction", () => {
  it("should call onResize during pointer drag on resize handle", () => {
    const { root, viewport } = createTestDOM();
    const onResize = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", onResize);
    const layout = createResolvedLayout([
      col("name", { width: 200, resizable: true }),
      col("value", { width: 200 }),
    ]);

    header.rebuild(layout);

    const handle = header.element.querySelector(".vlist-table-header-resize") as HTMLElement;

    // Stub setPointerCapture/releasePointerCapture
    handle.setPointerCapture = mock(() => {});
    handle.releasePointerCapture = mock(() => {});

    // Simulate pointerdown
    const downEvent = new PointerEvent("pointerdown", {
      clientX: 200,
      bubbles: true,
      pointerId: 1,
    } as any);
    handle.dispatchEvent(downEvent);

    // Should add resizing class
    expect(root.classList.contains("vlist--col-resizing")).toBe(true);

    // Simulate pointermove with enough delta
    const moveEvent = new PointerEvent("pointermove", {
      clientX: 250,
      bubbles: true,
    } as any);
    handle.dispatchEvent(moveEvent);

    expect(onResize).toHaveBeenCalled();
    // newWidth = dragStartWidth + delta = 200 + 50 = 250
    expect((onResize as any).mock.calls[0]).toEqual([0, 250]);

    // Simulate pointerup
    const upEvent = new PointerEvent("pointerup", {
      clientX: 250,
      bubbles: true,
      pointerId: 1,
    } as any);
    handle.dispatchEvent(upEvent);

    // Should remove resizing class
    expect(root.classList.contains("vlist--col-resizing")).toBe(false);
    expect(root.style.cursor).toBe("");
  });

  it("should ignore small drags below MIN_DRAG_DELTA", () => {
    const { root, viewport } = createTestDOM();
    const onResize = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", onResize);
    const layout = createResolvedLayout([
      col("name", { width: 200, resizable: true }),
    ]);

    header.rebuild(layout);

    const handle = header.element.querySelector(".vlist-table-header-resize") as HTMLElement;
    handle.setPointerCapture = mock(() => {});
    handle.releasePointerCapture = mock(() => {});

    handle.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 200,
      bubbles: true,
      pointerId: 1,
    } as any));

    // Move less than 1px
    handle.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 200,
      bubbles: true,
    } as any));

    expect(onResize).not.toHaveBeenCalled();

    // Cleanup
    handle.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 200,
      bubbles: true,
      pointerId: 1,
    } as any));
  });

  it("should ignore pointerdown on non-resize elements", () => {
    const { root, viewport } = createTestDOM();
    const onResize = mock(() => {});
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", onResize);
    const layout = createResolvedLayout([col("name", { width: 200 })]);

    header.rebuild(layout);

    // Click on the header element itself (not a resize handle)
    const downEvent = new PointerEvent("pointerdown", {
      clientX: 100,
      bubbles: true,
    } as any);
    header.element.dispatchEvent(downEvent);

    // No resize should start — no class added
    expect(root.classList.contains("vlist--col-resizing")).toBe(false);
  });

  it("should handle pointerup when not dragging", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    // Should not throw
    expect(() => {
      const upEvent = new PointerEvent("pointerup", { bubbles: true } as any);
      header.element.dispatchEvent(upEvent);
    }).not.toThrow();
  });

  it("should add active class to handle during drag", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());
    const layout = createResolvedLayout([
      col("name", { width: 200, resizable: true }),
    ]);

    header.rebuild(layout);

    const handle = header.element.querySelector(".vlist-table-header-resize") as HTMLElement;
    handle.setPointerCapture = mock(() => {});
    handle.releasePointerCapture = mock(() => {});

    handle.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 200,
      bubbles: true,
      pointerId: 1,
    } as any));

    expect(handle.classList.contains("vlist-table-header-resize--active")).toBe(true);

    handle.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 200,
      bubbles: true,
      pointerId: 1,
    } as any));

    expect(handle.classList.contains("vlist-table-header-resize--active")).toBe(false);
  });
});

// =============================================================================
// Visibility
// =============================================================================

describe("createTableHeader - visibility", () => {
  it("should hide the header", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    header.hide();
    expect(header.element.style.display).toBe("none");
  });

  it("should show the header after hiding", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    header.hide();
    header.show();
    expect(header.element.style.display).toBe("");
  });

  it("should not re-show if already visible", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    // Already visible by default — show should be a no-op
    header.show();
    expect(header.element.style.display).toBe("");
  });

  it("should not re-hide if already hidden", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    header.hide();
    header.hide(); // Should be a no-op
    expect(header.element.style.display).toBe("none");
  });
});

// =============================================================================
// Destroy
// =============================================================================

describe("createTableHeader - destroy", () => {
  it("should remove the rowgroup from DOM", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    const rowgroup = root.firstChild as HTMLElement;
    expect(rowgroup.getAttribute("role")).toBe("rowgroup");

    header.destroy();

    // Rowgroup should be removed
    expect(root.querySelector("[role='rowgroup']")).toBeNull();
  });

  it("should clear the header height CSS variable on root after destroy", () => {
    const { root, viewport } = createTestDOM();
    const header = createTableHeader<TestItem>(root, viewport, 40, "vlist", mock());

    expect(root.style.getPropertyValue('--vlist-table-header-height')).toBe("40px");

    header.destroy();

    expect(root.style.getPropertyValue('--vlist-table-header-height')).toBe("");
    expect(viewport.style.position).toBe("");
  });
});
