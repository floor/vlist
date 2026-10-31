/**
 * vlist — table() keeps the selection() ring on the item across a regroup
 *
 * table() replaces the render pipeline (ctx.render.setFn) and paints from the
 * `_getFocusedIndex()` hook it resolves itself; it never calls the per-row
 * state function selection() registers (src/plugins/table/plugin.ts,
 * core/create.ts). selection() keeps its focus index in the LAYOUT space
 * groups() paints, and the remap that follows a re-grouping `setItems` lives
 * in that state pass — so under table() the stored layout index stays on the
 * row that now paints the neighbouring item.
 *
 * This test pins the ring (and Enter) to the focused item when table() and
 * groups() paint a list whose grouping changes under the focus.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { table } from "../../src/plugins/table/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { selection } from "../../src/plugins/selection/plugin";

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

/** A built list owned by one test, so tests can run concurrently. */
interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** `selection:change.selected` payloads seen so far. */
  readonly selections: Array<Array<string | number>>;
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

  const selections: Array<Array<string | number>> = [];
  list.on("selection:change", (e) => selections.push([...e.selected]));

  const content = container.querySelector(".vlist-content") as HTMLElement;
  return {
    list,
    container,
    selections,
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

describe("table + selection() — setItems that inserts a group above the focus", () => {
  // document.activeElement (the keyboard path lands focus on the content) and
  // the HTMLElement.prototype geometry getters mocked in beforeAll are process
  // globals, so the tests run one at a time.
  it.serial("keeps the focused item focused and Enter selects it", async () => {
    // One group over the first list, two over the second: the reload puts a
    // header between the top of the list and the focused item.
    const shape = { split: 1000 };
    const f = await build([
      groups<TestItem>({
        getGroupForIndex: (i) => (i < shape.split ? "A" : "B"),
        header: { height: 32, template: (key) => key },
      }),
      table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
      selection({ mode: "single" }),
    ]);
    try {
      f.press("Home");
      await tick(0);
      for (let i = 0; i < 59; i++) f.press("ArrowDown");
      await tick(0);
      await tick(20);

      // Item 60 is focused: data index 59, id 60, the only group's row 60.
      expect(f.marked("focused")).toEqual(["Item 60"]);

      shape.split = 30;
      f.list.setItems(createTestItems(200));
      await tick(0);
      await tick(100);

      // At layout index 60 selection()'s stored index now paints Item 59;
      // the item it focused is at 61.
      expect(f.marked("focused")).toEqual(["Item 60"]);
      expect(f.activeRowText()).toBe("Item 60");

      f.press("Enter");
      await tick(0);
      expect(f.selections[f.selections.length - 1]).toEqual([60]);
    } finally {
      f.dispose();
    }
  });
});
