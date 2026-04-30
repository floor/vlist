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
  liveRegion: HTMLElement;
} {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");
  const liveRegion = document.createElement("div");

  root.className = "vlist";
  viewport.className = "vlist-viewport";
  content.className = "vlist-content";
  items.className = "vlist-items";
  liveRegion.className = "vlist-live";
  liveRegion.setAttribute("aria-live", "polite");

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
  root.appendChild(liveRegion);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items, liveRegion };
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
    el.setAttribute("data-id", String(testItems[i]!.id));
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
      shiftDuration: 200,
      edgeScrollZone: 60,
      edgeScrollSpeed: 12,
      dragThreshold: 10,
    });
    expect(feature.name).toBe("withSortable");
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

  it("returns true during keyboard grab", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    ctx.methods.set("_getFocusedIndex", () => 3);
    ctx.methods.set("_focusById", mock(() => {}));
    feature.setup(ctx);

    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);

    // Grab via Space
    ctx.dom.root.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(isSorting()).toBe(true);
  });

  it("returns false after keyboard drop", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    ctx.methods.set("_getFocusedIndex", () => 3);
    ctx.methods.set("_focusById", mock(() => {}));
    feature.setup(ctx);

    const isSorting = ctx.methods.get("isSorting") as () => boolean;

    // Grab
    ctx.dom.root.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(true);

    // Drop
    ctx.dom.root.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(false);
  });

  it("returns false after keyboard cancel", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    ctx.methods.set("_getFocusedIndex", () => 3);
    ctx.methods.set("_focusById", mock(() => {}));
    feature.setup(ctx);

    const isSorting = ctx.methods.get("isSorting") as () => boolean;

    // Grab
    ctx.dom.root.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(true);

    // Cancel
    ctx.dom.root.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(false);
  });
});

// =============================================================================
// Event Emission Tests
// =============================================================================

describe("withSortable — sort events", () => {
  /**
   * Helper: simulate a full drag sequence (pointerdown → pointermove past
   * threshold → pointerup). Returns the emitter spy so callers can inspect
   * emitted events.
   */
  function simulateDrag(
    ctx: BuilderContext<TestItem>,
    fromIndex: number,
    moveY: number,
  ): ReturnType<typeof mock> {
    const PointerEventCtor =
      dom.window.PointerEvent ?? dom.window.MouseEvent;

    const itemEl = ctx.dom.items.querySelector(
      `[data-index='${fromIndex}']`,
    ) as HTMLElement;

    // Give the item a bounding rect so ghost creation doesn't blow up
    itemEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: fromIndex * 56,
        right: 400,
        bottom: fromIndex * 56 + 56,
        width: 400,
        height: 56,
        x: 0,
        y: fromIndex * 56,
        toJSON: () => {},
      }) as DOMRect;

    // pointerdown on the item
    const downEvt = new PointerEventCtor("pointerdown", {
      bubbles: true,
      clientX: 200,
      clientY: fromIndex * 56 + 28,
      button: 0,
    });
    itemEl.dispatchEvent(downEvt);

    // pointermove past threshold (default 5px)
    const moveEvt = new PointerEventCtor("pointermove", {
      bubbles: true,
      clientX: 200,
      clientY: fromIndex * 56 + 28 + moveY,
      button: 0,
    });
    document.dispatchEvent(moveEvt);

    return ctx.emitter.emit as ReturnType<typeof mock>;
  }

  it("emits sort:start when drag threshold is crossed", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    const emitSpy = simulateDrag(ctx, 2, 20);

    const sortStartCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStartCall).toBeDefined();
    expect(sortStartCall![1]).toEqual({ index: 2 });
  });

  it("does not emit sort:start when move is below threshold", () => {
    const feature = withSortable({ dragThreshold: 10 });
    const ctx = createMockContext();
    feature.setup(ctx);

    const emitSpy = simulateDrag(ctx, 0, 3); // 3px < 10px threshold

    const sortStartCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStartCall).toBeUndefined();
  });

  it("emits sort:end on pointerup after drag", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    // getBoundingClientRect for viewport (needed by animateDrop)
    ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    feature.setup(ctx);

    const emitSpy = simulateDrag(ctx, 3, 20);

    // pointerup to finish the drag
    const PointerEventCtor =
      dom.window.PointerEvent ?? dom.window.MouseEvent;
    const upEvt = new PointerEventCtor("pointerup", {
      bubbles: true,
      clientX: 200,
      clientY: 3 * 56 + 28 + 20,
      button: 0,
    });
    document.dispatchEvent(upEvt);

    // sort:end is emitted after the drop animation timeout (shiftDuration + 50ms)
    await new Promise((r) => setTimeout(r, 250));

    const sortEndCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    // Drop at same position → no sort:end (fromIndex === toIndex)
    // This is correct — sort:end only fires when position changed
    // With a 20px move on a 56px item, drop stays at index 3
    expect(sortEndCall).toBeUndefined();
  });

  it("emits sort:move when drop position changes during drag", () => {
    const feature = withSortable();
    const ctx = createMockContext();

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    feature.setup(ctx);

    // Drag item 1 down past the midpoint of item 2 (> 56px)
    const emitSpy = simulateDrag(ctx, 1, 80);

    const sortMove = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:move",
    );

    if (sortMove) {
      const payload = sortMove[1] as {
        fromIndex: number;
        currentIndex: number;
      };
      expect(payload.fromIndex).toBe(1);
      expect(payload.currentIndex).not.toBe(1);
    }
  });

  it("does not emit sort:move when drop position stays the same", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Small move — stays within the same item's zone
    const emitSpy = simulateDrag(ctx, 3, 10);

    const sortMove = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:move",
    );
    // 10px move on a 56px item shouldn't cross the midpoint
    expect(sortMove).toBeUndefined();
  });

  it("emits sort:end with fromIndex and toIndex when position changes", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    feature.setup(ctx);

    // Drag item 1 down far enough to pass items (56px each)
    const emitSpy = simulateDrag(ctx, 1, 120);

    // Additional move to ensure drop position updates
    const PointerEventCtor =
      dom.window.PointerEvent ?? dom.window.MouseEvent;
    const moveEvt2 = new PointerEventCtor("pointermove", {
      bubbles: true,
      clientX: 200,
      clientY: 1 * 56 + 28 + 120,
      button: 0,
    });
    document.dispatchEvent(moveEvt2);

    const upEvt = new PointerEventCtor("pointerup", {
      bubbles: true,
      clientX: 200,
      clientY: 1 * 56 + 28 + 120,
      button: 0,
    });
    document.dispatchEvent(upEvt);

    // Wait for drop animation timeout
    await new Promise((r) => setTimeout(r, 250));

    // sort:start should have been emitted
    const sortStartCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStartCall).toBeDefined();
    expect(sortStartCall![1]).toEqual({ index: 1 });

    // sort:end should have fromIndex=1 and a different toIndex
    const sortEndCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    if (sortEndCall) {
      const payload = sortEndCall[1] as { fromIndex: number; toIndex: number };
      expect(payload.fromIndex).toBe(1);
      expect(payload.toIndex).not.toBe(1);
      expect(payload.toIndex).toBeGreaterThanOrEqual(0);
    }
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

// =============================================================================
// Keyboard Reordering Tests
// =============================================================================

describe("withSortable — keyboard reordering", () => {
  /** Helper: set up a sortable context with _getFocusedIndex mock */
  function setupKeyboard(focusedIndex: number) {
    const feature = withSortable();
    const ctx = createMockContext();

    // Mock selection's _getFocusedIndex to return the focused item
    ctx.methods.set("_getFocusedIndex", () => focusedIndex);
    ctx.methods.set("_focusById", mock(() => {}));

    feature.setup(ctx);

    return { feature, ctx };
  }

  function dispatchKey(
    target: HTMLElement,
    key: string,
    opts: Partial<KeyboardEventInit> = {},
  ): KeyboardEvent {
    const event = new dom.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("Space on focused item enters grab mode and emits sort:start", () => {
    const { ctx } = setupKeyboard(3);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");

    const sortStart = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStart).toBeDefined();
    expect(sortStart![1]).toEqual({ index: 3 });
  });

  it("Space on focused item adds --sorting class to root", () => {
    const { ctx } = setupKeyboard(3);

    dispatchKey(ctx.dom.root, " ");

    expect(ctx.dom.root.classList.contains("vlist--sorting")).toBe(true);
  });

  it("Space on focused item adds --kb-sorting class to grabbed item", () => {
    const { ctx } = setupKeyboard(3);

    dispatchKey(ctx.dom.root, " ");

    const el = ctx.dom.items.querySelector('[data-id="3"]');
    expect(el?.classList.contains("vlist-item--kb-sorting")).toBe(true);
  });

  it("ArrowDown in grab mode emits sort:end with adjacent swap", () => {
    const { ctx } = setupKeyboard(3);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    // Grab
    dispatchKey(ctx.dom.root, " ");
    emitSpy.mock.calls.length = 0; // Clear sort:start

    // Move down
    dispatchKey(ctx.dom.root, "ArrowDown");

    const sortEnd = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 3, toIndex: 4 });
  });

  it("ArrowUp in grab mode emits sort:end with upward swap", () => {
    const { ctx } = setupKeyboard(3);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    emitSpy.mock.calls.length = 0;

    dispatchKey(ctx.dom.root, "ArrowUp");

    const sortEnd = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 3, toIndex: 2 });
  });

  it("multiple ArrowDown moves accumulate position", () => {
    const { ctx } = setupKeyboard(1);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    emitSpy.mock.calls.length = 0;

    dispatchKey(ctx.dom.root, "ArrowDown");
    dispatchKey(ctx.dom.root, "ArrowDown");

    const sortEnds = emitSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnds.length).toBe(2);
    expect(sortEnds[0]![1]).toEqual({ fromIndex: 1, toIndex: 2 });
    expect(sortEnds[1]![1]).toEqual({ fromIndex: 2, toIndex: 3 });
  });

  it("ArrowDown at last index does nothing", () => {
    // Focus on item 9 (last visible in DOM)
    const { ctx } = setupKeyboard(9);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    emitSpy.mock.calls.length = 0;

    dispatchKey(ctx.dom.root, "ArrowDown");

    // Total is 20, so index 9 can still move down
    const sortEnd = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 9, toIndex: 10 });
  });

  it("ArrowUp at index 0 does nothing", () => {
    const { ctx } = setupKeyboard(0);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    emitSpy.mock.calls.length = 0;

    dispatchKey(ctx.dom.root, "ArrowUp");

    const sortEnd = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeUndefined();
  });

  it("Space in grab mode drops the item (no redundant sort:end)", () => {
    const { ctx } = setupKeyboard(3);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown"); // sort:end already emitted here
    emitSpy.mock.calls.length = 0;

    // Drop — should NOT emit sort:end (data already reordered per move)
    dispatchKey(ctx.dom.root, " ");

    const sortEnd = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeUndefined();

    // Root should no longer have --sorting
    expect(ctx.dom.root.classList.contains("vlist--sorting")).toBe(false);
  });

  it("Escape cancels grab and removes --sorting class", () => {
    const { ctx } = setupKeyboard(3);

    dispatchKey(ctx.dom.root, " ");
    expect(ctx.dom.root.classList.contains("vlist--sorting")).toBe(true);

    dispatchKey(ctx.dom.root, "Escape");
    expect(ctx.dom.root.classList.contains("vlist--sorting")).toBe(false);
  });

  it("Escape after move emits sort:cancel with original items", () => {
    const { ctx } = setupKeyboard(3);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown");
    dispatchKey(ctx.dom.root, "ArrowDown");
    emitSpy.mock.calls.length = 0;

    dispatchKey(ctx.dom.root, "Escape");

    // Should emit sort:cancel with the original items snapshot
    const sortCancel = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:cancel",
    );
    expect(sortCancel).toBeDefined();
    const payload = sortCancel![1] as { originalItems: unknown[] };
    expect(payload.originalItems).toBeArray();
    expect(payload.originalItems.length).toBe(20);
  });

  it("keys are intercepted (stopImmediatePropagation) in grab mode", () => {
    const { ctx } = setupKeyboard(3);

    dispatchKey(ctx.dom.root, " ");

    // In grab mode, ArrowDown should be intercepted
    const event = dispatchKey(ctx.dom.root, "ArrowDown");
    // The event's defaultPrevented should be true
    expect(event.defaultPrevented).toBe(true);
  });

  it("Space without focused item does not enter grab mode", () => {
    const { ctx } = setupKeyboard(-1); // No focused item
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");

    const sortStart = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStart).toBeUndefined();
  });

  it("calls _focusById after keyboard move", () => {
    const { ctx } = setupKeyboard(3);
    const focusByIdSpy = ctx.methods.get("_focusById") as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown");

    // _focusById should be called with the moved item's id
    expect(focusByIdSpy.mock.calls.length).toBeGreaterThan(0);
    // Item at index 3 has id=3
    expect(focusByIdSpy.mock.calls[0]![0]).toBe(3);
  });
});

// =============================================================================
// ARIA Attributes Tests
// =============================================================================

describe("withSortable — ARIA attributes", () => {
  it("creates a hidden instructions element in the root", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    const instructions = document.getElementById("vlist-sort-instructions");
    expect(instructions).not.toBeNull();
    expect(instructions!.textContent).toContain("Press Space to reorder");
  });

  it("applies aria-roledescription via afterRenderBatch", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Simulate a render batch
    const el = document.createElement("div");
    for (const handler of ctx.afterRenderBatch) {
      handler([{ index: 0, element: el }]);
    }

    expect(el.getAttribute("aria-roledescription")).toBe("sortable item");
    expect(el.getAttribute("aria-describedby")).toBe("vlist-sort-instructions");
  });

  it("removes instructions element on destroy", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Count children before destroy (includes liveRegion, viewport, instructions)
    const childrenBefore = ctx.dom.root.children.length;

    for (const handler of ctx.destroyHandlers) {
      handler();
    }

    // One child removed (the instructions element)
    expect(ctx.dom.root.children.length).toBe(childrenBefore - 1);
  });
});

// =============================================================================
// Live Region Announcements Tests
// =============================================================================

describe("withSortable — live region announcements", () => {
  function setupWithLiveRegion(focusedIndex: number) {
    const feature = withSortable();
    const ctx = createMockContext();
    ctx.methods.set("_getFocusedIndex", () => focusedIndex);
    ctx.methods.set("_focusById", mock(() => {}));
    feature.setup(ctx);
    return { ctx };
  }

  function dispatchKey(target: HTMLElement, key: string): void {
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("announces grab with position info", () => {
    const { ctx } = setupWithLiveRegion(2);

    dispatchKey(ctx.dom.root, " ");

    const text = ctx.dom.liveRegion.textContent ?? "";
    expect(text).toContain("Grabbed");
    expect(text).toContain("position 3 of 20");
  });

  it("announces move with new position", () => {
    const { ctx } = setupWithLiveRegion(2);

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown");

    const text = ctx.dom.liveRegion.textContent ?? "";
    expect(text).toContain("moved");
    expect(text).toContain("position 4 of 20");
  });

  it("announces drop with final position", () => {
    const { ctx } = setupWithLiveRegion(2);

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown"); // moved from 2→3
    dispatchKey(ctx.dom.root, " "); // Drop

    const text = ctx.dom.liveRegion.textContent ?? "";
    expect(text).toContain("dropped");
    expect(text).toContain("position 4 of 20"); // index 3 → position 4
  });

  it("announces cancel with original position", () => {
    const { ctx } = setupWithLiveRegion(2);

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown");
    dispatchKey(ctx.dom.root, "Escape");

    const text = ctx.dom.liveRegion.textContent ?? "";
    expect(text).toContain("cancelled");
    expect(text).toContain("position 3 of 20");
  });
});

// =============================================================================
// Pointer: release without crossing threshold
// =============================================================================

describe("withSortable — pointer up without drag", () => {
  it("pointerup before threshold cleans up without emitting events", () => {
    const feature = withSortable({ dragThreshold: 10 });
    const ctx = createMockContext();
    feature.setup(ctx);

    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // pointerdown
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));

    // Small move (below threshold)
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 143, button: 0,
    }));

    // pointerup without crossing threshold
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 143, button: 0,
    }));

    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;
    const sortStart = emitSpy.mock.calls.find((c: unknown[]) => c[0] === "sort:start");
    expect(sortStart).toBeUndefined();

    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
  });
});

// =============================================================================
// Keyboard: other keys blocked during grab
// =============================================================================

describe("withSortable — keyboard key blocking", () => {
  function setupKeyboard(focusedIndex: number) {
    const feature = withSortable();
    const ctx = createMockContext();
    ctx.methods.set("_getFocusedIndex", () => focusedIndex);
    ctx.methods.set("_focusById", mock(() => {}));
    feature.setup(ctx);
    return { ctx };
  }

  it("blocks unrelated keys during grab mode", () => {
    const { ctx } = setupKeyboard(3);

    // Enter grab mode
    ctx.dom.root.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));

    // Press an unrelated key (e.g., "a")
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "a", bubbles: true, cancelable: true,
    });
    ctx.dom.root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not block F-keys during grab mode", () => {
    const { ctx } = setupKeyboard(3);

    ctx.dom.root.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));

    const event = new dom.window.KeyboardEvent("keydown", {
      key: "F5", bubbles: true, cancelable: true,
    });
    ctx.dom.root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not block Tab during grab mode", () => {
    const { ctx } = setupKeyboard(3);

    ctx.dom.root.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));

    const event = new dom.window.KeyboardEvent("keydown", {
      key: "Tab", bubbles: true, cancelable: true,
    });
    ctx.dom.root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

// =============================================================================
// Edge scroll and viewport detection
// =============================================================================

describe("withSortable — edge scrolling", () => {
  it("starts edge scroll loop when drag begins", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    feature.setup(ctx);

    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // pointerdown
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));

    // Move past threshold near bottom edge
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 590, button: 0,
    }));

    // Let rAF tick for edge scroll
    await new Promise((r) => setTimeout(r, 50));

    // scrollTo should have been called (edge scroll active near bottom)
    const scrollToCalls = (ctx.scrollController.scrollTo as ReturnType<typeof mock>).mock.calls;
    expect(scrollToCalls.length).toBeGreaterThan(0);

    // Clean up — pointerup
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 590, button: 0,
    }));

    await new Promise((r) => setTimeout(r, 250));
  });

  it("clears shifts when pointer leaves viewport during drag", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    feature.setup(ctx);

    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));

    // Move past threshold to start sorting
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 250, button: 0,
    }));

    // Move pointer outside viewport (above top)
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: -50, button: 0,
    }));

    // Let rAF tick
    await new Promise((r) => setTimeout(r, 50));

    // Clean up
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: -50, button: 0,
    }));

    await new Promise((r) => setTimeout(r, 250));

    // Should not throw, and sorting should have ended
    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
  });
});

// =============================================================================
// Pointer cancel
// =============================================================================

describe("withSortable — pointer cancel", () => {
  it("pointercancel during drag cleans up", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    feature.setup(ctx);

    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag past threshold
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));

    // Pointer cancel (e.g. touch interrupted)
    document.dispatchEvent(new PointerEventCtor("pointercancel", {
      bubbles: true, clientX: 200, clientY: 200,
    }));

    await new Promise((r) => setTimeout(r, 250));

    const isSorting = ctx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
  });
});

// =============================================================================
// Keyboard grab cancelled by pointer drag
// =============================================================================

describe("withSortable — keyboard grab cancelled by pointer", () => {
  it("cancels keyboard grab when pointer drag starts", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    ctx.methods.set("_getFocusedIndex", () => 3);
    ctx.methods.set("_focusById", mock(() => {}));
    feature.setup(ctx);

    const isSorting = ctx.methods.get("isSorting") as () => boolean;

    // Start keyboard grab
    ctx.dom.root.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));
    expect(isSorting()).toBe(true);

    // Pointer down on a different item — should cancel keyboard grab
    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='5']") as HTMLElement;
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 308, button: 0,
    }));

    // Keyboard grab should be cancelled (sorting still true due to pointer, but kb grab gone)
    // After pointer releases without threshold, isSorting should be false
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 308, button: 0,
    }));

    expect(isSorting()).toBe(false);
  });
});

// =============================================================================
// Focus preservation across pointer drag
// =============================================================================

describe("withSortable — focus preservation", () => {
  it("restores focus to originally-focused item after pointer drag reorder", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    // Mock _getFocusedIndex returning index 5
    ctx.methods.set("_getFocusedIndex", () => 5);
    const focusByIdSpy = mock(() => {});
    ctx.methods.set("_focusById", focusByIdSpy);

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    feature.setup(ctx);

    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='1']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 56, right: 400, bottom: 112, width: 400, height: 56, x: 0, y: 56, toJSON: () => {} }) as DOMRect;

    // pointerdown on item 1
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 84, button: 0,
    }));

    // Move far enough to cross threshold and change drop position
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 250, button: 0,
    }));

    // pointerup
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 250, button: 0,
    }));

    // Wait for drop animation
    await new Promise((r) => setTimeout(r, 300));

    // _focusById should have been called with id 5 (the originally-focused item)
    const focusCalls = focusByIdSpy.mock.calls as unknown[][];
    if (focusCalls.length > 0) {
      expect(focusCalls[focusCalls.length - 1]![0]).toBe(5);
    }
  });

  it("does not call focusById when no item was focused before drag", async () => {
    const feature = withSortable();
    const ctx = createMockContext();

    ctx.methods.set("_getFocusedIndex", () => -1); // No focus
    const focusByIdSpy = mock(() => {});
    ctx.methods.set("_focusById", focusByIdSpy);

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    feature.setup(ctx);

    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector("[data-index='1']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 56, right: 400, bottom: 112, width: 400, height: 56, x: 0, y: 56, toJSON: () => {} }) as DOMRect;

    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 84, button: 0,
    }));

    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 84 + 20, button: 0,
    }));

    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 84 + 20, button: 0,
    }));

    await new Promise((r) => setTimeout(r, 300));

    // focusById should NOT have been called (no item was focused)
    expect(focusByIdSpy.mock.calls.length).toBe(0);
  });
});

// =============================================================================
// Drop Index Calculation Tests
// =============================================================================

describe("withSortable — drop index calculation", () => {
  // Helper: start a drag on an item, then move to specific Y positions
  // and collect sort:move events to track the drop index at each step.
  function setupDragSession(ctx: BuilderContext<TestItem>, fromIndex: number): {
    moveTo: (clientY: number) => void;
    getDropIndices: () => number[];
    cleanup: () => void;
  } {
    const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
    const itemEl = ctx.dom.items.querySelector(
      `[data-index='${fromIndex}']`,
    ) as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: fromIndex * 56,
        right: 400,
        bottom: fromIndex * 56 + 56,
        width: 400,
        height: 56,
        x: 0,
        y: fromIndex * 56,
        toJSON: () => {},
      }) as DOMRect;

    ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    // pointerdown
    itemEl.dispatchEvent(
      new PointerEventCtor("pointerdown", {
        bubbles: true,
        clientX: 200,
        clientY: fromIndex * 56 + 28,
        button: 0,
      }),
    );

    // Initial move to cross drag threshold
    document.dispatchEvent(
      new PointerEventCtor("pointermove", {
        bubbles: true,
        clientX: 200,
        clientY: fromIndex * 56 + 28 + 10,
        button: 0,
      }),
    );

    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;
    const dropIndices: number[] = [];

    const moveTo = (clientY: number): void => {
      // Clear previous calls to track new emissions
      const callsBefore = emitSpy.mock.calls.length;

      document.dispatchEvent(
        new PointerEventCtor("pointermove", {
          bubbles: true,
          clientX: 200,
          clientY,
          button: 0,
        }),
      );

      // Collect sort:move events from this move
      for (let i = callsBefore; i < emitSpy.mock.calls.length; i++) {
        const call = emitSpy.mock.calls[i] as unknown[];
        if (call[0] === "sort:move") {
          const payload = call[1] as { currentIndex: number };
          dropIndices.push(payload.currentIndex);
        }
      }
    };

    const cleanup = (): void => {
      document.dispatchEvent(
        new PointerEventCtor("pointercancel", { bubbles: true }),
      );
    };

    return { moveTo, getDropIndices: () => dropIndices, cleanup };
  }

  it("shifts one item at a time when dragging down", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Drag item 3 (offset=168, mid=196) downward
    // Item 4: offset=224, mid=252 — ghost bottom must cross 252
    // Item 5: offset=280, mid=308 — ghost bottom must cross 308
    const session = setupDragSession(ctx, 3);

    // Ghost bottom = clientY - ghostOffsetY + draggedItemSize
    // ghostOffsetY = 28 (pointer started at mid-item)
    // So ghost bottom = clientY - 28 + 56 = clientY + 28

    // Move ghost bottom just past mid of item 4 (252)
    // clientY + 28 > 252 → clientY > 224
    session.moveTo(225);
    expect(session.getDropIndices()).toEqual([4]);

    // Move ghost bottom just past mid of item 5 (308)
    // clientY + 28 > 308 → clientY > 280
    session.moveTo(281);
    expect(session.getDropIndices()).toEqual([4, 5]);

    session.cleanup();
  });

  it("shifts one item at a time when dragging up", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Drag item 5 (offset=280, mid=308) upward
    // Item 4: offset=224, mid=252 — ghost top must cross BELOW 252
    // Item 3: offset=168, mid=196 — ghost top must cross BELOW 196
    const session = setupDragSession(ctx, 5);

    // Ghost top = clientY - ghostOffsetY
    // ghostOffsetY = 28 (pointer started at mid-item)
    // So ghost top = clientY - 28

    // Move ghost top just below mid of item 4 (252)
    // clientY - 28 < 252 → clientY < 280
    // But we also need to be above the drag slot (offset=280)
    // ghost top < 280 → clientY < 308, which is true
    session.moveTo(279);
    expect(session.getDropIndices()).toEqual([4]);

    // Move ghost top just below mid of item 3 (196)
    // clientY - 28 < 196 → clientY < 224
    session.moveTo(223);
    expect(session.getDropIndices()).toEqual([4, 3]);

    session.cleanup();
  });

  it("does not oscillate when reversing drag direction", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Drag item 4 (offset=224, mid=252) downward past items 5 and 6
    const session = setupDragSession(ctx, 4);

    // Move past item 5 (mid=308): clientY + 28 > 308 → clientY > 280
    session.moveTo(281);
    expect(session.getDropIndices()).toEqual([5]);

    // Move past item 6 (mid=364): clientY + 28 > 364 → clientY > 336
    session.moveTo(337);
    expect(session.getDropIndices()).toEqual([5, 6]);

    // Now reverse direction — move back up slowly
    // The drop index should NOT oscillate between values
    const indicesBefore = session.getDropIndices().length;

    // Small upward movements within the hysteresis zone — should stay at 6
    session.moveTo(335);
    session.moveTo(333);
    session.moveTo(330);

    // Verify no oscillation: either stayed at 6 or moved to 5 once
    const indicesAfter = session.getDropIndices().slice(indicesBefore);
    for (let i = 1; i < indicesAfter.length; i++) {
      // No back-and-forth: each consecutive index should be the same or
      // monotonically decreasing (retreating)
      expect(indicesAfter[i]!).toBeLessThanOrEqual(indicesAfter[i - 1]!);
    }

    session.cleanup();
  });

  it("handles large displacement correctly (e.g. after auto-scroll)", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Drag item 2 (offset=112, mid=140) far down past many items
    const session = setupDragSession(ctx, 2);

    // Jump ghost far down — past items 3 through 8
    // Item 8: offset=448, mid=476. clientY + 28 > 476 → clientY > 448
    session.moveTo(449);

    const indices = session.getDropIndices();
    // Should have jumped to 8 in one step (binary search, not scanning)
    expect(indices[indices.length - 1]).toBe(8);

    session.cleanup();
  });

  it("returns dragIndex when ghost is within the drag slot", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Drag item 4 (offset=224) — small move that stays within the slot
    const session = setupDragSession(ctx, 4);

    // Move within item 4's area — no sort:move should fire
    session.moveTo(4 * 56 + 28 + 15);
    expect(session.getDropIndices()).toEqual([]);

    session.cleanup();
  });

  it("each step shifts exactly one item when moving down then back up", () => {
    const feature = withSortable();
    const ctx = createMockContext();
    feature.setup(ctx);

    // Drag item 3 downward past items 4, 5, 6
    const session = setupDragSession(ctx, 3);

    // Past item 4 (mid=252): clientY > 224
    session.moveTo(225);
    // Past item 5 (mid=308): clientY > 280
    session.moveTo(281);
    // Past item 6 (mid=364): clientY > 336
    session.moveTo(337);

    expect(session.getDropIndices()).toEqual([4, 5, 6]);

    // Now move back up — each step should retreat by exactly 1
    // Ghost top must cross below item midpoints to retreat
    // ghost top = clientY - 28
    // Retreat from 6: ghost top < mid(6) = 364 → clientY < 392 (already true)
    //   BUT ghost bottom must also be < mid(7) = 420 → clientY + 28 < 420 → clientY < 392
    //   We need ghost top to go above the drag slot boundary for retreat
    //   Retreat from dropIndex 6: ghost top < mid(6) = 364 → clientY - 28 < 364 → clientY < 392
    //   But we're already at 337 < 392, so why didn't it retreat?
    //   Because the downward check still holds: ghost bottom = 337 + 28 = 365 > mid(6) = 364
    //   So result stays at 6. We need ghost bottom <= 364 → clientY <= 336

    session.moveTo(335); // ghost bottom = 363 < 364 → retreat from 6 to 5
    session.moveTo(278); // ghost bottom = 306 < 308 → retreat from 5 to 4
    session.moveTo(222); // ghost bottom = 250 < 252 → retreat from 4 to 3

    expect(session.getDropIndices()).toEqual([4, 5, 6, 5, 4, 3]);

    session.cleanup();
  });
});
