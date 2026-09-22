/**
 * vlist — Grid Plugin Edge Paths
 *
 * The branches of grid() that the mock-context tests never reach, driven
 * through a real createVList: a template that returns a node, a horizontal
 * grid whose cross size changes, updateGrid() on an aspect-ratio grid (a
 * height function fed by the column width), and a smooth scrollToIndex.
 *
 * Safe under `bun test --concurrent`: each test owns its list and container
 * through `scoped()`, the patched ResizeObserver files callbacks per viewport
 * so a test can only resize its own list, and nothing waits on a duration.
 * One test is serial — it replaces the process-wide requestAnimationFrame to
 * step the smooth scroll frame by frame.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { scoped, waitFor, type TestScope } from "../../helpers/scope";
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
let originalResizeObserver: typeof ResizeObserver;
/**
 * The callback core handed to its ResizeObserver, per observed viewport — lets
 * a test resize its own list. Keyed by element so that tests running
 * concurrently never reach each other's observer.
 */
const resizeCallbacks = new WeakMap<Element, ResizeObserverCallback>();

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element): void { resizeCallbacks.set(target, this.callback); }
    unobserve(target: Element): void { resizeCallbacks.delete(target); }
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

// =============================================================================
// Helpers
// =============================================================================

type GridList = VList<TestItem> & GridMethods;

/** Each test owns its list: `scope` destroys it when that test ends, not before. */
function track(scope: TestScope, list: VList<TestItem>, container: HTMLElement): GridList {
  return scope.own(list, container) as GridList;
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
  const target = container.querySelector(".vlist-viewport")!;
  await waitFor(() => resizeCallbacks.has(target), "core to observe the viewport");
  const resizeCallback = resizeCallbacks.get(target)!;
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

  it("mounts the returned node inside the cell", scoped((scope) => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    track(scope, createVList<TestItem>(
      { container, items: createTestItems(12), item: { height: 50, template: nodeTemplate } },
      [grid({ columns: 3 })],
    ), container);

    const first = cell(container, 0);
    expect(first.children.length).toBe(1);
    expect(first.firstElementChild!.tagName).toBe("ARTICLE");
    expect(first.textContent).toBe("Item 1");
    expect(cell(container, 4).textContent).toBe("Item 5");
  }));

  it("replaces the old node when the item changes, instead of stacking a second one", scoped((scope) => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = track(scope, createVList<TestItem>(
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
  }));
});

// =============================================================================
// Horizontal grid — cross-axis resize
// =============================================================================

describe("grid — horizontal grid resized on its cross axis", () => {
  it("re-lays the lanes out along y and keeps the scroll offset on x", scoped(async (scope) => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    track(scope, createVList<TestItem>(
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
  }));
});

// =============================================================================
// updateGrid() on an aspect-ratio grid
// =============================================================================

describe("grid — updateGrid with a height function", () => {
  function squareGrid(scope: TestScope, config: { columns: number; gap?: number }) {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const seen: GridSizeContext[] = [];
    const list = track(scope, createVList<TestItem>(
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

  it("changing the column count keeps the cells square and re-measures every row", scoped((scope) => {
    const { list, container, contentHeight } = squareGrid(scope, { columns: 3 });
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
  }));

  it("hands the height function the new columns, gap and column width", scoped((scope) => {
    const { list, seen } = squareGrid(scope, { columns: 3 });
    seen.length = 0;

    list.updateGrid({ columns: 4, gap: 20 });

    expect(seen.length).toBeGreaterThan(0);
    for (const context of seen) {
      expect(context.columns).toBe(4);
      expect(context.gap).toBe(20);
      // (300 - 3 × 20) / 4
      expect(context.columnWidth).toBe(60);
    }
  }));

  function askedAfterRegrid(scope: TestScope, columns: number): number[] {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const asked = new Set<number>();
    const list = track(scope, createVList<TestItem>(
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

  it("asks the height function about the first item of each row under the new column count", scoped((scope) => {
    const asked = askedAfterRegrid(scope, 4);

    // Twelve items in four columns: rows start at items 0, 4 and 8 — not at
    // 0, 3, 6, 9 as they did under three columns.
    expect(asked).toEqual(expect.arrayContaining([0, 4, 8]));
    for (const index of asked) expect(index % 4).toBe(0);
  }));

  // BUG (reported with FLO-168, not fixed here): ctx.sizes.setConfig() builds
  // the new cache for `totalItems` rows before grid shrinks it to the row count,
  // so the height function is asked about items 12, 16 … 44 of a twelve-item
  // list. A function that reads its item (`items[index].ratio`) throws there —
  // at creation too, where core logs `plugin "grid" setup failed` and carries on
  // without a grid.
  it.todo("never asks the height function about an item past the end of the data", scoped((scope) => {
    expect(askedAfterRegrid(scope, 4)).toEqual([0, 4, 8]);
  }));

  it("a new gap widens the row pitch without stretching the cells", scoped((scope) => {
    const { list, container, contentHeight } = squareGrid(scope, { columns: 3 });

    list.updateGrid({ gap: 30 });

    // (300 - 2 × 30) / 3 = 80px columns, so 80px cells on a 110px pitch.
    const fourth = cell(container, 3);
    expect(fourth.style.width).toBe("80px");
    expect(fourth.style.height).toBe("80px");
    expect(translate(fourth)).toEqual({ x: 0, y: 110 });
    expect(translate(cell(container, 4))).toEqual({ x: 110, y: 110 });
    // 14 rows of 80px with 13 gaps between them — no trailing gap.
    expect(contentHeight()).toBe(14 * 80 + 13 * 30);
  }));

  it("a container resize re-measures the rows of an aspect-ratio grid", scoped(async (scope) => {
    const { container, contentHeight } = squareGrid(scope, { columns: 3 });

    await resizeViewport(container, 600, HEIGHT);

    const fourth = cell(container, 3);
    expect(fourth.style.height).toBe("200px");
    expect(translate(fourth)).toEqual({ x: 0, y: 200 });
    expect(contentHeight()).toBe(14 * 200);
  }));
});

// =============================================================================
// Smooth scrollToIndex
// =============================================================================

describe("grid — smooth scrollToIndex", () => {
  function tallGrid(scope: TestScope) {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = track(scope, createVList<TestItem>(
      { container, items: createTestItems(300), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 })],
    ), container);
    return { list, container };
  }

  /**
   * Own the frames: the animation advances only when the test says so, to the
   * timestamp the test gives. requestAnimationFrame is one per process, so the
   * test that uses this is serial and puts the original back when it ends.
   */
  function manualFrames(scope: TestScope) {
    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    globalThis.requestAnimationFrame = (callback): number => {
      pending.set(++nextId, callback);
      return nextId;
    };
    globalThis.cancelAnimationFrame = (id): void => { pending.delete(id); };
    scope.defer(() => {
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
    });
    return {
      /** Run the frames queued so far, as if the clock read `timestamp`. */
      frame(timestamp: number): void {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(timestamp);
      },
    };
  }

  // Serial: patches the process-wide requestAnimationFrame.
  it.serial("travels to the item's row over the duration instead of jumping", scoped((scope) => {
    const { list, container } = tallGrid(scope);
    const frames = manualFrames(scope);
    const startedAt = performance.now();

    // Item 150 is the first of row 50: 50 rows × 50px.
    list.scrollToIndex(150, { align: "start", behavior: "smooth", duration: 200 });
    // Nothing has moved until a frame runs: it did not jump.
    expect(list.getScrollPosition()).toBe(0);

    frames.frame(startedAt + 100);
    const midway = list.getScrollPosition();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(2500);

    frames.frame(startedAt + 1000);
    expect(list.getScrollPosition()).toBe(2500);
    // The row the caller asked for is what ends up at the top of the viewport.
    expect(translate(cell(container, 150)).y).toBe(2500);
    expect(translate(cell(container, 152))).toEqual({ x: 200, y: 2500 });
  }));

  it("an instant scrollToIndex lands on the row at once", scoped((scope) => {
    const { list, container } = tallGrid(scope);

    list.scrollToIndex(150, { align: "start" });

    expect(list.getScrollPosition()).toBe(2500);
    expect(translate(cell(container, 150)).y).toBe(2500);
  }));

  // BUG (reported with FLO-168, not fixed here): core animates a smooth scroll
  // with no duration over its default; grid() only animates when a duration is
  // given, so `{ behavior: "smooth" }` alone jumps. groups() and masonry() share
  // the same condition.
  it.todo("behavior: smooth without a duration still animates, as a plain list does", scoped((scope) => {
    const { list } = tallGrid(scope);

    list.scrollToIndex(150, { align: "start", behavior: "smooth" });

    // An animation has not moved yet when the call returns; a jump already has.
    expect(list.getScrollPosition()).toBe(0);
  }));
});
