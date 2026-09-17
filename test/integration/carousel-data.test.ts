/**
 * vlist — A carousel over an adapter (N12, N5)
 *
 * carousel() sets up at priority 10 and data() at 20, and the adapter's items
 * arrive later still, so the total this plugin read in setup() was 0 and the
 * virtual window — the modulo accessor, the inflated total, the wrapping
 * scroll — was never installed. The list rendered, and the wrap that defines a
 * carousel was silently absent: measured, `prev()` left the index at 0.
 *
 * The window is now installed when the total first becomes known, composing
 * with the accessor data() put in place. And `getItemAt`, which answers in
 * data space, reads the loaded item rather than the raw array an adapter
 * leaves empty.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin, PluginContext } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { carousel } from "../../src/plugins/carousel/plugin";
import { data } from "../../src/plugins/data/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});

let list: VList<TestItem> | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  list?.destroy();
  list = null;
  container?.remove();
  container = null;
});

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const all = createTestItems(10);
const adapter = {
  read: async ({ offset, limit }: { offset: number; limit: number }) => ({
    items: all.slice(offset, offset + limit),
    total: all.length,
    hasMore: offset + limit < all.length,
  }),
};

type CarouselApi = { getCarouselState(): { index: number }; prev(): void; next(): void };

async function buildOverAdapter(): Promise<PluginContext<TestItem>> {
  let ctx: PluginContext<TestItem> | null = null;
  const inspect: VListPlugin<TestItem> = { name: "inspect", priority: 99, setup(c) { ctx = c as PluginContext<TestItem>; } };
  container = createContainer({ width: 300, height: 500 });
  list = createVList<TestItem>(
    { container, items: [], item: { height: 50, template: simpleTemplate } },
    [carousel({ snapDuration: 0 }), data<TestItem>({ adapter }), inspect],
  );
  await tick(0);
  await tick(50);
  await tick(50);
  return ctx!;
}

describe("carousel + data", () => {
  it("installs the wrap once the adapter reports its total", async () => {
    const ctx = await buildOverAdapter();
    // The public total is the list's; the engine's is the inflated one that
    // rendering at virtual indices needs. Before the fix both read 10.
    expect(list!.total).toBe(10);
    expect(ctx.getState().totalItems).toBeGreaterThan(10);
    // Seeded in the middle lap, so there is room to wrap either way.
    expect(list!.getScrollPosition()).toBeGreaterThan(0);
  });

  it("wraps backwards from the first item, as a static carousel does", async () => {
    await buildOverAdapter();
    const api = list as unknown as CarouselApi;
    expect(api.getCarouselState().index).toBe(0);
    api.prev();
    await tick(0);
    // Before the fix: index 0, position 0 — prev() did nothing.
    expect(api.getCarouselState().index).toBe(9);
  });

  it("getItemAt reads the loaded item, in data space", async () => {
    await buildOverAdapter();
    expect(list!.getItemAt(3)?.id).toBe(all[3]!.id);
    expect(list!.getItemAt(0)?.id).toBe(all[0]!.id);
  });
});

describe("carousel alone — getItemAt space", () => {
  it("takes a data index, so an index past the list is undefined rather than a wrapped item", () => {
    container = createContainer({ width: 300, height: 500 });
    list = createVList<TestItem>(
      { container, items: createTestItems(10), item: { height: 50, template: simpleTemplate } },
      [carousel({ snapDuration: 0 })],
    );
    expect(list.getItemAt(3)?.id).toBe(4);
    expect(list.getItemAt(12)).toBeUndefined();
  });
});
