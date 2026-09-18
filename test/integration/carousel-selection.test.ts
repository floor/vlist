/**
 * vlist — Selection totals across inflated layouts
 *
 * Selection asks two different questions of a list: "where can focus move"
 * (layout space, headers and carousel laps included) and "how many items are
 * there" (data space). It used to answer the second with the engine's total,
 * which is the first. Carousel inflates that to three laps and groups counts
 * headers in it, so Ctrl+A could select everything and then never clear —
 * the selected set held 10 ids while the comparison wanted 30 or 12.
 *
 * Neither combination was covered anywhere before this file.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { selection } from "../../src/plugins/selection/plugin";
import { carousel } from "../../src/plugins/carousel/plugin";
import { groups } from "../../src/plugins/groups/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});

let list: VList<TestItem> | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  list?.destroy();
  list = null;
  container?.remove();
  container = null;
});

/** Ctrl+A reaches the list through the root, so it bubbles from the content. */
function pressSelectAll(host: HTMLElement): void {
  const content = host.querySelector(".vlist-content");
  if (!content) throw new Error("vlist-content not found");
  content.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
}

describe("selection + carousel — Ctrl+A totals", () => {
  it("selects every item once and clears on the second press", () => {
    container = createContainer({ width: 300, height: 500 });
    list = createVList<TestItem>(
      { container, items: createTestItems(10), item: { height: 50, template: simpleTemplate } },
      [carousel(), selection<TestItem>({ mode: "multiple" })],
    );

    // Three laps of 10 items: the engine total is 30 while the list has 10.
    expect(list.total).toBe(10);

    pressSelectAll(container);
    const selected = (list as unknown as { getSelected(): Array<string | number> }).getSelected();
    expect(selected.length).toBe(10);

    // The second press used to compare 10 against 1,010 and select again.
    pressSelectAll(container);
    expect((list as unknown as { getSelected(): Array<string | number> }).getSelected().length).toBe(0);
  });
});

describe("selection + groups — Ctrl+A totals", () => {
  it("clears on the second press, with headers excluded from the count", () => {
    container = createContainer({ width: 300, height: 500 });
    list = createVList<TestItem>(
      { container, items: createTestItems(10), item: { height: 50, template: simpleTemplate } },
      [
        groups<TestItem>({
          getGroupForIndex: (i: number) => (i < 5 ? "a" : "b"),
          header: { height: 30, template: (group: string) => `<div>${group}</div>` },
        }),
        selection<TestItem>({ mode: "multiple" }),
      ],
    );

    pressSelectAll(container);
    const selected = (list as unknown as { getSelected(): Array<string | number> }).getSelected();
    // Ten items; the two group headers are not selectable.
    expect(selected.length).toBe(10);

    // The comparison used to be against 12 layout entries, so it never cleared.
    pressSelectAll(container);
    expect((list as unknown as { getSelected(): Array<string | number> }).getSelected().length).toBe(0);
  });
});

/**
 * One key, two handlers (N3).
 *
 * carousel() and selection() both handle keydown. carousel's handler runs first
 * and starts a smooth snap; selection's then asks `nav.navigate` where focus
 * goes, and that answer used to move the list as well — instantly. Measured in
 * Chromium before the fix: every arrow key rendered the target for one frame and
 * returned the next (-338px then +337px in the hero variant), and because each
 * plugin moved from its own idea of "current", three presses inside one snap left
 * the carousel on item 2 while `aria-activedescendant` pointed at item 3.
 */
function pressArrow(host: HTMLElement, key: "ArrowRight" | "ArrowLeft"): void {
  const content = host.querySelector(".vlist-content");
  if (!content) throw new Error("vlist-content not found");
  content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

const carouselIndex = (l: VList<TestItem>): number =>
  (l as unknown as { getCarouselState(): { index: number } }).getCarouselState().index;

/**
 * Selection's own focused index. `aria-activedescendant` carries the rendered
 * element's id, which in a carousel names the virtual lap (item-501), so it
 * cannot be compared with a logical index.
 */
let focusedIndex: (() => number) | null = null;
const inspect: VListPlugin<TestItem> = {
  name: "inspect-focus",
  priority: 99,
  setup(ctx) { focusedIndex = ctx.hooks.get("_getFocusedIndex") as () => number; },
};

describe("selection + carousel — one key, one movement", () => {
  const build = (): HTMLElement => {
    container = createContainer({ width: 300, height: 500 });
    list = createVList<TestItem>(
      { container, items: createTestItems(10), item: { height: 50, template: simpleTemplate } },
      [carousel({ snapDuration: 300 }), selection<TestItem>({ mode: "single" }), inspect],
    );
    return container;
  };

  it("leaves the scrolling to the snap instead of jumping to the target", () => {
    const host = build();
    const step = 50;
    const before = list!.getScrollPosition();

    pressArrow(host, "ArrowRight");

    // The carousel knows where it is going…
    expect(carouselIndex(list!)).toBe(1);
    // …and has not teleported there: the snap does the moving, over its 300ms.
    expect(Math.abs(list!.getScrollPosition() - before)).toBeLessThan(step / 2);
  });

  it("keeps focus on the item the carousel is going to, through repeated presses", () => {
    const host = build();

    pressArrow(host, "ArrowRight");
    expect(focusedIndex!()).toBe(carouselIndex(list!));

    // Three presses inside one snap: each moves one item, and focus follows.
    pressArrow(host, "ArrowRight");
    pressArrow(host, "ArrowRight");
    expect(carouselIndex(list!)).toBe(3);
    // Before the fix each plugin moved from its own idea of "current": the
    // carousel reached 2 while focus was on 3.
    expect(focusedIndex!()).toBe(3);
  });

  it("wraps backwards the same way, without a jump", () => {
    const host = build();
    const before = list!.getScrollPosition();

    pressArrow(host, "ArrowLeft");

    expect(carouselIndex(list!)).toBe(9);
    expect(Math.abs(list!.getScrollPosition() - before)).toBeLessThan(25);
    expect(focusedIndex!()).toBe(9);
  });
});
