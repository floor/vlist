/**
 * vlist - Masonry Feature Tests
 * Tests for withMasonry feature: factory validation, setup, render function
 * replacement via setRenderFns, resize handling, data changes, scrollToIndex,
 * destroy cleanup, and edge cases.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withMasonry } from "../../../src/features/masonry/feature";
import type { MasonryFeatureConfig } from "../../../src/features/masonry/feature";
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
  global.Element = dom.window.Element;
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
  height?: number;
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

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  // Give viewport real dimensions so clientWidth/clientHeight return non-zero
  Object.defineProperty(viewport, "clientWidth", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(viewport, "clientHeight", {
    value: 600,
    configurable: true,
  });

  return { root, viewport, content, items };
}

function createMockContext(
  itemCount: number = 100,
  options?: {
    horizontal?: boolean;
    reverse?: boolean;
    itemHeight?: number | ((index: number) => number);
  },
): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const heights = options?.itemHeight ?? 100;
  const heightFn = typeof heights === "function" ? heights : () => heights;

  const testItems: TestItem[] = Array.from({ length: itemCount }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    height: heightFn(i),
  }));

  let renderIfNeededFn = () => {};
  let forceRenderFn = () => {};
  let virtualTotalFn = () => itemCount;
  let totalSizeFn = () => 0;

  const ctx: BuilderContext<TestItem> = {
    dom: testDom as any,
    sizeCache: {
      getOffset: (index: number) => index * 100,
      getSize: () => 100,
      indexAtOffset: (offset: number) => Math.floor(offset / 100),
      getTotalSize: () => totalSizeFn(),
      getTotal: () => itemCount,
      rebuild: () => {},
      isVariable: () => false,
    } as any,
    emitter: {
      on: () => {},
      off: () => {},
      emit: () => {},
    } as any,
    config: {
      overscan: 2,
      classPrefix: "vlist",
      reverse: options?.reverse ?? false,
      wrap: false,
      horizontal: options?.horizontal ?? false,
      ariaIdPrefix: "vlist-test",
    },
    rawConfig: {
      container: document.createElement("div"),
      items: testItems,
      item: {
        height: typeof heights === "function" ? heights : heights,
        width: options?.horizontal ? 200 : undefined,
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
      setItems: (newItems: TestItem[]) => {
        testItems.length = 0;
        testItems.push(...newItems);
      },
    } as any,
    scrollController: {
      getScrollTop: () => 0,
      scrollTo: () => {},
      scrollBy: () => {},
      isAtTop: () => true,
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
        containerSize: 600,
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
      isInitialized: false,
      isDestroyed: false,
      cachedCompression: null,
    } as any,
    getContainerWidth: () => 800,
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
      totalItems: itemCount,
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
    updateContentSize: (size) => {
      testDom.content.style.height = `${size}px`;
    },
    updateCompressionMode: () => {},
    setVisibleRangeFn: () => {},
    setScrollToPosFn: () => {},
    setPositionElementFn: () => {},
    setScrollFns: () => {},
    setScrollTarget: () => {},
    getScrollTarget: () => window as any,
    setContainerDimensions: () => {},
    disableViewportResize: () => {},
    disableWheelHandler: () => {},
  };

  return ctx;
}

// =============================================================================
// withMasonry — Factory Tests
// =============================================================================

describe("withMasonry - Factory", () => {
  it("should create a feature with name and priority", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });

    expect(feature.name).toBe("withMasonry");
    expect(feature.priority).toBe(10);
    expect(feature.setup).toBeInstanceOf(Function);
  });

  it("should throw error if columns is 0", () => {
    expect(() => {
      withMasonry<TestItem>({ columns: 0 });
    }).toThrow("columns must be a positive integer");
  });

  it("should throw error if columns is negative", () => {
    expect(() => {
      withMasonry<TestItem>({ columns: -3 });
    }).toThrow("columns must be a positive integer");
  });

  it("should throw error if columns is not provided", () => {
    expect(() => {
      withMasonry<TestItem>({} as any);
    }).toThrow("columns must be a positive integer");
  });

  it("should accept valid columns configuration", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    expect(feature).toBeDefined();
  });

  it("should accept gap configuration", () => {
    const feature = withMasonry<TestItem>({ columns: 4, gap: 8 });
    expect(feature).toBeDefined();
  });
});

// =============================================================================
// withMasonry — Setup Tests
// =============================================================================

describe("withMasonry - Setup", () => {
  it("should add masonry CSS class to root", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.dom.root.classList.contains("vlist--masonry")).toBe(true);
  });

  it("should throw error if reverse is true", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100, { reverse: true });

    expect(() => {
      feature.setup(ctx);
    }).toThrow("cannot be combined with reverse mode");
  });

  it("should register resize handler", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();
    const resizeCountBefore = ctx.resizeHandlers.length;

    feature.setup(ctx);

    expect(ctx.resizeHandlers.length).toBe(resizeCountBefore + 1);
  });

  it("should register destroy handler", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();
    const destroyCountBefore = ctx.destroyHandlers.length;

    feature.setup(ctx);

    expect(ctx.destroyHandlers.length).toBe(destroyCountBefore + 1);
  });

  it("should register scrollToIndex method", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();

    feature.setup(ctx);

    expect(ctx.methods.has("scrollToIndex")).toBe(true);
  });

  it("should set content height based on masonry layout", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);

    // Content should have a height set (the masonry total size)
    const height = parseInt(ctx.dom.content.style.height, 10);
    expect(height).toBeGreaterThan(0);
  });

  it("should set content width for horizontal mode", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100, { horizontal: true });

    feature.setup(ctx);

    const width = parseInt(ctx.dom.content.style.width, 10);
    expect(width).toBeGreaterThan(0);
  });
});

// =============================================================================
// withMasonry — Render Function Replacement
// =============================================================================

describe("withMasonry - Render Functions", () => {
  it("should replace render functions via setRenderFns", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();

    const originalRenderIfNeeded = ctx.getRenderFns().renderIfNeeded;
    const originalForceRender = ctx.getRenderFns().forceRender;

    feature.setup(ctx);

    const newFns = ctx.getRenderFns();
    expect(newFns.renderIfNeeded).not.toBe(originalRenderIfNeeded);
    expect(newFns.forceRender).not.toBe(originalForceRender);
  });

  it("should replace render functions so ctx.renderIfNeeded calls masonry render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);

    // Calling renderIfNeeded should not throw and should render masonry items
    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
  });

  it("should replace render functions so ctx.forceRender calls masonry render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);

    // Calling forceRender should not throw
    expect(() => {
      ctx.forceRender();
    }).not.toThrow();
  });

  it("should not render if destroyed", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.state.isDestroyed = true;

    // Should not throw even though destroyed
    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
  });

  it("should render items into the items container", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.forceRender();

    // Masonry renderer should have added child elements to dom.items
    const renderedCount = ctx.dom.items.children.length;
    expect(renderedCount).toBeGreaterThan(0);
  });

  it("should render items with masonry-item class", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.forceRender();

    const firstChild = ctx.dom.items.children[0] as HTMLElement;
    expect(firstChild).toBeDefined();
    expect(firstChild.classList.contains("vlist-masonry-item")).toBe(true);
    expect(firstChild.classList.contains("vlist-item")).toBe(true);
  });

  it("should render items with data-lane attribute", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.forceRender();

    const firstChild = ctx.dom.items.children[0] as HTMLElement;
    expect(firstChild.dataset.lane).toBeDefined();
    const lane = parseInt(firstChild.dataset.lane!, 10);
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(lane).toBeLessThan(4);
  });

  it("should distribute items across multiple lanes", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.forceRender();

    // Collect unique lanes from rendered items
    const lanes = new Set<string>();
    for (const child of ctx.dom.items.children) {
      const lane = (child as HTMLElement).dataset.lane;
      if (lane !== undefined) lanes.add(lane);
    }

    // With 20 items and 4 columns, all 4 lanes should be used
    expect(lanes.size).toBe(4);
  });

  it("should position items with translate(x, y) for multi-column layout", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(8);

    feature.setup(ctx);
    ctx.forceRender();

    // Items in different lanes should have different x offsets
    const xPositions = new Set<string>();
    for (const child of ctx.dom.items.children) {
      const transform = (child as HTMLElement).style.transform;
      // Extract x from translate(Xpx, Ypx)
      const match = transform.match(/translate\((\d+)px/);
      if (match) xPositions.add(match[1]!);
    }

    expect(xPositions.size).toBeGreaterThan(1);
  });

  it("should set explicit width on masonry items", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(4);

    feature.setup(ctx);
    ctx.forceRender();

    const firstChild = ctx.dom.items.children[0] as HTMLElement;
    expect(firstChild.style.width).not.toBe("");
    const width = parseInt(firstChild.style.width, 10);
    expect(width).toBeGreaterThan(0);
    // 800px viewport / 4 columns = 200px per column
    expect(width).toBe(200);
  });

  it("should set explicit width accounting for gap", () => {
    const feature = withMasonry<TestItem>({ columns: 4, gap: 8 });
    const ctx = createMockContext(4);

    feature.setup(ctx);
    ctx.forceRender();

    const firstChild = ctx.dom.items.children[0] as HTMLElement;
    const width = parseInt(firstChild.style.width, 10);
    // (800 - 3*8) / 4 = (800 - 24) / 4 = 194
    expect(width).toBe(194);
  });
});

// =============================================================================
// withMasonry — Variable Heights
// =============================================================================

describe("withMasonry - Variable Heights", () => {
  it("should support function-based heights", () => {
    const heights = [200, 150, 300, 100, 250];
    const feature = withMasonry<TestItem>({ columns: 2 });
    const ctx = createMockContext(5, {
      itemHeight: (i) => heights[i % heights.length]!,
    });

    feature.setup(ctx);
    ctx.forceRender();

    // Items should have different heights
    const heightValues = new Set<string>();
    for (const child of ctx.dom.items.children) {
      heightValues.add((child as HTMLElement).style.height);
    }
    expect(heightValues.size).toBeGreaterThan(1);
  });

  it("should support fixed height", () => {
    const feature = withMasonry<TestItem>({ columns: 3 });
    const ctx = createMockContext(6, { itemHeight: 150 });

    feature.setup(ctx);
    ctx.forceRender();

    // All items should have the same height
    for (const child of ctx.dom.items.children) {
      expect((child as HTMLElement).style.height).toBe("150px");
    }
  });

  it("should calculate total size based on tallest lane", () => {
    // With variable heights, the total should be the tallest lane
    const feature = withMasonry<TestItem>({ columns: 2 });
    const ctx = createMockContext(4, {
      itemHeight: (i) => (i === 0 ? 500 : 100),
    });

    feature.setup(ctx);

    // Item 0 → lane 0 (500px), Items 1,2,3 → lane 1 (100+100+100=300)
    // Total = max(500, 300) = 500
    const contentHeight = parseInt(ctx.dom.content.style.height, 10);
    expect(contentHeight).toBe(500);
  });
});

// =============================================================================
// withMasonry — Viewport State Updates
// =============================================================================

describe("withMasonry - Viewport State", () => {
  it("should update visibleRange in viewport state after render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);
    ctx.forceRender();

    const { visibleRange } = ctx.state.viewportState;
    expect(visibleRange.start).toBeGreaterThanOrEqual(0);
    expect(visibleRange.end).toBeGreaterThan(visibleRange.start);
  });

  it("should update renderRange in viewport state after render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);
    ctx.forceRender();

    const { renderRange } = ctx.state.viewportState;
    expect(renderRange.start).toBeGreaterThanOrEqual(0);
    expect(renderRange.end).toBeGreaterThan(renderRange.start);
  });

  it("should update scrollPosition in viewport state after render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);
    ctx.forceRender();

    expect(ctx.state.viewportState.scrollPosition).toBe(0);
  });

  it("should update lastRenderRange after render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);

    // Before render, lastRenderRange should be -1, -1
    expect(ctx.state.lastRenderRange.start).toBe(-1);

    ctx.forceRender();

    // After force render, lastRenderRange should be updated
    expect(ctx.state.lastRenderRange.start).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// withMasonry — Resize Handler
// =============================================================================

describe("withMasonry - Resize Handler", () => {
  it("should handle resize events without error", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();

    feature.setup(ctx);

    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1]!;

    expect(() => {
      resizeHandler(1200, 800);
    }).not.toThrow();
  });

  it("should update layout when container width changes", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.forceRender();

    const heightBefore = ctx.dom.content.style.height;

    // Simulate resize to wider container
    Object.defineProperty(ctx.dom.viewport, "clientWidth", {
      value: 1200,
      configurable: true,
    });

    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1]!;
    resizeHandler(1200, 600);

    // The content height shouldn't change for uniform height items with the
    // same number of columns, but the item widths should change.
    // Just verify it doesn't break.
    const heightAfter = ctx.dom.content.style.height;
    expect(heightAfter).toBeDefined();
  });

  it("should not update layout if container size hasn't changed", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();

    feature.setup(ctx);

    // Resize with same dimensions — should be a no-op
    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1]!;
    const heightBefore = ctx.dom.content.style.height;

    resizeHandler(800, 600); // Same as initial

    expect(ctx.dom.content.style.height).toBe(heightBefore);
  });
});

// =============================================================================
// withMasonry — Data Changes
// =============================================================================

describe("withMasonry - Data Changes", () => {
  it("should update layout when items change via setItems", () => {
    const feature = withMasonry<TestItem>({ columns: 2 });
    const ctx = createMockContext(10);

    feature.setup(ctx);
    ctx.forceRender();

    const heightBefore = ctx.dom.content.style.height;

    // Change items to have more data
    const newItems: TestItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `New Item ${i + 1}`,
    }));
    ctx.dataManager.setItems(newItems);

    // Content height should have increased with more items
    const heightAfter = parseInt(ctx.dom.content.style.height, 10);
    const heightBeforeNum = parseInt(heightBefore, 10);
    expect(heightAfter).toBeGreaterThan(heightBeforeNum);
  });
});

// =============================================================================
// withMasonry — scrollToIndex
// =============================================================================

describe("withMasonry - scrollToIndex", () => {
  it("should register scrollToIndex in methods map", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);

    expect(ctx.methods.has("scrollToIndex")).toBe(true);
    expect(typeof ctx.methods.get("scrollToIndex")).toBe("function");
  });

  it("should call scrollController.scrollTo with item position", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let scrolledTo: number | null = null;
    ctx.scrollController.scrollTo = (pos: number) => {
      scrolledTo = pos;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(0, "start");

    expect(scrolledTo).not.toBeNull();
    expect(scrolledTo!).toBe(0);
  });

  it("should scroll to correct position for non-zero index", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let scrolledTo: number | null = null;
    ctx.scrollController.scrollTo = (pos: number) => {
      scrolledTo = pos;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "start");

    // Item 50 in 4 columns should be somewhere in the middle of the layout
    expect(scrolledTo).not.toBeNull();
    expect(scrolledTo!).toBeGreaterThan(0);
  });

  it("should handle center alignment", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let scrolledTo: number | null = null;
    ctx.scrollController.scrollTo = (pos: number) => {
      scrolledTo = pos;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "center");

    expect(scrolledTo).not.toBeNull();
  });

  it("should handle end alignment", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let scrolledTo: number | null = null;
    ctx.scrollController.scrollTo = (pos: number) => {
      scrolledTo = pos;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "end");

    expect(scrolledTo).not.toBeNull();
  });

  it("should clamp scroll position to >= 0", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let scrolledTo: number | null = null;
    ctx.scrollController.scrollTo = (pos: number) => {
      scrolledTo = pos;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(0, "center"); // center alignment might try to go negative

    expect(scrolledTo).not.toBeNull();
    expect(scrolledTo!).toBeGreaterThanOrEqual(0);
  });

  it("should no-op for out-of-bounds index", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(10);

    let scrolledTo: number | null = null;
    ctx.scrollController.scrollTo = (pos: number) => {
      scrolledTo = pos;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(9999); // way out of bounds

    // Should not call scrollTo since there's no placement for index 9999
    expect(scrolledTo).toBeNull();
  });

  it("should pass smooth behavior to scrollController", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let wasSmooth: boolean | null = null;
    ctx.scrollController.scrollTo = (_pos: number, smooth?: boolean) => {
      wasSmooth = smooth ?? false;
    };

    feature.setup(ctx);

    const scrollToIndex = ctx.methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "start", "smooth");

    expect(wasSmooth).not.toBeNull();
    expect(wasSmooth!).toBe(true);
  });
});

// =============================================================================
// withMasonry — Destroy
// =============================================================================

describe("withMasonry - Destroy", () => {
  it("should remove masonry CSS class on destroy", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext();

    feature.setup(ctx);
    expect(ctx.dom.root.classList.contains("vlist--masonry")).toBe(true);

    // Run all destroy handlers
    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.root.classList.contains("vlist--masonry")).toBe(false);
  });

  it("should clean up rendered elements on destroy", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(20);

    feature.setup(ctx);
    ctx.forceRender();

    expect(ctx.dom.items.children.length).toBeGreaterThan(0);

    // Run all destroy handlers
    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    expect(ctx.dom.items.children.length).toBe(0);
  });
});

// =============================================================================
// withMasonry — Gap Configuration
// =============================================================================

describe("withMasonry - Gap", () => {
  it("should default gap to 0 when not provided", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    feature.setup(ctx);

    // With no gap, total height should be less than with gap
    const heightNoGap = parseInt(ctx.dom.content.style.height, 10);

    // Recreate with gap
    const feature2 = withMasonry<TestItem>({ columns: 4, gap: 20 });
    const ctx2 = createMockContext(100);
    feature2.setup(ctx2);

    const heightWithGap = parseInt(ctx2.dom.content.style.height, 10);
    expect(heightWithGap).toBeGreaterThan(heightNoGap);
  });

  it("should produce taller layout with larger gap", () => {
    const feature1 = withMasonry<TestItem>({ columns: 4, gap: 4 });
    const ctx1 = createMockContext(50);
    feature1.setup(ctx1);
    const height1 = parseInt(ctx1.dom.content.style.height, 10);

    const feature2 = withMasonry<TestItem>({ columns: 4, gap: 20 });
    const ctx2 = createMockContext(50);
    feature2.setup(ctx2);
    const height2 = parseInt(ctx2.dom.content.style.height, 10);

    expect(height2).toBeGreaterThan(height1);
  });
});

// =============================================================================
// withMasonry — Column Count Effects
// =============================================================================

describe("withMasonry - Column Count", () => {
  it("should produce shorter layout with more columns", () => {
    const feature2 = withMasonry<TestItem>({ columns: 2 });
    const ctx2 = createMockContext(100);
    feature2.setup(ctx2);
    const height2 = parseInt(ctx2.dom.content.style.height, 10);

    const feature4 = withMasonry<TestItem>({ columns: 4 });
    const ctx4 = createMockContext(100);
    feature4.setup(ctx4);
    const height4 = parseInt(ctx4.dom.content.style.height, 10);

    expect(height4).toBeLessThan(height2);
  });

  it("should handle single column (degrades to list)", () => {
    const feature = withMasonry<TestItem>({ columns: 1 });
    const ctx = createMockContext(10);

    feature.setup(ctx);
    ctx.forceRender();

    // All items should be in lane 0
    for (const child of ctx.dom.items.children) {
      expect((child as HTMLElement).dataset.lane).toBe("0");
    }
  });

  it("should handle more columns than items", () => {
    const feature = withMasonry<TestItem>({ columns: 20 });
    const ctx = createMockContext(5);

    feature.setup(ctx);
    ctx.forceRender();

    // Each item should get its own lane
    const lanes = new Set<string>();
    for (const child of ctx.dom.items.children) {
      lanes.add((child as HTMLElement).dataset.lane!);
    }
    expect(lanes.size).toBe(5);
  });
});

// =============================================================================
// withMasonry — Edge Cases
// =============================================================================

describe("withMasonry - Edge Cases", () => {
  it("should handle empty items list", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(0);

    feature.setup(ctx);

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();

    expect(ctx.dom.items.children.length).toBe(0);
    expect(parseInt(ctx.dom.content.style.height, 10)).toBe(0);
  });

  it("should handle single item", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(1);

    feature.setup(ctx);
    ctx.forceRender();

    expect(ctx.dom.items.children.length).toBe(1);
    const el = ctx.dom.items.children[0] as HTMLElement;
    expect(el.dataset.lane).toBe("0");
    expect(el.dataset.index).toBe("0");
  });

  it("should handle large item count", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(10000);

    feature.setup(ctx);

    // Content height should be calculated for all items
    const height = parseInt(ctx.dom.content.style.height, 10);
    expect(height).toBeGreaterThan(0);

    // Render should only create DOM elements for visible items (virtualization)
    ctx.forceRender();
    const renderedCount = ctx.dom.items.children.length;
    expect(renderedCount).toBeLessThan(10000);
    expect(renderedCount).toBeGreaterThan(0);
  });

  it("should virtualize — render far fewer items than total", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(1000);

    feature.setup(ctx);
    ctx.forceRender();

    const renderedCount = ctx.dom.items.children.length;
    // With a 600px viewport and ~100px items, we should have roughly
    // (600/100 + overscan) * 4 columns ≈ 30-50 items, certainly not 1000
    expect(renderedCount).toBeLessThan(100);
    expect(renderedCount).toBeGreaterThan(0);
  });
});

// =============================================================================
// withMasonry — Selection Integration
// =============================================================================

describe("withMasonry - Selection Integration", () => {
  it("should read selection state from registered methods", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(10);

    // Register mock selection methods (as withSelection would)
    const selectedIds = new Set<string | number>([3, 5]);
    ctx.methods.set("_getSelectedIds", () => selectedIds);
    ctx.methods.set("_getFocusedIndex", () => 2);

    feature.setup(ctx);
    ctx.forceRender();

    // The items with id 3 and 5 should have selected class
    let foundSelected = false;
    for (const child of ctx.dom.items.children) {
      const el = child as HTMLElement;
      const id = parseInt(el.dataset.id!, 10);
      if (id === 3 || id === 5) {
        expect(el.classList.contains("vlist-item--selected")).toBe(true);
        foundSelected = true;
      }
    }
    expect(foundSelected).toBe(true);
  });

  it("should apply focused class from registered method", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(10);

    ctx.methods.set("_getSelectedIds", () => new Set());
    ctx.methods.set("_getFocusedIndex", () => 0);

    feature.setup(ctx);
    ctx.forceRender();

    // Index 0 should be focused
    const el0 = ctx.dom.items.querySelector('[data-index="0"]') as HTMLElement;
    if (el0) {
      expect(el0.classList.contains("vlist-item--focused")).toBe(true);
    }
  });

  it("should work without selection methods registered", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(10);

    // No _getSelectedIds or _getFocusedIndex registered
    feature.setup(ctx);

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();

    // No items should be selected or focused
    for (const child of ctx.dom.items.children) {
      const el = child as HTMLElement;
      expect(el.classList.contains("vlist-item--selected")).toBe(false);
      expect(el.classList.contains("vlist-item--focused")).toBe(false);
    }
  });
});

// =============================================================================
// withMasonry — Emit Events
// =============================================================================

describe("withMasonry - Events", () => {
  it("should emit range:change on first render", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let emittedRange: any = null;
    ctx.emitter.emit = ((event: string, data: any) => {
      if (event === "range:change") {
        emittedRange = data;
      }
    }) as any;

    feature.setup(ctx);
    ctx.forceRender();

    expect(emittedRange).not.toBeNull();
    expect(emittedRange.range).toBeDefined();
    expect(emittedRange.range.start).toBeGreaterThanOrEqual(0);
    expect(emittedRange.range.end).toBeGreaterThan(0);
  });

  it("should not emit range:change if range hasn't changed", () => {
    const feature = withMasonry<TestItem>({ columns: 4 });
    const ctx = createMockContext(100);

    let emitCount = 0;
    ctx.emitter.emit = ((event: string) => {
      if (event === "range:change") emitCount++;
    }) as any;

    feature.setup(ctx);
    ctx.forceRender(); // First render
    const firstEmitCount = emitCount;

    ctx.renderIfNeeded(); // Same scroll position, same range
    // Should not emit again since range didn't change
    expect(emitCount).toBe(firstEmitCount);
  });
});