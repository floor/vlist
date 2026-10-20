/**
 * vlist — table() + groups() paint one index space, from the first frame on
 *
 * groups() interleaves a header entry per group between the data rows, and it
 * publishes the layout-space item accessor (`_getItemAtLayout`, which reads
 * `_getItem` in data space) from a microtask: data() claims the item getter at
 * priority 20, after groups() at 11, so wiring it during setup would be
 * overwritten. table() used to paint the synchronous first render in the
 * meantime. Its loop index is a LAYOUT index — `data-index`, the rendered id,
 * and every activator read it that way — but `items.at(i)` was still the
 * data-space getter, so the row showing "Item 2" carried data-index "1" and no
 * header rows existed at all. A click, Enter or Space in that window resolved
 * through the stale data-space index and landed one item off (issue #396).
 *
 * The fix holds the table's first paint until groups' accessor is in place;
 * the microtask then paints layout-space rows before the browser paints
 * anything. These tests pin both halves: nothing activatable before the
 * wiring, and the row under the pointer or ring names the item it shows after
 * it — including when an a11y key activation resolved its index spaces before
 * the microtask ran.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { table } from "../../src/plugins/table/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

/** Let the groups() setup microtasks run; no frame has painted yet. */
const settleLayout = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const textOf = (el: Element | null): string =>
  (el?.textContent ?? "").trim().replace(/\s+/g, " ");

const groupsPlugin = () => groups<TestItem>({
  getGroupForIndex: (i) => (i < 50 ? "A" : "B"),
  header: { height: 32, template: (key) => key },
});

const plugins = (): VListPlugin<TestItem>[] => [
  groupsPlugin(),
  table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
  a11y(),
];

/** A list created without yielding, so the first task is still open. */
interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** Data rows currently in the DOM, in DOM order. */
  rows(): HTMLElement[];
  /** The rendered data row showing `label`, or undefined when not rendered. */
  row(label: string): HTMLElement | undefined;
  /** The first group header row. */
  headerRow(): HTMLElement | undefined;
  /** `item:click` payloads seen so far. */
  readonly clicks: Array<{ index: number; id: string | number; name: string }>;
  /** `focus:change` payloads seen so far. */
  readonly focuses: Array<{ index: number; id: string | number }>;
  /** `selection:change.selected` payloads seen so far. */
  readonly selections: Array<Array<string | number>>;
  press(key: string): void;
  click(el: HTMLElement): void;
  dispose(): void;
}

function buildNow(): Fixture {
  const container = createContainer({ width: 300, height: 400 });
  const list = createVList<TestItem>(
    { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
    plugins(),
  );

  const clicks: Fixture["clicks"] = [];
  const focuses: Fixture["focuses"] = [];
  const selections: Fixture["selections"] = [];
  list.on("item:click", (e) => clicks.push({
    index: e.index,
    id: (e.item as TestItem).id,
    name: (e.item as TestItem).name,
  }));
  list.on("focus:change", (e) => focuses.push({ index: e.index, id: e.id as string | number }));
  list.on("selection:change", (e) => selections.push([...e.selected]));

  // Group headers are role=presentation and the column header row carries no
  // data-index; only rendered data rows carry both.
  const rows = (): HTMLElement[] =>
    [...container.querySelectorAll('[role="row"][data-index]')] as HTMLElement[];

  return {
    list,
    container,
    rows,
    row(label: string): HTMLElement | undefined {
      return rows().find((r) => textOf(r) === label);
    },
    headerRow(): HTMLElement | undefined {
      return container.querySelector(".vlist-table-group-header") as HTMLElement | null ?? undefined;
    },
    clicks,
    focuses,
    selections,
    press(key: string): void {
      const content = container.querySelector(".vlist-content") as HTMLElement;
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    },
    click(el: HTMLElement): void {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("table() + groups() — one index space from the first paint", () => {
  // The table header, the pool and a11y's focus are per-list; the geometry
  // getters are process globals, so the tests run one at a time.
  it.serial("holds the first paint until groups publishes its layout accessor", async () => {
    const f = buildNow();
    try {
      // The first task ends with the groups microtask. Until then there is no
      // row to activate: the data-space paint this used to make is what let an
      // activation read a data index as a layout index.
      expect(f.rows()).toHaveLength(0);

      await settleLayout();

      // Same task, layout space: the first group's header sits at entry 0 and
      // every data row carries the index it is painted at.
      expect(f.headerRow()?.getAttribute("data-index")).toBe("0");
      expect(f.row("Item 1")?.getAttribute("data-index")).toBe("1");
      expect(f.row("Item 2")?.getAttribute("data-index")).toBe("2");
    } finally {
      f.dispose();
    }
  });

  it.serial("an activation in the first task never names another item", async () => {
    const f = buildNow();
    try {
      // If the first task paints a row at all, activating it must name the item
      // the row shows. This is the reported repro: the row showing "Item 2"
      // carried data-index "1", and a click resolved to "Item 1".
      const two = f.rows().find((row) => textOf(row) === "Item 2");
      if (two) {
        f.click(two);
        expect(f.clicks[f.clicks.length - 1]).toEqual({ index: 1, id: 2, name: "Item 2" });
      }
      for (const row of f.rows()) {
        const shown = textOf(row);
        const before = f.clicks.length;
        f.click(row);
        expect(f.clicks).toHaveLength(before + 1);
        expect(f.clicks[before]?.name).toBe(shown);
      }

      await settleLayout();

      const row = f.row("Item 2");
      expect(row).toBeDefined();
      expect(row!.getAttribute("data-index")).toBe("2");
      f.click(row!);

      // "Item 2" is data index 1 with id 2, and that is what both the core
      // event and a11y's selection report.
      expect(f.clicks[f.clicks.length - 1]).toEqual({ index: 1, id: 2, name: "Item 2" });
      expect(f.selections[f.selections.length - 1]).toEqual([2]);
    } finally {
      f.dispose();
    }
  });

  it.serial("a key activation before the wiring does not pin a11y to data space", async () => {
    const f = buildNow();
    try {
      // Resolve a11y's index spaces in the first task, while the table-mode
      // accessor is still unpublished; the first item is data index 0, id 1.
      f.press("ArrowDown");
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 0, id: 1 });

      await settleLayout();

      // The accessor and the grouped item getter are in place now: the second
      // item is data index 1, id 2. A one-shot "table mode?" lookup would still
      // read the data-space getter here and name id 1 again.
      f.press("ArrowDown");
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 1, id: 2 });
    } finally {
      f.dispose();
    }
  });
});
