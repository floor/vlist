/**
 * vlist v2 — Extended A11y Tests
 *
 * Covers a11y plugin gaps: PageUp/PageDown navigation, empty list
 * handling, and destroy cleanup (event listener removal).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { a11y } from "../../src/plugins/a11y";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function createList(count = 20) {
  const container = createContainer({ width: 300, height: 500 });
  const items = createTestItems(count);
  const vlist = createVList<TestItem>(
    { container, items, item: { height: 50, template: simpleTemplate } },
    [a11y()],
  );
  return { vlist, container, items };
}

function getContent(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".vlist-content")!;
}

function fireKey(content: HTMLElement, key: string): void {
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
  );
}

// =============================================================================
// PageUp / PageDown
// =============================================================================

describe("a11y — PageUp / PageDown navigation", () => {
  it("PageDown moves focus forward by a page of visible rows", async () => {
    const { vlist, container } = createList(100);
    await flush();

    const focusEvents: Array<{ index: number }> = [];
    vlist.on("focus:change", (e) => focusEvents.push({ index: e.index }));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "PageDown");
    await flush();

    // containerSize=500, itemHeight=50 → 10 visible rows
    // From 0 + 10 = 10
    expect(focusEvents.length).toBe(2);
    expect(focusEvents[1]!.index).toBe(10);

    vlist.destroy();
    container.remove();
  });

  it("PageUp moves focus backward by a page of visible rows", async () => {
    const { vlist, container } = createList(100);
    await flush();

    const focusEvents: Array<{ index: number }> = [];
    vlist.on("focus:change", (e) => focusEvents.push({ index: e.index }));

    const content = getContent(container);
    fireKey(content, "End"); // → 99
    fireKey(content, "PageUp");
    await flush();

    // From 99 - 10 = 89
    const lastFocus = focusEvents[focusEvents.length - 1]!;
    expect(lastFocus.index).toBe(89);

    vlist.destroy();
    container.remove();
  });

  it("PageDown clamps to last item", async () => {
    const { vlist, container } = createList(5);
    await flush();

    const focusEvents: Array<{ index: number }> = [];
    vlist.on("focus:change", (e) => focusEvents.push({ index: e.index }));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "PageDown");  // would be 0+10=10, clamped to 4
    await flush();

    const lastFocus = focusEvents[focusEvents.length - 1]!;
    expect(lastFocus.index).toBe(4);

    vlist.destroy();
    container.remove();
  });

  it("PageUp clamps to first item", async () => {
    const { vlist, container } = createList(100);
    await flush();

    const focusEvents: Array<{ index: number }> = [];
    vlist.on("focus:change", (e) => focusEvents.push({ index: e.index }));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "ArrowDown"); // → 1
    fireKey(content, "ArrowDown"); // → 2
    fireKey(content, "PageUp");    // would be 2-10=-8, clamped to 0
    await flush();

    const lastFocus = focusEvents[focusEvents.length - 1]!;
    expect(lastFocus.index).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("multiple PageDown calls accumulate correctly", async () => {
    const { vlist, container } = createList(100);
    await flush();

    const focusEvents: Array<{ index: number }> = [];
    vlist.on("focus:change", (e) => focusEvents.push({ index: e.index }));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "PageDown");  // → 10
    fireKey(content, "PageDown");  // → 20
    await flush();

    const lastFocus = focusEvents[focusEvents.length - 1]!;
    expect(lastFocus.index).toBe(20);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Empty list handling
// =============================================================================

describe("a11y — empty list", () => {
  it("ArrowDown on empty list does not emit focus:change", async () => {
    const { vlist, container } = createList(0);
    await flush();

    const focusEvents: Array<unknown> = [];
    vlist.on("focus:change", (e) => focusEvents.push(e));

    const content = getContent(container);
    fireKey(content, "ArrowDown");
    await flush();

    expect(focusEvents.length).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("End on empty list does not emit focus:change", async () => {
    const { vlist, container } = createList(0);
    await flush();

    const focusEvents: Array<unknown> = [];
    vlist.on("focus:change", (e) => focusEvents.push(e));

    const content = getContent(container);
    fireKey(content, "End");
    await flush();

    expect(focusEvents.length).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("Space on empty list does not emit selection:change", async () => {
    const { vlist, container } = createList(0);
    await flush();

    const selEvents: Array<unknown> = [];
    vlist.on("selection:change", (e) => selEvents.push(e));

    const content = getContent(container);
    fireKey(content, " ");
    await flush();

    expect(selEvents.length).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("PageDown on empty list does not emit focus:change", async () => {
    const { vlist, container } = createList(0);
    await flush();

    const focusEvents: Array<unknown> = [];
    vlist.on("focus:change", (e) => focusEvents.push(e));

    const content = getContent(container);
    fireKey(content, "PageDown");
    await flush();

    expect(focusEvents.length).toBe(0);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Destroy cleanup
// =============================================================================

describe("a11y — destroy cleanup", () => {
  it("keyboard events do not fire focus:change after destroy", async () => {
    const { vlist, container } = createList();
    await flush();

    const focusEvents: Array<unknown> = [];
    vlist.on("focus:change", (e) => focusEvents.push(e));

    const content = getContent(container);
    fireKey(content, "ArrowDown");
    await flush();
    expect(focusEvents.length).toBe(1);

    vlist.destroy();

    fireKey(content, "ArrowDown");
    fireKey(content, "ArrowDown");
    await flush();

    expect(focusEvents.length).toBe(1);

    container.remove();
  });

  it("keyboard events do not fire selection:change after destroy", async () => {
    const { vlist, container } = createList();
    await flush();

    const selEvents: Array<unknown> = [];
    vlist.on("selection:change", (e) => selEvents.push(e));

    const content = getContent(container);
    fireKey(content, "ArrowDown");
    fireKey(content, " ");
    await flush();
    expect(selEvents.length).toBe(1);

    vlist.destroy();

    fireKey(content, " ");
    await flush();

    expect(selEvents.length).toBe(1);

    container.remove();
  });

  it("click events do not fire selection:change after destroy", async () => {
    const { vlist, container, items } = createList();
    await flush();

    const selEvents: Array<unknown> = [];
    vlist.on("selection:change", (e) => selEvents.push(e));

    const content = getContent(container);
    const itemEl = document.createElement("div");
    itemEl.setAttribute("data-index", "0");
    itemEl.setAttribute("data-id", String(items[0]!.id));
    content.appendChild(itemEl);

    itemEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(selEvents.length).toBe(1);

    vlist.destroy();

    itemEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(selEvents.length).toBe(1);

    container.remove();
  });
});
