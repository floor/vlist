/**
 * vlist - sortRenderedDOM Tests
 * Tests for the DOM reordering utility used by renderers for accessibility.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { sortRenderedDOM } from "../../src/rendering/sort";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
  });
  originalDocument = global.document;
  global.document = dom.window.document;
});

afterAll(() => {
  global.document = originalDocument;
});

// =============================================================================
// Helpers
// =============================================================================

function createContainer(indices: number[]): {
  container: HTMLElement;
  elements: Map<number, HTMLElement>;
} {
  const container = document.createElement("div");
  const elements = new Map<number, HTMLElement>();

  for (const idx of indices) {
    const el = document.createElement("div");
    el.dataset.index = String(idx);
    el.textContent = `Item ${idx}`;
    container.appendChild(el);
    elements.set(idx, el);
  }

  return { container, elements };
}

// =============================================================================
// Tests
// =============================================================================

describe("sortRenderedDOM", () => {
  it("should be a no-op for empty keys", () => {
    const container = document.createElement("div");
    const keys = new Map<number, HTMLElement>();

    sortRenderedDOM(container, keys.keys(), (i) => keys.get(i));
    expect(container.children.length).toBe(0);
  });

  it("should be a no-op for single element", () => {
    const { container, elements } = createContainer([5]);

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));
    expect(container.children.length).toBe(1);
    expect((container.children[0] as HTMLElement).dataset.index).toBe("5");
  });

  it("should be a no-op when DOM is already in order", () => {
    const { container, elements } = createContainer([0, 1, 2, 3]);

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["0", "1", "2", "3"]);
  });

  it("should reorder DOM children to match sorted index order", () => {
    // Create container with elements in wrong DOM order
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    // Insert in order: 3, 1, 2, 0 (out of logical order)
    for (const idx of [3, 1, 2, 0]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["0", "1", "2", "3"]);
  });

  it("should handle reverse order", () => {
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [4, 3, 2, 1, 0]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("should handle non-contiguous indices", () => {
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [10, 5, 20, 2]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["2", "5", "10", "20"]);
  });

  it("should skip undefined elements from getElement", () => {
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [2, 0, 1]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    // getElement returns undefined for index 1
    sortRenderedDOM(container, elements.keys(), (i) =>
      i === 1 ? undefined : elements.get(i),
    );

    // Should still have appended what it could
    expect(container.children.length).toBe(3);
  });

  // ===========================================================================
  // Minimal-move property tests
  // ===========================================================================

  it("should not move elements that are already in order (minimal-move)", () => {
    // DOM order: [0, 3, 1, 2]  →  target: [0, 1, 2, 3]
    // Parallel walk: 0 matches cursor → skip.  1 ≠ 3 → insert 1 before 3.
    // 2 ≠ 3 → insert 2 before 3.  3 matches cursor → skip.
    // Elements 0 and 3 are never touched.
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [0, 3, 1, 2]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    const el0 = elements.get(0)!;
    const el3 = elements.get(3)!;

    // Spy: track which elements get moved by monitoring insertBefore
    const movedElements = new Set<HTMLElement>();
    const origInsertBefore = container.insertBefore.bind(container);
    container.insertBefore = function <T extends Node>(newChild: T, refChild: Node | null): T {
      movedElements.add(newChild as unknown as HTMLElement);
      return origInsertBefore(newChild, refChild);
    };

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    // Verify final order is correct
    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["0", "1", "2", "3"]);

    // Element 0 was already at the head — never touched
    expect(movedElements.has(el0)).toBe(false);

    // Element 3 was already after the cursor when reached — never touched
    expect(movedElements.has(el3)).toBe(false);
  });

  it("should not touch any elements when already sorted (no DOM mutations)", () => {
    const { container, elements } = createContainer([0, 1, 2, 3, 4]);

    const movedElements = new Set<HTMLElement>();
    const origInsertBefore = container.insertBefore.bind(container);
    container.insertBefore = function <T extends Node>(newChild: T, refChild: Node | null): T {
      movedElements.add(newChild as unknown as HTMLElement);
      return origInsertBefore(newChild, refChild);
    };
    const origAppendChild = container.appendChild.bind(container);
    container.appendChild = function <T extends Node>(newChild: T): T {
      movedElements.add(newChild as unknown as HTMLElement);
      return origAppendChild(newChild);
    };

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    // No elements should have been moved at all
    expect(movedElements.size).toBe(0);

    // Order unchanged
    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("should move only one element when two items are swapped at the end", () => {
    // DOM order: [0, 1, 2, 4, 3] → target: [0, 1, 2, 3, 4]
    // Parallel walk: 0,1,2 match → skip.  el=3, cursor=4 → insert 3 before 4.
    // el=4, cursor=4 → match.  Only element 3 is moved.
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [0, 1, 2, 4, 3]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    const movedElements = new Set<HTMLElement>();
    const origInsertBefore = container.insertBefore.bind(container);
    container.insertBefore = function <T extends Node>(newChild: T, refChild: Node | null): T {
      movedElements.add(newChild as unknown as HTMLElement);
      return origInsertBefore(newChild, refChild);
    };

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["0", "1", "2", "3", "4"]);

    // Only one element should have been moved
    expect(movedElements.size).toBe(1);
    expect(movedElements.has(elements.get(3)!)).toBe(true);
  });

  it("should move only new items when scrolling down appends at the end", () => {
    // Typical scroll-down scenario:
    // Before scroll: items [0, 1, 2, 3] in order
    // After scroll: items [1, 2, 3, 4] — item 0 removed, item 4 appended at end
    // DOM order: [1, 2, 3, 4] — already correct!
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [1, 2, 3, 4]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    const movedElements = new Set<HTMLElement>();
    const origInsertBefore = container.insertBefore.bind(container);
    container.insertBefore = function <T extends Node>(newChild: T, refChild: Node | null): T {
      movedElements.add(newChild as unknown as HTMLElement);
      return origInsertBefore(newChild, refChild);
    };

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    const order = Array.from(container.children).map(
      (el) => (el as HTMLElement).dataset.index,
    );
    expect(order).toEqual(["1", "2", "3", "4"]);

    // Nothing should have moved — already in order
    expect(movedElements.size).toBe(0);
  });

  it("should preserve element identity (same DOM nodes, not clones)", () => {
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [2, 0, 1]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    const el0 = elements.get(0)!;
    const el1 = elements.get(1)!;
    const el2 = elements.get(2)!;

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    // Same DOM nodes, not clones
    expect(container.children[0]).toBe(el0);
    expect(container.children[1]).toBe(el1);
    expect(container.children[2]).toBe(el2);
  });

  it("should handle the realistic grid scenario (new row appended at end of container)", () => {
    // Grid with 4 columns, scrolling down:
    // Existing DOM: items [0,1,2,3, 4,5,6,7] in order
    // After scroll: new row [8,9,10,11] appended at end by vlist render
    // DOM order: [0,1,2,3, 4,5,6,7, 8,9,10,11] — already sorted
    const container = document.createElement("div");
    const elements = new Map<number, HTMLElement>();

    for (const idx of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const el = document.createElement("div");
      el.dataset.index = String(idx);
      container.appendChild(el);
      elements.set(idx, el);
    }

    const movedElements = new Set<HTMLElement>();
    const origInsertBefore = container.insertBefore.bind(container);
    container.insertBefore = function <T extends Node>(newChild: T, refChild: Node | null): T {
      movedElements.add(newChild as unknown as HTMLElement);
      return origInsertBefore(newChild, refChild);
    };

    sortRenderedDOM(container, elements.keys(), (i) => elements.get(i));

    expect(movedElements.size).toBe(0);
  });
});
