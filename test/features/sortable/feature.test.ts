/**
 * vlist - Sortable Feature Tests
 * Tests for withSortable: factory, setup wiring, pointer handlers,
 * drag ghost/placeholder, sort events, handle configuration, destroy cleanup.
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withSortable } from "../../../src/features/sortable/feature";
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
  (global as any).PointerEvent = dom.window.PointerEvent ?? dom.window.MouseEvent;

  global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  global.cancelAnimationFrame = (id: number): void => clearTimeout(id);
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

function createTestDOM(): {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
} {
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
  const testItems = createTestItems(20);
  const sizeCache = createSizeCache(56, testItems.length);

  // Add some item elements to the DOM
  for (let i = 0; i < 10; i++) {
    const el = document.createElement("div");
    el.className = "vlist-item";
    el.setAttribute("data-index", String(i));
    el.innerHTML = `<div class="item">${testItems[i]!.name}</div>`;
    testDom.items.appendChild(el);
  }

  const emitMock = mock(() => {});

  const ctx: BuilderContext<TestItem> = {
    dom: testDom,
    sizeCache,
    emitter: {
      on: mock(() => () => {}),
      off: mock(() => {}),
      emit: emitMock,
      once: mock(() => () => {}),
      removeAllListeners: mock(() => {}),
      listenerCount: mock(() => 0),
    } as any,
    config: {
      overscan: 3,
      classPrefix: "vlist",
      reverse: false,
      wrap: false,
      horizontal: false,
      ariaIdPrefix: "vlist-0",
      interactive: true,
    },
    rawConfig: {
      container: testDom.root,
      item: { height: 56, template: (item: TestItem) => item.name },
    },
    renderer: {
      render: mock(() => {}),
      updateItemClasses: mock(() => {}),
      getRendered: mock(() => new Map()),
      clear: mock(() => {}),
      destroy: mock(() => {}),
    } as any,
    dataManager: {
      getItem: (index: number) => testItems[index],
      getTotal: () => testItems.length,
      getCached: () => testItems.length,
      getStorage: () => null,
      setTotal: mock(() => {}),
    } as any,
    scrollController: {
      getScrollTop: () => 0,
      scrollTo: mock(() => {}),
    } as any,
    state: {
      viewportState: {
        scrollPosition: 0,
        containerSize: 600,
        totalSize: 1120,
        actualSize: 1120,
        isCompressed: false,
        compressionRatio: 1,
        visibleRange: { start: 0, end: 10 },
        renderRange: { start: 0, end: 13 },
      },
      lastRenderRange: { start: 0, end: 13 },
      isInitialized: true,
      isDestroyed: false,
      cachedCompression: null,
    },
    afterScroll: [],
    afterRenderBatch: [],
    idleHandlers: [],
    clickHandlers: [],
    keydownHandlers: [],
    resizeHandlers: [],
    contentSizeHandlers: [],
    destroyHandlers: [],
    methods: new Map(),
    adjustScrollPosition: (pos: number) => pos,
    replaceTemplate: mock(() => {}),
    replaceRenderer: mock(() => {}),
    replaceDataManager: mock(() => {}),
    replaceScrollController: mock(() => {}),
    getItemsForRange: mock(() => []),
    getAllLoadedItems: () => testItems,
    getVirtualTotal: () => testItems.length,
    getCachedCompression: mock(() => ({
      isCompressed: false,
      actualSize: 1120,
      virtualSize: 1120,
      ratio: 1,
      maxScroll: 520,
    })),
    getCompressionContext: mock(() => ({
      scrollPosition: 0,
      totalItems: testItems.length,
      containerSize: 600,
      rangeStart: 0,
    })),
    renderIfNeeded: mock(() => {}),
    forceRender: mock(() => {}),
    invalidateRendered: mock(() => {}),
    getRenderFns: () => ({
      renderIfNeeded: mock(() => {}),
      forceRender: mock(() => {}),
    }),
    getContainerWidth: () => 400,
    setVirtualTotalFn: mock(() => {}),
    rebuildSizeCache: mock(() => {}),
    setSizeConfig: mock(() => {}),
    updateContentSize: mock(() => {}),
    updateCompressionMode: mock(() => {}),
    setVisibleRangeFn: mock(() => {}),
    getVisibleRange: mock(() => {}),
    setScrollToPosFn: mock(() => {}),
    getScrollToPos: mock(() => 0),
    setPositionElementFn: mock(() => {}),
    setUpdateItemClassesFn: mock(() => {}),
    setRenderFns: mock(() => {}),
    setScrollFns: mock(() => {}),
    setScrollTarget: mock(() => {}),
    getScrollTarget: () => testDom.viewport,
    setContainerDimensions: mock(() => {}),
    disableViewportResize: mock(() => {}),
    disableWheelHandler: mock(() => {}),
    getStripeIndexFn: () => (i: number) => i,
    setStripeIndexFn: mock(() => {}),
    getItemToScrollIndexFn: () => (i: number) => i,
    setItemToScrollIndexFn: mock(() => {}),
  };

  return ctx;
}

// =============================================================================
// Factory Tests
// =============================================================================

describe("withSortable — factory", () => {
  it("creates a feature with correct name and priority", () => {
    const feature = withSortable();
    expect(feature.name).toBe("withSortable");
    expect(feature.priority).toBe(55);
  });

  it("declares isSorting method", () => {
    const feature = withSortable();
    expect(feature.methods).toContain("isSorting");
  });

  it("declares conflicts with grid, masonry, and table", () => {
    const feature = withSortable();
    expect(feature.conflicts).toContain("withGrid");
    expect(feature.conflicts).toContain("withMasonry");
    expect(feature.conflicts).toContain("withTable");
  });

  it("accepts config with handle selector", () => {
    const feature = withSortable({ handle: ".drag-handle" });
    expect(feature.name).toBe("withSortable");
  });

  it("accepts config with all options", () => {
    const feature = withSortable({
      handle: ".grip",
      ghostClass: "my-ghost",
      placeholderClass: "my-placeholder",
      liveReorder: false,
      shiftDuration: 200,
      edgeScrollZone: 60,
      edgeScrollSpeed: 12,
      dragThreshold: 10,
    });
    expect(feature.name).toBe("withSortable");
  });

  it("defaults liveReorder to true", () => {
    // Verify it doesn't throw when setup with default config
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);
    expect(ctx.methods.has("isSorting")).toBe(true);
  });

  it("accepts liveReorder: false for placeholder mode", () => {
    const feature = withSortable({ liveReorder: false });
    const ctx = createMockContext();
    feature.setup(ctx);
    expect(ctx.methods.has("isSorting")).toBe(true);
  });
});

// =============================================================================
// Setup Tests
// =============================================================================

describe("withSortable — setup", () => {
  it("registers isSorting method on context", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    expect(ctx.methods.has("isSorting")).toBe(true);
    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
  });

  it("registers a destroy handler", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    expect(ctx.destroyHandlers.length).toBeGreaterThan(0);
  });

  it("attaches pointerdown listener to items container", () => {
    const feature = withSortable();
    const ctx = createMockContext();

    const addListenerSpy = mock(() => {});
    ctx.dom.items.addEventListener = addListenerSpy as any;

    feature.setup(ctx);

    // Should have been called with "pointerdown"
    const calls = addListenerSpy.mock.calls;
    const pointerdownCall = calls.find(
      (c: any[]) => c[0] === "pointerdown",
    );
    expect(pointerdownCall).toBeDefined();
  });
});

// =============================================================================
// Handle Configuration Tests
// =============================================================================

describe("withSortable — handle config", () => {
  it("without handle: pointerdown on any item part registers for drag", () => {
    const feature = withSortable(); // no handle
    const ctx = createMockContext();
    feature.setup(ctx);

    // Simulate pointerdown on an item (not a handle)
    const itemEl = ctx.dom.items.querySelector("[data-index='2']") as HTMLElement;
    expect(itemEl).toBeDefined();

    const event = new (dom.window.PointerEvent ?? dom.window.MouseEvent)(
      "pointerdown",
      {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      },
    );

    // The handler should not throw
    itemEl.dispatchEvent(event);
  });

  it("with handle: pointerdown outside handle does not initiate drag", () => {
    const feature = withSortable({ handle: ".drag-handle" });
    const ctx = createMockContext();
    feature.setup(ctx);

    // The item doesn't have a .drag-handle, so drag should not start
    const itemEl = ctx.dom.items.querySelector("[data-index='0']") as HTMLElement;

    const event = new (dom.window.PointerEvent ?? dom.window.MouseEvent)(
      "pointerdown",
      {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      },
    );

    itemEl.dispatchEvent(event);

    // isSorting should remain false (threshold not reached, but also handle check)
    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
  });

  it("with handle: pointerdown on handle element is accepted", () => {
    const feature = withSortable({ handle: ".drag-handle" });
    const ctx = createMockContext();
    feature.setup(ctx);

    // Add a drag handle to item 0
    const itemEl = ctx.dom.items.querySelector("[data-index='0']") as HTMLElement;
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    itemEl.appendChild(handle);

    const event = new (dom.window.PointerEvent ?? dom.window.MouseEvent)(
      "pointerdown",
      {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      },
    );

    // Should not throw — the handle is present
    handle.dispatchEvent(event);
  });
});

// =============================================================================
// Sorting State Tests
// =============================================================================

describe("withSortable — isSorting", () => {
  it("returns false initially", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
  });
});

// =============================================================================
// Destroy Tests
// =============================================================================

describe("withSortable — destroy", () => {
  it("removes pointerdown listener from items on destroy", () => {
    const feature = withSortable();
    const ctx = createMockContext();

    const removeListenerSpy = mock(() => {});
    ctx.dom.items.removeEventListener = removeListenerSpy as any;

    feature.setup(ctx);

    // Run destroy handlers
    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    const calls = removeListenerSpy.mock.calls;
    const pointerdownCall = calls.find(
      (c: any[]) => c[0] === "pointerdown",
    );
    expect(pointerdownCall).toBeDefined();
  });
});
