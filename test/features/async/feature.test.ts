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
    scrollController: (() => {
      let scrollPos = 0;
      return {
        getScrollTop: mock(() => scrollPos),
        setScrollTop: (pos: number) => { scrollPos = pos; },
        scrollTo: mock(() => {}),
        isAtTop: mock(() => scrollPos <= 0),
        isAtBottom: mock(() => false),
        getVelocity: mock(() => config?.velocity ?? 0),
        isTracking: mock(() => config?.isTracking ?? true),
      };
    })() as any,
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
    idleHandlers: [],
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
    disableWheelHandler: mock(() => {}),
    adjustScrollPosition: (pos: number) => pos,
    getStripeIndexFn: () => (index: number) => index,
    setStripeIndexFn: () => {},
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
    expect(plugin.methods).toEqual(["reload", "loadVisibleRange"]);
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;


    const scrollHandler = ctx.afterScroll[0];

    // First scroll: high velocity, queues range (mid-scroll, not at edge)
    (ctx.scrollController as any).setScrollTop(100);
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Update velocity to below threshold but still decelerating (> 0.5)
    (ctx.scrollController.getVelocity as any).mockReturnValue(10);

    // Second scroll: velocity dropped below cancel threshold, but still
    // in deceleration phase — should NOT load immediately to avoid
    // request bursts during momentum scroll deceleration
    (ctx.scrollController as any).setScrollTop(200);
    scrollHandler(200, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Drop velocity to near-zero (< 0.5) — scroll has settled
    (ctx.scrollController.getVelocity as any).mockReturnValue(0);

    // Third scroll: velocity negligible, exits deceleration phase
    // and loads the pending range
    (ctx.scrollController as any).setScrollTop(210);
    scrollHandler(210, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should load pending range after deceleration timer fires", async () => {
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;


    const scrollHandler = ctx.afterScroll[0];

    // First scroll: high velocity, queues range (mid-scroll, not at edge)
    (ctx.scrollController as any).setScrollTop(100);
    scrollHandler(100, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Drop below threshold but still decelerating — change renderRange
    // so range change detection fires and the deceleration timer starts
    (ctx.scrollController.getVelocity as any).mockReturnValue(3);
    ctx.state.viewportState.renderRange = { start: 20, end: 30 };
    (ctx.scrollController as any).setScrollTop(200);
    scrollHandler(200, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Wait for deceleration settle timer (120ms) — should fire without
    // needing velocity to reach zero
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should load immediately when hitting scroll boundary during fast scroll", async () => {
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;


    const scrollHandler = ctx.afterScroll[0];

    // First scroll: high velocity mid-scroll, queues range
    (ctx.scrollController as any).setScrollTop(500);
    ctx.state.viewportState.renderRange = { start: 50, end: 60 };
    scrollHandler(500, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Second scroll: still high velocity but we've hit the bottom boundary.
    // Should flush immediately — no point deferring when scroll can't continue.
    (ctx.scrollController.isAtBottom as any).mockReturnValue(true);
    (ctx.scrollController as any).setScrollTop(4500);
    ctx.state.viewportState.renderRange = { start: 90, end: 99 };
    scrollHandler(4500, "down");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should load immediately when hitting top boundary during fast scroll up", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 25 },
    });

    // Start mid-scroll with high velocity
    const ctx = createMockContext({ velocity: 30, isTracking: true });
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;


    const scrollHandler = ctx.afterScroll[0];

    // First scroll: high velocity mid-scroll, queues range
    (ctx.scrollController as any).setScrollTop(500);
    ctx.state.viewportState.renderRange = { start: 50, end: 60 };
    scrollHandler(500, "up");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Second scroll: hit the top boundary — should flush immediately
    (ctx.scrollController as any).setScrollTop(0);
    ctx.state.viewportState.renderRange = { start: 0, end: 10 };
    scrollHandler(0, "up");
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const reloadFn = ctx.methods.get("reload")!;

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

    const reloadFn = ctx.methods.get("reload")!;
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

    const reloadFn = ctx.methods.get("reload")!;
    await reloadFn();

    expect(reloadSpy).toHaveBeenCalled();
  });

  it("should call forceRender after reload", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext();
    plugin.setup(ctx);

    const reloadFn = ctx.methods.get("reload")!;
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.reload = mock(() => Promise.resolve());

    const reloadFn = ctx.methods.get("reload")!;
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.reload = mock(() => Promise.resolve());

    const reloadFn = ctx.methods.get("reload")!;
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
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Reverse Mode — Load More
// =============================================================================

describe("withAsync - Reverse Mode Load More", () => {
  it("should trigger loadMore near the TOP in reverse mode", async () => {
    const adapter = createMockAdapter(200);
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ reverse: true, velocity: 0, isTracking: true });
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const loadMoreSpy = mock(() => Promise.resolve());
    dataManager.loadMore = loadMoreSpy;
    dataManager.getIsLoading = () => false;
    dataManager.getHasMore = () => true;
    dataManager.getCached = () => 100;

    // Scroll near the top (below LOAD_THRESHOLD = 200)
    const scrollHandler = ctx.afterScroll[0]!;
    scrollHandler(50, "up");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loadMoreSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// Velocity Deceleration Phases
// =============================================================================

describe("withAsync - Deceleration Handling", () => {
  it("should reset deceleration when velocity goes back above threshold", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    // Start with high velocity
    let currentVelocity = 10;
    const ctx = createMockContext({ velocity: 10, isTracking: true });
    ctx.scrollController.getVelocity = () => currentVelocity;

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0]!;

    // Frame 1: high velocity (above threshold 5)
    currentVelocity = 10;
    ctx.state.viewportState.renderRange = { start: 0, end: 10 };
    scrollHandler(100, "down");

    // Frame 2: drop below threshold (deceleration begins)
    currentVelocity = 3;
    ctx.state.viewportState.renderRange = { start: 5, end: 15 };
    scrollHandler(200, "down");

    // Frame 3: velocity goes back above threshold (re-acceleration)
    currentVelocity = 8;
    ctx.state.viewportState.renderRange = { start: 10, end: 20 };
    scrollHandler(300, "down");

    // The re-acceleration should have reset the deceleration state
    // Now drop velocity to stable low again
    currentVelocity = 1;
    ctx.state.viewportState.renderRange = { start: 12, end: 22 };
    scrollHandler(350, "down");

    // Should load immediately (not in deceleration phase)
    expect(ensureRangeSpy).toHaveBeenCalled();
  });

  it("should defer loading during deceleration and use settle timer", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter, autoLoad: false, total: 100 });

    let currentVelocity = 10;
    const ctx = createMockContext({ velocity: 10, isTracking: true });
    ctx.scrollController.getVelocity = () => currentVelocity;

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.getIsLoading = () => false;
    dataManager.getHasMore = () => false;

    const scrollHandler = ctx.afterScroll[0]!;

    // Move scroll position away from edges so atEdge doesn't short-circuit
    (ctx.scrollController as any).setScrollTop(500);

    // Frame 1: high velocity (above cancelLoadThreshold=5)
    currentVelocity = 10;
    ctx.state.viewportState.renderRange = { start: 0, end: 10 };
    scrollHandler(500, "down");

    // Frame 2: drop below threshold but still > 0.5 (deceleration)
    currentVelocity = 3;
    ctx.state.viewportState.renderRange = { start: 5, end: 15 };
    scrollHandler(700, "down");

    // ensureRange should NOT have been called yet (deferring during deceleration)
    expect(ensureRangeSpy.mock.calls.length).toBe(0);

    // Wait for deceleration settle timer (120ms)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Deceleration timer should have fired and loaded the pending range
    expect(ensureRangeSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("should clear deceleration timer when velocity drops to near-zero", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    let currentVelocity = 10;
    const ctx = createMockContext({ velocity: 10, isTracking: true });
    ctx.scrollController.getVelocity = () => currentVelocity;

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0]!;

    // Frame 1: high velocity
    currentVelocity = 10;
    ctx.state.viewportState.renderRange = { start: 0, end: 10 };
    scrollHandler(100, "down");

    // Frame 2: drop below threshold (deceleration starts)
    currentVelocity = 3;
    ctx.state.viewportState.renderRange = { start: 5, end: 15 };
    scrollHandler(200, "down");

    // Frame 3: velocity drops to near-zero — exits deceleration
    currentVelocity = 0.1;
    ctx.state.viewportState.renderRange = { start: 7, end: 17 };
    scrollHandler(250, "down");

    // Should load for the current range (not the stale pending one)
    expect(ensureRangeSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// Network Recovery — online event
// =============================================================================

describe("withAsync - Network Recovery", () => {
  it("should reload visible placeholders on 'online' event", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.viewportState.renderRange = { start: 10, end: 20 };
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Simulate network recovery
    const onlineEvent = new dom.window.Event("online");
    window.dispatchEvent(onlineEvent);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ensureRangeSpy).toHaveBeenCalledWith(10, 20);
  });

  it("should not reload on 'online' when destroyed", async () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    ctx.state.isDestroyed = true;
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const onlineEvent = new dom.window.Event("online");
    window.dispatchEvent(onlineEvent);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensureRangeSpy).not.toHaveBeenCalled();
  });

  it("should clean up online listener on destroy", () => {
    const adapter = createMockAdapter();
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    plugin.setup(ctx);

    // Run destroy handlers
    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    // The listener should have been removed (no error on dispatching)
    expect(() => {
      window.dispatchEvent(new dom.window.Event("online"));
    }).not.toThrow();
  });
});

// =============================================================================
// Pending Range — Live Range Fix
// =============================================================================

describe("withAsync - Pending Range Uses Live Render Range", () => {
  it("should use live renderRange when idle timer fires, not stale pendingRange", (done) => {
    // Scenario: smooth scroll defers loading, but by the time the idle timer
    // fires the viewport has moved far past the saved pendingRange.
    // loadPendingRange must read viewportState.renderRange (the live position)
    // instead of consuming the stale saved coordinates.
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 5 },
    });

    const ctx = createMockContext({ velocity: 30, isTracking: true });
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0]!;
    const idleHandler = ctx.afterScroll[1]!;

    // Frame 1: fast scroll at range 100..120 — deferred (velocity too high)
    ctx.state.viewportState.renderRange = { start: 100, end: 120 };
    (ctx.scrollController as any).setScrollTop(3600);
    scrollHandler(3600, "down");

    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Simulate viewport moving to a completely different position
    // (smooth scroll animation continued and landed elsewhere)
    ctx.state.viewportState.renderRange = { start: 500, end: 520 };

    // Fire idle timer — should use live range {500..520}, not stale {100..120}
    idleHandler(18000, "down");

    setTimeout(() => {
      expect(ensureRangeSpy).toHaveBeenCalled();
      const lastCall = ensureRangeSpy.mock.calls[ensureRangeSpy.mock.calls.length - 1];
      // Must match the LIVE renderRange, not the stale one
      expect(lastCall[0]).toBe(500);
      expect(lastCall[1]).toBe(520);
      done();
    }, 250);
  });

  it("should use live renderRange when deceleration timer fires", async () => {
    // Same bug, triggered via the deceleration settle timer (120ms) rather
    // than the idle timer (200ms).
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      autoLoad: false,
      total: 10000,
      loading: { cancelThreshold: 5 },
    });

    let currentVelocity = 30;
    const ctx = createMockContext({ velocity: 30, isTracking: true });
    ctx.scrollController.getVelocity = () => currentVelocity;
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.getIsLoading = () => false;
    dataManager.getHasMore = () => false;

    const scrollHandler = ctx.afterScroll[0]!;

    // Frame 1: high velocity, renderRange = 200..220
    currentVelocity = 30;
    ctx.state.viewportState.renderRange = { start: 200, end: 220 };
    (ctx.scrollController as any).setScrollTop(7200);
    scrollHandler(7200, "down");

    // Frame 2: velocity drops below threshold (deceleration starts)
    // renderRange moves to 300..320
    currentVelocity = 3;
    ctx.state.viewportState.renderRange = { start: 300, end: 320 };
    (ctx.scrollController as any).setScrollTop(10800);
    scrollHandler(10800, "down");

    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Before deceleration timer fires, viewport settles at 800..820
    ctx.state.viewportState.renderRange = { start: 800, end: 820 };

    // Wait for deceleration settle timer (120ms)
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(ensureRangeSpy).toHaveBeenCalled();
    const lastCall = ensureRangeSpy.mock.calls[ensureRangeSpy.mock.calls.length - 1];
    // Must be the live range {800..820}, not the stale {300..320}
    expect(lastCall[0]).toBe(800);
    expect(lastCall[1]).toBe(820);
  });

  it("should reset lastEnsuredRange so afterScroll re-evaluates after pending load", (done) => {
    // After loadPendingRange fires via idle, a subsequent afterScroll frame
    // at the SAME renderRange should still call ensureRange — proving that
    // lastEnsuredRange was cleared by loadPendingRange.
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      autoLoad: false,
      total: 10000,
      loading: { cancelThreshold: 5 },
    });

    let currentVelocity = 30;
    const ctx = createMockContext({ velocity: 30, isTracking: true });
    ctx.scrollController.getVelocity = () => currentVelocity;
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;
    dataManager.getIsLoading = () => false;
    dataManager.getHasMore = () => false;

    const scrollHandler = ctx.afterScroll[0]!;
    const idleHandler = ctx.afterScroll[1]!;

    // Frame 1: fast scroll at range 50..70 — deferred (velocity too high)
    ctx.state.viewportState.renderRange = { start: 50, end: 70 };
    (ctx.scrollController as any).setScrollTop(1800);
    scrollHandler(1800, "down");
    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Idle fires — loads the live range and resets lastEnsuredRange
    idleHandler(1800, "down");

    setTimeout(() => {
      const callCountAfterIdle = ensureRangeSpy.mock.calls.length;
      expect(callCountAfterIdle).toBeGreaterThan(0);

      // Now scroll slowly at the SAME range {50..70}.
      // First drop velocity to 0 so we fully exit deceleration
      // (previousVelocity goes through the 30→0 transition cleanly).
      currentVelocity = 0;
      (ctx.scrollController as any).setScrollTop(1800);
      scrollHandler(1800, "down");

      // Then a normal slow scroll — same range, low velocity.
      // If lastEnsuredRange wasn't nulled, rangeChanged would be false
      // and ensureRange would be skipped.
      currentVelocity = 1;
      ctx.state.viewportState.renderRange = { start: 50, end: 70 };
      (ctx.scrollController as any).setScrollTop(1801);
      scrollHandler(1801, "down");

      expect(ensureRangeSpy.mock.calls.length).toBeGreaterThan(callCountAfterIdle);
      done();
    }, 250);
  });

  it("should not fire ensureRange when no range was deferred", (done) => {
    // loadPendingRange should be a no-op when pendingRange is null
    // (e.g. low-velocity scroll that loaded inline)
    const adapter = createMockAdapter();
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 50 }, // high threshold = everything loads inline
    });

    const ctx = createMockContext({ velocity: 1, isTracking: true });
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0]!;
    const idleHandler = ctx.afterScroll[1]!;

    // Low-velocity scroll — loads inline via afterScroll (no pending)
    ctx.state.viewportState.renderRange = { start: 0, end: 10 };
    scrollHandler(0, "down");

    const callCountAfterScroll = ensureRangeSpy.mock.calls.length;

    // Fire idle timer — should NOT trigger an extra ensureRange
    idleHandler(0, "down");

    setTimeout(() => {
      expect(ensureRangeSpy.mock.calls.length).toBe(callCountAfterScroll);
      done();
    }, 250);
  });
});

// =============================================================================
// autoLoad: false with total
// =============================================================================

describe("withAsync - autoLoad: false with total", () => {
  it("should set total without loading when autoLoad is false and total is provided", async () => {
    const adapter = createMockAdapter(500);
    const plugin = withAsync({ adapter, autoLoad: false, total: 500 });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();

    // adapter.read should NOT have been called
    expect(adapter.read).not.toHaveBeenCalled();

    // But total should be set
    expect(dataManager.getTotal()).toBe(500);
  });
});

// =============================================================================
// Grid + Async Integration (row-to-item range conversion)
// =============================================================================

describe("withAsync - Grid Range Conversion", () => {
  /**
   * When withGrid is active, viewportState.renderRange contains ROW indices.
   * The async feature must convert these to flat ITEM indices before calling
   * ensureRange. Without this conversion, ensureRange receives row indices
   * (e.g. 0-5) instead of item indices (e.g. 0-23 with 4 columns), causing
   * most items to remain as placeholders.
   */

  function createMockGridLayout(columns: number) {
    return {
      columns,
      gap: 8,
      update: () => {},
      getTotalRows: (totalItems: number) => Math.ceil(totalItems / columns),
      getPosition: (itemIndex: number) => ({
        row: Math.floor(itemIndex / columns),
        col: itemIndex % columns,
      }),
      getRow: (itemIndex: number) => Math.floor(itemIndex / columns),
      getCol: (itemIndex: number) => itemIndex % columns,
      getItemRange: (rowStart: number, rowEnd: number, totalItems: number) => ({
        start: Math.max(0, rowStart * columns),
        end: Math.min(totalItems - 1, (rowEnd + 1) * columns - 1),
      }),
      getItemIndex: (row: number, col: number, totalItems: number) => {
        const index = row * columns + col;
        return index < totalItems ? index : -1;
      },
      getColumnWidth: (containerWidth: number) =>
        (containerWidth - (columns - 1) * 8) / columns,
      getColumnOffset: (col: number, containerWidth: number) => {
        const colWidth = (containerWidth - (columns - 1) * 8) / columns;
        return col * (colWidth + 8);
      },
    };
  }

  it("should convert row range to item range for ensureRange when grid is active", async () => {
    const adapter = createMockAdapter(200);
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });

    // Register grid layout BEFORE plugin setup (grid has priority 10, async has 20)
    const gridLayout = createMockGridLayout(4);
    ctx.methods.set("_getGridLayout", () => gridLayout);

    // Set renderRange in ROW space (rows 0-5 with 4 columns = items 0-23)
    ctx.state.viewportState.renderRange = { start: 0, end: 5 };

    plugin.setup(ctx);

    // Get the captured data manager and spy on ensureRange
    const dataManager = ctx.capturedDataManager();
    dataManager.getTotal = () => 200;
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // Trigger scroll
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should call ensureRange with ITEM indices (0-23), not row indices (0-5)
    expect(ensureRangeSpy).toHaveBeenCalled();
    const call = ensureRangeSpy.mock.calls[0];
    expect(call[0]).toBe(0);   // start item = row 0 * 4 columns = 0
    expect(call[1]).toBe(23);  // end item = (5+1) * 4 - 1 = 23
  });

  it("should convert row range to item range when scrolled further down", async () => {
    const adapter = createMockAdapter(200);
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });

    const gridLayout = createMockGridLayout(4);
    ctx.methods.set("_getGridLayout", () => gridLayout);

    // Rows 10-15 with 4 columns = items 40-63
    ctx.state.viewportState.renderRange = { start: 10, end: 15 };

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    dataManager.getTotal = () => 200;
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(500, "down");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ensureRangeSpy).toHaveBeenCalled();
    const call = ensureRangeSpy.mock.calls[0];
    expect(call[0]).toBe(40);  // row 10 * 4 = 40
    expect(call[1]).toBe(63);  // (15+1) * 4 - 1 = 63
  });

  it("should clamp item range to total items in grid mode", async () => {
    const adapter = createMockAdapter(50);
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });

    const gridLayout = createMockGridLayout(4);
    ctx.methods.set("_getGridLayout", () => gridLayout);

    // Rows 10-15 would be items 40-63, but total is only 50
    ctx.state.viewportState.renderRange = { start: 10, end: 15 };

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    dataManager.getTotal = () => 50;
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(500, "down");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ensureRangeSpy).toHaveBeenCalled();
    const call = ensureRangeSpy.mock.calls[0];
    expect(call[0]).toBe(40);  // row 10 * 4 = 40
    expect(call[1]).toBe(49);  // clamped to totalItems - 1 = 49
  });

  it("should NOT convert range when grid is not active", async () => {
    const adapter = createMockAdapter(100);
    const plugin = withAsync({ adapter });

    const ctx = createMockContext({ velocity: 0, isTracking: true });
    // No grid layout registered — plain list mode

    ctx.state.viewportState.renderRange = { start: 5, end: 15 };

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should pass range as-is (no conversion)
    expect(ensureRangeSpy).toHaveBeenCalled();
    const call = ensureRangeSpy.mock.calls[0];
    expect(call[0]).toBe(5);
    expect(call[1]).toBe(15);
  });

  it("should convert range in loadPendingRange (idle handler) with grid", (done) => {
    const adapter = createMockAdapter(200);
    const plugin = withAsync({
      adapter,
      loading: { cancelThreshold: 25 },
    });

    const ctx = createMockContext({ velocity: 30, isTracking: true });

    const gridLayout = createMockGridLayout(4);
    ctx.methods.set("_getGridLayout", () => gridLayout);

    // Rows 5-10 = items 20-43
    ctx.state.viewportState.renderRange = { start: 5, end: 10 };

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    dataManager.getTotal = () => 200;
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    // High velocity — range gets queued
    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(300, "down");

    expect(ensureRangeSpy).not.toHaveBeenCalled();

    // Trigger idle timer
    const idleHandler = ctx.afterScroll[1];
    idleHandler(300, "down");

    // Wait for idle timeout (200ms)
    setTimeout(() => {
      expect(ensureRangeSpy).toHaveBeenCalled();
      const call = ensureRangeSpy.mock.calls[0];
      expect(call[0]).toBe(20);  // row 5 * 4 = 20
      expect(call[1]).toBe(43);  // (10+1) * 4 - 1 = 43
      done();
    }, 250);
  });

  it("should use item total (not row total) for preload clamping in grid mode", async () => {
    const adapter = createMockAdapter(100);
    const plugin = withAsync({
      adapter,
      loading: {
        preloadThreshold: 2,
        preloadAhead: 500, // Very large to force clamping
        cancelThreshold: 25,
      },
    });

    const ctx = createMockContext({ velocity: 5, isTracking: true });

    const gridLayout = createMockGridLayout(4);
    ctx.methods.set("_getGridLayout", () => gridLayout);

    // Rows 0-3 = items 0-15; getVirtualTotal returns row count (25 rows)
    // but item total is 100
    ctx.state.viewportState.renderRange = { start: 0, end: 3 };

    plugin.setup(ctx);

    const dataManager = ctx.capturedDataManager();
    dataManager.getTotal = () => 100;
    const ensureRangeSpy = mock((_s: number, _e: number) => Promise.resolve());
    dataManager.ensureRange = ensureRangeSpy;

    const scrollHandler = ctx.afterScroll[0];
    scrollHandler(100, "down");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ensureRangeSpy).toHaveBeenCalled();
    const call = ensureRangeSpy.mock.calls[0];
    expect(call[0]).toBe(0);
    // Should clamp to item total - 1 (99), not row total - 1 (24)
    expect(call[1]).toBe(99);
  });
});
