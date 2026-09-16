/**
 * vlist — Selection totals across inflated layouts
 *
 * Selection asks two different questions of a list: "where can focus move"
 * (layout space, headers and carousel laps included) and "how many items are
 * there" (data space). It used to answer the second with the engine's total,
 * which is the first. Carousel inflates that to 101 laps and groups counts
 * headers in it, so Ctrl+A could select everything and then never clear —
 * the selected set held 10 ids while the comparison wanted 1,010 or 12.
 *
 * Neither combination was covered anywhere before this file.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
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

    // 101 laps of 10 items: the engine total is 1,010 while the list has 10.
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
