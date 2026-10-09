/**
 * vlist — groups() + autosize() integration tests (#363)
 *
 * With groups() seated, autosize keyed its measurements in the DATA index
 * space (and the grouped size cache reads them back in that space) but looked
 * the measured element up in the LAYOUT space — where groups counts the
 * headers. Data row 0 measured the first header, and every measurement a
 * space collision allowed landed under the wrong row.
 *
 * These tests use NON-UNIFORM content heights on purpose: four equal items
 * hide half the bug (the middle rows are "accidentally right" when every row
 * has the same height).
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
import { createTestItems, createContainer } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { autosize } from "../../src/plugins/autosize/plugin";
import type { AutosizeMethods } from "../../src/plugins/autosize/plugin";

// =============================================================================
// DOM Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  // happy-dom has no layout: the list's own root must report a container
  // size or nothing renders. Prototype-level, per-element values won't do —
  // the root is created by vlist, not by the test.
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

// =============================================================================
// Helpers
// =============================================================================

/**
 * A ResizeObserver whose callback is triggered by the test rather than on
 * observe: firing synchronously from inside `observe` would re-enter the
 * render that is installing the observation. Each element is reported at its
 * own natural content height, read from the `data-h` attribute the templates
 * below write — headers and items report different heights, which is what
 * makes a header's measurement visible when it lands under a data row.
 */
function captureResizeObserver() {
  const original = globalThis.ResizeObserver;
  const observed = new Set<Element>();
  let callback: ResizeObserverCallback | null = null;

  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe(el: Element): void { observed.add(el); }
    unobserve(el: Element): void { observed.delete(el); }
    disconnect(): void { observed.clear(); }
  } as unknown as typeof ResizeObserver;

  const naturalHeight = (el: Element): number =>
    Number((el as HTMLElement).querySelector("[data-h]")?.getAttribute("data-h") ?? 0);

  return {
    observed,
    /** Report every observed element at its own natural content height. */
    measureAll(): void {
      const entries = [...observed]
        .filter((el) => (el as HTMLElement).hasAttribute("data-index"))
        .map((el) => ({
          target: el,
          borderBoxSize: [{ blockSize: naturalHeight(el), inlineSize: 300 }],
        }) as unknown as ResizeObserverEntry)
        .filter((entry) => (entry.borderBoxSize[0]!.blockSize as number) > 0);
      if (entries.length > 0) callback!(entries, {} as ResizeObserver);
    },
    restore(): void { globalThis.ResizeObserver = original; },
  };
}

/** Content heights per data index: deliberately non-uniform. */
const HEIGHTS = [60, 90, 120, 150];
const HEADER_HEIGHT = 30;
/** The header's own content height — what a misrouted measurement reports. */
const HEADER_CONTENT = 17;

const itemTemplate = (item: TestItem): string =>
  `<div data-h="${HEIGHTS[item.id - 1]}">Item ${item.id}</div>`;

const headerTemplate = (group: string): string =>
  `<span data-h="${HEADER_CONTENT}">${group}</span>`;

/** Elements the groups render mounted, items only (headers filtered out). */
const itemElements = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(".vlist-content [data-index]")]
    .filter((el) => !el.classList.contains("vlist-group-header"));

const headerElements = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(".vlist-content .vlist-group-header")];

interface Captured {
  ctx: PluginContext<TestItem>;
  list: VList<TestItem> & AutosizeMethods;
  container: HTMLElement;
}

function createGroupedList(
  items: TestItem[],
  template: (item: TestItem) => string = itemTemplate,
): Captured {
  const container = createContainer();
  let ctx!: PluginContext<TestItem>;
  // Typed explicitly: an inline literal would break the createVList plugin
  // tuple inference and drop the plugin methods from the list's type.
  const capture: VListPlugin<TestItem> = {
    name: "capture-context",
    setup(value): void { ctx = value; },
  };
  const list = createVList(
    {
      container,
      items,
      item: { estimatedHeight: 40, template },
    },
    [
      autosize(),
      groups({
        getGroupForIndex: (i) => (i < items.length / 2 ? "A" : "B"),
        header: { height: HEADER_HEIGHT, template: headerTemplate },
      }),
      capture,
    ],
  );
  return { ctx, list, container };
}

// =============================================================================
// Tests
// =============================================================================

describe("groups() + autosize() — one index space (#363)", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it.serial("measures every data row at its own content height, never a header's", () => {
    // serial: owns the global ResizeObserver for the duration of the test.
    const ro = captureResizeObserver();
    const { ctx, list, container } = createGroupedList(createTestItems(4));
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };
    try {
      ro.measureAll();

      // The behaviour a person notices: each row renders at its content's
      // height — 60/90/120/150 — not at the 17 px a header's content measures.
      const rendered = itemElements(container).map((el) => el.style.height);
      expect(rendered).toEqual(HEIGHTS.map((h) => `${h}px`));

      // The grouped size cache serves each data row its own measurement:
      // headers plus the four content heights. The first group's inline
      // header collapses to 0 — the sticky header already shows it.
      expect(ctx.sizes.cache.getTotalSize()).toBe(
        HEADER_HEIGHT + HEIGHTS.reduce((a, b) => a + b, 0),
      );
      expect(list.getMeasuredCount()).toBe(4);

      // No header was ever observed or pinned: headers are not items.
      for (const header of headerElements(container)) {
        expect(ro.observed.has(header)).toBe(false);
        expect(header.style.height).not.toBe(`${HEADER_CONTENT}px`);
      }
    } finally {
      cleanup();
      cleanup = null;
    }
  });

  it.serial("remeasure(index) re-measures the row at that data index", () => {
    // serial: owns the global ResizeObserver for the duration of the test.
    const ro = captureResizeObserver();
    const { ctx, list, container } = createGroupedList(createTestItems(4));
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };
    try {
      ro.measureAll();
      expect(list.getMeasuredCount()).toBe(4);

      // The content of data row 1 grows (an image loaded): 90 -> 200.
      const row1 = itemElements(container)[1]!;
      row1.querySelector("[data-h]")!.setAttribute("data-h", "200");
      list.remeasure(1);
      ro.measureAll();

      const rendered = itemElements(container).map((el) => el.style.height);
      expect(rendered).toEqual(["60px", "200px", "120px", "150px"]);
      expect(ctx.sizes.cache.getTotalSize()).toBe(
        HEADER_HEIGHT + 60 + 200 + 120 + 150,
      );
    } finally {
      cleanup();
      cleanup = null;
    }
  });

  it.serial("measuring a row above the viewport keeps the first visible row in place", () => {
    // serial: owns the global ResizeObserver for the duration of the test.
    const ro = captureResizeObserver();
    // 40 items in 2 groups of 20, uniform 100 px content, 40 px estimate.
    const items = createTestItems(40);
    const uniformTemplate = (item: TestItem): string =>
      `<div data-h="100">Item ${item.id}</div>`;
    const { ctx, list, container } = createGroupedList(items, uniformTemplate);
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };
    try {
      list.scrollToIndex(20, "start");
      const before = list.getScrollPosition();
      expect(before).toBeGreaterThan(0);

      // The first visible row's position relative to the scroll top — the
      // sticky header band — is what must not move when rows above the
      // viewport are measured.
      const d2l = ctx.hooks.get("_dataToLayoutIndex") as (i: number) => number;
      const relBefore = ctx.sizes.cache.getOffset(d2l(20)) - before;

      ro.measureAll();

      // Rows above the viewport grew from the 40 px estimate to 100 px; the
      // scroll position corrects by their deltas so the top row does not jump.
      const after = list.getScrollPosition();
      expect(ctx.sizes.cache.getOffset(d2l(20)) - after).toBe(relBefore);
      // The correction really happened: at least one row above was measured
      // and the scroll position moved by its delta.
      expect(after).not.toBe(before);
    } finally {
      cleanup();
      cleanup = null;
    }
  });

  it.serial("autosize() without groups() is unchanged (control)", () => {
    // serial: owns the global ResizeObserver for the duration of the test.
    const ro = captureResizeObserver();
    const container = createContainer();
    let ctx!: PluginContext<TestItem>;
    const capture: VListPlugin<TestItem> = {
      name: "capture-context",
      setup(value): void { ctx = value; },
    };
    const list = createVList(
      {
        container,
        items: createTestItems(4),
        item: { estimatedHeight: 40, template: itemTemplate },
      },
      [autosize(), capture],
    );
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };
    try {
      ro.measureAll();
      const rendered = itemElements(container).map((el) => el.style.height);
      expect(rendered).toEqual(HEIGHTS.map((h) => `${h}px`));
      expect(ctx.sizes.cache.getTotalSize()).toBe(
        HEIGHTS.reduce((a, b) => a + b, 0),
      );
      expect(list.getMeasuredCount()).toBe(4);
    } finally {
      cleanup();
      cleanup = null;
    }
  });
});
