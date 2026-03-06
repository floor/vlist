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
});
