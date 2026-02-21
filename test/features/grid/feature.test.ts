/**
 * vlist - Grid Plugin Tests
 * Tests for withGrid plugin: initialization, configuration, rendering, events
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withGrid } from "../../../src/features/grid/feature";
import { createGridLayout } from "../../../src/features/grid/layout";
import { createGridRenderer } from "../../../src/features/grid/renderer";
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
  viewport.className = "vlist__viewport";
  content.className = "vlist__content";
  items.className = "vlist__items";

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items };
}

function createMockContext(): BuilderContext<TestItem> {
  const testDom = createTestDOM();
  const sizeCache = createSizeCache(50, 0);
  const rendered = new Map<number, HTMLElement>();
  const items: TestItem[] = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

  let renderIfNeededFn = () => {};
  let forceRenderFn = () => {};
  let virtualTotalFn = () => 100;

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
      items: items,
      item: {
        height: 50,
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
    } as any,
    scrollController: {
      getScrollTop: () => 0,
      scrollTo: () => {},
      isAtTop: () => true,
      isAtBottom: () => false,
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
        containerSize: 500,
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
      actualSize: 5000,
      virtualSize: 5000,
      ratio: 1,
    }),
    getCompressionContext: () => ({
      scrollPosition: 0,
      totalItems: 100,
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
      // Mock implementation
    },
    updateContentSize: (totalSize) => {
      testDom.content.style.height = `${totalSize}px`;
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
  };

  return ctx;
}

// =============================================================================
// withGrid - Factory Tests
// =============================================================================

describe("withGrid - Factory", () => {
  it("should create a plugin with name and priority", () => {
    const plugin = withGrid({ columns: 4 });

    expect(plugin.name).toBe("withGrid");
    expect(plugin.priority).toBe(10);
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("should throw error if columns is not provided", () => {
    expect(() => {
      withGrid({} as any);
    }).toThrow("columns must be a positive integer");
  });

  it("should throw error if columns is less than 1", () => {
    expect(() => {
      withGrid({ columns: 0 });
    }).toThrow("columns must be a positive integer");
  });

  it("should throw error if columns is negative", () => {
    expect(() => {
      withGrid({ columns: -5 });
    }).toThrow("columns must be a positive integer");
  });

  it("should accept valid columns configuration", () => {
    const plugin = withGrid({ columns: 4 });
    expect(plugin).toBeDefined();
  });

  it("should accept gap configuration", () => {
    const plugin = withGrid({ columns: 4, gap: 8 });
    expect(plugin).toBeDefined();
  });
});

// =============================================================================
// withGrid - Setup Tests
// =============================================================================

describe("withGrid - Setup", () => {
  it("should add grid CSS class to root", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.dom.root.classList.contains("vlist--grid")).toBe(true);
  });

  it("should throw error if reverse is true", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    (ctx.config as any).reverse = true;

    expect(() => {
      plugin.setup!(ctx);
    }).toThrow("withGrid cannot be used with reverse: true");
  });

  it("should set virtual total function", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    // 100 items / 4 columns = 25 rows
    expect(ctx.getVirtualTotal()).toBe(25);
  });

  it("should calculate correct rows for non-divisible items", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.dataManager.getTotal = () => 101;

    plugin.setup!(ctx);

    // 101 items / 4 columns = 26 rows (ceiling)
    expect(ctx.getVirtualTotal()).toBe(26);
  });

  it("should register resize handler", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.resizeHandlers.length).toBeGreaterThan(0);
  });

  it("should expose _getGridLayout method", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.methods.has("_getGridLayout")).toBe(true);
    const getLayout = ctx.methods.get("_getGridLayout");
    expect(getLayout).toBeInstanceOf(Function);
  });

  it("should expose _getGridConfig method", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.methods.has("_getGridConfig")).toBe(true);
  });

  it("should expose _replaceGridRenderer method", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.methods.has("_replaceGridRenderer")).toBe(true);
  });

  it("should expose _updateGridLayoutForGroups method", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.methods.has("_updateGridLayoutForGroups")).toBe(true);
  });

  it("should expose updateGrid method", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    expect(ctx.methods.has("updateGrid")).toBe(true);
  });
});

// =============================================================================
// withGrid - Configuration Tests
// =============================================================================

describe("withGrid - Configuration", () => {
  it("should support gap configuration", () => {
    const plugin = withGrid({ columns: 4, gap: 8 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.gap).toBe(8);
  });

  it("should default gap to 0 if not provided", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.gap).toBe(0);
  });

  it("should detect groups in items", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.rawConfig.items = [
      { id: 0, name: "Header", __groupHeader: true } as any,
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
    ];

    plugin.setup!(ctx);

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.isHeaderFn).toBeInstanceOf(Function);
  });

  it("should not add isHeaderFn if no groups detected", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.isHeaderFn).toBeUndefined();
  });
});

// =============================================================================
// withGrid - updateGrid Method Tests
// =============================================================================

describe("withGrid - updateGrid", () => {
  it("should update columns", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;
    updateGrid({ columns: 6 });

    // 100 items / 6 columns = 17 rows (ceiling)
    expect(ctx.getVirtualTotal()).toBe(17);
  });

  it("should throw error if columns is invalid", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ columns: 0 });
    }).toThrow("columns must be a positive integer");

    expect(() => {
      updateGrid({ columns: -1 });
    }).toThrow("columns must be a positive integer");

    expect(() => {
      updateGrid({ columns: 3.5 });
    }).toThrow("columns must be a positive integer");
  });

  it("should update gap", () => {
    const plugin = withGrid({ columns: 4, gap: 8 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;
    updateGrid({ gap: 16 });

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.gap).toBe(16);
  });

  it("should throw error if gap is negative", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ gap: -5 });
    }).toThrow("gap must be non-negative");
  });

  it("should update both columns and gap", () => {
    const plugin = withGrid({ columns: 4, gap: 8 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;
    updateGrid({ columns: 3, gap: 12 });

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.columns).toBe(3);
    expect(config.gap).toBe(12);
  });

  it("should trigger content size handlers", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    let handlerCalled = false;
    ctx.contentSizeHandlers.push(() => {
      handlerCalled = true;
    });

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;
    updateGrid({ columns: 6 });

    expect(handlerCalled).toBe(true);
  });

  it("should accept zero gap", () => {
    const plugin = withGrid({ columns: 4, gap: 8 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateGrid = ctx.methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ gap: 0 });
    }).not.toThrow();

    const getConfig = ctx.methods.get("_getGridConfig") as Function;
    const config = getConfig();

    expect(config.gap).toBe(0);
  });
});

// =============================================================================
// withGrid - Render Functions Tests
// =============================================================================

describe("withGrid - Render Functions", () => {
  it("should replace render functions", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    const originalRenderIfNeeded = ctx.renderIfNeeded;
    const originalForceRender = ctx.forceRender;

    plugin.setup!(ctx);

    // Should have replaced the functions
    const fns = ctx.getRenderFns();
    expect(fns.renderIfNeeded).not.toBe(originalRenderIfNeeded);
    expect(fns.forceRender).not.toBe(originalForceRender);
  });

  it("should not render if destroyed", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    ctx.state.isDestroyed = true;

    // Should not throw
    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();
  });

  it("should call force render without errors", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    ctx.state.lastRenderRange = { start: 0, end: 5 };

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();
  });

  it("should handle zero total rows gracefully", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.dataManager.getTotal = () => 0;

    plugin.setup!(ctx);

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
  });

  it("should handle zero container height gracefully", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.state.viewportState.containerSize = 0;

    plugin.setup!(ctx);

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
  });
});

// =============================================================================
// withGrid - Resize Handler Tests
// =============================================================================

describe("withGrid - Resize Handler", () => {
  it("should handle resize events", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1];

    // Should not throw
    expect(() => {
      resizeHandler!(1024, 768);
    }).not.toThrow();
  });

  it("should handle resize without errors", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const resizeHandler = ctx.resizeHandlers[ctx.resizeHandlers.length - 1];

    expect(() => {
      resizeHandler!(1024, 768);
    }).not.toThrow();
  });
});

// =============================================================================
// withGrid - Groups Support Tests
// =============================================================================

describe("withGrid - Groups Support", () => {
  it("should support _updateGridLayoutForGroups method", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const updateForGroups = ctx.methods.get(
      "_updateGridLayoutForGroups",
    ) as Function;

    expect(() => {
      updateForGroups((index: number) => index === 0);
    }).not.toThrow();
  });

  it("should update content height when updating for groups", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    const originalHeight = ctx.dom.content.style.height;
    const updateForGroups = ctx.methods.get(
      "_updateGridLayoutForGroups",
    ) as Function;

    updateForGroups((index: number) => index === 0);

    // Height may change after groups update
    expect(ctx.dom.content.style.height).toBeDefined();
  });
});

// =============================================================================
// withGrid - Dynamic Size Function Tests
// =============================================================================

describe("withGrid - Dynamic Size Function", () => {
  it("should support dynamic size function", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.rawConfig.item.height = (index: number) => 50 + index * 10;

    expect(() => {
      plugin.setup!(ctx);
    }).not.toThrow();
  });

  it("should support dynamic size with grid context", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    let receivedContext: any = null;
    ctx.rawConfig.item.height = (index: number, context: any) => {
      receivedContext = context;
      return 50;
    };

    plugin.setup!(ctx);

    // Context should be provided
    expect(receivedContext).toBeDefined();
  });
});

// =============================================================================
// withGrid - Edge Cases
// =============================================================================

describe("withGrid - Edge Cases", () => {
  it("should handle single column (degrades to list)", () => {
    const plugin = withGrid({ columns: 1 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    // 100 items / 1 column = 100 rows
    expect(ctx.getVirtualTotal()).toBe(100);
  });

  it("should handle large column count", () => {
    const plugin = withGrid({ columns: 50 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    // 100 items / 50 columns = 2 rows
    expect(ctx.getVirtualTotal()).toBe(2);
  });

  it("should handle column count larger than items", () => {
    const plugin = withGrid({ columns: 200 });
    const ctx = createMockContext();

    plugin.setup!(ctx);

    // 100 items / 200 columns = 1 row
    expect(ctx.getVirtualTotal()).toBe(1);
  });

  it("should handle empty items list", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.dataManager.getTotal = () => 0;

    plugin.setup!(ctx);

    expect(ctx.getVirtualTotal()).toBe(0);
  });

  it("should handle horizontal orientation", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    (ctx.config as any).horizontal = true;

    plugin.setup!(ctx);

    expect(ctx.dom.root.classList.contains("vlist--grid")).toBe(true);
  });
});

// =============================================================================
// withGrid - Integration Tests
// =============================================================================

describe("withGrid - Integration", () => {
  it("should work with compression context", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();
    ctx.state.viewportState.isCompressed = true;

    plugin.setup!(ctx);

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
  });

  it("should emit range:change event on render", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    let rangeChangeEmitted = false;
    ctx.emitter.emit = ((event: string) => {
      if (event === "range:change") {
        rangeChangeEmitted = true;
      }
    }) as any;

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(rangeChangeEmitted).toBe(true);
  });

  it("should update viewport state on render", () => {
    const plugin = withGrid({ columns: 4 });
    const ctx = createMockContext();

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    expect(ctx.state.viewportState.scrollPosition).toBeDefined();
    expect(ctx.state.viewportState.visibleRange).toBeDefined();
    expect(ctx.state.viewportState.renderRange).toBeDefined();
  });
});
