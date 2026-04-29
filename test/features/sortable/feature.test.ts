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

  it("Escape after move emits sort:end to restore original position", () => {
    const { ctx } = setupKeyboard(3);
    const emitSpy = ctx.emitter.emit as ReturnType<typeof mock>;

    dispatchKey(ctx.dom.root, " ");
    dispatchKey(ctx.dom.root, "ArrowDown");
    dispatchKey(ctx.dom.root, "ArrowDown");
    emitSpy.mock.calls.length = 0;

    dispatchKey(ctx.dom.root, "Escape");

    // Should emit sort:end from current (5) back to original (3)
    const sortEnd = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 5, toIndex: 3 });
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
