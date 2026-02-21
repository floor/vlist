/**
 * vlist - Builder Materialize Context Tests
 * Tests for createMaterializeCtx: context initialization, getters, methods, and lifecycle
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import {
  createMaterializeCtx,
  createDefaultDataProxy,
  createDefaultScrollProxy,
} from "../../src/builder/materialize";
import type { MRefs, MDeps } from "../../src/builder/materialize";
import { createSizeCache } from "../../src/rendering/sizes";
import { createElementPool } from "../../src/builder/pool";
import type { VListItem, Range } from "../../src/types";

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

  root.className = "vlist";
  viewport.className = "vlist__viewport";
  content.className = "vlist__content";

  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content };
}

function createTestRefs(): MRefs<TestItem> {
  return {
    it: [] as TestItem[],
    hc: createSizeCache(50, 0),
    dm: null as any,
    sc: null as any,
    at: (item: TestItem) => `<div>${item.name}</div>`,
    ss: new Set(),
    fi: -1,
    st: window as any,
    sgt: () => 0,
    sst: (pos: number) => {
      void pos;
    },
    ls: 0,
    ch: 500,
    cw: 400,
    gch: () => 500,
    gcw: () => 400,
    rfn: () => {},
    ffn: () => {},
    vtf: () => 0,
    gvr: () => {},
    gsp: () => 0,
    pef: () => {},
    vt: { velocity: 0, sampleCount: 0 },
    sab: () => false,
    sic: false,
    ii: false,
    vre: true,
  };
}

function createTestDeps(): MDeps<TestItem> {
  const testDom = createTestDOM();
  const rendered = new Map<number, HTMLElement>();
  const pool = createElementPool();
  const emitter = {
    on: () => {},
    off: () => {},
    emit: () => {},
  } as any;

  return {
    dom: testDom,
    emitter,
    resolvedConfig: {
      itemSize: 50,
      overscan: 2,
      buffer: 0,
      direction: "vertical" as const,
      className: "",
      classPrefix: "vlist",
      renderMode: "materialize" as const,
      cache: true,
      smoothScroll: false,
      stickyIndices: [],
      scrollBehavior: "smooth" as const,
      throttle: 16,
      template: (item: TestItem) => `<div>${item.name}</div>`,
      getItemId: (item: TestItem) => item.id,
      windowScroll: false,
      compression: false,
      compressionThreshold: 1000,
      scrollTarget: null,
      resizeObserver: true,
      scrollThrottle: 16,
    },
    rawConfig: {},
    rendered,
    pool,
    sharedState: {
      dataState: {
        total: 0,
        cached: 0,
        isLoading: false,
        pendingRanges: [],
        error: undefined,
        hasMore: false,
        cursor: undefined,
      },
      viewportState: {
        scrollTop: 0,
        scrollPercentage: 0,
        containerSize: 500,
        isAtTop: true,
        isAtBottom: false,
        isScrolling: false,
        velocity: 0,
      },
      renderState: {
        range: { start: 0, end: 0 },
        visibleRange: { start: 0, end: 0 },
        renderedCount: 0,
      },
    },
    isHorizontal: false,
    classPrefix: "vlist",
    contentSizeHandlers: [],
    afterScroll: [],
    clickHandlers: [],
    keydownHandlers: [],
    resizeHandlers: [],
    destroyHandlers: [],
    methods: {},
    onScrollFrame: () => {},
    resizeObserver: {
      observe: () => {},
      unobserve: () => {},
      disconnect: () => {},
    } as any,
    renderRange: { start: 0, end: 0 },
    itemState: undefined,
    applyTemplate: (el: HTMLElement, html: string) => {
      el.innerHTML = html;
    },
    updateContentSize: () => {},
  };
}

// =============================================================================
// createMaterializeCtx - Factory Tests
// =============================================================================

describe("createMaterializeCtx - Factory", () => {
  it("should create a context with all required properties", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx).toBeDefined();
    expect(ctx.dom).toBeDefined();
    expect(ctx.sizeCache).toBeDefined();
    expect(ctx.emitter).toBeDefined();
    expect(ctx.config).toBeDefined();
    expect(ctx.rawConfig).toBeDefined();
    expect(ctx.renderer).toBeDefined();
    expect(ctx.dataManager).toBeDefined();
    expect(ctx.scrollController).toBeDefined();
    expect(ctx.state).toBeDefined();
  });

  it("should expose getter for dom", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.dom).toBe(deps.dom);
  });

  it("should expose getter for sizeCache", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.sizeCache).toBe(refs.hc);
  });

  it("should expose getter for emitter", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.emitter).toBe(deps.emitter);
  });

  it("should expose getter for config", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.config).toBe(deps.resolvedConfig);
  });

  it("should expose getter for rawConfig", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.rawConfig).toBe(deps.rawConfig);
  });

  it("should expose state from sharedState", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.state).toBe(deps.sharedState);
  });
});

// =============================================================================
// Renderer Methods
// =============================================================================

describe("createMaterializeCtx - Renderer", () => {
  it("should provide renderer.render method", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.renderer.render).toBeInstanceOf(Function);
  });

  it("should inject selection state when rendering", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    let renderCalled = false;
    refs.ffn = () => {
      renderCalled = true;
    };

    const ctx = createMaterializeCtx(refs, deps);
    const selected = new Set([1, 2]);
    const focusedIdx = 1;

    ctx.renderer.render([], { start: 0, end: 0 }, selected, focusedIdx);

    expect(refs.ss).toBe(selected);
    expect(refs.fi).toBe(focusedIdx);
    expect(renderCalled).toBe(true);
  });

  it("should provide renderer.updateItemClasses method", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.renderer.updateItemClasses).toBeInstanceOf(Function);
  });

  it("should update element classes when item is rendered", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const el = document.createElement("div");
    deps.rendered.set(0, el);

    ctx.renderer.updateItemClasses(0, true, false);

    expect(el.classList.contains("vlist-item--selected")).toBe(true);
    expect(el.classList.contains("vlist-item--focused")).toBe(false);
    expect(el.ariaSelected).toBe("true");
  });

  it("should toggle focused class correctly", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const el = document.createElement("div");
    deps.rendered.set(0, el);

    ctx.renderer.updateItemClasses(0, false, true);

    expect(el.classList.contains("vlist-item--selected")).toBe(false);
    expect(el.classList.contains("vlist-item--focused")).toBe(true);
    expect(el.ariaSelected).toBe("false");
  });

  it("should handle missing element gracefully", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    // Should not throw
    expect(() => {
      ctx.renderer.updateItemClasses(999, true, false);
    }).not.toThrow();
  });

  it("should provide renderer.getElement method", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.renderer.getElement).toBeInstanceOf(Function);
  });

  it("should return element for rendered index", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const el = document.createElement("div");
    deps.rendered.set(5, el);

    expect(ctx.renderer.getElement(5)).toBe(el);
  });

  it("should return null for non-rendered index", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.renderer.getElement(999)).toBe(null);
  });
});

// =============================================================================
// Data Manager Proxy
// =============================================================================

describe("createMaterializeCtx - Data Manager", () => {
  it("should get and set dataManager", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const mockDM = { getItem: () => null };
    ctx.dataManager = mockDM as any;

    expect(refs.dm).toBe(mockDM);
    expect(ctx.dataManager).toBe(mockDM);
  });

  it("should allow replacing dataManager", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const dm1 = { id: 1 };
    const dm2 = { id: 2 };

    ctx.dataManager = dm1 as any;
    expect(ctx.dataManager).toBe(dm1);

    ctx.replaceDataManager(dm2 as any);
    expect(ctx.dataManager).toBe(dm2);
    expect(refs.dm).toBe(dm2);
  });
});

// =============================================================================
// Scroll Controller Proxy
// =============================================================================

describe("createMaterializeCtx - Scroll Controller", () => {
  it("should get and set scrollController", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const mockSC = { scrollTo: () => {} };
    ctx.scrollController = mockSC as any;

    expect(refs.sc).toBe(mockSC);
    expect(ctx.scrollController).toBe(mockSC);
  });

  it("should allow replacing scrollController", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const sc1 = { id: 1 };
    const sc2 = { id: 2 };

    ctx.scrollController = sc1 as any;
    expect(ctx.scrollController).toBe(sc1);

    ctx.replaceScrollController(sc2 as any);
    expect(ctx.scrollController).toBe(sc2);
    expect(refs.sc).toBe(sc2);
  });
});

// =============================================================================
// Container Width
// =============================================================================

describe("createMaterializeCtx - Container Width", () => {
  it("should return current container width", () => {
    const refs = createTestRefs();
    refs.cw = 800;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.getContainerWidth()).toBe(800);
  });

  it("should update when container width changes", () => {
    const refs = createTestRefs();
    refs.cw = 400;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.getContainerWidth()).toBe(400);

    refs.cw = 1000;
    expect(ctx.getContainerWidth()).toBe(1000);
  });
});

// =============================================================================
// Template Replacement
// =============================================================================

describe("createMaterializeCtx - Template", () => {
  it("should replace template function", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const newTemplate = (item: TestItem) => `<span>${item.name}</span>`;
    ctx.replaceTemplate(newTemplate as any);

    expect(refs.at).toBe(newTemplate);
  });

  it("should use new template after replacement", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const item: TestItem = { id: 1, name: "Test" };
    const originalResult = refs.at(item, 0, undefined);

    const newTemplate = (item: TestItem) =>
      `<span class="new">${item.name}</span>`;
    ctx.replaceTemplate(newTemplate as any);

    const newResult = refs.at(item, 0, undefined);
    expect(newResult).not.toBe(originalResult);
    expect(newResult).toContain('class="new"');
  });
});

// =============================================================================
// Items for Range
// =============================================================================

describe("createMaterializeCtx - getItemsForRange", () => {
  it("should return items from refs when no data manager", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
      { id: 3, name: "Item 3" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getItemsForRange({ start: 1, end: 2 });

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(1);
    expect(items[1]?.id).toBe(2);
  });

  it("should return items from data manager when available", () => {
    const refs = createTestRefs();
    const mockItems = [
      { id: 0, name: "DM Item 0" },
      { id: 1, name: "DM Item 1" },
      { id: 2, name: "DM Item 2" },
    ];
    refs.dm = {
      getItem: (i: number) => mockItems[i],
    } as any;

    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getItemsForRange({ start: 0, end: 1 });

    expect(items).toHaveLength(2);
    expect(items[0]?.name).toBe("DM Item 0");
    expect(items[1]?.name).toBe("DM Item 1");
  });

  it("should skip undefined items", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      undefined as any,
      { id: 2, name: "Item 2" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getItemsForRange({ start: 0, end: 2 });

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(0);
    expect(items[1]?.id).toBe(2);
  });

  it("should handle empty range", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getItemsForRange({ start: 0, end: -1 });

    expect(items).toHaveLength(0);
  });
});

// =============================================================================
// All Loaded Items
// =============================================================================

describe("createMaterializeCtx - getAllLoadedItems", () => {
  it("should return all items from refs when no data manager", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getAllLoadedItems();

    expect(items).toHaveLength(3);
    expect(items[0]?.id).toBe(0);
    expect(items[2]?.id).toBe(2);
  });

  it("should return a copy of the array", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getAllLoadedItems();
    items.push({ id: 999, name: "Modified" });

    expect(refs.it).toHaveLength(2);
  });

  it("should return items from data manager when available", () => {
    const refs = createTestRefs();
    const mockItems = [
      { id: 0, name: "DM Item 0" },
      { id: 1, name: "DM Item 1" },
      undefined as any,
      { id: 3, name: "DM Item 3" },
    ];
    refs.dm = {
      getItem: (i: number) => mockItems[i],
      getTotal: () => 4,
    } as any;

    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const items = ctx.getAllLoadedItems();

    expect(items).toHaveLength(3);
    expect(items[0]?.id).toBe(0);
    expect(items[1]?.id).toBe(1);
    expect(items[2]?.id).toBe(3);
  });
});

// =============================================================================
// Virtual Total
// =============================================================================

describe("createMaterializeCtx - getVirtualTotal", () => {
  it("should call virtual total function", () => {
    const refs = createTestRefs();
    refs.vtf = () => 100;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.getVirtualTotal()).toBe(100);
  });

  it("should update when function changes", () => {
    const refs = createTestRefs();
    refs.vtf = () => 50;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.getVirtualTotal()).toBe(50);

    refs.vtf = () => 200;
    expect(ctx.getVirtualTotal()).toBe(200);
  });
});

// =============================================================================
// Compression Context
// =============================================================================

describe("createMaterializeCtx - Compression", () => {
  it("should return cached compression state", () => {
    const refs = createTestRefs();
    refs.hc = createSizeCache(50, 10);
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const compression = ctx.getCachedCompression();

    expect(compression.isCompressed).toBe(false);
    expect(compression.actualSize).toBe(500);
    expect(compression.virtualSize).toBe(500);
    expect(compression.ratio).toBe(1);
  });

  it("should return compression context", () => {
    const refs = createTestRefs();
    refs.ls = 1000;
    refs.vtf = () => 100;
    refs.ch = 600;
    const deps = createTestDeps();
    deps.renderRange = { start: 10, end: 20 };
    const ctx = createMaterializeCtx(refs, deps);

    const compressionCtx = ctx.getCompressionContext();

    expect(compressionCtx.scrollPosition).toBe(1000);
    expect(compressionCtx.totalItems).toBe(100);
    expect(compressionCtx.containerSize).toBe(600);
    expect(compressionCtx.rangeStart).toBe(10);
  });
});

// =============================================================================
// Render Methods
// =============================================================================

describe("createMaterializeCtx - Render", () => {
  it("should call renderIfNeeded", () => {
    const refs = createTestRefs();
    let renderCalled = false;
    refs.rfn = () => {
      renderCalled = true;
    };
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.renderIfNeeded();

    expect(renderCalled).toBe(true);
  });

  it("should call forceRender", () => {
    const refs = createTestRefs();
    let forceCalled = false;
    refs.ffn = () => {
      forceCalled = true;
    };
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.forceRender();

    expect(forceCalled).toBe(true);
  });

  it("should return render functions", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const fns = ctx.getRenderFns();

    expect(fns.renderIfNeeded).toBe(refs.rfn);
    expect(fns.forceRender).toBe(refs.ffn);
  });

  it("should set new render functions", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const newRenderFn = () => {};
    const newForceFn = () => {};

    ctx.setRenderFns(newRenderFn, newForceFn);

    expect(refs.rfn).toBe(newRenderFn);
    expect(refs.ffn).toBe(newForceFn);
  });
});

// =============================================================================
// Invalidate Rendered
// =============================================================================

describe("createMaterializeCtx - invalidateRendered", () => {
  it("should clear all rendered elements", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    deps.dom.content.appendChild(el1);
    deps.dom.content.appendChild(el2);
    deps.rendered.set(0, el1);
    deps.rendered.set(1, el2);

    ctx.invalidateRendered();

    expect(deps.rendered.size).toBe(0);
    expect(deps.dom.content.children.length).toBe(0);
  });

  it("should release elements back to pool", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const el = deps.pool.acquire();
    el.textContent = "test";
    deps.dom.content.appendChild(el);
    deps.rendered.set(0, el);

    ctx.invalidateRendered();

    const recycled = deps.pool.acquire();
    expect(recycled).toBe(el);
    expect(recycled.textContent).toBe("");
  });
});

// =============================================================================
// Size Cache Methods
// =============================================================================

describe("createMaterializeCtx - Size Cache", () => {
  it("should set virtual total function", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const fn = () => 500;
    ctx.setVirtualTotalFn(fn);

    expect(refs.vtf).toBe(fn);
    expect(refs.vtf()).toBe(500);
  });

  it("should rebuild size cache", () => {
    const refs = createTestRefs();
    refs.hc = createSizeCache(50, 5);
    refs.vtf = () => 10;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.rebuildSizeCache();

    expect(refs.hc.getTotalSize()).toBe(500);
  });

  it("should rebuild size cache with explicit total", () => {
    const refs = createTestRefs();
    refs.hc = createSizeCache(50, 5);
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.rebuildSizeCache(20);

    expect(refs.hc.getTotalSize()).toBe(1000);
  });

  it("should replace size config", () => {
    const refs = createTestRefs();
    refs.hc = createSizeCache(50, 10);
    refs.vtf = () => 10;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.setSizeConfig(100);

    expect(refs.hc.getTotalSize()).toBe(1000);
  });

  it("should support dynamic size function", () => {
    const refs = createTestRefs();
    refs.vtf = () => 5;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.setSizeConfig((i) => i * 10 + 50);

    expect(refs.hc.getSize(0)).toBe(50);
    expect(refs.hc.getSize(1)).toBe(60);
    expect(refs.hc.getSize(2)).toBe(70);
  });
});

// =============================================================================
// Content Size
// =============================================================================

describe("createMaterializeCtx - Content Size", () => {
  it("should update content height in vertical mode", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    deps.isHorizontal = false;
    const ctx = createMaterializeCtx(refs, deps);

    ctx.updateContentSize(2000);

    expect(deps.dom.content.style.height).toBe("2000px");
  });

  it("should update content width in horizontal mode", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    deps.isHorizontal = true;
    const ctx = createMaterializeCtx(refs, deps);

    ctx.updateContentSize(3000);

    expect(deps.dom.content.style.width).toBe("3000px");
  });

  it("should handle zero size", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.updateContentSize(0);

    expect(deps.dom.content.style.height).toBe("0px");
  });
});

// =============================================================================
// Scroll Target
// =============================================================================

describe("createMaterializeCtx - Scroll Target", () => {
  it("should get scroll target", () => {
    const refs = createTestRefs();
    refs.st = window as any;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    expect(ctx.getScrollTarget()).toBe(window);
  });

  it("should set new scroll target", () => {
    const refs = createTestRefs();
    refs.st = window as any;
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const newTarget = document.createElement("div");
    ctx.setScrollTarget(newTarget);

    expect(refs.st).toBe(newTarget);
  });
});

// =============================================================================
// Container Dimensions
// =============================================================================

describe("createMaterializeCtx - Container Dimensions", () => {
  it("should set container dimension getters", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    const getter = {
      width: () => 1024,
      height: () => 768,
    };

    ctx.setContainerDimensions(getter);

    expect(refs.gcw).toBe(getter.width);
    expect(refs.gch).toBe(getter.height);
    expect(refs.cw).toBe(1024);
    expect(refs.ch).toBe(768);
  });

  it("should update shared state container size", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);

    ctx.setContainerDimensions({
      width: () => 800,
      height: () => 600,
    });

    expect(deps.sharedState.viewportState.containerSize).toBe(600);
  });
});

// =============================================================================
// Viewport Resize
// =============================================================================

describe("createMaterializeCtx - Viewport Resize", () => {
  it("should disable viewport resize observer", () => {
    const refs = createTestRefs();
    refs.vre = true;
    const deps = createTestDeps();
    let unobserved = false;
    deps.resizeObserver = {
      observe: () => {},
      unobserve: () => {
        unobserved = true;
      },
      disconnect: () => {},
    } as any;
    const ctx = createMaterializeCtx(refs, deps);

    ctx.disableViewportResize();

    expect(refs.vre).toBe(false);
    expect(unobserved).toBe(true);
  });

  it("should not unobserve if already disabled", () => {
    const refs = createTestRefs();
    refs.vre = false;
    const deps = createTestDeps();
    let unobserved = false;
    deps.resizeObserver = {
      observe: () => {},
      unobserve: () => {
        unobserved = true;
      },
      disconnect: () => {},
    } as any;
    const ctx = createMaterializeCtx(refs, deps);

    ctx.disableViewportResize();

    expect(unobserved).toBe(false);
  });
});

// =============================================================================
// createDefaultDataProxy - Tests
// =============================================================================

describe("createDefaultDataProxy", () => {
  it("should create a data proxy with all methods", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    expect(proxy.getState).toBeInstanceOf(Function);
    expect(proxy.getTotal).toBeInstanceOf(Function);
    expect(proxy.getItem).toBeInstanceOf(Function);
    expect(proxy.setItems).toBeInstanceOf(Function);
    expect(proxy.updateItem).toBeInstanceOf(Function);
    expect(proxy.removeItem).toBeInstanceOf(Function);
  });

  it("should return correct state", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    const state = proxy.getState();

    expect(state.total).toBe(2);
    expect(state.cached).toBe(2);
    expect(state.isLoading).toBe(false);
    expect(state.hasMore).toBe(false);
  });

  it("should get item by index", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    expect(proxy.getItem(0)?.name).toBe("Item 0");
    expect(proxy.getItem(1)?.name).toBe("Item 1");
  });

  it("should check if item is loaded", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      undefined as any,
      { id: 2, name: "Item 2" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    expect(proxy.isItemLoaded(0)).toBe(true);
    expect(proxy.isItemLoaded(1)).toBe(false);
    expect(proxy.isItemLoaded(2)).toBe(true);
    expect(proxy.isItemLoaded(5)).toBe(false);
  });

  it("should get items in range", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
      { id: 3, name: "Item 3" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    const items = proxy.getItemsInRange(1, 2);

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(1);
    expect(items[1]?.id).toBe(2);
  });

  it("should set items with offset", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    proxy.setItems(
      [
        { id: 2, name: "Item 2" },
        { id: 3, name: "Item 3" },
      ],
      2,
    );

    expect(refs.it.length).toBe(4);
    expect(refs.it[2]?.id).toBe(2);
    expect(refs.it[3]?.id).toBe(3);
  });

  it("should replace all items when offset is 0", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Old 0" },
      { id: 1, name: "Old 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    const newItems = [
      { id: 10, name: "New 0" },
      { id: 11, name: "New 1" },
    ];
    proxy.setItems(newItems, 0, 2);

    expect(refs.it).toBe(newItems);
    expect(refs.it.length).toBe(2);
    expect(refs.it[0]?.id).toBe(10);
  });

  it("should update item by index", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    const success = proxy.updateItem(1, { name: "Updated Item 1" });

    expect(success).toBe(true);
    expect(refs.it[1]?.name).toBe("Updated Item 1");
    expect(refs.it[1]?.id).toBe(1);
  });

  it("should return false when updating non-existent item", () => {
    const refs = createTestRefs();
    refs.it = [{ id: 0, name: "Item 0" }];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    const success = proxy.updateItem(5, { name: "New Name" });

    expect(success).toBe(false);
  });

  it("should remove item by index", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    const success = proxy.removeItem(1);

    expect(success).toBe(true);
    expect(refs.it.length).toBe(2);
    expect(refs.it[1]?.id).toBe(2);
  });

  it("should clear all items", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    proxy.clear();

    expect(refs.it.length).toBe(0);
  });

  it("should reset items when initialized", () => {
    const refs = createTestRefs();
    refs.it = [
      { id: 0, name: "Item 0" },
      { id: 1, name: "Item 1" },
    ];
    refs.ii = true;
    refs.hc = createSizeCache(50, 2);
    let forceRenderCalled = false;
    refs.ffn = () => {
      forceRenderCalled = true;
    };
    const deps = createTestDeps();
    const ctx = createMaterializeCtx(refs, deps);
    const proxy = createDefaultDataProxy(refs, deps, ctx);

    proxy.reset();

    expect(refs.it.length).toBe(0);
    expect(forceRenderCalled).toBe(true);
  });
});

// =============================================================================
// createDefaultScrollProxy - Tests
// =============================================================================

describe("createDefaultScrollProxy", () => {
  it("should create a scroll proxy with all methods", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.getScrollTop).toBeInstanceOf(Function);
    expect(proxy.scrollTo).toBeInstanceOf(Function);
    expect(proxy.scrollBy).toBeInstanceOf(Function);
    expect(proxy.isAtTop).toBeInstanceOf(Function);
    expect(proxy.isAtBottom).toBeInstanceOf(Function);
    expect(proxy.getScrollPercentage).toBeInstanceOf(Function);
  });

  it("should get scroll top position", () => {
    const refs = createTestRefs();
    refs.sgt = () => 500;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.getScrollTop()).toBe(500);
  });

  it("should scroll to position", () => {
    const refs = createTestRefs();
    let scrolledTo = -1;
    refs.sst = (pos: number) => {
      scrolledTo = pos;
    };
    let renderCalled = false;
    refs.rfn = () => {
      renderCalled = true;
    };
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    proxy.scrollTo(1000);

    expect(scrolledTo).toBe(1000);
    expect(refs.ls).toBe(1000);
    expect(renderCalled).toBe(true);
  });

  it("should scroll by delta", () => {
    const refs = createTestRefs();
    refs.sgt = () => 500;
    let scrolledTo = -1;
    refs.sst = (pos: number) => {
      scrolledTo = pos;
    };
    let renderCalled = false;
    refs.rfn = () => {
      renderCalled = true;
    };
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    proxy.scrollBy(200);

    expect(scrolledTo).toBe(700);
    expect(refs.ls).toBe(700);
    expect(renderCalled).toBe(true);
  });

  it("should check if at top", () => {
    const refs = createTestRefs();
    refs.ls = 0;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.isAtTop()).toBe(true);
  });

  it("should check if not at top", () => {
    const refs = createTestRefs();
    refs.ls = 100;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.isAtTop()).toBe(false);
  });

  it("should check if at bottom", () => {
    const refs = createTestRefs();
    refs.sab = (threshold: number) => threshold === 5;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.isAtBottom(5)).toBe(true);
    expect(proxy.isAtBottom(10)).toBe(false);
  });

  it("should calculate scroll percentage", () => {
    const refs = createTestRefs();
    refs.hc = createSizeCache(100, 50); // 5000px total
    refs.ch = 500;
    refs.ls = 2250; // Halfway through scrollable area
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.getScrollPercentage()).toBe(0.5);
  });

  it("should return 0 percentage when no scroll possible", () => {
    const refs = createTestRefs();
    refs.hc = createSizeCache(50, 5);
    refs.ch = 1000; // Larger than content
    refs.ls = 0;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.getScrollPercentage()).toBe(0);
  });

  it("should get velocity", () => {
    const refs = createTestRefs();
    refs.vt = { velocity: 50, sampleCount: 3 };
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.getVelocity()).toBe(50);
  });

  it("should check if tracking", () => {
    const refs = createTestRefs();
    refs.vt = { velocity: 0, sampleCount: 3 };
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.isTracking()).toBe(true);
  });

  it("should check if not tracking", () => {
    const refs = createTestRefs();
    refs.vt = { velocity: 0, sampleCount: 1 };
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.isTracking()).toBe(false);
  });

  it("should check if scrolling", () => {
    const refs = createTestRefs();
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    deps.dom.root.classList.add("vlist--scrolling");
    expect(proxy.isScrolling()).toBe(true);

    deps.dom.root.classList.remove("vlist--scrolling");
    expect(proxy.isScrolling()).toBe(false);
  });

  it("should enable compression", () => {
    const refs = createTestRefs();
    refs.sic = false;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    proxy.enableCompression();

    expect(refs.sic).toBe(true);
  });

  it("should disable compression", () => {
    const refs = createTestRefs();
    refs.sic = true;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    proxy.disableCompression();

    expect(refs.sic).toBe(false);
  });

  it("should check if compressed", () => {
    const refs = createTestRefs();
    refs.sic = true;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    expect(proxy.isCompressed()).toBe(true);
  });

  it("should update container height", () => {
    const refs = createTestRefs();
    refs.ch = 500;
    const deps = createTestDeps();
    const proxy = createDefaultScrollProxy(refs, deps);

    proxy.updateContainerHeight(800);

    expect(refs.ch).toBe(800);
  });
});
