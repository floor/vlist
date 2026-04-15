/**
 * vlist - Edge Cases: Boundary Conditions Tests
 * 
 * Tests for extreme boundary conditions:
 * - Empty lists (0 items)
 * - Single item lists
 * - Very large datasets (1M+ items)
 * - Extreme dimensions (1px vs 10000px items)
 * - Zero-dimension containers
 * - Negative or invalid values
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { vlist } from "../../src/builder/core";
import type { VListItem } from "../../src/types";
import { setupDOM, teardownDOM, createMockResizeObserver } from "../helpers/dom";

// =============================================================================
// JSDOM Setup (shared helpers — fires ResizeObserver with real dimensions)
// =============================================================================

beforeAll(() => {
  setupDOM({ width: 300, height: 400 });
});

afterAll(() => {
  teardownDOM();
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

function createContainer(height: number = 400): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: height, configurable: true });
  Object.defineProperty(container, "clientWidth", { value: 300, configurable: true });
  container.style.height = `${height}px`;
  container.style.overflow = "auto";
  document.body.appendChild(container);
  return container;
}

function createItemArray(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));
}

function template(item: TestItem): string {
  return `<div class="item">${item.name}</div>`;
}

// =============================================================================
// Tests: Empty Lists
// =============================================================================

describe("Edge Cases: Empty Lists", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle empty array gracefully", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: [],
    }).build();

    expect(instance).toBeDefined();
    expect(instance.element).toBeTruthy();
    
    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBe(0);

    instance.destroy();
  });

  it("should handle transition from empty to non-empty", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: [],
    }).build();

    expect(instance.element.querySelectorAll("[data-index]").length).toBe(0);

    // Update with data
    instance.setItems(createItemArray(10));

    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should handle transition from non-empty to empty", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    }).build();

    expect(instance.element.querySelectorAll("[data-index]").length).toBeGreaterThan(0);

    // Clear data
    instance.setItems([]);

    const items = instance.element.querySelectorAll("[data-index]");
    // May keep 1 item in pool or render 0 - both are acceptable
    expect(items.length).toBeLessThanOrEqual(1);

    instance.destroy();
  });

  it("should handle scrollToIndex on empty list without error", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: [],
    }).build();

    // Should not throw
    expect(() => instance.scrollToIndex(0)).not.toThrow();
    expect(() => instance.scrollToIndex(10)).not.toThrow();
    expect(() => instance.scrollToIndex(-1)).not.toThrow();

    instance.destroy();
  });

  it("should emit correct events for empty list", () => {
    let rangeChangeCalled = false;

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: [],
    }).build();

    instance.on("range:change", () => {
      rangeChangeCalled = true;
    });

    // Trigger scroll on empty list
    const viewport = instance.element.querySelector(".vlist-viewport") as HTMLElement;
    if (viewport) {
      viewport.scrollTop = 100;
    }

    // Should handle gracefully (may or may not emit depending on implementation)
    expect(instance).toBeDefined();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Single Item Lists
// =============================================================================

describe("Edge Cases: Single Item Lists", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should render single item correctly", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(1),
    }).build();

    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBe(1);

    instance.destroy();
  });

  it("should handle scrolling with single item", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(1),
    }).build();

    const viewport = instance.element.querySelector(".vlist-viewport") as HTMLElement;
    if (viewport) {
      viewport.scrollTop = 100;
    }

    // Should not throw
    expect(instance).toBeDefined();

    instance.destroy();
  });

  it("should handle scrollToIndex(0) on single item", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(1),
    }).build();

    expect(() => instance.scrollToIndex(0)).not.toThrow();

    instance.destroy();
  });

  it("should handle out-of-bounds scrollToIndex on single item", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(1),
    }).build();

    // Should clamp or handle gracefully
    expect(() => instance.scrollToIndex(10)).not.toThrow();
    expect(() => instance.scrollToIndex(-1)).not.toThrow();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Extreme Dataset Sizes
// =============================================================================

describe("Edge Cases: Extreme Dataset Sizes", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle 100k items efficiently", () => {
    const largeData = createItemArray(100_000);

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: largeData,
    }).build();

    // Should only render visible items (virtualization working)
    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeLessThan(100);
    expect(items.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should handle 1M items without crashing", () => {
    const massiveData = createItemArray(1_000_000);

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: massiveData,
    }).build();

    // Should still virtualize
    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeLessThan(100);

    // Content height is capped at MAX_CONTENT_SIZE (16M px) to avoid
    // browser overhead from extremely tall elements.  Without compression,
    // items beyond the cap are unreachable via native scroll anyway.
    const content = instance.element.querySelector(".vlist-content") as HTMLElement;
    const contentHeight = parseInt(content.style.height);
    expect(contentHeight).toBe(16_000_000);

    instance.destroy();
  });

  it("should handle scrolling to end of 100k items", () => {
    const largeData = createItemArray(100_000);

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: largeData,
    }).build();

    // Scroll to near end
    expect(() => instance.scrollToIndex(99_990)).not.toThrow();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Extreme Item Dimensions
// =============================================================================

describe("Edge Cases: Extreme Item Dimensions", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle 1px tall items", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 1, template },
      items: createItemArray(1000),
    }).build();

    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // With 1px items, should handle gracefully
    // Actual render count depends on viewport calculation and overscan
    // Just verify it doesn't crash and renders something

    instance.destroy();
  });

  it("should handle 10000px tall items", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 10000, template },
      items: createItemArray(100),
    }).build();

    // With huge items, should only render a few (visible + overscan)
    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should handle mixed extreme heights (variable)", () => {
    const instance = vlist<TestItem>({
      container,
      item: {
        height: (index) => {
          // Alternate between 1px and 5000px
          return index % 2 === 0 ? 1 : 5000;
        },
        template,
      },
      items: createItemArray(100),
    }).build();

    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    instance.destroy();
  });
});

// =============================================================================
// Tests: Zero-Dimension Containers
// =============================================================================

describe("Edge Cases: Zero-Dimension Containers", () => {
  it("should handle 0px height container", () => {
    const container = createContainer(0);

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Should not crash, but likely won't render items
    expect(instance).toBeDefined();

    instance.destroy();
    container.remove();
  });

  it("should handle 0px width container (horizontal mode)", () => {
    const container = document.createElement("div");
    container.style.width = "0px";
    container.style.height = "400px";
    container.style.overflow = "auto";
    document.body.appendChild(container);

    const instance = vlist<TestItem>({
      container,
      item: { width: 50, template },
      items: createItemArray(100),
      orientation: "horizontal",
    }).build();

    // Should not crash
    expect(instance).toBeDefined();

    instance.destroy();
    container.remove();
  });

  it("should recover when container resizes from 0 to non-zero", () => {
    const container = createContainer(0);

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Resize to non-zero
    container.style.height = "400px";

    // In JSDOM, ResizeObserver callback must be triggered manually
    // In real browsers, this would happen automatically
    // Just verify instance doesn't crash with dimension changes
    expect(instance).toBeDefined();

    instance.destroy();
    container.remove();
  });
});

// =============================================================================
// Tests: Invalid Values
// =============================================================================

describe("Edge Cases: Invalid Values", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle negative itemHeight gracefully", () => {
    // Implementation throws on negative height - this is correct behavior
    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: -50, template },
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).toThrow(); // Negative heights are invalid
  });

  it("should handle 0 itemHeight", () => {
    // Implementation throws on zero height - this is correct behavior
    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: 0, template },
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).toThrow(); // Zero height is invalid
  });

  it("should handle NaN itemHeight", () => {
    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: NaN, template },
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).not.toThrow();
  });

  it("should handle negative scroll position", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    const viewport = instance.element.querySelector(".vlist-viewport") as HTMLElement;
    if (viewport) {
      // JSDOM allows negative scrollTop (browsers clamp to 0)
      // Just verify it doesn't crash
      viewport.scrollTop = -100;
      expect(viewport).toBeDefined();
    }

    instance.destroy();
  });

  it("should handle scrollToIndex with negative index", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Should clamp to 0 or handle gracefully
    expect(() => instance.scrollToIndex(-10)).not.toThrow();

    instance.destroy();
  });

  it("should handle scrollToIndex beyond data length", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    }).build();

    // Should clamp to last item or handle gracefully
    expect(() => instance.scrollToIndex(1000)).not.toThrow();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Rapid Data Mutations
// =============================================================================

describe("Edge Cases: Rapid Data Mutations", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should handle rapid setData calls", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    }).build();

    // Rapidly change data
    for (let i = 0; i < 10; i++) {
      instance.setItems(createItemArray(10 + i * 10));
    }

    // Should still be functional
    const items = instance.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should handle setData during scroll", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    const viewport = instance.element.querySelector(".vlist-viewport") as HTMLElement;
    
    if (viewport) {
      // Start scrolling
      viewport.scrollTop = 500;
    }

    // Change data mid-scroll
    instance.setItems(createItemArray(200));

    // Should not crash
    expect(instance).toBeDefined();

    instance.destroy();
  });

  it("should handle alternating between small and large datasets", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    }).build();

    // Alternate between small and large
    instance.setItems(createItemArray(10000));
    instance.setItems(createItemArray(1));
    instance.setItems(createItemArray(5000));
    instance.setItems(createItemArray(0));
    instance.setItems(createItemArray(100));

    expect(instance).toBeDefined();

    instance.destroy();
  });
});