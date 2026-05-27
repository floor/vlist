/**
 * vlist v2 — Mouse Event Tests (dblclick, contextmenu)
 *
 * Verifies that item:dblclick and item:contextmenu events are emitted
 * with correct payload when users interact with rendered items.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

function createList(count = 20) {
  list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 40, template: simpleTemplate } },
    [],
  );
  return list;
}

function getContent(): HTMLElement {
  return container.querySelector<HTMLElement>(".vlist-content")!;
}

function createItemElement(content: HTMLElement, index: number, id: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-index", String(index));
  el.setAttribute("data-id", String(id));
  el.textContent = `Item ${id}`;
  content.appendChild(el);
  return el;
}

// =============================================================================
// item:dblclick
// =============================================================================

describe("item:dblclick event", () => {
  it("should emit item:dblclick on double click of a rendered item", () => {
    const vlist = createList();
    const content = getContent();
    const itemEl = createItemElement(content, 2, 3);

    const events: Array<{ item: TestItem; index: number; event: MouseEvent }> = [];
    vlist.on("item:dblclick", (e) => events.push(e));

    itemEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(events.length).toBe(1);
    expect(events[0]!.index).toBe(2);
    expect(events[0]!.item.id).toBe(3);
    expect(events[0]!.event).toBeInstanceOf(MouseEvent);
  });

  it("should not emit item:dblclick when clicking outside items", () => {
    const vlist = createList();
    const content = getContent();

    const events: Array<unknown> = [];
    vlist.on("item:dblclick", (e) => events.push(e));

    content.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(events.length).toBe(0);
  });

  it("should not emit item:dblclick for invalid data-index", () => {
    const vlist = createList(5);
    const content = getContent();

    const el = document.createElement("div");
    el.setAttribute("data-index", "999");
    content.appendChild(el);

    const events: Array<unknown> = [];
    vlist.on("item:dblclick", (e) => events.push(e));

    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(events.length).toBe(0);
  });

  it("should emit correct item for nested element clicks", () => {
    const vlist = createList();
    const content = getContent();
    const itemEl = createItemElement(content, 5, 6);
    const nested = document.createElement("span");
    nested.textContent = "inner";
    itemEl.appendChild(nested);

    const events: Array<{ index: number }> = [];
    vlist.on("item:dblclick", (e) => events.push({ index: e.index }));

    nested.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(events.length).toBe(1);
    expect(events[0]!.index).toBe(5);
  });

  it("should not emit after destroy", () => {
    const vlist = createList();
    const content = getContent();
    const itemEl = createItemElement(content, 0, 1);

    const events: Array<unknown> = [];
    vlist.on("item:dblclick", (e) => events.push(e));

    vlist.destroy();
    list = null;

    itemEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(events.length).toBe(0);
  });
});

// =============================================================================
// item:contextmenu
// =============================================================================

describe("item:contextmenu event", () => {
  it("should emit item:contextmenu on right-click of a rendered item", () => {
    const vlist = createList();
    const content = getContent();
    const itemEl = createItemElement(content, 3, 4);

    const events: Array<{ item: TestItem; index: number; event: MouseEvent }> = [];
    vlist.on("item:contextmenu", (e) => events.push(e));

    itemEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    expect(events.length).toBe(1);
    expect(events[0]!.index).toBe(3);
    expect(events[0]!.item.id).toBe(4);
    expect(events[0]!.event).toBeInstanceOf(MouseEvent);
  });

  it("should not emit item:contextmenu when right-clicking outside items", () => {
    const vlist = createList();
    const content = getContent();

    const events: Array<unknown> = [];
    vlist.on("item:contextmenu", (e) => events.push(e));

    content.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    expect(events.length).toBe(0);
  });

  it("should emit correct item for nested element right-clicks", () => {
    const vlist = createList();
    const content = getContent();
    const itemEl = createItemElement(content, 7, 8);
    const inner = document.createElement("button");
    itemEl.appendChild(inner);

    const events: Array<{ index: number }> = [];
    vlist.on("item:contextmenu", (e) => events.push({ index: e.index }));

    inner.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    expect(events.length).toBe(1);
    expect(events[0]!.index).toBe(7);
  });

  it("should not emit after destroy", () => {
    const vlist = createList();
    const content = getContent();
    const itemEl = createItemElement(content, 0, 1);

    const events: Array<unknown> = [];
    vlist.on("item:contextmenu", (e) => events.push(e));

    vlist.destroy();
    list = null;

    itemEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(events.length).toBe(0);
  });
});
