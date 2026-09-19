/**
 * vlist — Sortable Plugin Next To Selection
 *
 * The keyboard sort loop driven through a real createVList, with the consumer
 * reordering on `sort:end` the way the plugin's docs tell them to. What the
 * mocked-context tests in `plugin.test.ts` cannot see: sortable moves the focus
 * through selection's `_focusById`, so whether the focus ring survives a grab,
 * a move, a drop and a cancel is a fact about the two plugins together.
 *
 * Safe under `bun test --concurrent`: each test owns its list and container
 * through `scoped()`, and focus is read from the list's own classes and
 * attributes, never from `document.activeElement`.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { scoped, type TestScope } from "../../helpers/scope";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import { selection, type SelectionMethods } from "../../../src/plugins/selection";
import { sortable, type SortableMethods } from "../../../src/plugins/sortable";

// =============================================================================
// DOM Setup
// =============================================================================

const WIDTH = 300;
const HEIGHT = 500;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
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

type SortableList = VList<TestItem> & SelectionMethods<TestItem> & SortableMethods;

/**
 * A list a person can sort from the keyboard: selection owns the focus and the
 * arrows, sortable takes over while an item is grabbed. The `sort:end` handler
 * is the consumer half of the contract — the plugin never reorders data itself.
 */
function makeList(scope: TestScope): {
  list: SortableList;
  container: HTMLElement;
  content: HTMLElement;
  order: () => number[];
} {
  const container = createContainer({ width: WIDTH, height: HEIGHT });
  let items = createTestItems(20);
  const list = createVList<TestItem>(
    { container, items, item: { height: 50, template: simpleTemplate } },
    [sortable<TestItem>({ shiftDuration: 0 }), selection<TestItem>()],
  ) as SortableList;
  scope.own(list, container);

  list.on("sort:end", ({ fromIndex, toIndex }) => {
    const next = items.slice();
    next.splice(toIndex, 0, next.splice(fromIndex, 1)[0]!);
    items = next;
    list.setItems(next);
  });
  list.on("sort:cancel", ({ originalItems }) => {
    items = originalItems as TestItem[];
    list.setItems(items);
  });

  return {
    list,
    container,
    content: container.querySelector<HTMLElement>(".vlist-content")!,
    order: () => items.map((i) => i.id),
  };
}

/** Dispatch a key the way a browser does and report whether the list claimed it. */
function press(el: HTMLElement, key: string): { claimed: boolean } {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return { claimed: event.defaultPrevented };
}

/** The row the focus ring is painted on, read from the DOM. */
function ring(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".vlist-item--focused");
}

function ringId(container: HTMLElement): number | null {
  const el = ring(container);
  return el ? Number(el.getAttribute("data-id")) : null;
}

// =============================================================================
// FLO-220 — the focus ring through a keyboard sort
// =============================================================================

// FLO-220. sortable moves the focus through selection's `_focusById`, which
// since FLO-209 takes a `keyboard` flag. Sortable never passed it, so every
// keyboard move was treated like a click: with the default `focusOnClick` the
// ring vanished at the first arrow — mid-sort, not after the drop —
// aria-activedescendant stayed on the row the grabbed item had left, and
// `_getFocusedIndex()` answered -1, so the Space that should have re-grabbed
// the item fell through to selection and selected it instead.
describe("sortable — the keyboard sort keeps the focus ring", () => {
  it("keeps the ring and the active descendant on the grabbed item while it moves", scoped((scope) => {
    const { list, container, content, order } = makeList(scope);
    press(content, "Home");
    press(content, "ArrowDown");
    press(content, "ArrowDown");
    expect(ringId(container)).toBe(3);

    expect(press(content, " ").claimed).toBe(true);
    expect(list.isSorting()).toBe(true);
    expect(ringId(container)).toBe(3);

    press(content, "ArrowDown");

    expect(order()).toEqual([1, 2, 4, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    // The grabbed row is one lower; the ring and the active descendant are on it.
    expect(ringId(container)).toBe(3);
    expect(ring(container)!.getAttribute("data-index")).toBe("3");
    expect(content.getAttribute("aria-activedescendant")).toBe(ring(container)!.id);
  }));

  it("leaves the dropped item focused, so the next Space re-grabs it instead of selecting it", scoped((scope) => {
    const { list, container, content } = makeList(scope);
    press(content, "Home");
    press(content, "ArrowDown");
    press(content, "ArrowDown");
    press(content, " ");
    press(content, "ArrowDown");

    expect(press(content, " ").claimed).toBe(true); // drop
    expect(list.isSorting()).toBe(false);
    expect(ringId(container)).toBe(3);

    press(content, " "); // re-grab

    expect(list.isSorting()).toBe(true);
    expect(list.getSelected()).toEqual([]);
  }));

  it("leaves the returned item focused after Escape cancels the sort", scoped((scope) => {
    const { list, container, content } = makeList(scope);
    press(content, "Home");
    press(content, "ArrowDown");
    press(content, "ArrowDown");
    press(content, " ");
    press(content, "ArrowDown");

    expect(press(content, "Escape").claimed).toBe(true);
    expect(list.isSorting()).toBe(false);
    expect(ringId(container)).toBe(3);
    expect(content.getAttribute("aria-activedescendant")).toBe(ring(container)!.id);

    // The cancel handed focus back to the keyboard, so sorting can start again.
    press(content, " ");
    expect(list.isSorting()).toBe(true);
    expect(list.getSelected()).toEqual([]);
  }));
});
