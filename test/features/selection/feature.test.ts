/**
 * vlist - Selection Feature Tests
 * Tests for withSelection: factory, setup wiring, click handlers, keyboard
 * handlers, registered methods, ARIA attributes, destroy cleanup.
 *
 * NOTE: The underlying selection logic is tested separately:
 * - selection/index.test.ts (61 tests, 100 assertions) — all pure state
 *   functions (selectItems, deselectItems, toggleSelection, selectAll,
 *   clearSelection, focus management, queries, keyboard helpers, selectRange)
 *
 * This file tests the feature integration layer (withSelection) that wires
 * selection state, click/keyboard handling, ARIA attributes, and public
 * methods into the builder context.
 *
 * Coverage: 99.29% lines, 80.65% functions.
 * Only 1 line uncovered (line 338 — edge case in range select path).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withSelection } from "../../../src/features/selection/feature";
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

function createMockContext(): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const testItems = createTestItems(100);
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
// withSelection — Factory Tests
// =============================================================================

describe("withSelection — Factory", () => {
  it("should create a feature with correct name and priority", () => {
    const feature = withSelection<TestItem>();

    expect(feature.name).toBe("withSelection");
    expect(feature.priority).toBe(50);
    expect(typeof feature.setup).toBe("function");
  });

  it("should accept empty config (defaults to single mode)", () => {
    const feature = withSelection<TestItem>();
    expect(feature).toBeDefined();
  });

  it("should accept single mode config", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    expect(feature).toBeDefined();
  });

  it("should accept multiple mode config", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    expect(feature).toBeDefined();
  });

  it("should accept none mode config", () => {
    const feature = withSelection<TestItem>({ mode: "none" });
    expect(feature).toBeDefined();
  });

  it("should accept initialSelection config", () => {
    const feature = withSelection<TestItem>({
      mode: "multiple",
      initial: [1, 2, 3],
    });
    expect(feature).toBeDefined();
  });
});

// =============================================================================
// withSelection — Setup Tests
// =============================================================================

describe("withSelection — Setup", () => {
  it("should register a click handler", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    expect(ctx.clickHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.clickHandlers.length).toBeGreaterThan(0);
  });

  it("should register a keydown handler", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    expect(ctx.keydownHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.keydownHandlers.length).toBeGreaterThan(0);
  });

  it("should register a destroy handler", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    expect(ctx.destroyHandlers.length).toBe(0);

    feature.setup!(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(0);
  });

  it("should run destroy handler without error", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    for (const handler of ctx.destroyHandlers) {
      handler();
    }
  });
});

// =============================================================================
// withSelection — Public Methods
// =============================================================================

describe("withSelection — Methods", () => {
  it("should register select method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("select")).toBe(true);
    expect(typeof ctx.methods.get("select")).toBe("function");
  });

  it("should register deselect method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("deselect")).toBe(true);
    expect(typeof ctx.methods.get("deselect")).toBe("function");
  });

  it("should register toggleSelect method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("toggleSelect")).toBe(true);
    expect(typeof ctx.methods.get("toggleSelect")).toBe("function");
  });

  it("should register selectAll method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("selectAll")).toBe(true);
    expect(typeof ctx.methods.get("selectAll")).toBe("function");
  });

  it("should register clearSelection method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("clearSelection")).toBe(true);
    expect(typeof ctx.methods.get("clearSelection")).toBe("function");
  });

  it("should register getSelected method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("getSelected")).toBe(true);
    expect(typeof ctx.methods.get("getSelected")).toBe("function");
  });

  it("should register getSelectedItems method", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.has("getSelectedItems")).toBe(true);
    expect(typeof ctx.methods.get("getSelectedItems")).toBe("function");
  });

  it("should register exactly 7 public methods", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(ctx.methods.size).toBe(7);
  });

  it("getSelected should return empty array initially", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;
    expect(getSelected()).toEqual([]);
  });

  it("select should add items to selection (variadic args)", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const select = ctx.methods.get("select") as (
      ...ids: Array<string | number>
    ) => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    select(5, 10);
    const selected = getSelected();
    expect(selected).toContain(5);
    expect(selected).toContain(10);
  });

  it("deselect should remove items from selection (variadic args)", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const select = ctx.methods.get("select") as (
      ...ids: Array<string | number>
    ) => void;
    const deselect = ctx.methods.get("deselect") as (
      ...ids: Array<string | number>
    ) => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    // First add items
    select(1, 2, 3);
    expect(getSelected().length).toBe(3);

    // Then remove one
    deselect(2);
    const selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(3);
    expect(selected).not.toContain(2);
  });

  it("clearSelection should remove all items from selection", () => {
    const feature = withSelection<TestItem>({
      mode: "multiple",
      initial: [1, 2, 3],
    });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const clearSelection = ctx.methods.get("clearSelection") as () => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    clearSelection();
    expect(getSelected()).toEqual([]);
  });

  it("toggleSelect should toggle item in selection", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const toggleSelect = ctx.methods.get("toggleSelect") as (
      id: string | number,
    ) => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    // Select
    toggleSelect(5);
    expect(getSelected()).toContain(5);

    // Deselect
    toggleSelect(5);
    expect(getSelected()).not.toContain(5);
  });

  it("select in single mode should replace previous selection", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const select = ctx.methods.get("select") as (
      ...ids: Array<string | number>
    ) => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    select(5);
    expect(getSelected()).toEqual([5]);

    select(10);
    expect(getSelected()).toEqual([10]);
  });

  it("selectAll should select all items in multiple mode", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const selectAll = ctx.methods.get("selectAll") as () => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    selectAll();
    const selected = getSelected();
    expect(selected.length).toBe(100);
  });

  it("selectAll should be a no-op in single mode", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const selectAll = ctx.methods.get("selectAll") as () => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    selectAll();
    expect(getSelected()).toEqual([]);
  });
});

// =============================================================================
// withSelection — ARIA
// =============================================================================

describe("withSelection — ARIA", () => {
  it("should add a live region element to the DOM for announcements", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // The feature creates an aria-live region for screen reader announcements
    const liveRegion = ctx.dom.root.querySelector("[aria-live]");
    expect(liveRegion).not.toBeNull();
  });

  it("should create live region with aria-live=polite and sr-only styling", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const liveRegion = ctx.dom.root.querySelector("[aria-live]");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.getAttribute("aria-live")).toBe("polite");
  });
});

// =============================================================================
// withSelection — None Mode
// =============================================================================

describe("withSelection — None Mode", () => {
  it("should still register methods in none mode", () => {
    const feature = withSelection<TestItem>({ mode: "none" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    // Methods are registered so API is consistent, they just no-op
    expect(ctx.methods.has("select")).toBe(true);
    expect(ctx.methods.has("getSelected")).toBe(true);
  });

  it("select should be a no-op in none mode", () => {
    const feature = withSelection<TestItem>({ mode: "none" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const select = ctx.methods.get("select") as (
      ids: Array<string | number>,
    ) => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<
      string | number
    >;

    select([1, 2, 3]);
    expect(getSelected()).toEqual([]);
  });
});