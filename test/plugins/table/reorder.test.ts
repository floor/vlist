/**
 * vlist — Table columnReorder() Feature Tests (#113)
 *
 * Tests for `table({ features: [columnReorder()] })`:
 * - Omitting `features` leaves `moveColumn` and `getColumnOrder` undefined
 * - `moveColumn(keyOrFromIndex, toIndex)`, `getColumnOrder()`, and `column:reorder` event
 * - In-place cell permutation without re-executing `cell()` templates
 * - `aria-colindex` updates (1..N) and dedicated polite live region (`.vlist-table-reorder-live`),
 *   preserving multi-sort `aria-describedby` live region (`[id^="vlist-table-live-"]`) and removing on destroy
 * - Sort consistency across reorder ("sorted by B, then move B")
 * - Pointer drag threshold (5px), pointer capture/release/cancel/lostpointercapture,
 *   drop indicator, drop commit, click/sort suppression, and no listener stacking when pointerup lands outside before capture
 * - Hot-path allocation checks (`getBoundingClientRect` cached per drag, `translateX` written only on boundary change, single reused `Event("scroll")` on auto-scroll)
 * - Edge auto-scroll during pointer drag and stop conditions (pinned columns, pointerup, boundary reached)
 * - `Alt+ArrowLeft` / `Alt+ArrowRight` keyboard reorder keeping focus and `tabIndex=0`, not swallowing `Alt+Arrow` on locked columns, and announcing partition-edge blocks
 * - Pinned partition clamping with `columnPin()` in both `[columnPin(), columnReorder()]` and reversed `[columnReorder(), columnPin()]` orders
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
  type ColumnReorderConfig,
} from "../../../src/plugins/table/reorder";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import type {
  TableColumn,
  ColumnReorderEvent,
  ColumnSortEvent,
  ColumnClickEvent,
} from "../../../src/plugins/table/types";

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
  | (VList<RowItem> & TableMethods<RowItem> & Partial<ColumnReorderMethods> & Partial<ColumnPinMethods>)
  | null = null;

afterEach(() => {
  activeList?.destroy();
  activeList = null;
  activeContainer?.remove();
  activeContainer = null;
});

function createReorderTable(
  columns: TableColumn<RowItem>[],
  reorderConfig?: ColumnReorderConfig,
  withPin: boolean | "reversed" = false,
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

  const features =
    withPin === "reversed"
      ? [columnReorder<RowItem>(reorderConfig), columnPin<RowItem>()]
      : withPin
        ? [columnPin<RowItem>(), columnReorder<RowItem>(reorderConfig)]
        : [columnReorder<RowItem>(reorderConfig)];

  const list = createVList(
    {
      container,
      items: makeItems(itemCount),
      item: { height: 40, template: (item: RowItem) => item.A },
    },
    [
      table({
        columns,
        rowHeight: 40,
        headerHeight: 40,
        fillWidth: false,
        multiSort,
        features,
      }),
    ],
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
// Feature Mounting & Omission
// =============================================================================

describe("columnReorder — table({ features }) mounting", () => {
  it("leaves moveColumn and getColumnOrder undefined and does not reorder when columnReorder() is omitted from features", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeContainer = container;

    const list = createVList(
      {
        container,
        items: makeItems(5),
        item: { height: 40, template: (item: RowItem) => item.A },
      },
      [
        table({
          columns: makeColumns(),
          rowHeight: 40,
          headerHeight: 40,
          fillWidth: false,
        }),
      ],
    ) as unknown as VList<RowItem> & TableMethods<RowItem> & Partial<ColumnReorderMethods>;
    activeList = list;

    expect(list.moveColumn).toBeUndefined();
    expect(list.getColumnOrder).toBeUndefined();

    const root = container.querySelector<HTMLElement>(".vlist")!;
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellB.focus();
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(getHeaderOrder(root)).toEqual(["A", "B", "C", "D", "E", "F"]);
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

  it("updates aria-colindex (1..N), announces move in its own polite live region without overwriting multi-sort aria-describedby, and removes the live region on destroy", () => {
    const { list, root } = createReorderTable(makeColumns(), undefined, false, 10, true);

    // Activate multi-sort first so header.ts creates [id^="vlist-table-live-"]
    list.setSort([
      { key: "A", direction: "asc" },
      { key: "C", direction: "desc" },
    ]);
    const sortLive = root.querySelector<HTMLElement>('[id^="vlist-table-live-"]');
    expect(sortLive).not.toBeNull();
    expect(sortLive!.textContent).toBe("sorted by Col A ascending, then Col C descending");

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

    // Dedicated reorder live region holds the move announcement while sortLive keeps the multi-sort description
    const reorderLive = root.querySelector<HTMLElement>(".vlist-table-reorder-live");
    expect(reorderLive).not.toBeNull();
    expect(reorderLive!.getAttribute("aria-live")).toBe("polite");
    expect(reorderLive!.textContent).toBe("Moved Col B to position 4");
    expect(sortLive!.textContent).toBe("sorted by Col A ascending, then Col C descending");

    // Reorder live region is removed when the list is destroyed
    expect( reorderLive!.isConnected ).toBe(true);
    list.destroy();
    activeList = null;
    expect( reorderLive!.isConnected ).toBe(false);
  });

  it("respects TableColumn.reorderable: false and ColumnReorderConfig.disabled", () => {
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
    list.on("column:sort", (ev) => sortEvents.push(ev as ColumnSortEvent));

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
    expect(headerCells[4]!.dataset.columnKey).toBe("B");
    expect(headerCells[4]!.getAttribute("aria-sort")).toBe("ascending");
    expect(
      headerCells[4]!.querySelector<HTMLElement>(".vlist-table-header-sort")!.textContent,
    ).toBe("\u25B2");
    expect(
      headerCells[4]!.querySelector<HTMLElement>(".vlist-table-header-sort")!.dataset
        .sortPriority,
    ).toBe("1");
    expect(headerCells.filter((c) => c.hasAttribute("aria-sort"))).toHaveLength(1);

    headerCells[4]!.dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(sortEvents).toHaveLength(1);
    expect(sortEvents[0]!.key).toBe("B");
    expect(sortEvents[0]!.index).toBe(4);
    expect(sortEvents[0]!.direction).toBe("desc");
    expect(headerCells[4]!.getAttribute("aria-sort")).toBe("descending");

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
// Pointer Drag, Capture/Cancel, Listener Cleanup & Hot-Path Allocations
// =============================================================================

describe("columnReorder — pointer drag, drop indicator, capture/cancel, and edge auto-scroll", () => {
  it("drags header cell past 5px threshold, calls setPointerCapture/releasePointerCapture, shows drop indicator, reorders on pointerup, and suppresses click/sort", () => {
    const { list, root } = createReorderTable(makeColumns());
    const sortEvents: ColumnSortEvent[] = [];
    const clickEvents: ColumnClickEvent[] = [];
    list.on("column:sort", (ev) => sortEvents.push(ev as ColumnSortEvent));
    list.on("column:click", (ev) => clickEvents.push(ev as ColumnClickEvent));

    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    const setCapture = mock((_id: number) => {});
    const releaseCapture = mock((_id: number) => {});
    cellB.setPointerCapture = setCapture;
    cellB.releasePointerCapture = releaseCapture;

    cellB.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 150,
        button: 0,
        pointerId: 7,
        bubbles: true,
      } as any),
    );

    // Move by 3px (< 5px threshold) -> drag not started yet, capture not acquired
    cellB.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 153,
        pointerId: 7,
        bubbles: true,
      } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(setCapture).not.toHaveBeenCalled();

    // Move to x = 360 (past C [200..300] and D's midpoint [350], targeting index 3)
    cellB.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 360,
        pointerId: 7,
        bubbles: true,
      } as any),
    );
    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(setCapture).toHaveBeenCalledWith(7);
    expect(root.classList.contains("vlist--col-reordering")).toBe(true);
    expect(cellB.classList.contains("vlist-table-header-cell--dragging")).toBe(true);

    const indicator = root.querySelector<HTMLElement>(".vlist-table-drop-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.style.display).not.toBe("none");
    expect(indicator!.style.transform).toBe("translateX(398px)");

    // Release pointerup
    cellB.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 360,
        pointerId: 7,
        bubbles: true,
      } as any),
    );

    expect(releaseCapture).toHaveBeenCalledTimes(1);
    expect(releaseCapture).toHaveBeenCalledWith(7);
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(cellB.classList.contains("vlist-table-header-cell--dragging")).toBe(false);
    expect(list.getColumnOrder()).toEqual(["A", "C", "D", "B", "E", "F"]);

    // Trailing click after pointerup must be suppressed
    cellB.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(sortEvents).toHaveLength(0);
    expect(clickEvents).toHaveLength(0);
  });

  it("aborts an active drag without reordering on pointercancel or lostpointercapture", () => {
    const { list, root } = createReorderTable(makeColumns());
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellB.setPointerCapture = mock(() => {});
    cellB.releasePointerCapture = mock(() => {});

    // 1. pointercancel during active drag
    cellB.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 150, button: 0, pointerId: 1, bubbles: true } as any),
    );
    cellB.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 360, pointerId: 1, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(true);

    cellB.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(cellB.classList.contains("vlist-table-header-cell--dragging")).toBe(false);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // 2. lostpointercapture during active drag
    cellB.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 150, button: 0, pointerId: 2, bubbles: true } as any),
    );
    cellB.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 360, pointerId: 2, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(true);

    cellB.dispatchEvent(
      new PointerEvent("lostpointercapture", { pointerId: 2, bubbles: false } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(cellB.classList.contains("vlist-table-header-cell--dragging")).toBe(false);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("cleans up pending drag when pointerup lands outside the cell before capture and never lets a stale cell listener finish a new drag", () => {
    const { list, root } = createReorderTable(makeColumns());
    const cellA = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="A"]',
    )!;
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellA.setPointerCapture = mock(() => {});
    cellA.releasePointerCapture = mock(() => {});
    cellB.setPointerCapture = mock(() => {});
    cellB.releasePointerCapture = mock(() => {});

    // Pointerdown on A (pointerId 1), move 2px (< 5px threshold), release pointerup on window outside A
    cellA.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 50, button: 0, pointerId: 1, bubbles: true } as any),
    );
    cellA.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 52, pointerId: 1, bubbles: true } as any),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 52, pointerId: 1, bubbles: true } as any),
    );

    // Start a new drag on B (pointerId 2) past threshold to target C (clientX = 260)
    cellB.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 150, button: 0, pointerId: 2, bubbles: true } as any),
    );
    cellB.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 260, pointerId: 2, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(true);

    // A stale non-bubbling pointerup on cellA from pointerId 1 must NOT finish cellB's active drag!
    cellA.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 50, pointerId: 1, bubbles: false } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(true);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Continue dragging B to D (clientX = 360) and release pointerId 2
    cellB.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 360, pointerId: 2, bubbles: true } as any),
    );
    cellB.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 360, pointerId: 2, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    expect(list.getColumnOrder()).toEqual(["A", "C", "D", "B", "E", "F"]);
  });

  it("ignores pointerdown on resize handles and interactive header controls while reordering on header cell drag", () => {
    const button = document.createElement("button");
    const labelWithBtn = document.createElement("span");
    labelWithBtn.appendChild(button);

    const { list, root } = createReorderTable(
      makeColumns({ A: { label: labelWithBtn, resizable: true } }),
    );

    const handle = root.querySelector<HTMLElement>(".vlist-table-header-resize")!;
    handle.setPointerCapture = mock(() => {});
    handle.releasePointerCapture = mock(() => {});
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 100, button: 0, pointerId: 1, bubbles: true } as any),
    );
    handle.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 260, pointerId: 1, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    handle.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 260, pointerId: 1, bubbles: true } as any),
    );
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Pointerdown on interactive button inside cell A
    button.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 20, button: 0, pointerId: 2, bubbles: true } as any),
    );
    button.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 260, pointerId: 2, bubbles: true } as any),
    );
    expect(root.classList.contains("vlist--col-reordering")).toBe(false);
    button.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 260, pointerId: 2, bubbles: true } as any),
    );
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Dragging cell A itself DOES reorder (proves the test fails if onHeaderPointerDown is removed)
    const cellA = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="A"]',
    )!;
    cellA.setPointerCapture = mock(() => {});
    cellA.releasePointerCapture = mock(() => {});
    cellA.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 50, button: 0, pointerId: 3, bubbles: true } as any),
    );
    cellA.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 350, pointerId: 3, bubbles: true } as any),
    );
    cellA.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 350, pointerId: 3, bubbles: true } as any),
    );
    expect(list.getColumnOrder()).toEqual(["B", "A", "C", "D", "E", "F"]);
  });

  it("caches getBoundingClientRect on pointerdown, avoids redundant translateX writes on unchanged target, reuses a single scroll Event, and stops edge auto-scroll on pointerup or pinned columns", () => {
    const { root, viewport } = createReorderTable(
      makeColumns({ A: { pin: "left" } }),
      undefined,
      true,
    );

    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const rafQueue: FrameRequestCallback[] = [];
    let nextRafId = 1;
    const cancelledIds = new Set<number>();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.push(cb);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      cancelledIds.add(id);
    }) as typeof cancelAnimationFrame;

    try {
      let rectCalls = 0;
      const origGetRect = viewport.getBoundingClientRect.bind(viewport);
      viewport.getBoundingClientRect = () => {
        rectCalls++;
        return origGetRect();
      };

      const dispatchedEvents: Event[] = [];
      const origDispatch = viewport.dispatchEvent.bind(viewport);
      viewport.dispatchEvent = (ev: Event) => {
        if (ev.type === "scroll") dispatchedEvents.push(ev);
        return origDispatch(ev);
      };

      // 1. Pinned column A dragged near right edge must NOT auto-scroll viewport
      const cellA = root.querySelector<HTMLElement>(
        '.vlist-table-header-cell[data-column-key="A"]',
      )!;
      cellA.setPointerCapture = mock(() => {});
      cellA.releasePointerCapture = mock(() => {});
      cellA.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 50, button: 0, pointerId: 1, bubbles: true } as any),
      );
      cellA.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 390, pointerId: 1, bubbles: true } as any),
      );
      expect(viewport.scrollLeft).toBe(0);
      expect(rafQueue).toHaveLength(0);
      cellA.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 390, pointerId: 1, bubbles: true } as any),
      );

      // 2. Unpinned column B dragged across multiple pointermove events and auto-scroll frames
      rectCalls = 0;
      const cellB = root.querySelector<HTMLElement>(
        '.vlist-table-header-cell[data-column-key="B"]',
      )!;
      cellB.setPointerCapture = mock(() => {});
      cellB.releasePointerCapture = mock(() => {});

      cellB.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 150, button: 0, pointerId: 2, bubbles: true } as any),
      );
      // First move activates drag and targets index 2 (boundary 300px)
      cellB.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 260, pointerId: 2, bubbles: true } as any),
      );

      const indicator = root.querySelector<HTMLElement>(".vlist-table-drop-indicator")!;
      let transformWrites = 0;
      let currentTransform = indicator.style.transform;
      Object.defineProperty(indicator.style, "transform", {
        get: () => currentTransform,
        set: (v: string) => {
          transformWrites++;
          currentTransform = v;
        },
        configurable: true,
      });

      // Moving within the same target column C (265, 270, 275) must NOT rewrite style.transform
      cellB.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 265, pointerId: 2, bubbles: true } as any),
      );
      cellB.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 270, pointerId: 2, bubbles: true } as any),
      );
      expect(transformWrites).toBe(0);

      // Move into right 40px edge zone (clientX = 390) -> auto-scrolls and schedules RAF
      cellB.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 390, pointerId: 2, bubbles: true } as any),
      );
      expect(viewport.scrollLeft).toBeGreaterThan(0);
      expect(rafQueue.length).toBe(1);

      // Run one queued auto-scroll RAF frame
      const frame1 = rafQueue.shift()!;
      frame1(16);
      expect(dispatchedEvents.length).toBeGreaterThanOrEqual(2);
      // Every scroll event dispatched by auto-scroll must be the exact same reused Event("scroll") instance
      for (const ev of dispatchedEvents) {
        expect(ev).toBe(dispatchedEvents[0]!);
      }

      // getBoundingClientRect must have been called at most once (on pointerdown), never per move or per frame
      expect(rectCalls).toBeLessThanOrEqual(1);

      // Pointerup must cancel the pending auto-scroll RAF
      expect(rafQueue.length).toBe(1);
      cellB.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 390, pointerId: 2, bubbles: true } as any),
      );
      expect(cancelledIds.size).toBeGreaterThan(0);
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
    }
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

    // Subsequent plain ArrowRight from B (now at index 2) focuses D (index 3)
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

  it("does not swallow Alt+Arrow in capture phase on locked columns (reorderable: false or disabled) and announces that the column is locked", () => {
    const { list, root } = createReorderTable(
      makeColumns({ A: { reorderable: false } }),
      { disabled: ["B"] },
    );

    const cellA = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="A"]',
    )!;
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;

    let cellAReceivedKeydown = 0;
    let cellBReceivedKeydown = 0;
    cellA.addEventListener("keydown", () => {
      cellAReceivedKeydown++;
    });
    cellB.addEventListener("keydown", () => {
      cellBReceivedKeydown++;
    });

    cellA.focus();
    cellA.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Capture listener on root must NOT stopPropagation before reaching cellA
    expect(cellAReceivedKeydown).toBe(1);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);
    const reorderLive = root.querySelector<HTMLElement>(".vlist-table-reorder-live");
    expect(reorderLive).not.toBeNull();
    expect(reorderLive!.textContent).toContain("Col A");

    cellB.focus();
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(cellBReceivedKeydown).toBe(1);
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(reorderLive!.textContent).toContain("Col B");
  });

  it("does not conflict with Ctrl+Arrow resize or Shift+Alt+Arrow columnPin shortcuts and reorders on Alt+Arrow", () => {
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

    // Alt+ArrowRight on unpinned A (now at index 1) moves A to index 2 (after C)
    const cellA = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="A"]',
    )!;
    cellA.focus();
    cellA.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnOrder()).toEqual(["B", "C", "A", "D", "E", "F"]);
  });
});

// =============================================================================
// Pinned Partition Clamping (columnReorder + columnPin, both orders)
// =============================================================================

describe("columnReorder — pinned partition clamping with columnPin()", () => {
  it("clamps moveColumn, drag, and Alt+Arrow within left-pinned, unpinned, and right-pinned partitions, announces partition-edge blocks, and preserves unpinned sequence on unpin", () => {
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

    // Alt+ArrowRight on B (index 1, right edge of left-pinned group) cannot leave left partition and announces in polite live region
    const cellB = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="B"]',
    )!;
    cellB.focus();
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);
    const reorderLive = root.querySelector<HTMLElement>(".vlist-table-reorder-live");
    expect(reorderLive).not.toBeNull();
    expect(reorderLive!.textContent).toContain("Col B");
    expect(reorderLive!.textContent).toContain("left");

    // Alt+ArrowLeft on B (index 1) moves B to index 0 within left partition
    cellB.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnOrder()).toEqual(["B", "A", "C", "D", "E", "F"]);
    expect(list.getColumnPins()).toEqual({ B: "left", A: "left", E: "right", F: "right" });

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

    // Pointer-dragging left-pinned B (index 0) far right (clientX = 450) clamps to left partition (index 1, after A)
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

    // Unpinning B restores B into the unpinned partition while keeping D before C
    list.setColumnPin("B", null);
    expect(list.getColumnOrder()).toEqual(["A", "B", "D", "C", "F", "E"]);
  });

  it("enforces identical pin partitions when features are passed in reversed order: [columnReorder(), columnPin()]", () => {
    const { list, root } = createReorderTable(
      makeColumns({
        A: { pin: "left" },
        B: { pin: "left" },
        E: { pin: "right" },
        F: { pin: "right" },
      }),
      undefined,
      "reversed",
    );

    expect(list.getColumnOrder()).toEqual(["A", "B", "C", "D", "E", "F"]);

    // Left-pinned A clamped to left partition [0..1]
    list.moveColumn("A", 4);
    expect(list.getColumnOrder()).toEqual(["B", "A", "C", "D", "E", "F"]);

    // Unpinned D clamped to unpinned partition [2..3]
    list.moveColumn("D", 0);
    expect(list.getColumnOrder()).toEqual(["B", "A", "D", "C", "E", "F"]);

    // Alt+ArrowLeft on right-pinned E (index 4, left edge of right partition) stays at index 4
    const cellE = root.querySelector<HTMLElement>(
      '.vlist-table-header-cell[data-column-key="E"]',
    )!;
    cellE.focus();
    cellE.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnOrder()).toEqual(["B", "A", "D", "C", "E", "F"]);

    // Alt+ArrowRight on right-pinned E (index 4) moves E to index 5 (after F)
    cellE.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnOrder()).toEqual(["B", "A", "D", "C", "F", "E"]);
  });
});
