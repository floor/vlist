/**
 * page() + groups() / masonry() — the configured scrollPadding survives.
 *
 * page() keeps a band of the window clear at each end of the list: a sticky
 * site header at the top, a floating toolbar at the bottom. It applied that
 * band in its own `_scrollItemIntoView` and `setToPosFn` — both of which
 * groups() and masonry() replace, because only they know where an entry sits.
 * Seated together, the caller's padding vanished and keyboard focus parked
 * items under the sticky header.
 *
 * Every case below runs the same list twice, with and without the padding, and
 * asserts the difference is exactly the band. That is the property the caller
 * configured, and it holds for focus movement and for scrollToIndex alike.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createTestItems, createContainer, simpleTemplate, type TestItem } from "../helpers/factory";
import { page } from "../../src/plugins/page/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import { selection } from "../../src/plugins/selection/plugin";

// =============================================================================
// Setup
// =============================================================================

const WINDOW_HEIGHT = 500;
const TOP_PAD = 60;
const BOTTOM_PAD = 40;

let geometry: ReturnType<typeof capturePrototypeGeometry>;
let originalScrollTo: typeof window.scrollTo;
// `| undefined` on both, not optional: exactOptionalPropertyTypes is on, and
// getOwnPropertyDescriptor returns undefined when the property is absent.
let originalInner: { height: PropertyDescriptor | undefined; width: PropertyDescriptor | undefined } = { height: undefined, width: undefined };

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return WINDOW_HEIGHT; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 300; },
    configurable: true,
  });
  // Captured so afterAll can put them back. The DOM now lives for the whole
  // process, so a value left here is the value every later file reads.
  originalInner = {
    height: Object.getOwnPropertyDescriptor(window, "innerHeight"),
    width: Object.getOwnPropertyDescriptor(window, "innerWidth"),
  };
  Object.defineProperty(window, "innerHeight", { value: WINDOW_HEIGHT, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 300, configurable: true });
  // page() writes through window.scrollTo. Swallow it: happy-dom would echo a
  // scroll event whose rect is all zeroes, committing 0 over what page wrote.
  originalScrollTo = window.scrollTo;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterAll(() => {
  for (const [name, desc] of [["innerHeight", originalInner.height], ["innerWidth", originalInner.width]] as const) {
    if (desc) Object.defineProperty(window, name, desc);
    else delete (window as unknown as Record<string, unknown>)[name];
  }
  window.scrollTo = originalScrollTo;
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

let built: Array<{ list: VList<TestItem>; host: HTMLElement }> = [];

afterEach(() => {
  for (const { list, host } of built) {
    list.destroy();
    host.remove();
  }
  built = [];
});

// =============================================================================
// Harness
// =============================================================================

type Layout = "groups" | "masonry";

const layoutPlugin = (layout: Layout): VListPlugin<TestItem> =>
  layout === "groups"
    ? groups<TestItem>({
        getGroupForIndex: (i) => (i < 30 ? "A" : "B"),
        header: { height: 40, template: (key) => `<h2>${key}</h2>` },
      })
    : masonry<TestItem>({ columns: 2, gap: 0 });

/**
 * Build one list and return the positions it writes. `padded` decides whether
 * page() carries the caller's band; everything else is identical.
 */
function build(layout: Layout, padded: boolean): VList<TestItem> {
  const host = createContainer({ width: 300, height: WINDOW_HEIGHT });
  const pagePlugin = padded
    ? page<TestItem>({ scrollPadding: { top: TOP_PAD, bottom: BOTTOM_PAD } })
    : page<TestItem>();

  const list = createVList<TestItem>(
    {
      container: host,
      items: createTestItems(60),
      item: { height: 50, template: simpleTemplate },
    },
    [pagePlugin, layoutPlugin(layout), selection<TestItem>({ mode: "single" })],
  );

  built.push({ list, host });
  return list;
}

/**
 * Put keyboard focus on the first data row by clicking it. masonry() navigates
 * from a known lane position, so arrow keys do nothing until focus exists;
 * groups() counts its header as layout index 0, so its first row is index 1.
 */
function seedFocus(list: VList<TestItem>, layout: Layout): void {
  const index = layout === "groups" ? 1 : 0;
  const row = list.element.querySelector(`[data-index="${index}"]`);
  if (!row) throw new Error(`row ${index} not rendered`);
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Move keyboard focus by pressing an arrow key `times` times. */
function press(list: VList<TestItem>, key: "ArrowDown" | "ArrowUp", times: number): void {
  const content = list.element.querySelector(".vlist-content");
  if (!content) throw new Error("vlist-content not found");
  for (let i = 0; i < times; i++) {
    content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
}



// =============================================================================
// Focus movement — the path selection drives through _scrollItemIntoView
// =============================================================================

describe("page + layout plugins — focus keeps the configured scrollPadding", () => {
  for (const layout of ["groups", "masonry"] as const) {
    it(`${layout}: focus past the viewport bottom clears the bottom band`, () => {
      const plain = build(layout, false);
      const padded = build(layout, true);
      seedFocus(plain, layout);
      seedFocus(padded, layout);

      // Far enough down that the target sits below the fold in both lists.
      press(plain, "ArrowDown", 15);
      press(padded, "ArrowDown", 15);

      expect(plain.getScrollPosition()).toBeGreaterThan(0);
      expect(padded.getScrollPosition() - plain.getScrollPosition()).toBe(BOTTOM_PAD);
    });

    it(`${layout}: focus back to the first item clears the top band`, () => {
      const plain = build(layout, false);
      const padded = build(layout, true);
      seedFocus(plain, layout);
      seedFocus(padded, layout);

      // Down past the fold, then all the way back to the first item.
      press(plain, "ArrowDown", 15);
      press(plain, "ArrowUp", 15);
      press(padded, "ArrowDown", 15);
      press(padded, "ArrowUp", 15);

      // The list sits at the document top, so keeping a sticky header off the
      // first item means a scroll position the padded band's width lower —
      // negative, since page() scrolls the window, not the viewport.
      expect(padded.getScrollPosition() - plain.getScrollPosition()).toBe(-TOP_PAD);
      expect(padded.getScrollPosition()).toBeLessThan(0);
    });
  }
});

// =============================================================================
// scrollToIndex — the path that runs through setToIndexFn
// =============================================================================

describe("page + layout plugins — scrollToIndex keeps the configured scrollPadding", () => {
  for (const layout of ["groups", "masonry"] as const) {
    it(`${layout}: align start subtracts the top band`, () => {
      const plain = build(layout, false);
      const padded = build(layout, true);

      plain.scrollToIndex(20, "start");
      padded.scrollToIndex(20, "start");

      expect(padded.getScrollPosition() - plain.getScrollPosition()).toBe(-TOP_PAD);
    });

    it(`${layout}: align end adds the bottom band`, () => {
      const plain = build(layout, false);
      const padded = build(layout, true);

      plain.scrollToIndex(20, "end");
      padded.scrollToIndex(20, "end");

      expect(padded.getScrollPosition() - plain.getScrollPosition()).toBe(BOTTOM_PAD);
    });

    it(`${layout}: align center keeps both bands out of the centred space`, () => {
      const plain = build(layout, false);
      const padded = build(layout, true);

      plain.scrollToIndex(20, "center");
      padded.scrollToIndex(20, "center");

      // The item centres in what is left once both bands are excluded, which
      // shifts it by half the difference between them.
      expect(padded.getScrollPosition() - plain.getScrollPosition())
        .toBe((BOTTOM_PAD - TOP_PAD) / 2);
    });
  }
});

// =============================================================================
// The hook itself
// =============================================================================

describe("page — _getScrollPadding", () => {
  it("is not published when no scrollPadding is configured", () => {
    let read: Function | undefined;
    const host = createContainer({ width: 300, height: WINDOW_HEIGHT });
    const list = createVList<TestItem>(
      { container: host, items: createTestItems(5), item: { height: 50, template: simpleTemplate } },
      [page(), { name: "inspect", priority: 99, setup(ctx): void { read = ctx.hooks.get("_getScrollPadding"); } }],
    );
    built.push({ list, host });

    expect(read).toBeUndefined();
  });

  it("resolves function padding on every read", () => {
    let top = 10;
    let read!: () => { start: number; end: number };
    const host = createContainer({ width: 300, height: WINDOW_HEIGHT });
    const list = createVList<TestItem>(
      { container: host, items: createTestItems(5), item: { height: 50, template: simpleTemplate } },
      [
        page({ scrollPadding: { top: () => top, bottom: 25 } }),
        { name: "inspect", priority: 99, setup(ctx): void {
          read = ctx.hooks.get("_getScrollPadding") as typeof read;
        } },
      ],
    );
    built.push({ list, host });

    expect(read()).toEqual({ start: 10, end: 25 });
    top = 70;
    expect(read()).toEqual({ start: 70, end: 25 });
  });
});
