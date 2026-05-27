/**
 * vlist v2 — Event Object Reuse Safety Tests
 *
 * The core and plugins pre-allocate event objects (_scrollEvt, _velEvt,
 * _rangeEvt, _focusEvt, _selEvt) and mutate them before each emission
 * to avoid allocations on the hot path. These tests verify that consumers
 * who extract property values across multiple emissions see correct data.
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
// focus:change reuse safety
// =============================================================================

describe("event reuse — focus:change", () => {
  it("each focus:change emission carries its own index value", async () => {
    const { vlist, container } = createList();
    await flush();

    const indices: number[] = [];
    vlist.on("focus:change", (e) => indices.push(e.index));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "ArrowDown"); // → 1
    fireKey(content, "ArrowDown"); // → 2
    await flush();

    expect(indices).toEqual([0, 1, 2]);

    vlist.destroy();
    container.remove();
  });

  it("each focus:change emission carries its own id value", async () => {
    const { vlist, container } = createList();
    await flush();

    const ids: Array<string | number> = [];
    vlist.on("focus:change", (e) => ids.push(e.id));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → item id=1
    fireKey(content, "ArrowDown"); // → item id=2
    fireKey(content, "ArrowDown"); // → item id=3
    await flush();

    expect(ids).toEqual([1, 2, 3]);

    vlist.destroy();
    container.remove();
  });

  it("storing full event objects and reading later shows reuse (reference test)", async () => {
    const { vlist, container } = createList();
    await flush();

    const events: Array<{ id: string | number; index: number }> = [];
    vlist.on("focus:change", (e) => {
      // Intentionally store a reference — this demonstrates the reuse pattern.
      // The object is reused, so all stored refs point to the same object.
      events.push(e);
    });

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "ArrowDown"); // → 1
    await flush();

    // Because the event object is reused and mutated, all stored references
    // point to the same object with the LAST values. Consumers must copy.
    expect(events.length).toBe(2);
    expect(events[0]).toBe(events[1]); // same object reference
    expect(events[0]!.index).toBe(1);  // last mutation wins

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// selection:change reuse safety
// =============================================================================

describe("event reuse — selection:change", () => {
  it("copied selection arrays are independent across emissions", async () => {
    const { vlist, container } = createList();
    await flush();

    const snapshots: Array<{ count: number; ids: Array<string | number> }> = [];
    vlist.on("selection:change", (e) => {
      snapshots.push({ count: e.selected.length, ids: [...e.selected] });
    });

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // focus → 0
    fireKey(content, " ");          // select item at 0 → [id=1]
    fireKey(content, " ");          // deselect item at 0 → []
    await flush();

    expect(snapshots.length).toBe(2);
    expect(snapshots[0]!.count).toBe(1);
    expect(snapshots[0]!.ids[0]).toBe(1);
    expect(snapshots[1]!.count).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("extracting selected length at each emission is correct", async () => {
    const { vlist, container } = createList();
    await flush();

    const counts: number[] = [];
    vlist.on("selection:change", (e) => counts.push(e.selected.length));

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // focus → 0
    fireKey(content, " ");          // select
    fireKey(content, " ");          // deselect
    await flush();

    expect(counts).toEqual([1, 0]);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// item:dblclick / item:contextmenu reuse safety
// =============================================================================

describe("event reuse — mouse events", () => {
  it("multiple dblclick events carry correct indices when extracted immediately", async () => {
    const { vlist, container } = createList();
    await flush();

    const indices: number[] = [];
    vlist.on("item:dblclick", (e) => indices.push(e.index));

    const content = getContent(container);

    for (let i = 0; i < 3; i++) {
      const el = document.createElement("div");
      el.setAttribute("data-index", String(i));
      el.setAttribute("data-id", String(i + 1));
      content.appendChild(el);
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }

    expect(indices).toEqual([0, 1, 2]);

    vlist.destroy();
    container.remove();
  });

  it("multiple contextmenu events carry correct items when extracted immediately", async () => {
    const { vlist, container, items } = createList();
    await flush();

    const itemIds: Array<string | number> = [];
    vlist.on("item:contextmenu", (e) => itemIds.push(e.item.id));

    const content = getContent(container);

    for (let i = 0; i < 3; i++) {
      const el = document.createElement("div");
      el.setAttribute("data-index", String(i));
      el.setAttribute("data-id", String(items[i]!.id));
      content.appendChild(el);
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    }

    expect(itemIds).toEqual([1, 2, 3]);

    vlist.destroy();
    container.remove();
  });
});
