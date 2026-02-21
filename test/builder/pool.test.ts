/**
 * vlist - Builder Pool Tests
 * Tests for element pool (DOM element recycling)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { createElementPool } from "../../src/builder/pool";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
});

// =============================================================================
// Tests
// =============================================================================

describe("createElementPool", () => {
  it("should create a pool with default max size", () => {
    const pool = createElementPool();
    expect(pool).toBeDefined();
    expect(pool.acquire).toBeInstanceOf(Function);
    expect(pool.release).toBeInstanceOf(Function);
    expect(pool.clear).toBeInstanceOf(Function);
  });

  it("should create a pool with custom max size", () => {
    const pool = createElementPool(50);
    expect(pool).toBeDefined();
  });
});

describe("acquire", () => {
  it("should return a new element when pool is empty", () => {
    const pool = createElementPool();
    const el = pool.acquire();

    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("role")).toBe("option");
  });

  it("should return different elements on successive calls when pool is empty", () => {
    const pool = createElementPool();
    const el1 = pool.acquire();
    const el2 = pool.acquire();

    expect(el1).not.toBe(el2);
  });

  it("should return a recycled element when pool is not empty", () => {
    const pool = createElementPool();
    const el1 = pool.acquire();
    el1.textContent = "test";

    pool.release(el1);

    const el2 = pool.acquire();
    expect(el2).toBe(el1);
    expect(el2.textContent).toBe(""); // Should be cleaned
  });

  it("should return elements in LIFO order (stack behavior)", () => {
    const pool = createElementPool();

    const el1 = pool.acquire();
    const el2 = pool.acquire();
    const el3 = pool.acquire();

    pool.release(el1);
    pool.release(el2);
    pool.release(el3);

    expect(pool.acquire()).toBe(el3);
    expect(pool.acquire()).toBe(el2);
    expect(pool.acquire()).toBe(el1);
  });
});

describe("release", () => {
  it("should add element back to pool", () => {
    const pool = createElementPool();
    const el = pool.acquire();

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2).toBe(el);
  });

  it("should clear element className before pooling", () => {
    const pool = createElementPool();
    const el = pool.acquire();
    el.className = "test-class another-class";

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.className).toBe("");
  });

  it("should clear element textContent before pooling", () => {
    const pool = createElementPool();
    const el = pool.acquire();
    el.textContent = "Some content";

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.textContent).toBe("");
  });

  it("should remove style attribute before pooling", () => {
    const pool = createElementPool();
    const el = pool.acquire();
    el.setAttribute("style", "color: red; font-size: 16px;");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("style")).toBe(false);
  });

  it("should remove data-index attribute before pooling", () => {
    const pool = createElementPool();
    const el = pool.acquire();
    el.setAttribute("data-index", "42");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("data-index")).toBe(false);
  });

  it("should remove data-id attribute before pooling", () => {
    const pool = createElementPool();
    const el = pool.acquire();
    el.setAttribute("data-id", "item-123");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("data-id")).toBe(false);
  });

  it("should respect max pool size", () => {
    const pool = createElementPool(2);
    const el1 = pool.acquire();
    const el2 = pool.acquire();
    const el3 = pool.acquire();

    pool.release(el1);
    pool.release(el2);
    pool.release(el3); // Should be discarded (pool full)

    const recycled1 = pool.acquire();
    const recycled2 = pool.acquire();
    const recycled3 = pool.acquire();

    expect(recycled1).toBe(el2);
    expect(recycled2).toBe(el1);
    expect(recycled3).not.toBe(el3); // el3 was discarded
    expect(recycled3).toBeInstanceOf(HTMLElement);
  });

  it("should allow releasing same element multiple times (no duplicate check)", () => {
    const pool = createElementPool();
    const el = pool.acquire();

    pool.release(el);
    pool.release(el); // Release twice - pool doesn't check for duplicates

    const el1 = pool.acquire();
    const el2 = pool.acquire();

    // Both acquires will return the same element (it was added twice)
    expect(el1).toBe(el);
    expect(el2).toBe(el);
  });
});

describe("clear", () => {
  it("should empty the pool", () => {
    const pool = createElementPool();
    const el1 = pool.acquire();
    const el2 = pool.acquire();

    pool.release(el1);
    pool.release(el2);

    pool.clear();

    const el3 = pool.acquire();
    expect(el3).not.toBe(el1);
    expect(el3).not.toBe(el2);
  });

  it("should allow new elements to be pooled after clear", () => {
    const pool = createElementPool();
    const el1 = pool.acquire();
    pool.release(el1);
    pool.clear();

    const el2 = pool.acquire();
    pool.release(el2);

    const el3 = pool.acquire();
    expect(el3).toBe(el2);
  });

  it("should work when called on empty pool", () => {
    const pool = createElementPool();
    expect(() => pool.clear()).not.toThrow();
  });
});

describe("pool lifecycle", () => {
  it("should handle many acquire/release cycles", () => {
    const pool = createElementPool(10);
    const elements: HTMLElement[] = [];

    // Acquire many elements
    for (let i = 0; i < 100; i++) {
      elements.push(pool.acquire());
    }

    // Release them all
    for (const el of elements) {
      pool.release(el);
    }

    // Pool should only keep last 10 (max size)
    const recycled: HTMLElement[] = [];
    for (let i = 0; i < 15; i++) {
      recycled.push(pool.acquire());
    }

    // First 10 should be recycled
    let recycledCount = 0;
    for (const el of recycled) {
      if (elements.includes(el)) {
        recycledCount++;
      }
    }

    expect(recycledCount).toBe(10);
  });

  it("should maintain element role attribute across pool cycles", () => {
    const pool = createElementPool();
    const el = pool.acquire();

    expect(el.getAttribute("role")).toBe("option");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.getAttribute("role")).toBe("option");
  });
});

describe("edge cases", () => {
  it("should handle maxSize of 0", () => {
    const pool = createElementPool(0);
    const el = pool.acquire();

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2).not.toBe(el); // Should not pool anything
  });

  it("should handle maxSize of 1", () => {
    const pool = createElementPool(1);
    const el1 = pool.acquire();
    const el2 = pool.acquire();

    pool.release(el1);
    pool.release(el2);

    const recycled = pool.acquire();
    // With maxSize=1, only one element can be pooled
    // The second release (el2) should be the one kept
    expect([el1, el2]).toContain(recycled);
  });

  it("should handle very large maxSize", () => {
    const pool = createElementPool(10000);
    const elements: HTMLElement[] = [];

    for (let i = 0; i < 100; i++) {
      elements.push(pool.acquire());
    }

    for (const el of elements) {
      pool.release(el);
    }

    const recycled: HTMLElement[] = [];
    for (let i = 0; i < 100; i++) {
      recycled.push(pool.acquire());
    }

    // All should be recycled
    expect(recycled.every((el) => elements.includes(el))).toBe(true);
  });

  it("should clean elements with complex attributes", () => {
    const pool = createElementPool();
    const el = pool.acquire();

    // Add many attributes
    el.className = "class1 class2 class3";
    el.textContent = "Complex content with special chars: €£¥";
    el.setAttribute("style", "display: flex; color: red;");
    el.setAttribute("data-index", "999");
    el.setAttribute("data-id", "complex-id-123");
    el.setAttribute("aria-label", "Custom label");
    el.setAttribute("custom-attr", "custom-value");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.className).toBe("");
    expect(el2.textContent).toBe("");
    expect(el2.hasAttribute("style")).toBe(false);
    expect(el2.hasAttribute("data-index")).toBe(false);
    expect(el2.hasAttribute("data-id")).toBe(false);
    // Note: aria-label and custom-attr are NOT cleaned by the pool
    // (only className, textContent, style, data-index, data-id)
  });
});
