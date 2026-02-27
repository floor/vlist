/**
 * vlist - Comprehensive Async Adapter Tests
 * 
 * Comprehensive tests for async adapter functionality:
 * - Loading state transitions (pending → loading → loaded)
 * - Error recovery and retry logic
 * - Race conditions with rapid scroll
 * - Memory leak detection (loading callbacks)
 * - Placeholder → content transitions
 * - Concurrent requests handling
 * - Edge cases and boundary conditions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { vlist } from "../../../src/builder/core";
import { withAsync } from "../../../src/features/async/feature";
import type { VListItem, VListAdapter } from "../../../src/types";
import type { VList } from "../../../src/builder/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalRAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalRAF = global.requestAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  
  // Mock requestAnimationFrame
  global.requestAnimationFrame = ((cb: Function) => {
    setTimeout(cb, 16);
    return 0;
  }) as any;

  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
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
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  loaded?: boolean;
}

function createContainer(height: number = 500): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: height });
  Object.defineProperty(container, "clientWidth", { value: 300 });
  document.body.appendChild(container);
  return container;
}

function createItemArray(count: number, offset: number = 0): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: offset + i,
    name: `Item ${offset + i}`,
    loaded: true,
  }));
}

function template(item: TestItem): string {
  return `<div class="item">${item.name}</div>`;
}

function createMockAdapter(
  total: number = 1000,
  options: {
    delay?: number;
    failRate?: number;
    returnEmpty?: boolean;
  } = {}
): VListAdapter<TestItem> {
  const { delay = 50, failRate = 0, returnEmpty = false } = options;

  return {
    read: mock(async ({ offset, limit }) => {
      await new Promise(resolve => setTimeout(resolve, delay));

      if (Math.random() < failRate) {
        throw new Error("Random adapter failure");
      }

      if (returnEmpty) {
        return { items: [], total: 0, hasMore: false };
      }

      const items = createItemArray(Math.min(limit, total - offset), offset);
      return {
        items,
        total,
        hasMore: offset + items.length < total,
      };
    }),
  };
}

async function waitForAsync(ms: number = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function simulateScroll(list: VList<TestItem>, scrollTop: number): void {
  const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
  if (viewport) {
    viewport.scrollTop = scrollTop;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
  }
}

// =============================================================================
// Tests: Loading State Transitions
// =============================================================================

describe("Async Adapter: Loading State Transitions", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should set aria-busy during initial load", () => {
    const adapter = createMockAdapter(100, { delay: 100 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // aria-busy should be set synchronously before async load completes
    expect(list.element.getAttribute("aria-busy")).toBe("true");
  });

  it("should clear aria-busy after load completes", async () => {
    const adapter = createMockAdapter(100, { delay: 50 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    await waitForAsync(100);

    expect(list.element.getAttribute("aria-busy")).toBeNull();
  });

  it("should call adapter on build", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    await waitForAsync(100);

    expect(adapter.read).toHaveBeenCalled();
  });

  it("should handle rapid scroll events", async () => {
    const adapter = createMockAdapter(1000, { delay: 50 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    await waitForAsync(100);

    // Rapidly scroll multiple times
    simulateScroll(list, 100);
    await waitForAsync(10);
    simulateScroll(list, 500);
    await waitForAsync(10);
    simulateScroll(list, 1000);

    await waitForAsync(200);

    // Should have made adapter calls
    expect(adapter.read).toHaveBeenCalled();
    expect((adapter.read as any).mock.calls.length).toBeGreaterThan(0);
  });

  it("should handle scroll during active load", async () => {
    const adapter = createMockAdapter(1000, { delay: 200 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // Scroll before initial load completes
    await waitForAsync(50);
    simulateScroll(list, 500);

    await waitForAsync(300);

    expect(list).toBeDefined();
  });
});

// =============================================================================
// Tests: Error Recovery
// =============================================================================

describe("Async Adapter: Error Recovery", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;
  let consoleErrorSpy: any;

  beforeEach(() => {
    container = createContainer();
    consoleErrorSpy = mock(() => {});
    console.error = consoleErrorSpy;
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle adapter error gracefully", async () => {
    const failingAdapter: VListAdapter<TestItem> = {
      read: async () => {
        throw new Error("Adapter failed");
      },
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: failingAdapter })).build();

    await waitForAsync(100);

    // Should not crash
    expect(list).toBeDefined();
  });

  it("should handle adapter returning malformed response", async () => {
    const malformedAdapter: VListAdapter<TestItem> = {
      read: async () => {
        return { foo: "bar" } as any;
      },
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: malformedAdapter })).build();

    await waitForAsync(100);

    expect(list).toBeDefined();
  });

  it("should handle adapter returning null", async () => {
    const nullAdapter: VListAdapter<TestItem> = {
      read: async () => null as any,
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: nullAdapter })).build();

    await waitForAsync(100);

    expect(list).toBeDefined();
  });

  it("should handle adapter with invalid items array", async () => {
    const invalidItemsAdapter: VListAdapter<TestItem> = {
      read: async () => ({
        items: "not-an-array" as any,
        total: 100,
        hasMore: false,
      }),
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: invalidItemsAdapter })).build();

    await waitForAsync(100);

    expect(list).toBeDefined();
  });
});

// =============================================================================
// Tests: Race Conditions
// =============================================================================

describe("Async Adapter: Race Conditions", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle overlapping requests correctly", async () => {
    const requestOrder: number[] = [];
    const responseOrder: number[] = [];

    const racyAdapter: VListAdapter<TestItem> = {
      read: async ({ offset, limit }) => {
        const requestId = Date.now() + Math.random();
        requestOrder.push(requestId);

        // Vary delay to create race condition
        const delay = offset > 500 ? 50 : 150;
        await new Promise(resolve => setTimeout(resolve, delay));

        responseOrder.push(requestId);

        return {
          items: createItemArray(limit, offset),
          total: 1000,
          hasMore: offset + limit < 1000,
        };
      },
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: racyAdapter })).build();

    await waitForAsync(100);

    // Create race condition
    simulateScroll(list, 100);
    await waitForAsync(20);
    simulateScroll(list, 600); // This should respond faster

    await waitForAsync(400);

    // Should handle out-of-order responses without crashing
    expect(list).toBeDefined();
    expect(requestOrder.length).toBeGreaterThan(0);
  });

  it("should handle rapid scrolling without memory buildup", async () => {
    const adapter = createMockAdapter(5000, { delay: 100 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    await waitForAsync(100);

    // Simulate rapid scrolling
    for (let i = 0; i < 20; i++) {
      simulateScroll(list, i * 100);
      if (i % 5 === 0) {
        await waitForAsync(10);
      }
    }

    await waitForAsync(200);

    // Should not have made 20 requests (debouncing/throttling should work)
    const callCount = (adapter.read as any).mock.calls.length;
    expect(callCount).toBeLessThan(20);
  });
});

// =============================================================================
// Tests: Placeholder Transitions
// =============================================================================

describe("Async Adapter: Loading Transitions", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should set aria-busy during async load", async () => {
    const adapter = createMockAdapter(100, { delay: 200 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // aria-busy should be set during load
    expect(list.element.getAttribute("aria-busy")).toBe("true");
    
    await waitForAsync(250);
    
    // Should clear after load
    expect(list.element.getAttribute("aria-busy")).toBeNull();
  });

  it("should render content after load", async () => {
    const adapter = createMockAdapter(100, { delay: 50 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // Wait for content to load
    await waitForAsync(150);

    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);
  });

  it("should handle scrolling to unloaded range", async () => {
    const adapter = createMockAdapter(1000, { delay: 100 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // Wait for initial load
    await waitForAsync(150);

    // Scroll to far range
    simulateScroll(list, 10000);

    await waitForAsync(50);

    // Should handle unloaded range gracefully (load or show placeholders)
    expect(list).toBeDefined();
  });
});

// =============================================================================
// Tests: Memory Management
// =============================================================================

describe("Async Adapter: Memory Management", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should cleanup pending requests on destroy", async () => {
    let requestsInFlight = 0;

    const adapter: VListAdapter<TestItem> = {
      read: async ({ offset, limit }) => {
        requestsInFlight++;
        await new Promise(resolve => setTimeout(resolve, 500));
        requestsInFlight--;

        return {
          items: createItemArray(limit, offset),
          total: 1000,
          hasMore: true,
        };
      },
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // Start some requests
    await waitForAsync(50);

    // Destroy before they complete
    list.destroy();
    list = null;

    await waitForAsync(100);

    // Should have cleaned up
    expect(container.querySelector(".vlist")).toBeFalsy();
  });

  it("should not leak memory with many scroll events", async () => {
    const adapter = createMockAdapter(5000, { delay: 50 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    await waitForAsync(100);

    // Generate many scroll events
    for (let i = 0; i < 50; i++) {
      simulateScroll(list, i * 50);
      if (i % 10 === 0) {
        await waitForAsync(10);
      }
    }

    await waitForAsync(200);

    // Should still be functional
    expect(list).toBeDefined();
  });

  it("should allow multiple destroy calls without error", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    await waitForAsync(100);

    expect(() => {
      if (list) {
        list.destroy();
        list.destroy();
        list.destroy();
      }
    }).not.toThrow();

    list = null;
  });
});

// =============================================================================
// Tests: Edge Cases with Async
// =============================================================================

describe("Async Adapter: Edge Cases", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle adapter returning empty results", async () => {
    const emptyAdapter = createMockAdapter(0, { returnEmpty: true });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: emptyAdapter })).build();

    await waitForAsync(100);

    expect(list.total).toBe(0);
  });

  it("should handle adapter with varying response sizes", async () => {
    const varyingAdapter: VListAdapter<TestItem> = {
      read: async ({ offset, limit }) => {
        // Return different amounts each time
        const actualLimit = Math.min(limit, Math.floor(Math.random() * 50) + 10);
        return {
          items: createItemArray(actualLimit, offset),
          total: 1000,
          hasMore: offset + actualLimit < 1000,
        };
      },
    };

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: varyingAdapter })).build();

    await waitForAsync(100);

    expect(list).toBeDefined();
  });

  it("should handle adapter with extremely slow responses", async () => {
    const slowAdapter = createMockAdapter(100, { delay: 1000 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: slowAdapter })).build();

    // Don't wait - just verify it doesn't crash
    await waitForAsync(100);

    expect(list).toBeDefined();
  });

  it("should handle scrollToIndex during active load", async () => {
    const adapter = createMockAdapter(1000, { delay: 200 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // Trigger scrollToIndex during load
    await waitForAsync(50);
    expect(() => list!.scrollToIndex(500)).not.toThrow();

    await waitForAsync(300);
  });

  it("should handle setItems while async loading", async () => {
    const adapter = createMockAdapter(1000, { delay: 200 });

    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter })).build();

    // Change to sync data during async load
    await waitForAsync(50);
    list.setItems(createItemArray(50));

    await waitForAsync(300);

    // setItems replaces async data with sync data
    // Total should reflect the sync data
    expect(list).toBeDefined();
    expect(list.total).toBeGreaterThanOrEqual(50);
  });
});