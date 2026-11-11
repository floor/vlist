/**
 * vlist — rowAttributes() feature tests
 *
 * - Opt-in: a plain table never decorates rows
 * - Mount: built-in classes plus the record's class, and its attributes
 * - Pool recycling: a row that takes another item drops the previous record
 * - Group headers: never decorated, and a recycled data row is stripped
 * - Selection: the user class survives the state pass; the callback does not re-run
 * - updateItem: re-runs the callback and removes attributes the new record drops
 * - Reserved names: built-ins win
 * - Placeholders: decorated, built-in placeholder class kept
 * - Composition with columnPin() and columnReorder() in both feature orders
 * - clear()/destroy() with the feature mounted
 */

import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import { table } from "../../../src/plugins/table/plugin";
import { rowAttributes } from "../../../src/plugins/table/rowAttributes";
import { columnPin, type ColumnPinMethods } from "../../../src/plugins/table/pin";
import {
  columnReorder,
  type ColumnReorderMethods,
} from "../../../src/plugins/table/reorder";
import { selection, type SelectionMethods } from "../../../src/plugins/selection/plugin";
import { groups } from "../../../src/plugins/groups/plugin";
import type { TableFeature } from "../../../src/plugins/table/feature";
import type { TableMethods } from "../../../src/plugins/table/plugin";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import type { TableColumn, RowAttributes } from "../../../src/plugins/table/types";

// =============================================================================
// DOM & Geometry Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 300; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 400; },
    configurable: true,
  });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

// =============================================================================
// Items & Columns
// =============================================================================

type RowItem = VListItem & {
  id: number | string;
  A: string;
  state?: "warn" | "ok" | undefined;
};

const makeItems = (count: number): RowItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, A: `A${i}` }));

const COLUMNS: TableColumn<RowItem>[] = [
  { key: "A", label: "A", width: 200 },
  { key: "id", label: "Id", width: 100 },
];

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 40;

type RowTableMethods = TableMethods<RowItem> & SelectionMethods<RowItem>;
type RowTable = VList<RowItem> & RowTableMethods;

let activeContainer: HTMLElement | null = null;
let activeList: VList<RowItem> | null = null;

afterEach(() => {
  activeList?.destroy();
  activeList = null;
  activeContainer?.remove();
  activeContainer = null;
});

interface BuildOptions {
  items?: RowItem[];
  features?: readonly TableFeature<RowItem>[];
  plugins?: Parameters<typeof createVList<RowItem>>[1];
}

function build(opts: BuildOptions = {}): {
  list: RowTable;
  root: HTMLElement;
  viewport: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  activeContainer = container;

  const items = opts.items ?? makeItems(30);
  const list = createVList<RowItem>(
    {
      container,
      items,
      item: { height: ROW_HEIGHT, template: (item: RowItem) => item.A },
    },
    [
      table<RowItem>({
        columns: COLUMNS,
        rowHeight: ROW_HEIGHT,
        headerHeight: HEADER_HEIGHT,
        fillWidth: false,
        features: opts.features ?? [],
      }),
      ...(opts.plugins ?? []),
    ],
  );
  activeList = list;

  const root = container.querySelector<HTMLElement>(".vlist")!;
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  return { list: list as RowTable, root, viewport };
}

const dataRows = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.vlist-table-row[role="row"]'));

const headerRows = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.vlist-table-row[role="presentation"]'));

const rowAt = (root: HTMLElement, index: number): HTMLElement | null =>
  root.querySelector<HTMLElement>(`.vlist-table-row[data-index="${index}"]`);

const warnRecord = (item: RowItem): RowAttributes | void =>
  item.id === 2
    ? { class: "row-warn", attrs: { "data-state": "warn", "aria-label": "Row 2" } }
    : undefined;

// =============================================================================
// Mount
// =============================================================================

describe("rowAttributes — mount", () => {
  it("adds the record's class after the built-in classes and its attributes", () => {
    const { root } = build({ features: [rowAttributes(warnRecord)] });

    const row = rowAt(root, 1)!;
    expect(row).not.toBeNull();
    expect(row.classList.contains("vlist-item")).toBe(true);
    expect(row.classList.contains("vlist-table-row")).toBe(true);
    expect(row.classList.contains("row-warn")).toBe(true);
    expect(row.getAttribute("data-state")).toBe("warn");
    expect(row.getAttribute("aria-label")).toBe("Row 2");

    const plain = rowAt(root, 0)!;
    expect(plain.classList.contains("row-warn")).toBe(false);
    expect(plain.hasAttribute("data-state")).toBe(false);
  });

  it("passes the item and its layout index to the callback", () => {
    const seen: Array<[number | string, number]> = [];
    const { root } = build({
      features: [
        rowAttributes((item, index) => {
          seen.push([item.id, index]);
        }),
      ],
    });

    expect(rowAt(root, 0)).not.toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContainEqual([1, 0]);
    expect(seen).toContainEqual([2, 1]);
  });

  it("does not decorate rows of a table without the feature", () => {
    const { root } = build();
    const row = rowAt(root, 1)!;
    expect(row.classList.contains("row-warn")).toBe(false);
    expect(row.hasAttribute("data-state")).toBe(false);
  });
});

// =============================================================================
// Pool recycling
// =============================================================================

describe("rowAttributes — pool recycling", () => {
  it("drops the previous item's attributes when a pooled row takes another item", () => {
    const record = (item: RowItem): RowAttributes =>
      Number(item.id) <= 60
        ? { attrs: { "data-low": String(item.id) } }
        : { attrs: { "data-high": String(item.id) } };
    const { root, viewport } = build({
      items: makeItems(200),
      features: [rowAttributes(record)],
    });

    const rowAtStart = rowAt(root, 5)!;
    expect(rowAtStart.getAttribute("data-low")).toBe("6");
    expect(rowAtStart.hasAttribute("data-high")).toBe(false);

    // One render releases the previous window's rows into the pool *after* the
    // new rows are mounted; the next render re-acquires them for other items.
    viewport.scrollTop = 1200;
    viewport.dispatchEvent(new Event("scroll"));
    const reused = rowAt(root, 30)!;
    expect(reused).not.toBeNull();

    viewport.scrollTop = 2400;
    viewport.dispatchEvent(new Event("scroll"));
    viewport.scrollTop = 3600;
    viewport.dispatchEvent(new Event("scroll"));
    expect(reused.isConnected).toBe(true);
    expect(reused.getAttribute("data-index")).not.toBe("30");

    // Every re-acquired row carries the record of the item it now shows, and
    // nothing from the item it showed before.
    for (const row of dataRows(root)) {
      const id = Number(row.getAttribute("data-id"));
      const low = id <= 60;
      expect(row.getAttribute(low ? "data-low" : "data-high")).toBe(String(id));
      expect(row.hasAttribute(low ? "data-high" : "data-low")).toBe(false);
    }

    // Scrolling back re-decorates the original item.
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
    expect(rowAt(root, 5)!.getAttribute("data-low")).toBe("6");
  });
});

// =============================================================================
// Group headers
// =============================================================================

describe("rowAttributes — group headers", () => {
  const makeGroupedTable = (
    fn: (item: RowItem, index: number) => RowAttributes | void,
  ) => build({
    items: makeItems(30),
    features: [rowAttributes(fn)],
    plugins: [
      groups<RowItem>({
        getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
        header: { height: HEADER_HEIGHT, template: (key) => `<span>${key}</span>` },
      }),
    ],
  });

  it("decorates data rows and never a group header", async () => {
    const seen: Array<number | string> = [];
    const { root } = makeGroupedTable((item) => {
      seen.push(item.id);
      return { class: "row-user", attrs: { "data-user": String(item.id) } };
    });
    // groups() publishes its layout-space accessor from a microtask and paints then.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(headerRows(root).length).toBeGreaterThan(0);
    for (const header of headerRows(root)) {
      expect(header.classList.contains("row-user")).toBe(false);
      expect(header.hasAttribute("data-user")).toBe(false);
    }
    for (const row of dataRows(root)) {
      expect(row.classList.contains("row-user")).toBe(true);
      expect(row.getAttribute("data-user")).toBe(String(row.getAttribute("data-id")));
    }
    // The callback only ever saw data items, never a group header pseudo-item.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((id) => typeof id === "number")).toBe(true);
  });

  it("strips a recycled data row that becomes a group header", async () => {
    const { root, viewport } = makeGroupedTable((item) => ({
      class: "row-user",
      attrs: { "data-user": String(item.id) },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = dataRows(root);
    expect(before.length).toBeGreaterThan(0);

    // Leave the second group's header behind, then return: it re-enters the
    // window by re-acquiring an element the pool holds from a data row.
    viewport.scrollTop = 1000;
    viewport.dispatchEvent(new Event("scroll"));
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event("scroll"));

    for (const header of headerRows(root)) {
      expect(header.classList.contains("row-user")).toBe(false);
      expect(header.hasAttribute("data-user")).toBe(false);
    }
    for (const row of dataRows(root)) {
      expect(row.classList.contains("row-user")).toBe(true);
    }
  });
});

// =============================================================================
// State changes
// =============================================================================

describe("rowAttributes — state changes", () => {
  it("keeps the user class through a selection flip without re-running the callback", () => {
    let calls = 0;
    const fn = (item: RowItem): RowAttributes | void => {
      calls++;
      return item.id === 2 ? { class: "row-warn", attrs: { "data-state": "warn" } } : undefined;
    };
    const { list, root } = build({
      features: [rowAttributes(fn)],
      plugins: [selection<RowItem>()],
    });

    const row = rowAt(root, 1)!;
    expect(row.classList.contains("row-warn")).toBe(true);
    const before = calls;

    list.select(2);

    const selected = rowAt(root, 1)!;
    expect(selected.classList.contains("vlist-item--selected")).toBe(true);
    expect(selected.classList.contains("row-warn")).toBe(true);
    expect(selected.getAttribute("data-state")).toBe("warn");
    expect(calls).toBe(before);

    list.deselect(2);
    const cleared = rowAt(root, 1)!;
    expect(cleared.classList.contains("vlist-item--selected")).toBe(false);
    expect(cleared.classList.contains("row-warn")).toBe(true);
    expect(cleared.getAttribute("data-state")).toBe("warn");
    expect(calls).toBe(before);
  });

  it("re-runs the callback on updateItem and removes attributes the new record drops", () => {
    let calls = 0;
    const fn = (item: RowItem): RowAttributes | void => {
      calls++;
      return item.state === "warn"
        ? { class: "row-warn", attrs: { "data-state": "warn" } }
        : item.state === "ok"
          ? { attrs: { "data-state": "ok" } }
          : undefined;
    };
    const items = makeItems(30);
    items[1]!.state = "warn";
    const { list, root } = build({ items, features: [rowAttributes(fn)] });

    const row = rowAt(root, 1)!;
    expect(row.classList.contains("row-warn")).toBe(true);
    expect(row.getAttribute("data-state")).toBe("warn");
    const before = calls;

    list.updateItem(2, { state: "ok" });

    const updated = rowAt(root, 1)!;
    expect(calls).toBe(before + 1);
    expect(updated.classList.contains("row-warn")).toBe(false);
    expect(updated.getAttribute("data-state")).toBe("ok");

    // A record that drops the attribute altogether removes it.
    list.updateItem(2, { state: undefined });
    expect(rowAt(root, 1)!.hasAttribute("data-state")).toBe(false);
  });
});

// =============================================================================
// Reserved names
// =============================================================================

describe("rowAttributes — reserved names", () => {
  it("never overrides id, role, data-index, data-id, aria-rowindex, aria-selected", () => {
    const { root } = build({
      features: [
        rowAttributes(() => ({
          attrs: {
            id: "user-id",
            role: "article",
            "data-index": "9",
            "data-id": "user",
            "aria-rowindex": "99",
            "aria-selected": "true",
            "data-ok": "kept",
          },
        })),
      ],
    });

    const row = rowAt(root, 0)!;
    const item = row.getAttribute("data-id");
    expect(row.id).not.toBe("user-id");
    expect(row.getAttribute("role")).toBe("row");
    expect(row.getAttribute("data-index")).toBe("0");
    expect(item).toBe("1");
    expect(row.getAttribute("aria-rowindex")).toBe("2");
    expect(row.getAttribute("aria-selected")).not.toBe("true");
    expect(row.getAttribute("data-ok")).toBe("kept");
  });
});

// =============================================================================
// Placeholders
// =============================================================================

describe("rowAttributes — placeholders", () => {
  it("decorates a placeholder row and keeps its built-in class", () => {
    const items: RowItem[] = [
      { id: 1, A: "A0" },
      { id: "__placeholder_1", A: "loading" },
    ];
    const { root } = build({
      items,
      features: [
        rowAttributes((item) => ({
          class: "row-loading",
          attrs: { "data-loading": String(item.id) },
        })),
      ],
    });

    const row = rowAt(root, 1)!;
    expect(row.classList.contains("vlist-item--placeholder")).toBe(true);
    expect(row.classList.contains("row-loading")).toBe(true);
    expect(row.getAttribute("data-loading")).toBe("__placeholder_1");
  });
});

// =============================================================================
// Composition
// =============================================================================

describe("rowAttributes — composition", () => {
  it("works with columnPin() in both orders", () => {
    for (const features of [
      [columnPin<RowItem>(), rowAttributes(warnRecord)],
      [rowAttributes(warnRecord), columnPin<RowItem>()],
    ] as const) {
      const { list, root } = build({ features });
      expect(rowAt(root, 1)!.getAttribute("data-state")).toBe("warn");
      expect((list as unknown as ColumnPinMethods).getColumnPins()).toEqual({});
      activeList?.destroy();
      activeList = null;
      activeContainer?.remove();
      activeContainer = null;
    }
  });

  it("works with columnReorder() in both orders", () => {
    for (const features of [
      [columnReorder<RowItem>(), rowAttributes(warnRecord)],
      [rowAttributes(warnRecord), columnReorder<RowItem>()],
    ] as const) {
      const { list, root } = build({ features });
      expect(rowAt(root, 1)!.getAttribute("data-state")).toBe("warn");
      expect((list as unknown as ColumnReorderMethods).getColumnOrder()).toEqual(["A", "id"]);
      activeList?.destroy();
      activeList = null;
      activeContainer?.remove();
      activeContainer = null;
    }
  });
});

// =============================================================================
// clear() / destroy()
// =============================================================================

describe("rowAttributes — clear and destroy", () => {
  it("destroys without throwing and decorates a following mount", () => {
    const first = build({ features: [rowAttributes(warnRecord)] });
    expect(rowAt(first.root, 1)!.getAttribute("data-state")).toBe("warn");
    expect(() => first.list.destroy()).not.toThrow();
    activeList = null;
    activeContainer?.remove();
    activeContainer = null;

    const second = build({ features: [rowAttributes(warnRecord)] });
    expect(rowAt(second.root, 1)!.getAttribute("data-state")).toBe("warn");
  });
});
