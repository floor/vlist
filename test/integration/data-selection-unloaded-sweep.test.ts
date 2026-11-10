import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import { createContainer, simpleTemplate, type TestItem } from "../helpers/factory";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import type { VListItem, VListAdapter } from "../../src/types";

/** Fixture item with string ids, matching what the adapters below return. */
interface StringIdItem extends VListItem {
  id: string;
  name: string;
  value: number;
}

/** Same markup as `simpleTemplate`, typed for the string-id fixtures. */
const stringIdTemplate = (item: StringIdItem): string =>
  `<div class="item">${item.name}</div>`;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 400;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 300;
    },
    configurable: true,
  });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("data() + selection() — selecting items before load, then loading them", () => {
  it.serial("selectAll() before initial chunk resolves selects all declared total items", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const reads: Array<() => void> = [];
    const adapter: VListAdapter<TestItem> = {
      read: ({ offset, limit }) =>
        new Promise((resolve) => {
          reads.push(() => {
            const items: TestItem[] = Array.from({ length: limit }, (_, i) => ({
              id: offset + i + 1,
              name: `Item ${offset + i + 1}`,
              value: offset + i + 1,
            }));
            resolve({ items, total: 100, hasMore: offset + limit < 100 });
          });
        }),
    };

    const list = createVList(
      { container, item: { height: 40, template: simpleTemplate } },
      [
        dataPlugin<TestItem>({ adapter, total: 100, storage: { chunkSize: 50 } }),
        selection<TestItem>({ mode: "multiple" }),
      ],
    );
    try {
      await Promise.resolve();
      expect(list.total).toBe(100);

      // Selecting all before the initial read resolves should select all 100 items.
      list.selectAll();
      expect(list.getSelected().length).toBe(100);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it.serial("replaces placeholder selection IDs for all loaded items in a chunk (including off-screen items) and includes them in getSelectedItems()", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const reads: Array<() => void> = [];
    const adapter: VListAdapter<StringIdItem> = {
      read: ({ offset, limit }) =>
        new Promise((resolve) => {
          reads.push(() => {
            const items: StringIdItem[] = Array.from({ length: limit }, (_, i) => ({
              id: `item-${offset + i + 1}`,
              name: `Item ${offset + i + 1}`,
              value: offset + i + 1,
            }));
            resolve({ items, total: 100, hasMore: offset + limit < 100 });
          });
        }),
    };

    const list = createVList(
      { container, item: { height: 40, template: stringIdTemplate } },
      [
        dataPlugin<StringIdItem>({ adapter, total: 100, storage: { chunkSize: 50 } }),
        selection<StringIdItem>({ mode: "multiple" }),
      ],
    );
    try {
      await Promise.resolve();
      list.setTotal(100);
      list.selectAll();
      expect(list.getSelected().length).toBe(100);

      // Resolve chunk 0 (indices 0..49 = 50 items loaded, while viewport renders only 0..13).
      reads[0]!();
      await tick(30);

      const selected = list.getSelected();
      const stalePlaceholdersInLoadedChunk = selected.filter(
        (id) =>
          typeof id === "string" &&
          id.startsWith("__placeholder_") &&
          Number(id.slice("__placeholder_".length)) < 50,
      );
      expect(stalePlaceholdersInLoadedChunk).toEqual([]);

      const selectedItems = list.getSelectedItems();
      expect(selectedItems.length).toBe(50);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it.serial("allows clicking an unloaded placeholder row and claims its real item ID once loaded", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const reads: Array<() => void> = [];
    const adapter: VListAdapter<StringIdItem> = {
      read: ({ offset, limit }) =>
        new Promise((resolve) => {
          reads.push(() => {
            const items: StringIdItem[] = Array.from({ length: limit }, (_, i) => ({
              id: `item-${offset + i + 1}`,
              name: `Item ${offset + i + 1}`,
              value: offset + i + 1,
            }));
            resolve({ items, total: 100, hasMore: offset + limit < 100 });
          });
        }),
    };

    const list = createVList(
      { container, item: { height: 40, template: stringIdTemplate } },
      [
        dataPlugin<StringIdItem>({ adapter, total: 100, storage: { chunkSize: 50 } }),
        selection<StringIdItem>({ mode: "multiple" }),
      ],
    );
    try {
      await Promise.resolve();
      // Resolve chunk 0 (0..49), then scroll to unloaded index 60 (in chunk 1: 50..99).
      reads[0]!();
      await tick(30);
      list.scrollToIndex(60);
      await tick(200);

      const content = container.querySelector(".vlist-content") as HTMLElement;
      const row60 = content.querySelector('[data-index="60"]') as HTMLElement;
      expect(row60.classList.contains("vlist-item--placeholder")).toBe(true);

      // Click unloaded row 60 before chunk 1 finishes loading.
      row60.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      // Now resolve chunk 1 (indices 50..99).
      for (const r of reads.slice(1)) r();
      await tick(30);

      expect(list.getSelected()).toEqual(["item-61"]);
      expect(list.getSelectedItems().map((it) => it.id)).toEqual(["item-61"]);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
