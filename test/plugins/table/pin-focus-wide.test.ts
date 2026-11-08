/**
 * A focused unpinned column that is wider than the gap between the pin
 * bands stays clear of the left pin. Clearance that aligns the column's
 * right edge scrolls its left edge under the left pin.
 */

import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import { table } from "../../../src/plugins/table/plugin";
import { columnPin, type ColumnPinMethods } from "../../../src/plugins/table/pin";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import type { TableColumn } from "../../../src/plugins/table/types";
import type { TableMethods } from "../../../src/plugins/table/plugin";

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

interface Row extends VListItem {
  id: number;
  wide: string;
}

let activeList: VList<Row> | null = null;
let activeContainer: HTMLElement | null = null;

afterEach(() => {
  activeList?.destroy();
  activeList = null;
  activeContainer?.remove();
  activeContainer = null;
});

describe("columnPin — focused column wider than the pin gap", () => {
  it("keeps the focused column's left edge clear of the left pin", () => {
    // Viewport 400. Left pin 100, two right pins 100 + 100, free gap 100.
    // The focused column is 140, so it cannot sit fully inside the gap.
    // Its left edge still has to stay at or after the left pin.
    const columns: TableColumn<Row>[] = [
      { key: "id", label: "ID", width: 100, pin: "left" },
      { key: "wide", label: "Wide", width: 140 },
      { key: "rightA", label: "Right A", width: 100, pin: "right" },
      { key: "rightB", label: "Right B", width: 100, pin: "right" },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeContainer = container;
    const items: Row[] = [{ id: 1, wide: "wide" }];
    const list = createVList(
      {
        container,
        items,
        item: { height: 36, template: (item: Row) => item.wide },
      },
      [table<Row>({
        columns,
        rowHeight: 36,
        headerHeight: 40,
        fillWidth: false,
        features: [columnPin<Row>()],
      })],
    ) as VList<Row> & TableMethods<Row> & ColumnPinMethods;
    activeList = list;

    const root = container.querySelector<HTMLElement>(".vlist")!;
    const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
    const wide = root.querySelector<HTMLElement>('.vlist-table-header-cell[data-column-key="wide"]')!;
    wide.focus();

    const leftPinWidth = 100;
    const wideOffset = 100;
    expect(wideOffset).toBeGreaterThanOrEqual(viewport.scrollLeft + leftPinWidth);
  });
});
