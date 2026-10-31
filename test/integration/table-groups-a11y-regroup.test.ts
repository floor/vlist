/**
 * vlist — table() re-derives aria-activedescendant when the layout changes
 *
 * table() replaces the render pipeline (ctx.render.setFn) and never calls the
 * per-row state function a11y() registers (src/plugins/table/plugin.ts,
 * core/create.ts). a11y() keeps its focus in the DATA space, so the ring it
 * reports through `_getFocusedLayoutIndex()` follows the item across a
 * re-grouping `setItems`; the attribute is re-derived in the state pass, which
 * table() bypasses, so it keeps naming the layout index that now paints the
 * neighbouring item.
 *
 * This test pins `aria-activedescendant` to the item the ring and
 * `focus:change` name when table() and groups() paint the list.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { table } from "../../src/plugins/table/plugin";
import { groups } from "../../src/plugins/groups/plugin";
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

describe("table + a11y() — setItems that inserts a group above the focus", () => {
  // document.activeElement (the keyboard path lands focus on the content) and
  // the HTMLElement.prototype geometry getters mocked in beforeAll are process
  // globals, so the tests run one at a time.
  it.serial("keeps aria-activedescendant on the item it announces", async () => {
    const shape = { split: 1000 };
    const f = await build([
      groups<TestItem>({
        getGroupForIndex: (i) => (i < shape.split ? "A" : "B"),
        header: { height: 32, template: (key) => key },
      }),
      table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
      a11y(),
    ]);
    try {
      f.press("Home");
      await tick(0);
      for (let i = 0; i < 59; i++) f.press("ArrowDown");
      await tick(0);
      await tick(20);

      // Item 60 is focused and announced: data index 59, layout index 60.
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 59, id: 60 });
      expect(f.marked("focused")).toEqual(["Item 60"]);
      expect(f.activeRowText()).toBe("Item 60");

      shape.split = 30;
      f.list.setItems(createTestItems(200));
      await tick(0);
      await tick(100);

      // The ring followed the item to its new layout index 61; the attribute
      // still names layout index 60, which now paints Item 59.
      expect(f.marked("focused")).toEqual(["Item 60"]);
      expect(f.activeRowText()).toBe("Item 60");
    } finally {
      f.dispose();
    }
  });
});
