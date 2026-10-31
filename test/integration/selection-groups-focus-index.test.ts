/**
 * vlist — selection() reports the data index for the item it focuses (groups)
 *
 * groups() paints one header entry per group, so the render index is a LAYOUT
 * index; selection() keeps that one in `state.focusedIndex` and translates at
 * every item lookup. `focus:change` is the public event that names the focused
 * item, and every other emitter of it reports the DATA index: a11y() (`focus:change`
 * in table mode, pinned by test/integration/table-groups-first-render.test.ts),
 * and the core, whose `item:click.index` is documented as the data index
 * (`src/types.ts`). A consumer that reads `items[event.index]` therefore lands
 * on the item one header further down — two in the second group.
 *
 * These tests pin `focus:change.index` to the data index of the item the event
 * names, on a grouped list.
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
    press(key: string): void {
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("selection() — focus:change on a grouped list", () => {
  // document.activeElement (the keyboard path lands focus on the content) and
  // the HTMLElement.prototype geometry getters mocked in beforeAll are process
  // globals, so the tests run one at a time.
  it.serial("names the data index of the item it moves to", async () => {
    const f = await build([groupsPlugin(), selection({ mode: "single" })]);
    try {
      f.press("ArrowDown");
      await tick(0);
      f.press("ArrowDown");
      await tick(0);

      // The second item is data index 1 with id 2. It is painted at layout
      // index 2: one header precedes it.
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 1, id: 2 });
    } finally {
      f.dispose();
    }
  });

  it.serial("names the last item's data index at End", async () => {
    const f = await build([groupsPlugin(), selection({ mode: "single" })]);
    try {
      f.press("End");
      await tick(0);

      // Item 100 is data index 99 with id 100, painted at layout index 101
      // behind two group headers.
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 99, id: 100 });
    } finally {
      f.dispose();
    }
  });
});
