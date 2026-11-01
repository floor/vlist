/**
 * vlist — remeasureItem(): per-item size re-read
 *
 * The issue's repro: a table row's content changes to need a different height
 * (an editor grows, say). The item's data is not rewritten — the row's data
 * lives in a side map while a control inside it is focused — so no update path
 * exists that would re-read the size spec. `remeasureItem(index)` asks the
 * owning size source for one fresh size and makes the layout observe it: the
 * mounted row keeps its element and its focus, and every later row moves.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { table } from "../../src/plugins/table/plugin";
import { autosize } from "../../src/plugins/autosize/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import { carousel } from "../../src/plugins/carousel/plugin";
import { groups } from "../../src/plugins/groups/plugin";

// =============================================================================
// Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM({ width: 300, height: 500 });
  geometry = capturePrototypeGeometry();
  // Core reads the viewport's client box at creation. happy-dom reports 0
  // unless the prototype answers, as in the other integration suites.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 500; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 300; },
    configurable: true,
  });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
afterAll(() => geometry.assertRestored());

// =============================================================================
// Fixtures
// =============================================================================

const COLUMNS = [{ key: "name", label: "Name", width: 200 }];

interface TableFixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** Per-index height overrides read by the plugin's `rowHeight` function. */
  readonly heights: number[];
  row(index: number): HTMLElement | null;
  content(): HTMLElement;
  dispose(): void;
}

/** A plain table over 30 items, all 40px until a test writes `heights`. */
function buildTable(count = 30): TableFixture {
  const heights: number[] = [];
  const container = createContainer({ width: 300, height: 500 });
  const list = createVList<TestItem>(
    {
      container,
      items: createTestItems(count),
      item: { height: 40, template: simpleTemplate },
    },
    [
      table({
        columns: COLUMNS,
        rowHeight: (index: number) => heights[index] ?? 40,
        headerHeight: 20,
      }),
    ],
  );
  return {
    list,
    container,
    heights,
    row(index: number): HTMLElement | null {
      return container.querySelector<HTMLElement>(`.vlist-table-row[data-index="${index}"]`);
    },
    content(): HTMLElement {
      return container.querySelector<HTMLElement>(".vlist-content")!;
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

interface CoreFixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** Per-index height overrides read by the item's height function. */
  readonly heights: number[];
  /** How many times the height function has been called. */
  readonly specCalls: () => number;
  item(index: number): HTMLElement | null;
  content(): HTMLElement;
  dispose(): void;
}

/** A plain core list whose height is a function, 40px until a test writes `heights`. */
function buildCore(count = 30): CoreFixture {
  const heights: number[] = [];
  let calls = 0;
  const container = createContainer({ width: 300, height: 500 });
  const list = createVList<TestItem>({
    container,
    items: createTestItems(count),
    item: {
      height: (index: number) => {
        calls++;
        return heights[index] ?? 40;
      },
      template: simpleTemplate,
    },
  });
  return {
    list,
    container,
    heights,
    specCalls: () => calls,
    item(index: number): HTMLElement | null {
      return container.querySelector<HTMLElement>(`.vlist-item[data-index="${index}"]`);
    },
    content(): HTMLElement {
      return container.querySelector<HTMLElement>(".vlist-content")!;
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

// =============================================================================
// The issue's repro
// =============================================================================

describe("remeasureItem — table with a function rowHeight", () => {
  it("grows a mounted row in place and moves the rows after it", () => {
    const f = buildTable();
    try {
      const row2 = f.row(2);
      const row3 = f.row(3);
      const row4 = f.row(4);
      expect(row2).not.toBeNull();
      expect(row3).not.toBeNull();
      expect(row4).not.toBeNull();

      // Before: 30 rows of 40px, content 1200px.
      expect(row2!.style.height).toBe("40px");
      expect(row2!.style.transform).toBe("translateY(80px)");
      expect(row3!.style.transform).toBe("translateY(120px)");
      expect(f.content().style.height).toBe("1200px");

      // The content now needs 80px, but no item data was written: the new
      // height is only visible to the size function.
      f.heights[2] = 80;
      expect(f.list.remeasureItem(2)).toBe(true);

      // The same element, updated in place — not recreated, no template re-run.
      expect(f.row(2)).toBe(row2);
      expect(row2!.style.height).toBe("80px");

      // Every later row moved down by the delta.
      expect(row3!.style.transform).toBe("translateY(160px)");
      expect(row4!.style.transform).toBe("translateY(200px)");

      // The scroll content grew with it.
      expect(f.content().style.height).toBe("1240px");
    } finally {
      f.dispose();
    }
  });
});

// =============================================================================
// Core list
// =============================================================================

describe("remeasureItem — core list", () => {
  it("grows a mounted item in place and moves the item after it", () => {
    const f = buildCore();
    try {
      const item2 = f.item(2);
      const item3 = f.item(3);
      expect(item2).not.toBeNull();
      expect(item3).not.toBeNull();
      expect(item2!.style.height).toBe("40px");
      expect(item3!.style.transform).toBe("translateY(120px)");
      expect(f.content().style.height).toBe("1200px");

      f.heights[2] = 80;
      expect(f.list.remeasureItem(2)).toBe(true);

      // In place (pipeline.ts:392-402): same element, new height, later
      // transforms moved by the delta.
      expect(f.item(2)).toBe(item2);
      expect(item2!.style.height).toBe("80px");
      expect(item3!.style.transform).toBe("translateY(160px)");
      expect(f.content().style.height).toBe("1240px");
    } finally {
      f.dispose();
    }
  });

  it("reads the spec once and relayouts nothing when the size did not change", () => {
    const f = buildCore();
    try {
      // Exactly one read is the unchanged-size guard. An invalidation would
      // re-read the block (30 items here); a force render would read every
      // visible item again.
      const before = f.specCalls();
      expect(f.list.remeasureItem(2)).toBe(true);
      expect(f.specCalls() - before).toBe(1);
      expect(f.item(2)!.style.height).toBe("40px");
    } finally {
      f.dispose();
    }
  });

  it("keeps the anchored content still when an item above the viewport changes", () => {
    const f = buildCore();
    try {
      f.list.scrollToIndex(5, "start");
      expect(f.list.getScrollPosition()).toBe(200);

      // Item 1 is above the viewport: the viewport scrolls by the delta, so
      // item 5 (at the top) keeps its place on screen.
      f.heights[1] = 80;
      expect(f.list.remeasureItem(1)).toBe(true);
      expect(f.list.getScrollPosition()).toBe(240);
      expect(f.item(5)!.style.transform).toBe("translateY(240px)");

      // Item 6 is below the viewport: nothing moves.
      f.heights[6] = 80;
      expect(f.list.remeasureItem(6)).toBe(true);
      expect(f.list.getScrollPosition()).toBe(240);
      expect(f.item(5)!.style.transform).toBe("translateY(240px)");
    } finally {
      f.dispose();
    }
  });

  it("returns false for a fixed spec", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>({
      container,
      items: createTestItems(10),
      item: { height: 40, template: simpleTemplate },
    });
    try {
      expect(list.remeasureItem(0)).toBe(false);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("returns false for an index outside the data space, and never throws", () => {
    const f = buildCore(10);
    try {
      expect(f.list.remeasureItem(-1)).toBe(false);
      expect(f.list.remeasureItem(10)).toBe(false);
      expect(f.list.remeasureItem(1.5)).toBe(false);
      expect(f.list.remeasureItem(NaN)).toBe(false);
      expect(f.list.remeasureItem(Infinity)).toBe(false);
      expect(f.item(0)!.style.height).toBe("40px");
    } finally {
      f.dispose();
    }
  });

  it("returns false on an empty list", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>({
      container,
      items: [],
      item: { height: (index: number) => 40 + index, template: simpleTemplate },
    });
    try {
      expect(list.remeasureItem(0)).toBe(false);
      expect(list.remeasureItem(-1)).toBe(false);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});

// =============================================================================
// Unsupported size models
// =============================================================================

describe("remeasureItem — unsupported size models", () => {
  interface Built {
    readonly list: VList<TestItem>;
    dispose(): void;
  }

  /** A list whose item height is a function, over `plugin`. */
  function buildWith(plugin: VListPlugin<TestItem>): Built {
    const heights: number[] = [];
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(30),
        item: {
          height: (index: number) => heights[index] ?? 40,
          template: simpleTemplate,
        },
      },
      [plugin],
    );
    return {
      list,
      dispose(): void {
        list.destroy();
        container.remove();
      },
    };
  }

  it("grid(): returns false — the cache is row space, not item space", () => {
    const b = buildWith(grid({ columns: 2 }));
    try {
      expect(b.list.remeasureItem(0)).toBe(false);
      expect(b.list.remeasureItem(17)).toBe(false);
    } finally {
      b.dispose();
    }
  });

  it("masonry(): returns false — placements are a snapshot", () => {
    const b = buildWith(masonry({ columns: 2 }));
    try {
      expect(b.list.remeasureItem(0)).toBe(false);
    } finally {
      b.dispose();
    }
  });

  it("carousel(): returns false — the cache is virtual step space", () => {
    const b = buildWith(carousel({}));
    try {
      expect(b.list.remeasureItem(0)).toBe(false);
    } finally {
      b.dispose();
    }
  });
});

// =============================================================================
// Autosize delegation
// =============================================================================

describe("remeasureItem — autosize delegation", () => {
  type AutosizedList = VList<TestItem> & {
    setMeasuredSize(index: number, size: number): void;
    isMeasured(index: number): boolean;
    getMeasuredCount(): number;
  };

  interface AutosizedFixture {
    readonly list: AutosizedList;
    readonly container: HTMLElement;
  }

  function buildAutosized(): AutosizedFixture {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList(
      {
        container,
        items: createTestItems(30),
        item: { estimatedHeight: 40, template: simpleTemplate },
      },
      [autosize()],
    );
    return { list, container };
  }

  it("delegates a measured item even though the store reports an unchanged size", () => {
    const f = buildAutosized();
    try {
      f.list.setMeasuredSize(2, 60);
      expect(f.list.isMeasured(2)).toBe(true);

      // The round-2 shape: the store holds a measurement, so a guard that
      // compared the cache with itself would find 60 === 60 and return
      // without asking the owner. The owner must be asked: the item is queued
      // for a fresh measurement, which `isMeasured` reports as false.
      expect(f.list.remeasureItem(2)).toBe(true);
      expect(f.list.isMeasured(2)).toBe(false);
      expect(f.list.getMeasuredCount()).toBe(1);
    } finally {
      f.list.destroy();
      f.container.remove();
    }
  });

  it("returns true for an unmeasured in-range item, which the plugin ignores", () => {
    const f = buildAutosized();
    try {
      expect(f.list.remeasureItem(5)).toBe(true);
      expect(f.list.isMeasured(5)).toBe(false);
      expect(f.list.getMeasuredCount()).toBe(0);
    } finally {
      f.list.destroy();
      f.container.remove();
    }
  });

  it("bounds-checks before delegating", () => {
    const f = buildAutosized();
    try {
      expect(f.list.remeasureItem(-1)).toBe(false);
      expect(f.list.remeasureItem(30)).toBe(false);
      expect(f.list.remeasureItem(0.5)).toBe(false);
    } finally {
      f.list.destroy();
      f.container.remove();
    }
  });

  it("passes the data index under groups()", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList(
      {
        container,
        items: createTestItems(20),
        item: { estimatedHeight: 40, template: simpleTemplate },
      },
      [
        autosize(),
        groups({
          getGroupForIndex: (index: number) => (index < 10 ? "A" : "B"),
          header: { height: 20, template: (key: string) => key },
        }),
      ],
    );
    try {
      // Data item 11 is layout entry 13 (two headers). Measuring it and
      // remeasuring it by the data index must queue that item; a layout index
      // would resolve data item 13 instead, which was never measured.
      list.setMeasuredSize(11, 60);
      expect(list.isMeasured(11)).toBe(true);
      expect(list.remeasureItem(11)).toBe(true);
      expect(list.isMeasured(11)).toBe(false);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});

// =============================================================================
// Groups
// =============================================================================

describe("remeasureItem — groups()", () => {
  const HEADER = 20;

  function buildGrouped(
    height: number | ((index: number) => number),
  ): { list: VList<TestItem>; container: HTMLElement; dispose(): void } {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(20),
        item: { height, template: simpleTemplate },
      },
      [
        groups({
          getGroupForIndex: (index: number) => (index < 10 ? "A" : "B"),
          header: { height: HEADER, template: (key: string) => key },
        }),
      ],
    );
    return {
      list,
      container,
      dispose(): void {
        list.destroy();
        container.remove();
      },
    };
  }

  it("refreshes the sticky header offsets after an invalidation", () => {
    const heights: number[] = [];
    const f = buildGrouped((index: number) => heights[index] ?? 40);
    try {
      const slots = (): string[] =>
        [...f.container.querySelectorAll(".vlist-sticky-header .sticky-group")]
          .map((slot) => slot.textContent ?? "")
          .filter((text) => text.length > 0);
      expect(slots()).toContain("A");

      // At scroll 0, growing item 0 moves every later offset but not its own,
      // so no scroll correction applies (its layout slot is at the top).
      heights[0] = 140;
      expect(f.list.remeasureItem(0)).toBe(true);

      // The grown content is 920px in a 500px viewport, so item 9's start
      // (460) clamps to 420. Group B's header is now at 500: this position is
      // still inside group A. With the offsets cached at setup (400), the
      // same position reads as group B.
      f.list.scrollToIndex(9, "start");
      expect(f.list.getScrollPosition()).toBe(420);
      expect(slots()).toContain("A");
      expect(slots()).not.toContain("B");
    } finally {
      f.dispose();
    }
  });

  it("returns false when the data spec is fixed", () => {
    // The grouped cache is variable either way (headers are wrapped into the
    // spec), so `sizeCache.isVariable()` would say yes; the installed data
    // spec is fixed and has nothing to re-read.
    const f = buildGrouped(40);
    try {
      expect(f.list.remeasureItem(0)).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it("bounds-checks in the data space, not the header-counted engine total", () => {
    const heights: number[] = [];
    const f = buildGrouped((index: number) => heights[index] ?? 40);
    try {
      expect(f.list.total).toBe(20);
      // The engine renders 22 layout entries; data index 20 is past the last
      // item and must not translate into the second header.
      expect(f.list.remeasureItem(20)).toBe(false);
      expect(f.list.remeasureItem(19)).toBe(true);
    } finally {
      f.dispose();
    }
  });
});


describe("remeasureItem — lifecycle", () => {
  it("returns false after destroy without reading the size source", () => {
    const f = buildCore();
    try {
      f.list.destroy();
      const calls = f.specCalls();
      f.heights[2] = 80;
      expect(f.list.remeasureItem(2)).toBe(false);
      expect(f.specCalls()).toBe(calls);
    } finally {
      f.dispose();
    }
  });
});


describe("remeasureItem — scroll limits", () => {
  it("publishes grown content before correcting the anchor at the old scroll limit", () => {
    const f = buildCore();
    try {
      const viewport = f.container.querySelector<HTMLElement>(".vlist-viewport")!;
      let applied = 0;
      // Model a bounded native scroll source: writes cannot exceed the
      // content size currently published to the viewport.
      Object.defineProperty(viewport, "scrollTop", {
        configurable: true,
        get: () => applied,
        set: (value: number) => {
          applied = Math.max(0, Math.min(value, parseFloat(f.content().style.height) - 500));
        },
      });
      f.list.scrollToIndex(29, "end");
      expect(f.list.getScrollPosition()).toBe(700);
      const anchor = f.item(18)!;
      const before = parseFloat(anchor.style.transform.match(/[-\d.]+/)![0]) - 700;
      f.heights[0] = 140;
      expect(f.list.remeasureItem(0)).toBe(true);
      expect(f.content().style.height).toBe("1300px");
      expect(f.list.getScrollPosition()).toBe(800);
      expect(parseFloat(anchor.style.transform.match(/[-\d.]+/)![0]) - 800).toBe(before);
    } finally {
      f.dispose();
    }
  });
});


type SizePairing = "core" | "table" | "groups" | "table + groups";

function buildPairing(pairing: SizePairing) {
  const heights: number[] = [];
  const container = createContainer({ width: 300, height: 500 });
  const size = (index: number): number => heights[index] ?? 40;
  const plugins: VListPlugin<TestItem>[] = [];
  if (pairing.includes("table")) {
    plugins.push(table({ columns: COLUMNS, rowHeight: size, headerHeight: 20 }));
  }
  if (pairing.includes("groups")) {
    plugins.push(groups({
      getGroupForIndex: (index: number) => index < 50 ? "A" : "B",
      header: { height: 20, template: (key: string) => key },
    }));
  }
  const list = createVList<TestItem>({
    container,
    items: createTestItems(100),
    item: { height: size, template: simpleTemplate },
  }, plugins);
  return {
    list, container, heights,
    item(index: number): HTMLElement | null {
      return container.querySelector<HTMLElement>(`.vlist-content [data-id="${index + 1}"]`);
    },
    dispose(): void { list.destroy(); container.remove(); },
  };
}

/** Serial tests only: owns RAF and performance.now for deterministic animation. */
function frameClock() {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  const now = Object.getOwnPropertyDescriptor(performance, "now");
  const pending = new Map<number, FrameRequestCallback>();
  let next = 0;
  let time = performance.now();
  Object.defineProperty(performance, "now", { configurable: true, value: () => time });
  globalThis.requestAnimationFrame = (fn) => { pending.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = (id) => { pending.delete(id); };
  return {
    step(ms: number): void {
      time += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const fn of callbacks) fn(time);
    },
    restore(): void {
      pending.clear();
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
      if (now) Object.defineProperty(performance, "now", now);
      else Reflect.deleteProperty(performance, "now");
    },
  };
}

for (const pairing of ["core", "table", "groups", "table + groups"] as const) {
  it.serial(`remeasureItem — ${pairing}: a smooth jump lands on the resized target offset`, async () => {
    const clock = frameClock();
    const f = buildPairing(pairing);
    try {
      await Promise.resolve();
      clock.step(0);
      f.list.scrollToIndex(50, { behavior: "smooth", duration: 100, easing: (t) => t });
      clock.step(25);
      f.heights[0] = 140;
      expect(f.list.remeasureItem(0)).toBe(true);
      clock.step(75);
      const target = f.item(50)!;
      expect(target).not.toBeNull();
      const numbers = target.style.transform.match(/-?\d+(?:\.\d+)?px/g)!;
      const offset = parseFloat(numbers[target.style.transform.startsWith("translate3d") ? 1 : 0]!);
      expect(f.list.getScrollPosition()).toBeCloseTo(offset, 5);
    } finally {
      f.dispose();
      clock.restore();
    }
  });
}
