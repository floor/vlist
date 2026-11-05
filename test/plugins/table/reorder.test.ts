/**
 * vlist — Table Column Reorder Plugin Tests (#113)
 *
 * Tests for columnReorder() plugin:
 * - Validation when used without table() (createVList and direct setup())
 * - moveColumn(keyOrFromIndex, toIndex), getColumnOrder(), and column:reorder event
 * - In-place cell permutation without re-executing cell() templates
 * - aria-colindex updates (1..N) and polite live region announcement ("Moved <Label> to position <n>")
 * - Sort consistency across reorder ("sorted by B, then move B")
 * - Pointer drag threshold (5px), drop indicator, drop commit, and click/sort suppression
 * - Edge auto-scroll during pointer drag near viewport / pin-zone boundaries
 * - Alt+ArrowLeft / Alt+ArrowRight keyboard reorder keeping focus and tabIndex=0 on moved cell
 * - Non-conflict with Arrow focus, Ctrl+Arrow resize, and Shift+Alt+Arrow columnPin shortcuts
 * - Pinned partition clamping when combined with columnPin() and unpin sequence preservation
 */

import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { describe, it, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import { table, type TableMethods } from "../../../src/plugins/table/plugin";
import { columnPin, type ColumnPinMethods } from "../../../src/plugins/table/pin";
import {
  columnReorder,
  type ColumnReorderMethods,
  type ColumnReorderPluginConfig,
} from "../../../src/plugins/table/reorder";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import type {
  TableColumn,
  ColumnReorderEvent,
  ColumnSortEvent,
  ColumnClickEvent,
} from "../../../src/plugins/table/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// DOM & Geometry Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 300;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 400;
    },
    configurable: true,
  });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

interface RowItem extends VListItem {
  id: number;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
  F: string;
}

const KEYS = ["A", "B", "C", "D", "E", "F"] as const;

function makeItems(count: number): RowItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    A: `A${i}`,
    B: `B${i}`,
    C: `C${i}`,
    D: `D${i}`,
    E: `E${i}`,
    F: `F${i}`,
  }));
}

function makeColumns(
  overrides: Partial<Record<(typeof KEYS)[number], Partial<TableColumn<RowItem>>>> = {},
  width = 100,
): TableColumn<RowItem>[] {
  return KEYS.map((key) => ({
    key,
    label: `Col ${key}`,
    width,
    sortable: true,
    ...overrides[key],
  }));
}

let activeContainer: HTMLElement | null = null;
let activeList:
  | (VList<RowItem> & TableMethods<RowItem> & ColumnReorderMethods & Partial<ColumnPinMethods>)
  | null = null;

afterEach(() => {
  activeList?.destroy();
  activeList = null;
  activeContainer?.remove();
  activeContainer = null;
});

function createReorderTable(
  columns: TableColumn<RowItem>[],
  reorderConfig?: ColumnReorderPluginConfig,
  withPin = false,
  itemCount = 20,
  multiSort = false,
): {
  list: VList<RowItem> & TableMethods<RowItem> & ColumnReorderMethods & ColumnPinMethods;
  container: HTMLElement;
  root: HTMLElement;
  viewport: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  activeContainer = container;

  const plugins = [
    table<RowItem>({
      columns,
      rowHeight: 40,
      headerHeight: 40,
      fillWidth: false,
      multiSort,
    }),
    ...(withPin ? [columnPin<RowItem>()] : []),
    columnReorder<RowItem>(reorderConfig),
  ];

  const list = createVList(
    {
      container,
      items: makeItems(itemCount),
      item: { height: 40, template: (item: RowItem) => item.A },
    },
    plugins,
  ) as unknown as VList<RowItem> &
    TableMethods<RowItem> &
    ColumnReorderMethods &
    ColumnPinMethods;

  activeList = list;
  const root = container.querySelector<HTMLElement>(".vlist")!;
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  return { list, container, root, viewport };
}

function getHeaderOrder(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".vlist-table-header-cell")).map(
    (el) => el.dataset.columnKey!,
  );
}

// =============================================================================
// Validation & Setup
// =============================================================================

describe("columnReorder — validation and setup", () => {
  it("throws a clear error when used without table() at createVList", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeContainer = container;

    expect(() =>
      createVList(
        {
          container,
          items: makeItems(5),
          item: { height: 40, template: (item: RowItem) => item.A },
        },
        [columnReorder<RowItem>()],
      ),
    ).toThrow("[vlist] columnReorder: requires table() plugin");
  });

  it("throws a clear error when setup() is called directly without table()", () => {
    const mockCtx = createPluginMockContext<RowItem>(makeItems(5));
    try {
      expect(() => columnReorder<RowItem>().setup!(mockCtx.ctx)).toThrow(
        "[vlist] columnReorder: requires table() plugin",
      );
    } finally {
      mockCtx.cleanup();
    }
  });
});

// =============================================================================
// Programmatic Reorder, In-Place Cell Permutation & ARIA
// =============================================================================

describe("columnReorder — moveColumn, in-place cells, and ARIA (#113)", () => {
  it("reorders columns via moveColumn(keyOrIndex, toIndex), updates getColumnOrder(), and emits column:reorder", () => {
    const { list, root } = createReorderTable(makeColumns());
    const events: ColumnReorderEvent[] = [];
    list.on("column:reorder", (ev) => events.push(ev));

    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Move B (index 1) to index 3 (after D)
    list.moveColumn("B", 3);
    expect(list.getColumnOrder()).toEqual(["A", "C", "D", "B", "E", "F"]);
    expect(getHeaderOrder(root)).toEqual(["A", "C", "D", "B", "E", "F"]);
    expect(events).toEqual([
      {
        key: "B",
        fromIndex: 1,
        toIndex: 3,
        order: ["A", "C", "D", "B", "E", "F"],
      },
    ]);

    // Move by index: index 4 ("E") to index 0
    list.moveColumn(4, 0);
    expect(list.getColumnOrder()).toEqual(["E", "A", "C", "D", "B", "F"]);
    expect(getHeaderOrder(root)).toEqual(["E", "A", "C", "D", "B", "F"]);

    // Verify first row cells match new order and left offsets
    const row0Cells = Array.from(
      root.querySelectorAll<HTMLElement>('.vlist-table-row[data-index="0"] .vlist-table-cell'),
    );
    expect(row0Cells.map((c) => c.textContent)).toEqual(["E0", "A0", "C0", "D0", "B0", "F0"]);
    expect(row0Cells.map((c) => c.style.left)).toEqual([
      "0px",
      "100px",
      "200px",
      "300px",
      "400px",
      "500px",
    ]);
  });

  it("reorders rendered body cells in place without re-executing cell() templates", () => {
    const cellCalls: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    const cols = makeColumns().map((c) => ({
      ...c,
      cell: (item: RowItem) => {
        cellCalls[c.key]!++;
        return `${c.key}:${item[c.key as keyof RowItem]}`;
      },
    }));

    const { list, root } = createReorderTable(cols, undefined, false, 5);
    const beforeCalls = { ...cellCalls };
    expect(beforeCalls.B).toBe(5);

    const row0CellB = root.querySelectorAll<HTMLElement>(
      '.vlist-table-row[data-index="0"] .vlist-table-cell',
    )[1]!;

    list.moveColumn("B", 4);

    // Zero cell() template executions during reorder!
    expect(cellCalls).toEqual(beforeCalls);

    // Same DOM element moved to index 4
    const row0CellsAfter = root.querySelectorAll<HTMLElement>(
      '.vlist-table-row[data-index="0"] .vlist-table-cell',
    );
    expect(row0CellsAfter[4]).toBe(row0CellB);
    expect(row0CellsAfter[4]!.style.left).toBe("400px");
  });

  it("updates aria-colindex (1..N) on header and body cells and announces move in polite live region", () => {
    const { list, root } = createReorderTable(makeColumns());

    list.moveColumn("B", 3);

    const headerCells = Array.from(
      root.querySelectorAll<HTMLElement>(".vlist-table-header-cell"),
    );
    expect(headerCells.map((c) => c.getAttribute("aria-colindex"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);

    const row0Cells = Array.from(
      root.querySelectorAll<HTMLElement>('.vlist-table-row[data-index="0"] .vlist-table-cell'),
    );
    expect(row0Cells.map((c) => c.getAttribute("aria-colindex"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);

    const liveRegion = root.querySelector<HTMLElement>('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe("Moved Col B to position 4");
  });

  it("respects TableColumn.reorderable: false and ColumnReorderPluginConfig.disabled", () => {
    const { list } = createReorderTable(
      makeColumns({ A: { reorderable: false } }),
      { disabled: ["C"] },
    );

    list.moveColumn("A", 2);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    list.moveColumn("C", 4);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
});

// =============================================================================
// Sort Consistency Across Reorder ("sorted by B, then move B")
// =============================================================================

describe("columnReorder — sort consistency across reorder", () => {
  it("sorted by B, then move B: sort indicator, aria-sort, getSort(), getSorts(), and subsequent sort clicks follow B", () => {
    const { list, root } = createReorderTable(makeColumns(), undefined, false, 10, true);
    const sortEvents: ColumnSortEvent[] = [];
    list.on("column:sort", (ev) => sortEvents.push(ev));

    // Sort by B ascending, then D descending
    list.setSort([
      { key: "B", direction: "asc" },
      { key: "D", direction: "desc" },
    ]);

    const cellBBefore = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    expect(cellBBefore.getAttribute("aria-sort")).toBe("ascending");
    expect(
      cellBBefore.querySelector<HTMLElement>(".vlist-table-header-sort")!.dataset.sortPriority,
    ).toBe("1");

    // Move B from index 1 to index 4 (order: A, C, D, E, B, F)
    list.moveColumn("B", 4);

    expect(getHeaderOrder(root)).toEqual(["A", "C", "D", "E", "B", "F"]);
    expect(list.getSort()).toEqual({ key: "B", direction: "asc" });
    expect(list.getSorts()).toEqual([
      { key: "B", direction: "asc" },
      { key: "D", direction: "desc" },
    ]);

    const headerCells = Array.from(
      root.querySelectorAll<HTMLElement>(".vlist-table-header-cell"),
    );
    // B is now at index 4 and still carries aria-sort="ascending" and priority 1
    expect(headerCells[4]!.dataset.columnKey).toBe("B");
    expect(headerCells[4]!.getAttribute("aria-sort")).toBe("ascending");
    expect(
      headerCells[4]!.querySelector<HTMLElement>(".vlist-table-header-sort")!.textContent,
    ).toBe("\u25B2");
    expect(
      headerCells[4]!.querySelector<HTMLElement>(".vlist-table-header-sort")!.dataset
        .sortPriority,
    ).toBe("1");
    // No other cell has aria-sort
    expect(headerCells.filter((c) => c.hasAttribute("aria-sort"))).toHaveLength(1);

    // Clicking B with Shift at its new position (index 4) cycles B to desc in-place at index 4!
    headerCells[4]!.dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(sortEvents).toHaveLength(1);
    expect(sortEvents[0]!.key).toBe("B");
    expect(sortEvents[0]!.index).toBe(4);
    expect(sortEvents[0]!.direction).toBe("desc");
    expect(headerCells[4]!.getAttribute("aria-sort")).toBe("descending");

    // Plain single-column sort on B, move B again to index 1, plain click cycles desc -> null
    list.setSort("B", "asc");
    list.moveColumn("B", 1);
    const cellBAt1 = root.querySelectorAll<HTMLElement>(".vlist-table-header-cell")[1]!;
    expect(cellBAt1.dataset.columnKey).toBe("B");
    expect(cellBAt1.getAttribute("aria-sort")).toBe("ascending");
    cellBAt1.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sortEvents[1]!.key).toBe("B");
    expect(sortEvents[1]!.index).toBe(1);
    expect(sortEvents[1]!.direction).toBe("desc");
  });
});

// =============================================================================
// Pointer Drag, Drop Indicator, Edge Auto-Scroll & Click/Sort Suppression
// =============================================================================

describe("columnReorder — pointer drag, drop indicator, and edge auto-scroll", () => {
  it("drags header cell past 5px threshold, shows drop indicator, reorders on pointerup, and suppresses click/sort", () => {
    const { list, root } = createReorderTable(makeColumns());
    const sortEvents: ColumnSortEvent[] = [];
    const clickEvents: ColumnClickEvent[] = [];
    list.on("column:sort", (ev) => sortEvents.push(ev));
    list.on("column:click", (ev) => clickEvents.push(ev));

    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellB.setPointerCapture = mock(() => {});
    cellB.releasePointerCapture = mock(() => {});

    // Start pointerdown on B (100..200px) at x = 150
    cellB.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 150,
        button: 0,
        pointerId: 1,
        bubbles: true,
      } as any),
    );

    // Move by 3px (< 5px threshold) -> drag not started yet
    cellB.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 153,
        pointerId: 1,
        bubbles: true,
      } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);

    // Move to x = 360 (past C [200..300] and D's midpoint [350], targeting index 3)
    cellB.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 360,
        pointerId: 1,
        bubbles: true,
      } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(true);
    expect(cellB.classList.contains("vlist-table-header-cell--dragging")).toBe(true);

    const indicator = root.querySelector<HTMLElement>(".vlist-table-drop-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.style.display).not.toBe("none");
    // Boundary after D (index 3, offset 300 + width 100 = 400px)
    expect(indicator!.style.transform).toBe("translateX(400px)");

    // Release pointerup
    cellB.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 360,
        pointerId: 1,
        bubbles: true,
      } as any),
    );

    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(cellB.classList.contains("vlist-table-header-cell--dragging")).toBe(false);
    expect(list.getColumnOrder()).toEqual(["A", "C", "D", "B", "E", "F"]);

    // Trailing click after pointerup must be suppressed (must not sort or emit column:click)
    cellB.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(sortEvents).toHaveLength(0);
    expect(clickEvents).toHaveLength(0);
  });

  it("ignores pointerdown on resize handles and interactive header controls", () => {
    const button = document.createElement("button");
    const labelWithBtn = document.createElement("span");
    labelWithBtn.appendChild(button);

    const { list, root } = createReorderTable(
      makeColumns({ A: { label: labelWithBtn } }),
    );

    // Pointerdown on resize handle
    const handle = root.querySelector<HTMLElement>(".vlist-table-header-resize")!;
    handle.setPointerCapture = mock(() => {});
    handle.releasePointerCapture = mock(() => {});
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 100, button: 0, pointerId: 1, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    handle.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 100, pointerId: 1, bubbles: true } as any),
    );

    // Pointerdown on interactive button inside cell A
    button.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 20, button: 0, pointerId: 2, bubbles: true } as any),
    );
    button.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 250, pointerId: 2, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("auto-scrolls viewport horizontally when dragging within 40px of viewport edge", () => {
    // 6 columns * 100px = 600px totalWidth, viewport clientWidth = 400px
    const { root, viewport } = createReorderTable(makeColumns());
    const cellA = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="A"]',
    )!;
    cellA.setPointerCapture = mock(() => {});
    cellA.releasePointerCapture = mock(() => {});

    expect(viewport.scrollLeft).toBe(0);

    cellA.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 50, button: 0, pointerId: 1, bubbles: true } as any),
    );
    // Drag near right edge of 400px viewport (clientX = 390, within [360..400] 40px edge zone)
    cellA.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 390, pointerId: 1, bubbles: true } as any),
    );

    expect(viewport.scrollLeft).toBeGreaterThan(0);

    cellA.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 390, pointerId: 1, bubbles: true } as any),
    );
  });
});

// =============================================================================
// Keyboard Alt+Arrow Reordering & Shortcut Coexistence
// =============================================================================

describe("columnReorder — keyboard Alt+Arrow and shortcut coexistence", () => {
  it("moves focused column with Alt+ArrowRight and Alt+ArrowLeft while keeping focus and tabIndex=0 on the moved cell", () => {
    const { list, root } = createReorderTable(makeColumns());
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;

    cellB.focus();
    expect(document.activeElement).toBe(cellB);
    expect(cellB.getAttribute("tabindex")).toBe("0");

    // Alt+ArrowRight moves B from index 1 to index 2 (after C)
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(list.getColumnOrder()).toEqual(["A", "C", "B", "D", "E", "F"]);
    expect(document.activeElement).toBe(cellB);
    expect(cellB.getAttribute("tabindex")).toBe("0");
    const tabStops = Array.from(
      root.querySelectorAll<HTMLElement>('.vlist-table-header-cell[tabindex="0"]'),
    );
    expect(tabStops).toEqual([cellB]);

    // Subsequent plain ArrowRight from B (now at index 2) focuses D (index 3)!
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    const cellD = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="D"]',
    )!;
    expect(document.activeElement).toBe(cellD);
    expect(cellD.getAttribute("tabindex")).toBe("0");

    // Alt+ArrowLeft on D moves D from index 3 to index 2 (before B)
    cellD.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnOrder()).toEqual(["A", "C", "D", "B", "E", "F"]);
    expect(document.activeElement).toBe(cellD);
  });

  it("does not conflict with Ctrl+Arrow resize or Shift+Alt+Arrow columnPin shortcuts", () => {
    const { list, root } = createReorderTable(makeColumns(), undefined, true);
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellB.focus();

    // Ctrl+ArrowRight resizes B (100 -> 110) without reordering
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnWidths().B).toBe(110);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Shift+Alt+ArrowLeft pins B to left without triggering Alt+Arrow reorder
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnPins()).toEqual({ B: "left" });
    expect(list.getColumnOrder()).toEqual(["B", "A", "C", "D", "E", "F"]);
  });
});

// =============================================================================
// Pinned Partition Clamping (columnReorder + columnPin)
// =============================================================================

describe("columnReorder — pinned partition clamping with columnPin()", () => {
  it("clamps moveColumn, drag, and Alt+Arrow within left-pinned, unpinned, and right-pinned partitions and preserves reordered unpinned sequence on unpin", () => {
    // A, B pinned left (indices 0..1); C, D unpinned (indices 2..3); E, F pinned right (indices 4..5)
    const { list, root } = createReorderTable(
      makeColumns({
        A: { pin: "left" },
        B: { pin: "left" },
        E: { pin: "right" },
        F: { pin: "right" },
      }),
      undefined,
      true,
    );

    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Left-pinned A (index 0) cannot move into unpinned index 3 -> clamps to index 1 (swaps A and B)
    list.moveColumn("A", 3);
    expect(list.getColumnOrder()).toEqual(["B", "A", "C", "D", "E", "F"]);
    expect(list.getColumnPins()).toEqual({ B: "left", A: "left", E: "right", F: "right" });
    // A is now the last left-pinned column -> carries --pin-left-last
    const headerCells = Array.from(
      root.querySelectorAll<HTMLElement>(".vlist-table-header-cell"),
    );
    expect(headerCells[1]!.dataset.columnKey).toBe("A");
    expect(headerCells[1]!.classList.contains("vlist-table-header-cell--pin-left-last")).toBe(
      true,
    );
    expect(headerCells[0]!.classList.contains("vlist-table-header-cell--pin-left-last")).toBe(
      false,
    );

    // Unpinned D (index 3) cannot move into left-pinned index 0 -> clamps to index 2 (swaps C and D)
    list.moveColumn("D", 0);
    expect(list.getColumnOrder()).toEqual(["B", "A", "D", "C", "E", "F"]);

    // Right-pinned F (index 5) cannot move into unpinned index 2 -> clamps to index 4 (swaps E and F)
    list.moveColumn("F", 2);
    expect(list.getColumnOrder()).toEqual(["B", "A", "D", "C", "F", "E"]);

    // Pointer-dragging left-pinned B (index 0) far right (clientX = 450, over E) clamps to left partition (index 1, after A)
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellB.setPointerCapture = mock(() => {});
    cellB.releasePointerCapture = mock(() => {});
    cellB.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 50, button: 0, pointerId: 1, bubbles: true } as any),
    );
    cellB.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 450, pointerId: 1, bubbles: true } as any),
    );
    cellB.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 450, pointerId: 1, bubbles: true } as any),
    );
    expect(list.getColumnOrder()).toEqual(["A", "B", "D", "C", "F", "E"]);

    // Unpinning B restores B into the unpinned partition while keeping D before C!
    list.setColumnPin("B", null);
    expect(list.getColumnOrder()).toEqual(["A", "B", "D", "C", "F", "E"]);
  });
});
