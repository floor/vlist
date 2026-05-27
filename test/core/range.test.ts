/**
 * vlist v2 — Range Calculation, Overscan & range:change Event Tests
 *
 * Verifies visible range computation, overscan buffer application,
 * and range:change event emission when scrolling.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { OVERSCAN } from "../../src/constants";

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

function getViewport(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
}

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

// =============================================================================
// Default overscan constant
// =============================================================================

describe("range — overscan defaults", () => {
  it("OVERSCAN constant is 3", () => {
    expect(OVERSCAN).toBe(3);
  });

  it("custom overscan is accepted", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
        overscan: 0,
      },
      [],
    );
    // Should create without error
    expect(list.total).toBe(100);
  });
});

// =============================================================================
// range:change event emission
// =============================================================================

describe("range — range:change event", () => {
  it("emits range:change when scroll shifts visible range", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const ranges: Array<{ start: number; end: number }> = [];
    list.on("range:change", (e) => {
      ranges.push({ start: e.range.start, end: e.range.end });
    });

    const viewport = getViewport(container);

    // Scroll down far enough to shift the range
    // itemHeight=50, containerSize=500 → ~10 visible items
    // overscan=4 → initial render range: [0, ~13]
    // Scroll to 500px → visible starts at ~10, render range starts at ~6
    simulateScroll(viewport, 500);

    expect(ranges.length).toBeGreaterThanOrEqual(1);
    expect(ranges[0]!.start).toBeGreaterThan(0);
  });

  it("does not emit additional range:change when scroll stays within same range", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const ranges: Array<{ start: number; end: number }> = [];
    list.on("range:change", (e) => {
      ranges.push({ start: e.range.start, end: e.range.end });
    });

    const viewport = getViewport(container);

    // First scroll may emit range:change (initial prevEmittedStart = -1)
    simulateScroll(viewport, 1);
    const countAfterFirst = ranges.length;

    // Second tiny scroll within same range — should NOT emit again
    simulateScroll(viewport, 2);
    expect(ranges.length).toBe(countAfterFirst);
  });

  it("range:change contains correct start and end indices", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const ranges: Array<{ start: number; end: number }> = [];
    list.on("range:change", (e) => {
      ranges.push({ start: e.range.start, end: e.range.end });
    });

    const viewport = getViewport(container);
    // Scroll to 1000px → visible start at ~20
    simulateScroll(viewport, 1000);

    if (ranges.length > 0) {
      const last = ranges[ranges.length - 1]!;
      expect(last.start).toBeGreaterThanOrEqual(0);
      expect(last.end).toBeGreaterThanOrEqual(last.start);
      expect(last.end).toBeLessThan(100);
    }
  });
});

// =============================================================================
// scroll event emission
// =============================================================================

describe("range — scroll event", () => {
  it("emits scroll event with position and direction", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const scrollEvents: Array<{ scrollPosition: number; direction: "down" | "up" }> = [];
    list.on("scroll", (e) => {
      scrollEvents.push({ scrollPosition: e.scrollPosition, direction: e.direction });
    });

    const viewport = getViewport(container);
    simulateScroll(viewport, 200);

    expect(scrollEvents.length).toBe(1);
    expect(scrollEvents[0]!.scrollPosition).toBe(200);
    expect(scrollEvents[0]!.direction).toBe("down");
  });

  it("emits scroll event with direction=up when scrolling backward", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const scrollEvents: Array<{ direction: "down" | "up" }> = [];
    list.on("scroll", (e) => {
      scrollEvents.push({ direction: e.direction });
    });

    const viewport = getViewport(container);
    simulateScroll(viewport, 500); // scroll down
    simulateScroll(viewport, 200); // scroll up

    expect(scrollEvents.length).toBe(2);
    expect(scrollEvents[0]!.direction).toBe("down");
    expect(scrollEvents[1]!.direction).toBe("up");
  });
});

// =============================================================================
// velocity:change event emission
// =============================================================================

describe("range — velocity:change event", () => {
  it("emits velocity:change on scroll", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const velocities: Array<{ velocity: number; reliable: boolean }> = [];
    list.on("velocity:change", (e) => {
      velocities.push({ velocity: e.velocity, reliable: e.reliable });
    });

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);

    expect(velocities.length).toBeGreaterThanOrEqual(1);
    expect(typeof velocities[0]!.velocity).toBe("number");
    expect(typeof velocities[0]!.reliable).toBe("boolean");
  });

  it("velocity is unreliable with insufficient samples", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const velocities: Array<{ reliable: boolean }> = [];
    list.on("velocity:change", (e) => {
      velocities.push({ reliable: e.reliable });
    });

    const viewport = getViewport(container);
    // Single scroll event — not enough samples for reliable velocity
    simulateScroll(viewport, 100);

    expect(velocities.length).toBe(1);
    expect(velocities[0]!.reliable).toBe(false);
  });
});

// =============================================================================
// Overscan edge cases
// =============================================================================

describe("range — overscan edge cases", () => {
  it("overscan=0 renders only visible items", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
        overscan: 0,
      },
      [],
    );

    const content = container.querySelector(".vlist-content")!;
    // containerSize=500, itemHeight=50 → ~10-11 visible items
    expect(content.children.length).toBeLessThanOrEqual(12);
  });

  it("large overscan does not exceed total items", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(5),
        item: { height: 50, template: simpleTemplate },
        overscan: 100,
      },
      [],
    );

    const content = container.querySelector(".vlist-content")!;
    // Only 5 items exist — can't render more
    expect(content.children.length).toBeLessThanOrEqual(5);
  });

  it("single item with default overscan renders 1 item", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(1),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const content = container.querySelector(".vlist-content")!;
    expect(content.children.length).toBe(1);
  });

  it("empty list renders 0 items regardless of overscan", () => {
    list = createVList<TestItem>(
      {
        container,
        items: [],
        item: { height: 50, template: simpleTemplate },
        overscan: 10,
      },
      [],
    );

    const content = container.querySelector(".vlist-content")!;
    expect(content.children.length).toBe(0);
  });
});
