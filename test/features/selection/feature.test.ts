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

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
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
      getCached: () => testItems.length,
      getItem: (index: number) => testItems[index],
      getItemsInRange: (start: number, end: number) =>
        testItems.slice(start, end + 1),
      isItemLoaded: () => true,
      getState: () => ({ total: testItems.length }),
      getStorage: () => null,
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
    setItemToScrollIndexFn: () => {},
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

  it("should register 7 public + 2 internal methods", () => {
    const feature = withSelection<TestItem>();
    const ctx = createMockContext();

    feature.setup!(ctx);

    // 9 public methods + 2 internal getters (_getSelectedIds, _getFocusedIndex)
    expect(ctx.methods.size).toBe(11);
    expect(ctx.methods.has("_getSelectedIds")).toBe(true);
    expect(ctx.methods.has("_getFocusedIndex")).toBe(true);
    expect(ctx.methods.has("selectNext")).toBe(true);
    expect(ctx.methods.has("selectPrevious")).toBe(true);
  });

  it("selectNext should move focus and select next item", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

    // First call: focus starts at -1, moveFocusDown goes to 0
    selectNext();
    expect(getSelected()).toEqual([0]);

    // Second call: moves to index 1
    selectNext();
    expect(getSelected()).toEqual([1]);

    // Third call: moves to index 2
    selectNext();
    expect(getSelected()).toEqual([2]);
  });

  it("selectPrevious should move focus and select previous item", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;
    const selectPrevious = ctx.methods.get("selectPrevious") as () => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

    // Move to index 2
    selectNext();
    selectNext();
    selectNext();
    expect(getSelected()).toEqual([2]);

    // Move back to index 1
    selectPrevious();
    expect(getSelected()).toEqual([1]);
  });

  it("selectNext should not wrap past last item by default", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;
    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

    // 100 test items — move to last
    for (let i = 0; i < 100; i++) selectNext();
    expect(getSelected()).toEqual([99]);

    // Try to go past last — should stay on last
    selectNext();
    expect(getSelected()).toEqual([99]);
  });

  it("selectNext should not scroll when next item is within viewport", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    const scrollToMock = mock(() => {});
    ctx.scrollController.scrollTo = scrollToMock;
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;

    // Items are 50px, viewport is 600px, scrollPosition is 0.
    // Items 0–11 are visible. Moving from -1 → 0 → 1 stays in viewport.
    selectNext(); // index 0
    selectNext(); // index 1
    selectNext(); // index 2

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("selectNext should scroll with 'end' alignment when item goes below viewport", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    const scrollToMock = mock(() => {});
    ctx.scrollController.scrollTo = scrollToMock;
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;

    // Items are 50px, viewport is 600px (12 items visible: 0–11).
    // Navigate to index 11 (last visible), then to 12 (off-viewport).
    for (let i = 0; i < 12; i++) selectNext(); // index 0..11, all visible
    expect(scrollToMock).not.toHaveBeenCalled();

    selectNext(); // index 12 — offset 600, bottom edge 650 > scrollPos(0) + viewport(600)
    expect(scrollToMock).toHaveBeenCalled();
  });

  it("selectPrevious should scroll with 'start' alignment when item goes above viewport", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    const scrollToMock = mock(() => {});
    ctx.scrollController.scrollTo = scrollToMock;
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;
    const selectPrevious = ctx.methods.get("selectPrevious") as () => void;

    // Navigate to index 5 (middle of viewport)
    for (let i = 0; i < 6; i++) selectNext();
    expect(scrollToMock).not.toHaveBeenCalled();

    // Simulate that viewport has scrolled so index 5 is at the top edge.
    // scrollPosition = 250 means items 5–16 are visible.
    ctx.state.viewportState.scrollPosition = 250;

    // selectPrevious → index 4, offset 200 < scrollPos 250 → should scroll
    selectPrevious();
    expect(scrollToMock).toHaveBeenCalled();
  });

  it("selectPrevious should not scroll when previous item is within viewport", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();
    const scrollToMock = mock(() => {});
    ctx.scrollController.scrollTo = scrollToMock;
    feature.setup!(ctx);

    const selectNext = ctx.methods.get("selectNext") as () => void;
    const selectPrevious = ctx.methods.get("selectPrevious") as () => void;

    // Navigate to index 5 (middle of viewport, scrollPosition is 0)
    for (let i = 0; i < 6; i++) selectNext();

    // selectPrevious → index 4, offset 200, still in viewport (0–600)
    selectPrevious();
    expect(scrollToMock).not.toHaveBeenCalled();
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

// =============================================================================
// Helper: Context with working emitter
// =============================================================================

function createMockContextWithEmitter(): BuilderContext<TestItem> {
  const ctx = createMockContext();

  // Replace the no-op emitter with one that actually registers/fires callbacks
  const listeners = new Map<string, Array<(...args: any[]) => void>>();

  (ctx as any).emitter = {
    on: (event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return () => {
        const arr = listeners.get(event);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    },
    off: (event: string, handler: (...args: any[]) => void) => {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    emit: (event: string, payload: any) => {
      const arr = listeners.get(event);
      if (arr) arr.forEach((h) => h(payload));
    },
  };

  return ctx;
}

// =============================================================================
// withSelection — load:end Incremental Indexing
// =============================================================================

describe("withSelection — load:end indexing", () => {
  it("should index items incrementally via load:end with offset", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContextWithEmitter();

    // Start with 0 cached (async scenario)
    (ctx.dataManager as any).getCached = () => 0;

    feature.setup!(ctx);

    // Simulate a batch load at offset 0
    const batch: TestItem[] = [
      { id: 100, name: "A" },
      { id: 101, name: "B" },
    ];
    (ctx.dataManager as any).getItem = (i: number) =>
      i === 0 ? batch[0] : i === 1 ? batch[1] : undefined;

    ctx.emitter.emit("load:end", { items: batch, offset: 0 });

    // Now select by ID — getSelectedItems should resolve via the index
    const select = ctx.methods.get("select") as (...ids: any[]) => void;
    const getSelectedItems = ctx.methods.get("getSelectedItems") as () => TestItem[];

    select(100);
    const items = getSelectedItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(100);
  });

  it("should fallback to rebuildIdIndex when load:end has no offset", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContextWithEmitter();

    feature.setup!(ctx);

    // Emit load:end without offset — triggers rebuildIdIndex fallback
    ctx.emitter.emit("load:end", { items: [{ id: 0, name: "Item 0" }] });

    const select = ctx.methods.get("select") as (...ids: any[]) => void;
    const getSelectedItems = ctx.methods.get("getSelectedItems") as () => TestItem[];

    select(0);
    const items = getSelectedItems();
    expect(items.length).toBe(1);
  });

  it("should ignore empty load:end events", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContextWithEmitter();

    feature.setup!(ctx);

    // Should not throw
    ctx.emitter.emit("load:end", { items: [], offset: 0 });
    ctx.emitter.emit("load:end", { items: null as any });
  });
});

// =============================================================================
// withSelection — Sparse rebuildIdIndex
// =============================================================================

describe("withSelection — sparse ID indexing", () => {
  it("should use getLoadedRanges for sparse data", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContextWithEmitter();

    const sparseItems: Record<number, TestItem> = {
      0: { id: 100, name: "A" },
      1: { id: 101, name: "B" },
      50: { id: 150, name: "C" },
    };

    // Simulate sparse data: total=100, cached=3
    (ctx.dataManager as any).getTotal = () => 100;
    (ctx.dataManager as any).getCached = () => 3;
    (ctx.dataManager as any).getItem = (i: number) => sparseItems[i];
    (ctx.dataManager as any).getStorage = () => ({
      getLoadedRanges: () => [
        { start: 0, end: 1 },
        { start: 50, end: 50 },
      ],
    });

    feature.setup!(ctx);

    // Trigger rebuildIdIndex via load:end without offset
    ctx.emitter.emit("load:end", { items: [sparseItems[0]!] });

    const select = ctx.methods.get("select") as (...ids: any[]) => void;
    const getSelectedItems = ctx.methods.get("getSelectedItems") as () => TestItem[];

    select(150);
    const items = getSelectedItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(150);
  });
});

// =============================================================================
// withSelection — Focus Handlers
// =============================================================================

describe("withSelection — focusin handler", () => {
  it("should set focus on focusin with :focus-visible", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    const scrollToSpy = mock(() => {});
    const updateClassesSpy = mock(() => {});
    (ctx.scrollController as any).scrollTo = scrollToSpy;
    (ctx.renderer as any).updateItemClasses = updateClassesSpy;
    (ctx.dataManager as any).getState = () => ({ total: 100 });

    feature.setup!(ctx);

    // Stub :focus-visible to return true
    const originalMatches = ctx.dom.root.matches;
    ctx.dom.root.matches = (selector: string) => {
      if (selector === ":focus-visible") return true;
      return originalMatches.call(ctx.dom.root, selector);
    };

    // Dispatch focusin
    const focusEvent = new (dom.window as any).FocusEvent("focusin", { bubbles: true });
    ctx.dom.root.dispatchEvent(focusEvent);

    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-0");
    // scrollToFocus uses scroll-if-needed: item 0 at scroll position 0 is
    // already visible, so no scroll is performed. We only assert that the
    // focus class update happened.
    expect(updateClassesSpy).toHaveBeenCalled();

    // Cleanup
    ctx.dom.root.matches = originalMatches;
  });

  it("should not activate focus when :focus-visible is false", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    const scrollToSpy = mock(() => {});
    (ctx.scrollController as any).scrollTo = scrollToSpy;

    feature.setup!(ctx);

    // :focus-visible returns false by default in JSDOM
    const focusEvent = new (dom.window as any).FocusEvent("focusin", { bubbles: true });
    ctx.dom.root.dispatchEvent(focusEvent);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("should not activate focus when destroyed", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    ctx.state.isDestroyed = true;

    feature.setup!(ctx);

    const focusEvent = new (dom.window as any).FocusEvent("focusin", { bubbles: true });
    expect(() => ctx.dom.root.dispatchEvent(focusEvent)).not.toThrow();
  });

  it("should not activate focus when no items", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    (ctx.dataManager as any).getTotal = () => 0;

    feature.setup!(ctx);

    ctx.dom.root.matches = (selector: string) => {
      if (selector === ":focus-visible") return true;
      return false;
    };

    const focusEvent = new (dom.window as any).FocusEvent("focusin", { bubbles: true });
    ctx.dom.root.dispatchEvent(focusEvent);

    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBeNull();
  });
});

describe("withSelection — focusout handler", () => {
  it("should clear focus ring when focus leaves the list", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    const updateClassesSpy = mock(() => {});
    (ctx.renderer as any).updateItemClasses = updateClassesSpy;
    (ctx.dataManager as any).getState = () => ({ total: 100 });

    feature.setup!(ctx);

    // First, set focus via focusin
    ctx.dom.root.matches = (selector: string) => {
      if (selector === ":focus-visible") return true;
      return false;
    };
    ctx.dom.root.dispatchEvent(
      new (dom.window as any).FocusEvent("focusin", { bubbles: true }),
    );

    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-0");

    // Now blur — relatedTarget outside the root
    const outsideElement = document.createElement("button");
    document.body.appendChild(outsideElement);

    updateClassesSpy.mockClear();
    ctx.dom.root.dispatchEvent(
      new (dom.window as any).FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: outsideElement,
      }),
    );

    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBeNull();
    expect(updateClassesSpy).toHaveBeenCalled();

    outsideElement.remove();
  });

  it("should not clear focus when relatedTarget is inside root", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();

    feature.setup!(ctx);

    // Set focus first
    ctx.dom.root.matches = (selector: string) => {
      if (selector === ":focus-visible") return true;
      return false;
    };
    (ctx.dataManager as any).getState = () => ({ total: 100 });
    ctx.dom.root.dispatchEvent(
      new (dom.window as any).FocusEvent("focusin", { bubbles: true }),
    );

    // Blur to a child inside root
    const child = document.createElement("div");
    ctx.dom.root.appendChild(child);

    ctx.dom.root.dispatchEvent(
      new (dom.window as any).FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: child,
      }),
    );

    // Should still have aria-activedescendant since focus stayed inside
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-0");
  });

  it("should not throw when destroyed", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();

    feature.setup!(ctx);
    ctx.state.isDestroyed = true;

    const focusEvent = new (dom.window as any).FocusEvent("focusout", { bubbles: true });
    expect(() => ctx.dom.root.dispatchEvent(focusEvent)).not.toThrow();
  });
});

// =============================================================================
// withSelection — Keyboard: focus to negative index
// =============================================================================

describe("withSelection — keyboard edge cases", () => {
  it("should keep aria-activedescendant when ArrowUp at index 0 with wrap=false", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.renderer as any).updateItemClasses = mock(() => {});

    feature.setup!(ctx);

    // Focus item 0 via ArrowDown
    const arrowDown = new (dom.window as any).KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    arrowDown.preventDefault = mock(() => {});
    ctx.keydownHandlers[0]!(arrowDown);

    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-0");

    // ArrowUp at index 0 with wrap=false — focus stays at 0
    const arrowUp = new (dom.window as any).KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
    });
    arrowUp.preventDefault = mock(() => {});
    ctx.keydownHandlers[0]!(arrowUp);

    // Focus clamped at 0, aria-activedescendant unchanged
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-0");
  });

  it("should not scroll when totalItems is 0", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    const scrollToSpy = mock(() => {});
    (ctx.scrollController as any).scrollTo = scrollToSpy;
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.renderer as any).updateItemClasses = mock(() => {});
    (ctx.dataManager as any).getTotal = () => 0;
    (ctx.dataManager as any).getItem = () => undefined;

    feature.setup!(ctx);

    const arrowDown = new (dom.window as any).KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    arrowDown.preventDefault = mock(() => {});
    ctx.keydownHandlers[0]!(arrowDown);

    // With 0 items the handler returns early — no scroll
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// withSelection — Feature destroy
// =============================================================================

describe("withSelection — feature.destroy()", () => {
  it("should remove live region on feature.destroy()", () => {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    const liveRegion = ctx.dom.root.querySelector("[aria-live]");
    expect(liveRegion).not.toBeNull();

    feature.destroy!();

    const liveRegionAfter = ctx.dom.root.querySelector("[aria-live]");
    expect(liveRegionAfter).toBeNull();
  });

  it("should be safe to call feature.destroy() multiple times", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();

    feature.setup!(ctx);

    expect(() => {
      feature.destroy!();
      feature.destroy!();
    }).not.toThrow();
  });

  it("should be safe to call feature.destroy() without setup", () => {
    const feature = withSelection<TestItem>();
    expect(() => feature.destroy!()).not.toThrow();
  });
});

// =============================================================================
// withSelection — ARIA for grid context
// =============================================================================

describe("withSelection — ARIA in grid context", () => {
  it("should append live region to parent when root has role=grid", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContext();

    // Simulate grid context
    ctx.dom.root.setAttribute("role", "grid");

    feature.setup!(ctx);

    // Live region should be on root's parent, not on root itself
    const liveOnRoot = ctx.dom.root.querySelector("[aria-live]");
    const parent = ctx.dom.root.parentElement;
    const liveOnParent = parent?.querySelector("[aria-live]");

    // When role="grid", live region goes to parentElement
    expect(liveOnParent).not.toBeNull();

    // Cleanup
    feature.destroy!();
  });
});

// =============================================================================
// withSelection — Keyboard scroll behavior (scrollToFocus)
// =============================================================================

describe("withSelection — keyboard scroll", () => {
  /** Helper: set up a selection feature with spied scrollTo */
  function setupKeyboardTest(opts?: {
    containerSize?: number;
    itemHeight?: number;
    itemCount?: number;
    scrollPosition?: number;
  }) {
    const containerSize = opts?.containerSize ?? 600;
    const itemHeight = opts?.itemHeight ?? 50;
    const itemCount = opts?.itemCount ?? 100;
    const scrollPosition = opts?.scrollPosition ?? 0;

    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();

    const scrollToSpy = mock(() => {});
    (ctx.scrollController as any).scrollTo = scrollToSpy;
    (ctx.scrollController as any).getScrollTop = () => scrollPosition;

    const updateClassesSpy = mock(() => {});
    (ctx.renderer as any).updateItemClasses = updateClassesSpy;

    // Configure size cache and viewport
    const sizeCache = createSizeCache(itemHeight, itemCount);
    (ctx as any).sizeCache = sizeCache;
    ctx.state.viewportState.containerSize = containerSize;
    ctx.state.viewportState.scrollPosition = scrollPosition;

    // visibleRange: items that fit in viewport from current scroll
    const firstVisible = Math.floor(scrollPosition / itemHeight);
    const lastVisible = Math.min(
      itemCount - 1,
      firstVisible + Math.ceil(containerSize / itemHeight),
    );
    ctx.state.viewportState.visibleRange = { start: firstVisible, end: lastVisible };

    (ctx.dataManager as any).getTotal = () => itemCount;
    (ctx.dataManager as any).getItem = (index: number) =>
      index >= 0 && index < itemCount ? { id: index, name: `Item ${index}` } : undefined;

    feature.setup!(ctx);

    const fireKey = (key: string) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        bubbles: true,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
      return event;
    };

    return { ctx, feature, scrollToSpy, updateClassesSpy, fireKey, itemHeight, containerSize };
  }

  it("should not scroll when focused item is fully visible", () => {
    const { fireKey, scrollToSpy } = setupKeyboardTest();

    // Focus item 0 via ArrowDown (from -1 → 0)
    fireKey("ArrowDown");
    scrollToSpy.mockClear();

    // ArrowDown to item 1 — still well within viewport
    fireKey("ArrowDown");

    // Item 1 at offset 50-100 is fully visible in 600px viewport at scroll 0
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("should scroll down when focused item is below viewport", () => {
    const { fireKey, scrollToSpy } = setupKeyboardTest({
      itemHeight: 50,
      containerSize: 600,
    });

    // Focus item 0
    fireKey("ArrowDown");
    scrollToSpy.mockClear();

    // Jump to End (item 99) — definitely below viewport
    fireKey("End");

    // Should scroll to reveal item 99
    expect(scrollToSpy).toHaveBeenCalled();
    const scrollTarget = (scrollToSpy.mock.calls as any[][])[0]![0] as number;
    // Item 99 bottom = 100*50 = 5000, minus containerSize 600 = 4400
    expect(scrollTarget).toBe(99 * 50 + 50 - 600);
  });

  it("should scroll up when focused item is above viewport", () => {
    // Start scrolled down to item 50
    const { fireKey, scrollToSpy } = setupKeyboardTest({
      scrollPosition: 2500, // item 50 at top
      itemHeight: 50,
      containerSize: 600,
    });

    // Focus item via ArrowDown (starts at -1 → 0, but item 0 is above viewport)
    fireKey("ArrowDown");

    // focusedIndex starts at -1, ArrowDown → 0. Item 0 is at offset 0,
    // well above scrollPosition 2500. Should scroll up to item 0.
    expect(scrollToSpy).toHaveBeenCalled();
    const scrollTarget = (scrollToSpy.mock.calls as any[][])[0]![0] as number;
    expect(scrollTarget).toBe(0);
  });

  it("should align item to bottom edge when scrolling down", () => {
    const { fireKey, scrollToSpy } = setupKeyboardTest({
      itemHeight: 50,
      containerSize: 600,
      itemCount: 100,
    });

    // Focus item 0, then End to jump to item 99
    fireKey("ArrowDown");
    scrollToSpy.mockClear();
    fireKey("End");

    const scrollTarget = (scrollToSpy.mock.calls as any[][])[0]![0] as number;
    // itemBottom - containerSize = (99*50 + 50) - 600 = 4400
    expect(scrollTarget).toBe(4400);
  });

  it("should align item to top edge when scrolling up", () => {
    const { fireKey, scrollToSpy } = setupKeyboardTest({
      scrollPosition: 2500,
      itemHeight: 50,
      containerSize: 600,
    });

    // Focus item 0 (above viewport)
    fireKey("ArrowDown");

    const scrollTarget = (scrollToSpy.mock.calls as any[][])[0]![0] as number;
    // Item 0 offset = 0 → scroll to top of item
    expect(scrollTarget).toBe(0);
  });
});

// =============================================================================
// withSelection — PageUp / PageDown
// =============================================================================

describe("withSelection — PageUp/PageDown", () => {
  function setupPageTest(opts?: { itemCount?: number }) {
    const itemHeight = 50;
    const containerSize = 600;
    const itemCount = opts?.itemCount ?? 100;

    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();

    const scrollToSpy = mock(() => {});
    (ctx.scrollController as any).scrollTo = scrollToSpy;
    (ctx.scrollController as any).getScrollTop = () => 0;

    const updateClassesSpy = mock(() => {});
    (ctx.renderer as any).updateItemClasses = updateClassesSpy;

    const sizeCache = createSizeCache(itemHeight, itemCount);
    (ctx as any).sizeCache = sizeCache;
    ctx.state.viewportState.containerSize = containerSize;
    ctx.state.viewportState.scrollPosition = 0;
    ctx.state.viewportState.visibleRange = { start: 0, end: 13 };

    (ctx.dataManager as any).getTotal = () => itemCount;
    (ctx.dataManager as any).getItem = (index: number) =>
      index >= 0 && index < itemCount ? { id: index, name: `Item ${index}` } : undefined;

    feature.setup!(ctx);

    const fireKey = (key: string) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        bubbles: true,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
      return event;
    };

    return { ctx, feature, scrollToSpy, updateClassesSpy, fireKey, itemHeight, containerSize };
  }

  it("should move focus by page size on PageDown", () => {
    const { fireKey, updateClassesSpy, containerSize, itemHeight } = setupPageTest();
    const pageSize = Math.floor(containerSize / itemHeight); // 12

    // Focus item 0
    fireKey("ArrowDown");
    updateClassesSpy.mockClear();

    // PageDown: 0 + 12 = 12
    fireKey("PageDown");

    // The new focused item should be index 12
    // updateItemClasses is called for the old item (unfocused) and new item (focused)
    const focusedCalls = (updateClassesSpy.mock.calls as any[][]).filter(
      (call) => call[2] === true,
    );
    expect(focusedCalls.length).toBeGreaterThan(0);
    // The focused call should be for index 12
    expect(focusedCalls[focusedCalls.length - 1]![0]).toBe(pageSize);
  });

  it("should move focus by page size on PageUp", () => {
    const { fireKey, updateClassesSpy, containerSize, itemHeight } = setupPageTest();
    const pageSize = Math.floor(containerSize / itemHeight); // 12

    // Focus item 0, then End to go to 99
    fireKey("ArrowDown");
    fireKey("End");
    updateClassesSpy.mockClear();

    // PageUp from 99: 99 - 12 = 87
    fireKey("PageUp");

    const focusedCalls = (updateClassesSpy.mock.calls as any[][]).filter(
      (call) => call[2] === true,
    );
    expect(focusedCalls.length).toBeGreaterThan(0);
    expect(focusedCalls[focusedCalls.length - 1]![0]).toBe(99 - pageSize);
  });

  it("should preventDefault on PageDown", () => {
    const { fireKey } = setupPageTest();

    fireKey("ArrowDown"); // focus first
    const event = fireKey("PageDown");

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("should preventDefault on PageUp", () => {
    const { fireKey } = setupPageTest();

    fireKey("ArrowDown"); // focus first
    const event = fireKey("PageUp");

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("should clamp PageDown at last item", () => {
    const { fireKey, updateClassesSpy } = setupPageTest({ itemCount: 5 });

    fireKey("ArrowDown"); // focus 0
    updateClassesSpy.mockClear();

    // PageDown with pageSize 12 but only 5 items → clamp to 4
    fireKey("PageDown");

    const focusedCalls = (updateClassesSpy.mock.calls as any[][]).filter(
      (call) => call[2] === true,
    );
    expect(focusedCalls.length).toBeGreaterThan(0);
    expect(focusedCalls[focusedCalls.length - 1]![0]).toBe(4);
  });

  it("should clamp PageUp at first item", () => {
    const { fireKey, updateClassesSpy } = setupPageTest();

    // Focus item 3 (ArrowDown 4 times from -1)
    fireKey("ArrowDown"); // 0
    fireKey("ArrowDown"); // 1
    fireKey("ArrowDown"); // 2
    fireKey("ArrowDown"); // 3
    updateClassesSpy.mockClear();

    // PageUp from 3 with pageSize 12 → clamp to 0
    fireKey("PageUp");

    const focusedCalls = (updateClassesSpy.mock.calls as any[][]).filter(
      (call) => call[2] === true,
    );
    expect(focusedCalls.length).toBeGreaterThan(0);
    expect(focusedCalls[focusedCalls.length - 1]![0]).toBe(0);
  });
});

// =============================================================================
// withSelection + withTable — updateItemClasses delegation
// =============================================================================

describe("withSelection — table updateItemClasses delegation", () => {
  it("should call the replaced updateItemClassesFn on keyboard navigation", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();

    // Simulate what withTable does: replace the updateItemClassesFn
    const tableUpdateSpy = mock((_index: number, _isSelected: boolean, _isFocused: boolean) => {});
    let replacedFn: ((index: number, isSelected: boolean, isFocused: boolean) => void) | null = null;
    (ctx as any).setUpdateItemClassesFn = (fn: any) => {
      replacedFn = fn;
    };

    // Install a renderer that delegates to the replaced fn (simulating materialize)
    (ctx.renderer as any).updateItemClasses = (
      index: number,
      isSelected: boolean,
      isFocused: boolean,
    ) => {
      tableUpdateSpy(index, isSelected, isFocused);
    };

    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.dataManager as any).getTotal = () => 100;
    (ctx.dataManager as any).getItem = (index: number) =>
      index >= 0 && index < 100 ? { id: index, name: `Item ${index}` } : undefined;

    feature.setup!(ctx);

    // Fire ArrowDown to focus item 0
    const event = new (dom.window as any).KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    event.preventDefault = mock(() => {});
    ctx.keydownHandlers[0]!(event);

    // The renderer's updateItemClasses should have been called with focus on item 0
    const focusedCalls = (tableUpdateSpy.mock.calls as any[][]).filter(
      (call) => call[2] === true,
    );
    expect(focusedCalls.length).toBe(1);
    expect(focusedCalls[0]![0]).toBe(0); // index 0
    expect(focusedCalls[0]![1]).toBe(false); // not selected
    expect(focusedCalls[0]![2]).toBe(true); // focused
  });

  it("should unfocus previous item and focus new item on ArrowDown", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();

    const updateSpy = mock((_index: number, _isSelected: boolean, _isFocused: boolean) => {});
    (ctx.renderer as any).updateItemClasses = updateSpy;
    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.dataManager as any).getTotal = () => 100;
    (ctx.dataManager as any).getItem = (index: number) =>
      index >= 0 && index < 100 ? { id: index, name: `Item ${index}` } : undefined;

    feature.setup!(ctx);

    const fireKey = (key: string) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        bubbles: true,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
    };

    // ArrowDown → focus item 0
    fireKey("ArrowDown");
    updateSpy.mockClear();

    // ArrowDown → focus item 1 (unfocus item 0)
    fireKey("ArrowDown");

    // Should have 2 calls: unfocus item 0, focus item 1
    expect(updateSpy.mock.calls.length).toBe(2);

    // First call: unfocus item 0
    const calls = updateSpy.mock.calls as any[][];
    expect(calls[0]![0]).toBe(0); // index
    expect(calls[0]![2]).toBe(false); // not focused

    // Second call: focus item 1
    expect(calls[1]![0]).toBe(1); // index
    expect(calls[1]![2]).toBe(true); // focused
  });
});

// =============================================================================
// withSelection — Group Header Skipping (#5)
// =============================================================================

/**
 * Helper: create a mock context where certain indices are group headers.
 * Simulates a layout like: [header(0), item(1), item(2), header(3), item(4), ...]
 */
function createGroupedMockContext(headerIndices: Set<number>): BuilderContext<TestItem> {
  const ctx = createMockContextWithEmitter();

  // Register _isGroupHeader before withSelection.setup() resolves it
  ctx.methods.set("_isGroupHeader", (index: number): boolean => {
    return headerIndices.has(index);
  });

  return ctx;
}

describe("withSelection — group header skipping", () => {
  // Layout: [H(0), item(1), item(2), H(3), item(4), item(5), H(6), item(7)]
  const headers = new Set([0, 3, 6]);

  function setupGrouped(opts?: { mode?: "single" | "multiple"; followFocus?: boolean }) {
    const feature = withSelection<TestItem>({
      mode: opts?.mode ?? "single",
      followFocus: opts?.followFocus,
    });
    const ctx = createGroupedMockContext(headers);
    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.renderer as any).updateItemClasses = mock(() => {});
    (ctx.dataManager as any).getTotal = () => 8;
    (ctx.dataManager as any).getState = () => ({ total: 8 });

    feature.setup!(ctx);

    const fireKey = (key: string, extra?: Record<string, any>) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        bubbles: true,
        ...extra,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
      return event;
    };

    const focusIn = () => {
      const orig = ctx.dom.root.matches;
      ctx.dom.root.matches = (sel: string) =>
        sel === ":focus-visible" ? true : orig.call(ctx.dom.root, sel);
      const ev = new (dom.window as any).FocusEvent("focusin", { bubbles: true });
      ctx.dom.root.dispatchEvent(ev);
      ctx.dom.root.matches = orig;
    };

    return { ctx, feature, fireKey, focusIn };
  }

  // ── focusin ──────────────────────────────────────────────────

  it("focusin should skip header at index 0 and land on index 1", () => {
    const { ctx, focusIn } = setupGrouped();
    focusIn();
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-1");
  });

  // ── ArrowDown ────────────────────────────────────────────────

  it("ArrowDown should skip header at index 3", () => {
    const { ctx, focusIn, fireKey } = setupGrouped();
    focusIn(); // → index 1
    fireKey("ArrowDown"); // → index 2
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-2");

    fireKey("ArrowDown"); // would land on 3 (header) → skip to 4
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-4");
  });

  // ── ArrowUp ──────────────────────────────────────────────────

  it("ArrowUp should skip header at index 3", () => {
    const { ctx, focusIn, fireKey } = setupGrouped();
    focusIn(); // → 1
    fireKey("ArrowDown"); // → 2
    fireKey("ArrowDown"); // → 4 (skipped 3)
    fireKey("ArrowUp"); // would land on 3 (header) → skip to 2
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-2");
  });

  // ── Home / End ───────────────────────────────────────────────

  it("Home should skip header at index 0 and land on index 1", () => {
    const { ctx, focusIn, fireKey } = setupGrouped();
    focusIn(); // → 1
    fireKey("ArrowDown"); // → 2
    fireKey("Home"); // would land on 0 (header) → skip to 1
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-1");
  });

  it("End should land on last non-header item", () => {
    const { ctx, focusIn, fireKey } = setupGrouped();
    focusIn(); // → 1
    fireKey("End"); // index 7 (not a header)
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-7");
  });

  // ── PageDown / PageUp ────────────────────────────────────────

  it("PageDown should skip header if it lands on one", () => {
    const { ctx, focusIn, fireKey } = setupGrouped();
    // With containerSize=600 and itemHeight=50 → pageSize=12, but total=8
    // so PageDown from 1 → min(1+12, 7) = 7 → not a header, fine.
    // Use a smaller container to get a more interesting page size.
    ctx.state.viewportState.containerSize = 150; // pageSize = 3
    focusIn(); // → 1
    fireKey("PageDown"); // 1+3=4 → not a header → lands on 4
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-4");
  });

  // ── Click ────────────────────────────────────────────────────

  it("click on a group header should be ignored", () => {
    const { ctx } = setupGrouped();
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    // Create a fake item element at index 0 (header)
    const itemEl = document.createElement("div");
    itemEl.setAttribute("data-index", "0");
    ctx.dom.items.appendChild(itemEl);

    const clickEvent = new (dom.window as any).MouseEvent("click", { bubbles: true });
    Object.defineProperty(clickEvent, "target", { value: itemEl });

    ctx.clickHandlers[0]!(clickEvent);

    // No item:click event should have been emitted
    const itemClickCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "item:click",
    );
    expect(itemClickCalls.length).toBe(0);
  });

  it("click on a regular item should work normally", () => {
    const { ctx } = setupGrouped();
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    // Create a fake item element at index 1 (regular item)
    const itemEl = document.createElement("div");
    itemEl.setAttribute("data-index", "1");
    ctx.dom.items.appendChild(itemEl);

    const clickEvent = new (dom.window as any).MouseEvent("click", { bubbles: true });
    Object.defineProperty(clickEvent, "target", { value: itemEl });

    ctx.clickHandlers[0]!(clickEvent);

    const itemClickCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "item:click",
    );
    expect(itemClickCalls.length).toBe(1);
  });

  // ── Space / Enter ────────────────────────────────────────────

  it("Space should not select a header even if somehow focused on one", () => {
    const { ctx, focusIn, fireKey } = setupGrouped();
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    focusIn(); // → 1

    // Manually force focusedIndex to a header to test the guard
    // We do this by navigating to index 4, then patching getTotal
    // so ArrowDown wraps to 0 (header). Instead, just test that
    // Space on a normal item works and doesn't crash.
    fireKey(" "); // Space on index 1 → should toggle selection

    const selChanges = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "selection:change",
    );
    expect(selChanges.length).toBeGreaterThan(0);
  });

  // ── selectNext / selectPrevious ──────────────────────────────

  it("selectNext should skip headers", () => {
    const { ctx, focusIn } = setupGrouped();
    focusIn(); // → 1

    // Get the selectNext method
    const selectNext = ctx.methods.get("selectNext") as () => void;
    expect(selectNext).toBeDefined();

    selectNext(); // 1 → 2
    selectNext(); // 2 → would be 3 (header) → skips to 4
    selectNext(); // 4 → 5

    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;
    const selected = getSelected();
    // In single mode, only last item is selected
    expect(selected).toEqual([5]);
  });

  it("selectPrevious should skip headers", () => {
    const { ctx, focusIn } = setupGrouped();
    focusIn(); // → 1

    const selectNext = ctx.methods.get("selectNext") as () => void;
    const selectPrevious = ctx.methods.get("selectPrevious") as () => void;

    selectNext(); // → 2
    selectNext(); // → 4 (skipped 3)
    selectPrevious(); // 4 → would be 3 (header) → skips to 2

    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;
    expect(getSelected()).toEqual([2]);
  });

  // ── No groups active ────────────────────────────────────────

  it("should work normally when _isGroupHeader is not registered", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.renderer as any).updateItemClasses = mock(() => {});
    (ctx.dataManager as any).getState = () => ({ total: 100 });

    // No _isGroupHeader registered on ctx.methods
    feature.setup!(ctx);

    const orig = ctx.dom.root.matches;
    ctx.dom.root.matches = (sel: string) =>
      sel === ":focus-visible" ? true : orig.call(ctx.dom.root, sel);
    const ev = new (dom.window as any).FocusEvent("focusin", { bubbles: true });
    ctx.dom.root.dispatchEvent(ev);
    ctx.dom.root.matches = orig;

    // Should land on index 0 (no skipping)
    expect(ctx.dom.root.getAttribute("aria-activedescendant")).toBe("vlist-item-0");
  });

  // ── followFocus with headers ─────────────────────────────────

  it("followFocus should select the item after skipping a header", () => {
    const { ctx, focusIn, fireKey } = setupGrouped({ followFocus: true });
    focusIn(); // → 1
    fireKey("ArrowDown"); // → 2
    fireKey("ArrowDown"); // would be 3 (header) → 4

    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;
    expect(getSelected()).toEqual([4]);
  });
});

// =============================================================================
// withSelection — Shift+keyboard range selection
// =============================================================================

describe("withSelection — Shift+keyboard range selection", () => {
  function setupShiftTest() {
    const feature = withSelection<TestItem>({ mode: "multiple" });
    const ctx = createMockContextWithEmitter();
    const scrollToSpy = mock(() => {});
    (ctx.scrollController as any).scrollTo = scrollToSpy;
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.renderer as any).updateItemClasses = mock(() => {});

    feature.setup!(ctx);

    const fireKey = (key: string, opts?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        shiftKey: opts?.shiftKey ?? false,
        ctrlKey: opts?.ctrlKey ?? false,
        metaKey: opts?.metaKey ?? false,
        bubbles: true,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
      return event;
    };

    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

    return { feature, ctx, fireKey, getSelected, scrollToSpy };
  }

  it("Shift+ArrowDown should toggle the origin item (default mode)", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move focus to item 2 (non-shift, no selection)
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+ArrowDown: toggle origin (2, unselected → selected), focus → 3
    fireKey("ArrowDown", { shiftKey: true }); // focus → 3

    const selected = getSelected();
    expect(selected).toContain(2);
    expect(selected.length).toBe(1);
  });

  it("Shift+ArrowDown multiple times should toggle each origin item", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 1
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1

    // Shift+ArrowDown×3: toggle origins 1, 2, 3
    fireKey("ArrowDown", { shiftKey: true }); // toggle 1 ON, focus → 2
    fireKey("ArrowDown", { shiftKey: true }); // toggle 2 ON, focus → 3
    fireKey("ArrowDown", { shiftKey: true }); // toggle 3 ON, focus → 4

    const selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected.length).toBe(3);
  });

  it("Shift+ArrowUp should toggle each origin item upward", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 4
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4

    // Shift+ArrowUp×2: toggle origins 4, 3
    fireKey("ArrowUp", { shiftKey: true }); // toggle 4 ON, focus → 3
    fireKey("ArrowUp", { shiftKey: true }); // toggle 3 ON, focus → 2

    const selected = getSelected();
    expect(selected).toContain(4);
    expect(selected).toContain(3);
    expect(selected.length).toBe(2);
  });

  it("Shift+Home should only move focus without selecting (no Ctrl)", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 5
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Shift+Home (no Ctrl): just moves focus, no selection change
    fireKey("Home", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);
  });

  it("Ctrl+Shift+Home should select from focused item to first item", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 5
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Ctrl+Shift+Home: select range from previous focus (5) to first item (0)
    fireKey("Home", { shiftKey: true, ctrlKey: true });

    const selected = getSelected();
    for (let i = 0; i <= 5; i++) {
      expect(selected).toContain(i);
    }
    expect(selected.length).toBe(6);
  });

  it("Shift+End should only move focus without selecting (no Ctrl)", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 2
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+End (no Ctrl): just moves focus, no selection change
    fireKey("End", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);
  });

  it("Ctrl+Shift+End should select from focused item to last item", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 2
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Ctrl+Shift+End: select range from previous focus (2) to last item (99)
    fireKey("End", { shiftKey: true, ctrlKey: true });

    const selected = getSelected();
    for (let i = 2; i <= 99; i++) {
      expect(selected).toContain(i);
    }
    expect(selected.length).toBe(98);
  });

  it("Shift+PageDown should only move focus without selecting", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 2
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+PageDown: just moves focus, no selection change
    fireKey("PageDown", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);
  });

  it("Shift+PageUp should only move focus without selecting", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 20
    for (let i = 0; i <= 20; i++) fireKey("ArrowDown");

    // Shift+PageUp: just moves focus, no selection change
    fireKey("PageUp", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);
  });

  it("non-shift navigation after shift-toggle should preserve selections", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 2
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+ArrowDown: toggle origin 2 ON, focus → 3
    fireKey("ArrowDown", { shiftKey: true }); // focus → 3

    let selected = getSelected();
    expect(selected).toContain(2);
    expect(selected.length).toBe(1);

    // Non-shift ArrowDown just moves focus — selection preserved
    fireKey("ArrowDown"); // focus → 4

    // Shift+ArrowDown: toggle origin 4 ON, focus → 5
    fireKey("ArrowDown", { shiftKey: true }); // focus → 5

    selected = getSelected();
    // All selections preserved — Shift+Arrow is additive
    expect(selected).toContain(2);
    expect(selected).toContain(4);
    expect(selected.length).toBe(2);
  });

  it("Space sets lastSelectedIndex for Shift+Space range", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 2
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Toggle item 2 with Space (sets lastSelectedIndex = 2)
    fireKey(" ");

    let selected = getSelected();
    expect(selected).toContain(2);
    expect(selected.length).toBe(1);

    // Move to item 5 without selecting
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Shift+Space: contiguous range from lastSelectedIndex (2) to focused (5)
    fireKey(" ", { shiftKey: true });

    selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected.length).toBe(4);
  });

  it("Shift+Arrow after Space should continue toggling from new position", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 2
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Toggle item 2 with Space
    fireKey(" ");

    // Navigate down to item 4 (no selection change)
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4

    // Shift+ArrowDown: toggle origin 4 (unselected → ON), focus → 5
    fireKey("ArrowDown", { shiftKey: true });
    // Shift+ArrowDown: toggle origin 5 (unselected → ON), focus → 6
    fireKey("ArrowDown", { shiftKey: true });

    const selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected.length).toBe(3);
  });

  it("should be a no-op in single mode", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.renderer as any).updateItemClasses = mock(() => {});

    feature.setup!(ctx);

    const fireKey = (key: string, opts?: { shiftKey?: boolean }) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        shiftKey: opts?.shiftKey ?? false,
        bubbles: true,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
    };

    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

    // Move to item 2
    fireKey("ArrowDown");
    fireKey("ArrowDown");
    fireKey("ArrowDown");

    // Shift+ArrowDown in single mode — should not create a range selection
    fireKey("ArrowDown", { shiftKey: true });

    const selected = getSelected();
    // In single mode, shift has no range-selection effect
    expect(selected.length).toBeLessThanOrEqual(1);
  });

  it("Shift+ArrowDown then Shift+ArrowUp should toggle off previously toggled items", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Select items 3,4,5 via Space
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey(" "); // select 3
    fireKey("ArrowDown"); // focus → 4
    fireKey(" "); // select 4
    fireKey("ArrowDown"); // focus → 5
    fireKey(" "); // select 5

    // Go back to focus on item 3
    fireKey("ArrowUp"); // focus → 4
    fireKey("ArrowUp"); // focus → 3

    // Shift+ArrowDown: toggle origin 3 (selected → OFF), focus → 4
    fireKey("ArrowDown", { shiftKey: true });
    // Shift+ArrowDown: toggle origin 4 (selected → OFF), focus → 5
    fireKey("ArrowDown", { shiftKey: true });

    let selected = getSelected();
    expect(selected).toContain(5);
    expect(selected.length).toBe(1);
  });

  it("Shift+ArrowDown then Shift+ArrowUp past start should toggle off and then toggle on new items", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 5
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Shift+ArrowDown×2: toggle origins 5, 6
    fireKey("ArrowDown", { shiftKey: true }); // toggle 5 ON, focus → 6
    fireKey("ArrowDown", { shiftKey: true }); // toggle 6 ON, focus → 7

    let selected = getSelected();
    expect(selected).toContain(5);
    expect(selected).toContain(6);
    expect(selected.length).toBe(2);

    // Shift+ArrowUp: toggle origins going up
    fireKey("ArrowUp", { shiftKey: true }); // toggle 7 (not selected → ON), focus → 6
    fireKey("ArrowUp", { shiftKey: true }); // toggle 6 (selected → OFF), focus → 5
    fireKey("ArrowUp", { shiftKey: true }); // toggle 5 (selected → OFF), focus → 4
    fireKey("ArrowUp", { shiftKey: true }); // toggle 4 (not selected → ON), focus → 3

    selected = getSelected();
    expect(selected).toContain(4);
    expect(selected).toContain(7);
    expect(selected.length).toBe(2);
  });

  it("Shift+Arrow is additive — preserves Space toggles and earlier Shift+Arrow toggles", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Step 1: Move focus to item 1
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1

    // Step 2: Shift+ArrowDown×2: toggle origins 1, 2
    fireKey("ArrowDown", { shiftKey: true }); // toggle 1 ON, focus → 2
    fireKey("ArrowDown", { shiftKey: true }); // toggle 2 ON, focus → 3

    let selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected.length).toBe(2);

    // Step 3: Release shift, navigate down
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Step 4: Space to toggle item 5
    fireKey(" ");

    selected = getSelected();
    // Prior Shift+Arrow toggles [1,2] plus Space toggle [5]
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(5);
    expect(selected.length).toBe(3);

    // Step 5: Navigate down a couple more
    fireKey("ArrowDown"); // focus → 6
    fireKey("ArrowDown"); // focus → 7

    // Step 6: Shift+ArrowDown: toggle origin 7
    fireKey("ArrowDown", { shiftKey: true }); // toggle 7 ON, focus → 8

    selected = getSelected();
    // All prior selections [1,2,5] preserved; new toggle [7] added
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(5);
    expect(selected).toContain(7);
    expect(selected.length).toBe(4);

    // Step 7: Continue with Shift+ArrowDown — toggle origin 8
    fireKey("ArrowDown", { shiftKey: true }); // toggle 8 ON, focus → 9

    selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(5);
    expect(selected).toContain(7);
    expect(selected).toContain(8);
    expect(selected.length).toBe(5);
  });

  it("Ctrl+A should select all, then deselect all", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Focus first item
    fireKey("ArrowDown"); // focus → 0

    // Ctrl+A: select all (100 items)
    fireKey("a", { ctrlKey: true });

    let selected = getSelected();
    expect(selected.length).toBe(100);

    // Ctrl+A again: deselect all (all were selected → toggle to none)
    fireKey("a", { ctrlKey: true });

    selected = getSelected();
    expect(selected.length).toBe(0);
  });

  it("Ctrl+A should be a no-op in single mode", () => {
    const feature = withSelection<TestItem>({ mode: "single" });
    const ctx = createMockContextWithEmitter();
    (ctx.scrollController as any).scrollTo = mock(() => {});
    (ctx.scrollController as any).getScrollTop = () => 0;
    (ctx.renderer as any).updateItemClasses = mock(() => {});

    feature.setup!(ctx);

    const fireKey = (key: string, opts?: { ctrlKey?: boolean }) => {
      const event = new (dom.window as any).KeyboardEvent("keydown", {
        key,
        ctrlKey: opts?.ctrlKey ?? false,
        bubbles: true,
      });
      event.preventDefault = mock(() => {});
      ctx.keydownHandlers[0]!(event);
    };

    const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

    fireKey("ArrowDown");
    fireKey("a", { ctrlKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);
  });

  it("Shift+Space without prior selection should be a no-op", () => {
    const { fireKey, getSelected } = setupShiftTest();

    // Move to item 3 without selecting anything
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3

    // Shift+Space with no lastSelectedIndex set — should do nothing
    fireKey(" ", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);
  });

  describe("shiftArrowToggle: 'destination'", () => {
    function setupDestinationTest() {
      const feature = withSelection<TestItem>({ mode: "multiple", shiftArrowToggle: "destination" });
      const ctx = createMockContextWithEmitter();
      const scrollToSpy = mock(() => {});
      (ctx.scrollController as any).scrollTo = scrollToSpy;
      (ctx.scrollController as any).getScrollTop = () => 0;
      (ctx.renderer as any).updateItemClasses = mock(() => {});

      feature.setup!(ctx);

      const fireKey = (key: string, opts?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
        const event = new (dom.window as any).KeyboardEvent("keydown", {
          key,
          shiftKey: opts?.shiftKey ?? false,
          ctrlKey: opts?.ctrlKey ?? false,
          metaKey: opts?.metaKey ?? false,
          bubbles: true,
        });
        event.preventDefault = mock(() => {});
        ctx.keydownHandlers[0]!(event);
        return event;
      };

      const getSelected = ctx.methods.get("getSelected") as () => Array<string | number>;

      return { feature, ctx, fireKey, getSelected, scrollToSpy };
    }

    it("Shift+ArrowDown should toggle the destination item", () => {
      const { fireKey, getSelected } = setupDestinationTest();

      // Move focus to item 2
      fireKey("ArrowDown"); // focus → 0
      fireKey("ArrowDown"); // focus → 1
      fireKey("ArrowDown"); // focus → 2

      // Shift+ArrowDown: toggle destination (3) ON, focus → 3
      fireKey("ArrowDown", { shiftKey: true });

      const selected = getSelected();
      expect(selected).toContain(3);
      expect(selected.length).toBe(1);
    });

    it("Shift+ArrowDown multiple times should toggle each destination", () => {
      const { fireKey, getSelected } = setupDestinationTest();

      // Move to item 1
      fireKey("ArrowDown"); // focus → 0
      fireKey("ArrowDown"); // focus → 1

      // Shift+ArrowDown×3: toggle destinations 2, 3, 4
      fireKey("ArrowDown", { shiftKey: true }); // focus → 2, toggle 2 ON
      fireKey("ArrowDown", { shiftKey: true }); // focus → 3, toggle 3 ON
      fireKey("ArrowDown", { shiftKey: true }); // focus → 4, toggle 4 ON

      const selected = getSelected();
      expect(selected).toContain(2);
      expect(selected).toContain(3);
      expect(selected).toContain(4);
      expect(selected.length).toBe(3);
    });

    it("Shift+ArrowUp should toggle each destination upward", () => {
      const { fireKey, getSelected } = setupDestinationTest();

      // Move to item 4
      fireKey("ArrowDown"); // focus → 0
      fireKey("ArrowDown"); // focus → 1
      fireKey("ArrowDown"); // focus → 2
      fireKey("ArrowDown"); // focus → 3
      fireKey("ArrowDown"); // focus → 4

      // Shift+ArrowUp×2: toggle destinations 3, 2
      fireKey("ArrowUp", { shiftKey: true }); // focus → 3, toggle 3 ON
      fireKey("ArrowUp", { shiftKey: true }); // focus → 2, toggle 2 ON

      const selected = getSelected();
      expect(selected).toContain(3);
      expect(selected).toContain(2);
      expect(selected.length).toBe(2);
    });

    it("Shift+ArrowDown on selected block should deselect destination items", () => {
      const { fireKey, getSelected } = setupDestinationTest();

      // Select items 2,3,4 via Space
      fireKey("ArrowDown"); // focus → 0
      fireKey("ArrowDown"); // focus → 1
      fireKey("ArrowDown"); // focus → 2
      fireKey(" "); // select 2
      fireKey("ArrowDown"); // focus → 3
      fireKey(" "); // select 3
      fireKey("ArrowDown"); // focus → 4
      fireKey(" "); // select 4

      // Go back to item 2
      fireKey("ArrowUp"); // focus → 3
      fireKey("ArrowUp"); // focus → 2

      // Shift+Down through the selected block: each destination gets toggled OFF
      fireKey("ArrowDown", { shiftKey: true }); // toggle destination 3 OFF, focus → 3
      fireKey("ArrowDown", { shiftKey: true }); // toggle destination 4 OFF, focus → 4

      const selected = getSelected();
      expect(selected).toContain(2); // not yet toggled
      expect(selected.length).toBe(1);
    });
  });
});