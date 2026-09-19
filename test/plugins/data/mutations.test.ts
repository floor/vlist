/**
 * vlist — data(): editing a remote list, and loads that fail
 *
 * With data() the rows live in the data manager, not in core's array, so
 * list.updateItem / insertItem / removeItem are rerouted to it. These tests
 * drive them through a real createVList and read the result off the DOM, then
 * cover what a consumer hears when the adapter rejects.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { advanceTimers } from "../../helpers/timers";
import { createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import type { VListAdapter } from "../../../src/types";
import { data, type DataMethods } from "../../../src/plugins/data";

const WIDTH = 300;
const HEIGHT = 500;
const TOTAL = 200;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

type DataList = VList<TestItem> & DataMethods;

let open: Array<{ list: VList<TestItem>; container: HTMLElement }> = [];
afterEach(() => {
  for (const { list, container } of open) {
    list.destroy();
    container.remove();
  }
  open = [];
});

const row = (index: number): TestItem => ({ id: index + 1, name: `Item ${index + 1}`, value: (index + 1) * 10 });

function pagedAdapter(): VListAdapter<TestItem> {
  return {
    read: async ({ offset, limit }) => {
      const end = Math.min(offset + limit, TOTAL);
      const items: TestItem[] = [];
      for (let i = offset; i < end; i++) items.push(row(i));
      return { items, total: TOTAL, hasMore: end < TOTAL };
    },
  };
}

function makeList(adapter: VListAdapter<TestItem>) {
  const container = createContainer({ width: WIDTH, height: HEIGHT });
  const list = createVList<TestItem>(
    { container, item: { height: 50, template: simpleTemplate } },
    [data<TestItem>({ adapter })],
  );
  open.push({ list, container });
  return { list: list as DataList, container };
}

async function loadedList() {
  const made = makeList(pagedAdapter());
  await advanceTimers(50);
  return made;
}

const rowText = (container: HTMLElement, id: number): string | null =>
  container.querySelector<HTMLElement>(`[data-id="${id}"]`)?.textContent ?? null;

const renderedIds = (container: HTMLElement): number[] =>
  [...container.querySelectorAll<HTMLElement>("[data-index]")]
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
    .map((el) => Number(el.getAttribute("data-id")));

// =============================================================================
// Editing loaded rows
// =============================================================================

describe("data — editing a remote list", () => {
  it("updateItem rewrites the row on screen", async () => {
    const { list, container } = await loadedList();
    expect(rowText(container, 3)).toBe("Item 3");

    list.updateItem(3, { name: "Renamed" });

    expect(rowText(container, 3)).toBe("Renamed");
    expect(list.getItemAt(2)?.name).toBe("Renamed");
  });

  it("updateItem for an id that is not loaded changes nothing", async () => {
    const { list, container } = await loadedList();
    const before = container.querySelector(".vlist-content")!.innerHTML;

    list.updateItem(9999, { name: "Nobody" });

    expect(container.querySelector(".vlist-content")!.innerHTML).toBe(before);
  });

  it("removeItem takes the row out and pulls the following rows up", async () => {
    const { list, container } = await loadedList();
    expect(renderedIds(container).slice(0, 4)).toEqual([1, 2, 3, 4]);

    list.removeItem(2);

    expect(renderedIds(container).slice(0, 4)).toEqual([1, 3, 4, 5]);
    expect(list.total).toBe(TOTAL - 1);
    expect(list.getIndexById(2)).toBe(-1);
  });

  it("removeItem for an id that is not loaded keeps the total", async () => {
    const { list, container } = await loadedList();

    list.removeItem(9999);

    expect(list.total).toBe(TOTAL);
    expect(renderedIds(container).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("insertItem puts the new row where it was asked and pushes the rest down", async () => {
    const { list, container } = await loadedList();

    list.insertItem({ id: 5000, name: "Inserted", value: 0 }, 1);

    expect(renderedIds(container).slice(0, 4)).toEqual([1, 5000, 2, 3]);
    expect(rowText(container, 5000)).toBe("Inserted");
    expect(list.total).toBe(TOTAL + 1);
  });
});

// =============================================================================
// Loads that fail
// =============================================================================

describe("data — a load that fails", () => {
  it("tells the consumer through an error event when the first page cannot be read", async () => {
    const errors: Array<{ message: string; context: string }> = [];
    const { list } = makeList({ read: async () => { throw new Error("offline"); } });
    list.on("error", ({ error, context }) => errors.push({ message: error.message, context }));

    await advanceTimers(50);

    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) expect(e.message).toBe("offline");
    // The list is still alive and simply empty.
    expect(list.total).toBe(0);
  });

  it("tells the consumer when a later page fails, and keeps the rows it already has", async () => {
    let fail = false;
    const paged = pagedAdapter();
    const { list, container } = makeList({
      read: async (params) => {
        if (fail) throw new Error("page lost");
        return paged.read(params);
      },
    });
    await advanceTimers(50);
    const errors: string[] = [];
    list.on("error", ({ error }) => errors.push(error.message));

    fail = true;
    list.scrollToIndex(150);
    await advanceTimers(300);

    expect(errors).toContain("page lost");
    // Going back up, the first page is still there.
    list.scrollToIndex(0);
    await advanceTimers(50);
    expect(rowText(container, 1)).toBe("Item 1");
  });
});
