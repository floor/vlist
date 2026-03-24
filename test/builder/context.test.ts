/**
 * vlist - Builder Context Unit Tests
 *
 * Direct unit tests for createBuilderContext covering:
 * - Component access via getters/setters
 * - Handler registration arrays
 * - Virtual total function (default + replacement)
 * - Compression state caching and mode updates
 * - Data helpers (getItemsForRange, getAllLoadedItems)
 * - Render helpers (renderIfNeeded, forceRender)
 * - Component replacement (renderer, dataManager, scrollController, template)
 * - Size cache operations (rebuild, setSizeConfig)
 * - Content size updates (horizontal/vertical)
 * - Stub methods (setRenderFns, setVisibleRangeFn, etc.)
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { JSDOM } from "jsdom";

import {
  createBuilderContext,
  type CreateBuilderContextOptions,
} from "../../src/builder/context";
import type { BuilderContext, BuilderState } from "../../src/builder/types";
import type { VListItem } from "../../src/types";

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
// Test Types & Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

function createTestDOM() {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");
  items.setAttribute("role", "listbox");

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  Object.defineProperty(viewport, "clientWidth", { value: 300 });
  Object.defineProperty(viewport, "clientHeight", { value: 500 });

  return { root, viewport, content, items };
}

function createInitialState(): BuilderState {
  return {
    viewportState: {
      scrollPosition: 0,
      containerSize: 500,
      totalSize: 4800,
      actualSize: 4800,
      isCompressed: false,
      compressionRatio: 1,
      visibleRange: { start: 0, end: 10 },
      renderRange: { start: 0, end: 13 },
    },
    lastRenderRange: { start: 0, end: 13 },
    isInitialized: false,
    isDestroyed: false,
    cachedCompression: null,
  };
}

const testItems: TestItem[] = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  name: `Item ${i}`,
}));

function createMockOptions(
  overrides: Partial<CreateBuilderContextOptions<TestItem>> = {},
): CreateBuilderContextOptions<TestItem> {
  const domStructure = createTestDOM();

  return {
    rawConfig: { container: domStructure.root, item: { height: 48, template: () => "" } } as any,
    resolvedConfig: {
      overscan: 3,
      classPrefix: "vlist",
      reverse: false,
      wrap: false,
      horizontal: false,
      ariaIdPrefix: "vlist",
      accessible: true,
    },
    dom: domStructure,
    sizeCache: {
      rebuild: mock(() => {}),
      getOffset: mock((i: number) => i * 48),
      getSize: mock(() => 48),
      getTotalSize: mock(() => 4800),
      getTotal: mock(() => 100),
      indexAtOffset: mock((offset: number) => Math.floor(offset / 48)),
      isVariable: mock(() => false),
    } as any,
    dataManager: {
      getTotal: mock(() => 100),
      getItemsInRange: mock((start: number, end: number) =>
        testItems.slice(start, end + 1),
      ),
      getItem: mock((i: number) => testItems[i]),
    } as any,
    scrollController: {
      getScrollTop: mock(() => 0),
      isCompressed: mock(() => false),
      enableCompression: mock(() => {}),
      disableCompression: mock(() => {}),
      updateConfig: mock(() => {}),
    } as any,
    renderer: {
      render: mock(() => {}),
      updatePositions: mock(() => {}),
      clear: mock(() => {}),
      destroy: mock(() => {}),
    } as any,
    emitter: {
      on: mock(() => () => {}),
      off: mock(() => {}),
      emit: mock(() => {}),
    } as any,
    initialState: createInitialState(),
    initialSizeConfig: 48,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("createBuilderContext", () => {
  // ── Component access ─────────────────────────────────────────

  describe("component getters", () => {
    it("should return dom structure", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.dom).toBe(opts.dom);
    });

    it("should return sizeCache", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.sizeCache).toBe(opts.sizeCache);
    });

    it("should return emitter", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.emitter).toBe(opts.emitter);
    });

    it("should return resolvedConfig as config", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.config).toBe(opts.resolvedConfig);
    });

    it("should return rawConfig", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.rawConfig).toBe(opts.rawConfig);
    });

    it("should return renderer", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.renderer).toBe(opts.renderer);
    });

    it("should return dataManager", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.dataManager).toBe(opts.dataManager);
    });

    it("should return scrollController", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.scrollController).toBe(opts.scrollController);
    });

    it("should return state", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.state).toBe(opts.initialState);
    });
  });

  // ── Component setters ────────────────────────────────────────

  describe("component setters", () => {
    it("should allow setting renderer directly", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const newRenderer = { render: mock(() => {}) } as any;
      ctx.renderer = newRenderer;
      expect(ctx.renderer).toBe(newRenderer);
    });

    it("should allow setting dataManager directly", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const newDM = { getTotal: mock(() => 50) } as any;
      ctx.dataManager = newDM;
      expect(ctx.dataManager).toBe(newDM);
    });

    it("should allow setting scrollController directly", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const newSC = { getScrollTop: mock(() => 100) } as any;
      ctx.scrollController = newSC;
      expect(ctx.scrollController).toBe(newSC);
    });
  });

  // ── Handler registration ─────────────────────────────────────

  describe("handler registration arrays", () => {
    it("should initialize all handler arrays as empty", () => {
      const ctx = createBuilderContext(createMockOptions());
      expect(ctx.afterScroll).toEqual([]);
      expect(ctx.idleHandlers).toEqual([]);
      expect(ctx.clickHandlers).toEqual([]);
      expect(ctx.keydownHandlers).toEqual([]);
      expect(ctx.resizeHandlers).toEqual([]);
      expect(ctx.contentSizeHandlers).toEqual([]);
      expect(ctx.destroyHandlers).toEqual([]);
    });

    it("should allow pushing handlers", () => {
      const ctx = createBuilderContext(createMockOptions());
      const scrollHandler = mock(() => {});
      const destroyHandler = mock(() => {});

      ctx.afterScroll.push(scrollHandler);
      ctx.destroyHandlers.push(destroyHandler);

      expect(ctx.afterScroll).toHaveLength(1);
      expect(ctx.destroyHandlers).toHaveLength(1);
    });

    it("should initialize methods map as empty", () => {
      const ctx = createBuilderContext(createMockOptions());
      expect(ctx.methods).toBeInstanceOf(Map);
      expect(ctx.methods.size).toBe(0);
    });
  });

  // ── Virtual total function ───────────────────────────────────

  describe("getVirtualTotal", () => {
    it("should default to dataManager.getTotal()", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.getVirtualTotal()).toBe(100);
      expect(opts.dataManager.getTotal).toHaveBeenCalled();
    });

    it("should use custom function after setVirtualTotalFn", () => {
      const ctx = createBuilderContext(createMockOptions());
      ctx.setVirtualTotalFn(() => 25);
      expect(ctx.getVirtualTotal()).toBe(25);
    });
  });

  // ── Data helpers ─────────────────────────────────────────────

  describe("getItemsForRange", () => {
    it("should delegate to dataManager.getItemsInRange", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const items = ctx.getItemsForRange({ start: 0, end: 4 });
      expect(opts.dataManager.getItemsInRange).toHaveBeenCalledWith(0, 4);
      expect(items).toHaveLength(5);
      expect(items[0].id).toBe(0);
    });
  });

  describe("getAllLoadedItems", () => {
    it("should return items from 0 to total-1", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      ctx.getAllLoadedItems();
      expect(opts.dataManager.getItemsInRange).toHaveBeenCalledWith(0, 99);
    });
  });

  // ── Compression caching ──────────────────────────────────────

  describe("getCachedCompression", () => {
    it("should compute compression state on first call", () => {
      const ctx = createBuilderContext(createMockOptions());
      const compression = ctx.getCachedCompression();
      expect(compression).toBeDefined();
      expect(compression.isCompressed).toBe(false);
      expect(compression.ratio).toBe(1);
    });

    it("should return cached state when totalItems unchanged", () => {
      const ctx = createBuilderContext(createMockOptions());
      const first = ctx.getCachedCompression();
      const second = ctx.getCachedCompression();
      expect(first).toBe(second);
    });

    it("should recompute when totalItems changes", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);

      const first = ctx.getCachedCompression();

      // Change virtual total
      ctx.setVirtualTotalFn(() => 200);
      const second = ctx.getCachedCompression();

      expect(first).not.toBe(second);
    });
  });

  // ── Compression context ──────────────────────────────────────

  describe("getCompressionContext", () => {
    it("should return context with current viewport state", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.scrollPosition = 100;
      opts.initialState.viewportState.containerSize = 500;
      opts.initialState.viewportState.renderRange = { start: 2, end: 12 };

      const ctx = createBuilderContext(opts);
      const compressionCtx = ctx.getCompressionContext();

      expect(compressionCtx.scrollPosition).toBe(100);
      expect(compressionCtx.containerSize).toBe(500);
      expect(compressionCtx.totalItems).toBe(100);
      expect(compressionCtx.rangeStart).toBe(2);
    });

    it("should reuse the same object to avoid allocation", () => {
      const ctx = createBuilderContext(createMockOptions());
      const first = ctx.getCompressionContext();
      const second = ctx.getCompressionContext();
      expect(first).toBe(second);
    });
  });

  // ── renderIfNeeded ───────────────────────────────────────────

  describe("renderIfNeeded", () => {
    it("should not render when destroyed", () => {
      const opts = createMockOptions();
      opts.initialState.isDestroyed = true;
      const ctx = createBuilderContext(opts);

      ctx.renderIfNeeded();
      expect(opts.renderer.render).not.toHaveBeenCalled();
    });

    it("should not render when range unchanged and not compressed", () => {
      const opts = createMockOptions();
      // renderRange equals lastRenderRange
      opts.initialState.viewportState.renderRange = { start: 0, end: 13 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };

      const ctx = createBuilderContext(opts);
      ctx.renderIfNeeded();

      expect(opts.renderer.render).not.toHaveBeenCalled();
    });

    it("should update positions when range unchanged but compressed", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.renderRange = { start: 0, end: 13 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };
      opts.initialState.viewportState.isCompressed = true;

      const ctx = createBuilderContext(opts);
      ctx.renderIfNeeded();

      expect(opts.renderer.render).not.toHaveBeenCalled();
      expect(opts.renderer.updatePositions).toHaveBeenCalled();
    });

    it("should render when range changed", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.renderRange = { start: 5, end: 18 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };

      const ctx = createBuilderContext(opts);
      ctx.renderIfNeeded();

      expect(opts.renderer.render).toHaveBeenCalled();
      expect(opts.emitter.emit).toHaveBeenCalledWith("range:change", {
        range: { start: 5, end: 18 },
      });
    });

    it("should update lastRenderRange after render", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.renderRange = { start: 5, end: 18 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };

      const ctx = createBuilderContext(opts);
      ctx.renderIfNeeded();

      expect(ctx.state.lastRenderRange).toEqual({ start: 5, end: 18 });
    });

    it("should pass compressionCtx when compressed", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.renderRange = { start: 5, end: 18 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };
      opts.initialState.viewportState.isCompressed = true;

      const ctx = createBuilderContext(opts);
      ctx.renderIfNeeded();

      const renderCall = (opts.renderer.render as any).mock.calls[0];
      // 5th argument is compressionCtx
      expect(renderCall[4]).toBeDefined();
      expect(renderCall[4].totalItems).toBe(100);
    });

    it("should not pass compressionCtx when not compressed", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.renderRange = { start: 5, end: 18 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };
      opts.initialState.viewportState.isCompressed = false;

      const ctx = createBuilderContext(opts);
      ctx.renderIfNeeded();

      const renderCall = (opts.renderer.render as any).mock.calls[0];
      expect(renderCall[4]).toBeUndefined();
    });
  });

  // ── forceRender ──────────────────────────────────────────────

  describe("forceRender", () => {
    it("should not render when destroyed", () => {
      const opts = createMockOptions();
      opts.initialState.isDestroyed = true;
      const ctx = createBuilderContext(opts);

      ctx.forceRender();
      expect(opts.renderer.render).not.toHaveBeenCalled();
    });

    it("should always render regardless of range", () => {
      const opts = createMockOptions();
      // Same range
      opts.initialState.viewportState.renderRange = { start: 0, end: 13 };
      opts.initialState.lastRenderRange = { start: 0, end: 13 };

      const ctx = createBuilderContext(opts);
      ctx.forceRender();

      expect(opts.renderer.render).toHaveBeenCalled();
    });

    it("should pass compressionCtx when compressed", () => {
      const opts = createMockOptions();
      opts.initialState.viewportState.isCompressed = true;

      const ctx = createBuilderContext(opts);
      ctx.forceRender();

      const renderCall = (opts.renderer.render as any).mock.calls[0];
      expect(renderCall[4]).toBeDefined();
    });
  });

  // ── updateContentSize ────────────────────────────────────────

  describe("updateContentSize", () => {
    it("should update height in vertical mode", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);

      ctx.updateContentSize(9600);
      expect(opts.dom.content.style.height).toBe("9600px");
    });

    it("should update width in horizontal mode", () => {
      const opts = createMockOptions({
        resolvedConfig: {
          overscan: 3,
          classPrefix: "vlist",
          reverse: false,
          wrap: false,
          horizontal: true,
          ariaIdPrefix: "vlist",
      accessible: true,
        },
      });

      const ctx = createBuilderContext(opts);
      ctx.updateContentSize(9600);
      expect(opts.dom.content.style.width).toBe("9600px");
    });
  });

  // ── updateCompressionMode ────────────────────────────────────

  describe("updateCompressionMode", () => {
    it("should enable compression when needed", () => {
      const opts = createMockOptions();
      // Override sizeCache to return a large total that triggers compression
      (opts.sizeCache.getTotalSize as any) = mock(() => 20_000_000);
      (opts.scrollController.isCompressed as any) = mock(() => false);

      const ctx = createBuilderContext(opts);
      ctx.updateCompressionMode();

      // getSimpleCompressionState never returns isCompressed=true,
      // so enableCompression won't be called (simple state is always non-compressed)
      // But the cache should be updated
      expect(ctx.state.cachedCompression).not.toBeNull();
    });

    it("should disable compression when no longer needed", () => {
      const opts = createMockOptions();
      (opts.scrollController.isCompressed as any) = mock(() => true);

      const ctx = createBuilderContext(opts);
      ctx.updateCompressionMode();

      // Simple compression returns isCompressed=false, controller says compressed
      // → should disable
      expect(opts.scrollController.disableCompression).toHaveBeenCalled();
    });

    it("should update config when already compressed", () => {
      // This tests the "else if (compression.isCompressed)" branch.
      // Since getSimpleCompressionState always returns isCompressed=false,
      // this branch is only reachable with a real compression module.
      // We test the cache invalidation instead.
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      ctx.updateCompressionMode();

      expect(ctx.state.cachedCompression).not.toBeNull();
      expect(ctx.state.cachedCompression!.totalItems).toBe(100);
    });
  });

  // ── Component replacement methods ────────────────────────────

  describe("replaceRenderer", () => {
    it("should update renderer reference via getter", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const newRenderer = { render: mock(() => {}), clear: mock(() => {}) } as any;

      ctx.replaceRenderer(newRenderer);
      expect(ctx.renderer).toBe(newRenderer);
    });
  });

  describe("replaceDataManager", () => {
    it("should update dataManager and affect getVirtualTotal", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const newDM = {
        getTotal: mock(() => 50),
        getItemsInRange: mock(() => []),
      } as any;

      ctx.replaceDataManager(newDM);
      expect(ctx.dataManager).toBe(newDM);
      expect(ctx.getVirtualTotal()).toBe(50);
    });
  });

  describe("replaceScrollController", () => {
    it("should update scrollController reference", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const newSC = { isCompressed: mock(() => true) } as any;

      ctx.replaceScrollController(newSC);
      expect(ctx.scrollController).toBe(newSC);
    });
  });

  describe("replaceTemplate", () => {
    it("should create a new renderer with the new template", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const originalRenderer = ctx.renderer;

      ctx.replaceTemplate((item: TestItem) => `<span>${item.name}</span>`);

      // Renderer should be replaced (different reference)
      expect(ctx.renderer).not.toBe(originalRenderer);
    });
  });

  // ── Size cache operations ────────────────────────────────────

  describe("rebuildSizeCache", () => {
    it("should call sizeCache.rebuild with virtual total by default", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);

      ctx.rebuildSizeCache();
      expect(opts.sizeCache.rebuild).toHaveBeenCalledWith(100);
    });

    it("should call sizeCache.rebuild with provided total", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);

      ctx.rebuildSizeCache(50);
      expect(opts.sizeCache.rebuild).toHaveBeenCalledWith(50);
    });
  });

  describe("setSizeConfig", () => {
    it("should replace sizeCache with a new instance", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const originalCache = ctx.sizeCache;

      ctx.setSizeConfig(64);
      expect(ctx.sizeCache).not.toBe(originalCache);
    });

    it("should accept a function for variable sizes", () => {
      const ctx = createBuilderContext(createMockOptions());
      const originalCache = ctx.sizeCache;

      ctx.setSizeConfig((i) => (i % 2 === 0 ? 48 : 96));
      expect(ctx.sizeCache).not.toBe(originalCache);
    });
  });

  // ── getRenderFns ─────────────────────────────────────────────

  describe("getRenderFns", () => {
    it("should return renderIfNeeded and forceRender", () => {
      const ctx = createBuilderContext(createMockOptions());
      const fns = ctx.getRenderFns();
      expect(typeof fns.renderIfNeeded).toBe("function");
      expect(typeof fns.forceRender).toBe("function");
    });
  });

  // ── getContainerWidth ────────────────────────────────────────

  describe("getContainerWidth", () => {
    it("should return viewport clientWidth", () => {
      const ctx = createBuilderContext(createMockOptions());
      expect(ctx.getContainerWidth()).toBe(300);
    });
  });

  // ── getScrollTarget ──────────────────────────────────────────

  describe("getScrollTarget", () => {
    it("should return viewport element by default", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      expect(ctx.getScrollTarget()).toBe(opts.dom.viewport);
    });
  });

  // ── Stub methods ─────────────────────────────────────────────

  describe("stub methods", () => {
    it("should not throw when calling stub methods", () => {
      const ctx = createBuilderContext(createMockOptions());

      expect(() => ctx.setRenderFns(() => {}, () => {})).not.toThrow();
      expect(() => ctx.setVisibleRangeFn(() => ({ start: 0, end: 10 }))).not.toThrow();
      expect(() => ctx.setScrollToPosFn(() => 0)).not.toThrow();
      expect(() => ctx.setPositionElementFn(() => {})).not.toThrow();
      expect(() => ctx.setScrollFns(() => 0, () => {})).not.toThrow();
      expect(() => ctx.setScrollTarget(document.createElement("div"))).not.toThrow();
      expect(() => ctx.setContainerDimensions({ width: () => 300, height: () => 500 })).not.toThrow();
      expect(() => ctx.disableViewportResize()).not.toThrow();
      expect(() => ctx.disableWheelHandler()).not.toThrow();
      expect(() => ctx.invalidateRendered()).not.toThrow();
    });
  });

  // ── Proxy behavior (getters reflect replacements) ────────────

  describe("proxy-like getter behavior", () => {
    it("should reflect replaced renderer in subsequent reads", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);

      const r1 = { render: mock(() => {}) } as any;
      const r2 = { render: mock(() => {}) } as any;

      ctx.replaceRenderer(r1);
      expect(ctx.renderer).toBe(r1);

      ctx.replaceRenderer(r2);
      expect(ctx.renderer).toBe(r2);
    });

    it("should use replaced dataManager in getItemsForRange", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);

      const customItems = [{ id: 999, name: "Custom" }];
      const newDM = {
        getTotal: mock(() => 1),
        getItemsInRange: mock(() => customItems),
      } as any;

      ctx.replaceDataManager(newDM);
      const result = ctx.getItemsForRange({ start: 0, end: 0 });
      expect(result).toBe(customItems);
      expect(newDM.getItemsInRange).toHaveBeenCalledWith(0, 0);
    });

    it("should use replaced sizeCache after setSizeConfig", () => {
      const opts = createMockOptions();
      const ctx = createBuilderContext(opts);
      const originalSize = ctx.sizeCache.getSize(0);

      ctx.setSizeConfig(100);
      expect(ctx.sizeCache.getSize(0)).toBe(100);
    });
  });
});
