/**
 * vlist - Context Tests
 * Tests for VListContext - the state container that wires all domains together
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
  createContext,
  type VListContext,
  type VListContextConfig,
  type VListContextState,
} from "../src/context";
import { createSelectionState } from "../src/selection";
import type { VListItem, Range, ViewportState } from "../src/types";
import type { DataManager } from "../src/data";
import type { ScrollController } from "../src/scroll";
import type { Emitter } from "../src/events";
import type { Renderer, DOMStructure, CompressionContext } from "../src/render";
import { createHeightCache, type HeightCache } from "../src/render/heights";

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
  ...overrides,
});

const createMockDOM = (): DOMStructure => ({
  root: document.createElement("div"),
  viewport: document.createElement("div"),
  content: document.createElement("div"),
  items: document.createElement("div"),
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

const createMockState = (
  overrides?: Partial<VListContextState>,
): VListContextState => ({
  viewportState: createMockViewportState(),
  selectionState: createSelectionState(),
  lastRenderRange: { start: 0, end: 0 },
  isInitialized: false,
  isDestroyed: false,
  cachedCompression: null,
  ...overrides,
});

const createMockDataManager = <T extends VListItem>(
  items: T[],
): DataManager<T> => ({
  getState: mock(() => ({
    total: items.length,
    cached: items.length,
    isLoading: false,
    pendingRanges: [],
    error: undefined,
    hasMore: false,
    cursor: undefined,
  })),
  // Direct getters for hot-path access (avoid object allocation)
  getTotal: mock(() => items.length),
  getCached: mock(() => items.length),
  getIsLoading: mock(() => false),
  getHasMore: mock(() => false),
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
    items.slice(start, end + 1),
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
  isCompressed: mock(() => false),
  enableCompression: mock(() => {}),
  disableCompression: mock(() => {}),
  updateConfig: mock(() => {}),
  destroy: mock(() => {}),
});

const createMockRenderer = <T extends VListItem>(): Renderer<T> => ({
  render: mock(() => {}),
  updateItem: mock(() => {}),
  updatePositions: mock(() => {}),
  getElement: mock(() => undefined),
  clear: mock(() => {}),
  destroy: mock(() => {}),
});

const createMockEmitter = <
  T extends Record<string, unknown>,
>(): Emitter<T> => ({
  on: mock(() => () => {}),
  off: mock(() => {}),
  emit: mock(() => {}),
  once: mock(() => () => {}),
  clear: mock(() => {}),
  listenerCount: mock(() => 0),
});

// =============================================================================
// Tests
// =============================================================================

describe("createContext", () => {
  let items: TestItem[];
  let config: VListContextConfig;
  let dom: DOMStructure;
  let heightCache: HeightCache;
  let dataManager: DataManager<TestItem>;
  let scrollController: ScrollController;
  let renderer: Renderer<TestItem>;
  let emitter: Emitter<any>;
  let initialState: VListContextState;

  beforeEach(() => {
    items = createTestItems(100);
    config = createMockConfig();
    dom = createMockDOM();
    heightCache = createHeightCache(config.itemHeight, items.length);
    dataManager = createMockDataManager(items);
    scrollController = createMockScrollController();
    renderer = createMockRenderer();
    emitter = createMockEmitter();
    initialState = createMockState();
  });

  describe("initialization", () => {
    it("should create context with all components", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx).toBeDefined();
      expect(ctx.config).toBe(config);
      expect(ctx.dom).toBe(dom);
      expect(ctx.dataManager).toBe(dataManager);
      expect(ctx.scrollController).toBe(scrollController);
      expect(ctx.renderer).toBe(renderer);
      expect(ctx.emitter).toBe(emitter);
      expect(ctx.scrollbar).toBeNull();
      expect(ctx.state).toBe(initialState);
    });

    it("should create context with scrollbar", () => {
      const mockScrollbar = {
        updateBounds: mock(() => {}),
        updatePosition: mock(() => {}),
        show: mock(() => {}),
        hide: mock(() => {}),
        isVisible: mock(() => false),
        destroy: mock(() => {}),
      };

      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        mockScrollbar,
        initialState,
      );

      expect(ctx.scrollbar).toBe(mockScrollbar);
    });

    it("should expose immutable config", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx.config.itemHeight).toBe(40);
      expect(ctx.config.overscan).toBe(3);
      expect(ctx.config.classPrefix).toBe("vlist");
      expect(ctx.config.selectionMode).toBe("none");
      expect(ctx.config.hasAdapter).toBe(false);
    });
  });

  describe("getItemsForRange", () => {
    it("should return items for the specified range", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const range: Range = { start: 5, end: 10 };
      const result = ctx.getItemsForRange(range);

      expect(dataManager.getItemsInRange).toHaveBeenCalledWith(5, 10);
      expect(result).toHaveLength(6);
    });

    it("should handle empty range", () => {
      const emptyDataManager = createMockDataManager<TestItem>([]);
      const ctx = createContext(
        config,
        dom,
        heightCache,
        emptyDataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const range: Range = { start: 0, end: 0 };
      ctx.getItemsForRange(range);

      expect(emptyDataManager.getItemsInRange).toHaveBeenCalledWith(0, 0);
    });
  });

  describe("getAllLoadedItems", () => {
    it("should return all loaded items", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const result = ctx.getAllLoadedItems();

      expect(dataManager.getItemsInRange).toHaveBeenCalledWith(0, 99);
      expect(result).toHaveLength(100);
    });

    it("should handle empty data", () => {
      const emptyDataManager = createMockDataManager<TestItem>([]);
      (emptyDataManager.getState as any).mockReturnValue({
        total: 0,
        cached: 0,
        isLoading: false,
        hasMore: false,
      });

      const ctx = createContext(
        config,
        dom,
        heightCache,
        emptyDataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      ctx.getAllLoadedItems();

      expect(emptyDataManager.getItemsInRange).toHaveBeenCalledWith(0, -1);
    });
  });

  describe("getCompressionContext", () => {
    it("should return compression context from current state", () => {
      const viewportState = createMockViewportState({
        scrollTop: 1000,
        containerHeight: 600,
        renderRange: { start: 25, end: 40 },
      });

      const state = createMockState({ viewportState });

      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        state,
      );

      const compressionCtx = ctx.getCompressionContext();

      expect(compressionCtx.scrollTop).toBe(1000);
      expect(compressionCtx.totalItems).toBe(100);
      expect(compressionCtx.containerHeight).toBe(600);
      expect(compressionCtx.rangeStart).toBe(25);
    });

    it("should reflect current total items", () => {
      const smallDataManager = createMockDataManager(createTestItems(50));
      (smallDataManager.getState as any).mockReturnValue({
        total: 50,
        cached: 50,
        isLoading: false,
        hasMore: false,
      });

      const ctx = createContext(
        config,
        dom,
        heightCache,
        smallDataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const compressionCtx = ctx.getCompressionContext();

      expect(compressionCtx.totalItems).toBe(50);
    });
  });

  describe("state mutability", () => {
    it("should allow state to be updated", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx.state.isInitialized).toBe(false);

      ctx.state.isInitialized = true;
      expect(ctx.state.isInitialized).toBe(true);
    });

    it("should allow viewportState to be replaced", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const newViewportState = createMockViewportState({
        scrollTop: 500,
        visibleRange: { start: 12, end: 24 },
      });

      ctx.state.viewportState = newViewportState;

      expect(ctx.state.viewportState.scrollTop).toBe(500);
      expect(ctx.state.viewportState.visibleRange.start).toBe(12);
    });

    it("should allow selectionState to be replaced", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const newSelectionState = createSelectionState([1, 2, 3]);
      ctx.state.selectionState = newSelectionState;

      expect(ctx.state.selectionState.selected.size).toBe(3);
      expect(ctx.state.selectionState.selected.has(1)).toBe(true);
    });

    it("should allow lastRenderRange to be updated", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      ctx.state.lastRenderRange = { start: 10, end: 25 };

      expect(ctx.state.lastRenderRange.start).toBe(10);
      expect(ctx.state.lastRenderRange.end).toBe(25);
    });

    it("should allow isDestroyed to be set", () => {
      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      ctx.state.isDestroyed = true;

      expect(ctx.state.isDestroyed).toBe(true);
    });
  });

  describe("config variations", () => {
    it("should handle different selection modes", () => {
      const singleConfig = createMockConfig({ selectionMode: "single" });
      const multiConfig = createMockConfig({ selectionMode: "multiple" });

      const singleCtx = createContext(
        singleConfig,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      const multiCtx = createContext(
        multiConfig,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(singleCtx.config.selectionMode).toBe("single");
      expect(multiCtx.config.selectionMode).toBe("multiple");
    });

    it("should handle adapter configuration", () => {
      const adapterConfig = createMockConfig({ hasAdapter: true });

      const ctx = createContext(
        adapterConfig,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx.config.hasAdapter).toBe(true);
    });

    it("should handle custom class prefix", () => {
      const customConfig = createMockConfig({ classPrefix: "custom-list" });

      const ctx = createContext(
        customConfig,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx.config.classPrefix).toBe("custom-list");
    });

    it("should handle different item heights", () => {
      const tallConfig = createMockConfig({ itemHeight: 80 });

      const tallHeightCache = createHeightCache(
        tallConfig.itemHeight,
        items.length,
      );
      const ctx = createContext(
        tallConfig,
        dom,
        tallHeightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx.config.itemHeight).toBe(80);
    });

    it("should handle different overscan values", () => {
      const largeOverscanConfig = createMockConfig({ overscan: 10 });

      const ctx = createContext(
        largeOverscanConfig,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        initialState,
      );

      expect(ctx.config.overscan).toBe(10);
    });
  });

  describe("compressed mode state", () => {
    it("should handle compressed viewport state", () => {
      const compressedViewportState = createMockViewportState({
        isCompressed: true,
        compressionRatio: 0.4,
        totalHeight: 16_000_000,
        actualHeight: 40_000_000,
      });

      const state = createMockState({ viewportState: compressedViewportState });

      const ctx = createContext(
        config,
        dom,
        heightCache,
        dataManager,
        scrollController,
        renderer,
        emitter,
        null,
        state,
      );

      expect(ctx.state.viewportState.isCompressed).toBe(true);
      expect(ctx.state.viewportState.compressionRatio).toBe(0.4);
    });
  });
});
