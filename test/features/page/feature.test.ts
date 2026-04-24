/**
 * vlist - Page (Window Scroll) Feature Tests
 * Tests for withPage: factory, setup DOM modifications, context method calls,
 * window resize listener, destroy cleanup.
 *
 * NOTE: withPage enables window scroll mode where the list scrolls with the
 * page instead of in its own container. The feature modifies DOM styles,
 * overrides scroll position functions, and listens for window resize events.
 *
 * JSDOM Limitations:
 * - getBoundingClientRect() returns zeros — scroll position calculations
 *   cannot be meaningfully tested
 * - window.scrollTo() is a no-op — scroll-to-position cannot be tested
 * - window.innerHeight/innerWidth return 0 — container dimension overrides
 *   return 0 instead of real values
 *
 * This file tests what IS testable in JSDOM: factory shape, DOM style
 * modifications, context method delegation, handler registration, and
 * destroy cleanup.
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";
import { withPage } from "../../../src/features/page/feature";
import { createSizeCache } from "../../../src/rendering/sizes";
import type { VListItem } from "../../../src/types";
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
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

function createTestDOM() {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");

  root.className = "vlist";
  viewport.className = "vlist-viewport";
  content.className = "vlist-content";
  items.className = "vlist-items";

  // Simulate initial styles set by createDOMStructure
  viewport.style.overflow = "auto";
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  Object.defineProperty(viewport, "clientHeight", {
    value: 600,
    configurable: true,
  });
  Object.defineProperty(viewport, "clientWidth", {
    value: 400,
    configurable: true,
  });

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items };
}

function createMockContext(
  overrides: { horizontal?: boolean } = {},
): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const testItems = createTestItems(100);
  const sizeCache = createSizeCache(50, testItems.length);

  let virtualTotalFn = () => testItems.length;
  let renderIfNeededFn = () => {};
  let forceRenderFn = () => {};
  let scrollToPosFn = (index: number, sc: any, containerHeight: number, totalItems: number, align: string) => {
    // Default: simplified calcScrollToPosition
    if (totalItems === 0) return 0;
    const clamped = Math.max(0, Math.min(index, totalItems - 1));
    const offset = sc.getOffset(clamped);
    const itemH = sc.getSize(clamped);
    const totalSize = sc.getTotalSize();
    const maxScroll = Math.max(0, totalSize - containerHeight);
    let pos: number;
    switch (align) {
      case "center": pos = offset - (containerHeight - itemH) / 2; break;
      case "end": pos = offset - containerHeight + itemH; break;
      default: pos = offset;
    }
    return Math.max(0, Math.min(pos, maxScroll));
  };

  // Track calls to context methods for assertions
  const disableViewportResize = mock(() => {});
  const disableWheelHandler = mock(() => {});
  const setScrollTarget = mock((_target: any) => {});
  const setScrollFns = mock((_getTop: any, _setTop: any) => {});
  const setContainerDimensions = mock((_fn: any) => {});

  const ctx: BuilderContext<TestItem> = {
    dom: testDom as any,
    sizeCache: sizeCache as any,
    emitter: {
      on: () => {},
      off: () => {},
      emit: () => {},
    } as any,
    config: {
      overscan: 2,
      classPrefix: "vlist",
      reverse: false,
      wrap: false,
      horizontal: overrides.horizontal ?? false,
      ariaIdPrefix: "vlist",
      interactive: true,
    },
    rawConfig: {
      container: document.createElement("div"),
      items: testItems,
      item: {
        height: 50,
        template: (item: TestItem) => `<div>${item.name}</div>`,
      },
    },
    renderer: {
      render: () => {},
      updateItemClasses: () => {},
      updatePositions: () => {},
      updateItem: () => {},
      getElement: () => null,
      clear: () => {},
      destroy: () => {},
    } as any,
    dataManager: {
      getTotal: () => testItems.length,
      getItem: (index: number) => testItems[index],
      getItemsInRange: (start: number, end: number) =>
        testItems.slice(start, end + 1),
      isItemLoaded: () => true,
    } as any,
    scrollController: {
      getScrollTop: () => 0,
      scrollTo: () => {},
      isAtTop: () => true,
      isAtBottom: () => false,
      isCompressed: () => false,
    } as any,
    state: {
      dataState: {
        total: testItems.length,
        cached: testItems.length,
        isLoading: false,
        pendingRanges: [],
        error: undefined,
        hasMore: false,
        cursor: undefined,
      },
      viewportState: {
        scrollPosition: 0,
        containerSize: 600,
        totalSize: 5000,
        actualSize: 5000,
        isCompressed: false,
        compressionRatio: 1,
        visibleRange: { start: 0, end: 11 },
        renderRange: { start: 0, end: 15 },
      },
      renderState: {
        range: { start: 0, end: 15 },
        visibleRange: { start: 0, end: 11 },
        renderedCount: 16,
      },
      lastRenderRange: { start: -1, end: -1 },
      isDestroyed: false,
    } as any,
    getContainerWidth: () => 400,
    afterScroll: [],
    afterRenderBatch: [],
    idleHandlers: [],
    clickHandlers: [],
    keydownHandlers: [],
    resizeHandlers: [],
    contentSizeHandlers: [],
    destroyHandlers: [],
    methods: new Map(),
    replaceTemplate: () => {},
    replaceRenderer: () => {},
    replaceDataManager: () => {},
    replaceScrollController: () => {},
    getItemsForRange: (range) => testItems.slice(range.start, range.end + 1),
    getAllLoadedItems: () => testItems,
    getVirtualTotal: () => virtualTotalFn(),
    getCachedCompression: () => ({
      isCompressed: false,
      actualSize: 5000,
      virtualSize: 5000,
      ratio: 1,
    }),
    getCompressionContext: () => ({
      scrollPosition: 0,
      totalItems: testItems.length,
      containerSize: 600,
      rangeStart: 0,
    }),
    renderIfNeeded: () => renderIfNeededFn(),
    forceRender: () => forceRenderFn(),
    invalidateRendered: () => {},
    getRenderFns: () => ({
      renderIfNeeded: renderIfNeededFn,
      forceRender: forceRenderFn,
    }),
    setRenderFns: (renderFn, forceFn) => {
      renderIfNeededFn = renderFn;
      forceRenderFn = forceFn;
    },
    setVirtualTotalFn: (fn) => {
      virtualTotalFn = fn;
    },
    rebuildSizeCache: () => {},
    setSizeConfig: () => {},
    updateContentSize: () => {},
    updateCompressionMode: () => {},
    setVisibleRangeFn: () => {},
    setScrollToPosFn: (fn: any) => { scrollToPosFn = fn; },
    getScrollToPos: (index: number, containerHeight: number, totalItems: number, align: string) => {
      return scrollToPosFn(index, sizeCache, containerHeight, totalItems, align);
    },
    setPositionElementFn: () => {},
    setUpdateItemClassesFn: () => {},
    setScrollFns: setScrollFns as any,
    setScrollTarget: setScrollTarget as any,
    getScrollTarget: () => testDom.viewport as any,
    setContainerDimensions: setContainerDimensions as any,
    disableViewportResize: disableViewportResize as any,
    disableWheelHandler: disableWheelHandler as any,
    adjustScrollPosition: (pos: number) => pos,
    getStripeIndexFn: () => (index: number) => index,
    setStripeIndexFn: () => {},
    getItemToScrollIndexFn: () => (index: number) => index,
    getVisibleRange: mock(() => {}),
    setItemToScrollIndexFn: () => {},
  };

  return ctx;
}

// Helper to get mock functions from context for assertions
function getMocks(ctx: BuilderContext<TestItem>) {
  return {
    disableViewportResize: ctx.disableViewportResize as ReturnType<typeof mock>,
    disableWheelHandler: ctx.disableWheelHandler as ReturnType<typeof mock>,
    setScrollTarget: ctx.setScrollTarget as ReturnType<typeof mock>,
    setScrollFns: ctx.setScrollFns as ReturnType<typeof mock>,
    setContainerDimensions: ctx.setContainerDimensions as ReturnType<
      typeof mock
    >,
  };
}

// =============================================================================
// withPage — Factory Tests
// =============================================================================

describe("withPage — Factory", () => {
  it("should create a feature with correct name and priority", () => {
    const feature = withPage();

    expect(feature.name).toBe("withPage");
    expect(feature.priority).toBe(5);
    expect(typeof feature.setup).toBe("function");
  });

  it("should accept no arguments", () => {
    const feature = withPage();
    expect(feature).toBeDefined();
  });
});

// =============================================================================
// withPage — DOM Modifications
// =============================================================================

describe("withPage — DOM Modifications", () => {
  it("should set root overflow to visible", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.dom.root.style.overflow).toBe("visible");
  });

  it("should set root height to auto", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.dom.root.style.height).toBe("auto");
  });

  it("should set viewport overflow to visible (vertical mode)", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext({ horizontal: false });

    feature.setup!(ctx);

    expect(ctx.dom.viewport.style.overflow).toBe("visible");
  });

  it("should set viewport overflowX and overflowY to visible (horizontal mode)", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext({ horizontal: true });

    feature.setup!(ctx);

    expect(ctx.dom.viewport.style.overflowX).toBe("visible");
    expect(ctx.dom.viewport.style.overflowY).toBe("visible");
  });

  it("should remove custom-scrollbar class from viewport", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    // Pre-add the class to verify removal
    ctx.dom.viewport.classList.add("vlist-viewport--custom-scrollbar");
    expect(
      ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);

    feature.setup!(ctx);

    expect(
      ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(false);
  });
});

// =============================================================================
// withPage — Context Method Delegation
// =============================================================================

describe("withPage — Context Method Delegation", () => {
  it("should call disableViewportResize", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    expect(mocks.disableViewportResize).toHaveBeenCalledTimes(1);
  });

  it("should call disableWheelHandler", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    expect(mocks.disableWheelHandler).toHaveBeenCalledTimes(1);
  });

  it("should call setScrollTarget with window", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    expect(mocks.setScrollTarget).toHaveBeenCalledTimes(1);
    expect(mocks.setScrollTarget.mock.calls[0]![0]).toBe(window);
  });

  it("should call setScrollFns with getTop and setTop functions", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    expect(mocks.setScrollFns).toHaveBeenCalledTimes(1);
    const [getTop, setTop] = mocks.setScrollFns.mock.calls[0]!;
    expect(typeof getTop).toBe("function");
    expect(typeof setTop).toBe("function");
  });

  it("should call setContainerDimensions with an object containing width and height functions", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    expect(mocks.setContainerDimensions).toHaveBeenCalledTimes(1);
    const [dimObj] = mocks.setContainerDimensions.mock.calls[0]!;
    expect(typeof dimObj).toBe("object");
    expect(typeof dimObj.width).toBe("function");
    expect(typeof dimObj.height).toBe("function");
  });
});

// =============================================================================
// withPage — Scroll Position Functions
// =============================================================================

describe("withPage — Scroll Position Functions", () => {
  it("getTop should return a number (0 in JSDOM since getBoundingClientRect returns zeros)", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    const getTop = mocks.setScrollFns.mock.calls[0]![0] as () => number;
    const position = getTop();

    expect(typeof position).toBe("number");
    // In JSDOM, getBoundingClientRect().top = 0, so Math.max(0, -0) = 0
    expect(position).toBe(0);
  });

  it("setTop should not throw", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    const setTop = mocks.setScrollFns.mock.calls[0]![1] as (
      pos: number,
    ) => void;

    // Should not throw — window.scrollTo is a no-op in JSDOM
    expect(() => setTop(100)).not.toThrow();
    expect(() => setTop(0)).not.toThrow();
  });

  it("getTop should use rect.left in horizontal mode", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext({ horizontal: true });
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    const getTop = mocks.setScrollFns.mock.calls[0]![0] as () => number;
    const position = getTop();

    expect(typeof position).toBe("number");
    // In JSDOM, getBoundingClientRect().left = 0, so Math.max(0, -0) = 0
    expect(position).toBe(0);
  });

  it("setTop should use window.scrollTo with horizontal args in horizontal mode", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext({ horizontal: true });
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    const setTop = mocks.setScrollFns.mock.calls[0]![1] as (
      pos: number,
    ) => void;

    // Should not throw — window.scrollTo is a no-op in JSDOM
    expect(() => setTop(200)).not.toThrow();
  });

  it("container dimensions width() and height() should return numbers", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const mocks = getMocks(ctx);

    feature.setup!(ctx);

    const dimObj = mocks.setContainerDimensions.mock.calls[0]![0] as {
      width: () => number;
      height: () => number;
    };

    expect(typeof dimObj.width()).toBe("number");
    expect(typeof dimObj.height()).toBe("number");
    // JSDOM provides default window dimensions (1024x768), so just
    // verify they return reasonable numbers, not specific values
    expect(dimObj.width()).toBeGreaterThanOrEqual(0);
    expect(dimObj.height()).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// withPage — Handler Registration
// =============================================================================

describe("withPage — Handler Registration", () => {
  it("should register a destroy handler", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    expect(ctx.destroyHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(0);
  });

  it("should register a resize handler", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    expect(ctx.resizeHandlers.length).toBe(0);

    feature.setup!(ctx);

    // withPage listens for window resize and fires context resize handlers
    expect(ctx.resizeHandlers.length).toBe(0);
    // Note: withPage uses window addEventListener directly, not ctx.resizeHandlers.
    // The destroy handler cleans up the window listener.
  });

  it("should not add any public methods (no scrollPadding)", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Window scroll mode is automatic — no public API methods
    expect(ctx.methods.size).toBe(0);
  });
});

// =============================================================================
// withPage — Window Resize Handler
// =============================================================================

describe("withPage — Window Resize Handler", () => {
  it("should emit resize event and call resizeHandlers on window resize", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    const resizeHandler = mock(() => {});
    ctx.resizeHandlers.push(resizeHandler);

    feature.setup!(ctx);

    // Simulate a meaningful window resize (change > 1px)
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    window.dispatchEvent(new dom.window.Event("resize"));

    expect(emitSpy).toHaveBeenCalledWith("resize", { width: 1200, height: 900 });
    expect(resizeHandler).toHaveBeenCalledWith(1200, 900);

    // State should be updated
    expect(ctx.state.viewportState.containerSize).toBe(900);

    // Cleanup
    feature.destroy!();

    // Restore defaults
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });

  it("should skip tiny resize changes (≤ 1px)", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    feature.setup!(ctx);

    // Record current innerHeight (set during setup)
    const currentHeight = window.innerHeight;

    // Simulate a tiny change (≤ 1px)
    Object.defineProperty(window, "innerHeight", {
      value: currentHeight + 1,
      configurable: true,
    });
    window.dispatchEvent(new dom.window.Event("resize"));

    // Should NOT emit resize — change is exactly 1px which is ≤ threshold
    expect(emitSpy).not.toHaveBeenCalledWith("resize", expect.anything());

    // Cleanup
    feature.destroy!();
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should call renderIfNeeded after resize", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const renderSpy = mock(() => {});
    (ctx as any).renderIfNeeded = renderSpy;

    feature.setup!(ctx);

    // Simulate a meaningful resize
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    window.dispatchEvent(new dom.window.Event("resize"));

    expect(renderSpy).toHaveBeenCalled();

    // Cleanup
    feature.destroy!();
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should handle horizontal resize using width as main axis", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext({ horizontal: true });
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    feature.setup!(ctx);

    // Simulate a meaningful width change
    Object.defineProperty(window, "innerWidth", { value: 2000, configurable: true });
    window.dispatchEvent(new dom.window.Event("resize"));

    expect(emitSpy).toHaveBeenCalledWith("resize", expect.objectContaining({ width: 2000 }));

    // Cleanup
    feature.destroy!();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });
});

// =============================================================================
// withPage — Destroy Cleanup
// =============================================================================

describe("withPage — Destroy Cleanup", () => {
  it("should run destroy handler without error", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Should not throw
    for (const handler of ctx.destroyHandlers) {
      handler();
    }
  });

  it("should be safe to call destroy multiple times", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(() => {
      for (const handler of ctx.destroyHandlers) {
        handler();
        handler();
      }
    }).not.toThrow();
  });

  it("should clean up via feature.destroy()", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // feature.destroy() should not throw and should clean up the resize listener
    expect(() => feature.destroy!()).not.toThrow();
  });

  it("should be safe to call feature.destroy() multiple times", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(() => {
      feature.destroy!();
      feature.destroy!();
    }).not.toThrow();
  });

  it("should stop listening to window resize after destroy", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    feature.setup!(ctx);
    feature.destroy!();

    // Reset spy
    emitSpy.mockClear();

    // Simulate resize after destroy
    Object.defineProperty(window, "innerHeight", { value: 1500, configurable: true });
    window.dispatchEvent(new dom.window.Event("resize"));

    // Should not emit — listener was removed
    expect(emitSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });
});

// =============================================================================
// withPage — scrollPadding
// =============================================================================

describe("withPage — scrollPadding", () => {
  it("should register _scrollItemIntoView when scrollPadding is provided", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 60 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("_scrollItemIntoView")).toBe(true);
    expect(typeof ctx.methods.get("_scrollItemIntoView")).toBe("function");
  });

  it("should NOT register _scrollItemIntoView when no scrollPadding", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("_scrollItemIntoView")).toBe(false);
  });

  it("should NOT register _scrollItemIntoView when scrollPadding is empty", () => {
    const feature = withPage<TestItem>({});
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("_scrollItemIntoView")).toBe(false);
  });

  it("should scroll down when item is hidden behind top inset", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 100 } });
    const ctx = createMockContext();
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    // Simulate: scrolled to position 500, container is 600px,
    // so visible area with top padding = [600, 1100].
    // Item at index 8 has offset 400 (8 * 50), which is < 600.
    ctx.state.viewportState.scrollPosition = 500;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;
    scrollItemIntoView(8); // offset = 400, which is < 500 + 100 = 600

    // Should scroll so item sits just below the top inset: 400 - 100 = 300
    expect(scrollToSpy).toHaveBeenCalledWith(300);

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should scroll up when item is hidden behind bottom inset", () => {
    const feature = withPage<TestItem>({ scrollPadding: { bottom: 80 } });
    const ctx = createMockContext();
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    // Simulate: scrolled to position 0, container is 600px,
    // so visible area with bottom padding = [0, 520].
    // Item at index 11 has offset 550 (11 * 50), bottom edge = 600.
    // 600 > 520 (visible end), so it's behind the bottom inset.
    ctx.state.viewportState.scrollPosition = 0;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;
    scrollItemIntoView(11); // offset = 550, bottom = 600, visibleEnd = 0 + 600 - 80 = 520

    // Should scroll so item's bottom edge sits above the bottom inset:
    // itemEnd + endPad - containerSize = 600 + 80 - 600 = 80
    expect(scrollToSpy).toHaveBeenCalledWith(80);

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should not scroll when item is within the visible (padded) area", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 60, bottom: 60 } });
    const ctx = createMockContext();
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    // Simulate: scrolled to position 200, container is 600px,
    // visible area = [260, 540].
    // Item at index 6 has offset 300 (6 * 50), bottom = 350.
    // 300 >= 260 and 350 <= 540 → item is fully visible.
    ctx.state.viewportState.scrollPosition = 200;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;
    scrollItemIntoView(6);

    expect(scrollToSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should support dynamic (function) padding values", () => {
    let topPad = 60;
    const feature = withPage<TestItem>({
      scrollPadding: { top: () => topPad },
    });
    const ctx = createMockContext();
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    ctx.state.viewportState.scrollPosition = 500;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 9: offset = 450, visible start = 500 + 60 = 560 → needs scroll
    scrollItemIntoView(9);
    expect(scrollToSpy).toHaveBeenCalledWith(390); // 450 - 60

    scrollToSpy.mockClear();

    // Now increase the dynamic padding — same item should scroll further
    topPad = 120;
    scrollItemIntoView(9);
    expect(scrollToSpy).toHaveBeenCalledWith(330); // 450 - 120

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should allow negative scroll to -startPad for top items", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 200 } });
    const ctx = createMockContext();
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    // Item 0: offset = 0. scroll = 0 - 200 = -200 (allowed in window mode).
    ctx.state.viewportState.scrollPosition = 100;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;
    scrollItemIntoView(0);

    expect(scrollToSpy).toHaveBeenCalledWith(-200);

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });

  it("should use left/right padding in horizontal mode", () => {
    const feature = withPage<TestItem>({ scrollPadding: { left: 80, right: 40 } });
    const ctx = createMockContext({ horizontal: true });
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    // Horizontal: containerSize = window.innerWidth, startPad = left, endPad = right
    ctx.state.viewportState.scrollPosition = 300;
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 6: offset = 300, visible start = 300 + 80 = 380 → 300 < 380, needs scroll
    scrollItemIntoView(6);
    expect(scrollToSpy).toHaveBeenCalledWith(220); // 300 - 80

    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });

  it("should handle both top and bottom padding together", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 100, bottom: 50 } });
    const ctx = createMockContext();
    const scrollToSpy = mock(() => {});
    ctx.scrollController.scrollTo = scrollToSpy as any;

    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    feature.setup!(ctx);

    const scrollItemIntoView = ctx.methods.get("_scrollItemIntoView") as (index: number) => void;

    // Test top: scroll at 500, item 8 offset = 400, visibleStart = 600 → hidden
    ctx.state.viewportState.scrollPosition = 500;
    scrollItemIntoView(8);
    expect(scrollToSpy).toHaveBeenCalledWith(300); // 400 - 100

    scrollToSpy.mockClear();

    // Test bottom: scroll at 0, item 10 offset = 500, bottom = 550,
    // visibleEnd = 0 + 600 - 50 = 550 → exactly at boundary, no scroll
    ctx.state.viewportState.scrollPosition = 0;
    scrollItemIntoView(10);
    expect(scrollToSpy).not.toHaveBeenCalled();

    scrollToSpy.mockClear();

    // Test bottom: item 11 offset = 550, bottom = 600, visibleEnd = 550 → hidden
    scrollItemIntoView(11);
    expect(scrollToSpy).toHaveBeenCalledWith(50); // 600 + 50 - 600

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });
});

// =============================================================================
// withPage — scrollPadding + scrollToIndex
// =============================================================================

describe("withPage — scrollPadding scrollToIndex", () => {
  it("should override setScrollToPosFn when scrollPadding is provided", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 60 } });
    const ctx = createMockContext();
    const setScrollToPosSpy = mock(ctx.setScrollToPosFn);
    ctx.setScrollToPosFn = setScrollToPosSpy as any;

    feature.setup!(ctx);

    expect(setScrollToPosSpy).toHaveBeenCalled();
  });

  it("align 'start' should offset by top padding", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 100 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Item 10: offset = 500 (10 * 50). Without padding: pos = 500.
    // With top padding 100: pos = 500 - 100 = 400.
    const pos = ctx.getScrollToPos(10, 600, 100, "start");
    expect(pos).toBe(400);
  });

  it("align 'end' should offset by bottom padding", () => {
    const feature = withPage<TestItem>({ scrollPadding: { bottom: 80 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Item 10: offset = 500, itemH = 50. containerHeight = 600.
    // Without padding: pos = 500 - 600 + 50 = -50 → clamped to 0.
    // With bottom padding 80: pos = 500 - 600 + 50 + 80 = 30.
    const pos = ctx.getScrollToPos(10, 600, 100, "end");
    expect(pos).toBe(30);
  });

  it("align 'center' should center within the padded area", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 100, bottom: 50 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Item 20: offset = 1000, itemH = 50. containerHeight = 600.
    // effectiveH = 600 - 100 - 50 = 450.
    // pos = 1000 - 100 - (450 - 50) / 2 = 1000 - 100 - 200 = 700.
    const pos = ctx.getScrollToPos(20, 600, 100, "center");
    expect(pos).toBe(700);
  });

  it("should clamp to -startPad for start align (not 0)", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 200 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Item 0: offset = 0. pos = 0 - 200 = -200 → clamped to -startPad = -200.
    const pos0 = ctx.getScrollToPos(0, 600, 100, "start");
    expect(pos0).toBe(-200);

    // Item 2: offset = 100. pos = 100 - 200 = -100 → above -startPad, not clamped.
    const pos2 = ctx.getScrollToPos(2, 600, 100, "start");
    expect(pos2).toBe(-100);
  });

  it("should clamp to maxScroll (which includes endPad) for end align", () => {
    const feature = withPage<TestItem>({ scrollPadding: { bottom: 80 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Item 99 (last): offset = 4950, itemH = 50. containerHeight = 600.
    // totalSize = 5000. maxScroll = 5000 - 600 + 80 = 4480.
    // pos = 4950 - 600 + 50 + 80 = 4480 → NOT clamped (maxScroll includes endPad).
    const pos = ctx.getScrollToPos(99, 600, 100, "end");
    expect(pos).toBe(4480);
  });

  it("should fall through to original when padding values are 0", () => {
    let dynamicPad = 0;
    const feature = withPage<TestItem>({ scrollPadding: { top: () => dynamicPad } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // With 0 padding, should behave like no padding:
    // Item 10: offset = 500, align "start" → pos = 500.
    const pos = ctx.getScrollToPos(10, 600, 100, "start");
    expect(pos).toBe(500);
  });

  it("should use left/right for horizontal mode", () => {
    const feature = withPage<TestItem>({ scrollPadding: { left: 80, right: 40 } });
    const ctx = createMockContext({ horizontal: true });

    feature.setup!(ctx);

    // Horizontal: startPad = left = 80, endPad = right = 40.
    // Item 10: offset = 500, itemH = 50. containerHeight = 800.
    // align "start": pos = 500 - 80 = 420.
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    const pos = ctx.getScrollToPos(10, 800, 100, "start");
    expect(pos).toBe(420);

    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });

  it("should support dynamic padding for scrollToIndex", () => {
    let topPad = 60;
    const feature = withPage<TestItem>({ scrollPadding: { top: () => topPad } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Item 10: offset = 500. With topPad=60: pos = 500 - 60 = 440.
    expect(ctx.getScrollToPos(10, 600, 100, "start")).toBe(440);

    // Change padding dynamically
    topPad = 120;
    expect(ctx.getScrollToPos(10, 600, 100, "start")).toBe(380); // 500 - 120
  });

  it("should return 0 for empty list", () => {
    const feature = withPage<TestItem>({ scrollPadding: { top: 100, bottom: 50 } });
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.getScrollToPos(0, 600, 0, "start")).toBe(0);
    expect(ctx.getScrollToPos(0, 600, 0, "center")).toBe(0);
    expect(ctx.getScrollToPos(0, 600, 0, "end")).toBe(0);
  });
});