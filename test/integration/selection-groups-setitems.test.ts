/**
 * vlist — selection() keeps its focus on the item, not the row, across setItems
 *
 * groups() paints one header entry per group and selection() keeps its focus
 * index in that LAYOUT space (`state.focusedIndex`). When `setItems` changes
 * the number of groups, every layout index after the new header moves: the
 * stored index now points at a neighbouring item. a11y() keeps the DATA index
 * and stays on the item. The user sees the ring arrive on one item and Enter
 * select it, while `focus:change` still names the item that was focused before
 * the reload.
 *
 * This test pins the focused item across a `setItems` that inserts a group
 * header above it.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
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
  /** `focus:change` payloads seen so far. */
  readonly focuses: Array<{ index: number; id: string | number }>;
  /** `selection:change.selected` payloads seen so far. */
  readonly selections: Array<Array<string | number>>;
  /** Text of every row carrying `--focused`. */
  marked(cls: "focused" | "selected"): string[];
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
    focuses,
    selections,
    marked(cls: "focused" | "selected"): string[] {
      return [...container.querySelectorAll(`.vlist-item--${cls}`)].map(textOf);
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

describe("selection() — setItems that inserts a group above the focus", () => {
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

      // A header now sits above Item 60, at layout index 31. selection()'s
      // stored layout index 60 paints the item that moved up into it.
      expect(f.marked("focused")).toEqual(["Item 60"]);

      f.press("Enter");
      await tick(0);
      expect(f.selections[f.selections.length - 1]).toEqual([60]);
    } finally {
      f.dispose();
    }
  });
});
