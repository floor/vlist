/**
 * vlist — Data Operations Edge Case Tests
 *
 * Tests boundary cases for: setItems, appendItems, prependItems,
 * insertItem, updateItem, removeItem, removeItems.
 */

import { capturePrototypeGeometry } from "../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================


let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

function makeList(count = 10) {
  list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 50, template: simpleTemplate } },
    [],
  );
  return list;
}

// =============================================================================
// setItems
// =============================================================================

describe("data ops — setItems", () => {
  it("replaces all items and updates total", () => {
    const vlist = makeList(10);
    expect(vlist.total).toBe(10);

    vlist.setItems(createTestItems(5));
    expect(vlist.total).toBe(5);
    expect(vlist.items.length).toBe(5);
  });

  it("setItems with empty array clears the list", () => {
    const vlist = makeList(10);
    vlist.setItems([]);
    expect(vlist.total).toBe(0);
    expect(vlist.items.length).toBe(0);
  });

  it("setItems with same items does not crash", () => {
    const vlist = makeList(10);
    const same = [...vlist.items] as TestItem[];
    vlist.setItems(same);
    expect(vlist.total).toBe(10);
  });

  it("setItems does not share reference with caller array", () => {
    const vlist = makeList(5);
    const arr = createTestItems(3);
    vlist.setItems(arr);
    arr.push({ id: 999, name: "Extra" } as TestItem);
    expect(vlist.total).toBe(3); // not 4
  });
});

// =============================================================================
// appendItems
// =============================================================================

describe("data ops — appendItems", () => {
  it("adds items to the end", () => {
    const vlist = makeList(5);
    const newItems = createTestItems(3);
    vlist.appendItems(newItems);
    expect(vlist.total).toBe(8);
    expect(vlist.items[vlist.items.length - 1]!.id).toBe(newItems[2]!.id);
  });

  it("append to empty list", () => {
    const vlist = makeList(0);
    vlist.appendItems(createTestItems(3));
    expect(vlist.total).toBe(3);
  });

  it("append empty array is a no-op", () => {
    const vlist = makeList(5);
    vlist.appendItems([]);
    expect(vlist.total).toBe(5);
  });
});

// =============================================================================
// appendItems — reverse mode
// =============================================================================

describe("data ops — appendItems in reverse mode", () => {
  // 50px items in a 500px viewport, so 40 items leave 1,500px of scroll.
  function makeReverseList(count: number, reverse = true) {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(count),
        item: { height: 50, template: simpleTemplate },
        reverse,
      },
      [],
    );
    return list;
  }

  it("keeps a list sitting at the end pinned to it", () => {
    const vlist = makeReverseList(40);
    vlist.scrollToIndex(39, "end");
    const atEnd = vlist.getScrollPosition();
    expect(atEnd).toBeGreaterThan(0);

    vlist.appendItems(createTestItems(4, 100));

    expect(vlist.getScrollPosition()).toBeGreaterThan(atEnd);
    expect(vlist.getScrollPosition()).toBe(44 * 50 - 500);
  });

  it("leaves a list scrolled back through history where it is", () => {
    const vlist = makeReverseList(40);
    vlist.scrollToIndex(5, "start");
    const before = vlist.getScrollPosition();

    vlist.appendItems(createTestItems(4, 100));

    expect(vlist.getScrollPosition()).toBe(before);
  });

  it("does not follow the end without reverse", () => {
    const vlist = makeReverseList(40, false);
    vlist.scrollToIndex(39, "end");
    const atEnd = vlist.getScrollPosition();

    vlist.appendItems(createTestItems(4, 100));

    expect(vlist.getScrollPosition()).toBe(atEnd);
  });
});

// =============================================================================
// items copied at construction
// =============================================================================

describe("data ops — the items array is copied at construction", () => {
  it("does not splice the caller's array", () => {
    // removeItem/insertItem splice in place; with the caller's own array that
    // rewrote it from under them, while setItems had always copied.
    const source = createTestItems(5);
    list = createVList<TestItem>(
      { container, items: source, item: { height: 50, template: simpleTemplate } },
      [],
    );

    list.removeItem(source[2]!.id);

    expect(list.total).toBe(4);
    expect(source.length).toBe(5);
  });

  it("does not pick up later edits to the caller's array", () => {
    const source = createTestItems(5);
    list = createVList<TestItem>(
      { container, items: source, item: { height: 50, template: simpleTemplate } },
      [],
    );

    source.push(...createTestItems(3, 100));

    expect(list.total).toBe(5);
  });
});

// =============================================================================
// prependItems
// =============================================================================

describe("data ops — prependItems", () => {
  it("adds items to the beginning", () => {
    const vlist = makeList(5);
    const firstOrigId = vlist.items[0]!.id;
    const newItems = createTestItems(3);
    vlist.prependItems(newItems);

    expect(vlist.total).toBe(8);
    expect(vlist.items[0]!.id).toBe(newItems[0]!.id);
    expect(vlist.items[3]!.id).toBe(firstOrigId);
  });

  it("shifts all original indices", () => {
    const vlist = makeList(5);
    const origFirstId = vlist.getItemAt(0)!.id;
    const newItems: TestItem[] = [
      { id: 900, name: "New A" },
      { id: 901, name: "New B" },
    ];
    vlist.prependItems(newItems);

    expect(vlist.getItemAt(0)!.id).toBe(900);
    expect(vlist.getItemAt(2)!.id).toBe(origFirstId);
  });

  it("prepend to empty list", () => {
    const vlist = makeList(0);
    vlist.prependItems(createTestItems(3));
    expect(vlist.total).toBe(3);
  });

  it("leaves the scroll position alone without reverse", () => {
    const vlist = makeList(40);
    vlist.scrollToIndex(20, "start");
    const before = vlist.getScrollPosition();

    vlist.prependItems(createTestItems(4, 100));

    expect(vlist.getScrollPosition()).toBe(before);
  });
});

// =============================================================================
// prependItems — reverse mode
// =============================================================================

describe("data ops — prependItems in reverse mode", () => {
  // 50px items in a 500px viewport, so 40 items leave 1,500px of scroll.
  function makeReverseList(count: number) {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(count),
        item: { height: 50, template: simpleTemplate },
        reverse: true,
      },
      [],
    );
    return list;
  }

  /** Where a rendered row sits relative to the viewport's leading edge. */
  function viewportOffsetOf(vlist: VList<TestItem>, id: number): number {
    const el = vlist.element.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!el) throw new Error(`item ${id} is not rendered`);
    const transform = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
    if (!transform) throw new Error(`no translateY on item ${id}: ${el.style.transform}`);
    return Number(transform[1]) - vlist.getScrollPosition();
  }

  it("holds the visible rows where they were", () => {
    const vlist = makeReverseList(40);
    vlist.scrollToIndex(20, "start");
    // Item 21 is at index 20 — the first row inside the viewport.
    const before = viewportOffsetOf(vlist, 21);

    vlist.prependItems(createTestItems(4, 100));

    expect(viewportOffsetOf(vlist, 21)).toBe(before);
  });

  it("advances the scroll position by the inserted size", () => {
    const vlist = makeReverseList(40);
    vlist.scrollToIndex(20, "start");
    const before = vlist.getScrollPosition();

    vlist.prependItems(createTestItems(4, 100));

    expect(vlist.getScrollPosition()).toBe(before + 4 * 50);
  });

  it("holds the rows a list sitting at the start was reading", () => {
    // Scroll position 0 is where "load older messages" fires, and the rows
    // there are the ones the reader is looking at.
    const vlist = makeReverseList(40);
    expect(vlist.getScrollPosition()).toBe(0);
    const before = viewportOffsetOf(vlist, 1);

    vlist.prependItems(createTestItems(4, 100));

    expect(vlist.getScrollPosition()).toBe(4 * 50);
    expect(viewportOffsetOf(vlist, 1)).toBe(before);
  });

  it("accounts for variable item sizes", () => {
    // An id-keyed size lookup: the prepended rows are 120px, not the 50px the
    // rows already on screen use, so a count × fixed-size correction would
    // land 280px off.
    const sizes = new Map<number, number>();
    const source = createTestItems(40);
    for (const item of source) sizes.set(item.id, 50);

    const vlist = createVList<TestItem>(
      {
        container,
        items: source,
        item: {
          height: (index: number): number => sizes.get(source[index]!.id) ?? 50,
          template: simpleTemplate,
        },
        reverse: true,
      },
      [],
    );
    list = vlist;

    vlist.scrollToIndex(20, "start");
    const before = viewportOffsetOf(vlist, 21);

    const older = createTestItems(2, 100);
    for (const item of older) sizes.set(item.id, 120);
    // The size function reads `source` by index, so it shifts with the list.
    source.unshift(...older);
    vlist.prependItems(older);

    expect(vlist.getScrollPosition()).toBe(20 * 50 + 2 * 120);
    expect(viewportOffsetOf(vlist, 21)).toBe(before);
  });

  it("prepending nothing does not move the view", () => {
    const vlist = makeReverseList(40);
    vlist.scrollToIndex(20, "start");
    const before = vlist.getScrollPosition();

    vlist.prependItems([]);

    expect(vlist.getScrollPosition()).toBe(before);
  });

  it("leaves an empty list at the start", () => {
    // Nothing was on screen to hold, so compensating would scroll away from
    // the items just supplied.
    const vlist = createVList<TestItem>(
      {
        container,
        items: [],
        item: { height: 50, template: simpleTemplate },
        reverse: true,
      },
      [],
    );
    list = vlist;

    vlist.prependItems(createTestItems(40));

    expect(vlist.getScrollPosition()).toBe(0);
    expect(viewportOffsetOf(vlist, 1)).toBe(0);
  });

  it("does not scroll past the end of a list shorter than the viewport", () => {
    const vlist = makeReverseList(2);

    vlist.prependItems(createTestItems(4, 100));

    // 6 rows of 50px in a 500px viewport: there is nowhere to scroll to.
    expect(vlist.getScrollPosition()).toBe(0);
  });
});

// =============================================================================
// insertItem
// =============================================================================

describe("data ops — insertItem", () => {
  it("inserts at index 0 (beginning)", () => {
    const vlist = makeList(5);
    const newItem: TestItem = { id: 999, name: "First" };
    vlist.insertItem(newItem, 0);

    expect(vlist.total).toBe(6);
    expect(vlist.getItemAt(0)!.id).toBe(999);
  });

  it("inserts at the end when index equals length", () => {
    const vlist = makeList(5);
    const newItem: TestItem = { id: 999, name: "Last" };
    vlist.insertItem(newItem, 5);

    expect(vlist.total).toBe(6);
    expect(vlist.getItemAt(5)!.id).toBe(999);
  });

  it("inserts at the end when index is omitted", () => {
    const vlist = makeList(5);
    const newItem: TestItem = { id: 999, name: "Last" };
    vlist.insertItem(newItem);

    expect(vlist.total).toBe(6);
    expect(vlist.getItemAt(5)!.id).toBe(999);
  });

  it("inserts in the middle", () => {
    const vlist = makeList(5);
    const newItem: TestItem = { id: 999, name: "Middle" };
    vlist.insertItem(newItem, 2);

    expect(vlist.total).toBe(6);
    expect(vlist.getItemAt(2)!.id).toBe(999);
  });

  it("getIndexById finds the inserted item", () => {
    const vlist = makeList(5);
    vlist.insertItem({ id: 888, name: "New" } as TestItem, 3);
    expect(vlist.getIndexById(888)).toBe(3);
  });
});

// =============================================================================
// updateItem
// =============================================================================

describe("data ops — updateItem", () => {
  it("merges partial updates into existing item", () => {
    const vlist = makeList(5);
    const origId = vlist.getItemAt(2)!.id;

    vlist.updateItem(origId, { name: "Updated" });

    const updated = vlist.getItemAt(2)!;
    expect(updated.name).toBe("Updated");
    expect(updated.id).toBe(origId); // id preserved
  });

  it("does not change total count", () => {
    const vlist = makeList(5);
    vlist.updateItem(vlist.getItemAt(0)!.id, { name: "Changed" });
    expect(vlist.total).toBe(5);
  });

  it("no-op for nonexistent ID", () => {
    const vlist = makeList(5);
    const before = vlist.items.map((i) => ({ ...i }));

    vlist.updateItem(99999, { name: "Ghost" });

    for (let i = 0; i < before.length; i++) {
      expect(vlist.getItemAt(i)!.name).toBe(before[i]!.name);
    }
  });

  it("preserves unmentioned fields", () => {
    const vlist = makeList(5);
    const item = vlist.getItemAt(1)!;
    const origName = item.name;
    const origId = item.id;

    // Update with empty object — nothing changes
    vlist.updateItem(origId, {});

    const after = vlist.getItemAt(1)!;
    expect(after.name).toBe(origName);
    expect(after.id).toBe(origId);
  });
});

// =============================================================================
// removeItem
// =============================================================================

describe("data ops — removeItem", () => {
  it("removes first item", () => {
    const vlist = makeList(5);
    const firstId = vlist.getItemAt(0)!.id;
    const secondId = vlist.getItemAt(1)!.id;

    vlist.removeItem(firstId);

    expect(vlist.total).toBe(4);
    expect(vlist.getItemAt(0)!.id).toBe(secondId);
    expect(vlist.getIndexById(firstId)).toBe(-1);
  });

  it("removes last item", () => {
    const vlist = makeList(5);
    const lastId = vlist.getItemAt(4)!.id;

    vlist.removeItem(lastId);

    expect(vlist.total).toBe(4);
    expect(vlist.getIndexById(lastId)).toBe(-1);
  });

  it("removes middle item", () => {
    const vlist = makeList(5);
    const midId = vlist.getItemAt(2)!.id;

    vlist.removeItem(midId);

    expect(vlist.total).toBe(4);
    expect(vlist.getIndexById(midId)).toBe(-1);
  });

  it("no-op for nonexistent ID", () => {
    const vlist = makeList(5);
    vlist.removeItem(99999);
    expect(vlist.total).toBe(5);
  });
});

// =============================================================================
// removeItems
// =============================================================================

describe("data ops — removeItems", () => {
  it("removes multiple items at once", () => {
    const vlist = makeList(10);
    const ids = [vlist.getItemAt(1)!.id, vlist.getItemAt(3)!.id, vlist.getItemAt(5)!.id];

    const removed = vlist.removeItems(ids);

    expect(removed).toBe(3);
    expect(vlist.total).toBe(7);
  });

  it("returns count of actually removed items", () => {
    const vlist = makeList(5);
    const removed = vlist.removeItems([vlist.getItemAt(0)!.id, 99999, 88888]);
    expect(removed).toBe(1);
    expect(vlist.total).toBe(4);
  });

  it("returns 0 when no IDs match", () => {
    const vlist = makeList(5);
    const removed = vlist.removeItems([99999, 88888]);
    expect(removed).toBe(0);
    expect(vlist.total).toBe(5);
  });

  it("empty ID array returns 0", () => {
    const vlist = makeList(5);
    const removed = vlist.removeItems([]);
    expect(removed).toBe(0);
    expect(vlist.total).toBe(5);
  });

  it("removing all items leaves empty list", () => {
    const vlist = makeList(3);
    const allIds = vlist.items.map((i) => i.id);
    const removed = vlist.removeItems(allIds);

    expect(removed).toBe(3);
    expect(vlist.total).toBe(0);
    expect(vlist.items.length).toBe(0);
  });
});
