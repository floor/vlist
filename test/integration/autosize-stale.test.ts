/**
 * vlist — autosize() stale measurement integration tests
 *
 * Verifies that measurements do not outlive the items they measured across:
 * - setItems (same ids reordered, new ids, longer, shorter)
 * - search() filter mode in and out
 * - prepend, append, insert, remove
 * - updateItem (content changes, id stays)
 * - sortable() moves
 * - data() replacing a placeholder with a loaded item
 * - and each of the above under groups()
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { createVList } from "../../src/core/create";
import type { PluginContext, VList, VListPlugin } from "../../src/core/types";
import { createContainer } from "../helpers/factory";
import type { VListItem, VListAdapter } from "../../src/types";
import { autosize } from "../../src/plugins/autosize/plugin";
import type { AutosizeMethods } from "../../src/plugins/autosize/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { search } from "../../src/plugins/search/plugin";
import type { SearchMethods } from "../../src/plugins/search/plugin";
import { data } from "../../src/plugins/data/plugin";
import type { DataMethods } from "../../src/plugins/data/plugin";
import { sortable } from "../../src/plugins/sortable/plugin";

// =============================================================================
// DOM & Geometry Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 600, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

// =============================================================================
// Helpers
// =============================================================================

interface TestRow extends VListItem {
  id: string | number;
  name: string;
  h: number;
}

function captureResizeObserver() {
  const original = globalThis.ResizeObserver;
  const observed = new Set<Element>();
  const callbacks = new Set<ResizeObserverCallback>();

  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) { callbacks.add(cb); }
    observe(el: Element): void { observed.add(el); }
    unobserve(el: Element): void { observed.delete(el); }
    disconnect(): void { observed.clear(); }
  } as unknown as typeof ResizeObserver;

  const naturalHeight = (el: Element): number => {
    const hel = el as HTMLElement;
    const attr = hel.getAttribute("data-h") ?? hel.querySelector("[data-h]")?.getAttribute("data-h");
    const num = attr ? Number(attr) : 0;
    return Number.isFinite(num) && num > 0 ? num : 40;
  };

  return {
    observed,
    measureAll(): void {
      const entries = [...observed]
        .filter((el) => (el as HTMLElement).hasAttribute("data-index"))
        .map((el) => {
          const h = naturalHeight(el);
          return ({
            target: el,
            contentRect: { width: 300, height: h, top: 0, left: 0, bottom: h, right: 300 } as DOMRectReadOnly,
            borderBoxSize: [{ blockSize: h, inlineSize: 300 }],
          }) as unknown as ResizeObserverEntry;
        })
        .filter((entry) => (entry.borderBoxSize[0]!.blockSize as number) > 0);
      if (entries.length > 0) {
        for (const cb of callbacks) cb(entries, {} as ResizeObserver);
      }
    },
    restore(): void { globalThis.ResizeObserver = original; },
  };
}

const itemTemplate = (item: TestRow): string =>
  `<div data-h="${item.h}">Item ${item.id} (${item.h}px)</div>`;

const itemElements = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(".vlist-content [data-index]")]
    .filter((el) => !el.classList.contains("vlist-group-header"));

const rowHeights = (container: HTMLElement): number[] =>
  itemElements(container).map((el) => Math.round(parseFloat(el.style.height || "0")));

// `WeakRef` and `Bun.gc` are runtime features the ES2020 lib does not declare.
// Whether a departed item is collectable is the half of a measurement leak a
// count cannot show, so the cast is worth it.
const WeakRefCtor = (globalThis as unknown as {
  WeakRef: new (target: object) => { deref(): unknown };
}).WeakRef;

// =============================================================================
// Tests — Plain List + Autosize
// =============================================================================

describe("autosize() stale measurement prevention — plain list", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it.serial("setItems: same ids reordered renders each row at its own content height", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Reorder: [I3, I2, I1, I0]
    list.setItems([initialItems[3]!, initialItems[2]!, initialItems[1]!, initialItems[0]!]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([150, 120, 90, 60]);
  });

  it.serial("setItems: new ids renders each new row at its own content height", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // New items with completely different heights
    const newItems: TestRow[] = [
      { id: "N0", name: "New 0", h: 70 },
      { id: "N1", name: "New 1", h: 110 },
      { id: "N2", name: "New 2", h: 130 },
      { id: "N3", name: "New 3", h: 170 },
    ];
    list.setItems(newItems);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([70, 110, 130, 170]);
  });

  it.serial("setItems: shorter list renders remaining items at their own heights", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Shorten to [I2, I3]
    list.setItems([initialItems[2]!, initialItems[3]!]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([120, 150]);
  });

  it.serial("setItems: longer list renders existing and new items at their own heights", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90]);

    // Lengthen to 4 items
    list.setItems([
      initialItems[0]!,
      initialItems[1]!,
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);
  });

  it.serial("search(): filter mode in and out renders matching rows at their own heights", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Apple", h: 60 },
      { id: "I1", name: "Banana", h: 90 },
      { id: "I2", name: "Cherry", h: 120 },
      { id: "I3", name: "Date", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize(), search<TestRow>({ mode: "filter", field: "name" })]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Filter down to Cherry (natural height 120)
    (list as unknown as SearchMethods).setQuery("Cherry");
    ro.measureAll();

    // Cherry is at index 0 now: must be 120, not Apple's 60!
    expect(rowHeights(container)).toEqual([120]);

    // Restore filter
    (list as unknown as SearchMethods).closeSearch();
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);
  });

  it.serial("prependItems: shifts existing items without corrupting their measurements", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120]);

    // Prepend P0 (height 150)
    list.prependItems([{ id: "P0", name: "Prepend 0", h: 150 }]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([150, 60, 90, 120]);
  });

  it.serial("appendItems: adds items without corrupting measurements", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90]);

    // Append A0 (height 150)
    list.appendItems([{ id: "A0", name: "Append 0", h: 150 }]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 90, 150]);
  });

  it.serial("insertItem: inserts item at index without corrupting displaced items", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120]);

    // Insert at index 1: X0 (height 200)
    list.insertItem({ id: "X0", name: "Insert 0", h: 200 }, 1);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 200, 90, 120]);
  });

  it.serial("removeItem: removes item and shifts subsequent items without stale sizes", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Remove I1 (id "I1", height 90)
    list.removeItem("I1");
    ro.measureAll();

    // Remaining items I0, I2, I3: index 1 is now I2 (120), NOT I1's 90!
    expect(rowHeights(container)).toEqual([60, 120, 150]);
  });

  it.serial("removeItems: removes several items and shifts the rest without stale sizes", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Remove I0 and I2: index 0 is now I1 (90), index 1 is now I3 (150)
    expect(list.removeItems(["I0", "I2"])).toBe(2);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([90, 150]);
  });

  it.serial("updateItem: remeasures updated item when content changes and id stays", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120]);

    // Update I1 to height 250
    list.updateItem("I1", { h: 250 });
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 250, 120]);
  });

  it.serial("sortable(): moving an item preserves each row's measurement", () => {
    const ro = captureResizeObserver();
    const container = createContainer();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize(), sortable()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Reorder as sortable drop does: move I3 to index 0 -> [I3, I0, I1, I2]
    list.setItems([initialItems[3]!, initialItems[0]!, initialItems[1]!, initialItems[2]!]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([150, 60, 90, 120]);
  });

  it.serial("data(): replacing placeholder with loaded item measures real item content", async () => {
    const ro = captureResizeObserver();
    const container = createContainer();

    let resolveRead: ((val: { items: TestRow[]; total: number }) => void) | null = null;
    const adapter: VListAdapter<TestRow> = {
      read: () => new Promise((resolve) => { resolveRead = resolve; }),
    };

    const list = createVList({
      container,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize(), data({ adapter, total: 3, autoLoad: false })]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    (list as unknown as DataMethods).setTotal(3);
    ro.measureAll();
    expect(rowHeights(container)).toEqual([40, 40, 40]);

    // Now trigger loadInitial
    const loadPromise = (list as unknown as DataMethods).loadInitial();
    await new Promise((r) => setTimeout(r, 10));

    resolveRead!({
      items: [
        { id: "R0", name: "Real 0", h: 100 },
        { id: "R1", name: "Real 1", h: 180 },
        { id: "R2", name: "Real 2", h: 140 },
      ],
      total: 3,
    });
    await loadPromise;
    ro.measureAll();

    expect(rowHeights(container)).toEqual([100, 180, 140]);
  });
});

// =============================================================================
// Tests — The measured cache follows the list
// =============================================================================

describe("autosize() measured cache follows the list", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  // A page of four rows, as a data source re-delivers it: fresh objects under
  // fresh ids on every round.
  const churnRound = (round: number): TestRow[] => [
    { id: `R${round}-0`, name: `Round ${round} item 0`, h: 60 },
    { id: `R${round}-1`, name: `Round ${round} item 1`, h: 90 },
    { id: `R${round}-2`, name: `Round ${round} item 2`, h: 120 },
    { id: `R${round}-3`, name: `Round ${round} item 3`, h: 150 },
  ];

  it.serial("dropped items leave the cache: the count tracks the list and departed items are collectable", async () => {
    // serial: owns the global ResizeObserver for the duration of the test.
    const ro = captureResizeObserver();
    const container = createContainer();
    const list = createVList({
      container,
      items: churnRound(0),
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [autosize()]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(list.getMeasuredCount()).toBe(4);

    // Five refreshes with fresh objects under fresh ids. Every measurement
    // kept for an item that left is a row the size cache can no longer serve,
    // an entry nothing will ever read again, and a strong reference that keeps
    // the departed item object alive.
    const departed: { deref(): unknown }[] = [];
    let lastRound: TestRow[] = [];
    for (let round = 1; round <= 5; round++) {
      lastRound = churnRound(round);
      if (round === 1) for (const item of lastRound) departed.push(new WeakRefCtor(item));
      list.setItems(lastRound);
      ro.measureAll();

      expect(rowHeights(container)).toEqual([60, 90, 120, 150]);
      // 4, not the 20 this held before: the list's four items are the four
      // measurements the cache keeps.
      expect(list.getMeasuredCount()).toBe(4);
    }

    // A WeakRef target is kept alive until the job that dereferenced it ends,
    // so let this round end before collecting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    expect(departed.filter((ref) => ref.deref() !== undefined).length).toBe(0);
    expect(list.getMeasuredCount()).toBe(4);

    // Shrinking the list keeps the measurements of the rows that stay: the
    // items are unchanged, so their rows must not fall back to the estimate.
    list.setItems(lastRound.slice(0, 2));
    expect(list.getMeasuredCount()).toBe(2);
    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90]);
  });

  it.serial("groups: dropped items leave the cache through the grouped size cache too", () => {
    // serial: owns the global ResizeObserver for the duration of the test.
    // groups() swaps the size cache in its own setup, after this plugin's, so
    // the bookkeeping has to survive that swap — measured on a grouped list,
    // the prune was never called before the swap was accounted for.
    const ro = captureResizeObserver();
    const container = createContainer();
    const list = createVList({
      container,
      items: churnRound(0),
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [
      autosize(),
      groups<TestRow>({
        getGroupForIndex: (i) => (i < 2 ? "A" : "B"),
        header: { height: 30, template: (g) => `<span>${g}</span>` },
      }),
    ]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(list.getMeasuredCount()).toBe(4);

    for (let round = 1; round <= 3; round++) {
      list.setItems(churnRound(round));
      ro.measureAll();

      expect(rowHeights(container)).toEqual([60, 90, 120, 150]);
      expect(list.getMeasuredCount()).toBe(4);
    }
  });
});

// =============================================================================
// Tests — Under groups()
// =============================================================================

describe("autosize() stale measurement prevention — under groups()", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  const makeGroupedList = (initialItems: TestRow[], extraPlugins: VListPlugin<TestRow, any>[] = []) => {
    const container = createContainer();
    let ctx!: PluginContext<TestRow>;
    const capture: VListPlugin<TestRow> = {
      name: "capture-ctx",
      setup(val) { ctx = val; },
    };
    const list = createVList({
      container,
      items: initialItems,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [
      autosize(),
      groups<TestRow>({
        getGroupForIndex: (i) => (i < 2 ? "A" : "B"),
        header: { height: 30, template: (g) => `<span>${g}</span>` },
      }),
      ...extraPlugins,
      capture,
    ]);
    return { container, list, getCtx: () => ctx };
  };

  it.serial("groups: setItems reorder renders each row at its own content height", () => {
    const ro = captureResizeObserver();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const { container, list } = makeGroupedList(initialItems);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Reorder items
    list.setItems([initialItems[3]!, initialItems[2]!, initialItems[1]!, initialItems[0]!]);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([150, 120, 90, 60]);
  });

  it.serial("groups: setItems new ids renders new rows at their own content heights", () => {
    const ro = captureResizeObserver();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
      { id: "I3", name: "Item 3", h: 150 },
    ];
    const { container, list } = makeGroupedList(initialItems);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    const newItems: TestRow[] = [
      { id: "N0", name: "New 0", h: 75 },
      { id: "N1", name: "New 1", h: 105 },
      { id: "N2", name: "New 2", h: 135 },
      { id: "N3", name: "New 3", h: 165 },
    ];
    list.setItems(newItems);
    ro.measureAll();

    expect(rowHeights(container)).toEqual([75, 105, 135, 165]);
  });

  it.serial("groups: search() filter mode in and out renders rows at their own heights", () => {
    const ro = captureResizeObserver();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Apple", h: 60 },
      { id: "I1", name: "Banana", h: 90 },
      { id: "I2", name: "Cherry", h: 120 },
      { id: "I3", name: "Date", h: 150 },
    ];
    const { container, list } = makeGroupedList(initialItems, [
      search<TestRow>({ mode: "filter", field: "name" }),
    ]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);

    // Filter to Cherry (natural height 120)
    (list as unknown as SearchMethods).setQuery("Cherry");
    ro.measureAll();

    expect(rowHeights(container)).toEqual([120]);

    (list as unknown as SearchMethods).closeSearch();
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 90, 120, 150]);
  });

  it.serial("groups: prepend/append/insert/remove maintain correct item heights", () => {
    const ro = captureResizeObserver();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
    ];
    const { container, list } = makeGroupedList(initialItems);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120]);

    // Remove I1 -> [I0, I2]
    list.removeItem("I1");
    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 120]);

    // Prepend P0 (height 150)
    list.prependItems([{ id: "P0", name: "Prepend 0", h: 150 }]);
    ro.measureAll();
    expect(rowHeights(container)).toEqual([150, 60, 120]);

    // Insert X0 (height 80) at index 1
    list.insertItem({ id: "X0", name: "Insert 0", h: 80 }, 1);
    ro.measureAll();
    expect(rowHeights(container)).toEqual([150, 80, 60, 120]);

    // Append A0 (height 190)
    list.appendItems([{ id: "A0", name: "Append 0", h: 190 }]);
    ro.measureAll();
    expect(rowHeights(container)).toEqual([150, 80, 60, 120, 190]);
  });

  it.serial("groups: updateItem remeasures the item with its new height", () => {
    const ro = captureResizeObserver();
    const initialItems: TestRow[] = [
      { id: "I0", name: "Item 0", h: 60 },
      { id: "I1", name: "Item 1", h: 90 },
      { id: "I2", name: "Item 2", h: 120 },
    ];
    const { container, list } = makeGroupedList(initialItems);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    expect(rowHeights(container)).toEqual([60, 90, 120]);

    list.updateItem("I1", { h: 220 });
    ro.measureAll();

    expect(rowHeights(container)).toEqual([60, 220, 120]);
  });

  it.serial("groups: data() replacing placeholder with loaded item measures real item content", async () => {
    const ro = captureResizeObserver();
    const container = createContainer();

    let pageResolve: ((val: { items: TestRow[]; total: number }) => void) | null = null;
    const adapter: VListAdapter<TestRow> = {
      read: () => new Promise((resolve) => {
        pageResolve = resolve;
      }),
    };

    const list = createVList({
      container,
      item: { estimatedHeight: 40, template: itemTemplate },
    }, [
      autosize(),
      groups<TestRow>({
        getGroupForIndex: (i) => (i < 1 ? "A" : "B"),
        header: { height: 30, template: (g) => `<span>${g}</span>` },
      }),
      data({ adapter, autoLoad: false }),
    ]);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    // Initial load: item 0 loaded, item 1 is placeholder
    const loadPromise1 = (list as unknown as DataMethods).loadInitial();
    await new Promise((r) => setTimeout(r, 10));
    pageResolve!({
      items: [{ id: "R0", name: "Real 0", h: 100 }],
      total: 2,
    });
    await loadPromise1;
    ro.measureAll();

    // R0 is 100, placeholder 1 is 40
    expect(rowHeights(container)).toEqual([100, 40]);

    // Reload with both items loaded (R1 replaces placeholder at index 1)
    const reloadPromise = (list as unknown as DataMethods).reload();
    await new Promise((r) => setTimeout(r, 10));
    // AutoLoad is false so reload triggers loadInitial if autoLoad: true or we call loadInitial
    const loadPromise2 = (list as unknown as DataMethods).loadInitial();
    await new Promise((r) => setTimeout(r, 10));
    pageResolve!({
      items: [
        { id: "R0", name: "Real 0", h: 100 },
        { id: "R1", name: "Real 1", h: 180 },
      ],
      total: 2,
    });
    await loadPromise2;
    await reloadPromise;
    ro.measureAll();

    expect(rowHeights(container)).toEqual([100, 180]);
  });
});
