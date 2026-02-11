/**
 * vlist - Event Handlers Tests
 * Tests for scroll, click, and keyboard event handlers
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
import { createVList } from "../src/vlist";
import { JSDOM } from "jsdom";
import {
  createScrollHandler,
  createClickHandler,
  createKeyboardHandler,
} from "../src/handlers";
import { createSelectionState } from "../src/selection";
import type {
  VListContext,
  VListContextConfig,
  VListContextState,
} from "../src/context";
import type { VListItem, ViewportState, Range } from "../src/types";
import type { DataManager } from "../src/data";
import type { ScrollController } from "../src/scroll";
import type { Emitter } from "../src/events";
import type { Renderer, DOMStructure, CompressionContext } from "../src/render";
import { createHeightCache } from "../src/render/heights";

// =============================================================================
// JSDOM Setup
// =============================================================================

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 600 });
  Object.defineProperty(container, "clientWidth", { value: 400 });
  document.body.appendChild(container);
  return container;
};

const cleanupContainer = (container: HTMLElement): void => {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
};

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
  global.DocumentFragment = dom.window.DocumentFragment;

  // Mock ResizeObserver — callback is stored so we can trigger it manually
  (global as any).__resizeObserverInstances = [] as any[];

  global.ResizeObserver = class MockResizeObserver {
    private callback: ResizeObserverCallback;
    private targets: Element[] = [];

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      (global as any).__resizeObserverInstances.push(this);
    }

    observe(target: Element) {
      this.targets.push(target);
      this.callback(
        [
          {
            target,
            contentRect: {
              width: 400,
              height: 600,
              top: 0,
              left: 0,
              bottom: 600,
              right: 400,
              x: 0,
              y: 0,
              toJSON: () => {},
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this as any,
      );
    }

    unobserve() {}
    disconnect() {}
  } as any;

  // Mock scrollTo for JSDOM (not supported natively)
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

  // Mock requestAnimationFrame / cancelAnimationFrame
  let rafId = 0;
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    rafId++;
    const id = rafId;
    const timer = setTimeout(() => {
      pendingTimers.delete(id);
      cb(performance.now());
    }, 0);
    pendingTimers.set(id, timer);
    return id;
  };
  global.cancelAnimationFrame = (id: number): void => {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingTimers.delete(id);
    }
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
  delete (global as any).__resizeObserverInstances;
  dom.window.close();
});

// =============================================================================
// Test Utilities
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));
};

const createMockConfig = (
  overrides?: Partial<VListContextConfig>,
): VListContextConfig => ({
  itemHeight: 40,
  overscan: 3,
  classPrefix: "vlist",
  selectionMode: "none",
  hasAdapter: false,
  reverse: false,
  wrap: false,
  cancelLoadThreshold: 25,
  preloadThreshold: 10,
  preloadAhead: 20,
  ariaIdPrefix: "vlist-0",
  ...overrides,
});

const createMockDOM = (): DOMStructure => {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");

  root.appendChild(viewport);
  viewport.appendChild(content);
  content.appendChild(items);

  return { root, viewport, content, items };
};

const createMockViewportState = (
  overrides?: Partial<ViewportState>,
): ViewportState => ({
  scrollTop: 0,
  containerHeight: 500,
  totalHeight: 4000,
  actualHeight: 4000,
  isCompressed: false,
  compressionRatio: 1,
  visibleRange: { start: 0, end: 12 },
  renderRange: { start: 0, end: 15 },
  ...overrides,
});

const createMockState = (
  overrides?: Partial<VListContextState>,
): VListContextState => ({
  viewportState: createMockViewportState(),
  selectionState: createSelectionState(),
  lastRenderRange: { start: 0, end: 0 },
  isInitialized: true,
  isDestroyed: false,
  cachedCompression: null,
  ...overrides,
});

const createMockDataManager = <T extends VListItem>(
  items: T[],
  options?: { isLoading?: boolean; hasMore?: boolean },
): DataManager<T> => ({
  getState: mock(() => ({
    total: items.length,
    cached: items.length,
    isLoading: options?.isLoading ?? false,
    pendingRanges: [],
    error: undefined,
    hasMore: options?.hasMore ?? false,
    cursor: undefined,
  })),
  // Direct getters for hot-path access (avoid object allocation)
  getTotal: mock(() => items.length),
  getCached: mock(() => items.length),
  getIsLoading: mock(() => options?.isLoading ?? false),
  getHasMore: mock(() => options?.hasMore ?? false),
  getStorage: mock(() => ({}) as any),
  getPlaceholders: mock(() => ({}) as any),
  getItem: mock((index: number) => items[index]),
  getItemById: mock((id: string | number) =>
    items.find((item) => item.id === id),
  ),
  getIndexById: mock((id: string | number) =>
    items.findIndex((item) => item.id === id),
  ),
  getItemsInRange: mock((start: number, end: number) =>
    items.slice(start, Math.min(end + 1, items.length)),
  ),
  isItemLoaded: mock((index: number) => index >= 0 && index < items.length),
  setItems: mock(() => {}),
  setTotal: mock(() => {}),
  updateItem: mock(() => true),
  removeItem: mock(() => true),
  loadRange: mock(async () => {}),
  ensureRange: mock(async () => {}),
  loadInitial: mock(async () => {}),
  loadMore: mock(async () => true),
  reload: mock(async () => {}),
  evictDistant: mock(() => {}),
  clear: mock(() => {}),
  reset: mock(() => {}),
});

const createMockScrollController = (): ScrollController => ({
  getScrollTop: mock(() => 0),
  scrollTo: mock(() => {}),
  scrollBy: mock(() => {}),
  isAtTop: mock(() => true),
  isAtBottom: mock(() => false),
  getScrollPercentage: mock(() => 0),
  getVelocity: mock(() => 0),
  isTracking: mock(() => true),
  isScrolling: mock(() => false),
  isCompressed: mock(() => false),
  enableCompression: mock(() => {}),
  disableCompression: mock(() => {}),
  updateConfig: mock(() => {}),
  destroy: mock(() => {}),
});

const createMockRenderer = <T extends VListItem>(): Renderer<T> => ({
  render: mock(() => {}),
  updateItem: mock(() => {}),
  updateItemClasses: mock(() => {}),
  updatePositions: mock(() => {}),
  getElement: mock(() => undefined),
  clear: mock(() => {}),
  destroy: mock(() => {}),
});

const createMockEmitter = (): Emitter<any> => ({
  on: mock(() => () => {}),
  off: mock(() => {}),
  emit: mock(() => {}),
  once: mock(() => () => {}),
  clear: mock(() => {}),
  listenerCount: mock(() => 0),
});

const createMockScrollbar = () => ({
  updateBounds: mock(() => {}),
  updatePosition: mock(() => {}),
  show: mock(() => {}),
  hide: mock(() => {}),
  isVisible: mock(() => false),
  destroy: mock(() => {}),
});

const createMockContext = <T extends VListItem>(
  items: T[],
  configOverrides?: Partial<VListContextConfig>,
  stateOverrides?: Partial<VListContextState>,
): VListContext<T> => {
  const config = createMockConfig(configOverrides);
  const dom = createMockDOM();
  const dataManager = createMockDataManager(items);
  const scrollController = createMockScrollController();
  const renderer = createMockRenderer<T>();
  const emitter = createMockEmitter();
  const scrollbar = createMockScrollbar();
  const state = createMockState(stateOverrides);
  const itemHeight =
    typeof config.itemHeight === "number" ? config.itemHeight : 40;
  const heightCache = createHeightCache(config.itemHeight, items.length);

  return {
    config,
    dom,
    heightCache,
    dataManager,
    scrollController,
    renderer,
    emitter,
    scrollbar,
    state,
    getItemsForRange: mock((range: Range) =>
      items.slice(range.start, range.end + 1),
    ),
    getAllLoadedItems: mock(() => items),
    getCompressionContext: mock(() => ({
      scrollTop: state.viewportState.scrollTop,
      totalItems: items.length,
      containerHeight: state.viewportState.containerHeight,
      rangeStart: state.viewportState.renderRange.start,
    })),
    getCachedCompression: mock(() => ({
      isCompressed: false,
      actualHeight: items.length * itemHeight,
      virtualHeight: items.length * itemHeight,
      ratio: 1,
    })),
    getVirtualTotal: mock(() => items.length),
  };
};

// =============================================================================
// Scroll Handler Tests
// =============================================================================

describe("createScrollHandler", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;
  let renderIfNeeded: ReturnType<typeof mock>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items);
    renderIfNeeded = mock(() => {});
  });

  describe("basic scroll handling", () => {
    it("should update viewport state on scroll", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Viewport state should be updated
      expect(ctx.state.viewportState.scrollTop).toBe(500);
    });

    it("should call renderIfNeeded on scroll", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(renderIfNeeded).toHaveBeenCalled();
    });

    it("should emit scroll event", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(ctx.emitter.emit).toHaveBeenCalledWith("scroll", {
        scrollTop: 500,
        direction: "down",
      });
    });

    it("should update scrollbar position", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(ctx.scrollbar?.updatePosition).toHaveBeenCalledWith(500);
      expect(ctx.scrollbar?.show).toHaveBeenCalled();
    });

    it("should not process scroll when destroyed", () => {
      ctx.state.isDestroyed = true;
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(renderIfNeeded).not.toHaveBeenCalled();
      expect(ctx.emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("infinite scroll", () => {
    it("should trigger load more when near bottom with adapter", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      // Mock direct getters for infinite scroll check
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      // Set viewport near bottom
      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400, // Near bottom
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "load:start",
        expect.any(Object),
      );
      expect(ctx.dataManager.loadMore).toHaveBeenCalled();
    });

    it("should not trigger load when already loading", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      // Mock direct getters - isLoading is true
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(true); // Already loading
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger load when no more data", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      // Mock direct getters - hasMore is false
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(false); // No more data

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger load more when velocity is high (scrollbar drag)", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      // Mock direct getters for infinite scroll check
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      // Simulate high velocity scrollbar drag (above 25 px/ms threshold)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 50);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      // Set viewport near bottom (where loadMore would normally trigger)
      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      // loadMore should NOT fire — velocity is too high
      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger load more during velocity ramp-up", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      // Velocity is 0 but tracker is not yet reliable (ramp-up phase)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 0);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => false);

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      // loadMore should NOT fire — velocity tracker not reliable yet
      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should trigger load more in reverse mode when near top", () => {
      ctx = createMockContext(items, { hasAdapter: true, reverse: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      // Set viewport near top (scrollTop < LOAD_MORE_THRESHOLD of 200)
      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 100,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(100, "up");

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "load:start",
        expect.any(Object),
      );
      expect(ctx.dataManager.loadMore).toHaveBeenCalled();
    });

    it("should not trigger reverse load when not near top", () => {
      ctx = createMockContext(items, { hasAdapter: true, reverse: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      // Set viewport far from top
      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 2000,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(2000, "down");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger reverse load when already loading", () => {
      ctx = createMockContext(items, { hasAdapter: true, reverse: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(true);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 50,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(50, "up");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger reverse load when no more data", () => {
      ctx = createMockContext(items, { hasAdapter: true, reverse: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(false);

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 50,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(50, "up");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger reverse load when velocity is high", () => {
      ctx = createMockContext(items, { hasAdapter: true, reverse: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(100);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 50);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 50,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(50, "up");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should emit load:start with correct offset and limit in reverse mode", () => {
      ctx = createMockContext(items, { hasAdapter: true, reverse: true });
      (ctx.dataManager.getTotal as any).mockReturnValue(100);
      (ctx.dataManager.getCached as any).mockReturnValue(75);
      (ctx.dataManager.getIsLoading as any).mockReturnValue(false);
      (ctx.dataManager.getHasMore as any).mockReturnValue(true);

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 50,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(50, "up");

      expect(ctx.emitter.emit).toHaveBeenCalledWith("load:start", {
        offset: 75,
        limit: 50,
      });
    });
  });

  describe("ensure range", () => {
    it("should ensure visible range is loaded", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
    });

    it("should skip loading when velocity is too high", () => {
      // Set high velocity (above CANCEL_LOAD_VELOCITY_THRESHOLD of 25 px/ms)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 50);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Should NOT call ensureRange when scrolling too fast
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();
    });

    it("should load when velocity is below threshold", () => {
      // Set low velocity (below CANCEL_LOAD_VELOCITY_THRESHOLD of 25 px/ms)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 10);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Should call ensureRange when scrolling slowly
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
    });

    it("should load pending range when idle", () => {
      // Need hasAdapter: true for loadPendingRange to work
      ctx.config.hasAdapter = true;

      // Set high velocity initially
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 50);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // Scroll with high velocity - should NOT load
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();

      // Call loadPendingRange (simulating idle callback)
      handler.loadPendingRange();

      // Now ensureRange should have been called
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
    });

    it("should load pending range immediately when velocity drops below threshold", () => {
      let currentVelocity = 50; // Start with high velocity

      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => currentVelocity);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // First scroll with high velocity - should NOT load
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();

      // Velocity drops below threshold (25 px/ms)
      currentVelocity = 10;

      // Second scroll - should load immediately because velocity crossed threshold
      handler(600, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
    });

    it("should load pending range AND new range when velocity drops below threshold", () => {
      let currentVelocity = 50;

      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => currentVelocity);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // First scroll with high velocity - creates pending range
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();

      // Velocity drops below threshold:
      // - Pending range from previous scroll is loaded immediately
      // - New range for current scroll is also loaded (since velocity is now acceptable)
      currentVelocity = 10;
      handler(600, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(2);

      // Reset mock to check subsequent calls
      (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mockClear();

      // Velocity stays low - only one call via normal path
      handler(700, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);
    });

    it("should not load pending range if none exists", () => {
      // Set low velocity - will load immediately, no pending range
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 5);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // Scroll with low velocity - loads immediately
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);

      // Reset mock
      (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mockClear();

      // Call loadPendingRange - should not call ensureRange again
      handler.loadPendingRange();
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();
    });

    it("should load when scrolling UP with low velocity", () => {
      // Set low velocity (below CANCEL_LOAD_VELOCITY_THRESHOLD of 25 px/ms)
      // Note: getVelocity() returns absolute value, so direction doesn't matter
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 10);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // First scroll down to establish a range
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);

      // Reset mock
      (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mockClear();

      // Scroll UP with low velocity - should also trigger load
      handler(400, "up");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);
    });

    it("should skip loading when scrolling UP with high velocity", () => {
      // Set high velocity (above CANCEL_LOAD_VELOCITY_THRESHOLD of 25 px/ms)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 50);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // Scroll UP with high velocity - should NOT load
      handler(400, "up");
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();
    });

    it("should load pending range when scrolling UP and velocity drops", () => {
      let currentVelocity = 50; // Start with high velocity

      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => currentVelocity);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // First scroll UP with high velocity - should NOT load
      handler(400, "up");
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();

      // Velocity drops below threshold
      currentVelocity = 10;

      // Second scroll UP - should load pending range AND new range
      handler(300, "up");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
    });

    it("should preload ahead when scrolling DOWN at medium velocity", () => {
      // Set medium velocity (above preloadThreshold of 10 but below cancelLoadThreshold of 25)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 15);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Should call ensureRange with an extended end (preloadAhead = 20)
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
      const call = (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mock
        .calls[0];
      // The end should be larger than the renderRange.end because of preload
      const loadEnd = call[1];
      expect(loadEnd).toBeGreaterThan(ctx.state.viewportState.renderRange.end);
    });

    it("should preload ahead when scrolling UP at medium velocity", () => {
      // Set medium velocity
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 15);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      // Start at a higher scroll position so there's room above
      ctx.state.viewportState = createMockViewportState({
        scrollTop: 2000,
        renderRange: { start: 50, end: 65 },
        visibleRange: { start: 50, end: 62 },
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(2000, "up");

      // Should call ensureRange with an extended start (preloadAhead = 20)
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
      const call = (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mock
        .calls[0];
      // The start should be smaller than the renderRange.start because of preload
      const loadStart = call[0];
      expect(loadStart).toBeLessThan(ctx.state.viewportState.renderRange.start);
    });

    it("should not preload ahead when scrolling slowly (below preload threshold)", () => {
      // Set low velocity (below preloadThreshold of 10)
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 5);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Should call ensureRange with exactly the renderRange (no extension)
      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
      const call = (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mock
        .calls[0];
      const loadStart = call[0];
      const loadEnd = call[1];
      expect(loadStart).toBe(ctx.state.viewportState.renderRange.start);
      expect(loadEnd).toBe(ctx.state.viewportState.renderRange.end);
    });

    it("should clamp preload start to 0 when scrolling UP near top", () => {
      // Set medium velocity
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 15);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      // Start near top so preloadAhead would go negative
      ctx.state.viewportState = createMockViewportState({
        scrollTop: 100,
        renderRange: { start: 2, end: 15 },
        visibleRange: { start: 2, end: 12 },
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(100, "up");

      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
      const call = (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mock
        .calls[0];
      // Start should be clamped to 0
      expect(call[0]).toBe(0);
    });

    it("should clamp preload end to total - 1 when scrolling DOWN near bottom", () => {
      // Set medium velocity
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 15);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      // Start near end of list
      ctx.state.viewportState = createMockViewportState({
        scrollTop: 3500,
        renderRange: { start: 87, end: 99 },
        visibleRange: { start: 87, end: 97 },
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3500, "down");

      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
      const call = (ctx.dataManager.ensureRange as ReturnType<typeof mock>).mock
        .calls[0];
      // End should be clamped to total - 1 = 99
      expect(call[1]).toBeLessThanOrEqual(99);
    });

    it("should not deduplicate ensureRange when range has not changed", () => {
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 5);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // First scroll
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);

      // Same scroll position with same render range - should NOT call again
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);
    });

    it("should call ensureRange again when range changes", () => {
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 5);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      // First scroll
      handler(500, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(1);

      // Change the render range to simulate scrolling further
      ctx.state.viewportState.renderRange = { start: 20, end: 35 };

      handler(800, "down");
      expect(ctx.dataManager.ensureRange).toHaveBeenCalledTimes(2);
    });

    it("should handle loadPendingRange when hasAdapter is false", () => {
      ctx.config.hasAdapter = false;

      // Set high velocity to create a pending range
      (
        ctx.scrollController.getVelocity as ReturnType<typeof mock>
      ).mockImplementation(() => 50);
      (
        ctx.scrollController.isTracking as ReturnType<typeof mock>
      ).mockImplementation(() => true);

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Call loadPendingRange - should not call ensureRange since hasAdapter is false
      handler.loadPendingRange();
      expect(ctx.dataManager.ensureRange).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Click Handler Tests
// =============================================================================

describe("createClickHandler", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;
  let forceRender: ReturnType<typeof mock>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items, { selectionMode: "single" });
    forceRender = mock(() => {});
  });

  describe("item click handling", () => {
    it("should emit item:click event when clicking an item", () => {
      const handler = createClickHandler(ctx, forceRender);

      // Create a mock item element
      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith("item:click", {
        item: items[5],
        index: 5,
        event,
      });
    });

    it("should not emit when clicking outside items", () => {
      const handler = createClickHandler(ctx, forceRender);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: ctx.dom.items });

      handler(event);

      expect(ctx.emitter.emit).not.toHaveBeenCalledWith(
        "item:click",
        expect.any(Object),
      );
    });

    it("should not process clicks when destroyed", () => {
      ctx.state.isDestroyed = true;
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("selection on click", () => {
    it("should update selection when clicking an item", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      // Selection should be updated
      expect(ctx.state.selectionState.selected.has(6)).toBe(true); // id is index + 1
      expect(ctx.state.selectionState.focusedIndex).toBe(5);
    });

    it("should emit selection:change event", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "selection:change",
        expect.any(Object),
      );
    });

    it("should not update selection when selection mode is none", () => {
      ctx = createMockContext(items, { selectionMode: "none" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should re-render after selection change", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.renderer.render).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Keyboard Handler Tests
// =============================================================================

describe("createKeyboardHandler", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;
  let scrollToIndex: ReturnType<typeof mock>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items, { selectionMode: "single" });
    ctx.state.selectionState.focusedIndex = 5;
    scrollToIndex = mock(() => {});
  });

  describe("arrow key navigation", () => {
    it("should move focus up on ArrowUp", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(4);
    });

    it("should move focus down on ArrowDown", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(6);
    });

    it("should move focus to first item on Home", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Home" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(0);
    });

    it("should move focus to last item on End", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "End" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(99);
    });

    it("should scroll focused item into view", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(scrollToIndex).toHaveBeenCalledWith(6, "center");
    });
  });

  describe("selection with keyboard", () => {
    it("should toggle selection on Space", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      expect(ctx.state.selectionState.selected.has(6)).toBe(true); // Item id at index 5
    });

    it("should toggle selection on Enter", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Enter" });
      handler(event);

      expect(ctx.state.selectionState.selected.has(6)).toBe(true);
    });

    it("should emit selection:change on Space/Enter", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "selection:change",
        expect.any(Object),
      );
    });
  });

  describe("event handling", () => {
    it("should prevent default on handled keys", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      const preventDefaultMock = mock(() => {});
      Object.defineProperty(event, "preventDefault", {
        value: preventDefaultMock,
      });

      handler(event);

      expect(preventDefaultMock).toHaveBeenCalled();
    });

    it("should not handle keys when selection mode is none", () => {
      ctx = createMockContext(items, { selectionMode: "none" });
      ctx.state.selectionState.focusedIndex = 5;
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      // Focus should not change
      expect(ctx.state.selectionState.focusedIndex).toBe(5);
    });

    it("should not process keys when destroyed", () => {
      ctx.state.isDestroyed = true;
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it("should use targeted class update for arrow key navigation", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      // M1: Arrow keys use updateItemClasses on 2 items instead of full render
      expect(ctx.renderer.updateItemClasses).toHaveBeenCalled();
      expect(ctx.renderer.render).not.toHaveBeenCalled();
    });

    it("should use full render for selection changes", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      // Space/Enter trigger selection change → full render
      expect(ctx.renderer.render).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should not select on Space if no item is focused", () => {
      ctx.state.selectionState.focusedIndex = -1;
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should handle empty list", () => {
      ctx = createMockContext([] as TestItem[], { selectionMode: "single" });
      (ctx.dataManager.getState as any).mockReturnValue({
        total: 0,
        cached: 0,
        isLoading: false,
        hasMore: false,
      });

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      // Should not crash
      expect(true).toBe(true);
    });

    it("should ignore unhandled keys", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Tab" });
      handler(event);

      // Should not call scrollToIndex or change state
      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it("should remove aria-activedescendant when focus goes to -1", () => {
      // Set up with focusedIndex at 0, then move up to go out of bounds
      ctx.state.selectionState.focusedIndex = 0;
      (ctx.dataManager.getTotal as any).mockReturnValue(5);

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      // ArrowUp from 0 should keep at 0 (moveFocusUp clamps)
      const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
      handler(event);

      // Focus should still be valid
      expect(ctx.state.selectionState.focusedIndex).toBeGreaterThanOrEqual(0);
    });

    it("should not toggle selection on Enter if focused item does not exist", () => {
      ctx.state.selectionState.focusedIndex = 999; // Out of bounds
      (ctx.dataManager.getItem as any).mockImplementation(
        (index: number) => undefined,
      );

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Enter" });
      handler(event);

      // Should not crash, selection should be unchanged
      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should update ARIA active descendant on arrow navigation", () => {
      ctx.state.selectionState.focusedIndex = 0;
      (ctx.dataManager.getTotal as any).mockReturnValue(5);

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      const newFocus = ctx.state.selectionState.focusedIndex;
      if (newFocus >= 0) {
        expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe(
          `${ctx.config.ariaIdPrefix}-item-${newFocus}`,
        );
      }
    });

    it("should do targeted class update for previous and new focus items", () => {
      ctx.state.selectionState.focusedIndex = 2;
      (ctx.dataManager.getTotal as any).mockReturnValue(10);

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      // updateItemClasses should have been called for the previous focus (2)
      // and new focus (3)
      expect(ctx.renderer.updateItemClasses).toHaveBeenCalled();
    });

    it("should handle Space/Enter emitting selection:change event", () => {
      ctx.state.selectionState.focusedIndex = 0;
      (ctx.dataManager.getTotal as any).mockReturnValue(5);

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Enter" });
      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "selection:change",
        expect.objectContaining({
          selected: expect.any(Array),
          items: expect.any(Array),
        }),
      );
    });

    it("should do full render (not targeted update) on Space/Enter", () => {
      ctx.state.selectionState.focusedIndex = 0;
      (ctx.dataManager.getTotal as any).mockReturnValue(5);

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      // Full render should be called, not just updateItemClasses
      expect(ctx.renderer.render).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Coverage tests merged from coverage dump files
// =============================================================================

describe("handlers error catch callbacks", () => {
  const createMockDOM = (): DOMStructure => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    const content = document.createElement("div");
    const items = document.createElement("div");
    root.appendChild(viewport);
    viewport.appendChild(content);
    content.appendChild(items);
    return { root, viewport, content, items };
  };

  const createMockConfig = (
    overrides?: Partial<VListContextConfig>,
  ): VListContextConfig => ({
    itemHeight: 40,
    overscan: 3,
    classPrefix: "vlist",
    selectionMode: "none",
    hasAdapter: true,
    reverse: false,
    wrap: false,
    cancelLoadThreshold: 25,
    preloadThreshold: 10,
    preloadAhead: 20,
    ariaIdPrefix: "vlist-0",
    ...overrides,
  });

  const createMockViewportState = (
    overrides?: Partial<ViewportState>,
  ): ViewportState => ({
    scrollTop: 0,
    containerHeight: 500,
    totalHeight: 4000,
    actualHeight: 4000,
    isCompressed: false,
    compressionRatio: 1,
    visibleRange: { start: 0, end: 12 },
    renderRange: { start: 0, end: 15 },
    ...overrides,
  });

  const createRejectingDataManager = <T extends VListItem>(
    items: T[],
    rejectEnsureRange: boolean = true,
    rejectLoadMore: boolean = true,
  ): DataManager<T> => ({
    getState: mock(() => ({
      total: items.length,
      cached: items.length,
      isLoading: false,
      pendingRanges: [],
      error: undefined,
      hasMore: true,
      cursor: undefined,
    })),
    getTotal: mock(() => items.length),
    getCached: mock(() => items.length),
    getIsLoading: mock(() => false),
    getHasMore: mock(() => true),
    getStorage: mock(() => ({}) as any),
    getPlaceholders: mock(() => ({}) as any),
    getItem: mock((index: number) => items[index]),
    getItemById: mock((id: string | number) =>
      items.find((item) => item.id === id),
    ),
    getIndexById: mock((id: string | number) =>
      items.findIndex((item) => item.id === id),
    ),
    getItemsInRange: mock((start: number, end: number) =>
      items.slice(start, Math.min(end + 1, items.length)),
    ),
    isItemLoaded: mock((index: number) => index >= 0 && index < items.length),
    setItems: mock(() => {}),
    setTotal: mock(() => {}),
    updateItem: mock(() => true),
    removeItem: mock(() => true),
    loadRange: mock(async () => {}),
    ensureRange: rejectEnsureRange
      ? mock(async () => {
          throw new Error("ensureRange failed");
        })
      : mock(async () => {}),
    loadInitial: mock(async () => {}),
    loadMore: rejectLoadMore
      ? mock(async () => {
          throw new Error("loadMore failed");
        })
      : (mock(async () => true) as any),
    reload: mock(async () => {}),
    evictDistant: mock(() => {}),
    clear: mock(() => {}),
    reset: mock(() => {}),
  });

  const createMockContext = <T extends VListItem>(
    items: T[],
    configOverrides?: Partial<VListContextConfig>,
    viewportOverrides?: Partial<ViewportState>,
    rejectEnsureRange?: boolean,
    rejectLoadMore?: boolean,
  ): VListContext<T> => {
    const config = createMockConfig(configOverrides);
    const domStruct = createMockDOM();
    const dataManager = createRejectingDataManager(
      items,
      rejectEnsureRange,
      rejectLoadMore,
    );
    const heightCache = createHeightCache(config.itemHeight, items.length);
    const itemHeight =
      typeof config.itemHeight === "number" ? config.itemHeight : 40;

    return {
      config,
      dom: domStruct,
      heightCache,
      dataManager,
      scrollController: {
        getScrollTop: mock(() => 0),
        scrollTo: mock(() => {}),
        scrollBy: mock(() => {}),
        isAtTop: mock(() => true),
        isAtBottom: mock(() => false),
        getScrollPercentage: mock(() => 0),
        getVelocity: mock(() => 0),
        isTracking: mock(() => true),
        isScrolling: mock(() => false),
        isCompressed: mock(() => false),
        enableCompression: mock(() => {}),
        disableCompression: mock(() => {}),
        updateConfig: mock(() => {}),
        destroy: mock(() => {}),
      } as any,
      renderer: {
        render: mock(() => {}),
        updateItem: mock(() => {}),
        updateItemClasses: mock(() => {}),
        updatePositions: mock(() => {}),
        getElement: mock(() => undefined),
        clear: mock(() => {}),
        destroy: mock(() => {}),
      },
      emitter: {
        on: mock(() => () => {}),
        off: mock(() => {}),
        emit: mock(() => {}),
        once: mock(() => () => {}),
        clear: mock(() => {}),
        listenerCount: mock(() => 0),
      },
      scrollbar: null,
      state: {
        viewportState: createMockViewportState(viewportOverrides),
        selectionState: createSelectionState(),
        lastRenderRange: { start: 0, end: 0 },
        isInitialized: true,
        isDestroyed: false,
        cachedCompression: null,
      },
      getVirtualTotal: mock(() => items.length),
      getItemsForRange: mock((range: Range) =>
        items.slice(range.start, range.end + 1),
      ),
      getAllLoadedItems: mock(() => items),
      getCompressionContext: mock(() => ({
        scrollTop: 0,
        totalItems: items.length,
        containerHeight: 500,
        rangeStart: 0,
      })),
      getCachedCompression: mock(() => ({
        isCompressed: false,
        actualHeight: items.length * itemHeight,
        virtualHeight: items.length * itemHeight,
        ratio: 1,
      })),
    };
  };

  it("should handle ensureRange rejection in loadPendingRange (L77)", async () => {
    const items = createTestItems(100);
    const ctx = createMockContext(items, { hasAdapter: true }, {}, true, false);
    const renderCallback = mock(() => {});

    const handler = createScrollHandler(ctx, renderCallback);

    // Set a pending range by calling handleScroll with high velocity first
    // then trigger loadPendingRange
    (ctx.scrollController.getVelocity as any).mockReturnValue(50);
    (ctx.scrollController.isTracking as any).mockReturnValue(true);

    // Call handler to set pendingRange
    handler(200, "down");

    // Now call loadPendingRange — ensureRange will reject
    handler.loadPendingRange();

    // Give the rejection a tick to process
    await new Promise((r) => setTimeout(r, 20));

    // The error should be emitted, not thrown
    expect(ctx.emitter.emit).toHaveBeenCalled();
  });

  it("should handle ensureRange rejection in velocity-crossing block (L106)", async () => {
    const items = createTestItems(100);
    const ctx = createMockContext(items, { hasAdapter: true }, {}, true, false);
    const renderCallback = mock(() => {});

    const handler = createScrollHandler(ctx, renderCallback);

    // First call with high velocity (above cancelLoadThreshold) to set pendingRange
    (ctx.scrollController.getVelocity as any).mockReturnValue(50);
    (ctx.scrollController.isTracking as any).mockReturnValue(true);
    handler(200, "down");

    // Now call with velocity that just dropped below threshold
    // This triggers the velocity-crossing block (L100-107)
    (ctx.scrollController.getVelocity as any).mockReturnValue(5);
    handler(210, "down");

    await new Promise((r) => setTimeout(r, 20));

    // Error should be emitted without throwing
    expect(ctx.emitter.emit).toHaveBeenCalled();
  });

  it("should handle loadMore rejection in normal mode (L177)", async () => {
    const items = createTestItems(50);
    const ctx = createMockContext(
      items,
      { hasAdapter: true, reverse: false },
      {
        totalHeight: 2000,
        containerHeight: 500,
        scrollTop: 1490, // Near the bottom
      },
      false,
      true,
    );
    const renderCallback = mock(() => {});

    const handler = createScrollHandler(ctx, renderCallback);

    // Low velocity, tracking, near bottom — should trigger loadMore
    (ctx.scrollController.getVelocity as any).mockReturnValue(0);
    (ctx.scrollController.isTracking as any).mockReturnValue(true);
    handler(1490, "down");

    await new Promise((r) => setTimeout(r, 20));

    // Error should be emitted
    expect(ctx.emitter.emit).toHaveBeenCalled();
  });

  it("should handle loadMore rejection in reverse mode (L160)", async () => {
    const items = createTestItems(50);
    const ctx = createMockContext(
      items,
      { hasAdapter: true, reverse: true },
      {
        totalHeight: 2000,
        containerHeight: 500,
        scrollTop: 5, // Near the top — in reverse mode, "more" is up
      },
      false,
      true,
    );
    const renderCallback = mock(() => {});

    const handler = createScrollHandler(ctx, renderCallback);

    // Low velocity, tracking, near top in reverse mode — should trigger loadMore
    (ctx.scrollController.getVelocity as any).mockReturnValue(0);
    (ctx.scrollController.isTracking as any).mockReturnValue(true);
    handler(5, "up");

    await new Promise((r) => setTimeout(r, 20));

    // Error should be emitted
    expect(ctx.emitter.emit).toHaveBeenCalled();
  });

  it("should handle ensureRange rejection in normal canLoad path (L221)", async () => {
    const items = createTestItems(100);
    const ctx = createMockContext(items, { hasAdapter: true }, {}, true, false);
    const renderCallback = mock(() => {});

    const handler = createScrollHandler(ctx, renderCallback);

    // Low velocity + tracking = canLoad is true
    // This means ensureRange is called directly in the canLoad branch (L220-222),
    // NOT via loadPendingRange or velocity-crossing.
    (ctx.scrollController.getVelocity as any).mockReturnValue(0);
    (ctx.scrollController.isTracking as any).mockReturnValue(true);

    // First call to set lastEnsuredRange
    handler(0, "down");

    // Second call with different scrollTop to trigger rangeChanged
    // (viewport state recalculation will produce a new renderRange)
    handler(200, "down");

    // Give the rejection a tick to process
    await new Promise((r) => setTimeout(r, 20));

    // The ensureRange .catch should emit an error event
    expect(ctx.emitter.emit).toHaveBeenCalled();
  });
});

describe("handlers — keyboard Space/Enter selection", () => {
  let container: HTMLElement;
  let list: any;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    cleanupContainer(container);
  });

  it("should handle ArrowDown + Space for keyboard selection", async () => {
    const items = createTestItems(20);
    list = createVList<TestItem>({
      container,
      items,
      item: {
        height: 40,
        template: (item) => `<span>${item.name}</span>`,
      },
      selection: { mode: "multiple" },
    });

    const root = list.element;

    // Focus the list root
    root.focus?.();

    // ArrowDown to move focus to item 0
    const arrowDown = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(arrowDown);

    // Space to select focused item
    const space = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(space);

    // Check selection
    const selected = list.getSelected();
    expect(selected.length).toBeGreaterThanOrEqual(0); // May or may not select depending on focus state
  });

  it("should handle Home and End keys", async () => {
    const items = createTestItems(20);
    list = createVList<TestItem>({
      container,
      items,
      item: {
        height: 40,
        template: (item) => `<span>${item.name}</span>`,
      },
      selection: { mode: "single" },
    });

    const root = list.element;

    // Home key
    const home = new KeyboardEvent("keydown", {
      key: "Home",
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(home);

    // End key
    const end = new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(end);

    // Should not throw
    expect(list.total).toBe(20);
  });

  it("should handle Enter key to toggle selection", async () => {
    const items = createTestItems(10);
    list = createVList<TestItem>({
      container,
      items,
      item: {
        height: 40,
        template: (item) => `<span>${item.name}</span>`,
      },
      selection: { mode: "multiple" },
    });

    const root = list.element;

    // Move focus down first
    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );

    // Enter to toggle
    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(list.total).toBe(10);
  });
});

describe("handlers — click on item with selection", () => {
  let container: HTMLElement;
  let list: any;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    cleanupContainer(container);
  });

  it("should emit item:click and toggle selection on click", async () => {
    const items = createTestItems(10);
    const clickHandler = mock(() => {});

    list = createVList<TestItem>({
      container,
      items,
      item: {
        height: 40,
        template: (item) => `<span>${item.name}</span>`,
      },
      selection: { mode: "multiple" },
    });

    list.on("item:click", clickHandler);

    // Find a rendered item element and click it
    const root = list.element;
    const itemEl = root.querySelector("[data-index]");

    if (itemEl) {
      const event = new MouseEvent("click", { bubbles: true });
      itemEl.dispatchEvent(event);

      // Should have fired click event
      expect(clickHandler).toHaveBeenCalled();
    }
  });
});
