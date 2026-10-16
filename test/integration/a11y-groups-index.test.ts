/**
 * vlist — a11y() on a grouped list names the row it shows
 *
 * groups() renders one header entry per group, so the `data-index` it stamps
 * (and the element id it derives from it) is a LAYOUT index, and that is the
 * index it hands to the state function — `src/core/create.ts` documents the
 * same split where it resolves a click. a11y()'s own state is the DATA index:
 * `focus:change.index`, `selection:change.selected`, the live-region count and
 * `ctx.items.at()` all address items.
 *
 * Reading the DOM index as a data index therefore picked the item one header
 * further down (two in the second group): a click on the row showing "Item 3"
 * emitted the id of "Item 4". Comparing the data-space focus index against the
 * layout index the renderer passes put the focus ring one row above the item
 * `focus:change` named — so Enter selected an item other than the ringed one.
 *
 * selection() translates at this boundary (`_layoutToDataIndex`,
 * src/plugins/selection/plugin.ts), as does the ARIA position pass
 * (src/rendering/aria.ts). These tests pin the same translation for a11y()'s
 * click, keyboard and header-row paths, and that it stays a no-op on a list
 * with no layout plugin.
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

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const textOf = (el: Element | null): string =>
  (el?.textContent ?? "").trim().replace(/\s+/g, " ");

const groupsPlugin = () => groups<TestItem>({
  getGroupForIndex: (i) => (i < 50 ? "A" : "B"),
  header: { height: 32, template: (key) => key },
});

/** A built list owned by one test, so tests can run concurrently. */
interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** The rendered data row showing `label`, or undefined when not rendered. */
  row(label: string): HTMLElement | undefined;
  /** The first group header row. */
  headerRow(): HTMLElement | undefined;
  /** `focus:change` payloads seen so far. */
  readonly focuses: Array<{ index: number; id: string | number }>;
  /** `selection:change.selected` payloads seen so far. */
  readonly selections: Array<Array<string | number>>;
  /** Text of every row carrying `--focused` / `--selected`. */
  marked(cls: "focused" | "selected"): string[];
  /** Text of the row `aria-activedescendant` points at. */
  activeRowText(): string;
  press(key: string): void;
  dispose(): void;
}

async function build(plugins: VListPlugin<TestItem>[], count = 100): Promise<Fixture> {
  const container = createContainer({ width: 300, height: 400 });
  const list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 40, template: simpleTemplate } },
    plugins,
  );
  await tick(0);
  await tick(50);

  const focuses: Array<{ index: number; id: string | number }> = [];
  const selections: Array<Array<string | number>> = [];
  list.on("focus:change", (e) => focuses.push({ index: e.index, id: e.id as string | number }));
  list.on("selection:change", (e) => selections.push([...e.selected]));

  const content = container.querySelector(".vlist-content") as HTMLElement;
  return {
    list,
    container,
    row(label: string): HTMLElement | undefined {
      // Headers are role=presentation; only data rows carry the option role.
      const rows = [...container.querySelectorAll('[role="option"]')] as HTMLElement[];
      return rows.find((r) => textOf(r) === label);
    },
    headerRow(): HTMLElement | undefined {
      return container.querySelector(`.vlist-group-header`) as HTMLElement | null ?? undefined;
    },
    focuses,
    selections,
    marked(cls: "focused" | "selected"): string[] {
      return [...container.querySelectorAll(`.vlist-item--${cls}`)].map(textOf);
    },
    activeRowText(): string {
      const id = content.getAttribute("aria-activedescendant");
      return id ? textOf(container.querySelector(`[id="${id}"]`)) : "";
    },
    press(key: string): void {
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("a11y — index spaces on a grouped list", () => {
  // document.activeElement (every click and key press lands focus through
  // a11y()) and the HTMLElement.prototype geometry getters mocked in beforeAll
  // are process globals, so the tests run one at a time.
  it.serial("selects the item the clicked row shows", async () => {
    const f = await build([groupsPlugin(), a11y()]);
    try {
      const row = f.row("Item 3");
      expect(row).toBeDefined();
      // The row's own index space: one header above the third item.
      expect(row!.getAttribute("data-index")).toBe("3");

      row!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await tick(0);
      await tick(0);

      // "Item 3" is the item with id 3 — the one the clicked row shows.
      expect(f.selections).toEqual([[3]]);
      expect(f.marked("selected")).toEqual(["Item 3"]);
    } finally {
      f.dispose();
    }
  });

  it.serial("keeps the focus ring and aria-activedescendant on the item focus:change names", async () => {
    const f = await build([groupsPlugin(), a11y()]);
    try {
      f.press("ArrowDown");
      await tick(0);
      f.press("ArrowDown");
      await tick(0);

      // Second ArrowDown: the first item of the list (data index 1, id 2).
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 1, id: 2 });
      expect(f.marked("focused")).toEqual(["Item 2"]);
      expect(f.activeRowText()).toBe("Item 2");
    } finally {
      f.dispose();
    }
  });

  it.serial("counts items, not headers, so End reaches the last one", async () => {
    const f = await build([groupsPlugin(), a11y()]);
    try {
      f.press("End");
      await tick(0);

      // Item 100 is data index 99 with id 100: the item count this plugin
      // navigates by, not the count of rendered entries.
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 99, id: 100 });
    } finally {
      f.dispose();
    }
  });

  it.serial("counts items, not layout entries, in table mode", async () => {
    // table() paints one row per layout entry, header rows included, so
    // groups() lifts the engine total to the entry count. Navigating by that
    // count puts End past the data, where no item answers and no event fires.
    const f = await build([
      groupsPlugin(),
      table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
      a11y(),
    ]);
    try {
      await tick(50);
      f.press("End");
      await tick(0);
      await tick(50);

      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 99, id: 100 });
    } finally {
      f.dispose();
    }
  });

  it.serial("does not treat a group header as a click target", async () => {
    const f = await build([groupsPlugin(), a11y()]);
    try {
      const header = f.headerRow();
      expect(header).toBeDefined();

      header!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await tick(0);
      await tick(0);

      // The header maps to no item: no selection, and nothing rings.
      expect(f.selections).toEqual([]);
      expect(f.marked("selected")).toEqual([]);
    } finally {
      f.dispose();
    }
  });

  it.serial("stays a no-op on a list with no layout plugin", async () => {
    const f = await build([a11y()]);
    try {
      const row = f.row("Item 3");
      expect(row).toBeDefined();
      expect(row!.getAttribute("data-index")).toBe("2");

      row!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await tick(0);
      await tick(0);

      expect(f.selections).toEqual([[3]]);
      expect(f.marked("selected")).toEqual(["Item 3"]);
    } finally {
      f.dispose();
    }
  });
});
