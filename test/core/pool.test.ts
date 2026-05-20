/**
 * vlist v2 - Builder Pool Tests
 * Tests for element pool (DOM element recycling)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { createPool } from "../../src/core/pool";

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

describe("createPool", () => {
  it("should create a pool with classPrefix", () => {
    const pool = createPool("vlist");
    expect(pool).toBeDefined();
    expect(pool.acquire).toBeInstanceOf(Function);
    expect(pool.release).toBeInstanceOf(Function);
    expect(pool.clear).toBeInstanceOf(Function);
    expect(pool.size).toBe(0);
  });
});

describe("acquire", () => {
  it("should return a new element when pool is empty", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();

    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("vlist-item");
    expect(el.getAttribute("role")).toBeNull();
  });

  it("should return different elements on successive calls when pool is empty", () => {
    const pool = createPool("vlist");
    const el1 = pool.acquire();
    const el2 = pool.acquire();

    expect(el1).not.toBe(el2);
  });

  it("should return a recycled element when pool is not empty", () => {
    const pool = createPool("vlist");
    const el1 = pool.acquire();
    el1.textContent = "test";

    pool.release(el1);

    const el2 = pool.acquire();
    expect(el2).toBe(el1);
    expect(el2.textContent).toBe(""); // Should be cleaned
  });

  it("should return elements in LIFO order (stack behavior)", () => {
    const pool = createPool("vlist");

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
    const pool = createPool("vlist");
    const el = pool.acquire();

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2).toBe(el);
  });

  it("should reset element className to classPrefix-item before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.className = "test-class another-class";

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.className).toBe("vlist-item");
  });

  it("should clear element innerHTML before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.innerHTML = "<span>Some content</span>";

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.innerHTML).toBe("");
  });

  it("should remove style attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("style", "color: red; font-size: 16px;");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("style")).toBe(false);
  });

  it("should remove data-index attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("data-index", "42");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("data-index")).toBe(false);
  });

  it("should remove data-id attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("data-id", "item-123");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("data-id")).toBe(false);
  });

  it("should remove aria-selected attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("aria-selected", "true");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("aria-selected")).toBe(false);
  });

  it("should remove aria-posinset attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("aria-posinset", "5");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("aria-posinset")).toBe(false);
  });

  it("should remove aria-setsize attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("aria-setsize", "100");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.hasAttribute("aria-setsize")).toBe(false);
  });

  it("should remove role attribute before pooling", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();
    el.setAttribute("role", "option");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.getAttribute("role")).toBeNull();
  });

  it("should respect max pool size (hardcoded 100)", () => {
    const pool = createPool("vlist");
    const elements: HTMLElement[] = [];

    // Acquire 150 elements
    for (let i = 0; i < 150; i++) {
      elements.push(pool.acquire());
    }

    // Release all of them
    for (const el of elements) {
      pool.release(el);
    }

    // Pool should only keep last 100 (MAX_POOL_SIZE)
    const recycled: HTMLElement[] = [];
    for (let i = 0; i < 120; i++) {
      recycled.push(pool.acquire());
    }

    // Count how many are from original elements
    let recycledCount = 0;
    for (const el of recycled) {
      if (elements.includes(el)) {
        recycledCount++;
      }
    }

    // Should have exactly 100 recycled, 20 new
    expect(recycledCount).toBe(100);
  });

  it("should allow releasing same element multiple times (no duplicate check)", () => {
    const pool = createPool("vlist");
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
    const pool = createPool("vlist");
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
    const pool = createPool("vlist");
    const el1 = pool.acquire();
    pool.release(el1);
    pool.clear();

    const el2 = pool.acquire();
    pool.release(el2);

    const el3 = pool.acquire();
    expect(el3).toBe(el2);
  });

  it("should work when called on empty pool", () => {
    const pool = createPool("vlist");
    expect(() => pool.clear()).not.toThrow();
  });

  it("should reset size to 0 after clear", () => {
    const pool = createPool("vlist");
    const el1 = pool.acquire();
    const el2 = pool.acquire();

    pool.release(el1);
    pool.release(el2);

    expect(pool.size).toBe(2);
    pool.clear();
    expect(pool.size).toBe(0);
  });
});

describe("pool lifecycle", () => {
  it("should handle many acquire/release cycles with hardcoded max size", () => {
    const pool = createPool("vlist");
    const elements: HTMLElement[] = [];

    // Acquire many elements
    for (let i = 0; i < 120; i++) {
      elements.push(pool.acquire());
    }

    // Release them all
    for (const el of elements) {
      pool.release(el);
    }

    // Pool should only keep last 100 (MAX_POOL_SIZE=100)
    const recycled: HTMLElement[] = [];
    for (let i = 0; i < 110; i++) {
      recycled.push(pool.acquire());
    }

    // Exactly 100 should be recycled, 10 should be new
    let recycledCount = 0;
    for (const el of recycled) {
      if (elements.includes(el)) {
        recycledCount++;
      }
    }

    expect(recycledCount).toBe(100);
  });

  it("should maintain element role attribute across pool cycles", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();

    expect(el.getAttribute("role")).toBeNull();

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.getAttribute("role")).toBeNull();
  });

  it("should track pool size correctly", () => {
    const pool = createPool("vlist");
    expect(pool.size).toBe(0);

    const el1 = pool.acquire();
    expect(pool.size).toBe(0); // Not in pool yet

    pool.release(el1);
    expect(pool.size).toBe(1);

    const el2 = pool.acquire();
    expect(pool.size).toBe(0); // Acquired one

    pool.release(el2);
    expect(pool.size).toBe(1);
  });
});

describe("edge cases", () => {
  it("should clean elements with complex attributes", () => {
    const pool = createPool("vlist");
    const el = pool.acquire();

    // Add many attributes
    el.className = "class1 class2 class3";
    el.innerHTML = "<span>Complex content with special chars: €£¥</span>";
    el.setAttribute("style", "display: flex; color: red;");
    el.setAttribute("data-index", "999");
    el.setAttribute("data-id", "complex-id-123");
    el.setAttribute("aria-label", "Custom label");
    el.setAttribute("aria-selected", "true");
    el.setAttribute("custom-attr", "custom-value");

    pool.release(el);

    const el2 = pool.acquire();
    expect(el2.className).toBe("vlist-item");
    expect(el2.innerHTML).toBe("");
    expect(el2.hasAttribute("style")).toBe(false);
    expect(el2.hasAttribute("data-index")).toBe(false);
    expect(el2.hasAttribute("data-id")).toBe(false);
    expect(el2.hasAttribute("aria-selected")).toBe(false);
    // Note: aria-label and custom-attr are NOT cleaned by the pool
    // (only className reset to "vlist-item", innerHTML, style, data-index, data-id, aria-selected)
  });

  it("should handle many elements within MAX_POOL_SIZE limit", () => {
    const pool = createPool("vlist");
    const elements: HTMLElement[] = [];

    // Acquire exactly 100 elements (MAX_POOL_SIZE)
    for (let i = 0; i < 100; i++) {
      elements.push(pool.acquire());
    }

    // Release all
    for (const el of elements) {
      pool.release(el);
    }

    // All should be recycled
    const recycled: HTMLElement[] = [];
    for (let i = 0; i < 100; i++) {
      recycled.push(pool.acquire());
    }

    expect(recycled.every((el) => elements.includes(el))).toBe(true);
  });

  it("should discard elements beyond MAX_POOL_SIZE when released", () => {
    const pool = createPool("vlist");
    const elements: HTMLElement[] = [];

    // Acquire 105 elements
    for (let i = 0; i < 105; i++) {
      elements.push(pool.acquire());
    }

    // Release all (last 5 should be discarded)
    for (const el of elements) {
      pool.release(el);
    }

    // Should have exactly 100 in pool
    expect(pool.size).toBe(100);

    // Only first 100 should be recycled
    const recycled: HTMLElement[] = [];
    for (let i = 0; i < 100; i++) {
      recycled.push(pool.acquire());
    }

    // The last 5 elements should NOT be in recycled
    const lastFive = elements.slice(100);
    for (const el of lastFive) {
      expect(recycled).not.toContain(el);
    }
  });
});
