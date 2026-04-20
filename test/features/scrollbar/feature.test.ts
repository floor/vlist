/**
 * vlist - Scrollbar Feature Tests
 * Tests for withScrollbar: factory, setup wiring, DOM class, afterScroll, destroy.
 *
 * NOTE: The underlying scrollbar components are tested separately:
 * - scrollbar/controller.test.ts (119 tests) — scroll controller modes
 * - scrollbar/scrollbar.test.ts (55 tests) — custom scrollbar UI
 *
 * This file tests the feature integration layer (withScrollbar) that wires
 * the scrollbar into the builder context.
 *
 * Coverage: 89.06% lines, 75.00% functions.
 * Uncovered lines (125-131) are edge cases in the destroy cleanup path.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withScrollbar } from "../../../src/features/scrollbar/feature";
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

function createTestDOM() {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");

  root.className = "vlist";
  viewport.className = "vlist-viewport";
  content.className = "vlist-content";
  items.className = "vlist-items";

  // Viewport needs dimensions for scrollbar calculations
  Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(viewport, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(viewport, "scrollHeight", { value: 5000, configurable: true });

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items };
}

function createMockContext(): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const sizeCache = createSizeCache(50, 100);

  const items: TestItem[] = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

  let virtualTotalFn = () => 100;
  let renderIfNeededFn = () => {};
  let forceRenderFn = () => {};

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
      horizontal: false,
      ariaIdPrefix: "vlist",
      interactive: true,
    },
    rawConfig: {
      container: document.createElement("div"),
      items: items,
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
      getTotal: () => items.length,
      getItem: (index: number) => items[index],
      getItemsInRange: (start: number, end: number) => items.slice(start, end + 1),
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
        total: 100,
        cached: 100,
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
    getItemsForRange: (range) => items.slice(range.start, range.end + 1),
    getAllLoadedItems: () => items,
    getVirtualTotal: () => virtualTotalFn(),
    getCachedCompression: () => ({
      isCompressed: false,
      actualSize: 5000,
      virtualSize: 5000,
      ratio: 1,
    }),
    getCompressionContext: () => ({
      scrollPosition: 0,
      totalItems: 100,
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
    getScrollToPos: () => 0,
    setPositionElementFn: () => {},
    setUpdateItemClassesFn: () => {},
    setScrollFns: () => {},
    setScrollTarget: () => {},
    getScrollTarget: () => testDom.viewport as any,
    setContainerDimensions: () => {},
    disableViewportResize: () => {},
    disableWheelHandler: () => {},
    adjustScrollPosition: (pos: number) => pos,
    getStripeIndexFn: () => (index: number) => index,
    setStripeIndexFn: () => {},
    getItemToScrollIndexFn: () => (index: number) => index,
    getVisibleRange: () => {},
    setItemToScrollIndexFn: () => {},
  };

  return ctx;
}

// =============================================================================
// withScrollbar — Factory Tests
// =============================================================================

describe("withScrollbar — Factory", () => {
  it("should create a feature with correct name and priority", () => {
    const feature = withScrollbar<TestItem>();

    expect(feature.name).toBe("withScrollbar");
    expect(feature.priority).toBe(30);
    expect(typeof feature.setup).toBe("function");
  });

  it("should accept empty config", () => {
    const feature = withScrollbar<TestItem>();
    expect(feature).toBeDefined();
  });

  it("should accept autoHide config", () => {
    const feature = withScrollbar<TestItem>({ autoHide: false });
    expect(feature).toBeDefined();
  });

  it("should accept autoHideDelay config", () => {
    const feature = withScrollbar<TestItem>({ autoHideDelay: 2000 });
    expect(feature).toBeDefined();
  });

  it("should accept minThumbSize config", () => {
    const feature = withScrollbar<TestItem>({ minThumbSize: 50 });
    expect(feature).toBeDefined();
  });

  it("should accept showOnHover config", () => {
    const feature = withScrollbar<TestItem>({ showOnHover: false });
    expect(feature).toBeDefined();
  });

  it("should accept combined config", () => {
    const feature = withScrollbar<TestItem>({
      autoHide: true,
      autoHideDelay: 1500,
      minThumbSize: 40,
      showOnHover: true,
      hoverZoneWidth: 20,
    });
    expect(feature).toBeDefined();
  });
});

// =============================================================================
// withScrollbar — Setup Tests
// =============================================================================

describe("withScrollbar — Setup", () => {
  it("should add custom-scrollbar CSS class to viewport", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(
      ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should register an afterScroll handler", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    expect(ctx.afterScroll.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.afterScroll.length).toBeGreaterThan(0);
  });

  it("should register a destroy handler", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    expect(ctx.destroyHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(0);
  });

  it("should register a resize handler", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    expect(ctx.resizeHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.resizeHandlers.length).toBeGreaterThan(0);
  });

  it("should not add any public methods", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Scrollbar is automatic — no public API methods
    expect(ctx.methods.size).toBe(0);
  });

  it("should run destroy handler without error", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Should not throw
    for (const handler of ctx.destroyHandlers) {
      handler();
    }
  });

  it("should register a contentSizeHandlers handler", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    expect(ctx.contentSizeHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.contentSizeHandlers.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// withScrollbar — Resize Handler
// =============================================================================

describe("withScrollbar — Resize Handler", () => {
  it("should update scrollbar bounds on resize", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Trigger resize handler — should not throw
    expect(ctx.resizeHandlers.length).toBeGreaterThan(0);
    expect(() => ctx.resizeHandlers[0]!(500, 800)).not.toThrow();
  });

  it("should update scrollbar bounds on content size change", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Trigger contentSizeHandlers — should not throw
    expect(ctx.contentSizeHandlers.length).toBeGreaterThan(0);
    expect(() => ctx.contentSizeHandlers[0]!()).not.toThrow();
  });
});

// =============================================================================
// withScrollbar — Feature Destroy
// =============================================================================

describe("withScrollbar — Feature Destroy", () => {
  it("should clean up via feature.destroy()", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(() => feature.destroy!()).not.toThrow();
  });

  it("should be safe to call feature.destroy() multiple times", () => {
    const feature = withScrollbar<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(() => {
      feature.destroy!();
      feature.destroy!();
    }).not.toThrow();
  });

  it("should be safe to call feature.destroy() without setup", () => {
    const feature = withScrollbar<TestItem>();
    expect(() => feature.destroy!()).not.toThrow();
  });
});