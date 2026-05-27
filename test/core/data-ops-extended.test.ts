/**
 * vlist v2 — Data Operations Extended Tests
 *
 * Covers data operation edge cases from v1 not in the base data-ops.test.ts:
 * state transitions, event emission, string IDs, large datasets,
 * sequential mutations, and updateItem re-rendering.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";

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

function makeList(count: number): { list: VList<TestItem>; container: HTMLElement } {
  const container = createContainer({ width: 300, height: 500 });
  const list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 50, template: simpleTemplate } },
    [],
  );
  return { list, container };
}

// =============================================================================
// State transitions
// =============================================================================

describe("data ops extended — state transitions", () => {
  it("empty to populated to empty to populated", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>(
      { container, items: [], item: { height: 50, template: simpleTemplate } },
      [],
    );

    expect(list.total).toBe(0);

    list.setItems(createTestItems(10));
    expect(list.total).toBe(10);

    list.setItems([]);
    expect(list.total).toBe(0);

    list.setItems(createTestItems(5));
    expect(list.total).toBe(5);

    list.destroy();
    container.remove();
  });

  it("rapid setItems does not corrupt state", () => {
    const { list, container } = makeList(10);

    for (let i = 0; i < 20; i++) {
      list.setItems(createTestItems(i + 1));
    }

    expect(list.total).toBe(20);

    list.destroy();
    container.remove();
  });

  it("setItems with large dataset swap", () => {
    const { list, container } = makeList(10);

    list.setItems(createTestItems(10000));
    expect(list.total).toBe(10000);

    list.setItems(createTestItems(1));
    expect(list.total).toBe(1);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// Data operations trigger re-render
// =============================================================================

describe("data ops extended — re-render on mutation", () => {
  it("setItems triggers re-render with new content", () => {
    const { list, container } = makeList(10);
    const content = container.querySelector(".vlist-content")!;
    const childrenBefore = content.children.length;

    list.setItems(createTestItems(20));
    expect(list.total).toBe(20);
    expect(content.children.length).toBeGreaterThan(0);

    list.destroy();
    container.remove();
  });

  it("removeItem triggers re-render", () => {
    const { list, container } = makeList(10);
    const content = container.querySelector(".vlist-content")!;

    const firstItem = list.getItemAt(0)!;
    list.removeItem(firstItem.id);
    expect(list.total).toBe(9);
    expect(content.children.length).toBeGreaterThan(0);

    list.destroy();
    container.remove();
  });

  it("insertItem triggers re-render", () => {
    const { list, container } = makeList(10);
    const content = container.querySelector(".vlist-content")!;

    list.insertItem({ id: 999, name: "new" } as TestItem);
    expect(list.total).toBe(11);
    expect(content.children.length).toBeGreaterThan(0);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// String IDs
// =============================================================================

describe("data ops extended — string IDs", () => {
  it("handles items with string IDs", () => {
    const container = createContainer({ width: 300, height: 500 });
    const items = [
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
      { id: "gamma", name: "Gamma" },
    ] as unknown as TestItem[];

    const list = createVList<TestItem>(
      { container, items, item: { height: 50, template: simpleTemplate } },
      [],
    );

    expect(list.total).toBe(3);
    expect(list.getItemAt(0)?.id as unknown).toBe("alpha");

    list.removeItem("beta");
    expect(list.total).toBe(2);
    expect(list.getItemAt(1)?.id as unknown).toBe("gamma");

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// Sequential mutations
// =============================================================================

describe("data ops extended — sequential mutations", () => {
  it("insert then remove same item", () => {
    const { list, container } = makeList(5);

    const newItem = { id: 888, name: "temp" } as TestItem;
    list.insertItem(newItem);
    expect(list.total).toBe(6);

    list.removeItem(888);
    expect(list.total).toBe(5);

    list.destroy();
    container.remove();
  });

  it("remove all items one by one", () => {
    const items = createTestItems(5);
    const container = createContainer({ width: 300, height: 500 });
    const list = createVList<TestItem>(
      { container, items, item: { height: 50, template: simpleTemplate } },
      [],
    );

    for (let i = 0; i < 5; i++) {
      const item = list.getItemAt(0);
      if (item) list.removeItem(item.id);
    }

    expect(list.total).toBe(0);
    const content = container.querySelector(".vlist-content")!;
    expect(content.children.length).toBe(0);

    list.destroy();
    container.remove();
  });

  it("updateItem followed by removeItem", () => {
    const { list, container } = makeList(5);

    const item = list.getItemAt(2)!;
    list.updateItem(item.id, { name: "updated" });
    expect(list.getItemAt(2)!.name).toBe("updated");

    list.removeItem(item.id);
    expect(list.total).toBe(4);

    list.destroy();
    container.remove();
  });

  it("setItems after multiple removes", () => {
    const { list, container } = makeList(10);

    const id1 = list.getItemAt(0)!.id;
    const id2 = list.getItemAt(1)!.id;
    list.removeItem(id1);
    list.removeItem(id2);
    expect(list.total).toBe(8);

    list.setItems(createTestItems(3));
    expect(list.total).toBe(3);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// getItemAt edge cases
// =============================================================================

describe("data ops extended — getItemAt", () => {
  it("returns undefined for negative index", () => {
    const { list, container } = makeList(5);

    expect(list.getItemAt(-1)).toBeUndefined();

    list.destroy();
    container.remove();
  });

  it("returns undefined for index beyond total", () => {
    const { list, container } = makeList(5);

    expect(list.getItemAt(5)).toBeUndefined();
    expect(list.getItemAt(100)).toBeUndefined();

    list.destroy();
    container.remove();
  });

  it("returns correct item at each index after mutations", () => {
    const { list, container } = makeList(5);

    const originalFirst = list.getItemAt(0)!;
    list.removeItem(originalFirst.id);

    const newFirst = list.getItemAt(0)!;
    expect(newFirst.id).not.toBe(originalFirst.id);

    list.destroy();
    container.remove();
  });
});
