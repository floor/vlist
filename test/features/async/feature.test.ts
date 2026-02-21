/**
 * vlist - Async Feature Plugin Tests
 * Unit tests for withAsync plugin: setup, lifecycle, velocity-aware loading, edge cases
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { withAsync } from "../../../src/features/async/feature";
import type { VListItem, VListAdapter } from "../../../src/types";
import type { BuilderContext } from "../../../src/builder/types";

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
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  value: number;
}

function createTestDOM() {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");

  root.className = "vlist";
  viewport.className = "vlist__viewport";
  content.className = "vlist__content";
  items.className = "vlist__items";

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items };
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

function createMockContext(config?: {
  reverse?: boolean;
  velocity?: number;
  isTracking?: boolean;
}): BuilderContext<TestItem> & { capturedDataManager: () => any } {
  const testDom = createTestDOM();
  const afterScrollCallbacks: Array<
    (scrollPosition: number, direction: string) => void
  > = [];
  const destroyCallbacks: Array<() => void> = [];
  const methods = new Map<string, any>();
  let capturedDataManager: any = null;
  let ariaState: { [key: string]: string | null } = {};

  const emitterCallbacks = new Map<string, Array<(...args: any[]) => void>>();

  const ctx: BuilderContext<TestItem> & { capturedDataManager: () => any } = {
    dom: testDom as any,
    sizeCache: {
      rebuild: mock(() => {}),
      getItemOffset: mock(() => 0),
      getTotalSize: mock(() => 5000),
    } as any,
    emitter: {
      on: mock((event: string, callback: (...args: any[]) => void) => {
        if (!emitterCallbacks.has(event)) {
          emitterCallbacks.set(event, []);
        }
        emitterCallbacks.get(event)!.push(callback);
      }),
      off: mock(() => {}),
      emit: mock((event: string, ...args: any[]) => {
        const callbacks = emitterCallbacks.get(event);
        if (callbacks) {
          callbacks.forEach((cb) => cb(...args));
        }
      }),
    } as any,
    config: {
      overscan: 2,
      classPrefix: "vlist",
      reverse: config?.reverse ?? false,
      wrap: false,
      horizontal: false,
      ariaIdPrefix: "vlist",
    },
    rawConfig: {} as any,
    renderer: {
      render: mock(() => {}),
      updateItemClasses: mock(() => {}),
      updatePositions: mock(() => {}),
      updateItem: mock(() => {}),
      getElement: mock(() => null),
      clear: mock(() => {}),
      destroy: mock(() => {}),
    } as any,
    dataManager: {} as any, // Will be replaced by plugin
    scrollController: {
      getScrollTop: mock(() => 0),
      scrollTo: mock(() => {}),
      isAtTop: mock(() => true),
      isAtBottom: mock(() => false),
      getVelocity: mock(() => config?.velocity ?? 0),
      isTracking: mock(() => config?.isTracking ?? true),
    } as any,
    state: {
      dataState: {
        total: 0,
        cached: 0,
        isLoading: false,
        pendingRanges: [],
        error: undefined,
        hasMore: true,
        cursor: undefined,
      },
      viewportState: {
        scrollPosition: 0,
        containerSize: 500,
        totalSize: 5000,
        actualSize: 5000,
        isCompressed: false,
        compressionRatio: 1,
        visibleRange: { start: 0, end: 10 },
        renderRange: { start: 0, end: 10 },
      },
      renderState: {
        range: { start: 0, end: 10 },
        visibleRange: { start: 0, end: 10 },
        renderedCount: 10,
      },
    } as any,
    getContainerWidth: mock(() => 800),
    afterScroll: afterScrollCallbacks,
    clickHandlers: [],
    keydownHandlers: [],
    resizeHandlers: [],
    contentSizeHandlers: [],
    destroyHandlers: destroyCallbacks,
    methods,
    replaceTemplate: mock(() => {}),
    replaceRenderer: mock(() => {}),
    replaceDataManager: mock((newManager: any) => {
      capturedDataManager = newManager;
      ctx.dataManager = newManager;
    }),
    capturedDataManager: () => capturedDataManager,
    replaceScrollController: mock(() => {}),
    getItemsForRange: mock(() => []),
    getAllLoadedItems: mock(() => []),
    getVirtualTotal: mock(() => 100),
    getCachedCompression: mock(() => ({
      isCompressed: false,
      actualSize: 5000,
      virtualSize: 5000,
      ratio: 1,
    })),
    getCompressionContext: mock(() => ({
      scrollPosition: 0,
      totalItems: 100,
      containerSize: 500,
      rangeStart: 0,
    })),
    renderIfNeeded: mock(() => {}),
    forceRender: mock(() => {}),
    invalidateRendered: mock(() => {}),
    getRenderFns: mock(() => ({
      renderIfNeeded: () => {},
      forceRender: () => {},
    })),
    setRenderFns: mock(() => {}),
    setVirtualTotalFn: mock(() => {}),
    rebuildSizeCache: mock(() => {}),
    setSizeConfig: mock(() => {}),
    updateContentSize: mock(() => {}),
    updateCompressionMode: mock(() => {}),
    setVisibleRangeFn: mock(() => {}),
    setScrollToPosFn: mock(() => {}),
    setPositionElementFn: mock(() => {}),
    setScrollFns: mock(() => {}),
    setScrollTarget: mock(() => {}),
    getScrollTarget: mock(() => window as any),
    setContainerDimensions: mock(() => {}),
    disableViewportResize: mock(() => {}),
  };

  // Mock setAttribute/removeAttribute for ARIA testing
  ctx.dom.root.setAttribute = mock((key: string, value: string) => {
    ariaState[key] = value;
  });
  ctx.dom.root.removeAttribute = mock((key: string) => {
    ariaState[key] = null;
  });
  ctx.dom.root.getAttribute = mock((key: string) => ariaState[key] ?? null);

  // Helper to get ARIA state
  (ctx as any).getAriaState = () => ariaState;

  return ctx;
}

// =============================================================================
// withAsync - Factory Tests
// =============================================================================

describe("withAsync - Factory", () => {
  it("should create a plugin with name and priority", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    expect(plugin.name).toBe("withAsync");
    expect(plugin.priority).toBe(20);
    expect(plugin.methods).toEqual(["reload"]);
  });

  it("should accept loading configuration", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
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
    const plugin = withAsync({ adapter });

    expect(plugin).toBeDefined();
    expect(plugin.setup).toBeFunction();
  });
});

// =============================================================================
// Setup - Data Manager Replacement
// =============================================================================

describe("withAsync - Setup", () => {
  it("should replace data manager with adapter-backed manager", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    plugin.setup(ctx);

    expect(ctx.replaceDataManager).toHaveBeenCalled();
  });

  it("should register reload method", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    plugin.setup(ctx);

    expect(ctx.methods.has("reload")).toBe(true);
    expect(ctx.methods.get("reload")).toBeFunction();
  });

  it("should add afterScroll callbacks", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    const initialCallbackCount = ctx.afterScroll.length;
    plugin.setup(ctx);

    // Should add 2 callbacks: scroll handler + idle timer handler
    expect(ctx.afterScroll.length).toBe(initialCallbackCount + 2);
  });

  it("should add destroy handler for cleanup", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    const initialHandlerCount = ctx.destroyHandlers.length;
    plugin.setup(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(initialHandlerCount);
  });

  it("should call loadInitial on setup", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    plugin.setup(ctx);

    // Wait a bit for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The adapter's read method should have been called
    expect(adapter.read).toHaveBeenCalled();
  });

  it("should emit load:start on initial load", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    plugin.setup(ctx);

    expect(ctx.emitter.emit).toHaveBeenCalledWith("load:start", {
      offset: 0,
      limit: 50,
    });
  });
});

// =============================================================================
// ARIA Attributes
// =============================================================================

describe("withAsync - ARIA Attributes", () => {
  it("should set aria-busy on load:start", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    plugin.setup(ctx);

    const ariaState = (ctx as any).getAriaState();

    // Trigger load:start event
    ctx.emitter.emit("load:start", { offset: 0, limit: 50 });

    expect(ariaState["aria-busy"]).toBe("true");
  });

  it("should remove aria-busy on load:end", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext();

    plugin.setup(ctx);

    const ariaState = (ctx as any).getAriaState();

    // Set aria-busy first
    ctx.emitter.emit("load:start", { offset: 0, limit: 50 });
    expect(ariaState["aria-busy"]).toBe("true");

    // Then clear it
    ctx.emitter.emit("load:end", { items: [], total: 100 });
    expect(ariaState["aria-busy"]).toBeNull();
  });
});

// =============================================================================
// Velocity-Aware Loading
// =============================================================================

describe("withAsync - Velocity-Aware Loading", () => {
  it("should load data when velocity is below cancelThreshold", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 25 },
    });
    const ctx = createMockContext({ velocity: 10, isTracking: true });

    plugin.setup(ctx);

    // Get the captured data manager
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(dataManager.ensureRange);
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll callback
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should call ensureRange
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should skip loading when velocity exceeds cancelThreshold", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 25 },
    });
    const ctx = createMockContext({ velocity: 30, isTracking: true });

    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll callback
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should NOT call ensureRange during fast scroll
    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });

  it("should queue range for later when velocity is too high", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 25 },
    });
    const ctx = createMockContext({ velocity: 30, isTracking: true });

    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll with high velocity
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not load immediately
    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });

  it("should load pending range when velocity drops below threshold", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 25 },
    });

    // Start with high velocity
    const ctx = createMockContext({ velocity: 30, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0];

    // First scroll: high velocity, queues range
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Update velocity to slow
    (ctx.scrollController.getVelocity as any).mockReturnValue(10);

    // Second scroll: velocity dropped, should load pending range
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should not load when velocity tracker is unreliable", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });
    const ctx = createMockContext({ velocity: 5, isTracking: false });

    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not load when tracker is unreliable
    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Preloading
// =============================================================================

describe("withAsync - Preloading", () => {
  it("should preload ahead when velocity is above preloadThreshold", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: {
        preloadThreshold: 2,
        preloadAhead: 50,
        cancelThreshold: 25,
      },
    });

    const ctx = createMockContext({ velocity: 5, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll down with medium velocity
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should call ensureRange with extended end
    expect(ensureRangeSpy).toHaveBeenCalledWith(0, 60); // 10 + 50
  });

  it("should preload behind when scrolling up", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: {
        preloadThreshold: 2,
        preloadAhead: 50,
        cancelThreshold: 25,
      },
    });

    const ctx = createMockContext({ velocity: 5, isTracking: true });
    ctx.state.viewportState.renderRange = { start: 60, end: 70 };
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll up
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(200, "up");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should call ensureRange with extended start
    expect(ensureRangeSpy).toHaveBeenCalledWith(10, 70); // 60 - 50
  });

  it("should not preload when velocity is below preloadThreshold", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: {
        preloadThreshold: 2,
        preloadAhead: 50,
      },
    });

    const ctx = createMockContext({ velocity: 1, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll with slow velocity
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should call ensureRange with normal range (no preload)
    expect(ensureRangeSpy).toHaveBeenCalledWith(0, 10);
  });

  it("should clamp preload range to total items", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: {
        preloadThreshold: 2,
        preloadAhead: 500,
      },
    });

    const ctx = createMockContext({ velocity: 5, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll near end
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should clamp to total - 1 (99)
    expect(ensureRangeSpy).toHaveBeenCalledWith(0, 99);
  });

  it("should clamp preload range to start at 0", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: {
        preloadThreshold: 2,
        preloadAhead: 500,
      },
    });

    const ctx = createMockContext({ velocity: 5, isTracking: true });
    ctx.state.viewportState.renderRange = { start: 5, end: 15 };
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll up near start
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(50, "up");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should clamp start to 0
    expect(ensureRangeSpy).toHaveBeenCalledWith(0, 15);
  });
});

// =============================================================================
// Infinite Scroll (Load More)
// =============================================================================

describe("withAsync - Infinite Scroll", () => {
  it("should trigger loadMore near bottom in normal mode", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.viewportState.totalSize = 5000;
    ctx.state.viewportState.containerSize = 500;

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => true;
    dataManager.getIsLoading = () => false;
    const loadMoreSpy = mock(() => Promise.resolve(true));
    dataManager.loadMore = loadMoreSpy;

    // Scroll near bottom (5000 - 4900 - 500 = -400 < 200)
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(4900, "down");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loadMoreSpy).toHaveBeenCalled();
  });

  it("should trigger loadMore near top in reverse mode", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({
      velocity: 0,
      isTracking: true,
      reverse: true,
    });

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => true;
    dataManager.getIsLoading = () => false;
    const loadMoreSpy = mock(() => Promise.resolve(true));
    dataManager.loadMore = loadMoreSpy;

    // Scroll near top (< 200)
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(50, "up");

    // Wait for async
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loadMoreSpy).toHaveBeenCalled();
  });

  it("should not trigger loadMore when already loading", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.viewportState.totalSize = 5000;
    ctx.state.viewportState.containerSize = 500;

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => true;
    dataManager.getIsLoading = () => true; // Already loading
    const loadMoreSpy = mock(() => Promise.resolve(true));
    dataManager.loadMore = loadMoreSpy;

    // Scroll near bottom
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(4900, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loadMoreSpy).not.toHaveBeenCalled();
  });

  it("should not trigger loadMore when hasMore is false", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.viewportState.totalSize = 5000;
    ctx.state.viewportState.containerSize = 500;

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => false; // No more items
    dataManager.getIsLoading = () => false;
    const loadMoreSpy = mock(() => Promise.resolve(false));
    dataManager.loadMore = loadMoreSpy;

    // Scroll near bottom
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(4900, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loadMoreSpy).not.toHaveBeenCalled();
  });

  it("should not trigger loadMore when velocity is too high", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter, loading: { cancelThreshold: 25 } });

    const ctx = createMockContext({ velocity: 30, isTracking: true });
    ctx.state.viewportState.totalSize = 5000;
    ctx.state.viewportState.containerSize = 500;

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => true;
    dataManager.getIsLoading = () => false;
    const loadMoreSpy = mock(() => Promise.resolve(true));
    dataManager.loadMore = loadMoreSpy;

    // Scroll near bottom with high velocity
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(4900, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loadMoreSpy).not.toHaveBeenCalled();
  });

  it("should emit load:start before loadMore", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.viewportState.totalSize = 5000;
    ctx.state.viewportState.containerSize = 500;

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => true;
    dataManager.getIsLoading = () => false;
    dataManager.getCached = () => 50;
    dataManager.loadMore = mock(() => Promise.resolve(true));

    // Clear setup calls
    (ctx.emitter.emit as any).mockClear();

    // Scroll near bottom
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(4900, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ctx.emitter.emit).toHaveBeenCalledWith("load:start", {
      offset: 50,
      limit: 50,
    });
  });
});

// =============================================================================
// Idle Timer
// =============================================================================

describe("withAsync - Idle Timer", () => {
  it("should set up idle timer on scroll", (done) => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 30, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // First scroll handler queues the range (velocity too high)
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Second scroll handler sets up idle timer
    const idleHandler = ctx.afterScroll[1];
    idleHandler(100, "down");

    // Wait for idle timeout (200ms)
    setTimeout(() => {
      // Should have loaded pending range
      expect(ensureRangeSpy).toHaveBeenCalled();
      done();
    }, 250);
  });

  it("should reset idle timer on subsequent scrolls", (done) => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 30, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Queue a range
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    const idleHandler = ctx.afterScroll[1];

    // Start idle timer
    idleHandler(100, "down");

    // Wait 100ms, then scroll again (should reset timer)
    setTimeout(() => {
      idleHandler(150, "down");

      // After 250ms total from first call, should have been called
      setTimeout(() => {
        // Timer was reset, so should be called after another 200ms from second idle call
        expect(ensureRangeSpy).toHaveBeenCalled();
        done();
      }, 220);
    }, 50);
  });

  it("should clean up idle timer on destroy", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 30, isTracking: true });
    plugin.setup(ctx);

    // Trigger idle timer setup
    const idleHandler = ctx.afterScroll[1];
    idleHandler(100, "down");

    // Call destroy handler
    const destroyHandler = ctx.destroyHandlers[ctx.destroyHandlers.length - 1];
    expect(() => destroyHandler()).not.toThrow();
  });
});

// =============================================================================
// Range Change Detection
// =============================================================================

describe("withAsync - Range Change Detection", () => {
  it("should detect when renderRange changes", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // First scroll with range 0-10
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(0, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalledWith(0, 10);

    // Clear
    (ensureRangeSpy as any).mockClear();

    // Change range
    ctx.state.viewportState.renderRange = { start: 10, end: 20 };
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalledWith(10, 20);
  });

  it("should not call ensureRange if range unchanged", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // First scroll
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(0, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalledTimes(1);

    // Second scroll with same range
    scrollHandler(5, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalledTimes(1); // No additional call
  });
});

// =============================================================================
// Error Handling
// =============================================================================

describe("withAsync - Error Handling", () => {
  it("should emit error event when ensureRange fails", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    const testError = new Error("Network error");

    plugin.setup(ctx);

    // Get the captured data manager and make ensureRange reject
    const dataManager = ctx.capturedDataManager();
    dataManager.ensureRange = mock(() => Promise.reject(testError));

    // Clear setup calls
    (ctx.emitter.emit as any).mockClear();

    // Trigger scroll
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait for promise rejection
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ctx.emitter.emit).toHaveBeenCalledWith("error", {
      error: testError,
      context: "ensureRange",
    });
  });

  it("should emit error event when loadMore fails", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.viewportState.totalSize = 5000;
    ctx.state.viewportState.containerSize = 500;

    const testError = new Error("Load more failed");

    plugin.setup(ctx);

    // Get the captured data manager and configure it
    const dataManager = ctx.capturedDataManager();
    dataManager.getHasMore = () => true;
    dataManager.getIsLoading = () => false;
    dataManager.loadMore = mock(() => Promise.reject(testError));

    // Clear setup calls
    (ctx.emitter.emit as any).mockClear();

    // Trigger loadMore
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(4900, "down");

    // Wait for promise rejection
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ctx.emitter.emit).toHaveBeenCalledWith("error", {
      error: testError,
      context: "loadMore",
    });
  });

  it("should handle adapter errors on loadInitial", async () => {
    const testError = new Error("Initial load failed");
    const failingAdapter: VListAdapter<TestItem> = {
      read: mock(async () => {
        throw testError;
      }),
    };
    const plugin = withAsync({ adapter: failingAdapter });

    const ctx = createMockContext();

    plugin.setup(ctx);

    // Wait for async operation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify the adapter was called and failed
    expect(failingAdapter.read).toHaveBeenCalled();

    // The error is caught internally by the data manager
    // Just verify the system doesn't crash
    expect(ctx.dataManager).toBeDefined();
  });
});

// =============================================================================
// Reload Method
// =============================================================================

describe("withAsync - Reload Method", () => {
  it("should clear lastEnsuredRange on reload", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    plugin.setup(ctx);

    // Get the captured data manager
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const reloadFn = ctx.methods.get("reload");

    // Trigger a scroll to set lastEnsuredRange
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Clear mocks
    (ensureRangeSpy as any).mockClear();

    // Reload
    await reloadFn();

    // Clear again
    (ensureRangeSpy as any).mockClear();

    // Next scroll should trigger ensureRange even with same range
    // because lastEnsuredRange was cleared
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should call invalidateRendered on reload", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext();
    plugin.setup(ctx);

    const reloadFn = ctx.methods.get("reload");
    await reloadFn();

    expect(ctx.invalidateRendered).toHaveBeenCalled();
  });

  it("should call dataManager.reload", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext();
    plugin.setup(ctx);

    // Get the captured data manager and spy on reload
    const dataManager = ctx.capturedDataManager();
    const reloadSpy = mock(() => Promise.resolve());
    dataManager.reload = reloadSpy;

    const reloadFn = ctx.methods.get("reload");
    await reloadFn();

    expect(reloadSpy).toHaveBeenCalled();
  });

  it("should call forceRender after reload", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext();
    plugin.setup(ctx);

    const reloadFn = ctx.methods.get("reload");
    await reloadFn();

    expect(ctx.forceRender).toHaveBeenCalled();
  });

  it("should ensure visible range is loaded after reload", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext();
    ctx.state.viewportState.renderRange = { start: 20, end: 30 };
    plugin.setup(ctx);

    // Get the captured data manager
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.reload = mock(() => Promise.resolve());

    const reloadFn = ctx.methods.get("reload");
    await reloadFn();

    expect(ensureRangeSpy).toHaveBeenCalledWith(20, 30);
  });

  it("should not call ensureRange if renderRange.end is 0", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext();
    ctx.state.viewportState.renderRange = { start: 0, end: 0 };
    plugin.setup(ctx);

    // Get the captured data manager
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.reload = mock(() => Promise.resolve());

    const reloadFn = ctx.methods.get("reload");
    await reloadFn();

    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Destroyed State
// =============================================================================

describe("withAsync - Destroyed State", () => {
  it("should not process scroll when isDestroyed is true", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.isDestroyed = true;
    plugin.setup(ctx);

    // Get the captured data manager
    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock(() => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });
});
