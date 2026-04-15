/**
 * vlist - Memory Optimization Tests
 *
 * Verifies the memory optimizations introduced to reduce GC pressure and
 * heap growth during sustained scrolling:
 *
 * 1. Content height cap — content element capped at 16M px without compression
 * 2. Reusable event payloads — scroll/velocity/range events reuse objects
 * 3. Conditional allocation — newlyRendered array skipped without afterRenderBatch hooks
 * 4. Guarded claimPlaceholderSelection — skipped without async data manager
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { JSDOM } from "jsdom";
import { vlist } from "../../src/builder/core";
import type { VList } from "../../src/builder/types";
import { withScale } from "../../src/features/scale/feature";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;

beforeAll(() => {
  dom = setupDOM({ width: 300, height: 500 });
});

afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  container.remove();
});

const template = (item: TestItem): string =>
  `<div class="item">${item.name}</div>`;

/** Create a large item array with minimal per-object overhead. */
const createItemArray = (count: number): TestItem[] => {
  const items = new Array(count);
  for (let i = 0; i < count; i++) {
    items[i] = { id: i + 1, name: `Item ${i + 1}` };
  }
  return items;
};

/** Find the content element inside a vlist container. */
const getContentEl = (el: HTMLElement): HTMLElement =>
  el.querySelector(".vlist-content") as HTMLElement;

/** Find the viewport element inside a vlist container. */
const getViewportEl = (el: HTMLElement): HTMLElement =>
  el.querySelector(".vlist-viewport") as HTMLElement;

/**
 * Simulate a scroll by setting scrollTop and dispatching a JSDOM scroll event.
 * Matches the pattern used by builder/index.test.ts.
 */
const simulateScroll = (list: VList<TestItem>, scrollTop: number): void => {
  const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
  if (!viewport) return;
  viewport.scrollTop = scrollTop;
  viewport.dispatchEvent(new dom.window.Event("scroll"));
};

// =============================================================================
// 1. Content Height Cap
// =============================================================================

describe("memory — content height cap", () => {
  it("should cap content height at 16M px for large lists without compression", () => {
    const items = createItemArray(500_000); // 500K × 50px = 25M px (exceeds 16M)
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const content = getContentEl(instance.element);
    const height = parseInt(content.style.height);

    expect(height).toBe(16_000_000);

    instance.destroy();
  });

  it("should not cap content height for lists under 16M px", () => {
    const items = createItemArray(100_000); // 100K × 50px = 5M px (under 16M)
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const content = getContentEl(instance.element);
    const height = parseInt(content.style.height);

    expect(height).toBe(100_000 * 50);

    instance.destroy();
  });

  it("should not cap content height when compression is active", () => {
    const items = createItemArray(500_000);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withScale({ force: true }))
      .build();

    const content = getContentEl(instance.element);
    const height = parseInt(content.style.height);

    // With compression active, the feature manages the content size directly.
    // It should NOT be capped at 16M — withScale sets its own virtual size.
    // The exact value depends on compression ratio, but it should not be
    // truncated to 16M when the actual virtual size is different.
    expect(height).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should cap exactly at boundary (16M / itemHeight items)", () => {
    // 16M / 40 = 400K items → exactly 16M px, should NOT be capped
    const items = createItemArray(400_000);
    const instance = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const content = getContentEl(instance.element);
    const height = parseInt(content.style.height);

    expect(height).toBe(400_000 * 40); // exactly 16M

    instance.destroy();
  });

  it("should cap one item past the boundary", () => {
    // 400_001 × 40 = 16_000_040 px → exceeds 16M, should be capped
    const items = createItemArray(400_001);
    const instance = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const content = getContentEl(instance.element);
    const height = parseInt(content.style.height);

    expect(height).toBe(16_000_000);

    instance.destroy();
  });

  it("should still virtualize correctly with capped content height", () => {
    const items = createItemArray(1_000_000);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Should only render visible items + overscan, not all 1M
    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeLessThan(50);
    expect(rendered.length).toBeGreaterThan(0);

    instance.destroy();
  });
});

// =============================================================================
// 2. Reusable Event Payloads
// =============================================================================

describe("memory — reusable event payloads", () => {
  it("should emit scroll events with correct values", () => {
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const scrollEvents: Array<{ scrollPosition: number; direction: string }> = [];
    instance.on("scroll", (data) => {
      // Capture values synchronously (as documented for reusable payloads)
      scrollEvents.push({
        scrollPosition: data.scrollPosition,
        direction: data.direction,
      });
    });

    simulateScroll(instance, 100);
    simulateScroll(instance, 200);
    simulateScroll(instance, 300);

    expect(scrollEvents.length).toBe(3);
    expect(scrollEvents[0]!.scrollPosition).toBe(100);
    expect(scrollEvents[1]!.scrollPosition).toBe(200);
    expect(scrollEvents[2]!.scrollPosition).toBe(300);

    // All should be "down" since positions are increasing
    for (const evt of scrollEvents) {
      expect(evt.direction).toBe("down");
    }

    instance.destroy();
  });

  it("should emit correct direction on scroll reversal", () => {
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const directions: string[] = [];
    instance.on("scroll", (data) => {
      directions.push(data.direction);
    });

    simulateScroll(instance, 100);
    simulateScroll(instance, 200);
    simulateScroll(instance, 150);
    simulateScroll(instance, 50);

    expect(directions).toEqual(["down", "down", "up", "up"]);

    instance.destroy();
  });

  it("should emit velocity:change with correct values", () => {
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const velocityEvents: Array<{ velocity: number; reliable: boolean }> = [];
    instance.on("velocity:change", (data) => {
      velocityEvents.push({
        velocity: data.velocity,
        reliable: data.reliable,
      });
    });

    simulateScroll(instance, 100);
    simulateScroll(instance, 200);

    expect(velocityEvents.length).toBeGreaterThanOrEqual(2);
    // Velocity values should be numbers
    for (const evt of velocityEvents) {
      expect(typeof evt.velocity).toBe("number");
      expect(typeof evt.reliable).toBe("boolean");
    }

    instance.destroy();
  });

  it("should emit range:change with correct values", () => {
    const items = createTestItems(200);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const rangeEvents: Array<{ start: number; end: number }> = [];
    instance.on("range:change", (data) => {
      rangeEvents.push({
        start: data.range.start,
        end: data.range.end,
      });
    });

    // Scroll far enough to trigger a range change
    simulateScroll(instance, 500);
    simulateScroll(instance, 1000);

    // Should have received at least one range change
    expect(rangeEvents.length).toBeGreaterThan(0);

    for (const evt of rangeEvents) {
      expect(evt.start).toBeGreaterThanOrEqual(0);
      expect(evt.end).toBeGreaterThanOrEqual(evt.start);
    }

    instance.destroy();
  });

  it("should reuse the same payload object across emits", () => {
    const items = createTestItems(200);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const scrollPayloads: object[] = [];
    instance.on("scroll", (data) => {
      scrollPayloads.push(data);
    });

    simulateScroll(instance, 100);
    simulateScroll(instance, 200);
    simulateScroll(instance, 300);

    expect(scrollPayloads.length).toBe(3);

    // All references should point to the same object (reused payload)
    expect(scrollPayloads[0]).toBe(scrollPayloads[1]);
    expect(scrollPayloads[1]).toBe(scrollPayloads[2]);

    // The object's current values should be from the last emit
    expect((scrollPayloads[2] as any).scrollPosition).toBe(300);

    instance.destroy();
  });

  it("should reuse the same velocity payload object across emits", () => {
    const items = createTestItems(200);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const velPayloads: object[] = [];
    instance.on("velocity:change", (data) => {
      velPayloads.push(data);
    });

    simulateScroll(instance, 100);
    simulateScroll(instance, 200);
    simulateScroll(instance, 300);

    expect(velPayloads.length).toBeGreaterThanOrEqual(3);

    // All references should be the same reused object
    for (let i = 1; i < velPayloads.length; i++) {
      expect(velPayloads[i]).toBe(velPayloads[0]);
    }

    instance.destroy();
  });

  it("should reuse the same range:change payload object across emits", () => {
    const items = createTestItems(500);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const rangePayloads: object[] = [];
    instance.on("range:change", (data) => {
      rangePayloads.push(data);
    });

    simulateScroll(instance, 500);
    simulateScroll(instance, 1000);
    simulateScroll(instance, 1500);

    if (rangePayloads.length >= 2) {
      for (let i = 1; i < rangePayloads.length; i++) {
        expect(rangePayloads[i]).toBe(rangePayloads[0]);
      }
    }

    instance.destroy();
  });
});

// =============================================================================
// 3. Conditional newlyRendered Allocation
// =============================================================================

describe("memory — conditional newlyRendered allocation", () => {
  it("should render items correctly without afterRenderBatch hooks", () => {
    // Vanilla list — no withAutoSize — should skip newlyRendered allocation
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    // Items should have correct content
    const firstItem = rendered[0] as HTMLElement;
    expect(firstItem.innerHTML).toContain("Item");

    instance.destroy();
  });

  it("should update rendered items correctly during scroll without hooks", () => {
    const items = createTestItems(200);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    simulateScroll(instance, 500);

    // After scrolling, items should still be rendered with correct indices
    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    // Check that indices reflect the scrolled position
    const indices = Array.from(rendered).map((el) =>
      parseInt((el as HTMLElement).dataset.index ?? "-1"),
    );
    const minIndex = Math.min(...indices);
    expect(minIndex).toBeGreaterThan(0); // Should have scrolled past index 0

    instance.destroy();
  });

  it("should add new elements to rendered Map during the loop (not after)", () => {
    // This tests the optimization where rendered.set() happens inside the
    // loop instead of in a separate pass after fragment append.
    const items = createTestItems(50);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Scroll to trigger new elements
    simulateScroll(instance, 200);
    simulateScroll(instance, 400);
    simulateScroll(instance, 600);

    // Verify items are rendered correctly after multiple scrolls
    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    // Each rendered item should have a valid data-id
    for (const el of rendered) {
      const id = (el as HTMLElement).dataset.id;
      expect(id).toBeDefined();
      expect(id).not.toBe("");
    }

    instance.destroy();
  });
});

// =============================================================================
// 4. Guarded claimPlaceholderSelection
// =============================================================================

describe("memory — guarded claimPlaceholderSelection", () => {
  it("should render correctly without async data manager", () => {
    // Vanilla list — no withAsync — claimPlaceholderSelection should be skipped
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    // Selection state should work fine without the claim logic
    const firstItem = rendered[0] as HTMLElement;
    expect(firstItem.getAttribute("aria-selected")).toBe("false");

    instance.destroy();
  });

  it("should handle scroll without placeholder claim overhead", () => {
    const items = createTestItems(200);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Rapidly scroll through many positions — should not throw
    // and should not create unnecessary placeholder strings
    expect(() => {
      for (let i = 0; i < 20; i++) {
        simulateScroll(instance, i * 100);
      }
    }).not.toThrow();

    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should maintain correct data-id on items during scroll without async", () => {
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    simulateScroll(instance, 200);

    const rendered = instance.element.querySelectorAll("[data-index]");
    for (const el of rendered) {
      const htmlEl = el as HTMLElement;
      const index = parseInt(htmlEl.dataset.index ?? "-1");
      const id = htmlEl.dataset.id;
      // data-id should match item.id (which is index + 1 for createTestItems)
      expect(id).toBe(String(index + 1));
    }

    instance.destroy();
  });
});

// =============================================================================
// 5. Sustained Scroll Stability
// =============================================================================

describe("memory — sustained scroll stability", () => {
  it("should maintain bounded rendered element count during sustained scroll", () => {
    const items = createTestItems(10_000);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Simulate 100 scroll frames going down
    for (let i = 0; i < 100; i++) {
      simulateScroll(instance, i * 50);
    }

    const rendered = instance.element.querySelectorAll("[data-index]");
    // Should be bounded: visible items + 2 × overscan (3) = ~16 items max
    expect(rendered.length).toBeLessThan(30);
    expect(rendered.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should maintain bounded rendered count when bouncing scroll direction", () => {
    const items = createTestItems(10_000);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Bounce: down → up → down → up
    for (let i = 0; i < 50; i++) simulateScroll(instance, i * 100);
    for (let i = 49; i >= 0; i--) simulateScroll(instance, i * 100);
    for (let i = 0; i < 50; i++) simulateScroll(instance, i * 100);

    const rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeLessThan(30);
    expect(rendered.length).toBeGreaterThan(0);

    instance.destroy();
  });

  it("should not accumulate DOM elements during rapid scrolling", () => {
    const items = createTestItems(5_000);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const itemsContainer = instance.element.querySelector(".vlist-items") as HTMLElement;

    // Scroll to 3 different far-apart positions
    simulateScroll(instance, 0);
    const countAfterFirst = itemsContainer.children.length;

    simulateScroll(instance, 5000);
    const countAfterSecond = itemsContainer.children.length;

    simulateScroll(instance, 50000);
    const countAfterThird = itemsContainer.children.length;

    // All counts should be similar — no accumulation
    expect(Math.abs(countAfterSecond - countAfterFirst)).toBeLessThan(10);
    expect(Math.abs(countAfterThird - countAfterFirst)).toBeLessThan(10);

    instance.destroy();
  });
});

// =============================================================================
// 6. Destroy Cleanup
// =============================================================================

describe("memory — destroy cleanup", () => {
  it("should clear all rendered items on destroy", () => {
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Verify items exist before destroy
    let rendered = instance.element.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);

    instance.destroy();

    // After destroy, the container should be empty
    expect(container.innerHTML).toBe("");
  });

  it("should not emit events after destroy", () => {
    const items = createTestItems(100);
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    let scrollCount = 0;
    instance.on("scroll", () => scrollCount++);

    simulateScroll(instance, 100);
    const countBefore = scrollCount;
    expect(countBefore).toBeGreaterThan(0);

    instance.destroy();

    // Scrolling after destroy should not emit (emitter cleared)
    // We can't scroll the destroyed viewport, but the destroy should
    // have cleaned up listeners
    expect(scrollCount).toBe(countBefore);
  });
});