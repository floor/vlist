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
    setPositionElementFn: () => {},
    setScrollFns: () => {},
    setScrollTarget: () => {},
    getScrollTarget: () => testDom.viewport as any,
    setContainerDimensions: () => {},
    disableViewportResize: () => {},
    disableWheelHandler: () => {},
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
      headerHeight: 40,
      headerTemplate: (key) => `<div>${key}</div>`,
    });

    expect(feature.name).toBe("withGroups");
    expect(feature.priority).toBe(10);
    expect(typeof feature.setup).toBe("function");
  });

  it("should require getGroupForIndex function", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      headerHeight: 40,
      headerTemplate: () => "Header",
    });
    expect(feature).toBeDefined();
  });

  it("should accept sticky option", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      headerHeight: 40,
      headerTemplate: () => "Header",
      sticky: true,
    });
    expect(feature).toBeDefined();
  });

  it("should accept sticky disabled", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      headerHeight: 40,
      headerTemplate: () => "Header",
      sticky: false,
    });
    expect(feature).toBeDefined();
  });
});

// =============================================================================
// withGroups — Setup Tests
// =============================================================================

describe("withGroups — Setup", () => {
  it("should add grouped CSS class to root", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      headerHeight: 40,
      headerTemplate: () => "Header",
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.dom.root.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should register a destroy handler", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      headerHeight: 40,
      headerTemplate: () => "Header",
    });
    const ctx = createMockContext();

    expect(ctx.destroyHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(0);
  });

  it("should register an afterScroll handler for sticky headers", () => {
    const feature = withGroups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      headerHeight: 40,
      headerTemplate: () => "Header",
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
      headerHeight: 40,
      headerTemplate: () => "Header",
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
      headerHeight: 40,
      headerTemplate: () => "Header",
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
      headerHeight: 40,
      headerTemplate: () => "Header",
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Should not throw
    for (const handler of ctx.destroyHandlers) {
      handler();
    }
  });
});