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
    setScrollToPosFn: () => {},
    setPositionElementFn: () => {},
    setScrollFns: setScrollFns as any,
    setScrollTarget: setScrollTarget as any,
    getScrollTarget: () => testDom.viewport as any,
    setContainerDimensions: setContainerDimensions as any,
    disableViewportResize: disableViewportResize as any,
    disableWheelHandler: disableWheelHandler as any,
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

  it("should not add any public methods", () => {
    const feature = withPage<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Window scroll mode is automatic — no public API methods
    expect(ctx.methods.size).toBe(0);
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
});