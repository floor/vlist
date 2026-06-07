/**
 * vlist v2 — Scroll Event Pipeline Tests
 *
 * Tests the full scroll event pipeline: scroll, velocity:change,
 * range:change emission sequence, and scroll:idle after timeout.
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

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// =============================================================================
// Scroll event order
// =============================================================================

describe("scroll events — emission order", () => {
  it("scroll fires before velocity:change on same scroll frame", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const order: string[] = [];
    list.on("scroll", () => order.push("scroll"));
    list.on("velocity:change", () => order.push("velocity"));

    const viewport = getViewport(container);
    simulateScroll(viewport, 200);

    expect(order[0]).toBe("scroll");
    expect(order[1]).toBe("velocity");
  });

  it("range:change fires after scroll and velocity when range shifts", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const order: string[] = [];
    list.on("scroll", () => order.push("scroll"));
    list.on("velocity:change", () => order.push("velocity"));
    list.on("range:change", () => order.push("range"));

    const viewport = getViewport(container);
    // Large scroll to guarantee range shift
    simulateScroll(viewport, 1000);

    expect(order[0]).toBe("scroll");
    expect(order[1]).toBe("velocity");
    if (order.includes("range")) {
      expect(order.indexOf("range")).toBe(2);
    }
  });
});

// =============================================================================
// scroll:idle
// =============================================================================

describe("scroll events — scroll:idle", () => {
  it("scroll:idle fires after scroll inactivity timeout", async () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
        scroll: { idleTimeout: 50 },
      },
      [],
    );

    let idleReceived = false;
    let idlePosition = -1;
    list.on("scroll:idle", (e) => {
      idleReceived = true;
      idlePosition = e.scrollPosition;
    });

    const viewport = getViewport(container);
    simulateScroll(viewport, 300);

    expect(idleReceived).toBe(false);

    // Wait for idle timeout
    await wait(100);

    expect(idleReceived).toBe(true);
    expect(idlePosition).toBe(300);
  });

  it("scroll:idle resets velocity to 0", async () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
        scroll: { idleTimeout: 50 },
      },
      [],
    );

    const velocities: number[] = [];
    list.on("velocity:change", (e) => velocities.push(e.velocity));

    const viewport = getViewport(container);
    simulateScroll(viewport, 300);

    await wait(100);

    // Last velocity event should be 0 (from idle)
    expect(velocities.length).toBeGreaterThanOrEqual(2);
    expect(velocities[velocities.length - 1]).toBe(0);
  });

  it("subsequent scroll resets idle timer", async () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
        scroll: { idleTimeout: 80 },
      },
      [],
    );

    let idleCount = 0;
    list.on("scroll:idle", () => idleCount++);

    const viewport = getViewport(container);

    // Scroll, then scroll again before timeout
    simulateScroll(viewport, 100);
    await wait(40);
    simulateScroll(viewport, 200);
    await wait(40);
    // Timer was reset — shouldn't have fired yet
    expect(idleCount).toBe(0);

    // Wait for full timeout from last scroll
    await wait(60);
    expect(idleCount).toBe(1);
  });
});

// =============================================================================
// Sub-pixel scroll filtering
// =============================================================================

describe("scroll events — sub-pixel filtering", () => {
  it("scroll < 0.5px from current position is ignored", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const scrollEvents: number[] = [];
    list.on("scroll", (e) => scrollEvents.push(e.scrollPosition));

    const viewport = getViewport(container);

    // First scroll to establish position
    simulateScroll(viewport, 100);
    expect(scrollEvents.length).toBe(1);

    // Sub-pixel scroll (< 0.5px delta)
    simulateScroll(viewport, 100.3);
    expect(scrollEvents.length).toBe(1); // no new event
  });

  it("scroll >= 0.5px from current position fires event", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const scrollEvents: number[] = [];
    list.on("scroll", (e) => scrollEvents.push(e.scrollPosition));

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);
    simulateScroll(viewport, 101);

    expect(scrollEvents.length).toBe(2);
  });
});

// =============================================================================
// getScrollPosition
// =============================================================================

describe("scroll events — getScrollPosition", () => {
  it("returns current scroll position after scroll", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    expect(list.getScrollPosition()).toBe(0);

    const viewport = getViewport(container);
    simulateScroll(viewport, 250);

    expect(list.getScrollPosition()).toBe(250);
  });

  it("getScrollPosition, scroll, and scroll:idle agree on the pixel equivalent (RFC-012 G4)", async () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
        scroll: { idleTimeout: 50 },
      },
      [],
    );

    let scrollPos = -1;
    let idlePos = -1;
    list.on("scroll", (e) => { scrollPos = e.scrollPosition; });
    list.on("scroll:idle", (e) => { idlePos = e.scrollPosition; });

    const viewport = getViewport(container);
    simulateScroll(viewport, 250);

    // The public API surface (G4) is pixel-equivalent during migration: all
    // three views derive from the same scroll adapter, so they must match.
    expect(scrollPos).toBe(250);
    expect(list.getScrollPosition()).toBe(250);

    await wait(100);
    expect(idlePos).toBe(250);
  });
});

// =============================================================================
// No events after destroy
// =============================================================================

describe("scroll events — no events after destroy", () => {
  it("scroll events do not fire after destroy", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    let scrollCount = 0;
    list.on("scroll", () => scrollCount++);

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);
    expect(scrollCount).toBe(1);

    list.destroy();
    list = null;

    // Scroll after destroy — handler should be detached
    simulateScroll(viewport, 200);
    expect(scrollCount).toBe(1);
  });
});
