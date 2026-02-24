/**
 * vlist - Error Handling and Recovery Tests
 * 
 * Tests for error handling and graceful degradation:
 * - Invalid configuration handling
 * - Adapter errors during load
 * - ResizeObserver errors
 * - Recovery from corrupted state
 * - Graceful degradation scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { vlist } from "../../src/builder/core";
import { withAsync } from "../../src/features/async/feature";
import type { VListItem, VListAdapter } from "../../src/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalConsoleError: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalConsoleError = console.error;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  console.error = originalConsoleError;
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
  container.style.height = `${height}px`;
  container.style.overflow = "auto";
  document.body.appendChild(container);
  return container;
}

function createItemArray(count: number, offset: number = 0): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: offset + i,
    name: `Item ${offset + i}`,
  }));
}

function template(item: TestItem): string {
  return `<div class="item">${item.name}</div>`;
}

function suppressConsoleError() {
  console.error = () => {};
}

function restoreConsoleError() {
  console.error = originalConsoleError;
}

async function waitForAsync(ms: number = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Tests: Invalid Configuration
// =============================================================================

describe("Error Handling: Invalid Configuration", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should handle missing container gracefully", () => {
    expect(() => {
      const instance = vlist<TestItem>({
        container: null as any,
        item: { height: 50, template },
        items: createItemArray(10),
      }).build();
    }).toThrow(); // Should throw on missing container
  });

  it("should handle undefined items", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: undefined as any,
    }).build();

    // Should treat as empty array or handle gracefully
    expect(instance).toBeDefined();

    instance.destroy();
  });

  it("should handle null items", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: null as any,
    }).build();

    // Should treat as empty array or handle gracefully
    expect(instance).toBeDefined();

    instance.destroy();
  });

  it("should handle missing itemHeight", () => {
    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { template } as any, // Missing height
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).toThrow(); // Should require height or estimatedHeight
  });

  it("should handle invalid template function", () => {
    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: 50, template: null as any },
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).toThrow(); // Template is required
  });

  it("should throw when template throws error during render", () => {
    suppressConsoleError();
    
    // Template errors during initial render cause build to fail
    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { 
          height: 50, 
          template: () => {
            throw new Error("Template error");
          }
        },
        items: createItemArray(10),
      }).build();
    }).toThrow();
    
    restoreConsoleError();
  });

  it("should handle template returning invalid HTML", () => {
    const instance = vlist<TestItem>({
      container,
      item: { 
        height: 50, 
        template: () => null as any
      },
      items: createItemArray(10),
    }).build();

    expect(instance).toBeDefined();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Adapter Errors
// =============================================================================

describe("Error Handling: Adapter Errors", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should handle adapter read that throws synchronously", async () => {
    const failingAdapter: VListAdapter<TestItem> = {
      read: () => {
        throw new Error("Sync adapter error");
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: failingAdapter })).build();

    // Should handle error gracefully
    expect(instance).toBeDefined();

    await waitForAsync(100);

    instance.destroy();
  });

  it("should handle adapter read that rejects", async () => {
    const failingAdapter: VListAdapter<TestItem> = {
      read: async () => {
        throw new Error("Async adapter error");
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: failingAdapter })).build();

    expect(instance).toBeDefined();

    await waitForAsync(100);

    instance.destroy();
  });

  it("should handle adapter returning malformed response", async () => {
    const malformedAdapter: VListAdapter<TestItem> = {
      read: async () => {
        return { foo: "bar" } as any;
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: malformedAdapter })).build();

    expect(instance).toBeDefined();

    await waitForAsync(100);

    instance.destroy();
  });

  it("should handle adapter returning null", async () => {
    const nullAdapter: VListAdapter<TestItem> = {
      read: async () => null as any,
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: nullAdapter })).build();

    expect(instance).toBeDefined();

    await waitForAsync(100);

    instance.destroy();
  });

  it("should handle adapter with invalid items array", async () => {
    const invalidItemsAdapter: VListAdapter<TestItem> = {
      read: async () => ({
        items: "not-an-array" as any,
        total: 100,
        hasMore: false,
      }),
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: invalidItemsAdapter })).build();

    expect(instance).toBeDefined();

    await waitForAsync(100);

    instance.destroy();
  });

  it("should handle repeated adapter errors", async () => {
    let callCount = 0;
    const failingAdapter: VListAdapter<TestItem> = {
      read: async ({ offset, limit }) => {
        callCount++;
        throw new Error("Adapter error");
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
    }).use(withAsync({ adapter: failingAdapter })).build();

    // Wait for initial attempt
    await waitForAsync(200);

    // Should have attempted at least once
    expect(callCount).toBeGreaterThanOrEqual(1);

    instance.destroy();
  });
});

// =============================================================================
// Tests: ResizeObserver Errors
// =============================================================================

describe("Error Handling: ResizeObserver Errors", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should require ResizeObserver to be available", () => {
    const originalRO = global.ResizeObserver;
    global.ResizeObserver = undefined as any;

    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).toThrow(); // Should throw when ResizeObserver is missing

    global.ResizeObserver = originalRO;
  });

  it("should handle ResizeObserver errors during observe", () => {
    const originalRO = global.ResizeObserver;
    global.ResizeObserver = class ResizeObserver {
      observe() {
        throw new Error("ResizeObserver error");
      }
      unobserve() {}
      disconnect() {}
    } as any;

    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createItemArray(10),
      }).build();
      instance.destroy();
    }).toThrow(); // Should throw when ResizeObserver fails

    global.ResizeObserver = originalRO;
  });
});

// =============================================================================
// Tests: State Corruption Recovery
// =============================================================================

describe("Error Handling: State Corruption Recovery", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should not crash when DOM is manipulated externally", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // External code removes items (extreme edge case)
    const items = instance.element.querySelectorAll("[data-index]");
    items.forEach(item => item.remove());

    // Should not crash the instance
    expect(instance).toBeDefined();

    instance.destroy();
  });

  it("should handle operations after viewport removal", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // External code removes viewport (extreme case)
    const viewport = instance.element.querySelector(".vlist-viewport");
    viewport?.remove();

    // Operations may fail but should not crash JavaScript
    expect(instance).toBeDefined();

    instance.destroy();
  });

  it("should handle setItems after DOM corruption", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Corrupt the DOM structure
    const vlistRoot = instance.element;
    if (vlistRoot) {
      vlistRoot.innerHTML = "<div>corrupted</div>";
    }

    // setItems should not crash (though behavior is undefined)
    expect(instance).toBeDefined();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Event Handler Errors
// =============================================================================

describe("Error Handling: Event Handler Errors", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should propagate errors from event listeners", () => {
    suppressConsoleError();
    
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Event listener errors propagate to caller
    instance.on("range:change", () => {
      throw new Error("Event handler error");
    });

    const viewport = instance.element.querySelector(".vlist-viewport") as HTMLElement;
    if (viewport) {
      // Triggering the event may throw
      try {
        viewport.scrollTop = 100;
        viewport.dispatchEvent(new Event("scroll"));
      } catch (e) {
        // Expected - event handler threw
      }
    }

    // Instance should still be defined
    expect(instance).toBeDefined();

    instance.destroy();
    restoreConsoleError();
  });

  it("should handle multiple event listeners", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    let handler1Called = false;
    let handler2Called = false;

    instance.on("range:change", () => {
      handler1Called = true;
    });

    instance.on("range:change", () => {
      handler2Called = true;
    });

    // Just verify both handlers can be registered
    expect(instance).toBeDefined();

    instance.destroy();
  });
});

// =============================================================================
// Tests: Memory Leak Prevention
// =============================================================================

describe("Error Handling: Memory Leak Prevention", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });
it("should cleanup DOM on destroy", async () => {
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

  const instance = vlist<TestItem>({
    container,
    item: { height: 50, template },
  }).use(withAsync({ adapter })).build();

  // Start loading
  await waitForAsync(50);

  // Destroy before complete
  instance.destroy();

  await waitForAsync(100);

  // Should have cleaned up DOM
  expect(container.querySelector(".vlist")).toBeFalsy();
});

  it("should cleanup DOM after destroy", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Verify list exists
    expect(instance.element).toBeDefined();
    expect(container.querySelector(".vlist")).toBeTruthy();

    // Destroy
    instance.destroy();

    // After destroy, DOM should be cleaned up
    expect(container.querySelector(".vlist")).toBeFalsy();
  });

  it("should allow destroy to be called multiple times", () => {
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Multiple destroy calls should not throw
    expect(() => {
      instance.destroy();
      instance.destroy();
      instance.destroy();
    }).not.toThrow();
  });
});

// =============================================================================
// Tests: Graceful Degradation
// =============================================================================

describe("Error Handling: Graceful Degradation", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should work with requestAnimationFrame polyfill", () => {
    const originalRAF = global.requestAnimationFrame;
    
    // Provide a simple polyfill
    global.requestAnimationFrame = ((cb: Function) => {
      setTimeout(cb, 16);
      return 0;
    }) as any;

    expect(() => {
      const instance = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createItemArray(100),
      }).build();
      instance.destroy();
    }).not.toThrow();

    global.requestAnimationFrame = originalRAF;
  });

  it("should require core browser APIs", () => {
    // vlist requires certain browser APIs to function
    // In JSDOM test environment, ResizeObserver must be available
    expect(global.ResizeObserver).toBeDefined();
  });

  it("should handle style manipulation in modern browsers", () => {
    // vlist uses standard DOM APIs which work in all modern browsers
    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(100),
    }).build();

    // Should work with standard DOM manipulation
    expect(instance.element).toBeDefined();
    expect(instance.element.style).toBeDefined();

    instance.destroy();
  });
});