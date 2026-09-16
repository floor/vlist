/**
 * vlist — Masonry across an adapter
 *
 * `data()` replaces the item accessors, not the raw array, so `items.all()` is
 * empty under an adapter. `masonry()` cached that array once per render and read
 * it by index, so every visible placement resolved to `undefined` and the
 * renderer drew nothing: an empty list, no error, and a scroll area at its full
 * proper height — the layout counts `engineState.totalItems`, which is correct.
 * A blank list that scrolls is what made this survive.
 *
 * The same fault as P6 in `sortable()`, found by checking how far it reached.
 * Nothing covered masonry with an adapter before this file.
 */

import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { createContainer, createTestItems, type TestItem } from "../helpers/factory";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import type { VListAdapter } from "../../src/types";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
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

/** Renders the id, so an unresolved item is visible rather than silently blank. */
const idTemplate = (item: TestItem): string => `<div class="item">${item.id}</div>`;

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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

interface Rendered {
  readonly count: number;
  readonly ids: string[];
  readonly contentSize: string;
}

async function renderAndCollect(withAdapter: boolean): Promise<Rendered> {
  container = createContainer({ width: 300, height: 400 });

  list = withAdapter
    ? createVList<TestItem>(
        { container, item: { height: 40, template: idTemplate } },
        [masonry({ columns: 2 }), dataPlugin({ adapter: createMockAdapter(100) })],
      )
    : createVList<TestItem>(
        { container, items: createTestItems(100), item: { height: 40, template: idTemplate } },
        [masonry({ columns: 2 })],
      );

  if (withAdapter) await waitForLoad(list);
  await settle();

  const rows = [...container.querySelectorAll("[data-index]")] as HTMLElement[];
  const content = container.querySelector(".vlist-content") as HTMLElement | null;

  return {
    count: rows.length,
    ids: rows.slice(0, 6).map((r) => r.textContent?.trim() ?? ""),
    contentSize: content?.style.height ?? "",
  };
}

describe("masonry + data — rendering across an adapter", () => {
  it("renders the same items with an adapter as without one", async () => {
    const plain = await renderAndCollect(false);
    // The control: this is what a working masonry render looks like.
    expect(plain.count).toBeGreaterThan(0);
    expect(plain.ids).toEqual(["1", "3", "5", "7", "9", "11"]);

    const adapted = await renderAndCollect(true);
    // Was 0 rows — every placement resolved to undefined against the empty array.
    expect(adapted.count).toBe(plain.count);
    expect(adapted.ids).toEqual(plain.ids);
  });

  it("measured its content correctly even while rendering nothing", async () => {
    // Why this went unnoticed: the layout reads engineState.totalItems, so the
    // scroll area was always right. Only the lookup was broken, which is the
    // one thing a height assertion cannot see.
    const plain = await renderAndCollect(false);
    const adapted = await renderAndCollect(true);
    expect(adapted.contentSize).toBe(plain.contentSize);
    expect(adapted.contentSize).not.toBe("");
  });

  it("resolves through the adapter, leaving items.all() empty", async () => {
    const adapted = await renderAndCollect(true);
    // The array masonry used to read is still empty: the fix routes through
    // _getLoadedItem, it does not populate items.
    expect(list!.items.length).toBe(0);
    expect(adapted.count).toBeGreaterThan(0);
  });
});
