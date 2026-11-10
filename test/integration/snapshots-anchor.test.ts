/**
 * vlist — snapshots() restorePosition "anchor" against real lists
 *
 * The unit suite covers the resolver arithmetic. These tests put the anchor
 * behind each plugin's real size cache and translator: groups() (data ordinal
 * through headers, including a row whose layout index is past the data count),
 * table() + groups(), autosize() measurements, grid() rows, carousel()'s
 * virtual laps, a horizontal list, and synthetic input on a large list.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createVList as createSynthetic } from "../../src/synthetic";
import type { VList } from "../../src/core/types";
import { groups } from "../../src/plugins/groups/plugin";
import { table } from "../../src/plugins/table/plugin";
import { autosize } from "../../src/plugins/autosize/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { carousel } from "../../src/plugins/carousel/plugin";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { snapshots, type SnapshotsMethods } from "../../src/plugins/snapshots/plugin";
import type { AutosizeMethods } from "../../src/plugins/autosize/plugin";

// =============================================================================
// Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM({ width: 300, height: 500 });
  geometry = capturePrototypeGeometry();
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
// Helpers
// =============================================================================

type SnapList = VList<TestItem> & SnapshotsMethods;

/** Paint offset of the rendered element for data index `dataIndex`. */
function offsetOf(container: HTMLElement, dataIndex: number): number {
  const el = container.querySelector<HTMLElement>(
    `.vlist-content [data-id="${dataIndex + 1}"]`,
  );
  expect(el).not.toBeNull();
  const m = /(-?[\d.]+)px/.exec(el!.style.transform || "");
  expect(m).not.toBeNull();
  return parseFloat(m![1]!);
}

const COLUMNS = [{ key: "name", label: "Name", width: 200 }];

interface GroupFixture {
  list: SnapList;
  container: HTMLElement;
  /** Per-data-index height overrides read by the item height function. */
  heights: number[];
  dispose(): void;
}

function buildGroups(
  count: number,
  groupFor: (index: number) => string,
  anchor: boolean,
  withTable = false,
): GroupFixture {
  const heights: number[] = [];
  const size = (i: number): number => heights[i] ?? 40;
  const container = createContainer({ width: 300, height: 500 });
  const plugins = [];
  if (withTable) {
    plugins.push(table({ columns: COLUMNS, rowHeight: size, headerHeight: 20 }));
  }
  plugins.push(groups({
    getGroupForIndex: groupFor,
    header: { height: 20, template: (key: string) => key },
  }));
  plugins.push(snapshots(anchor ? { restorePosition: "anchor" } : undefined));
  const list = createVList<TestItem>(
    {
      container,
      items: createTestItems(count),
      item: { height: size, template: simpleTemplate },
    },
    plugins as never,
  ) as SnapList;
  return {
    list,
    container,
    heights,
    dispose(): void { list.destroy(); container.remove(); },
  };
}

// =============================================================================
// groups()
// =============================================================================

describe("snapshots anchor — groups()", () => {
  it("a same-count regroup restores the saved data row, not the saved pixels", async () => {
    // Source: A = 0-49, B = 50-99; capture at the top of data row 60.
    const source = buildGroups(100, (i) => (i < 50 ? "A" : "B"), false);
    let snapshot;
    try {
      await Promise.resolve();
      source.list.scrollToIndex(60, "start");
      snapshot = source.list.getScrollSnapshot();
      expect(snapshot.dataIndex).toBe(60);
    } finally {
      source.dispose();
    }

    // Destination: same 100 data rows, but A now holds five more of them, and
    // row 3 measured 50 px taller while away. The saved pixels land on a
    // different row; the saved ordinal does not.
    const legacy = buildGroups(100, (i) => (i < 55 ? "A" : "B"), false);
    const anchor = buildGroups(100, (i) => (i < 55 ? "A" : "B"), true);
    try {
      for (const f of [legacy, anchor]) {
        f.heights[3] = 90;
        f.list.remeasureItem(3);
      }
      await Promise.resolve();
      await legacy.list.restoreScroll(snapshot);
      await anchor.list.restoreScroll(snapshot);
      expect(legacy.list.getScrollPosition()).toBe(snapshot.scrollTop!);
      expect(anchor.list.getScrollPosition()).toBe(offsetOf(anchor.container, 60));
      expect(anchor.list.getScrollPosition()).not.toBe(snapshot.scrollTop!);
      expect(anchor.list.getScrollSnapshot().dataIndex).toBe(60);
    } finally {
      legacy.dispose();
      anchor.dispose();
    }
  });

  it("an earlier group gaining rows leaves the ordinals alone", async () => {
    // Five rows are inserted into group A: every later row keeps its ordinal,
    // and the anchor restores that ordinal in the new geometry.
    const source = buildGroups(100, (i) => (i < 50 ? "A" : "B"), false);
    let snapshot;
    try {
      await Promise.resolve();
      source.list.scrollToIndex(60, "start");
      snapshot = source.list.getScrollSnapshot();
    } finally {
      source.dispose();
    }

    const dest = buildGroups(105, (i) => (i < 55 ? "A" : "B"), true);
    try {
      dest.heights[3] = 90;
      dest.list.remeasureItem(3);
      await Promise.resolve();
      await dest.list.restoreScroll(snapshot);
      expect(dest.list.getScrollPosition()).toBe(offsetOf(dest.container, 60));
      expect(dest.list.getScrollPosition()).not.toBe(snapshot.scrollTop!);
    } finally {
      dest.dispose();
    }
  });

  it("anchors a row whose layout index is past the data count", async () => {
    // 50 groups of two rows: 50 headers push data row 67 to layout index 101,
    // one past state.totalItems (100). Bounding the layout index by the data
    // count instead of the size cache would fall back to the pixels.
    const groupFor = (i: number): string => `G${Math.floor(i / 2)}`;
    const source = buildGroups(100, groupFor, false);
    let snapshot;
    try {
      await Promise.resolve();
      source.list.scrollToIndex(67, "start");
      snapshot = source.list.getScrollSnapshot();
      expect(snapshot.dataIndex).toBe(67);
      expect(snapshot.index).toBeGreaterThan(100);
    } finally {
      source.dispose();
    }

    const dest = buildGroups(100, groupFor, true);
    try {
      dest.heights[10] = 90;
      dest.list.remeasureItem(10);
      await Promise.resolve();
      await dest.list.restoreScroll(snapshot);
      expect(dest.list.getScrollPosition()).toBe(offsetOf(dest.container, 67));
      expect(dest.list.getScrollPosition()).toBe(snapshot.scrollTop! + 50);
    } finally {
      dest.dispose();
    }
  });

  it("table() + groups(): the same regroup lands the same row", async () => {
    const source = buildGroups(100, (i) => (i < 50 ? "A" : "B"), false, true);
    let snapshot;
    try {
      await Promise.resolve();
      source.list.scrollToIndex(60, "start");
      snapshot = source.list.getScrollSnapshot();
      expect(snapshot.dataIndex).toBe(60);
    } finally {
      source.dispose();
    }

    const legacy = buildGroups(100, (i) => (i < 55 ? "A" : "B"), false, true);
    const anchor = buildGroups(100, (i) => (i < 55 ? "A" : "B"), true, true);
    try {
      for (const f of [legacy, anchor]) {
        f.heights[3] = 90;
        f.list.remeasureItem(3);
      }
      await Promise.resolve();
      await legacy.list.restoreScroll(snapshot);
      await anchor.list.restoreScroll(snapshot);
      expect(legacy.list.getScrollPosition()).toBe(snapshot.scrollTop!);
      expect(anchor.list.getScrollPosition()).toBe(offsetOf(anchor.container, 60));
      expect(anchor.list.getScrollPosition()).toBe(snapshot.scrollTop! + 50);
    } finally {
      legacy.dispose();
      anchor.dispose();
    }
  });
});

// =============================================================================
// autosize()
// =============================================================================

// Serial: replaces the process-wide ResizeObserver.
it.serial("snapshots anchor — autosize(): a measurement above the row moves the row", async () => {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  const container = createContainer({ width: 300, height: 500 });
  const list = createVList<TestItem>(
    {
      container,
      items: createTestItems(100),
      item: { estimatedHeight: 40, template: simpleTemplate },
    },
    [autosize(), snapshots({ restorePosition: "anchor" })] as never,
  ) as SnapList & AutosizeMethods;
  try {
    await Promise.resolve();
    list.scrollToIndex(20, "start");
    const snapshot = list.getScrollSnapshot();
    expect(snapshot.index).toBe(20);

    // autosize() records a real measurement 100 px taller above the anchor.
    list.setMeasuredSize(3, 140);
    list.scrollToIndex(0);
    await list.restoreScroll(snapshot);

    expect(list.getScrollPosition()).toBe(offsetOf(container, 20));
    expect(list.getScrollPosition()).toBe(snapshot.scrollTop! + 100);
  } finally {
    list.destroy();
    container.remove();
    globalThis.ResizeObserver = original;
  }
});

// =============================================================================
// grid(), carousel(), horizontal, synthetic
// =============================================================================

it("snapshots anchor — grid(): row-space anchor survives a taller row above", async () => {
  const make = (heights: number[]): { list: SnapList; container: HTMLElement; dispose(): void } => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: (i: number) => heights[i] ?? 100, template: simpleTemplate },
      },
      [grid({ columns: 2 }), snapshots({ restorePosition: "anchor" })] as never,
    ) as SnapList;
    return { list, container, dispose(): void { list.destroy(); container.remove(); } };
  };

  const source = make([]);
  let snapshot;
  try {
    await Promise.resolve();
    source.list.scrollToIndex(20, "start");
    snapshot = source.list.getScrollSnapshot();
    // The snapshot is taken in row space: data row 20 starts grid row 10.
    expect(snapshot.index).toBe(10);
    expect(snapshot.scrollTop).toBe(1000);
  } finally {
    source.dispose();
  }

  // Item 2 starts grid row 1, which is 200 px taller.
  const heights: number[] = [];
  heights[2] = 300;
  const dest = make(heights);
  try {
    await Promise.resolve();
    await dest.list.restoreScroll(snapshot);
    expect(dest.list.getScrollPosition()).toBe(1200);
    expect(dest.container.querySelector<HTMLElement>(".vlist-content")!.style.height).toBe("5200px");
  } finally {
    dest.dispose();
  }
});

it("snapshots anchor — carousel(): the real index anchors, not the virtual lap", async () => {
  const container = createContainer({ width: 300, height: 500 });
  const list = createVList<TestItem>(
    {
      container,
      orientation: "horizontal",
      items: createTestItems(30),
      item: { width: 300, height: 500, template: simpleTemplate },
    },
    [carousel(), snapshots({ restorePosition: "anchor" })] as never,
  ) as SnapList;
  try {
    await Promise.resolve();
    list.scrollToIndex(10, "start");
    const snapshot = list.getScrollSnapshot();
    // The carousel's layout index runs through three virtual laps; the saved
    // data index is the real one.
    expect(snapshot.dataIndex).toBe(10);
    expect(snapshot.index).not.toBe(10);

    list.scrollToIndex(25, "start");
    await list.restoreScroll(snapshot);
    const after = list.getScrollSnapshot();
    expect(after.dataIndex).toBe(10);
    expect(list.getScrollPosition()).toBe(snapshot.scrollTop!);
  } finally {
    list.destroy();
    container.remove();
  }
});

it("snapshots anchor — horizontal: a wider row above moves the anchor", async () => {
  const make = (widths: number[], anchor: boolean): { list: SnapList; container: HTMLElement; dispose(): void } => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>(
      {
        container,
        orientation: "horizontal",
        items: createTestItems(100),
        item: { width: (i: number) => widths[i] ?? 40, height: 100, template: simpleTemplate },
      },
      [snapshots(anchor ? { restorePosition: "anchor" } : undefined)] as never,
    ) as SnapList;
    return { list, container, dispose(): void { list.destroy(); container.remove(); } };
  };

  const source = make([], false);
  let snapshot;
  try {
    await Promise.resolve();
    source.list.scrollToIndex(20, "start");
    snapshot = source.list.getScrollSnapshot();
    expect(snapshot.scrollTop).toBe(800);
  } finally {
    source.dispose();
  }

  const widths: number[] = [];
  widths[3] = 90;
  const legacy = make(widths, false);
  const anchor = make(widths, true);
  try {
    await Promise.resolve();
    await legacy.list.restoreScroll(snapshot);
    await anchor.list.restoreScroll(snapshot);
    expect(legacy.list.getScrollPosition()).toBe(800);
    expect(anchor.list.getScrollPosition()).toBe(850);
  } finally {
    legacy.dispose();
    anchor.dispose();
  }
});

it("snapshots anchor — synthetic: a deep round-trip keeps the row, not a native offset", async () => {
  const TOTAL = 500_000;
  const container = createContainer({ width: 300, height: 500 });
  const list = createSynthetic<TestItem>(
    {
      container,
      item: { height: 40, template: simpleTemplate },
    },
    [
      dataPlugin<TestItem>({
        total: TOTAL,
        autoLoad: false,
        adapter: {
          read: async ({ offset, limit }: { offset: number; limit: number }) => {
            const items: TestItem[] = [];
            for (let i = offset; i < Math.min(offset + limit, TOTAL); i++) {
              items.push({ id: i + 1, name: `Item ${i + 1}` });
            }
            return { items, total: TOTAL, hasMore: offset + limit < TOTAL };
          },
        },
      }),
      snapshots({ restorePosition: "anchor" }),
    ] as never,
  ) as SnapList;
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    (list as unknown as { setTotal(total: number): void }).setTotal(TOTAL);
    list.scrollToIndex(200_000, "start");
    await (list as unknown as { loadVisibleRange(): Promise<void> }).loadVisibleRange();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const snapshot = list.getScrollSnapshot();
    expect(snapshot.index).toBe(200_000);
    expect(snapshot.scrollTop).toBe(8_000_000);
    // Synthetic input paints a viewport-sized surface: the position is
    // logical, not a native scroll offset.
    const content = container.querySelector<HTMLElement>(".vlist-content")!;
    expect(content.style.height).not.toBe(`${TOTAL * 40}px`);

    list.scrollToIndex(0);
    await list.restoreScroll(snapshot);
    expect(list.getScrollPosition()).toBe(8_000_000);
    expect(list.getScrollSnapshot().index).toBe(200_000);
  } finally {
    list.destroy();
    container.remove();
  }
});
