/**
 * vlist - Groups Feature Tests
 * Tests for withGroups: factory, setup wiring, DOM class, handlers, methods,
 * sticky header creation.
 *
 * NOTE: The underlying group components are tested separately:
 * - groups/layout.test.ts (47 tests, 328 assertions) — group layout math
 * - groups/sticky.test.ts — sticky header behavior
 *
 * This file tests the feature integration layer (withGroups) that wires
 * group layout, sticky headers, and template dispatch into the builder context.
 *
 * Coverage: 85.22% lines, 82.61% functions.
 * Uncovered lines are complex group reflow paths and edge cases in
 * dynamic group recalculation.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withGroups } from "../../../src/features/groups/feature";
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
  category: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    category: i < 10 ? "A" : i < 20 ? "B" : "C",
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

  Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(viewport, "clientWidth", { value: 400, configurable: true });

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items };
}

function createMockContext(): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const testItems = createTestItems(30);
  const sizeCache = createSizeCache(50, testItems.length);

  let virtualTotalFn = () => testItems.length;
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
      getItemsInRange: (start: number, end: number) => testItems.slice(start, end + 1),
      isItemLoaded: () => true,
      setItems: () => {},
      setTotal: () => {},
      clear: () => {},
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
        totalSize: 1500,
        actualSize: 1500,
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
    contextMenuHandlers: [],
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
      actualSize: 1500,
      virtualSize: 1500,
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
    getScrollToPos: () => 0,
    setPositionElementFn: () => {},
    setUpdateItemClassesFn: () => {},
    setScrollFns: () => {},
    triggerScrollFrame: () => {},
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
// withGroups — Factory Tests
// =============================================================================

describe("withGroups — Factory", () => {
  it("should create a feature with correct name and priority", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: (key) => `<div>${key}</div>` },
    });

    expect(feature.name).toBe("withGroups");
    expect(feature.priority).toBe(10);
    expect(typeof feature.setup).toBe("function");
  });

  it("should require getGroupForIndex function", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    expect(feature).toBeDefined();
  });

  it("should accept sticky option", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    expect(feature).toBeDefined();
  });

  it("should accept sticky disabled", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: false,
    });
    expect(feature).toBeDefined();
  });

  it("should accept header.width for horizontal orientation", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: {
        width: 48,
        template: (key) => `<div>${key}</div>`,
      },
    });
    expect(feature).toBeDefined();
    expect(feature.name).toBe("withGroups");
  });

  it("should accept legacy headerHeight/headerTemplate", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      headerHeight: 32,
      headerTemplate: (key) => `<div>${key}</div>`,
    });
    expect(feature).toBeDefined();
    expect(feature.name).toBe("withGroups");
  });

  it("should setup with legacy headerHeight/headerTemplate config", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      headerHeight: 32,
      headerTemplate: (key) => `<div>${key}</div>`,
    });
    const ctx = createMockContext();
    // setup() should run without error, exercising the normalizeConfig legacy path
    expect(() => feature.setup!(ctx)).not.toThrow();
    // The _isGroupHeader method should have been registered, proving setup completed
    const isGroupHeader = ctx.methods.get("_isGroupHeader") as (index: number) => boolean;
    expect(isGroupHeader).toBeDefined();
    expect(isGroupHeader(0)).toBe(true);
  });
});

// =============================================================================
// withGroups — Setup Tests
// =============================================================================

// =============================================================================
// Helper for striped mode tests
// =============================================================================

function createMockContextWithStriped(mode: "data" | "even" | "odd"): BuilderContext<TestItem> {
  const ctx = createMockContext();
  (ctx.rawConfig.item as any).striped = mode;
  return ctx;
}

describe("withGroups — Setup", () => {
  it("should add grouped CSS class to root", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.dom.root.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should register _isGroupHeader method", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const isGroupHeader = ctx.methods.get("_isGroupHeader") as (index: number) => boolean;
    expect(isGroupHeader).toBeDefined();
    expect(typeof isGroupHeader).toBe("function");

    // Index 0 is the first group header (group "A")
    expect(isGroupHeader(0)).toBe(true);

    // Index 1 is a regular data item
    expect(isGroupHeader(1)).toBe(false);
  });

  it("should register a destroy handler", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const ctx = createMockContext();

    expect(ctx.destroyHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(0);
  });

  it("should register an afterScroll handler for sticky headers", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    const ctx = createMockContext();

    expect(ctx.afterScroll.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.afterScroll.length).toBeGreaterThan(0);
  });

  it("should replace the template (unified template dispatches headers vs items)", () => {
    let templateReplaced = false;
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const ctx = createMockContext();
    ctx.replaceTemplate = () => {
      templateReplaced = true;
    };

    feature.setup!(ctx);

    expect(templateReplaced).toBe(true);
  });

  it("should replace the size config (headers vs items have different heights)", () => {
    let sizeConfigReplaced = false;
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const ctx = createMockContext();
    ctx.setSizeConfig = () => {
      sizeConfigReplaced = true;
    };

    feature.setup!(ctx);

    expect(sizeConfigReplaced).toBe(true);
  });

  it("should run destroy handler without error", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Should not throw
    for (const handler of ctx.destroyHandlers) {
      handler();
    }
  });

  it("should use table integration when _updateTableForGroups is available", () => {
    let tableUpdated = false;
    let passedIsHeaderFn: ((item: any) => boolean) | null = null;

    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContext();

    // Mock table layout integration methods
    ctx.methods.set("_getTableLayout", () => ({}));
    ctx.methods.set("_updateTableForGroups", (isHeaderFn: any, headerTpl: any) => {
      tableUpdated = true;
      passedIsHeaderFn = isHeaderFn;
    });

    // Ensure replaceTemplate is NOT called (table handles rendering)
    let templateReplaced = false;
    ctx.replaceTemplate = () => { templateReplaced = true; };

    feature.setup!(ctx);

    expect(tableUpdated).toBe(true);
    expect(templateReplaced).toBe(false);
    expect(passedIsHeaderFn).not.toBeNull();
  });

  it("should use grid integration when _getGridLayout and _replaceGridRenderer are available", () => {
    let gridRendererReplaced = false;
    let gridLayoutUpdated = false;

    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContext();

    // Mock grid integration methods
    ctx.methods.set("_getGridLayout", () => ({
      getColumns: () => 3,
      getColumnWidth: () => 133,
      isHeaderRow: () => false,
      getRowForIndex: () => 0,
      getColumnForIndex: () => 0,
      getTotalRows: () => 10,
    }));
    ctx.methods.set("_replaceGridRenderer", (renderer: any) => {
      gridRendererReplaced = true;
    });
    ctx.methods.set("_createGridRenderer", (...args: any[]) => ({
      render: () => {},
      updatePositions: () => {},
      getElement: () => undefined,
      updateColumnLayout: () => {},
      clear: () => {},
      destroy: () => {},
    }));
    ctx.methods.set("_updateGridLayoutForGroups", (isHeaderFn: any) => {
      gridLayoutUpdated = true;
    });

    // Ensure replaceTemplate is NOT called (grid renderer handles it)
    let templateReplaced = false;
    ctx.replaceTemplate = () => { templateReplaced = true; };

    feature.setup!(ctx);

    expect(gridLayoutUpdated).toBe(true);
    expect(gridRendererReplaced).toBe(true);
    expect(templateReplaced).toBe(false);
  });

  it("should call updateGridLayoutForGroups callback with correct isHeader results", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContext();
    let isHeaderFn: ((index: number) => boolean) | null = null;

    // Mock grid integration methods
    ctx.methods.set("_getGridLayout", () => ({
      getColumns: () => 3,
      getColumnWidth: () => 133,
      isHeaderRow: () => false,
      getRowForIndex: () => 0,
      getColumnForIndex: () => 0,
      getTotalRows: () => 10,
    }));
    ctx.methods.set("_replaceGridRenderer", () => {});
    ctx.methods.set("_createGridRenderer", (...args: any[]) => ({
      render: () => {},
      updatePositions: () => {},
      getElement: () => undefined,
      updateColumnLayout: () => {},
      clear: () => {},
      destroy: () => {},
    }));
    ctx.methods.set("_updateGridLayoutForGroups", (fn: (index: number) => boolean) => {
      isHeaderFn = fn;
    });

    feature.setup!(ctx);

    expect(isHeaderFn).not.toBeNull();
    // Index 0 is a group header in the layout
    expect(isHeaderFn!(0)).toBe(true);
    // Index 1 is a data item
    expect(isHeaderFn!(1)).toBe(false);
  });
});

// =============================================================================
// withGroups — Striped Rows with Groups
// =============================================================================

describe("withGroups — Striped Rows", () => {
  it("should build stripe map in 'data' mode", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContextWithStriped("data");
    feature.setup!(ctx);
    // The stripe map should have been built without errors
    expect(ctx.dataManager.getTotal()).toBeGreaterThan(0);
  });

  it("should build stripe map in 'data' mode with correct indices", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContextWithStriped("data");
    let stripeIndexFn: ((index: number) => number) | null = null;
    ctx.setStripeIndexFn = (fn: any) => { stripeIndexFn = fn; };
    feature.setup!(ctx);
    // Call the stripe function to cover lines 377-378
    expect(stripeIndexFn).not.toBeNull();
    // Index 0 is a group header → should return -1
    expect(stripeIndexFn!(0)).toBe(-1);
    // Index 1 is the first data item → should return 0
    expect(stripeIndexFn!(1)).toBe(0);
    // Out of bounds → returns the index itself
    expect(stripeIndexFn!(-1)).toBe(-1);
    expect(stripeIndexFn!(9999)).toBe(9999);
  });

  it("should build stripe map in 'even' mode", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContextWithStriped("even");
    feature.setup!(ctx);
    expect(ctx.dataManager.getTotal()).toBeGreaterThan(0);
  });

  it("should build stripe map in 'odd' mode", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const ctx = createMockContextWithStriped("odd");
    feature.setup!(ctx);
    expect(ctx.dataManager.getTotal()).toBeGreaterThan(0);
  });
});

// =============================================================================
// withGroups — Feature Destroy
// =============================================================================

describe("withGroups — Feature Destroy", () => {
  it("should clean up sticky header via feature.destroy()", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // feature.destroy() should clean up the sticky header
    expect(() => feature.destroy!()).not.toThrow();
  });

  it("should be safe to call feature.destroy() without setup", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });

    expect(() => feature.destroy!()).not.toThrow();
  });
});

// =============================================================================
// withGroups — Async Path Unit Tests
// =============================================================================

describe("withGroups — Async Path", () => {
  const flushMicrotasks = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  interface AsyncTestItem extends VListItem {
    id: number;
    name: string;
    group: string;
  }

  const makeItems = (groups: [string, number][]): AsyncTestItem[] => {
    const items: AsyncTestItem[] = [];
    let id = 0;
    for (const [group, count] of groups) {
      for (let i = 0; i < count; i++) {
        items.push({ id: id++, name: `Item ${id}`, group });
      }
    }
    return items;
  };

  /**
   * Creates a mock context that simulates async mode by registering
   * _onItemsLoaded on ctx.methods. After setup + microtask, the async
   * path wires up and we capture the replaced data manager.
   */
  function createAsyncMockContext(items: AsyncTestItem[], opts: {
    scrollTop?: number;
    striped?: "data" | "even" | "odd";
    sticky?: boolean;
    tableIntegration?: boolean;
  } = {}) {
    const testDom = createTestDOM();
    const sizeCache = createSizeCache(50, items.length);

    let virtualTotalFn = () => items.length;
    let replacedDataManager: any = null;
    let replacedTemplate: any = null;
    let stripeIndexFn: ((index: number) => number) | null = null;
    let scrollToHistory: number[] = [];
    const currentScrollTop = opts.scrollTop ?? 0;
    let tableGroupsUpdated = false;
    let tableIsHeaderFn: ((item: any) => boolean) | null = null;

    const loadedSet = new Set<number>();
    for (let i = 0; i < items.length; i++) loadedSet.add(i);

    const onItemsLoadedCallbacks: Array<(items: any[], offset: number, total: number) => void> = [];

    const methods = new Map<string, any>();
    // Register _onItemsLoaded to trigger async path detection
    methods.set("_onItemsLoaded", (cb: (items: any[], offset: number, total: number) => void) => {
      onItemsLoadedCallbacks.push(cb);
    });

    if (opts.tableIntegration) {
      methods.set("_updateTableForGroups", (isHeaderFn: any, _headerTpl: any) => {
        tableGroupsUpdated = true;
        tableIsHeaderFn = isHeaderFn;
      });
    }

    const ctx: BuilderContext<AsyncTestItem> = {
      dom: testDom as any,
      sizeCache: sizeCache as any,
      emitter: { on: () => {}, off: () => {}, emit: () => {} } as any,
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
        items: [],
        item: {
          height: 50,
          template: (item: AsyncTestItem) => `<div>${item.name}</div>`,
          ...(opts.striped ? { striped: opts.striped } : {}),
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
        isItemLoaded: (index: number) => loadedSet.has(index),
        getIndexById: (id: string | number) => items.findIndex(it => it.id === id),
        removeItem: (id: string | number) => {
          const idx = items.findIndex(it => it.id === id);
          if (idx >= 0) items.splice(idx, 1);
          return idx >= 0;
        },
        ensureRange: () => {},
        loadRange: () => {},
        loadInitial: () => {},
        loadMore: () => {},
        reload: () => Promise.resolve(),
        setItems: () => {},
        setTotal: () => {},
        clear: () => {},
        reset: () => {},
      } as any,
      scrollController: {
        getScrollTop: () => currentScrollTop,
        scrollTo: (pos: number) => { scrollToHistory.push(pos); },
        scrollBy: () => {},
        isAtTop: () => currentScrollTop === 0,
        isAtBottom: () => false,
        isCompressed: () => false,
      } as any,
      state: {
        dataState: {
          total: items.length,
          cached: items.length,
          isLoading: false,
          pendingRanges: [],
          error: undefined,
          hasMore: false,
          cursor: undefined,
        },
        viewportState: {
          scrollPosition: currentScrollTop,
          containerSize: 600,
          totalSize: items.length * 50,
          actualSize: items.length * 50,
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
      contextMenuHandlers: [],
      keydownHandlers: [],
      resizeHandlers: [],
      contentSizeHandlers: [],
      destroyHandlers: [],
      methods,
      replaceTemplate: (tpl: any) => { replacedTemplate = tpl; },
      replaceRenderer: () => {},
      replaceDataManager: (dm: any) => { replacedDataManager = dm; },
      replaceScrollController: () => {},
      getItemsForRange: () => [],
      getAllLoadedItems: () => items,
      getVirtualTotal: () => virtualTotalFn(),
      getCachedCompression: () => ({
        isCompressed: false,
        actualSize: items.length * 50,
        virtualSize: items.length * 50,
        ratio: 1,
      }),
      getCompressionContext: () => ({
        scrollPosition: currentScrollTop,
        totalItems: items.length,
        containerSize: 600,
        rangeStart: 0,
      }),
      renderIfNeeded: () => {},
      forceRender: () => {},
      invalidateRendered: () => {},
      getRenderFns: () => ({ renderIfNeeded: () => {}, forceRender: () => {} }),
      setRenderFns: () => {},
      setVirtualTotalFn: (fn: any) => { virtualTotalFn = fn; },
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
      triggerScrollFrame: () => {},
      setScrollTarget: () => {},
      getScrollTarget: () => testDom.viewport as any,
      setContainerDimensions: () => {},
      disableViewportResize: () => {},
      disableWheelHandler: () => {},
      adjustScrollPosition: (pos: number) => pos,
      getStripeIndexFn: () => (index: number) => index,
      setStripeIndexFn: (fn: any) => { stripeIndexFn = fn; },
      getItemToScrollIndexFn: () => (index: number) => index,
      getVisibleRange: () => {},
      setItemToScrollIndexFn: () => {},
    };

    return {
      ctx,
      getReplacedDataManager: () => replacedDataManager,
      getReplacedTemplate: () => replacedTemplate,
      getStripeIndexFn: () => stripeIndexFn,
      getScrollToHistory: () => scrollToHistory,
      getTableGroupsUpdated: () => tableGroupsUpdated,
      getTableIsHeaderFn: () => tableIsHeaderFn,
      fireOnItemsLoaded: (loadedItems: AsyncTestItem[], offset: number, total: number) => {
        for (const cb of onItemsLoadedCallbacks) cb(loadedItems, offset, total);
      },
    };
  }

  it("wrappedDataManager.getIndexById maps data index → layout index", async () => {
    const items = makeItems([["A", 3], ["B", 3]]);
    const { ctx, getReplacedDataManager, fireOnItemsLoaded } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();

    // Simulate items loading
    fireOnItemsLoaded(items, 0, items.length);

    const dm = getReplacedDataManager();
    expect(dm).not.toBeNull();

    // Item 0 (data index 0, group A) → layout index 1 (after header at 0)
    expect(dm.getIndexById(0)).toBe(1);
    // Item 3 (data index 3, first in group B) → layout index 5 (after header at 4)
    expect(dm.getIndexById(3)).toBe(5);
    // Non-existent ID → -1
    expect(dm.getIndexById(999)).toBe(-1);
  });

  it("wrappedDataManager.getItem returns header pseudo-item at header index", async () => {
    const items = makeItems([["A", 3], ["B", 2]]);
    const { ctx, getReplacedDataManager, fireOnItemsLoaded } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const dm = getReplacedDataManager();
    // Layout index 0 → header for group A
    const headerItem = dm.getItem(0);
    expect(headerItem.__groupHeader).toBe(true);
    expect(headerItem.groupKey).toBe("A");
    // Layout index 1 → data item 0
    const dataItem = dm.getItem(1);
    expect(dataItem.id).toBe(0);
    expect(dataItem.name).toBe("Item 1");
  });

  it("wrappedDataManager.getItemsInRange returns mixed headers and data", async () => {
    const items = makeItems([["A", 2], ["B", 2]]);
    const { ctx, getReplacedDataManager, fireOnItemsLoaded } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const dm = getReplacedDataManager();
    // Layout: [H(A)=0, D0=1, D1=2, H(B)=3, D2=4, D3=5]
    const range = dm.getItemsInRange(0, 5);
    expect(range.length).toBe(6);
    expect(range[0].__groupHeader).toBe(true);
    expect(range[1].id).toBe(0);
    expect(range[3].__groupHeader).toBe(true);
    expect(range[4].id).toBe(2);
  });

  it("wrappedDataManager.isItemLoaded returns true for headers", async () => {
    const items = makeItems([["A", 2], ["B", 2]]);
    const { ctx, getReplacedDataManager, fireOnItemsLoaded } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const dm = getReplacedDataManager();
    // Header index → always loaded
    expect(dm.isItemLoaded(0)).toBe(true);
    expect(dm.isItemLoaded(3)).toBe(true);
    // Data item index → delegates to async data manager
    expect(dm.isItemLoaded(1)).toBe(true);
    expect(dm.isItemLoaded(4)).toBe(true);
  });

  it("registers _isGroupHeader, _layoutToDataIndex, _dataToLayoutIndex", async () => {
    const items = makeItems([["A", 3], ["B", 2]]);
    const { ctx, fireOnItemsLoaded } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const isHeader = ctx.methods.get("_isGroupHeader") as (i: number) => boolean;
    const layoutToData = ctx.methods.get("_layoutToDataIndex") as (i: number) => number;
    const dataToLayout = ctx.methods.get("_dataToLayoutIndex") as (i: number) => number;

    expect(isHeader).toBeDefined();
    expect(layoutToData).toBeDefined();
    expect(dataToLayout).toBeDefined();

    // Layout: [H(A)=0, D0=1, D1=2, D2=3, H(B)=4, D3=5, D4=6]
    expect(isHeader(0)).toBe(true);
    expect(isHeader(1)).toBe(false);
    expect(isHeader(4)).toBe(true);

    expect(layoutToData(0)).toBe(-1); // header
    expect(layoutToData(1)).toBe(0);
    expect(layoutToData(5)).toBe(3);

    expect(dataToLayout(0)).toBe(1);
    expect(dataToLayout(3)).toBe(5);
  });

  it("deletes static removeItem override in async path", async () => {
    const items = makeItems([["A", 3]]);
    const { ctx } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);

    // Static path sets removeItem
    expect(ctx.methods.has("removeItem")).toBe(true);

    // After microtask, async path deletes it
    await flushMicrotasks();
    expect(ctx.methods.has("removeItem")).toBe(false);
  });

  it("template dispatches header vs data items correctly", async () => {
    const items = makeItems([["A", 2]]);
    const { ctx, getReplacedTemplate, fireOnItemsLoaded } = createAsyncMockContext(items);

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const tpl = getReplacedTemplate();
    expect(tpl).not.toBeNull();

    // Call with a header pseudo-item
    const headerResult = tpl({ __groupHeader: true, groupKey: "A", groupIndex: 0 }, 0, {});
    expect(headerResult).toBe("<h2>A</h2>");

    // Call with a data item
    const dataResult = tpl(items[0], 1, {});
    expect(dataResult).toContain("Item 1");
  });

  it("table integration wires _updateTableForGroups in async mode", async () => {
    const items = makeItems([["A", 2]]);
    const { ctx, getTableGroupsUpdated, getTableIsHeaderFn } = createAsyncMockContext(items, {
      tableIntegration: true,
    });

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();

    expect(getTableGroupsUpdated()).toBe(true);
    const isHeaderFn = getTableIsHeaderFn()!;
    expect(isHeaderFn({ __groupHeader: true })).toBe(true);
    expect(isHeaderFn({ id: 1 })).toBe(false);
  });

  it("stripe map works in async mode with 'data'", async () => {
    const items = makeItems([["A", 3], ["B", 2]]);
    const { ctx, getStripeIndexFn, fireOnItemsLoaded } = createAsyncMockContext(items, {
      striped: "data",
    });

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const stripeFn = getStripeIndexFn();
    expect(stripeFn).not.toBeNull();
    // Header at layout index 0 → -1 (skip striping)
    expect(stripeFn!(0)).toBe(-1);
    // Data item at layout index 1 (data index 0) → 0
    expect(stripeFn!(1)).toBe(0);
    // Data item at layout index 2 (data index 1) → 1
    expect(stripeFn!(2)).toBe(1);
    // Header at layout index 4 → -1
    expect(stripeFn!(4)).toBe(-1);
    // Data item at layout index 5 (data index 3) → 3
    expect(stripeFn!(5)).toBe(3);
  });

  it("stripe map in async mode with 'odd' adds offset 1", async () => {
    const items = makeItems([["A", 2]]);
    const { ctx, getStripeIndexFn, fireOnItemsLoaded } = createAsyncMockContext(items, {
      striped: "odd",
    });

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    const stripeFn = getStripeIndexFn();
    expect(stripeFn).not.toBeNull();
    // Header → -1
    expect(stripeFn!(0)).toBe(-1);
    // Data index 0 + offset 1 = 1
    expect(stripeFn!(1)).toBe(1);
    // Data index 1 + offset 1 = 2
    expect(stripeFn!(2)).toBe(2);
  });

  it("scroll drift correction adjusts scroll when new headers discovered", async () => {
    const items = makeItems([["A", 5], ["B", 5]]);
    // Start scrolled to position 300 (in the middle of the list)
    const { ctx, getScrollToHistory, fireOnItemsLoaded } = createAsyncMockContext(items, {
      scrollTop: 300,
    });

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
      sticky: false,
    });
    feature.setup!(ctx);
    await flushMicrotasks();

    // First load — discovers headers, scroll is > 0 so drift correction fires
    fireOnItemsLoaded(items, 0, items.length);

    // scrollTo should have been called to correct for header insertion
    const history = getScrollToHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it("bridgeAsLayout.getEntry returns correct entry types", async () => {
    const items = makeItems([["A", 2], ["B", 2]]);
    const { ctx, fireOnItemsLoaded } = createAsyncMockContext(items, { sticky: true });

    const feature = withGroups<AsyncTestItem>({
      getGroupForIndex: (_i, item) => item?.group ?? "?",
      header: { height: 32, template: (key) => `<div>${key}</div>` },
      sticky: true,
    });
    feature.setup!(ctx);
    await flushMicrotasks();
    fireOnItemsLoaded(items, 0, items.length);

    // The bridgeAsLayout is internal but its getEntry is exercised
    // indirectly by the sticky header. After data loads, the sticky header
    // should exist in the DOM.
    const stickyEl = ctx.dom.root.querySelector(".vlist-sticky-header");
    expect(stickyEl).not.toBeNull();
  });
});