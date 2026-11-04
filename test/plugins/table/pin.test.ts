/**
 * vlist — Table Column Pin Plugin Tests (#116)
 *
 * Tests for columnPin() plugin:
 * - Validation when used without table()
 * - Initial left/right pin partitioning ([...left, ...unpinned, ...right])
 * - Runtime setColumnPin / getColumnPins and original unpinned position restoration
 * - CSS variable updates (--vlist-table-pin-left / --vlist-table-pin-right) on scroll & resize
 * - Header & body cell pin classes across virtualized scroll and updateColumns
 * - Header keyboard focus clearance and Shift+Alt+ArrowLeft/Right pin shortcut
 */

import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import { table } from "../../../src/plugins/table/plugin";
import { columnPin, type ColumnPinMethods } from "../../../src/plugins/table/pin";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import type { TableColumn, ColumnPinEvent } from "../../../src/plugins/table/types";
import type { TableMethods } from "../../../src/plugins/table/plugin";
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
  G: string;
  H: string;
  I: string;
  J: string;
}

const KEYS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

function makeItems(count: number): RowItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    A: `A${i}`,
    B: `B${i}`,
    C: `C${i}`,
    D: `D${i}`,
    E: `E${i}`,
    F: `F${i}`,
    G: `G${i}`,
    H: `H${i}`,
    I: `I${i}`,
    J: `J${i}`,
  }));
}

function makeColumns(
  pins: Partial<Record<(typeof KEYS)[number], "left" | "right">> = {},
  width = 100,
): TableColumn<RowItem>[] {
  return KEYS.map((key) => ({
    key,
    label: `Col ${key}`,
    width,
    sortable: true,
    ...(pins[key] ? { pin: pins[key] } : {}),
  }));
}

let activeContainer: HTMLElement | null = null;
let activeList: (VList<RowItem> & TableMethods<RowItem> & ColumnPinMethods) | null = null;

afterEach(() => {
  activeList?.destroy();
  activeList = null;
  activeContainer?.remove();
  activeContainer = null;
});

function createPinnedTable(
  columns: TableColumn<RowItem>[],
  pinConfig?: { pins?: Record<string, "left" | "right"> },
  itemCount = 30,
  reversePluginOrder = false,
): {
  list: VList<RowItem> & TableMethods<RowItem> & ColumnPinMethods;
  container: HTMLElement;
  root: HTMLElement;
  viewport: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  activeContainer = container;

  const tPlugin = table<RowItem>({
    columns,
    rowHeight: 40,
    headerHeight: 40,
    fillWidth: false,
  });
  const pPlugin = columnPin<RowItem>(pinConfig);

  const list = createVList(
    {
      container,
      items: makeItems(itemCount),
      item: { height: 40, template: (item: RowItem) => item.A },
    },
    reversePluginOrder ? [pPlugin, tPlugin] : [tPlugin, pPlugin],
  ) as unknown as VList<RowItem> & TableMethods<RowItem> & ColumnPinMethods;

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

describe("columnPin — validation and setup", () => {
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
        [columnPin<RowItem>()],
      ),
    ).toThrow("[vlist] columnPin: requires table() plugin");
  });

  it("throws a clear error when setup() is called directly without table()", () => {
    const mock = createPluginMockContext<RowItem>(makeItems(5));
    try {
      expect(() => columnPin<RowItem>().setup!(mock.ctx)).toThrow(
        "[vlist] columnPin: requires table() plugin",
      );
    } finally {
      mock.cleanup();
    }
  });

  it("works in either plugin order ([table(), columnPin()] or [columnPin(), table()])", () => {
    const { list, root } = createPinnedTable(
      makeColumns({ B: "left", I: "right" }),
      undefined,
      10,
      true,
    );
    expect(list.getColumnPins()).toEqual({ B: "left", I: "right" });
    expect(getHeaderOrder(root)).toEqual(["B", "A", "C", "D", "E", "F", "G", "H", "J", "I"]);
  });
});

// =============================================================================
// Partitioning & Runtime Pin / Unpin (#116)
// =============================================================================

describe("columnPin — partitioning and unpin restoration (#116)", () => {
  it("partitions initial pins from TableColumn.pin and columnPin({ pins })", () => {
    const { list, root } = createPinnedTable(
      makeColumns({ B: "left", I: "right" }),
      { pins: { D: "left" } },
    );

    expect(list.getColumnPins()).toEqual({ B: "left", D: "left", I: "right" });
    expect(getHeaderOrder(root)).toEqual(["B", "D", "A", "C", "E", "F", "G", "H", "J", "I"]);
    expect(root.classList.contains("vlist--table-pinned")).toBe(true);

    const headerCells = root.querySelectorAll<HTMLElement>(".vlist-table-header-cell");
    expect(headerCells[0]!.classList.contains("vlist-table-header-cell--pin-left")).toBe(true);
    expect(headerCells[0]!.classList.contains("vlist-table-header-cell--pin-left-last")).toBe(false);
    expect(headerCells[1]!.classList.contains("vlist-table-header-cell--pin-left")).toBe(true);
    expect(headerCells[1]!.classList.contains("vlist-table-header-cell--pin-left-last")).toBe(true);
    expect(headerCells[2]!.classList.contains("vlist-table-header-cell--pin-left")).toBe(false);
    expect(headerCells[9]!.classList.contains("vlist-table-header-cell--pin-right")).toBe(true);
    expect(headerCells[9]!.classList.contains("vlist-table-header-cell--pin-right-first")).toBe(true);

    const firstRowCells = root.querySelectorAll<HTMLElement>('.vlist-table-row[data-index="0"] .vlist-table-cell');
    expect(firstRowCells[0]!.textContent).toBe("B0");
    expect(firstRowCells[1]!.textContent).toBe("D0");
    expect(firstRowCells[2]!.textContent).toBe("A0");
    expect(firstRowCells[9]!.textContent).toBe("I0");
    expect(firstRowCells[0]!.classList.contains("vlist-table-cell--pin-left")).toBe(true);
    expect(firstRowCells[1]!.classList.contains("vlist-table-cell--pin-left-last")).toBe(true);
    expect(firstRowCells[9]!.classList.contains("vlist-table-cell--pin-right-first")).toBe(true);
  });

  it("restores unpinned columns to their exact original unpinned neighbor position (A–J scenario)", () => {
    const { list, root } = createPinnedTable(makeColumns());
    const events: ColumnPinEvent[] = [];
    list.on("column:pin", (ev) => events.push(ev));

    expect(getHeaderOrder(root)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    expect(root.classList.contains("vlist--table-pinned")).toBe(false);

    // Pin B to left, then D to left, then I to right
    list.setColumnPin("B", "left");
    list.setColumnPin("D", "left");
    list.setColumnPin("I", "right");

    expect(getHeaderOrder(root)).toEqual(["B", "D", "A", "C", "E", "F", "G", "H", "J", "I"]);
    expect(list.getColumnPins()).toEqual({ B: "left", D: "left", I: "right" });

    // Unpin D -> returns between C and E!
    list.setColumnPin("D", null);
    expect(getHeaderOrder(root)).toEqual(["B", "A", "C", "D", "E", "F", "G", "H", "J", "I"]);
    expect(list.getColumnPins()).toEqual({ B: "left", I: "right" });

    // Unpin B and I -> full original A..J order restored!
    list.setColumnPin("B", null);
    list.setColumnPin("I", null);
    expect(getHeaderOrder(root)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    expect(list.getColumnPins()).toEqual({});
    expect(root.classList.contains("vlist--table-pinned")).toBe(false);
    expect(root.style.getPropertyValue("--vlist-table-pin-left")).toBe("");
    expect(root.style.getPropertyValue("--vlist-table-pin-right")).toBe("");

    expect(events).toHaveLength(6);
    expect(events[3]).toEqual({
      key: "D",
      index: 3,
      pin: null,
      pins: { B: "left", I: "right" },
      order: ["B", "A", "C", "D", "E", "F", "G", "H", "J", "I"],
    });
  });

  it("supports setColumnPin by resolved column index and ignores unknown keys", () => {
    const { list, root } = createPinnedTable(makeColumns());

    // Index 2 is "C"
    list.setColumnPin(2, "left");
    expect(getHeaderOrder(root)).toEqual(["C", "A", "B", "D", "E", "F", "G", "H", "I", "J"]);

    // Unknown key is a no-op
    list.setColumnPin("NON_EXISTENT", "left");
    expect(getHeaderOrder(root)).toEqual(["C", "A", "B", "D", "E", "F", "G", "H", "I", "J"]);
  });
});

// =============================================================================
// Scroll, Resize & Virtualization Sync
// =============================================================================

describe("columnPin — scroll offsets, resize, and virtualized rows", () => {
  it("updates --vlist-table-pin-left and --vlist-table-pin-right on horizontal scroll and column resize", () => {
    // 10 columns * 100px = 1000px totalWidth, viewport clientWidth = 400px
    const { list, root, viewport } = createPinnedTable(makeColumns({ A: "left", J: "right" }));

    // At scrollLeft = 0: left offset = 0px, right offset = 0 + 400 - 1000 = -600px
    expect(root.style.getPropertyValue("--vlist-table-pin-left")).toBe("0px");
    expect(root.style.getPropertyValue("--vlist-table-pin-right")).toBe("-600px");

    // Scroll horizontally to 250px
    viewport.scrollLeft = 250;
    viewport.dispatchEvent(new Event("scroll"));
    expect(root.style.getPropertyValue("--vlist-table-pin-left")).toBe("250px");
    expect(root.style.getPropertyValue("--vlist-table-pin-right")).toBe("-350px");

    // Resize column B from 100px to 200px -> totalWidth becomes 1100px
    list.resizeColumn("B", 200);
    expect(root.style.getPropertyValue("--vlist-table-pin-right")).toBe("-450px");

    // Pinning another column preserves B's resized 200px width
    list.setColumnPin("C", "left");
    expect(list.getColumnWidths().B).toBe(200);
  });

  it("stamps pin classes on newly mounted rows during vertical scroll", () => {
    const { root, viewport } = createPinnedTable(makeColumns({ A: "left", J: "right" }), undefined, 50);

    // Scroll down to row 25 (25 * 40 = 1000px)
    viewport.scrollTop = 1000;
    viewport.dispatchEvent(new Event("scroll"));

    const row25Cells = root.querySelectorAll<HTMLElement>(
      '.vlist-table-row[data-index="25"] .vlist-table-cell',
    );
    expect(row25Cells.length).toBe(10);
    expect(row25Cells[0]!.classList.contains("vlist-table-cell--pin-left")).toBe(true);
    expect(row25Cells[0]!.classList.contains("vlist-table-cell--pin-left-last")).toBe(true);
    expect(row25Cells[9]!.classList.contains("vlist-table-cell--pin-right")).toBe(true);
    expect(row25Cells[9]!.classList.contains("vlist-table-cell--pin-right-first")).toBe(true);
  });

  it("re-partitions synchronously when list.updateColumns() is called", () => {
    const { list, root } = createPinnedTable(makeColumns({ A: "left" }));
    expect(getHeaderOrder(root)[0]).toBe("A");

    const nextCols = makeColumns({ E: "left", H: "right" });
    list.updateColumns(nextCols);

    expect(list.getColumnPins()).toEqual({ E: "left", H: "right" });
    expect(getHeaderOrder(root)).toEqual(["E", "A", "B", "C", "D", "F", "G", "I", "J", "H"]);

    const headerCells = root.querySelectorAll<HTMLElement>(".vlist-table-header-cell");
    expect(headerCells[0]!.dataset.pin).toBe("left");
    expect(headerCells[9]!.dataset.pin).toBe("right");
  });
});

// =============================================================================
// Keyboard Accessibility (Focus Clearance & Shift+Alt+ArrowLeft/Right)
// =============================================================================

describe("columnPin — keyboard accessibility", () => {
  it("scrolls unpinned header cells clear of left and right pinned columns on focus", () => {
    // 10 columns * 100px = 1000px, viewportWidth = 400px
    // A (0..100) pinned left (leftWidth = 100)
    // J (900..1000) pinned right (rightWidth = 100)
    // Visible unpinned window at scrollLeft is [scrollLeft + 100, scrollLeft + 300]
    const { root, viewport } = createPinnedTable(makeColumns({ A: "left", J: "right" }));
    const headerCells = root.querySelectorAll<HTMLElement>(".vlist-table-header-cell");

    // Scroll to 150px -> visible unpinned window is [250, 450]
    viewport.scrollLeft = 150;
    viewport.dispatchEvent(new Event("scroll"));

    // Focus B (offset 100..200, obscured under left-pinned A) -> scrollLeft becomes 100 - 100 = 0
    headerCells[1]!.focus();
    expect(viewport.scrollLeft).toBe(0);

    // Focus F (index 5, offset 500..600, obscured under right-pinned J)
    // scrollLeft becomes 600 - (400 - 100) = 300
    headerCells[5]!.focus();
    expect(viewport.scrollLeft).toBe(300);

    // Focusing pinned column A does not change scrollLeft
    headerCells[0]!.focus();
    expect(viewport.scrollLeft).toBe(300);
  });

  it("toggles left/right pin via Shift+Alt+ArrowLeft and Shift+Alt+ArrowRight on focused header cell", () => {
    const { list, root } = createPinnedTable(makeColumns());

    const cellC = root.querySelector<HTMLElement>('.vlist-table-header-cell[data-column-key="C"]')!;
    cellC.focus();

    // Shift+Alt+ArrowLeft pins C to left
    cellC.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        shiftKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnPins()).toEqual({ C: "left" });
    expect(getHeaderOrder(root)[0]).toBe("C");

    // Shift+Alt+ArrowRight on left-pinned C unpins it back between B and D
    const movedC = root.querySelector<HTMLElement>('.vlist-table-header-cell[data-column-key="C"]')!;
    movedC.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnPins()).toEqual({});
    expect(getHeaderOrder(root)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);

    // Shift+Alt+ArrowRight on unpinned C pins it to right
    const unpinnedC = root.querySelector<HTMLElement>('.vlist-table-header-cell[data-column-key="C"]')!;
    unpinnedC.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.getColumnPins()).toEqual({ C: "right" });
    expect(getHeaderOrder(root)[9]).toBe("C");
  });
});
