/**
 * vlist - Snapshots Feature Tests
 * Unit tests for withSnapshots: factory, getScrollSnapshot, restoreScroll,
 * auto-restore via config, NaN guards, sizeCache rebuild, loadVisibleRange.
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { withSnapshots } from "../../../src/features/snapshots/feature";
import type { VListItem, ScrollSnapshot } from "../../../src/types";
import type { BuilderContext } from "../../../src/builder/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalQueueMicrotask: any;

let originalRAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalQueueMicrotask = global.queueMicrotask;
  originalRAF = global.requestAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;

  // JSDOM doesn't provide requestAnimationFrame — polyfill with setTimeout
  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number;
  }
  if (!global.cancelAnimationFrame) {
    global.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.queueMicrotask = originalQueueMicrotask;
  global.requestAnimationFrame = originalRAF;
});

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Flush both microtasks (queueMicrotask) and macrotasks (requestAnimationFrame
 * polyfilled as setTimeout(…, 0)). Two rounds of setTimeout ensures the rAF
 * callback scheduled inside restoreScroll has executed regardless of event-loop
 * timing differences between local and CI environments.
 */
const flushAsync = (): Promise<void> =>
  new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));

interface TestItem extends VListItem {
  id: number;
  name: string;
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

interface MockContextOptions {
  totalItems?: number;
  containerSize?: number;
  scrollTop?: number;
  itemHeight?: number;
  isCompressed?: boolean;
  virtualSize?: number;
  actualSize?: number;
  compressionRatio?: number;
  sizeCacheTotal?: number;
  /** Pre-register methods on ctx.methods before setup runs */
  extraMethods?: Record<string, Function>;
}

function createMockContext(
  options: MockContextOptions = {},
): BuilderContext<TestItem> {
  const {
    totalItems = 100,
    containerSize = 500,
    scrollTop = 0,
    itemHeight = 48,
    isCompressed = false,
    virtualSize,
    actualSize,
    compressionRatio = 1,
    sizeCacheTotal,
    extraMethods = {},
  } = options;

  const computedActualSize = actualSize ?? totalItems * itemHeight;
  const computedVirtualSize = virtualSize ?? computedActualSize;
  // sizeCacheTotal defaults to totalItems unless explicitly overridden
  // (used to simulate stale sizeCache)
  let currentSizeCacheTotal = sizeCacheTotal ?? totalItems;
  let currentItemHeight = itemHeight;

  const testDom = createTestDOM();
  const methods = new Map<string, any>();
  const destroyCallbacks: Array<() => void> = [];

  // Populate extra methods
  for (const [name, fn] of Object.entries(extraMethods)) {
    methods.set(name, fn);
  }

  const emitterCallbacks = new Map<string, Array<(...args: any[]) => void>>();

  // Track what scrollTo was called with
  const scrollToHistory: number[] = [];

  // Track content size updates
  const contentSizeHistory: number[] = [];

  const ctx: BuilderContext<TestItem> = {
    dom: testDom as any,
    sizeCache: {
      rebuild: mock((newTotal: number) => {
        currentSizeCacheTotal = newTotal;
      }),
      getOffset: mock((index: number) => index * currentItemHeight),
      getSize: mock((_index: number) => currentItemHeight),
      getTotalSize: mock(() => currentSizeCacheTotal * currentItemHeight),
      getTotal: mock(() => currentSizeCacheTotal),
      indexAtOffset: mock((offset: number) => {
        if (currentSizeCacheTotal === 0 || currentItemHeight === 0) return 0;
        return Math.max(
          0,
          Math.min(
            Math.floor(offset / currentItemHeight),
            currentSizeCacheTotal - 1,
          ),
        );
      }),
      isVariable: mock(() => false),
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
      reverse: false,
      wrap: false,
      horizontal: false,
      ariaIdPrefix: "vlist",
      accessible: true,
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
    dataManager: {
      setTotal: mock((_total: number) => {}),
      getTotal: mock(() => totalItems),
    } as any,
    scrollController: {
      getScrollTop: mock(() => scrollTop),
      scrollTo: mock((pos: number) => {
        scrollToHistory.push(pos);
      }),
      scrollBy: mock(() => {}),
      isAtTop: mock(() => scrollTop === 0),
      isAtBottom: mock(() => false),
      getScrollPercentage: mock(() => 0),
      getVelocity: mock(() => 0),
      isTracking: mock(() => true),
      isScrolling: mock(() => false),
      updateConfig: mock(() => {}),
      isCompressed: mock(() => isCompressed),
      enableCompression: mock(() => {}),
      disableCompression: mock(() => {}),
    } as any,
    state: {
      isInitialized: true,
      isDestroyed: false,
      cachedCompression: null,
      viewportState: {
        scrollPosition: scrollTop,
        containerSize,
        totalSize: computedVirtualSize,
        actualSize: computedActualSize,
        isCompressed,
        compressionRatio,
        visibleRange: { start: 0, end: 10 },
        renderRange: { start: 0, end: 10 },
      },
    } as any,
    getContainerWidth: mock(() => 800),
    afterScroll: [],
    idleHandlers: [],
    clickHandlers: [],
    keydownHandlers: [],
    resizeHandlers: [],
    contentSizeHandlers: [],
    destroyHandlers: destroyCallbacks,
    methods,
    replaceTemplate: mock(() => {}),
    replaceRenderer: mock(() => {}),
    replaceDataManager: mock(() => {}),
    replaceScrollController: mock(() => {}),
    getItemsForRange: mock(() => []),
    getAllLoadedItems: mock(() => []),
    getVirtualTotal: mock(() => totalItems),
    getCachedCompression: mock(() => ({
      isCompressed,
      actualSize: computedActualSize,
      virtualSize: computedVirtualSize,
      ratio: compressionRatio,
    })),
    getCompressionContext: mock(() => ({
      scrollPosition: scrollTop,
      totalItems,
      containerSize,
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
    updateContentSize: mock((size: number) => {
      contentSizeHistory.push(size);
    }),
    updateCompressionMode: mock(() => {}),
    setVisibleRangeFn: mock(() => {}),
    setScrollToPosFn: mock(() => {}),
    getScrollToPos: mock(() => 0),
    setPositionElementFn: mock(() => {}),
    setUpdateItemClassesFn: mock(() => {}),
    setScrollFns: mock(() => {}),
    setScrollTarget: mock(() => {}),
    getScrollTarget: mock(() => window as any),
    setContainerDimensions: mock(() => {}),
    disableViewportResize: mock(() => {}),
    disableWheelHandler: mock(() => {}),
    adjustScrollPosition: (pos: number) => pos,
    getStripeIndexFn: () => (index: number) => index,
    setStripeIndexFn: () => {},
    getItemToScrollIndexFn: () => (index: number) => index,
    setItemToScrollIndexFn: () => {},
  };

  // Attach test helpers
  (ctx as any)._scrollToHistory = scrollToHistory;
  (ctx as any)._contentSizeHistory = contentSizeHistory;

  return ctx;
}

// =============================================================================
// withSnapshots - Factory Tests
// =============================================================================

describe("withSnapshots - Factory", () => {
  it("should create a feature with correct name and priority", () => {
    const feature = withSnapshots<TestItem>();

    expect(feature.name).toBe("withSnapshots");
    expect(feature.priority).toBe(50);
    expect(feature.methods).toEqual(["getScrollSnapshot", "restoreScroll"]);
  });

  it("should accept config with restore snapshot", () => {
    const snapshot: ScrollSnapshot = {
      index: 42,
      offsetInItem: 10,
      total: 1000,
    };
    const feature = withSnapshots<TestItem>({ restore: snapshot });

    expect(feature).toBeDefined();
    expect(feature.setup).toBeFunction();
  });

  it("should accept empty config", () => {
    const feature = withSnapshots<TestItem>({});

    expect(feature).toBeDefined();
    expect(feature.setup).toBeFunction();
  });

  it("should accept no arguments", () => {
    const feature = withSnapshots<TestItem>();

    expect(feature).toBeDefined();
    expect(feature.setup).toBeFunction();
  });
});

// =============================================================================
// withSnapshots - Setup Tests
// =============================================================================

describe("withSnapshots - Setup", () => {
  it("should register getScrollSnapshot method", () => {
    const ctx = createMockContext();
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    expect(ctx.methods.has("getScrollSnapshot")).toBe(true);
    expect(ctx.methods.get("getScrollSnapshot")).toBeFunction();
  });

  it("should register restoreScroll method", () => {
    const ctx = createMockContext();
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    expect(ctx.methods.has("restoreScroll")).toBe(true);
    expect(ctx.methods.get("restoreScroll")).toBeFunction();
  });
});

// =============================================================================
// withSnapshots - getScrollSnapshot Tests
// =============================================================================

describe("withSnapshots - getScrollSnapshot", () => {
  it("should return index 0 and offsetInItem 0 when totalItems is 0", () => {
    const ctx = createMockContext({ totalItems: 0 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(0);
    expect(snapshot.offsetInItem).toBe(0);
    expect(snapshot.total).toBe(0);
  });

  it("should capture correct index and offset in normal mode", () => {
    // scrollTop = 500, itemHeight = 48
    // index = floor(500/48) = 10
    // offset = 500 - 10*48 = 500 - 480 = 20
    const ctx = createMockContext({
      totalItems: 100,
      scrollTop: 500,
      itemHeight: 48,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(10);
    expect(snapshot.offsetInItem).toBe(20);
    expect(snapshot.total).toBe(100);
  });

  it("should capture correct index at scroll position 0", () => {
    const ctx = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(0);
    expect(snapshot.offsetInItem).toBe(0);
  });

  it("should clamp offsetInItem to non-negative", () => {
    // Edge case: floating point might produce negative offset
    const ctx = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);
  });

  it("should include total in snapshot", () => {
    const ctx = createMockContext({ totalItems: 1000000 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.total).toBe(1000000);
  });

  it("should include selectedIds when selection feature is present", () => {
    const ctx = createMockContext({ totalItems: 100, scrollTop: 0 });
    // Pre-register a getSelected method
    ctx.methods.set("getSelected", () => [5, 10, 15]);

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toEqual([5, 10, 15]);
  });

  it("should not include selectedIds when selection returns empty", () => {
    const ctx = createMockContext({ totalItems: 100, scrollTop: 0 });
    ctx.methods.set("getSelected", () => []);

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toBeUndefined();
  });

  it("should not include selectedIds when no selection feature", () => {
    const ctx = createMockContext({ totalItems: 100, scrollTop: 0 });
    // No getSelected method registered

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toBeUndefined();
  });

  it("should handle compressed mode", () => {
    // Compressed: index = scrollRatio * totalItems
    // scrollTop=5000, virtualSize=16700000, totalItems=1000000
    // scrollRatio = 5000/16700000 ≈ 0.000299
    // exactIndex ≈ 299.4
    // index = 299
    const totalItems = 1000000;
    const virtualSize = 16700000;
    const actualSize = totalItems * 48;
    const ctx = createMockContext({
      totalItems,
      scrollTop: 5000,
      itemHeight: 48,
      isCompressed: true,
      virtualSize,
      actualSize,
      compressionRatio: virtualSize / actualSize,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBeGreaterThan(0);
    expect(snapshot.index).toBeLessThan(totalItems);
    expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);
    expect(snapshot.total).toBe(totalItems);
  });
});

// =============================================================================
// withSnapshots - restoreScroll Tests
// =============================================================================

describe("withSnapshots - restoreScroll", () => {
  it("should do nothing when totalItems is 0 and snapshot has no total", () => {
    const ctx = createMockContext({ totalItems: 0 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 50, offsetInItem: 10 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should do nothing when totalItems is 0 and snapshot.total is 0", () => {
    const ctx = createMockContext({ totalItems: 0 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 50, offsetInItem: 10, total: 0 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should bootstrap total from snapshot when totalItems is 0 but snapshot has total", () => {
    const itemHeight = 48;
    const containerSize = 500;
    const ctx = createMockContext({ totalItems: 0, itemHeight, containerSize });
    // After setTotal bootstraps, getVirtualTotal should return the new total.
    // Also make compression mock dynamic so virtualSize updates after rebuild.
    let currentTotal = 0;
    (ctx.getVirtualTotal as any).mockImplementation(() => currentTotal);
    (ctx.dataManager.setTotal as any).mockImplementation((t: number) => { currentTotal = t; });
    (ctx.getCachedCompression as any).mockImplementation(() => ({
      isCompressed: false,
      actualSize: currentTotal * itemHeight,
      virtualSize: currentTotal * itemHeight,
      ratio: 1,
    }));

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 50, offsetInItem: 10, total: 1000 });

    // Should have called setTotal with snapshot's total
    expect(ctx.dataManager.setTotal).toHaveBeenCalledWith(1000);
    // Should have scrolled (not bailed)
    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // index=50, offset=50*48+10=2410
    expect(history[0]).toBe(2410);
  });

  it("should scroll to correct position in normal mode", () => {
    // index=10, offsetInItem=20, itemHeight=48
    // expected position = 10*48 + 20 = 500
    const ctx = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      containerSize: 500,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 10, offsetInItem: 20 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    expect(history[0]).toBe(500);
  });

  it("should clamp index to valid range", () => {
    // index=999 with only 100 items → safeIndex=99
    // position = 99*48 + 5 = 4757
    const ctx = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      containerSize: 500,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 999, offsetInItem: 5 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // 99 * 48 + 5 = 4757, clamped by maxScroll = 100*48 - 500 = 4300
    expect(history[0]).toBe(4300);
  });

  it("should clamp scroll position to maxScroll", () => {
    // totalSize = 10*48 = 480, containerSize = 500
    // maxScroll = max(0, 480-500) = 0
    const ctx = createMockContext({
      totalItems: 10,
      itemHeight: 48,
      containerSize: 500,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // 5*48+10 = 250, but maxScroll = max(0, 480-500) = 0
    expect(history[0]).toBe(0);
  });

  it("should restore selection when selectedIds provided", () => {
    const selectFn = mock((..._ids: Array<string | number>) => {});
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    ctx.methods.set("select", selectFn);

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0, selectedIds: [5, 10] });

    expect(selectFn).toHaveBeenCalledWith(5, 10);
  });

  it("should not call select when selectedIds is empty", () => {
    const selectFn = mock((..._ids: Array<string | number>) => {});
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    ctx.methods.set("select", selectFn);

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0, selectedIds: [] });

    expect(selectFn).not.toHaveBeenCalled();
  });

  it("should not crash when no select method exists", () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    // Should not throw
    restore({ index: 0, offsetInItem: 0, selectedIds: [1, 2, 3] });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
  });
});

// =============================================================================
// withSnapshots - NaN Guard Tests
// =============================================================================

describe("withSnapshots - NaN Guard", () => {
  it("should do nothing when index is NaN", () => {
    const ctx = createMockContext({ totalItems: 100 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: NaN, offsetInItem: 10 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should do nothing when offsetInItem is NaN", () => {
    const ctx = createMockContext({ totalItems: 100 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: NaN });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should do nothing when index is Infinity", () => {
    const ctx = createMockContext({ totalItems: 100 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: Infinity, offsetInItem: 10 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should do nothing when offsetInItem is -Infinity", () => {
    const ctx = createMockContext({ totalItems: 100 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: -Infinity });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });
});

// =============================================================================
// withSnapshots - sizeCache Rebuild Tests
// =============================================================================

describe("withSnapshots - sizeCache Rebuild", () => {
  it("should rebuild sizeCache when stale (total mismatch)", () => {
    // Simulate autoLoad:false scenario:
    // getVirtualTotal() returns 1000000 but sizeCache.getTotal() returns 0
    const ctx = createMockContext({
      totalItems: 1000000,
      itemHeight: 72,
      containerSize: 600,
      sizeCacheTotal: 0, // Stale!
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 704, offsetInItem: 10 });

    // Should have rebuilt sizeCache
    expect(ctx.sizeCache.rebuild).toHaveBeenCalledWith(1000000);
    // Should have updated compression mode
    expect(ctx.updateCompressionMode).toHaveBeenCalled();
    // Should have updated content size
    const sizeHistory = (ctx as any)._contentSizeHistory;
    expect(sizeHistory.length).toBeGreaterThan(0);
  });

  it("should NOT rebuild sizeCache when already correct", () => {
    const ctx = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      sizeCacheTotal: 100, // Already correct
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    // Should NOT have been called since cache was fine
    expect(ctx.sizeCache.rebuild).not.toHaveBeenCalled();
    expect(ctx.updateCompressionMode).not.toHaveBeenCalled();
  });

  it("should scroll to correct position after sizeCache rebuild", () => {
    // After rebuild, sizeCache knows the total → position is calculated correctly
    // index=704, offset=10, itemHeight=72
    // expected = 704*72 + 10 = 50698
    const totalItems = 1000000;
    const itemHeight = 72;
    const containerSize = 600;
    const virtualSize = totalItems * itemHeight; // 72M (uncompressed in mock)

    const ctx = createMockContext({
      totalItems,
      itemHeight,
      containerSize,
      sizeCacheTotal: 0, // Stale
      virtualSize,
      actualSize: virtualSize,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 704, offsetInItem: 10 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    expect(history[0]).toBe(50698);
  });
});

// =============================================================================
// withSnapshots - loadVisibleRange Integration Tests
// =============================================================================

describe("withSnapshots - loadVisibleRange", () => {
  // requestAnimationFrame in the source code may resolve to the JSDOM window's
  // rAF (pretendToBeVisual) rather than our global polyfill. To avoid fragile
  // timing, we replace global.requestAnimationFrame with a synchronous version
  // for these tests so the callback fires immediately.
  let savedRAF: typeof globalThis.requestAnimationFrame;

  beforeAll(() => {
    savedRAF = global.requestAnimationFrame;
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    }) as typeof requestAnimationFrame;
  });

  afterAll(() => {
    global.requestAnimationFrame = savedRAF;
  });

  it("should call loadVisibleRange instead of reload when available", () => {
    const loadVisibleFn = mock(async () => {});
    const reloadFn = mock(async () => {});

    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    ctx.methods.set("loadVisibleRange", loadVisibleFn);
    ctx.methods.set("reload", reloadFn);

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    expect(loadVisibleFn).toHaveBeenCalled();
    expect(reloadFn).not.toHaveBeenCalled();
  });

  it("should fall back to reload when loadVisibleRange not available", () => {
    const reloadFn = mock(async () => {});

    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    // Only reload, no loadVisibleRange
    ctx.methods.set("reload", reloadFn);

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    expect(reloadFn).toHaveBeenCalled();
  });

  it("should not call anything when neither method exists", () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    // No async methods registered at all

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    // Should not throw
    restore({ index: 5, offsetInItem: 10 });

    // Scroll should still happen
    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
  });
});

// =============================================================================
// withSnapshots - Auto-Restore via Config
// =============================================================================

describe("withSnapshots - Auto-Restore", () => {
  // Same synchronous rAF override as loadVisibleRange tests above.
  let savedRAF: typeof globalThis.requestAnimationFrame;

  beforeAll(() => {
    savedRAF = global.requestAnimationFrame;
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    }) as typeof requestAnimationFrame;
  });

  afterAll(() => {
    global.requestAnimationFrame = savedRAF;
  });

  it("should schedule restoreScroll via queueMicrotask when restore provided", async () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });

    const snapshot: ScrollSnapshot = { index: 10, offsetInItem: 20, total: 100 };
    const feature = withSnapshots<TestItem>({ restore: snapshot });
    feature.setup(ctx);

    // queueMicrotask runs after current synchronous code
    await new Promise((resolve) => queueMicrotask(resolve));

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    expect(history[0]).toBe(10 * 48 + 20); // 500
  });

  it("should NOT schedule restore when no config provided", async () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });

    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should NOT schedule restore when restore is undefined", async () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });

    const feature = withSnapshots<TestItem>({ restore: undefined });
    feature.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should trigger sizeCache rebuild during auto-restore if stale", async () => {
    const ctx = createMockContext({
      totalItems: 1000000,
      itemHeight: 72,
      containerSize: 600,
      sizeCacheTotal: 0, // Stale
    });

    const snapshot: ScrollSnapshot = {
      index: 704,
      offsetInItem: 10,
      total: 1000000,
    };
    const feature = withSnapshots<TestItem>({ restore: snapshot });
    feature.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(ctx.sizeCache.rebuild).toHaveBeenCalledWith(1000000);
    expect(ctx.updateCompressionMode).toHaveBeenCalled();
  });

  it("should call loadVisibleRange during auto-restore", async () => {
    const loadVisibleFn = mock(async () => {});

    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    ctx.methods.set("loadVisibleRange", loadVisibleFn);

    const snapshot: ScrollSnapshot = { index: 5, offsetInItem: 0, total: 100 };
    const feature = withSnapshots<TestItem>({ restore: snapshot });
    feature.setup(ctx);

    // Wait for queueMicrotask (rAF is synchronous in this describe block)
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(loadVisibleFn).toHaveBeenCalled();
  });

  it("should handle auto-restore with NaN gracefully", async () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });

    const snapshot = { index: NaN, offsetInItem: 0 } as ScrollSnapshot;
    const feature = withSnapshots<TestItem>({ restore: snapshot });
    feature.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    // Should not have scrolled (NaN guard)
    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should handle auto-restore with totalItems=0 and no snapshot total gracefully", async () => {
    const ctx = createMockContext({ totalItems: 0 });

    const snapshot: ScrollSnapshot = { index: 50, offsetInItem: 10 };
    const feature = withSnapshots<TestItem>({ restore: snapshot });
    feature.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    // Should not have scrolled (total is 0 and snapshot has no total)
    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(0);
  });

  it("should auto-restore by bootstrapping total from snapshot when totalItems=0", async () => {
    const itemHeight = 48;
    const containerSize = 500;
    const ctx = createMockContext({ totalItems: 0, itemHeight, containerSize });
    let currentTotal = 0;
    (ctx.getVirtualTotal as any).mockImplementation(() => currentTotal);
    (ctx.dataManager.setTotal as any).mockImplementation((t: number) => { currentTotal = t; });
    (ctx.getCachedCompression as any).mockImplementation(() => ({
      isCompressed: false,
      actualSize: currentTotal * itemHeight,
      virtualSize: currentTotal * itemHeight,
      ratio: 1,
    }));

    const snapshot: ScrollSnapshot = { index: 50, offsetInItem: 10, total: 1000 };
    const feature = withSnapshots<TestItem>({ restore: snapshot });
    feature.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    // Should have bootstrapped and scrolled
    expect(ctx.dataManager.setTotal).toHaveBeenCalledWith(1000);
    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
  });
});

// =============================================================================
// withSnapshots - Roundtrip Tests
// =============================================================================

describe("withSnapshots - Save/Restore Roundtrip", () => {
  it("should restore to the same position that was saved", () => {
    const itemHeight = 48;
    const totalItems = 100;
    const scrollTop = 500;

    // Save phase
    const saveCtx = createMockContext({
      totalItems,
      itemHeight,
      scrollTop,
      containerSize: 500,
    });
    const saveFeature = withSnapshots<TestItem>();
    saveFeature.setup(saveCtx);

    const getSnapshot = saveCtx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    // Restore phase
    const restoreCtx = createMockContext({
      totalItems,
      itemHeight,
      containerSize: 500,
    });
    const restoreFeature = withSnapshots<TestItem>();
    restoreFeature.setup(restoreCtx);

    const restore = restoreCtx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore(snapshot);

    const history = (restoreCtx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // Should restore to the original scrollTop
    expect(history[0]).toBe(scrollTop);
  });

  it("should preserve total through save/restore", () => {
    const ctx = createMockContext({ totalItems: 50000, scrollTop: 1000 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const getSnapshot = ctx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.total).toBe(50000);
  });

  it("should roundtrip with selection", () => {
    const itemHeight = 48;
    const totalItems = 100;

    // Save with selection
    const saveCtx = createMockContext({
      totalItems,
      itemHeight,
      scrollTop: 0,
    });
    saveCtx.methods.set("getSelected", () => [3, 7, 11]);
    const saveFeature = withSnapshots<TestItem>();
    saveFeature.setup(saveCtx);

    const getSnapshot = saveCtx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toEqual([3, 7, 11]);

    // Restore with selection
    const selectFn = mock((..._ids: Array<string | number>) => {});
    const restoreCtx = createMockContext({ totalItems, itemHeight });
    restoreCtx.methods.set("select", selectFn);

    const restoreFeature = withSnapshots<TestItem>();
    restoreFeature.setup(restoreCtx);

    const restore = restoreCtx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore(snapshot);

    expect(selectFn).toHaveBeenCalledWith(3, 7, 11);
  });
});

// =============================================================================
// withSnapshots - Edge Cases
// =============================================================================

describe("withSnapshots - Edge Cases", () => {
  it("should handle index 0 with offset 0", () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    expect(history[0]).toBe(0);
  });

  it("should handle last item index", () => {
    const ctx = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      containerSize: 500,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 99, offsetInItem: 0 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // 99*48 = 4752, maxScroll = 100*48-500 = 4300
    expect(history[0]).toBe(4300);
  });

  it("should handle negative index by clamping to 0", () => {
    const ctx = createMockContext({ totalItems: 100, itemHeight: 48 });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: -5, offsetInItem: 0 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    expect(history[0]).toBe(0);
  });

  it("should handle single item list", () => {
    const ctx = createMockContext({
      totalItems: 1,
      itemHeight: 48,
      containerSize: 500,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 10 });

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // maxScroll = max(0, 48-500) = 0
    expect(history[0]).toBe(0);
  });

  it("should handle JSON-parsed snapshot (string → number coercion check)", () => {
    // Simulate JSON.parse output — all values are proper numbers from JSON
    const raw = JSON.stringify({
      index: 42,
      offsetInItem: 15.5,
      total: 1000,
      selectedIds: [1, 2],
    });
    const parsed: ScrollSnapshot = JSON.parse(raw);

    const ctx = createMockContext({
      totalItems: 1000,
      itemHeight: 48,
      containerSize: 500,
    });
    const feature = withSnapshots<TestItem>();
    feature.setup(ctx);

    const restore = ctx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore(parsed);

    const history = (ctx as any)._scrollToHistory;
    expect(history.length).toBe(1);
    // 42*48 + 15.5 = 2031.5
    expect(history[0]).toBe(2031.5);
  });
});