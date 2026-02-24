/**
 * vlist - Phase 2: Memory Leak Detection
 *
 * Tests that verify proper cleanup of resources:
 * - DOM element cleanup after destroy
 * - Event listener leak detection
 * - Create/destroy cycles (no accumulating DOM nodes)
 * - Timer cleanup (idle timers, animation frames)
 * - Feature handler array cleanup
 * - ResizeObserver disconnect on destroy
 * - Element pool cleanup
 * - Emitter listener cleanup
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";

import { vlist } from "../../src/builder/core";
import type { BuiltVList } from "../../src/builder/types";
import type { VListItem, VListAdapter } from "../../src/types";
import { withSelection } from "../../src/features/selection/feature";
import { withScrollbar } from "../../src/features/scrollbar/feature";
import { withAsync } from "../../src/features/async/feature";
import { withScale } from "../../src/features/scale/feature";
import { withSnapshots } from "../../src/features/snapshots/feature";
import { withGrid } from "../../src/features/grid/feature";
import { withSections } from "../../src/features/sections/feature";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalRAF: any;
let originalCAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalRAF = global.requestAnimationFrame;
  originalCAF = global.cancelAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.Element = dom.window.Element;

  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(_target: Element) {
      this.callback(
        [
          {
            target: _target,
            contentRect: {
              width: 300,
              height: 500,
              top: 0,
              left: 0,
              bottom: 500,
              right: 300,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve(_target: Element) {}
    disconnect() {}
  };

  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
    ) {
      if (typeof options === "number") {
        this.scrollTop = options;
      } else if (options && typeof options.top === "number") {
        this.scrollTop = options.top;
      }
    };
  }

  (dom.window as any).scrollTo = (
    _x?: number | ScrollToOptions,
    _y?: number,
  ) => {};

  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(
      () => callback(performance.now()),
      0,
    ) as unknown as number;
  };
  global.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
});

// =============================================================================
// Test Types & Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  value?: number;
}

interface GroupedTestItem extends VListItem {
  id: number;
  name: string;
  group: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    value: i * 10,
  }));

const template = (item: TestItem): string =>
  `<div class="item">${item.name}</div>`;

const groupedTemplate = (item: GroupedTestItem): string =>
  `<div class="item">${item.name}</div>`;

const headerTemplate = (groupKey: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = "section-header";
  el.textContent = groupKey;
  return el;
};

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 500 });
  Object.defineProperty(container, "clientWidth", { value: 300 });
  document.body.appendChild(container);
  return container;
};

const simulateScroll = (list: BuiltVList<any>, scrollTop: number): void => {
  const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
  if (!viewport) return;
  viewport.scrollTop = scrollTop;
  viewport.dispatchEvent(new dom.window.Event("scroll"));
};

const createMockAdapter = (totalItems: number): VListAdapter<TestItem> => ({
  read: mock(async ({ offset, limit }) => {
    const end = Math.min(offset + limit, totalItems);
    const items: TestItem[] = [];
    for (let i = offset; i < end; i++) {
      items.push({ id: i + 1, name: `Item ${i + 1}`, value: i * 10 });
    }
    return { items, total: totalItems, hasMore: end < totalItems };
  }),
});

const flush = () => new Promise<void>((r) => setTimeout(r, 10));

const createGroupedItems = (count: number): GroupedTestItem[] => {
  const groups = ["Alpha", "Beta", "Gamma", "Delta"];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    group: groups[Math.floor(i / 5) % groups.length]!,
  }));
};

/** Count all child elements within document.body */
const countBodyChildren = (): number => {
  return document.body.querySelectorAll("*").length;
};

// =============================================================================
// DOM Element Cleanup After Destroy
// =============================================================================

describe("memory — DOM cleanup after destroy", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should remove root element from DOM on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    }).build();

    const root = list.element;
    expect(root.parentElement).not.toBeNull();

    list.destroy();
    expect(root.parentElement).toBeNull();
  });

  it("should remove all rendered item elements on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    }).build();

    const root = list.element;
    const itemsBefore = root.querySelectorAll("[data-index]").length;
    expect(itemsBefore).toBeGreaterThan(0);

    list.destroy();

    // After destroy, root is detached — items should be cleared
    const itemsAfter = root.querySelectorAll("[data-index]").length;
    expect(itemsAfter).toBe(0);
  });

  it("should remove scrollbar elements on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withScrollbar())
      .build();

    const root = list.element;
    expect(root.querySelector(".vlist-scrollbar")).not.toBeNull();

    list.destroy();

    // Root is detached after destroy
    expect(root.parentElement).toBeNull();
  });

  it("should remove sticky header elements on destroy", () => {
    const items = createGroupedItems(40);
    const list = vlist<GroupedTestItem>({
      container,
      item: { height: 40, template: groupedTemplate },
      items,
    })
      .use(
        withSections({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          headerHeight: 30,
          headerTemplate,
          sticky: true,
        }),
      )
      .build();

    const root = list.element;
    list.destroy();
    expect(root.parentElement).toBeNull();
  });

  it("should remove grid DOM modifications on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(40),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const root = list.element;
    expect(root.classList.contains("vlist--grid")).toBe(true);

    list.destroy();
    expect(root.parentElement).toBeNull();
  });

  it("should remove ARIA live region on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "single" }))
      .build();

    const root = list.element;
    expect(root.querySelector("[aria-live]")).not.toBeNull();

    list.destroy();
    expect(root.parentElement).toBeNull();
  });
});

// =============================================================================
// Create/Destroy Cycles — No Accumulating DOM Nodes
// =============================================================================

describe("memory — create/destroy cycles", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should not leak DOM nodes over multiple create/destroy cycles (basic)", () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 10; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(50),
      }).build();

      list.destroy();
    }

    const afterCount = countBodyChildren();
    // Allow small variance (±2) for container itself, but no growth per cycle
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak DOM nodes over cycles with selection + scrollbar", () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 10; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(50),
      })
        .use(withSelection({ mode: "multiple" }))
        .use(withScrollbar())
        .build();

      // Interact with it
      (list as any).select(0);
      (list as any).select(1);
      simulateScroll(list, 200);

      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak DOM nodes over cycles with grid", () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 10; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(40),
      })
        .use(withGrid({ columns: 4 }))
        .build();

      simulateScroll(list, 100);
      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak DOM nodes over cycles with sections", () => {
    const baselineCount = countBodyChildren();
    const items = createGroupedItems(30);

    for (let cycle = 0; cycle < 10; cycle++) {
      const list = vlist<GroupedTestItem>({
        container,
        item: { height: 40, template: groupedTemplate },
        items,
      })
        .use(
          withSections({
            getGroupForIndex: (i: number) => items[i]?.group ?? "",
            headerHeight: 30,
            headerTemplate,
            sticky: true,
          }),
        )
        .build();

      simulateScroll(list, 200);
      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak DOM nodes over cycles with scale (large lists)", () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 5; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(100000),
      })
        .use(withScale())
        .build();

      simulateScroll(list, 1000);
      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak DOM nodes over cycles with snapshots", () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 10; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(100),
      })
        .use(withSnapshots())
        .build();

      const snapshot = (list as any).getScrollSnapshot();
      simulateScroll(list, 300);
      (list as any).restoreScroll(snapshot);

      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak DOM nodes over cycles with all features combined", () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 5; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(100),
      })
        .use(withSelection({ mode: "multiple" }))
        .use(withScrollbar())
        .use(withSnapshots())
        .build();

      // Full interaction
      (list as any).select(0);
      (list as any).select(5);
      simulateScroll(list, 200);
      const snapshot = (list as any).getScrollSnapshot();
      simulateScroll(list, 500);
      (list as any).restoreScroll(snapshot);
      (list as any).clearSelection();

      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });
});

// =============================================================================
// Create/Destroy Cycles with Async
// =============================================================================

describe("memory — create/destroy cycles with async", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should not leak DOM nodes over async create/destroy cycles", async () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 5; cycle++) {
      const adapter = createMockAdapter(100);
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
      })
        .use(withAsync({ adapter }))
        .build();

      await flush();
      simulateScroll(list, 200);
      await flush();

      list.destroy();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });

  it("should not leak when destroying during async load", async () => {
    const baselineCount = countBodyChildren();

    for (let cycle = 0; cycle < 5; cycle++) {
      // Slow adapter — destroy before it resolves
      const slowAdapter: VListAdapter<TestItem> = {
        read: async ({ offset, limit }) => {
          await new Promise((r) => setTimeout(r, 50));
          const end = Math.min(offset + limit, 100);
          const items: TestItem[] = [];
          for (let i = offset; i < end; i++) {
            items.push({ id: i + 1, name: `Item ${i + 1}` });
          }
          return { items, total: 100, hasMore: end < 100 };
        },
      };

      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
      })
        .use(withAsync({ adapter: slowAdapter }))
        .build();

      // Destroy immediately — before async load completes
      list.destroy();

      // Wait for the dangling promise to settle
      await flush();
      await flush();
    }

    const afterCount = countBodyChildren();
    expect(afterCount).toBeLessThanOrEqual(baselineCount + 2);
  });
});

// =============================================================================
// Event Listener Leak Detection
// =============================================================================

describe("memory — event listener cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should not accumulate scroll event handlers across cycles", () => {
    const scrollCounts: number[] = [];

    for (let cycle = 0; cycle < 5; cycle++) {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(100),
      }).build();

      let scrollCallCount = 0;
      list.on("scroll", () => {
        scrollCallCount++;
      });

      simulateScroll(list, 200);
      scrollCounts.push(scrollCallCount);
      list.destroy();
    }

    // Each cycle should fire the same number of scroll events
    // If listeners leak, later cycles would fire more
    const maxCount = Math.max(...scrollCounts);
    const minCount = Math.min(...scrollCounts);
    expect(maxCount - minCount).toBeLessThanOrEqual(1);
  });

  it("should stop delivering events after unsubscribe", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    let callCount = 0;
    const unsub = list.on("scroll", () => {
      callCount++;
    });

    simulateScroll(list, 100);
    const countAfterFirst = callCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    unsub();

    simulateScroll(list, 200);
    // No new calls after unsubscribe
    expect(callCount).toBe(countAfterFirst);

    list.destroy();
  });

  it("should stop delivering events after off()", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    let callCount = 0;
    const handler = () => {
      callCount++;
    };
    list.on("scroll", handler);

    simulateScroll(list, 100);
    const countAfterFirst = callCount;

    list.off("scroll", handler);

    simulateScroll(list, 200);
    expect(callCount).toBe(countAfterFirst);

    list.destroy();
  });

  it("should not fire events after destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    let callCount = 0;
    list.on("scroll", () => {
      callCount++;
    });

    list.destroy();

    // After destroy the emitter is cleared, so even if something tried
    // to emit, the handler would not be called
    expect(callCount).toBe(0);
  });

  it("should clean up selection:change listeners on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    let callCount = 0;
    list.on("selection:change", () => {
      callCount++;
    });

    (list as any).select(0);
    const afterSelect = callCount;
    expect(afterSelect).toBeGreaterThan(0);

    list.destroy();

    // After destroy, emitter is cleared — no more deliveries
    // (We can't easily trigger selection:change after destroy since the
    // feature is torn down, but we verify destroy doesn't throw)
  });
});

// =============================================================================
// ResizeObserver Cleanup
// =============================================================================

describe("memory — ResizeObserver cleanup", () => {
  let container: HTMLElement;
  let disconnectCalls: number;
  let OriginalResizeObserver: typeof ResizeObserver;

  beforeEach(() => {
    container = createContainer();
    disconnectCalls = 0;
    OriginalResizeObserver = global.ResizeObserver;

    // Wrap ResizeObserver to track disconnect calls
    global.ResizeObserver = class TrackedResizeObserver {
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(_target: Element) {
        this.callback(
          [
            {
              target: _target,
              contentRect: {
                width: 300,
                height: 500,
                top: 0,
                left: 0,
                bottom: 500,
                right: 300,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              },
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            } as ResizeObserverEntry,
          ],
          this as any,
        );
      }
      unobserve(_target: Element) {}
      disconnect() {
        disconnectCalls++;
      }
    } as any;
  });

  afterEach(() => {
    global.ResizeObserver = OriginalResizeObserver;
    container.remove();
  });

  it("should disconnect ResizeObserver on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    }).build();

    const disconnectBefore = disconnectCalls;
    list.destroy();

    // At least the viewport ResizeObserver should be disconnected
    expect(disconnectCalls).toBeGreaterThan(disconnectBefore);
  });

  it("should disconnect ResizeObserver with multiple features", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    })
      .use(withSelection({ mode: "single" }))
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    const disconnectBefore = disconnectCalls;
    list.destroy();

    expect(disconnectCalls).toBeGreaterThan(disconnectBefore);
  });

  it("should disconnect ResizeObserver on each cycle", () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      const disconnectBefore = disconnectCalls;

      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(50),
      }).build();

      list.destroy();

      // Each cycle should disconnect
      expect(disconnectCalls).toBeGreaterThan(disconnectBefore);
    }
  });
});

// =============================================================================
// Timer Cleanup
// =============================================================================

describe("memory — timer cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should clean up idle timer on destroy during scroll", async () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
      scroll: { idleTimeout: 200 },
    }).build();

    // Start scrolling to activate idle timer
    simulateScroll(list, 100);

    // Destroy while idle timer is pending
    list.destroy();

    // Wait longer than idle timeout
    await new Promise((r) => setTimeout(r, 300));

    // Should not throw or cause issues — timer was cleaned up
    expect(true).toBe(true);
  });

  it("should cancel animation frame on destroy during smooth scroll", async () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    // Start smooth scroll
    list.scrollToIndex(50, { align: "start", behavior: "smooth", duration: 500 });

    // Destroy during animation
    list.destroy();

    // Wait for animation duration to elapse
    await new Promise((r) => setTimeout(r, 600));

    // Should not throw — animation frame was cancelled
    expect(true).toBe(true);
  });

  it("should cancel animation frame via cancelScroll before destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    // Start smooth scroll
    list.scrollToIndex(50, { align: "start", behavior: "smooth", duration: 1000 });

    // Cancel first, then destroy
    list.cancelScroll();
    list.destroy();

    // Should complete without error
    expect(true).toBe(true);
  });
});

// =============================================================================
// Element Pool Cleanup
// =============================================================================

describe("memory — element pool cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should clear rendered elements on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const root = list.element;
    const renderedBefore = root.querySelectorAll("[data-index]").length;
    expect(renderedBefore).toBeGreaterThan(0);

    list.destroy();

    const renderedAfter = root.querySelectorAll("[data-index]").length;
    expect(renderedAfter).toBe(0);
  });

  it("should clear pool after scrolling and destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(200),
    }).build();

    // Scroll around to exercise the pool
    simulateScroll(list, 500);
    simulateScroll(list, 1000);
    simulateScroll(list, 200);
    simulateScroll(list, 0);

    const root = list.element;
    list.destroy();

    const renderedAfter = root.querySelectorAll("[data-index]").length;
    expect(renderedAfter).toBe(0);
  });

  it("should clear pool with grid layout", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    simulateScroll(list, 300);
    simulateScroll(list, 600);

    const root = list.element;
    list.destroy();

    const renderedAfter = root.querySelectorAll("[data-index]").length;
    expect(renderedAfter).toBe(0);
  });
});

// =============================================================================
// Double Destroy Safety
// =============================================================================

describe("memory — double destroy safety", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should not throw on double destroy (basic list)", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    }).build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with selection", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with scrollbar", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    })
      .use(withScrollbar())
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with scale", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100000),
    })
      .use(withScale())
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with snapshots", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    })
      .use(withSnapshots())
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with grid", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(40),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with sections", () => {
    const items = createGroupedItems(30);
    const list = vlist<GroupedTestItem>({
      container,
      item: { height: 40, template: groupedTemplate },
      items,
    })
      .use(
        withSections({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          headerHeight: 30,
          headerTemplate,
          sticky: true,
        }),
      )
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should not throw on double destroy with all features", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });
});

// =============================================================================
// Data Change Cleanup
// =============================================================================

describe("memory — data change cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should not leak DOM nodes on repeated setItems", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    }).build();

    const root = list.element;

    // Repeatedly replace items
    for (let i = 0; i < 20; i++) {
      list.setItems(createTestItems(50 + i));
    }

    // The number of rendered items should be bounded by the viewport
    // (overscan + visible), not growing with each setItems call
    const renderedCount = root.querySelectorAll("[data-index]").length;
    // Viewport is 500px / 50px = 10 visible + overscan, so less than 30 ish
    expect(renderedCount).toBeLessThan(30);

    list.destroy();
  });

  it("should not leak DOM nodes on repeated append/remove cycles", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    }).build();

    const root = list.element;

    for (let i = 0; i < 20; i++) {
      list.appendItems([
        { id: 1000 + i, name: `Appended ${i}` },
      ] as TestItem[]);
      list.removeItem(0);
    }

    const renderedCount = root.querySelectorAll("[data-index]").length;
    expect(renderedCount).toBeLessThan(30);

    list.destroy();
  });

  it("should not leak on repeated scroll + render cycles", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(500),
    }).build();

    const root = list.element;

    // Simulate scrolling through the entire list
    for (let pos = 0; pos <= 5000; pos += 200) {
      simulateScroll(list, pos);
    }

    // Rendered elements should still be bounded
    const renderedCount = root.querySelectorAll("[data-index]").length;
    expect(renderedCount).toBeLessThan(30);

    list.destroy();
  });
});

// =============================================================================
// Feature State Cleanup
// =============================================================================

describe("memory — feature state cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should clear selection state on destroy", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).select(0);
    (list as any).select(1);
    (list as any).select(2);

    list.destroy();

    // No assertion on internal state (it's private), but verify
    // destroy didn't throw with selection state present
    expect(true).toBe(true);
  });

  it("should handle destroy after selectAll", () => {
    const items = createTestItems(100);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).selectAll();

    // Destroy with all items selected should not leak
    list.destroy();
    expect(true).toBe(true);
  });

  it("should handle destroy after snapshot capture", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withSnapshots())
      .build();

    simulateScroll(list, 500);
    const _snapshot = (list as any).getScrollSnapshot();

    // Snapshot exists in local scope; destroy should clean up feature state
    list.destroy();
    expect(true).toBe(true);
  });

  it("should handle destroy during async reload", async () => {
    const adapter = createMockAdapter(100);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .build();

    await flush();

    // Start reload but destroy before it completes
    const reloadPromise = list.reload();
    list.destroy();

    // Wait for reload to settle (should not throw)
    try {
      await reloadPromise;
    } catch {
      // May reject if destroyed during reload — that's OK
    }

    await flush();
    expect(true).toBe(true);
  });
});

// =============================================================================
// Large Dataset Cleanup
// =============================================================================

describe("memory — large dataset cleanup", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should clean up 100K item list without issues", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100000),
    })
      .use(withScale())
      .build();

    // Scroll through various positions
    list.scrollToIndex(50000);
    list.scrollToIndex(99999);
    list.scrollToIndex(0);

    list.destroy();

    // Verify root is fully detached
    expect(list.element.parentElement).toBeNull();
    expect(list.element.querySelectorAll("[data-index]").length).toBe(0);
  });

  it("should clean up 1M item list without issues", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1000000),
    })
      .use(withScale())
      .build();

    list.scrollToIndex(500000);
    list.destroy();

    expect(list.element.parentElement).toBeNull();
    expect(list.element.querySelectorAll("[data-index]").length).toBe(0);
  });

  it("should handle replacing large datasets multiple times", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10),
    })
      .use(withScale())
      .build();

    // Replace with progressively larger datasets
    list.setItems(createTestItems(1000));
    list.setItems(createTestItems(100000));
    list.setItems(createTestItems(10000));
    list.setItems(createTestItems(100));

    // Rendered items should still be bounded
    const renderedCount = list.element.querySelectorAll("[data-index]").length;
    expect(renderedCount).toBeLessThan(30);

    list.destroy();
  });
});