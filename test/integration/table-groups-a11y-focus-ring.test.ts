/**
 * vlist — table() rings the row a11y() names, with groups()
 *
 * table() paints one row per layout entry, header rows included, and marks the
 * row whose render index equals `_getFocusedIndex()` (src/plugins/table/plugin.ts,
 * src/plugins/table/renderer.ts). a11y() publishes that hook in the DATA index
 * — its state, `focus:change` and `aria-activedescendant` are all data-space
 * (src/plugins/a11y/plugin.ts) — so with groups() loaded the two numbers count
 * different spaces: every group header above the focused item shifts the ring
 * that many rows up, and on the first item the ring lands on a header row and
 * disappears. The row `aria-activedescendant` names and the row drawn as
 * focused are then different rows, and Enter acts on the one the screen reader
 * announced, not on the ring.
 *
 * These tests pin the ring for a11y() + groups() + table() to the row
 * `aria-activedescendant` names.
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
  /** `focus:change` payloads seen so far. */
  readonly focuses: Array<{ index: number; id: string | number }>;
  /** Text of every row carrying `--focused`. */
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
  list.on("focus:change", (e) => focuses.push({ index: e.index, id: e.id as string | number }));

  const content = container.querySelector(".vlist-content") as HTMLElement;
  return {
    list,
    container,
    focuses,
    marked(cls: "focused" | "selected"): string[] {
      return [...container.querySelectorAll(`.vlist-item--${cls}`)].map(textOf);
    },
    activeRowText(): string {
      const id = content.getAttribute("aria-activedescendant");
      return id ? textOf(container.querySelector(`[id="${id}"]`)) : "";
    },
    press(key: string): void {
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("table() + groups() + a11y() — the focus ring", () => {
  // document.activeElement (the keyboard path lands focus on the content) and
  // the HTMLElement.prototype geometry getters mocked in beforeAll are process
  // globals, so the tests run one at a time.
  it.serial("rings the first item once it is focused", async () => {
    const f = await build([
      groupsPlugin(),
      table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
      a11y(),
    ]);
    try {
      f.press("ArrowDown");
      await tick(0);
      await tick(20);

      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 0, id: 1 });
      // The first item is painted at layout index 1, behind the first header;
      // a11y's focus index is the data index 0, which table() reads as a
      // render index and finds on the header row.
      expect(f.activeRowText()).toBe("Item 1");
      expect(f.marked("focused")).toEqual(["Item 1"]);
    } finally {
      f.dispose();
    }
  });

  it.serial("rings the row it announces one step down", async () => {
    const f = await build([
      groupsPlugin(),
      table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
      a11y(),
    ]);
    try {
      f.press("ArrowDown");
      await tick(0);
      f.press("ArrowDown");
      await tick(0);
      await tick(20);

      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 1, id: 2 });
      expect(f.activeRowText()).toBe("Item 2");
      // Both read layout index 1, which paints "Item 1": one row above the
      // item a11y() focused and announced.
      expect(f.marked("focused")).toEqual(["Item 2"]);
    } finally {
      f.dispose();
    }
  });
});
