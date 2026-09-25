/**
 * vlist — What a grid reports as its total
 *
 * The engine renders a grid in row space: the size cache, the range math and
 * `engineState.totalItems` all count rows. The public total is a different
 * question — how many items the consumer has — and `getItemAt` has always taken
 * item indices. `grid()` published the row count for both, so a hundred items in
 * three columns reported 34 while `getItemAt(99)` returned item 100.
 *
 * The same defect was fixed for `groups()` in #187 and `carousel()` was already
 * right. Nothing asserted a grid's public total, which is why it survived.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VListPlugin, PluginContext } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
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
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("grid — the public total is the item count", () => {
  it("reports items, not rows", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [grid({ columns: 3 })],
    );
    try {
      await tick(0);
      await tick(40);

      // Was 34: ceil(100 / 3) rows.
      expect(list.total).toBe(100);
      // The accessor always took item indices; now the total agrees with it.
      expect(list.getItemAt(99)?.id).toBe(100);
      expect(list.items.length).toBe(100);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("agrees with a plain list given the same items", async () => {
    const plainContainer = createContainer({ width: 300, height: 400 });
    const plain = createVList<TestItem>(
      { container: plainContainer, items: createTestItems(60), item: { height: 40, template: simpleTemplate } },
      [],
    );
    const plainTotal = plain.total;
    plain.destroy();
    plainContainer.remove();

    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      { container, items: createTestItems(60), item: { height: 40, template: simpleTemplate } },
      [grid({ columns: 4 })],
    );
    try {
      await tick(0);
      await tick(40);

      expect(list.total).toBe(plainTotal);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("publishes the same number through _getTotal, which plugins read", async () => {
    // selection, snapshots and the aria resolvers ask through _getTotal. grid
    // never published it, so they fell back to whatever core had.
    // No initializer: an assignment made inside setup() is invisible to the
    // compiler, so an initialized variable narrows to its initial type at the
    // assertion below. This is how method-bus.test.ts captures the same thing.
    let seen: unknown;
    const inspect: VListPlugin<TestItem> = {
      name: "inspect",
      priority: 99,
      setup(ctx: PluginContext<TestItem>): void {
        const fn = ctx.hooks.get("_getTotal") as (() => number) | undefined;
        seen = fn ? fn() : null;
      },
    };

    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [grid({ columns: 3 }), inspect],
    );
    try {
      await tick(0);

      // null here means grid never published the hook at all, which is what it did
      // before: selection, snapshots and the ARIA resolvers all ask through it.
      expect(seen).toBe(100);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("still renders in row space — the engine is untouched", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [grid({ columns: 3 })],
    );
    try {
      await tick(0);
      await tick(40);

      // A 400px viewport of 40px rows shows ~10 rows, so ~30 items, not 100.
      const rendered = container.querySelectorAll("[data-index]").length;
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(100);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("reports the adapter's total under data()", async () => {
    const all = createTestItems(100);
    const adapter = {
      read: mock(async ({ offset, limit }: { offset: number; limit: number }) => ({
        items: all.slice(offset, offset + limit),
        total: all.length,
      })),
    } as unknown as VListAdapter<TestItem>;

    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      { container, item: { height: 40, template: simpleTemplate } },
      [grid({ columns: 3 }), dataPlugin({ adapter })],
    );
    try {
      await tick(0);
      await tick(80);

      // data() owns engineState.totalItems under an adapter, so the grid's total
      // must follow it rather than a row count derived from it.
      expect(list.total).toBe(100);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
