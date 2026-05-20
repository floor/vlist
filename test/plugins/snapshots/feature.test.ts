/**
 * vlist v2 — Snapshots Plugin Tests
 * Unit tests for snapshots(): factory, getScrollSnapshot, restoreScroll,
 * auto-restore via config, NaN guards, sizeCache rebuild, loadVisibleRange.
 *
 * Adapted from v1 withSnapshots feature tests to v2 PluginContext API.
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { snapshots } from "../../../src/plugins/snapshots/plugin";
import type { VListItem, ScrollSnapshot } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalQueueMicrotask: any;
let originalSessionStorage: any;
let originalRAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalQueueMicrotask = global.queueMicrotask;
  originalSessionStorage = (global as any).sessionStorage;
  originalRAF = global.requestAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  (global as any).sessionStorage = dom.window.sessionStorage;

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
  (global as any).sessionStorage = originalSessionStorage;
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

interface MockOptions {
  totalItems?: number;
  containerSize?: number;
  scrollTop?: number;
  itemHeight?: number;
  isCompressed?: boolean;
  virtualSize?: number;
  actualSize?: number;
  compressionRatio?: number;
  sizeCacheTotal?: number;
  /** Pre-register methods on ctx before setup runs */
  extraMethods?: Record<string, Function>;
}

/**
 * Create a v2 plugin mock context for the snapshots plugin.
 *
 * Returns the PluginTestContext plus a `contentSizeHistory` array and a
 * reference to the mocked sizeCache.rebuild so tests can assert on them.
 */
function createMockContext(options: MockOptions = {}): {
  ctx: ReturnType<typeof createPluginMockContext<TestItem>>["ctx"];
  methods: Map<string, Function>;
  destroyHandlers: (() => void)[];
  scrollCalls: number[];
  engineState: ReturnType<typeof createPluginMockContext<TestItem>>["engineState"];
  contentSizeHistory: number[];
  sizeCache: ReturnType<typeof createPluginMockContext<TestItem>>["ctx"]["sizeCache"];
  cleanup: () => void;
} {
  const {
    totalItems = 100,
    containerSize = 500,
    scrollTop = 0,
    itemHeight = 48,
    isCompressed = false,
    virtualSize,
    compressionRatio = 1,
    sizeCacheTotal,
    extraMethods = {},
  } = options;

  const computedActualSize = options.actualSize ?? totalItems * itemHeight;
  const computedVirtualSize = virtualSize ?? computedActualSize;
  let currentSizeCacheTotal = sizeCacheTotal ?? totalItems;

  const testItems: TestItem[] = Array.from({ length: totalItems }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));

  const result = createPluginMockContext<TestItem>(testItems, {
    itemSize: itemHeight,
    containerHeight: containerSize,
  });

  const { ctx, engineState, methods, destroyHandlers, scrollCalls, cleanup } = result;

  // Override engineState to match the test options
  engineState.scrollPosition = scrollTop;
  engineState.totalItems = totalItems;
  engineState.containerSize = containerSize;
  engineState.totalSize = computedVirtualSize;
  engineState.isCompressed = isCompressed;
  engineState.compressionRatio = compressionRatio;

  // Override sizeCache with a more faithful mock that respects sizeCacheTotal
  const contentSizeHistory: number[] = [];
  const sizeCacheRebuildCalls: number[] = [];

  const sizeCache = {
    rebuild: mock((newTotal: number) => {
      currentSizeCacheTotal = newTotal;
      sizeCacheRebuildCalls.push(newTotal);
    }),
    getOffset: (index: number) => index * itemHeight,
    getSize: (_index: number) => itemHeight,
    getTotalSize: () => currentSizeCacheTotal * itemHeight,
    getTotal: () => currentSizeCacheTotal,
    indexAtOffset: (offset: number) => {
      if (currentSizeCacheTotal === 0 || itemHeight === 0) return 0;
      return Math.max(
        0,
        Math.min(Math.floor(offset / itemHeight), currentSizeCacheTotal - 1),
      );
    },
    isVariable: () => false,
  };

  // Replace the sizeCache on ctx with our tracked version
  (ctx as any).sizeCache = sizeCache;

  // Track content size updates
  const originalUpdateContentSize = ctx.updateContentSize.bind(ctx);
  (ctx as any).updateContentSize = (size: number) => {
    contentSizeHistory.push(size);
    originalUpdateContentSize(size);
  };

  // Register extraMethods
  for (const [name, fn] of Object.entries(extraMethods)) {
    methods.set(name, fn);
  }

  // Emitter with tracking (the default emitter in plugin-context is a no-op)
  // We need a real emitter to test selection:change / focus:change
  const emitterCallbacks = new Map<string, Array<(...args: any[]) => void>>();
  (ctx as any).emitter = {
    on: (event: string, callback: (...args: any[]) => void) => {
      if (!emitterCallbacks.has(event)) emitterCallbacks.set(event, []);
      emitterCallbacks.get(event)!.push(callback);
      return () => {};
    },
    off: () => {},
    emit: (event: string, ...args: any[]) => {
      const callbacks = emitterCallbacks.get(event);
      if (callbacks) callbacks.forEach((cb) => cb(...args));
    },
    clear: () => {},
  };

  return {
    ctx,
    methods,
    destroyHandlers,
    scrollCalls,
    engineState,
    contentSizeHistory,
    sizeCache: sizeCache as any,
    cleanup,
  };
}

// =============================================================================
// snapshots — Factory Tests
// =============================================================================

describe("snapshots - Factory", () => {
  it("should create a plugin with correct name and priority", () => {
    const plugin = snapshots<TestItem>();

    expect(plugin.name).toBe("snapshots");
    expect(plugin.priority).toBe(50);
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("should accept config with restore snapshot", () => {
    const snapshot: ScrollSnapshot = {
      index: 42,
      offsetInItem: 10,
      total: 1000,
    };
    const plugin = snapshots<TestItem>({ restore: snapshot });

    expect(plugin).toBeDefined();
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("should accept empty config", () => {
    const plugin = snapshots<TestItem>({});

    expect(plugin).toBeDefined();
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("should accept no arguments", () => {
    const plugin = snapshots<TestItem>();

    expect(plugin).toBeDefined();
    expect(plugin.setup).toBeInstanceOf(Function);
  });
});

// =============================================================================
// snapshots — Setup Tests
// =============================================================================

describe("snapshots - Setup", () => {
  it("should register getScrollSnapshot method", () => {
    const { ctx, methods, cleanup } = createMockContext();
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    expect(methods.has("getScrollSnapshot")).toBe(true);
    expect(methods.get("getScrollSnapshot")).toBeInstanceOf(Function);
    cleanup();
  });

  it("should register restoreScroll method", () => {
    const { ctx, methods, cleanup } = createMockContext();
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    expect(methods.has("restoreScroll")).toBe(true);
    expect(methods.get("restoreScroll")).toBeInstanceOf(Function);
    cleanup();
  });
});

// =============================================================================
// snapshots — getScrollSnapshot Tests
// =============================================================================

describe("snapshots - getScrollSnapshot", () => {
  it("should return index 0 and offsetInItem 0 when totalItems is 0", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 0 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(0);
    expect(snapshot.offsetInItem).toBe(0);
    expect(snapshot.total).toBe(0);
    cleanup();
  });

  it("should capture correct index and offset in normal mode", () => {
    // scrollTop = 500, itemHeight = 48
    // index = floor(500/48) = 10
    // offset = 500 - 10*48 = 500 - 480 = 20
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 500,
      itemHeight: 48,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(10);
    expect(snapshot.offsetInItem).toBe(20);
    expect(snapshot.total).toBe(100);
    cleanup();
  });

  it("should capture correct index at scroll position 0", () => {
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(0);
    expect(snapshot.offsetInItem).toBe(0);
    cleanup();
  });

  it("should clamp offsetInItem to non-negative", () => {
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);
    cleanup();
  });

  it("should include total in snapshot", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 1000000 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.total).toBe(1000000);
    cleanup();
  });

  it("should include selectedIds when selection plugin is present", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });
    methods.set("getSelected", () => [5, 10, 15]);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toEqual([5, 10, 15]);
    cleanup();
  });

  it("should not include selectedIds when selection returns empty", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });
    methods.set("getSelected", () => []);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toBeUndefined();
    cleanup();
  });

  it("should not include selectedIds when no selection plugin", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.selectedIds).toBeUndefined();
    cleanup();
  });

  it("should handle compressed mode", () => {
    // Compressed: index = scrollRatio * totalItems
    // scrollTop=5000, virtualSize=16700000, totalItems=1000000
    // scrollRatio = 5000/16700000 ≈ 0.000299
    // exactIndex ≈ 299.4 → index = 299
    const totalItems = 1000000;
    const virtualSize = 16700000;
    const actualSize = totalItems * 48;
    const { ctx, methods, cleanup } = createMockContext({
      totalItems,
      scrollTop: 5000,
      itemHeight: 48,
      isCompressed: true,
      virtualSize,
      actualSize,
      compressionRatio: virtualSize / actualSize,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBeGreaterThan(0);
    expect(snapshot.index).toBeLessThan(totalItems);
    expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);
    expect(snapshot.total).toBe(totalItems);
    cleanup();
  });
});

// =============================================================================
// snapshots — restoreScroll Tests
// =============================================================================

describe("snapshots - restoreScroll", () => {
  it("should do nothing when totalItems is 0 and snapshot has no total", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 0 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 50, offsetInItem: 10 });

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should do nothing when totalItems is 0 and snapshot.total is 0", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 0 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 50, offsetInItem: 10, total: 0 });

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should bootstrap total from snapshot when totalItems is 0 but snapshot has total", () => {
    const itemHeight = 48;
    const containerSize = 500;

    const { ctx, methods, engineState, sizeCache, scrollCalls, cleanup } = createMockContext({
      totalItems: 0,
      itemHeight,
      containerSize,
    });

    // _setTotal must update engineState.totalItems so the plugin sees the new total
    const setTotalFn = mock((t: number) => {
      engineState.totalItems = t;
    });
    methods.set("_setTotal", setTotalFn);

    // _updateCompressionMode must update engineState.totalSize so maxScroll is correct
    methods.set("_updateCompressionMode", () => {
      engineState.totalSize = engineState.totalItems * itemHeight;
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 50, offsetInItem: 10, total: 1000 });

    expect(setTotalFn).toHaveBeenCalledWith(1000);
    expect(scrollCalls.length).toBe(1);
    // index=50, offset=50*48+10=2410
    expect(scrollCalls[0]).toBe(2410);
    cleanup();
  });

  it("should scroll to correct position in normal mode", () => {
    // index=10, offsetInItem=20, itemHeight=48
    // expected position = 10*48 + 20 = 500
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      containerSize: 500,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 10, offsetInItem: 20 });

    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(500);
    cleanup();
  });

  it("should clamp index to valid range", () => {
    // index=999 with only 100 items → safeIndex=99
    // position = 99*48 + 5 = 4757, clamped by maxScroll = 100*48 - 500 = 4300
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      containerSize: 500,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 999, offsetInItem: 5 });

    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(4300);
    cleanup();
  });

  it("should clamp scroll position to maxScroll", () => {
    // totalSize = 10*48 = 480, containerSize = 500
    // maxScroll = max(0, 480-500) = 0
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 10,
      itemHeight: 48,
      containerSize: 500,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    expect(scrollCalls.length).toBe(1);
    // 5*48+10 = 250, but maxScroll = max(0, 480-500) = 0
    expect(scrollCalls[0]).toBe(0);
    cleanup();
  });

  it("should restore selection when selectedIds provided", () => {
    const selectFn = mock((..._ids: Array<string | number>) => {});
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("select", selectFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0, selectedIds: [5, 10] });

    expect(selectFn).toHaveBeenCalledWith(5, 10);
    cleanup();
  });

  it("should not call select when selectedIds is empty", () => {
    const selectFn = mock((..._ids: Array<string | number>) => {});
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("select", selectFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0, selectedIds: [] });

    expect(selectFn).not.toHaveBeenCalled();
    cleanup();
  });

  it("should not crash when no select method exists", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0, selectedIds: [1, 2, 3] });

    expect(scrollCalls.length).toBe(1);
    cleanup();
  });
});

// =============================================================================
// snapshots — NaN Guard Tests
// =============================================================================

describe("snapshots - NaN Guard", () => {
  it("should do nothing when index is NaN", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: NaN, offsetInItem: 10 });

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should do nothing when offsetInItem is NaN", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: NaN });

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should do nothing when index is Infinity", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: Infinity, offsetInItem: 10 });

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should do nothing when offsetInItem is -Infinity", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: -Infinity });

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });
});

// =============================================================================
// snapshots — sizeCache Rebuild Tests
// =============================================================================

describe("snapshots - sizeCache Rebuild", () => {
  it("should rebuild sizeCache when stale (total mismatch)", () => {
    // Simulate autoLoad:false scenario:
    // engineState.totalItems = 1000000 but sizeCache.getTotal() = 0
    const updateCompressionFn = mock(() => {});
    const { ctx, methods, sizeCache, contentSizeHistory, cleanup } = createMockContext({
      totalItems: 1000000,
      itemHeight: 72,
      containerSize: 600,
      sizeCacheTotal: 0, // Stale!
      extraMethods: { _updateCompressionMode: updateCompressionFn },
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 704, offsetInItem: 10 });

    expect(sizeCache.rebuild).toHaveBeenCalledWith(1000000);
    expect(updateCompressionFn).toHaveBeenCalled();
    expect(contentSizeHistory.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should NOT rebuild sizeCache when already correct", () => {
    const updateCompressionFn = mock(() => {});
    const { ctx, methods, sizeCache, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      sizeCacheTotal: 100, // Already correct
      extraMethods: { _updateCompressionMode: updateCompressionFn },
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    expect(sizeCache.rebuild).not.toHaveBeenCalled();
    expect(updateCompressionFn).not.toHaveBeenCalled();
    cleanup();
  });

  it("should scroll to correct position after sizeCache rebuild", () => {
    // After rebuild, sizeCache knows the total → position calculated correctly
    // index=704, offset=10, itemHeight=72
    // expected = 704*72 + 10 = 50698
    const totalItems = 1000000;
    const itemHeight = 72;
    const containerSize = 600;
    const virtualSize = totalItems * itemHeight; // 72M (uncompressed in mock)

    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems,
      itemHeight,
      containerSize,
      sizeCacheTotal: 0, // Stale
      virtualSize,
      actualSize: virtualSize,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 704, offsetInItem: 10 });

    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(50698);
    cleanup();
  });

  it("should not over-clamp last items when scale plugin sets totalSize with slack (regression #30)", () => {
    // Repro: scale plugin sets engineState.totalSize = virtualSize + slack after
    // updateCompressionMode(). restoreScroll used to clamp maxScroll to
    // virtualSize - containerSize (ignoring slack), putting the scroll position
    // ~466px short — enough to hide the last ~37 items.
    const totalItems = 1_000_000;
    const itemHeight = 72;
    const containerSize = 600;
    const actualSize = totalItems * itemHeight; // 72,000,000
    const virtualSize = 16_000_000; // compressed (MAX_VIRTUAL_SIZE)
    const ratio = virtualSize / actualSize; // ≈ 0.2222
    const slack = Math.round(containerSize * (1 - ratio)); // ≈ 466
    const totalSizeWithSlack = virtualSize + slack;

    // _updateCompressionMode sets engineState.totalSize = virtualSize + slack
    const { ctx, methods, engineState, scrollCalls, cleanup } = createMockContext({
      totalItems,
      itemHeight,
      containerSize,
      isCompressed: true,
      virtualSize,
      actualSize,
      compressionRatio: ratio,
      sizeCacheTotal: 0, // stale — triggers sizeCache rebuild path
      extraMethods: {
        _updateCompressionMode: () => {
          engineState.totalSize = totalSizeWithSlack;
        },
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 999_999, offsetInItem: 0, total: totalItems });

    expect(scrollCalls.length).toBe(1);

    const buggyMaxScroll = virtualSize - containerSize; // 15,999,400
    const correctMaxScroll = totalSizeWithSlack - containerSize; // 15,999,866
    expect(scrollCalls[0]).toBeGreaterThan(buggyMaxScroll);
    expect(scrollCalls[0]).toBeLessThanOrEqual(correctMaxScroll);
    cleanup();
  });

  it("should not call updateContentSize with slack-less virtualSize when compressed (regression #30)", () => {
    // restoreScroll must not call updateContentSize(freshCompression.virtualSize) after
    // updateCompressionMode(), which would overwrite the scale-set content size
    // (virtualSize + slack) with just virtualSize.
    const totalItems = 1_000_000;
    const itemHeight = 72;
    const containerSize = 600;
    const actualSize = totalItems * itemHeight;
    const virtualSize = 16_000_000;
    const ratio = virtualSize / actualSize;
    const slack = Math.round(containerSize * (1 - ratio));
    const totalSizeWithSlack = virtualSize + slack;

    const { ctx, methods, engineState, contentSizeHistory, cleanup } = createMockContext({
      totalItems,
      itemHeight,
      containerSize,
      isCompressed: true,
      virtualSize,
      actualSize,
      compressionRatio: ratio,
      sizeCacheTotal: 0, // stale
      extraMethods: {
        _updateCompressionMode: () => {
          engineState.totalSize = totalSizeWithSlack;
        },
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 500_000, offsetInItem: 0, total: totalItems });

    // updateContentSize must NOT be called with the slack-less virtualSize
    expect(contentSizeHistory).not.toContain(virtualSize);
    cleanup();
  });
});

// =============================================================================
// snapshots — loadVisibleRange Integration Tests
// =============================================================================

describe("snapshots - loadVisibleRange", () => {
  // requestAnimationFrame in the source code may resolve to the JSDOM window's
  // rAF rather than our global polyfill. Replace with synchronous version so
  // the callback fires immediately and tests are deterministic.
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

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("loadVisibleRange", loadVisibleFn);
    methods.set("reload", reloadFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    expect(loadVisibleFn).toHaveBeenCalled();
    expect(reloadFn).not.toHaveBeenCalled();
    cleanup();
  });

  it("should fall back to reload when loadVisibleRange not available", () => {
    const reloadFn = mock(async () => {});

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("reload", reloadFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    expect(reloadFn).toHaveBeenCalled();
    cleanup();
  });

  it("should not call anything when neither method exists", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 10 });

    // Scroll should still happen
    expect(scrollCalls.length).toBe(1);
    cleanup();
  });
});

// =============================================================================
// snapshots — Auto-Restore via Config
// =============================================================================

describe("snapshots - Auto-Restore", () => {
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
    const { ctx, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const snapshot: ScrollSnapshot = { index: 10, offsetInItem: 20, total: 100 };
    const plugin = snapshots<TestItem>({ restore: snapshot });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(10 * 48 + 20); // 500
    cleanup();
  });

  it("should NOT schedule restore when no config provided", async () => {
    const { ctx, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should NOT schedule restore when restore is undefined", async () => {
    const { ctx, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const plugin = snapshots<TestItem>({ restore: undefined });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should trigger sizeCache rebuild during auto-restore if stale", async () => {
    const updateCompressionFn = mock(() => {});
    const { ctx, sizeCache, cleanup } = createMockContext({
      totalItems: 1000000,
      itemHeight: 72,
      containerSize: 600,
      sizeCacheTotal: 0, // Stale
      extraMethods: { _updateCompressionMode: updateCompressionFn },
    });

    const snapshot: ScrollSnapshot = {
      index: 704,
      offsetInItem: 10,
      total: 1000000,
    };
    const plugin = snapshots<TestItem>({ restore: snapshot });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(sizeCache.rebuild).toHaveBeenCalledWith(1000000);
    expect(updateCompressionFn).toHaveBeenCalled();
    cleanup();
  });

  it("should call loadVisibleRange during auto-restore", async () => {
    const loadVisibleFn = mock(async () => {});

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("loadVisibleRange", loadVisibleFn);

    const snapshot: ScrollSnapshot = { index: 5, offsetInItem: 0, total: 100 };
    const plugin = snapshots<TestItem>({ restore: snapshot });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(loadVisibleFn).toHaveBeenCalled();
    cleanup();
  });

  it("should handle auto-restore with NaN gracefully", async () => {
    const { ctx, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const snapshot = { index: NaN, offsetInItem: 0 } as ScrollSnapshot;
    const plugin = snapshots<TestItem>({ restore: snapshot });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should handle auto-restore with totalItems=0 and no snapshot total gracefully", async () => {
    const { ctx, scrollCalls, cleanup } = createMockContext({ totalItems: 0 });

    const snapshot: ScrollSnapshot = { index: 50, offsetInItem: 10 };
    const plugin = snapshots<TestItem>({ restore: snapshot });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });

  it("should auto-restore by bootstrapping total from snapshot when totalItems=0", async () => {
    const itemHeight = 48;
    const containerSize = 500;

    const { ctx, methods, engineState, scrollCalls, cleanup } = createMockContext({
      totalItems: 0,
      itemHeight,
      containerSize,
    });

    // _setTotal must update engineState.totalItems so the plugin sees the new total
    const setTotalFn = mock((t: number) => {
      engineState.totalItems = t;
    });
    methods.set("_setTotal", setTotalFn);

    const snapshot: ScrollSnapshot = { index: 50, offsetInItem: 10, total: 1000 };
    const plugin = snapshots<TestItem>({ restore: snapshot });
    plugin.setup(ctx);

    await new Promise((resolve) => queueMicrotask(resolve));

    expect(setTotalFn).toHaveBeenCalledWith(1000);
    expect(scrollCalls.length).toBe(1);
    cleanup();
  });
});

// =============================================================================
// snapshots — Roundtrip Tests
// =============================================================================

describe("snapshots - Save/Restore Roundtrip", () => {
  it("should restore to the same position that was saved", () => {
    const itemHeight = 48;
    const totalItems = 100;
    const scrollTop = 500;

    // Save phase
    const save = createMockContext({ totalItems, itemHeight, scrollTop, containerSize: 500 });
    const savePlugin = snapshots<TestItem>();
    savePlugin.setup(save.ctx);
    const getSnapshot = save.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();
    save.cleanup();

    // Restore phase
    const restore = createMockContext({ totalItems, itemHeight, containerSize: 500 });
    const restorePlugin = snapshots<TestItem>();
    restorePlugin.setup(restore.ctx);
    const restoreFn = restore.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restoreFn(snapshot);

    expect(restore.scrollCalls.length).toBe(1);
    expect(restore.scrollCalls[0]).toBe(scrollTop);
    restore.cleanup();
  });

  it("should preserve total through save/restore", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 50000, scrollTop: 1000 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.total).toBe(50000);
    cleanup();
  });

  it("should roundtrip with selection", () => {
    const itemHeight = 48;
    const totalItems = 100;

    // Save with selection
    const save = createMockContext({ totalItems, itemHeight, scrollTop: 0 });
    save.methods.set("getSelected", () => [3, 7, 11]);
    const savePlugin = snapshots<TestItem>();
    savePlugin.setup(save.ctx);
    const getSnapshot = save.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();
    expect(snapshot.selectedIds).toEqual([3, 7, 11]);
    save.cleanup();

    // Restore with selection
    const selectFn = mock((..._ids: Array<string | number>) => {});
    const restore = createMockContext({ totalItems, itemHeight });
    restore.methods.set("select", selectFn);
    const restorePlugin = snapshots<TestItem>();
    restorePlugin.setup(restore.ctx);
    const restoreFn = restore.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restoreFn(snapshot);

    expect(selectFn).toHaveBeenCalledWith(3, 7, 11);
    restore.cleanup();
  });
});

// =============================================================================
// snapshots — Edge Cases
// =============================================================================

describe("snapshots - Edge Cases", () => {
  it("should handle index 0 with offset 0", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 0 });

    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(0);
    cleanup();
  });

  it("should handle last item index", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      containerSize: 500,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 99, offsetInItem: 0 });

    expect(scrollCalls.length).toBe(1);
    // 99*48 = 4752, maxScroll = 100*48-500 = 4300
    expect(scrollCalls[0]).toBe(4300);
    cleanup();
  });

  it("should handle negative index by clamping to 0", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: -5, offsetInItem: 0 });

    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(0);
    cleanup();
  });

  it("should handle single item list", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 1,
      itemHeight: 48,
      containerSize: 500,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 0, offsetInItem: 10 });

    expect(scrollCalls.length).toBe(1);
    // maxScroll = max(0, 48-500) = 0
    expect(scrollCalls[0]).toBe(0);
    cleanup();
  });

  it("should handle JSON-parsed snapshot (string → number coercion check)", () => {
    const raw = JSON.stringify({
      index: 42,
      offsetInItem: 15.5,
      total: 1000,
      selectedIds: [1, 2],
    });
    const parsed: ScrollSnapshot = JSON.parse(raw);

    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 1000,
      itemHeight: 48,
      containerSize: 500,
    });
    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore(parsed);

    expect(scrollCalls.length).toBe(1);
    // 42*48 + 15.5 = 2031.5
    expect(scrollCalls[0]).toBe(2031.5);
    cleanup();
  });
});

// =============================================================================
// snapshots — autoSave Tests
// =============================================================================

describe("snapshots - autoSave", () => {
  const AUTO_SAVE_KEY = "test-autosave";
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

  function clearAutoSave() {
    try {
      sessionStorage.removeItem(AUTO_SAVE_KEY);
    } catch {
      // ignore
    }
  }

  it("should save snapshot to sessionStorage on scroll idle", () => {
    clearAutoSave();
    // scrollTop=100, itemHeight=48 → index=2, offsetInItem=4
    const { ctx, cleanup } = createMockContext({ totalItems: 50, scrollTop: 100, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    // Fire the idle hook
    expect(plugin.hooks?.onIdle).toBeInstanceOf(Function);
    plugin.hooks!.onIdle!();

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.total).toBe(50);
    expect(parsed.index).toBe(2);
    expect(parsed.offsetInItem).toBe(4);
    cleanup();
  });

  it("should save snapshot on selection:change", () => {
    clearAutoSave();
    // scrollTop=100, itemHeight=48 → index=2, offsetInItem=4
    const { ctx, cleanup } = createMockContext({ totalItems: 50, scrollTop: 100, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    ctx.emitter.emit("selection:change", { selected: [1], items: [] as TestItem[] });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.total).toBe(50);
    expect(parsed.index).toBe(2);
    cleanup();
  });

  it("should guard all saves during restore settle", () => {
    clearAutoSave();
    const originalSnapshot: ScrollSnapshot = { index: 50, offsetInItem: 0, total: 100 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(originalSnapshot));

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    const differentSnapshot: ScrollSnapshot = { index: 99, offsetInItem: 0, total: 100 };
    methods.set("getScrollSnapshot", () => differentSnapshot);

    // Emit selection:change — should NOT write (guard active)
    ctx.emitter.emit("selection:change", { selected: [1], items: [] as TestItem[] });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(originalSnapshot);
    cleanup();
  });

  it("should lift guard and save after restoreScroll completes", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 50, offsetInItem: 0, total: 100 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    // scrollTop=0, itemHeight=48 → index=0, offsetInItem=0
    const { ctx, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    await flushAsync();

    // Guard is lifted — a save should have occurred after restore settled
    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).total).toBe(100);
    cleanup();
  });

  it("should save normally after guard is lifted", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 50, offsetInItem: 0, total: 100 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    // scrollTop=0, itemHeight=48 → index=0, offsetInItem=0
    const { ctx, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    // Flush microtask to lift guard
    await flushAsync();

    // After guard lifted, selection:change should trigger another save
    ctx.emitter.emit("selection:change", { selected: [1], items: [] as TestItem[] });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).total).toBe(100);
    cleanup();
  });

  it("should read and auto-restore snapshot from sessionStorage", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 42, offsetInItem: 10, total: 100 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    const { ctx, scrollCalls, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    await flushAsync();

    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should cancel withAsync autoLoad when restoring", () => {
    clearAutoSave();
    const cancelAutoLoad = mock(() => {});
    const { ctx, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 48,
      extraMethods: { _cancelAutoLoad: cancelAutoLoad },
    });

    const savedSnapshot: ScrollSnapshot = { index: 10, offsetInItem: 0, total: 100 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    expect(cancelAutoLoad).toHaveBeenCalled();
    cleanup();
  });

  it("should not guard saves when no restore snapshot exists", () => {
    clearAutoSave();

    // No snapshot in sessionStorage — guard should not activate
    // scrollTop=0, itemHeight=48 → index=0, offsetInItem=0
    const { ctx, cleanup } = createMockContext({ totalItems: 50, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    // selection:change should save immediately (no guard)
    ctx.emitter.emit("selection:change", { selected: [1], items: [] as TestItem[] });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).total).toBe(50);
    cleanup();
  });

  it("should handle corrupt sessionStorage data gracefully", () => {
    clearAutoSave();
    sessionStorage.setItem(AUTO_SAVE_KEY, "not-json{{{");

    // scrollTop=0, itemHeight=48 → index=0, offsetInItem=0
    const { ctx, cleanup } = createMockContext({ totalItems: 50, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    // Should not throw during setup (corrupt data is ignored)
    plugin.setup(ctx);

    // No guard since readSnapshot returned undefined — idle handler should save normally
    plugin.hooks!.onIdle!();

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).total).toBe(50);
    cleanup();
  });

  it("should save snapshot on focus:change", () => {
    clearAutoSave();
    // scrollTop=0, itemHeight=48 → index=0, offsetInItem=0
    const { ctx, cleanup } = createMockContext({ totalItems: 50, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    ctx.emitter.emit("focus:change", { id: 7, index: 6 });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).total).toBe(50);
    cleanup();
  });

  it("should guard focus:change saves during restore settle", () => {
    clearAutoSave();
    const originalSnapshot: ScrollSnapshot = { index: 50, offsetInItem: 0, total: 100, focusedId: 50 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(originalSnapshot));

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    const differentSnapshot: ScrollSnapshot = { index: 99, offsetInItem: 0, total: 100, focusedId: 99 };
    methods.set("getScrollSnapshot", () => differentSnapshot);

    ctx.emitter.emit("focus:change", { id: 99, index: 98 });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(JSON.parse(stored!)).toEqual(originalSnapshot);
    cleanup();
  });

  it("should save focus:change normally after restore guard is lifted", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 50, offsetInItem: 0, total: 100 };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    // scrollTop=0, itemHeight=48 → index=0, offsetInItem=0
    const { ctx, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0, itemHeight: 48 });
    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    // Flush microtask to lift guard
    await flushAsync();

    // Guard lifted — focus:change should now trigger a save
    ctx.emitter.emit("focus:change", { id: 31, index: 30 });

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).total).toBe(100);
    cleanup();
  });
});

// =============================================================================
// snapshots — Selection Seeding
// =============================================================================

describe("snapshots - Selection Seeding", () => {
  const AUTO_SAVE_KEY = "test-seed-selection";

  const clearAutoSave = (): void => {
    sessionStorage.removeItem(AUTO_SAVE_KEY);
  };

  it("should seed selection synchronously via _seedSelection before first render", () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 10, offsetInItem: 0, total: 100, selectedIds: [42, 99] };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    const seeded: Array<string | number> = [];
    const { ctx, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
      extraMethods: { _seedSelection: (ids: Array<string | number>) => { seeded.push(...ids); } },
    });

    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    // _seedSelection is called synchronously during setup, before any microtask
    expect(seeded).toEqual([42, 99]);
    cleanup();
  });

  it("should strip selectedIds from restoreScroll when seeded", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 10, offsetInItem: 0, total: 100, selectedIds: [42] };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    let selectCalled = false;
    const { ctx, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
      extraMethods: {
        _seedSelection: () => {},
        select: (..._ids: any[]) => { selectCalled = true; },
      },
    });

    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    await flushAsync();

    expect(selectCalled).toBe(false);
    cleanup();
  });

  it("should persist seeded selection via post-restore save", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 10, offsetInItem: 0, total: 100, selectedIds: [42] };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
      extraMethods: { _seedSelection: () => {} },
    });

    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    // Register getSelected BEFORE flushing so getScrollSnapshot() picks it up
    methods.set("getSelected", () => [42]);

    await flushAsync();

    const stored = sessionStorage.getItem(AUTO_SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).selectedIds).toEqual([42]);
    cleanup();
  });

  it("should not seed when _seedSelection is not registered", async () => {
    clearAutoSave();
    const savedSnapshot: ScrollSnapshot = { index: 10, offsetInItem: 0, total: 100, selectedIds: [42] };
    sessionStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(savedSnapshot));

    let selectCalled = false;
    const { ctx, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 0,
      itemHeight: 48,
      extraMethods: {
        select: (..._ids: any[]) => { selectCalled = true; },
      },
    });

    const plugin = snapshots<TestItem>({ autoSave: AUTO_SAVE_KEY });
    plugin.setup(ctx);

    await flushAsync();

    // Without _seedSelection, restoreScroll gets the full snapshot and calls select()
    expect(selectCalled).toBe(true);
    cleanup();
  });
});

// =============================================================================
// snapshots — Focus Save/Restore
// =============================================================================

describe("snapshots - Focus Save/Restore", () => {
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

  it("should capture focusedId when _getFocusedId is present", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });
    methods.set("_getFocusedId", () => 42);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    expect(getSnapshot().focusedId).toBe(42);
    cleanup();
  });

  it("should capture string focusedId", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });
    methods.set("_getFocusedId", () => "abc-123");

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    expect(getSnapshot().focusedId).toBe("abc-123");
    cleanup();
  });

  it("should omit focusedId when _getFocusedId returns undefined", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });
    methods.set("_getFocusedId", () => undefined);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    expect(getSnapshot().focusedId).toBeUndefined();
    cleanup();
  });

  it("should omit focusedId when no selection plugin present", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    expect(getSnapshot().focusedId).toBeUndefined();
    cleanup();
  });

  it("should omit focusedId when totalItems is 0 (early return path)", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 0 });
    methods.set("_getFocusedId", () => 42);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    // totalItems=0 returns early — focusedId is not captured
    expect(getSnapshot().focusedId).toBeUndefined();
    cleanup();
  });

  it("should include focusedId alongside selectedIds in snapshot", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });
    methods.set("getSelected", () => [3, 7]);
    methods.set("_getFocusedId", () => 7);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();
    expect(snapshot.selectedIds).toEqual([3, 7]);
    expect(snapshot.focusedId).toBe(7);
    cleanup();
  });

  it("should call _focusById via rAF after sync restore", () => {
    const focusByIdFn = mock((_id: string | number) => {});
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("_focusById", focusByIdFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 0, focusedId: 42 });

    // rAF is synchronous in this describe block
    expect(focusByIdFn).toHaveBeenCalledWith(42);
    cleanup();
  });

  it("should not call _focusById when snapshot has no focusedId", () => {
    const focusByIdFn = mock((_id: string | number) => {});
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });
    methods.set("_focusById", focusByIdFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 0 });

    expect(focusByIdFn).not.toHaveBeenCalled();
    cleanup();
  });

  it("should not crash when _focusById is absent and focusedId is present", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    expect(() => restore({ index: 5, offsetInItem: 0, focusedId: 42 })).not.toThrow();
    cleanup();
  });

  it("should call _focusById after loadVisibleRange resolves", async () => {
    const focusByIdFn = mock((_id: string | number) => {});
    const loadVisibleFn = mock(async () => {});

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48, containerSize: 500 });
    methods.set("_focusById", focusByIdFn);
    methods.set("loadVisibleRange", loadVisibleFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 0, focusedId: 42 });

    await flushAsync();

    expect(loadVisibleFn).toHaveBeenCalled();
    expect(focusByIdFn).toHaveBeenCalledWith(42);
    cleanup();
  });

  it("should not call _focusById after loadVisibleRange when focusedId absent", async () => {
    const focusByIdFn = mock((_id: string | number) => {});
    const loadVisibleFn = mock(async () => {});

    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, itemHeight: 48, containerSize: 500 });
    methods.set("_focusById", focusByIdFn);
    methods.set("loadVisibleRange", loadVisibleFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({ index: 5, offsetInItem: 0 }); // no focusedId

    await flushAsync();

    expect(loadVisibleFn).toHaveBeenCalled();
    expect(focusByIdFn).not.toHaveBeenCalled();
    cleanup();
  });

  it("should preserve focusedId through JSON serialization roundtrip", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 240 });
    methods.set("_getFocusedId", () => 99);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    const parsed: ScrollSnapshot = JSON.parse(JSON.stringify(snapshot));
    expect(parsed.focusedId).toBe(99);
    cleanup();
  });
});

// =============================================================================
// snapshots — Cross-Mode Snapshot (dataIndex, dataTotal, offsetRatio)
// =============================================================================

describe("snapshots - Cross-Mode Snapshot Fields", () => {
  it("should include dataIndex when _layoutToDataIndex is registered", () => {
    const COLUMNS = 4;
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 25, // 25 rows (grid virtual total)
      scrollTop: 240, // index 5 at 48px/row
      itemHeight: 48,
      extraMethods: {
        _layoutToDataIndex: (rowIndex: number) => rowIndex * COLUMNS,
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.dataIndex).toBe(5 * COLUMNS); // row 5 → data index 20
    cleanup();
  });

  it("should include dataTotal when _getTotal is registered", () => {
    const DATA_TOTAL = 100;
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 25,
      scrollTop: 0,
      extraMethods: {
        _getTotal: () => DATA_TOTAL,
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.dataTotal).toBe(DATA_TOTAL);
    cleanup();
  });

  it("should include offsetRatio as fraction of item size", () => {
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 100,
      scrollTop: 260, // index 5 (5*48=240), offset 20 within item
      itemHeight: 48,
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(5);
    expect(snapshot.offsetInItem).toBe(20);
    expect(snapshot.offsetRatio).toBeCloseTo(20 / 48);
    cleanup();
  });

  it("should not include dataIndex when no _layoutToDataIndex", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.dataIndex).toBeUndefined();
    cleanup();
  });

  it("should not include dataTotal when no _getTotal", () => {
    const { ctx, methods, cleanup } = createMockContext({ totalItems: 100, scrollTop: 0 });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.dataTotal).toBeUndefined();
    cleanup();
  });

  it("should include all cross-mode fields together (grid scenario)", () => {
    const COLUMNS = 4;
    const DATA_TOTAL = 100;
    const ROW_HEIGHT = 200;
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 25,
      scrollTop: 450, // row 2 (2*200=400), offset 50
      itemHeight: ROW_HEIGHT,
      extraMethods: {
        _layoutToDataIndex: (rowIndex: number) => rowIndex * COLUMNS,
        _getTotal: () => DATA_TOTAL,
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(2);
    expect(snapshot.offsetInItem).toBe(50);
    expect(snapshot.dataIndex).toBe(8); // row 2 * 4 cols
    expect(snapshot.dataTotal).toBe(100);
    expect(snapshot.offsetRatio).toBeCloseTo(50 / 200);
    cleanup();
  });
});

// =============================================================================
// snapshots — Cross-Mode restoreScroll
// =============================================================================

describe("snapshots - Cross-Mode restoreScroll", () => {
  it("should convert dataIndex via _dataToLayoutIndex (grid→grid)", () => {
    const COLUMNS = 4;
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 25,
      itemHeight: 200,
      extraMethods: {
        _dataToLayoutIndex: (dataIndex: number) => Math.floor(dataIndex / COLUMNS),
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 2,
      offsetInItem: 50,
      total: 25,
      dataIndex: 8, // data item 8 → row 2
      dataTotal: 100,
      offsetRatio: 0.25,
    });

    // row 2, offset = 0.25 * 200 = 50
    expect(scrollCalls[0]).toBe(2 * 200 + 50);
    cleanup();
  });

  it("should convert dataIndex via _dataToLayoutIndex (grid→list)", () => {
    // Restoring a grid snapshot into a list view.
    // dataIndex 8 → list index 8 (1:1 in list), offset = 0.25 * 56 = 14
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 56,
      // No _dataToLayoutIndex → list mode (no conversion)
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 2, // original grid row
      offsetInItem: 50,
      total: 25,
      dataIndex: 8,
      dataTotal: 100,
      offsetRatio: 0.25,
    });

    // Case 2: dataIndex present, no _dataToLayoutIndex → use dataIndex directly
    // index 8, offset = 0.25 * 56 = 14
    expect(scrollCalls[0]).toBe(8 * 56 + 14);
    cleanup();
  });

  it("should convert dataIndex via _dataToLayoutIndex (list→grid)", () => {
    // Restoring a list snapshot into a grid view.
    // Case 3: no dataIndex, _dataToLayoutIndex exists → treat index as data index
    // index 8 → row 2, offset = 0.5 * 200 = 100
    const COLUMNS = 4;
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 25,
      itemHeight: 200,
      extraMethods: {
        _dataToLayoutIndex: (dataIndex: number) => Math.floor(dataIndex / COLUMNS),
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 8, // original list index (no dataIndex)
      offsetInItem: 28, // 0.5 * 56
      total: 100,
      offsetRatio: 0.5,
    });

    // index 8 → row 2 via _dataToLayoutIndex, offset = 0.5 * 200 = 100
    expect(scrollCalls[0]).toBe(2 * 200 + 100);
    cleanup();
  });

  it("should use raw index when neither dataIndex nor _dataToLayoutIndex (list→list)", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 56,
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 10,
      offsetInItem: 20,
      total: 100,
      offsetRatio: 20 / 56,
    });

    expect(scrollCalls[0]).toBeCloseTo(10 * 56 + 20);
    cleanup();
  });

  it("should use offsetRatio * currentItemSize for cross-mode offset", () => {
    // Snapshot from grid (200px rows), restoring to list (56px items)
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 56,
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 5,
      offsetInItem: 100, // from 200px grid row
      total: 100,
      dataIndex: 5,
      offsetRatio: 0.5, // halfway through the item
    });

    // offset = 0.5 * 56 = 28, not the raw 100
    expect(scrollCalls[0]).toBe(5 * 56 + 28);
    cleanup();
  });

  it("should fall back to clamped offsetInItem when offsetRatio is absent", () => {
    const { ctx, methods, scrollCalls, cleanup } = createMockContext({
      totalItems: 100,
      itemHeight: 56,
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 5,
      offsetInItem: 100, // larger than item size (56)
      total: 100,
    });

    // clamped to min(100, 56) = 56
    expect(scrollCalls[0]).toBe(5 * 56 + 56);
    cleanup();
  });

  it("should use dataTotal for bootstrap when total is 0", () => {
    const { ctx, methods, engineState, cleanup } = createMockContext({
      totalItems: 0,
      itemHeight: 56,
      sizeCacheTotal: 0,
    });

    const setTotalFn = mock((t: number) => { engineState.totalItems = t; });
    methods.set("_setTotal", setTotalFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 2,
      offsetInItem: 50,
      total: 25, // grid row count — wrong for bootstrap
      dataTotal: 100, // actual item count — correct for bootstrap
      dataIndex: 8,
      offsetRatio: 0.25,
    });

    // Should have called _setTotal with dataTotal (100), not total (25)
    expect(setTotalFn).toHaveBeenCalledWith(100);
    cleanup();
  });

  it("should fall back to snapshot.total for bootstrap when dataTotal absent", () => {
    const { ctx, methods, engineState, cleanup } = createMockContext({
      totalItems: 0,
      itemHeight: 56,
      sizeCacheTotal: 0,
    });

    const setTotalFn = mock((t: number) => { engineState.totalItems = t; });
    methods.set("_setTotal", setTotalFn);

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const restore = methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore({
      index: 10,
      offsetInItem: 20,
      total: 100,
    });

    expect(setTotalFn).toHaveBeenCalledWith(100);
    cleanup();
  });

  it("should preserve cross-mode fields through JSON serialization", () => {
    const COLUMNS = 4;
    const { ctx, methods, cleanup } = createMockContext({
      totalItems: 25,
      scrollTop: 450,
      itemHeight: 200,
      extraMethods: {
        _layoutToDataIndex: (rowIndex: number) => rowIndex * COLUMNS,
        _getTotal: () => 100,
      },
    });

    const plugin = snapshots<TestItem>();
    plugin.setup(ctx);

    const getSnapshot = methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();
    const parsed: ScrollSnapshot = JSON.parse(JSON.stringify(snapshot));

    expect(parsed.dataIndex).toBe(snapshot.dataIndex);
    expect(parsed.dataTotal).toBe(snapshot.dataTotal);
    expect(parsed.offsetRatio).toBeCloseTo(snapshot.offsetRatio!);
    cleanup();
  });

  it("should roundtrip correctly from grid save to list restore", () => {
    const COLUMNS = 4;
    const GRID_ROW_HEIGHT = 200;
    const LIST_ITEM_HEIGHT = 56;

    // 1. Save snapshot in grid mode (25 rows of 200px, scrolled to row 3)
    const gridCtx = createMockContext({
      totalItems: 25,
      scrollTop: 3 * GRID_ROW_HEIGHT + 60, // row 3, 60px into it
      itemHeight: GRID_ROW_HEIGHT,
      extraMethods: {
        _layoutToDataIndex: (rowIndex: number) => rowIndex * COLUMNS,
        _getTotal: () => 100,
      },
    });

    const gridPlugin = snapshots<TestItem>();
    gridPlugin.setup(gridCtx.ctx);

    const getSnapshot = gridCtx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(3);
    expect(snapshot.dataIndex).toBe(12); // row 3 * 4 cols
    expect(snapshot.dataTotal).toBe(100);
    expect(snapshot.offsetRatio).toBeCloseTo(60 / GRID_ROW_HEIGHT);
    gridCtx.cleanup();

    // 2. Restore in list mode (100 items of 56px, no grid conversion)
    const listCtx = createMockContext({
      totalItems: 100,
      itemHeight: LIST_ITEM_HEIGHT,
    });

    const listPlugin = snapshots<TestItem>();
    listPlugin.setup(listCtx.ctx);

    const restore = listCtx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore(JSON.parse(JSON.stringify(snapshot)));

    // Case 2: dataIndex=12 present, no _dataToLayoutIndex → use dataIndex directly
    // offset = offsetRatio * 56 = (60/200) * 56 = 16.8
    const expectedOffset = (60 / GRID_ROW_HEIGHT) * LIST_ITEM_HEIGHT;
    expect(listCtx.scrollCalls[0]).toBeCloseTo(12 * LIST_ITEM_HEIGHT + expectedOffset);
    listCtx.cleanup();
  });

  it("should roundtrip correctly from list save to grid restore", () => {
    const COLUMNS = 4;
    const GRID_ROW_HEIGHT = 200;
    const LIST_ITEM_HEIGHT = 56;

    // 1. Save snapshot in list mode (100 items, scrolled to item 12)
    const listCtx = createMockContext({
      totalItems: 100,
      scrollTop: 12 * LIST_ITEM_HEIGHT + 28, // item 12, 28px offset (half)
      itemHeight: LIST_ITEM_HEIGHT,
    });

    const listPlugin = snapshots<TestItem>();
    listPlugin.setup(listCtx.ctx);

    const getSnapshot = listCtx.methods.get("getScrollSnapshot") as () => ScrollSnapshot;
    const snapshot = getSnapshot();

    expect(snapshot.index).toBe(12);
    expect(snapshot.offsetRatio).toBeCloseTo(28 / LIST_ITEM_HEIGHT);
    expect(snapshot.dataIndex).toBeUndefined(); // no grid in list mode
    listCtx.cleanup();

    // 2. Restore in grid mode (25 rows, _dataToLayoutIndex converts)
    const gridCtx = createMockContext({
      totalItems: 25,
      itemHeight: GRID_ROW_HEIGHT,
      extraMethods: {
        _dataToLayoutIndex: (dataIndex: number) => Math.floor(dataIndex / COLUMNS),
      },
    });

    const gridPlugin = snapshots<TestItem>();
    gridPlugin.setup(gridCtx.ctx);

    const restore = gridCtx.methods.get("restoreScroll") as (s: ScrollSnapshot) => void;
    restore(JSON.parse(JSON.stringify(snapshot)));

    // Case 3: no dataIndex, _dataToLayoutIndex exists → treat index (12) as data index
    // 12 / 4 = row 3, offset = (28/56) * 200 = 100
    const expectedRow = Math.floor(12 / COLUMNS);
    const expectedOffset = (28 / LIST_ITEM_HEIGHT) * GRID_ROW_HEIGHT;
    expect(gridCtx.scrollCalls[0]).toBeCloseTo(expectedRow * GRID_ROW_HEIGHT + expectedOffset);
    gridCtx.cleanup();
  });
});
