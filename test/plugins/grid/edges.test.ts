/**
 * vlist — Grid Plugin Edge Paths
 *
 * The branches of grid() that the mock-context tests never reach, driven
 * through a real createVList: a template that returns a node, a horizontal
 * grid whose cross size changes, updateGrid() on an aspect-ratio grid (a
 * height function fed by the column width), and a smooth scrollToIndex.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { advanceTimers } from "../../helpers/timers";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import type { GridSizeContext } from "../../../src/types";
import { grid, type GridMethods } from "../../../src/plugins/grid";

// =============================================================================
// DOM Setup
// =============================================================================

const WIDTH = 300;
const HEIGHT = 500;

let geometry: ReturnType<typeof capturePrototypeGeometry>;
/** The callback core handed to its ResizeObserver — lets a test resize the viewport. */
let resizeCallback: ResizeObserverCallback | null = null;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
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

type GridList = VList<TestItem> & GridMethods;

let open: Array<{ list: VList<TestItem>; container: HTMLElement }> = [];
afterEach(() => {
  for (const { list, container } of open) {
    list.destroy();
    container.remove();
  }
  open = [];
  resizeCallback = null;
});

function track(list: VList<TestItem>, container: HTMLElement): GridList {
  open.push({ list, container });
  return list as GridList;
}

function cell(container: HTMLElement, index: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (!el) throw new Error(`grid cell ${index} is not rendered`);
  return el;
}

function translate(el: HTMLElement): { x: number; y: number } {
  const m = /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(el.style.transform);
  if (!m) throw new Error(`no translate() on cell: "${el.style.transform}"`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Core creates its ResizeObserver on the next task; wait for it, then resize. */
async function resizeViewport(container: HTMLElement, width: number, height: number): Promise<void> {
  await advanceTimers(5);
  if (!resizeCallback) throw new Error("core did not create a ResizeObserver");
  const target = container.querySelector(".vlist-viewport")!;
  resizeCallback(
    [{ target, contentRect: { width, height } } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  );
}

/** Square cells: the row is as tall as a column is wide. */
const squareHeight = (_index: number, context?: GridSizeContext): number =>
  context ? context.columnWidth : 100;

// =============================================================================
// A template that returns a node
// =============================================================================

describe("grid — a template that returns an element", () => {
  const nodeTemplate = (item: TestItem): HTMLElement => {
    const el = document.createElement("article");
    el.className = "card";
    el.textContent = item.name;
    return el;
  };

  it("mounts the returned node inside the cell", () => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    track(createVList<TestItem>(
      { container, items: createTestItems(12), item: { height: 50, template: nodeTemplate } },
      [grid({ columns: 3 })],
    ), container);

    const first = cell(container, 0);
    expect(first.children.length).toBe(1);
    expect(first.firstElementChild!.tagName).toBe("ARTICLE");
    expect(first.textContent).toBe("Item 1");
    expect(cell(container, 4).textContent).toBe("Item 5");
  });

  it("replaces the old node when the item changes, instead of stacking a second one", () => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = track(createVList<TestItem>(
      { container, items: createTestItems(12), item: { height: 50, template: nodeTemplate } },
      [grid({ columns: 3 })],
    ), container);
    const before = cell(container, 1);

    list.updateItem(2, { name: "Renamed" });

    const after = cell(container, 1);
    // Same cell, one card, new text: a re-render must not append next to the old node.
    expect(after).toBe(before);
    expect(after.querySelectorAll(".card").length).toBe(1);
    expect(after.textContent).toBe("Renamed");
  });
});

// =============================================================================
// Horizontal grid — cross-axis resize
// =============================================================================

describe("grid — horizontal grid resized on its cross axis", () => {
  it("re-lays the lanes out along y and keeps the scroll offset on x", async () => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    track(createVList<TestItem>(
      {
        container,
        items: createTestItems(24),
        orientation: "horizontal",
        item: { width: 100, height: HEIGHT, template: simpleTemplate },
      },
      [grid({ columns: 2 })],
    ), container);

    // Two lanes share the 500px cross size: item 1 sits in the second lane of
    // the first column (x = 0, y = 250), item 2 opens the second column.
    expect(translate(cell(container, 1))).toEqual({ x: 0, y: 250 });
    expect(translate(cell(container, 2))).toEqual({ x: 100, y: 0 });
    expect(cell(container, 1).style.height).toBe("250px");

    // The viewport grows taller; the main axis (width) does not move.
    await resizeViewport(container, WIDTH, 800);

    // Lanes are 400px now. A swapped axis would have put 400 on x.
    expect(translate(cell(container, 1))).toEqual({ x: 0, y: 400 });
    expect(translate(cell(container, 2))).toEqual({ x: 100, y: 0 });
    expect(translate(cell(container, 3))).toEqual({ x: 100, y: 400 });
    expect(cell(container, 1).style.height).toBe("400px");
    expect(cell(container, 1).style.width).toBe("100px");
  });
});

// =============================================================================
// updateGrid() on an aspect-ratio grid
// =============================================================================

describe("grid — updateGrid with a height function", () => {
  function squareGrid(config: { columns: number; gap?: number }) {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const seen: GridSizeContext[] = [];
    const list = track(createVList<TestItem>(
      {
        container,
        items: createTestItems(40),
        item: {
          height: (index, context) => {
            if (context) seen.push({ ...context });
            return squareHeight(index, context);
          },
          template: simpleTemplate,
        },
      },
      [grid(config)],
    ), container);
    const contentHeight = (): number =>
      parseFloat(container.querySelector<HTMLElement>(".vlist-content")!.style.height);
    return { list, container, seen, contentHeight };
  }

  it("changing the column count keeps the cells square and re-measures every row", () => {
    const { list, container, contentHeight } = squareGrid({ columns: 3 });
    // 3 columns of 100px: 14 rows of 100px.
    expect(cell(container, 3).style.height).toBe("100px");
    expect(translate(cell(container, 3))).toEqual({ x: 0, y: 100 });
    expect(contentHeight()).toBe(1400);

    list.updateGrid({ columns: 2 });

    // 2 columns of 150px: the rows grow with the columns, 20 rows of 150px.
    const third = cell(container, 2);
    expect(third.style.width).toBe("150px");
    expect(third.style.height).toBe("150px");
    expect(translate(third)).toEqual({ x: 0, y: 150 });
    expect(translate(cell(container, 5))).toEqual({ x: 150, y: 300 });
    expect(contentHeight()).toBe(3000);
  });

  it("hands the height function the new columns, gap and column width", () => {
    const { list, seen } = squareGrid({ columns: 3 });
    seen.length = 0;

    list.updateGrid({ columns: 4, gap: 20 });

    expect(seen.length).toBeGreaterThan(0);
    for (const context of seen) {
      expect(context.columns).toBe(4);
      expect(context.gap).toBe(20);
      // (300 - 3 × 20) / 4
      expect(context.columnWidth).toBe(60);
    }
  });

  function askedAfterRegrid(columns: number): number[] {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const asked = new Set<number>();
    const list = track(createVList<TestItem>(
      {
        container,
        items: createTestItems(12),
        item: {
          height: (index) => {
            asked.add(index);
            return 50;
          },
          template: simpleTemplate,
        },
      },
      [grid({ columns: 3 })],
    ), container);
    asked.clear();

    list.updateGrid({ columns });

    return [...asked].sort((a, b) => a - b);
  }

  it("asks the height function about the first item of each row under the new column count", () => {
    const asked = askedAfterRegrid(4);

    // Twelve items in four columns: rows start at items 0, 4 and 8 — not at
    // 0, 3, 6, 9 as they did under three columns.
    expect(asked).toEqual(expect.arrayContaining([0, 4, 8]));
    for (const index of asked) expect(index % 4).toBe(0);
  });

  // BUG (reported with FLO-168, not fixed here): ctx.sizes.setConfig() builds
  // the new cache for `totalItems` rows before grid shrinks it to the row count,
  // so the height function is asked about items 12, 16 … 44 of a twelve-item
  // list. A function that reads its item (`items[index].ratio`) throws there —
  // at creation too, where core logs `plugin "grid" setup failed` and carries on
  // without a grid.
  it.todo("never asks the height function about an item past the end of the data", () => {
    expect(askedAfterRegrid(4)).toEqual([0, 4, 8]);
  });

  it("a new gap widens the row pitch without stretching the cells", () => {
    const { list, container, contentHeight } = squareGrid({ columns: 3 });

    list.updateGrid({ gap: 30 });

    // (300 - 2 × 30) / 3 = 80px columns, so 80px cells on a 110px pitch.
    const fourth = cell(container, 3);
    expect(fourth.style.width).toBe("80px");
    expect(fourth.style.height).toBe("80px");
    expect(translate(fourth)).toEqual({ x: 0, y: 110 });
    expect(translate(cell(container, 4))).toEqual({ x: 110, y: 110 });
    // 14 rows of 80px with 13 gaps between them — no trailing gap.
    expect(contentHeight()).toBe(14 * 80 + 13 * 30);
  });

  // BUG (reported with FLO-168, not fixed here): core re-renders before it runs
  // the resize hooks, so grid rebuilds its row sizes from the old container
  // width, then restyles the cells from the new one. The cells come out 200px
  // tall on a 100px row pitch — rows overlap — and the content height stays 1400.
  it.todo("a container resize re-measures the rows of an aspect-ratio grid", async () => {
    const { container, contentHeight } = squareGrid({ columns: 3 });

    await resizeViewport(container, 600, HEIGHT);

    const fourth = cell(container, 3);
    expect(fourth.style.height).toBe("200px");
    expect(translate(fourth)).toEqual({ x: 0, y: 200 });
    expect(contentHeight()).toBe(14 * 200);
  });
});

// =============================================================================
// Smooth scrollToIndex
// =============================================================================

describe("grid — smooth scrollToIndex", () => {
  function tallGrid() {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = track(createVList<TestItem>(
      { container, items: createTestItems(300), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 })],
    ), container);
    return { list, container };
  }

  it("travels to the item's row over the duration instead of jumping", async () => {
    const { list, container } = tallGrid();

    // Item 150 is the first of row 50: 50 rows × 50px.
    list.scrollToIndex(150, { align: "start", behavior: "smooth", duration: 200 });

    await advanceTimers(40);
    const midway = list.getScrollPosition();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(2500);

    await advanceTimers(400);
    expect(list.getScrollPosition()).toBe(2500);
    // The row the caller asked for is what ends up at the top of the viewport.
    expect(translate(cell(container, 150)).y).toBe(2500);
    expect(translate(cell(container, 152))).toEqual({ x: 200, y: 2500 });
  });

  it("an instant scrollToIndex lands on the row at once", () => {
    const { list, container } = tallGrid();

    list.scrollToIndex(150, { align: "start" });

    expect(list.getScrollPosition()).toBe(2500);
    expect(translate(cell(container, 150)).y).toBe(2500);
  });

  // BUG (reported with FLO-168, not fixed here): core animates a smooth scroll
  // with no duration over its default; grid() only animates when a duration is
  // given, so `{ behavior: "smooth" }` alone jumps. groups() and masonry() share
  // the same condition.
  it.todo("behavior: smooth without a duration still animates, as a plain list does", async () => {
    const { list } = tallGrid();

    list.scrollToIndex(150, { align: "start", behavior: "smooth" });

    await advanceTimers(20);
    expect(list.getScrollPosition()).toBeLessThan(2500);
  });
});
