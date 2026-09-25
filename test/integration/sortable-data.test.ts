/**
 * vlist — Keyboard reordering across an adapter
 *
 * `data()` replaces the item accessors, not the raw array, so `items.all()` is
 * empty under an adapter. `sortable()` read it by index in three places — the
 * keyboard grab, the announcement label, and the focus captured at drag start —
 * and each found nothing and returned early, so Space never grabbed and no
 * `sort:start` was ever emitted. Pointer drag kept working, because it operates
 * on DOM elements, which is what hid this.
 *
 * Recorded as P6. Nothing covered the pair before this file.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { sortable } from "../../src/plugins/sortable/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import type { VListAdapter } from "../../src/types";

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
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

let list: VList<TestItem> | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  list?.destroy();
  list = null;
  container?.remove();
  container = null;
});

function createMockAdapter(total = 100): VListAdapter<TestItem> {
  const all = createTestItems(total);
  return {
    read: mock(async ({ offset, limit }: { offset: number; limit: number }) => ({
      items: all.slice(offset, offset + limit),
      total,
    })),
  } as unknown as VListAdapter<TestItem>;
}

function waitForLoad(l: VList<TestItem>): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsub = l.on("load:end" as never, () => {
      unsub();
      resolve();
    });
    setTimeout(resolve, 200);
  });
}

/** Space to grab, ArrowDown to move, Space to drop. */
function keyboardReorder(root: HTMLElement): void {
  for (const key of [" ", "ArrowDown", " "]) {
    root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
}

async function reorderAndCollect(withAdapter: boolean): Promise<string[]> {
  container = createContainer({ width: 300, height: 400 });
  const seen: string[] = [];

  list = withAdapter
    ? createVList<TestItem>(
        { container, item: { height: 40, template: simpleTemplate } },
        [
          dataPlugin({ adapter: createMockAdapter(100) }),
          selection({ mode: "single", focusOnClick: true }),
          sortable(),
        ],
      )
    : createVList<TestItem>(
        { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
        [selection({ mode: "single", focusOnClick: true }), sortable()],
      );

  if (withAdapter) await waitForLoad(list);

  for (const name of ["sort:start", "sort:end", "sort:cancel"] as const) {
    list.on(name as never, () => seen.push(name));
  }

  const row = container.querySelector("[data-index]") as HTMLElement | null;
  expect(row).not.toBeNull();
  // Keyboard reordering needs a focused row, which selection supplies on click.
  row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  keyboardReorder(container.querySelector(".vlist") as HTMLElement);
  return seen;
}

describe("sortable + data — keyboard reordering across an adapter", () => {
  it("emits the same sort events with an adapter as without one", async () => {
    const plain = await reorderAndCollect(false);
    // The control: this is what a working keyboard reorder looks like.
    expect(plain).toEqual(["sort:start", "sort:end"]);

    const adapted = await reorderAndCollect(true);
    // Was [] — the grab read the empty raw array and returned before emitting.
    expect(adapted).toEqual(plain);
  });

  it("grabs a row the adapter has loaded, though items.all() stays empty", async () => {
    const seen = await reorderAndCollect(true);

    // The array the plugin used to read is still empty: the fix routes through
    // _getLoadedItem, it does not populate items.
    expect(list!.items.length).toBe(0);
    expect(seen).toContain("sort:start");
  });
});
