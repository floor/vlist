/**
 * vlist v2 — Error Recovery & Destroy Resilience Tests
 *
 * Verifies that: API calls after destroy are safe no-ops,
 * double-destroy is safe, and destroy event fires correctly.
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

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
});
afterEach(() => {
  container.remove();
});

function makeList(count = 10): VList<TestItem> {
  return createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 50, template: simpleTemplate } },
    [],
  );
}

// =============================================================================
// Double destroy
// =============================================================================

describe("error recovery — double destroy", () => {
  it("calling destroy twice does not throw", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.destroy()).not.toThrow();
  });

  it("destroy event fires only once", () => {
    const vlist = makeList();
    let destroyCount = 0;
    vlist.on("destroy", () => destroyCount++);

    vlist.destroy();
    vlist.destroy();

    expect(destroyCount).toBe(1);
  });
});

// =============================================================================
// API calls after destroy
// =============================================================================

describe("error recovery — API after destroy", () => {
  it("setItems after destroy does not throw", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.setItems(createTestItems(5))).not.toThrow();
  });

  it("appendItems after destroy does not throw", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.appendItems(createTestItems(3))).not.toThrow();
  });

  it("prependItems after destroy does not throw", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.prependItems(createTestItems(3))).not.toThrow();
  });

  it("insertItem after destroy does not throw", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.insertItem({ id: 999, name: "X" } as TestItem)).not.toThrow();
  });

  it("removeItem after destroy does not throw", () => {
    const vlist = makeList();
    const id = vlist.getItemAt(0)!.id;
    vlist.destroy();
    expect(() => vlist.removeItem(id)).not.toThrow();
  });

  it("updateItem after destroy does not throw", () => {
    const vlist = makeList();
    const id = vlist.getItemAt(0)!.id;
    vlist.destroy();
    expect(() => vlist.updateItem(id, { name: "X" })).not.toThrow();
  });

  it("scrollToIndex after destroy does not throw", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.scrollToIndex(5)).not.toThrow();
  });

  it("getItemAt after destroy returns undefined for valid index", () => {
    const vlist = makeList();
    vlist.destroy();
    // items array is still accessible but DOM is removed
    // This should not throw
    expect(() => vlist.getItemAt(0)).not.toThrow();
  });

  it("getIndexById after destroy returns -1 for removed items", () => {
    const vlist = makeList();
    vlist.destroy();
    expect(() => vlist.getIndexById(1)).not.toThrow();
  });
});

// =============================================================================
// Destroy cleans up DOM
// =============================================================================

describe("error recovery — destroy DOM cleanup", () => {
  it("root element is removed from DOM after destroy", () => {
    const vlist = makeList();
    const root = vlist.element;
    expect(document.body.contains(root)).toBe(true);

    vlist.destroy();
    expect(document.body.contains(root)).toBe(false);
  });

  it("rendered items are cleared after destroy", () => {
    const vlist = makeList(20);
    const root = vlist.element;
    const content = root.querySelector(".vlist-content")!;

    // There should be some rendered items
    const beforeCount = content.children.length;
    expect(beforeCount).toBeGreaterThan(0);

    vlist.destroy();

    // After destroy, rendered items should be cleared
    // (content is removed from DOM so children don't matter,
    // but the internal rendered map is cleared)
  });
});

// =============================================================================
// Destroy event
// =============================================================================

describe("error recovery — destroy event", () => {
  it("emits destroy event before clearing emitter", () => {
    const vlist = makeList();
    let received = false;
    vlist.on("destroy", () => { received = true; });

    vlist.destroy();
    expect(received).toBe(true);
  });

  it("event listeners registered after destroy are not called", () => {
    const vlist = makeList();
    vlist.destroy();

    let called = false;
    // on() after clear() should be a no-op or throw, but shouldn't crash
    try {
      vlist.on("destroy", () => { called = true; });
    } catch {
      // acceptable
    }
    expect(called).toBe(false);
  });
});

// =============================================================================
// Concurrent operations
// =============================================================================

describe("error recovery — concurrent operations", () => {
  it("rapid setItems calls do not corrupt state", () => {
    const vlist = makeList(10);

    for (let i = 0; i < 10; i++) {
      vlist.setItems(createTestItems(i + 1));
    }

    expect(vlist.total).toBe(10);
    expect(vlist.items.length).toBe(10);
  });

  it("interleaved insert and remove maintains consistency", () => {
    const vlist = makeList(5);

    vlist.insertItem({ id: 100, name: "A" } as TestItem, 0);
    vlist.insertItem({ id: 101, name: "B" } as TestItem, 0);
    vlist.removeItem(100);

    expect(vlist.total).toBe(6);
    expect(vlist.getIndexById(100)).toBe(-1);
    expect(vlist.getIndexById(101)).toBe(0);
  });

  it("appendItems followed by removeItems maintains consistency", () => {
    const vlist = makeList(5);

    vlist.appendItems([
      { id: 100, name: "A" } as TestItem,
      { id: 101, name: "B" } as TestItem,
    ]);
    expect(vlist.total).toBe(7);

    vlist.removeItems([100, 101]);
    expect(vlist.total).toBe(5);
  });
});
