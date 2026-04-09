/**
 * vlist - Table Feature Tests
 * Tests for withTable feature: initialization, configuration, render pipeline,
 * resize handlers, public methods, and event emission.
 *
 * Follows the same pattern as test/features/grid/feature.test.ts — uses a
 * mock BuilderContext to verify the feature wires correctly without needing
 * a full materialized vlist instance.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withTable } from "../../../src/features/table/feature";
import { createSizeCache } from "../../../src/rendering/sizes";
import type { VListItem } from "../../../src/types";
import type { BuilderContext } from "../../../src/builder/types";
import type { TableColumn } from "../../../src/features/table/types";

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
  global.DocumentFragment = dom.window.DocumentFragment;
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
  email: string;
  role: string;
}

const testColumns: TableColumn<TestItem>[] = [
  { key: "name", label: "Name", width: 200 },
  { key: "email", label: "Email", width: 300 },
  { key: "role", label: "Role", width: 100 },
];

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

function createMockContext(overrides?: {
  itemCount?: number;
  scrollTop?: number;
  containerSize?: number;
}): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const itemCount = overrides?.itemCount ?? 100;
  const sizeCache = createSizeCache(40, itemCount);
  const items: TestItem[] = Array.from({ length: itemCount }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@test.com`,
    role: i % 2 === 0 ? "admin" : "user",
  }));

  let renderIfNeededFn = () => {};
  let forceRenderFn = () => {};
  let virtualTotalFn = () => itemCount;
  let currentScrollTop = overrides?.scrollTop ?? 0;

  const emitted: Array<{ event: string; payload: any }> = [];

  const ctx: BuilderContext<TestItem> = {
    dom: testDom as any,
    sizeCache: sizeCache as any,
    emitter: {
      on: () => {},
      off: () => {},
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      },
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
    rawConfig: {
      container: document.createElement("div"),
      items: items,
      item: {
        height: 40,
        width: 200,
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
      getItemsInRange: (start: number, end: number) => {
        return items.slice(start, end + 1);
      },
      isItemLoaded: () => true,
      getState: () => ({ total: items.length }),
    } as any,
    scrollController: {
      getScrollTop: () => currentScrollTop,
      scrollTo: (pos: number) => { currentScrollTop = pos; },
      isAtTop: () => currentScrollTop === 0,
      isAtBottom: () => false,
    } as any,
    state: {
      dataState: {
        total: itemCount,
        cached: itemCount,
        isLoading: false,
        pendingRanges: [],
        error: undefined,
        hasMore: false,
        cursor: undefined,
      },
      viewportState: {
        scrollPosition: 0,
        containerSize: overrides?.containerSize ?? 500,
        totalSize: 0,
        actualSize: 0,
        isCompressed: false,
        compressionRatio: 1,
        visibleRange: { start: 0, end: 0 },
        renderRange: { start: 0, end: 0 },
      },
      renderState: {
        range: { start: 0, end: 0 },
        visibleRange: { start: 0, end: 0 },
        renderedCount: 0,
      },
      lastRenderRange: { start: -1, end: -1 },
      isDestroyed: false,
    } as any,
    getContainerWidth: () => 800,
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
    getItemsForRange: (range) => {
      return items.slice(range.start, range.end + 1);
    },
    getAllLoadedItems: () => items,
    getVirtualTotal: () => virtualTotalFn(),
    getCachedCompression: () => ({
      isCompressed: false,
      actualSize: itemCount * 40,
      virtualSize: itemCount * 40,
      ratio: 1,
    }),
    getCompressionContext: () => ({
      scrollPosition: 0,
      totalItems: itemCount,
      containerSize: 500,
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
    rebuildSizeCache: (total) => {
      sizeCache.rebuild(total ?? virtualTotalFn());
    },
    setSizeConfig: (config) => {
      (ctx as any)._lastSizeConfig = config;
    },
    updateContentSize: (totalSize) => {
      testDom.content.style.height = `${totalSize}px`;
    },
    updateCompressionMode: () => {},
    setVisibleRangeFn: () => {},
    setScrollToPosFn: () => {},
    setPositionElementFn: () => {},
    setUpdateItemClassesFn: () => {},
    setScrollFns: () => {},
    setScrollTarget: () => {},
    getScrollTarget: () => window as any,
    setContainerDimensions: () => {},
    disableViewportResize: () => {},
    disableWheelHandler: () => {},
    adjustScrollPosition: (pos: number) => pos,
    getStripeIndexFn: () => (index: number) => index,
    setStripeIndexFn: () => {},
  };

  // Attach emitted array for test assertions
  (ctx as any)._emitted = emitted;
  // Attach setter for scrollTop
  (ctx as any)._setScrollTop = (v: number) => { currentScrollTop = v; };
  // Attach testDom for cleanup
  (ctx as any)._testDom = testDom;

  return ctx;
}

function getEmitted(ctx: BuilderContext<TestItem>): Array<{ event: string; payload: any }> {
  return (ctx as any)._emitted;
}

function setScrollTop(ctx: BuilderContext<TestItem>, v: number): void {
  (ctx as any)._setScrollTop(v);
}

function cleanupCtx(ctx: BuilderContext<TestItem>): void {
  const testDom = (ctx as any)._testDom;
  if (testDom?.root?.parentNode) {
    testDom.root.parentNode.removeChild(testDom.root);
  }
}

// =============================================================================
// withTable - Factory Tests
// =============================================================================

describe("withTable - Factory", () => {
  it("should create a feature with name and priority", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
    });

    expect(feature.name).toBe("withTable");
    expect(feature.priority).toBe(10);
  });

  it("should declare conflicts with withGrid and withMasonry", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
    });

    expect(feature.conflicts).toContain("withGrid");
    expect(feature.conflicts).toContain("withMasonry");
  });

  it("should throw if columns is empty", () => {
    expect(() => {
      withTable({ columns: [], rowHeight: 40 });
    }).toThrow("columns must be a non-empty array");
  });

  it("should throw if both rowHeight and estimatedRowHeight are missing", () => {
    expect(() => {
      withTable({ columns: testColumns } as any);
    }).toThrow("either rowHeight or estimatedRowHeight is required");
  });

  it("should accept valid configuration", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 44,
      resizable: true,
      columnBorders: true,
      rowBorders: false,
    });

    expect(feature.name).toBe("withTable");
  });
});

// =============================================================================
// withTable - Setup
// =============================================================================

describe("withTable - Setup", () => {
  it("should add table CSS class to root", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.root.classList.contains("vlist--table")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should set role=grid on root", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.root.getAttribute("role")).toBe("grid");
    cleanupCtx(ctx);
  });

  it("should set role=rowgroup on items", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.items.getAttribute("role")).toBe("rowgroup");
    cleanupCtx(ctx);
  });

  it("should set aria-colcount on root", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.root.getAttribute("aria-colcount")).toBe("3");
    cleanupCtx(ctx);
  });

  it("should throw if horizontal is true", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();
    (ctx.config as any).horizontal = true;

    expect(() => feature.setup(ctx)).toThrow("cannot be used with orientation: 'horizontal'");
    cleanupCtx(ctx);
  });

  it("should throw if reverse is true", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();
    (ctx.config as any).reverse = true;

    expect(() => feature.setup(ctx)).toThrow("cannot be used with reverse: true");
    cleanupCtx(ctx);
  });

  it("should create a table header element in the root", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const header = ctx.dom.root.querySelector(".vlist-table-header");
    expect(header).not.toBeNull();
    cleanupCtx(ctx);
  });

  it("should create header cells for each column", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const cells = ctx.dom.root.querySelectorAll(".vlist-table-header-cell");
    expect(cells.length).toBe(3);
    cleanupCtx(ctx);
  });

  it("should offset viewport by header height", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 44,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.viewport.style.top).toBe("44px");
    cleanupCtx(ctx);
  });

  it("should default header height to rowHeight when fixed", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 36 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.viewport.style.top).toBe("36px");
    cleanupCtx(ctx);
  });

  it("should use absolute positioning on viewport for proper containment", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 44,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    // Viewport must be position: absolute with insets so it sizes correctly
    // even when the root's height comes from min-height / max-height
    // (where height: 100% on a static child resolves to auto).
    expect(ctx.dom.viewport.style.position).toBe("absolute");
    expect(ctx.dom.viewport.style.top).toBe("44px");
    expect(ctx.dom.viewport.style.left).toBe("0px");
    expect(ctx.dom.viewport.style.right).toBe("0px");
    expect(ctx.dom.viewport.style.bottom).toBe("0px");
    cleanupCtx(ctx);
  });

  it("should set content min-width to total column width", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    // 200 + 300 + 100 = 600
    expect(ctx.dom.content.style.minWidth).toBe("600px");
    expect(ctx.dom.items.style.minWidth).toBe("600px");
    cleanupCtx(ctx);
  });

  it("should register resize handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    const beforeCount = ctx.resizeHandlers.length;
    feature.setup(ctx);

    expect(ctx.resizeHandlers.length).toBe(beforeCount + 1);
    cleanupCtx(ctx);
  });

  it("should register afterScroll handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    const beforeCount = ctx.afterScroll.length;
    feature.setup(ctx);

    expect(ctx.afterScroll.length).toBe(beforeCount + 1);
    cleanupCtx(ctx);
  });

  it("should register destroy handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    const beforeCount = ctx.destroyHandlers.length;
    feature.setup(ctx);

    expect(ctx.destroyHandlers.length).toBe(beforeCount + 1);
    cleanupCtx(ctx);
  });

  it("should register content size handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    const beforeCount = ctx.contentSizeHandlers.length;
    feature.setup(ctx);

    expect(ctx.contentSizeHandlers.length).toBe(beforeCount + 1);
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Render Functions (CRITICAL)
// =============================================================================

describe("withTable - Render Functions", () => {
  it("should replace render functions via setRenderFns (NOT replaceRenderer)", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    const originalRenderIfNeeded = ctx.renderIfNeeded;
    const originalForceRender = ctx.forceRender;

    feature.setup(ctx);

    // After setup, the render functions should have been replaced
    const fns = ctx.getRenderFns();
    expect(fns.renderIfNeeded).not.toBe(originalRenderIfNeeded);
    expect(fns.forceRender).not.toBe(originalForceRender);
    cleanupCtx(ctx);
  });

  it("should not render if destroyed", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    ctx.state.isDestroyed = true;

    // Should not throw
    ctx.renderIfNeeded();
    ctx.forceRender();
    cleanupCtx(ctx);
  });

  it("should render rows on first renderIfNeeded call", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    // With container 200px and row height 40px, should see ~5 visible rows + overscan
    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);
    cleanupCtx(ctx);
  });

  it("should skip render when scroll position and container size unchanged", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);

    // First render
    ctx.renderIfNeeded();
    const rowCount1 = ctx.dom.items.querySelectorAll(".vlist-table-row").length;

    // Second render with same state — should be a no-op (early exit)
    ctx.renderIfNeeded();
    const rowCount2 = ctx.dom.items.querySelectorAll(".vlist-table-row").length;

    expect(rowCount2).toBe(rowCount1);
    cleanupCtx(ctx);
  });

  it("should re-render when scroll position changes", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200, scrollTop: 0 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const firstRowBefore = ctx.dom.items.querySelector(".vlist-table-row[data-index='0']");
    expect(firstRowBefore).not.toBeNull();

    // Scroll down
    setScrollTop(ctx, 800); // 800 / 40 = row 20
    ctx.renderIfNeeded();

    // Row 0 should eventually be released (or not, depending on overscan)
    // But rows around index 20 should exist
    const row20 = ctx.dom.items.querySelector(".vlist-table-row[data-index='20']");
    expect(row20).not.toBeNull();
    cleanupCtx(ctx);
  });

  it("should force render even when position unchanged", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    // Force render should work even though nothing changed
    ctx.forceRender();

    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);
    cleanupCtx(ctx);
  });

  it("should handle zero total items gracefully", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ itemCount: 0 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBe(0);
    cleanupCtx(ctx);
  });

  it("should handle zero container height gracefully", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 0 });

    feature.setup(ctx);

    // Should not throw — graceful handling is the requirement
    ctx.renderIfNeeded();

    // With 0 container height, visible range is 0,0 but overscan may still
    // cause a few rows to render. The key assertion is no crash.
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Viewport State Updates
// =============================================================================

describe("withTable - Viewport State", () => {
  it("should update viewportState.scrollPosition on render", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200, scrollTop: 160 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    expect(ctx.state.viewportState.scrollPosition).toBe(160);
    cleanupCtx(ctx);
  });

  it("should update viewportState.visibleRange on render", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200, scrollTop: 0 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const vr = ctx.state.viewportState.visibleRange;
    expect(vr.start).toBe(0);
    // 200 / 40 = 5 visible rows → end should be around 5
    expect(vr.end).toBeGreaterThanOrEqual(4);
    cleanupCtx(ctx);
  });

  it("should update viewportState.renderRange with overscan", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200, scrollTop: 200 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const rr = ctx.state.viewportState.renderRange;
    const vr = ctx.state.viewportState.visibleRange;

    // Render range should extend beyond visible range by overscan
    expect(rr.start).toBeLessThanOrEqual(vr.start);
    expect(rr.end).toBeGreaterThanOrEqual(vr.end);
    cleanupCtx(ctx);
  });

  it("should update lastRenderRange on render", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);

    expect(ctx.state.lastRenderRange.start).toBe(-1);
    expect(ctx.state.lastRenderRange.end).toBe(-1);

    ctx.renderIfNeeded();

    expect(ctx.state.lastRenderRange.start).toBeGreaterThanOrEqual(0);
    expect(ctx.state.lastRenderRange.end).toBeGreaterThanOrEqual(0);
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Event Emission
// =============================================================================

describe("withTable - Events", () => {
  it("should emit range:change when range changes", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const emitted = getEmitted(ctx);
    const rangeEvents = emitted.filter(e => e.event === "range:change");
    expect(rangeEvents.length).toBeGreaterThanOrEqual(1);
    expect(rangeEvents[0]!.payload.range).toBeDefined();
    expect(typeof rangeEvents[0]!.payload.range.start).toBe("number");
    expect(typeof rangeEvents[0]!.payload.range.end).toBe("number");
    cleanupCtx(ctx);
  });

  it("should not emit range:change when range is unchanged", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);

    // First render emits range:change
    ctx.renderIfNeeded();
    const count1 = getEmitted(ctx).filter(e => e.event === "range:change").length;

    // Second render with same state should NOT emit again (early exit)
    ctx.renderIfNeeded();
    const count2 = getEmitted(ctx).filter(e => e.event === "range:change").length;

    expect(count2).toBe(count1);
    cleanupCtx(ctx);
  });

  it("should emit range:change when scrolling to new range", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200, scrollTop: 0 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const count1 = getEmitted(ctx).filter(e => e.event === "range:change").length;

    // Scroll to a different position
    setScrollTop(ctx, 2000);
    ctx.renderIfNeeded();

    const count2 = getEmitted(ctx).filter(e => e.event === "range:change").length;
    expect(count2).toBeGreaterThan(count1);
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Public Methods
// =============================================================================

describe("withTable - Public Methods", () => {
  it("should expose updateColumns method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("updateColumns")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should expose resizeColumn method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("resizeColumn")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should expose getColumnWidths method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("getColumnWidths")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should expose setSort method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("setSort")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should expose getSort method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("getSort")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should expose _getTableLayout internal method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("_getTableLayout")).toBe(true);
    const getLayout = ctx.methods.get("_getTableLayout") as Function;
    const layout = getLayout();
    expect(layout).toBeDefined();
    expect(layout.columns.length).toBe(3);
    cleanupCtx(ctx);
  });

  it("getColumnWidths should return current widths keyed by column key", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const getColumnWidths = ctx.methods.get("getColumnWidths") as () => Record<string, number>;
    const widths = getColumnWidths();

    expect(widths.name).toBe(200);
    expect(widths.email).toBe(300);
    expect(widths.role).toBe(100);
    cleanupCtx(ctx);
  });

  it("setSort should update sort state", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const setSort = ctx.methods.get("setSort") as (key: string | null, dir?: "asc" | "desc") => void;
    const getSort = ctx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };

    setSort("name", "desc");
    const sort = getSort();
    expect(sort.key).toBe("name");
    expect(sort.direction).toBe("desc");
    cleanupCtx(ctx);
  });

  it("setSort with null should clear sort", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
      sort: { key: "name", direction: "asc" },
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    const setSort = ctx.methods.get("setSort") as (key: string | null, dir?: "asc" | "desc") => void;
    const getSort = ctx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };

    setSort(null);
    const sort = getSort();
    expect(sort.key).toBeNull();
    cleanupCtx(ctx);
  });

  it("resizeColumn by key should emit column:resize", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const resizeColumn = ctx.methods.get("resizeColumn") as (keyOrIndex: string | number, width: number) => void;
    resizeColumn("name", 250);

    const emitted = getEmitted(ctx);
    const resizeEvents = emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(1);
    expect(resizeEvents[0]!.payload.key).toBe("name");
    expect(resizeEvents[0]!.payload.width).toBe(250);
    expect(resizeEvents[0]!.payload.previousWidth).toBe(200);
    cleanupCtx(ctx);
  });

  it("resizeColumn by index should emit column:resize", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const resizeColumn = ctx.methods.get("resizeColumn") as (keyOrIndex: string | number, width: number) => void;
    resizeColumn(1, 400);

    const emitted = getEmitted(ctx);
    const resizeEvents = emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(1);
    expect(resizeEvents[0]!.payload.key).toBe("email");
    expect(resizeEvents[0]!.payload.width).toBe(400);
    cleanupCtx(ctx);
  });

  it("resizeColumn with invalid key should be a no-op", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const resizeColumn = ctx.methods.get("resizeColumn") as (keyOrIndex: string | number, width: number) => void;
    resizeColumn("nonexistent", 250);

    const emitted = getEmitted(ctx);
    const resizeEvents = emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(0);
    cleanupCtx(ctx);
  });

  it("updateColumns should rebuild header and re-render", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const updateColumns = ctx.methods.get("updateColumns") as (cols: TableColumn<TestItem>[]) => void;
    const newColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 150 },
      { key: "email", label: "Email", width: 350 },
    ];

    updateColumns(newColumns);

    // Header should have been rebuilt with 2 columns
    const headerCells = ctx.dom.root.querySelectorAll(".vlist-table-header-cell");
    expect(headerCells.length).toBe(2);

    // Content width should be updated
    expect(ctx.dom.content.style.minWidth).toBe("500px");

    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Resize Handler
// =============================================================================

describe("withTable - Resize Handler", () => {
  it("should handle resize events without errors", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1]!;
    // Should not throw
    resizeHandler(1000, 600);

    cleanupCtx(ctx);
  });

  it("should re-resolve column widths on container resize", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200 },
      { key: "email", label: "Email" }, // flex column
    ];

    const feature = withTable({ columns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const getLayout = ctx.methods.get("_getTableLayout") as () => any;
    const layout = getLayout();

    // Initial flex column width based on container 800 - 200 = 600
    const initialEmailWidth = layout.columns[1].width;
    expect(initialEmailWidth).toBe(600);

    // Resize container to 1000
    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1]!;
    resizeHandler(1000, 600);

    // Flex column should expand to fill: 1000 - 200 = 800
    const newEmailWidth = layout.columns[1].width;
    expect(newEmailWidth).toBe(800);

    cleanupCtx(ctx);
  });

  it("should update content min-width after resize", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200 },
      { key: "email", label: "Email" }, // flex
    ];

    const feature = withTable({ columns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1]!;
    resizeHandler(1200, 600);

    expect(ctx.dom.content.style.minWidth).toBe("1200px");
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Sort Configuration
// =============================================================================

describe("withTable - Sort", () => {
  it("should initialize with sort state from config", () => {
    const feature = withTable<TestItem>({
      columns: [
        { key: "name", label: "Name", width: 200, sortable: true },
        { key: "email", label: "Email", width: 300, sortable: true },
      ],
      rowHeight: 40,
      sort: { key: "name", direction: "desc" },
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    const getSort = ctx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    const sort = getSort();
    expect(sort.key).toBe("name");
    expect(sort.direction).toBe("desc");
    cleanupCtx(ctx);
  });

  it("should default sort direction to asc", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const getSort = ctx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    const sort = getSort();
    expect(sort.key).toBeNull();
    expect(sort.direction).toBe("asc");
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Configuration Options
// =============================================================================

describe("withTable - Configuration", () => {
  it("should support function-based row height", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: (index: number) => index % 2 === 0 ? 40 : 60,
    });
    const ctx = createMockContext();

    // Should not throw
    feature.setup(ctx);
    ctx.renderIfNeeded();

    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);
    cleanupCtx(ctx);
  });

  it("should use default header height of 40 for function-based rowHeight", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: (index: number) => 40 + index,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.viewport.style.top).toBe("40px");
    cleanupCtx(ctx);
  });

  it("should support explicit header height", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 56,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.viewport.style.top).toBe("56px");
    cleanupCtx(ctx);
  });

  it("should respect resizable: false on global config", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200 },
    ];

    const feature = withTable({
      columns,
      rowHeight: 40,
      resizable: false,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    const getLayout = ctx.methods.get("_getTableLayout") as () => any;
    const layout = getLayout();
    expect(layout.columns[0].resizable).toBe(false);
    cleanupCtx(ctx);
  });

  it("should respect per-column resizable override", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, resizable: false },
      { key: "email", label: "Email", width: 300, resizable: true },
    ];

    const feature = withTable({
      columns,
      rowHeight: 40,
      resizable: true,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    const getLayout = ctx.methods.get("_getTableLayout") as () => any;
    const layout = getLayout();
    expect(layout.columns[0].resizable).toBe(false);
    expect(layout.columns[1].resizable).toBe(true);
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Destroy
// =============================================================================

describe("withTable - Destroy", () => {
  it("should remove table CSS class on destroy handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    expect(ctx.dom.root.classList.contains("vlist--table")).toBe(true);

    // Run destroy handlers
    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.root.classList.contains("vlist--table")).toBe(false);
    cleanupCtx(ctx);
  });

  it("should restore role to listbox on destroy handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    expect(ctx.dom.root.getAttribute("role")).toBe("grid");
    expect(ctx.dom.items.getAttribute("role")).toBe("rowgroup");

    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.root.getAttribute("role")).toBeNull();
    expect(ctx.dom.items.getAttribute("role")).toBe("listbox");
    cleanupCtx(ctx);
  });

  it("should remove aria-colcount on destroy handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    expect(ctx.dom.root.getAttribute("aria-colcount")).toBe("3");

    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.root.getAttribute("aria-colcount")).toBeNull();
    cleanupCtx(ctx);
  });

  it("should remove header element on destroy handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    expect(ctx.dom.root.querySelector(".vlist-table-header")).not.toBeNull();

    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.root.querySelector(".vlist-table-header")).toBeNull();
    cleanupCtx(ctx);
  });

  it("should reset content min-width on destroy handler", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    expect(ctx.dom.content.style.minWidth).not.toBe("");

    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.content.style.minWidth).toBe("");
    expect(ctx.dom.items.style.minWidth).toBe("");
    cleanupCtx(ctx);
  });

  it("should clean up via feature.destroy() method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    // Should not throw
    feature.destroy!();
    cleanupCtx(ctx);
  });
});

// =============================================================================
// withTable - Integration
// =============================================================================

describe("withTable - Integration", () => {
  it("should render cells with correct content for visible rows", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 120 }); // ~3 visible rows

    feature.setup(ctx);
    ctx.renderIfNeeded();

    // Should have rendered rows with cells
    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);

    // Check first row has correct content
    const firstRow = rows[0]!;
    const cells = firstRow.querySelectorAll(".vlist-table-cell");
    expect(cells.length).toBe(3);
    expect(cells[0]!.textContent).toBe("User 0");
    expect(cells[1]!.textContent).toBe("user0@test.com");
    expect(cells[2]!.textContent).toBe("admin");

    cleanupCtx(ctx);
  });

  it("should only render visible rows (virtualization works)", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ itemCount: 10000, containerSize: 200 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    // With 200px container and 40px rows = 5 visible + 2 overscan each side ≈ 9
    // Should be MUCH less than 10000
    expect(rows.length).toBeLessThan(20);
    expect(rows.length).toBeGreaterThan(0);

    cleanupCtx(ctx);
  });

  it("should re-render rows after updateColumns changes column count", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    feature.setup(ctx);
    ctx.renderIfNeeded();

    // Verify 3 cells per row initially
    let firstRow = ctx.dom.items.querySelector(".vlist-table-row")!;
    expect(firstRow.querySelectorAll(".vlist-table-cell").length).toBe(3);

    // Update to 2 columns
    const updateColumns = ctx.methods.get("updateColumns") as Function;
    updateColumns([
      { key: "name", label: "Name", width: 400 },
      { key: "email", label: "Email", width: 400 },
    ]);

    // After update, rows are cleared and re-rendered with new column count.
    // Pooled elements have their children cleared on release, so reused
    // elements get fresh cells matching the new column layout.
    const rows = ctx.dom.items.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);

    // Each row should now have exactly 2 cells
    for (const row of rows) {
      expect(row.querySelectorAll(".vlist-table-cell").length).toBe(2);
    }

    // Header should also have 2 cells
    const headerCells = ctx.dom.root.querySelectorAll(".vlist-table-header-cell");
    expect(headerCells.length).toBe(2);

    // Content width should reflect new total: 400 + 400 = 800
    expect(ctx.dom.content.style.minWidth).toBe("800px");

    cleanupCtx(ctx);
  });

  it("should work with selection getters when selection feature is present", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext({ containerSize: 200 });

    // Simulate selection feature registering methods
    const selectedIds = new Set<string | number>([0, 2]);
    ctx.methods.set("_getSelectedIds", () => selectedIds);
    ctx.methods.set("_getFocusedIndex", () => 0);

    feature.setup(ctx);
    ctx.renderIfNeeded();

    // Row 0 should be selected and focused
    const row0 = ctx.dom.items.querySelector(".vlist-table-row[data-index='0']") as HTMLElement;
    expect(row0).not.toBeNull();
    expect(row0.classList.contains("vlist-item--selected")).toBe(true);
    expect(row0.classList.contains("vlist-item--focused")).toBe(true);

    // Row 1 should not be selected
    const row1 = ctx.dom.items.querySelector(".vlist-table-row[data-index='1']") as HTMLElement;
    if (row1) {
      expect(row1.classList.contains("vlist-item--selected")).toBe(false);
      expect(row1.classList.contains("vlist-item--focused")).toBe(false);
    }

    // Row 2 should be selected but not focused
    const row2 = ctx.dom.items.querySelector(".vlist-table-row[data-index='2']") as HTMLElement;
    if (row2) {
      expect(row2.classList.contains("vlist-item--selected")).toBe(true);
      expect(row2.classList.contains("vlist-item--focused")).toBe(false);
    }

    cleanupCtx(ctx);
  });

  it("should handle content size handler invocation", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const handler = ctx.contentSizeHandlers[ctx.contentSizeHandlers.length - 1]!;
    // Should not throw
    handler();

    // Content width should still be set
    expect(ctx.dom.content.style.minWidth).not.toBe("");
    cleanupCtx(ctx);
  });

  it("should add column-borders class when columnBorders is true", () => {
    const feature = withTable({
      columns: testColumns,
      rowHeight: 40,
      columnBorders: true,
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.root.classList.contains("vlist--table-col-borders")).toBe(true);
    cleanupCtx(ctx);
  });

  it("should move aria-label from items to root", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    // Simulate items having an aria-label (set by dom.ts for listbox)
    ctx.dom.items.setAttribute("aria-label", "My list");

    feature.setup(ctx);

    expect(ctx.dom.root.getAttribute("aria-label")).toBe("My list");
    expect(ctx.dom.items.getAttribute("aria-label")).toBeNull();
    cleanupCtx(ctx);
  });

  it("should restore aria-label to items on destroy", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    ctx.dom.items.setAttribute("aria-label", "My list");

    feature.setup(ctx);
    expect(ctx.dom.root.getAttribute("aria-label")).toBe("My list");

    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.items.getAttribute("aria-label")).toBe("My list");
    expect(ctx.dom.root.getAttribute("aria-label")).toBeNull();
    cleanupCtx(ctx);
  });

  it("should emit column:sort when onColumnSort is called via sort cycling", () => {
    const sortableColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, sortable: true },
      { key: "email", label: "Email", width: 300, sortable: true },
    ];
    const feature = withTable({ columns: sortableColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    // Click on a sortable header cell to trigger sort
    const headerCells = ctx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameHeader = headerCells[0] as HTMLElement;

    // The header cell has a click listener that calls onColumnSort
    const clickEvt = new dom.window.MouseEvent("click", { bubbles: true });
    nameHeader.dispatchEvent(clickEvt);

    const emitted = getEmitted(ctx);
    const sortEvents = emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(1);
    expect(sortEvents[0]!.payload.key).toBe("name");
    expect(sortEvents[0]!.payload.direction).toBe("asc");

    // Check getSort reflects the new state
    const getSort = ctx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    expect(getSort().key).toBe("name");
    expect(getSort().direction).toBe("asc");

    cleanupCtx(ctx);
  });

  it("should emit column:click when header cell is clicked", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const headerCells = ctx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const cell = headerCells[0] as HTMLElement;

    const clickEvt = new dom.window.MouseEvent("click", { bubbles: true });
    cell.dispatchEvent(clickEvt);

    const emitted = getEmitted(ctx);
    const clickEvents = emitted.filter(e => e.event === "column:click");
    expect(clickEvents.length).toBe(1);
    expect(clickEvents[0]!.payload.key).toBe("name");
    cleanupCtx(ctx);
  });

  it("should sync header scroll with viewport scrollLeft via afterScroll", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    // Simulate horizontal scroll on viewport
    Object.defineProperty(ctx.dom.viewport, "scrollLeft", {
      value: 50,
      configurable: true,
    });

    // Trigger afterScroll
    for (const handler of ctx.afterScroll) {
      handler(0, "down");
    }

    // The header scroll container should have been synced
    const scrollContainer = ctx.dom.root.querySelector(".vlist-table-header-scroll") as HTMLElement;
    if (scrollContainer) {
      // translateX should reflect the scroll offset
      expect(scrollContainer.style.transform).toContain("translateX");
    }
    cleanupCtx(ctx);
  });

  it("should restore sort indicator after updateColumns when sort is active", () => {
    const sortableColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, sortable: true },
      { key: "email", label: "Email", width: 300, sortable: true },
    ];
    const feature = withTable({
      columns: sortableColumns,
      rowHeight: 40,
      sort: { key: "name", direction: "desc" },
    });
    const ctx = createMockContext();

    feature.setup(ctx);

    // Verify initial sort
    const getSort = ctx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    expect(getSort().key).toBe("name");

    // Update columns — sort indicator should be restored
    const updateColumns = ctx.methods.get("updateColumns") as Function;
    updateColumns([
      { key: "name", label: "Full Name", width: 250, sortable: true },
      { key: "email", label: "E-mail", width: 350, sortable: true },
    ]);

    // Sort state should be preserved
    expect(getSort().key).toBe("name");
    expect(getSort().direction).toBe("desc");

    // Header should show sort indicator on name column
    const headerCells = ctx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameCell = headerCells[0] as HTMLElement;
    const sortIndicator = nameCell.querySelector("[aria-sort]") ?? nameCell;
    // The cell or its parent should have sort-related attributes/classes
    expect(nameCell.getAttribute("aria-sort")).toBe("descending");

    cleanupCtx(ctx);
  });

  it("should expose _updateTableForGroups method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);
    ctx.renderIfNeeded();

    const updateForGroups = ctx.methods.get("_updateTableForGroups") as Function;
    expect(updateForGroups).toBeDefined();

    // Call it with a header check function
    updateForGroups(
      (item: any) => item._isGroupHeader === true,
      (key: string) => `<div class="group">${key}</div>`,
    );

    cleanupCtx(ctx);
  });

  it("should expose _replaceTableRenderer method", () => {
    const feature = withTable({ columns: testColumns, rowHeight: 40 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const replaceRenderer = ctx.methods.get("_replaceTableRenderer") as Function;
    expect(replaceRenderer).toBeDefined();

    // Should accept a mock renderer
    const mockRenderer = {
      render: () => {},
      updateColumnLayout: () => {},
      clear: () => {},
      destroy: () => {},
      setGroupHeaderFn: () => {},
    };
    expect(() => replaceRenderer(mockRenderer)).not.toThrow();

    cleanupCtx(ctx);
  });
});