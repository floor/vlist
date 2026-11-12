/**
 * vlist — rowAttributes() over data() placeholders (sweep finding)
 *
 * The feature's callback is meant for loaded rows: an unloaded row paints a
 * placeholder, and the record is applied when the item arrives. Today the
 * renderer hands the callback the generated placeholder item, so every
 * placeholder row is painted with a record derived from masked data (its
 * class, and attributes naming the `__placeholder_<index>` id) before any
 * item exists. The load does replace the record afterwards, once per item.
 *
 * Reproduced from the real-browser sweep at main 7f2a1b5: 17 of 17
 * placeholder rows decorated, 31 callback invocations with placeholder ids.
 *
 * The mount-time unit test above ("placeholders: decorates a placeholder row")
 * asserts that same behaviour from a synthetic array; this file treats the
 * data()-driven case as the contract: a placeholder row gets nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import { table } from "../../../src/plugins/table/plugin";
import { rowAttributes } from "../../../src/plugins/table/rowAttributes";
import { data } from "../../../src/plugins/data";
import type { VListItem } from "../../../src/types";
import type { TableColumn } from "../../../src/plugins/table/types";

type RowItem = VListItem & { id: number | string; name: string };

const COLUMNS: TableColumn<RowItem>[] = [
  { key: "name", label: "Name", width: 200 },
  { key: "value", label: "Value", width: 180 },
];

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 340; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 460; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

const makeItems = (count: number, start: number): RowItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: start + i, name: `Row ${start + i}` }));

describe("rowAttributes — data() placeholders", () => {
  it("gives placeholder rows nothing until their chunk arrives", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const pending: Array<{ offset: number; limit: number; res: (value: unknown) => void }> = [];
    const adapter = {
      read: ({ offset, limit }: { offset: number; limit: number }) =>
        new Promise((res) => pending.push({ offset, limit, res })),
    };

    const calls: Array<string | number> = [];
    const list = createVList<RowItem>(
      { container, items: [], item: { height: 32, template: (item) => item.name } },
      [
        table<RowItem>({
          rowHeight: 32,
          headerHeight: 32,
          fillWidth: false,
          columns: COLUMNS,
          features: [
            rowAttributes<RowItem>((item) => {
              calls.push(item.id);
              return { class: "row-user", attrs: { "data-owner": String(item.id) } };
            }),
          ],
        }),
        data<RowItem>({ adapter, total: 400 }),
      ],
    );

    try {
      await tick();
      // First chunk: rows 1..100 are loaded; the rest of 400 stay placeholders.
      expect(pending.length).toBeGreaterThan(0);
      pending.shift()!.res({ items: makeItems(100, 1), total: 400, hasMore: true });
      await tick();

      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      viewport.scrollTop = 32 * 210;
      viewport.dispatchEvent(new Event("scroll"));
      await tick(120);

      const rows = Array.from(container.querySelectorAll<HTMLElement>('.vlist-table-row[role="row"]'));
      const placeholders = rows.filter((el) => el.classList.contains("vlist-item--placeholder"));
      expect(placeholders.length).toBeGreaterThan(0);

      // A placeholder is a row with no item yet: the callback must not have
      // been asked for one, and the row must carry nothing from a record.
      for (const el of placeholders) {
        expect(el.hasAttribute("data-owner")).toBe(false);
        expect(el.classList.contains("row-user")).toBe(false);
      }
      expect(calls.filter((id) => typeof id === "string")).toEqual([]);

      // The load that replaces them runs the callback once per real item, and
      // leaves no placeholder record behind.
      const staleIds = placeholders.map((el) => el.dataset.id);
      for (const read of pending.splice(0)) {
        read.res({ items: makeItems(read.limit, read.offset + 1), total: 400, hasMore: true });
      }
      await tick(120);
      const loaded = Array.from(container.querySelectorAll<HTMLElement>('.vlist-table-row[role="row"]'))
        .filter((el) => !el.classList.contains("vlist-item--placeholder") && Number.isFinite(Number(el.dataset.id)));
      expect(loaded.length).toBeGreaterThan(0);
      for (const el of loaded) {
        expect(el.getAttribute("data-owner")).toBe(el.dataset.id);
        expect(el.classList.contains("row-user")).toBe(true);
        expect(staleIds.includes(el.dataset.id)).toBe(false);
      }
      const perId = new Map<string | number, number>();
      for (const id of calls) if (typeof id === "number") perId.set(id, (perId.get(id) ?? 0) + 1);
      for (const [id, count] of perId) expect([id, count]).toEqual([id, 1]);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
