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
  beforeAll,
  afterAll,
} from "bun:test";
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
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
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
  });
});
