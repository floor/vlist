/**
 * vlist — a11y() PageDown at the top of a grouped list moves one screenful
 *
 * a11y() keeps its focus in the data index and translates to the layout index
 * at every DOM touch (#380). The PageUp/PageDown branch sizes one page from
 * the size cache at the focus index — but that cache is indexed by LAYOUT
 * entry. On a grouped list the layout entry at index 0 is the first group's
 * header, and with the default sticky header its size collapses to 0
 * (src/plugins/groups/layout.ts, createGroupedSizeFn). One page then measures
 * `floor(400 / 0)` rows — Infinity — and the page target clamps to the last
 * item. The same key one row lower pages normally, so the jump only shows
 * after Home or at the very top.
 *
 * This test pins PageDown at the top to exactly one screenful: rows are 40px
 * in a 400px viewport, so ten rows fit and the page target is data index 10
 * (Item 11) — not the end of a hundred-item list, and not the one-row page a
 * zero-sized header entry produces.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
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

describe("a11y() — page keys on a grouped list", () => {
  // document.activeElement (the keyboard path lands focus on the content) and
  // the HTMLElement.prototype geometry getters mocked in beforeAll are process
  // globals, so the tests run one at a time.
  it.serial("PageDown at the top moves one screenful, not to the last item", async () => {
    const f = await build([groupsPlugin(), a11y()]);
    try {
      f.press("Home");
      await tick(0);
      f.press("PageDown");
      await tick(0);

      const last = f.focuses[f.focuses.length - 1]!;
      // Home focuses data index 0 (layout 1, behind the collapsed first
      // header); ten 40px rows fit in the 400px viewport, so PageDown lands
      // on data index 10 — Item 11. A page sized from the sticky header's
      // zero entry lands on index 1 instead.
      expect(last.index).toBe(10);
      expect(last.id).toBe(11);
    } finally {
      f.dispose();
    }
  });
});
