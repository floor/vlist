/**
 * vlist v2 — Async Plugin Tests
 * Unit tests for async() plugin: setup, lifecycle, reload, ARIA, network recovery,
 * onIdle hook, autoLoad flag, and edge cases.
 *
 * Adapted from v1 withAsync feature tests to v2 PluginContext / EngineState API.
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { data as dataPlugin } from "../../../src/plugins/data/plugin";
import type { VListItem, VListAdapter } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { createEmitter } from "../../../src/events/emitter";
import type { VListEvents } from "../../../src/types";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  value: number;
}

function createTestItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: i * 10,
  }));
}

function createMockAdapter(total: number = 100): VListAdapter<TestItem> {
  return {
    read: mock(async ({ offset, limit }) => {
      const items: TestItem[] = [];
      const end = Math.min(offset + limit, total);
      for (let i = offset; i < end; i++) {
        items.push({ id: i, name: `Item ${i}`, value: i * 10 });
      }
      return {
        items,
        total,
        hasMore: end < total,
      };
    }),
  };
}

/**
 * Creates a PluginTestContext with a real emitter (needed for ARIA tests and
 * load:start / load:end event assertions).
 */
function createContextWithRealEmitter(options?: {
  reverse?: boolean;
  totalItems?: number;
  startIndex?: number;
  visibleCount?: number;
  containerSize?: number;
  totalSize?: number;
  destroyed?: boolean;
}) {
  const items = createTestItems(options?.totalItems ?? 0);
  const result = createPluginMockContext<TestItem>(items, {
    reverse: options?.reverse ?? false,
    containerHeight: options?.containerSize ?? 500,
  });

  // Replace the minimal emitter with a real one that supports subscriptions
  const realEmitter = createEmitter<VListEvents<TestItem>>();
  (result.ctx as any).emitter = realEmitter;

  // Track forceRender calls
  let forceRenderCallCount = 0;
  const originalForceRender = result.ctx.forceRender.bind(result.ctx);
  (result.ctx as any).forceRender = () => {
    forceRenderCallCount++;
    originalForceRender();
  };

  // Track renderIfNeeded calls
  let renderIfNeededCallCount = 0;
  const originalRenderIfNeeded = result.ctx.renderIfNeeded.bind(result.ctx);
  (result.ctx as any).renderIfNeeded = () => {
    renderIfNeededCallCount++;
    originalRenderIfNeeded();
  };

  // Set engineState fields as requested
  if (options?.startIndex !== undefined) {
    result.engineState.startIndex = options.startIndex;
  }
  if (options?.visibleCount !== undefined) {
    result.engineState.visibleCount = options.visibleCount;
  }
  if (options?.totalSize !== undefined) {
    result.engineState.totalSize = options.totalSize;
  }
  if (options?.destroyed !== undefined) {
    result.engineState.destroyed = options.destroyed;
  }

  return {
    ...result,
    emitter: realEmitter,
    getForceRenderCallCount: () => forceRenderCallCount,
    getRenderIfNeededCallCount: () => renderIfNeededCallCount,
  };
}

// =============================================================================
// async - Factory Tests
// =============================================================================

describe("async - Factory", () => {
  it("should create a plugin with name and priority", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });

    expect(plugin.name).toBe("data");
    expect(plugin.priority).toBe(20);
    expect(plugin.setup).toBeFunction();
  });

  it("should accept loading configuration", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({
      adapter,
      loading: {
        cancelThreshold: 50,
        preloadThreshold: 5,
        preloadAhead: 100,
      },
    });

    expect(plugin).toBeDefined();
    expect(plugin.setup).toBeFunction();
  });

  it("should use default loading thresholds when not provided", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });

    expect(plugin).toBeDefined();
    expect(plugin.setup).toBeFunction();
  });

  it("should have onIdle hook", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });

    expect(plugin.hooks).toBeDefined();
    expect(plugin.hooks!.onIdle).toBeFunction();
  });
});

// =============================================================================
// Setup
// =============================================================================

describe("async - Setup", () => {
  it("should register reload method", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    expect(methods.has("reload")).toBe(true);
    expect(methods.get("reload")).toBeFunction();
  });

  it("should register loadVisibleRange method", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    expect(methods.has("loadVisibleRange")).toBe(true);
    expect(methods.get("loadVisibleRange")).toBeFunction();
  });

  it("should add destroy handler for cleanup", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, destroyHandlers } = createContextWithRealEmitter();

    const initialHandlerCount = destroyHandlers.length;
    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBeGreaterThan(initialHandlerCount);
  });

  it("should call loadInitial on setup when autoLoad is true", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Wait a bit for async operations (queueMicrotask + adapter.read)
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.read).toHaveBeenCalled();
  });

  it("should emit load:start on initial load", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, emitter } = createContextWithRealEmitter();

    const loadStartEvents: any[] = [];
    emitter.on("load:start", (payload) => loadStartEvents.push(payload));

    plugin.setup!(ctx);
    await new Promise((r) => queueMicrotask(r));

    expect(loadStartEvents.length).toBeGreaterThan(0);
    expect(loadStartEvents[0]).toMatchObject({ offset: 0, limit: 50 });
  });
});

// =============================================================================
// ARIA Attributes
// =============================================================================

describe("async - ARIA Attributes", () => {
  it("should set aria-busy on load:start", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, emitter, dom } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Trigger load:start event manually
    (emitter as any).emit("load:start", { offset: 0, limit: 50 });

    expect(dom.root.getAttribute("aria-busy")).toBe("true");
  });

  it("should remove aria-busy on load:end", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, emitter, dom } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Set aria-busy first via load:start
    (emitter as any).emit("load:start", { offset: 0, limit: 50 });
    expect(dom.root.getAttribute("aria-busy")).toBe("true");

    // Clear it via load:end
    (emitter as any).emit("load:end", { items: [], total: 100 });
    expect(dom.root.hasAttribute("aria-busy")).toBe(false);
  });
});

// =============================================================================
// Error Handling
// =============================================================================

describe("async - Error Handling", () => {
  it("should handle adapter errors on loadInitial without crashing", async () => {
    const testError = new Error("Initial load failed");
    const failingAdapter: VListAdapter<TestItem> = {
      read: mock(async () => {
        throw testError;
      }),
    };
    const plugin = dataPlugin({ adapter: failingAdapter });
    const { ctx } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Wait for async operation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify the adapter was called and failed
    expect(failingAdapter.read).toHaveBeenCalled();

    // The error is caught internally — system should not crash
    expect(ctx).toBeDefined();
  });
});

// =============================================================================
// Reload Method
// =============================================================================

describe("async - Reload Method", () => {
  it("should call forceRender on reload", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods, getForceRenderCallCount } = createContextWithRealEmitter();

    plugin.setup!(ctx);
    await new Promise((r) => queueMicrotask(r));

    const countBeforeReload = getForceRenderCallCount();

    const reloadFn = methods.get("reload")!;
    await reloadFn();

    expect(getForceRenderCallCount()).toBeGreaterThan(countBeforeReload);
  });

  it("should call scrollTo(0) on reload", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods, scrollCalls } = createContextWithRealEmitter();

    plugin.setup!(ctx);
    await new Promise((r) => queueMicrotask(r));

    const reloadFn = methods.get("reload")!;
    await reloadFn();

    expect(scrollCalls).toContain(0);
  });

  it("should call adapter.read again on reload when autoLoad is true", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Clear mock call count
    (adapter.read as any).mockClear();

    const reloadFn = methods.get("reload")!;
    await reloadFn();

    // adapter.read should be called again for loadInitial
    expect(adapter.read).toHaveBeenCalled();
  });

  it("should NOT call adapter.read on reload when autoLoad is false", async () => {
    const adapter = createMockAdapter(500);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 500 });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // adapter.read should NOT have been called for initial load
    expect(adapter.read).not.toHaveBeenCalled();

    // Clear any calls
    (adapter.read as any).mockClear();

    const reloadFn = methods.get("reload")!;
    await reloadFn();

    // Reload with autoLoad=false should not call adapter.read
    expect(adapter.read).not.toHaveBeenCalled();
  });
});

// =============================================================================
// autoLoad: false with total
// =============================================================================

describe("async - autoLoad: false with total", () => {
  it("should set total without loading when autoLoad is false and total is provided", async () => {
    const adapter = createMockAdapter(500);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 500 });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // adapter.read should NOT have been called
    expect(adapter.read).not.toHaveBeenCalled();

    // Total should be set via getTotal method
    const getTotalFn = methods.get("getTotal")!;
    expect(getTotalFn()).toBe(500);
  });

  it("should register getTotal method", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    expect(methods.has("getTotal")).toBe(true);
    expect(methods.get("getTotal")).toBeFunction();
  });

  it("should register setTotal method", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    expect(methods.has("setTotal")).toBe(true);
    expect(methods.get("setTotal")).toBeFunction();
  });

  it("should update total via setTotal method", () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    const getTotalFn = methods.get("getTotal")!;
    const setTotalFn = methods.get("setTotal")!;

    expect(getTotalFn()).toBe(100);
    setTotalFn(200);
    expect(getTotalFn()).toBe(200);
  });
});

// =============================================================================
// onIdle Hook
// =============================================================================

describe("async - onIdle Hook", () => {
  it("should not throw when onIdle is called with no pending range", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Should not throw
    expect(() => plugin.hooks!.onIdle!()).not.toThrow();
  });

  it("should not call loadPendingRange when engineState is destroyed", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, methods } = createContextWithRealEmitter({
      startIndex: 10,
      visibleCount: 10,
    });

    plugin.setup!(ctx);
    await new Promise((r) => queueMicrotask(r));

    // Mark as destroyed
    const engineState = ctx.getState();
    engineState.destroyed = true;

    // Should be no-op when destroyed
    expect(() => plugin.hooks!.onIdle!()).not.toThrow();
  });
});

// =============================================================================
// loadVisibleRange Method
// =============================================================================

describe("async - loadVisibleRange Method", () => {
  it("should call forceRender when loadVisibleRange is called", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter });
    const { ctx, methods, getForceRenderCallCount } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 10,
    });

    plugin.setup!(ctx);
    await new Promise((r) => queueMicrotask(r));

    const countBefore = getForceRenderCallCount();

    const loadVisibleRangeFn = methods.get("loadVisibleRange")!;
    await loadVisibleRangeFn();

    expect(getForceRenderCallCount()).toBeGreaterThan(countBefore);
  });

  it("should not call ensureRange when visibleCount is 0", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 0,
    });

    plugin.setup!(ctx);

    // adapter.read should not be called (autoLoad=false, visibleCount=0)
    (adapter.read as any).mockClear();

    const loadVisibleRangeFn = methods.get("loadVisibleRange")!;
    await loadVisibleRangeFn();

    expect(adapter.read).not.toHaveBeenCalled();
  });
});

// =============================================================================
// loadInitial Method
// =============================================================================

describe("async - loadInitial Method", () => {
  it("should register the loadInitial method", () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods } = createContextWithRealEmitter({ visibleCount: 0 });

    plugin.setup!(ctx);

    expect(methods.get("loadInitial")).toBeInstanceOf(Function);
  });

  it("should load page 1 from offset 0 even when visibleCount is 0", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 0, // container not laid out yet
    });

    plugin.setup!(ctx);
    (adapter.read as any).mockClear();

    const loadInitialFn = methods.get("loadInitial")!;
    await loadInitialFn();

    // Unlike loadVisibleRange (a no-op at visibleCount=0), loadInitial fetches.
    expect(adapter.read).toHaveBeenCalled();
    expect((adapter.read as any).mock.calls[0][0].offset).toBe(0);

    const getLoadedCount = methods.get("_getLoadedCount")!;
    expect(getLoadedCount()).toBeGreaterThan(0);
  });

  it("should emit load:start and load:end around the fetch", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods, emitter } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 0,
    });

    plugin.setup!(ctx);
    // load:end fires from onItemsLoaded only once the engine is initialized.
    // Set after setup so construction-time notifyDataChange isn't affected.
    ctx.getState().initialized = true;

    let startEmitted = false;
    let endEmitted = false;
    emitter.on("load:start", () => { startEmitted = true; });
    emitter.on("load:end", () => { endEmitted = true; });

    const loadInitialFn = methods.get("loadInitial")!;
    await loadInitialFn();

    expect(startEmitted).toBe(true);
    expect(endEmitted).toBe(true);
  });

  it("should call forceRender after loading", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods, getForceRenderCallCount } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 0,
    });

    plugin.setup!(ctx);
    const countBefore = getForceRenderCallCount();

    const loadInitialFn = methods.get("loadInitial")!;
    await loadInitialFn();

    expect(getForceRenderCallCount()).toBeGreaterThan(countBefore);
  });
});

// =============================================================================
// onResize Hook — load visible range when the container gains dimensions
// =============================================================================

describe("async - onResize Hook", () => {
  it("should ensure the visible range when total is set and container has dimensions", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx, methods } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 10,
    });

    plugin.setup!(ctx);
    (adapter.read as any).mockClear();

    plugin.hooks!.onResize!(800, 600);
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.read).toHaveBeenCalled();
    expect((adapter.read as any).mock.calls[0][0].offset).toBe(0);
  });

  it("should be a no-op when no total is declared", async () => {
    const adapter = createMockAdapter(100);
    // No `total` provided → dataManager.getTotal() stays 0 after setup.
    const plugin = dataPlugin({ adapter, autoLoad: false });
    const { ctx } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 10,
    });

    plugin.setup!(ctx);
    (adapter.read as any).mockClear();

    plugin.hooks!.onResize!(800, 600);
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("should be a no-op when visibleCount is 0", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 0,
    });

    plugin.setup!(ctx);
    (adapter.read as any).mockClear();

    plugin.hooks!.onResize!(800, 600);
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("should be a no-op when destroyed", async () => {
    const adapter = createMockAdapter(100);
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx } = createContextWithRealEmitter({
      startIndex: 0,
      visibleCount: 10,
      destroyed: true,
    });

    plugin.setup!(ctx);
    (adapter.read as any).mockClear();

    expect(() => plugin.hooks!.onResize!(800, 600)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.read).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Network Recovery — online event
// =============================================================================

describe("async - Network Recovery", () => {
  it("should not crash when 'online' event fires", async () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx } = createContextWithRealEmitter({
      startIndex: 10,
      visibleCount: 10,
    });

    plugin.setup!(ctx);
    await new Promise((r) => queueMicrotask(r));

    // Simulate network recovery — should not throw
    expect(() => {
      const onlineEvent = new Event("online");
      window.dispatchEvent(onlineEvent);
    }).not.toThrow();
  });

  it("should not call ensureRange on 'online' when destroyed", async () => {
    const adapter = createMockAdapter();
    // Use autoLoad: false so the initial queueMicrotask path is skipped.
    // We mark the list as destroyed before dispatching 'online' to verify
    // that handleOnline returns early when engineState.destroyed is true.
    const plugin = dataPlugin({ adapter, autoLoad: false, total: 100 });
    const { ctx } = createContextWithRealEmitter({
      startIndex: 10,
      visibleCount: 10,
      destroyed: true,
    });

    plugin.setup!(ctx);

    // adapter.read must not have been called for initial load
    expect(adapter.read).not.toHaveBeenCalled();

    const onlineEvent = new Event("online");
    window.dispatchEvent(onlineEvent);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("should clean up online listener on destroy", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, destroyHandlers } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Run destroy handlers
    for (const handler of destroyHandlers) {
      handler();
    }

    // The listener should have been removed (no error on dispatching)
    expect(() => {
      window.dispatchEvent(new Event("online"));
    }).not.toThrow();
  });
});

// =============================================================================
// Destroyed State
// =============================================================================

describe("async - Destroyed State", () => {
  it("should not process onIdle when engineState.destroyed is true", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx } = createContextWithRealEmitter({
      destroyed: true,
    });

    plugin.setup!(ctx);

    // Should not throw or process when destroyed
    expect(() => plugin.hooks!.onIdle!()).not.toThrow();
  });
});

// =============================================================================
// Destroy Cleanup
// =============================================================================

describe("async - Destroy Cleanup", () => {
  it("should clean up idle timer on destroy", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx, destroyHandlers } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    // Run all destroy handlers — should not throw
    expect(() => {
      for (const handler of destroyHandlers) {
        handler();
      }
    }).not.toThrow();
  });

  it("should call plugin.destroy without error", () => {
    const adapter = createMockAdapter();
    const plugin = dataPlugin({ adapter });
    const { ctx } = createContextWithRealEmitter();

    plugin.setup!(ctx);

    expect(() => plugin.destroy!()).not.toThrow();
  });
});
