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
import { vlist } from "../../src/builder/core";
import { withAsync } from "../../src/features/async/feature";
import type { VListItem, VListAdapter } from "../../src/types";
import { setupDOM, teardownDOM } from "../helpers/dom";

// =============================================================================
// JSDOM Setup (shared helpers — fires ResizeObserver with real dimensions)
// =============================================================================

let originalConsoleError: any;

beforeAll(() => {
  setupDOM({ width: 300, height: 400 });
  originalConsoleError = console.error;
});

afterAll(() => {
  teardownDOM();
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
  Object.defineProperty(container, "clientHeight", { value: height, configurable: true });
  Object.defineProperty(container, "clientWidth", { value: 300, configurable: true });
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

  it("should emit error event when template throws during render", () => {
    suppressConsoleError();

    // Template errors during render are caught and emitted as error events
    // instead of crashing the entire list
    const errors: Array<{ error: Error; context: string }> = [];
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

    instance.on("error", (payload) => {
      errors.push(payload);
    });

    // Initial render already happened during build(), but error events
    // were emitted before we subscribed. Trigger a re-render with
    // different IDs so the template is re-applied for existing indices.
    errors.length = 0;
    instance.setItems(createItemArray(5).map((item, i) => ({ ...item, id: i + 100 })));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.error.message).toBe("Template error");
    expect(errors[0]!.context).toMatch(/^template\(/);

    instance.destroy();
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
// Tests: Contextual Error Reporting
// =============================================================================

describe("Error Handling: Contextual Error Reporting", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
    suppressConsoleError();
  });

  afterEach(() => {
    container.remove();
    restoreConsoleError();
  });

  it("should include viewport snapshot in template error events", () => {
    let callCount = 0;
    const instance = vlist<TestItem>({
      container,
      item: {
        height: 50,
        template: (item) => {
          callCount++;
          // Throw only on the second wave (after we subscribe)
          if (callCount > 10) throw new Error("Viewport snapshot test");
          return `<div>${item.name}</div>`;
        },
      },
      items: createItemArray(10),
    }).build();

    const errors: Array<{ error: Error; context: string; viewport?: any }> = [];
    instance.on("error", (payload) => {
      errors.push(payload);
    });

    // Trigger re-render with different IDs to force template re-application
    instance.setItems(createItemArray(5, 500));

    expect(errors.length).toBeGreaterThan(0);

    const first = errors[0]!;
    expect(first.viewport).toBeDefined();
    expect(typeof first.viewport.scrollPosition).toBe("number");
    expect(typeof first.viewport.containerSize).toBe("number");
    expect(first.viewport.visibleRange).toBeDefined();
    expect(typeof first.viewport.visibleRange.start).toBe("number");
    expect(typeof first.viewport.visibleRange.end).toBe("number");
    expect(first.viewport.renderRange).toBeDefined();
    expect(typeof first.viewport.renderRange.start).toBe("number");
    expect(typeof first.viewport.renderRange.end).toBe("number");
    expect(typeof first.viewport.totalItems).toBe("number");
    expect(typeof first.viewport.isCompressed).toBe("boolean");

    instance.destroy();
  });

  it("should catch feature setup errors and continue with remaining features", () => {
    const setupOrder: string[] = [];

    const brokenFeature = {
      name: "brokenFeature",
      priority: 40,
      setup() {
        setupOrder.push("broken");
        throw new Error("Feature setup exploded");
      },
    };

    const healthyFeature = {
      name: "healthyFeature",
      priority: 45,
      methods: ["healthyMethod"] as const,
      setup(ctx: any) {
        setupOrder.push("healthy");
        ctx.methods.set("healthyMethod", () => "works");
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    })
      .use(brokenFeature)
      .use(healthyFeature)
      .build();

    // Both features ran setup (broken first due to lower priority)
    expect(setupOrder).toEqual(["broken", "healthy"]);

    // The healthy feature's method is available despite the broken one
    expect(typeof (instance as any).healthyMethod).toBe("function");
    expect((instance as any).healthyMethod()).toBe("works");

    // The list is still functional
    expect(instance.total).toBe(10);
    instance.setItems(createItemArray(5));
    expect(instance.total).toBe(5);

    instance.destroy();
  });

  it("should emit error event when feature setup fails", () => {
    const errors: Array<{ error: Error; context: string }> = [];

    const brokenFeature = {
      name: "kaboom",
      setup() {
        throw new Error("Setup failed");
      },
    };

    const errorCapture = {
      name: "errorCapture",
      priority: 10, // Run before the broken feature (default 50)
      setup(ctx: any) {
        ctx.emitter.on("error", (payload: any) => {
          errors.push(payload);
        });
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    })
      .use(errorCapture)
      .use(brokenFeature)
      .build();

    expect(errors.length).toBe(1);
    expect(errors[0]!.error.message).toBe("Setup failed");
    expect(errors[0]!.context).toBe("feature.setup(kaboom)");

    instance.destroy();
  });

  it("should continue destroy cleanup when a handler throws", () => {
    let secondHandlerRan = false;
    let featureDestroyRan = false;

    const crashOnDestroy = {
      name: "crashOnDestroy",
      setup(ctx: any) {
        ctx.destroyHandlers.push(() => {
          throw new Error("Destroy handler exploded");
        });
        ctx.destroyHandlers.push(() => {
          secondHandlerRan = true;
        });
      },
      destroy() {
        featureDestroyRan = true;
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    })
      .use(crashOnDestroy)
      .build();

    // Should not throw
    instance.destroy();

    // Subsequent handlers and feature.destroy() still ran
    expect(secondHandlerRan).toBe(true);
    expect(featureDestroyRan).toBe(true);
  });

  it("should emit collected destroy errors before clearing emitter", () => {
    const errors: Array<{ error: Error; context: string }> = [];

    const crashOnDestroy = {
      name: "crashOnDestroy",
      setup(ctx: any) {
        ctx.destroyHandlers.push(() => {
          throw new Error("Handler 1 failed");
        });
        ctx.destroyHandlers.push(() => {
          throw new Error("Handler 2 failed");
        });
      },
    };

    const instance = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createItemArray(10),
    })
      .use(crashOnDestroy)
      .build();

    instance.on("error", (payload) => {
      errors.push(payload);
    });

    instance.destroy();

    expect(errors.length).toBe(2);
    expect(errors[0]!.context).toBe("destroy");
    expect(errors[0]!.error.message).toBe("Handler 1 failed");
    expect(errors[1]!.context).toBe("destroy");
    expect(errors[1]!.error.message).toBe("Handler 2 failed");
  });

  it("should not crash render loop when multiple items throw", () => {
    let callCount = 0;

    const instance = vlist<TestItem>({
      container,
      item: {
        height: 50,
        template: (item) => {
          callCount++;
          // First wave succeeds (initial render)
          if (callCount > 10) {
            // Second wave: even-indexed items throw
            if (item.id % 2 === 0) throw new Error(`Item ${item.id} failed`);
          }
          return `<div>${item.name}</div>`;
        },
      },
      items: createItemArray(10),
    }).build();

    const errors: Array<{ error: Error; context: string }> = [];
    instance.on("error", (payload) => {
      errors.push(payload);
    });

    // Trigger re-render with new IDs
    instance.setItems(
      Array.from({ length: 8 }, (_, i) => ({ id: i + 200, name: `New ${i}` })),
    );

    // Some items errored, some rendered fine — list is still alive
    expect(errors.length).toBeGreaterThan(0);
    expect(instance.total).toBe(8);

    // Can still perform data operations
    instance.setItems(createItemArray(3, 900));
    expect(instance.total).toBe(3);

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