import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { withTransition } from "../../../src/features/transition/feature";
import { createSizeCache } from "../../../src/rendering/sizes";
import type { VListItem } from "../../../src/types";
import type { BuilderContext } from "../../../src/builder/types";

// =============================================================================
// JSDOM + Web Animations API Mock
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;

interface MockAnimation {
  finished: Promise<Animation>;
  playState: AnimationPlayState;
  cancel: () => void;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

const allAnimations: MockAnimation[] = [];

const createMockAnimation = (
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): MockAnimation => {
  let resolveFn: (a: Animation) => void;
  const anim: MockAnimation = {
    finished: new Promise<Animation>((resolve) => {
      resolveFn = resolve;
    }),
    playState: "running" as AnimationPlayState,
    cancel: () => {
      anim.playState = "idle" as AnimationPlayState;
    },
    keyframes,
    options,
  };
  setTimeout(() => {
    anim.playState = "finished" as AnimationPlayState;
    resolveFn(anim as unknown as Animation);
  }, 0);
  allAnimations.push(anim);
  return anim;
};

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
  (global as any).Element = dom.window.Element;

  dom.window.HTMLElement.prototype.animate = function (
    this: HTMLElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options?: number | KeyframeAnimationOptions,
  ): Animation {
    const kf = Array.isArray(keyframes) ? keyframes : [];
    const opts =
      typeof options === "number" ? { duration: options } : options ?? {};
    return createMockAnimation(kf, opts) as unknown as Animation;
  };
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
  Object.defineProperty(viewport, "scrollTop", {
    value: 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(viewport, "scrollLeft", {
    value: 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(viewport, "scrollHeight", {
    value: 5000,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(viewport, "scrollWidth", {
    value: 400,
    writable: true,
    configurable: true,
  });

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  return { root, viewport, content, items };
}

function createItemElement(
  index: number,
  id: number | string,
  offset: number,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "vlist-item";
  el.dataset.index = String(index);
  el.dataset.id = String(id);
  el.style.transform = `translateY(${offset}px)`;
  el.textContent = `Item ${id}`;
  return el;
}

function createMockContext(
  overrides: {
    horizontal?: boolean;
    reverse?: boolean;
    items?: TestItem[];
  } = {},
): {
  ctx: BuilderContext<TestItem>;
  testDom: ReturnType<typeof createTestDOM>;
  testItems: TestItem[];
  emitCalls: Array<{ event: string; payload: unknown }>;
} {
  const testDom = createTestDOM();
  const testItems = overrides.items ?? createTestItems(20);
  const itemHeight = 50;
  const sizeCache = createSizeCache(itemHeight, testItems.length);
  const emitCalls: Array<{ event: string; payload: unknown }> = [];

  let virtualTotalFn = () => testItems.length;
  const forceRenderFn = mock(() => {});

  const ctx: BuilderContext<TestItem> = {
    dom: testDom as any,
    sizeCache: sizeCache as any,
    emitter: {
      on: () => {},
      off: () => {},
      emit: (event: string, payload: unknown) => {
        emitCalls.push({ event, payload });
      },
    } as any,
    config: {
      overscan: 2,
      classPrefix: "vlist",
      reverse: overrides.reverse ?? false,
      wrap: false,
      horizontal: overrides.horizontal ?? false,
      ariaIdPrefix: "vlist",
      interactive: true,
    },
    rawConfig: {
      container: document.createElement("div"),
      items: testItems,
      item: {
        height: itemHeight,
        template: (item: TestItem) => `<div>${item.name}</div>`,
      },
    },
    renderer: {
      render: () => {},
      updateItemClasses: () => {},
      updatePositions: () => {},
      updateItem: () => {},
      getElement: (index: number): HTMLElement | null => {
        const children = testDom.items.children;
        for (let i = 0; i < children.length; i++) {
          const el = children[i] as HTMLElement;
          if (el.dataset.index === String(index)) return el;
        }
        return null;
      },
      clear: () => {},
      destroy: () => {},
    } as any,
    dataManager: {
      getTotal: () => testItems.length,
      getCached: () => testItems.length,
      getItem: (index: number) => testItems[index],
      getIndexById: (id: string | number) => {
        for (let i = 0; i < testItems.length; i++) {
          if (testItems[i]?.id === id) return i;
        }
        return -1;
      },
      getItemsInRange: (start: number, end: number) =>
        testItems.slice(start, end + 1),
      isItemLoaded: () => true,
      getState: () => ({ total: testItems.length }),
      getStorage: () => null,
      insertItem: (item: TestItem, index: number) => {
        testItems.splice(index, 0, item);
      },
      removeItem: (id: string | number) => {
        let index: number;
        if (typeof id === "number") {
          const byId = testItems.findIndex((item) => item.id === id);
          index = byId >= 0 ? byId : id;
        } else {
          index = testItems.findIndex((item) => String(item.id) === id);
        }
        if (index < 0 || index >= testItems.length) return false;
        testItems.splice(index, 1);
        return true;
      },
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
        totalSize: testItems.length * itemHeight,
        actualSize: testItems.length * itemHeight,
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
    contextMenuHandlers: [],
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
      actualSize: testItems.length * itemHeight,
      virtualSize: testItems.length * itemHeight,
      ratio: 1,
    }),
    getCompressionContext: () => ({
      scrollPosition: 0,
      totalItems: testItems.length,
      containerSize: 600,
      rangeStart: 0,
    }),
    renderIfNeeded: () => {},
    forceRender: forceRenderFn,
    invalidateRendered: () => {},
    getRenderFns: () => ({
      renderIfNeeded: () => {},
      forceRender: forceRenderFn,
    }),
    setRenderFns: () => {},
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
    triggerScrollFrame: () => {},
    setScrollTarget: () => {},
    getScrollTarget: () => testDom.viewport as any,
    setContainerDimensions: () => {},
    disableViewportResize: () => {},
    disableWheelHandler: () => {},
    adjustScrollPosition: (pos: number) => pos,
    getStripeIndexFn: () => (index: number) => index,
    setStripeIndexFn: () => {},
    getItemToScrollIndexFn: () => (index: number) => index,
    getVisibleRange: mock(() => {}),
    setItemToScrollIndexFn: () => {},
  };

  return { ctx, testDom, testItems, emitCalls };
}

function populateDOM(
  testDom: ReturnType<typeof createTestDOM>,
  items: TestItem[],
  itemHeight: number,
  start: number = 0,
  count?: number,
): void {
  const n = count ?? Math.min(items.length, 12);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx >= items.length) break;
    const el = createItemElement(idx, items[idx]!.id, idx * itemHeight);
    testDom.items.appendChild(el);
  }
}

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// =============================================================================
// Config Resolution
// =============================================================================

describe("withTransition — Config", () => {
  it("uses default duration and easing when no config provided", () => {
    const feature = withTransition();
    expect(feature.name).toBe("transition");
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItem")).toBe(true);
    expect(ctx.methods.has("insertItem")).toBe(true);
  });

  it("accepts custom duration and easing", () => {
    const feature = withTransition({
      duration: 400,
      easing: "ease-in-out",
    });
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItem")).toBe(true);
    expect(ctx.methods.has("insertItem")).toBe(true);
  });

  it("disables remove animation when remove: false", () => {
    const feature = withTransition({ remove: false });
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItem")).toBe(false);
    expect(ctx.methods.has("insertItem")).toBe(true);
  });

  it("disables insert animation when insert: false", () => {
    const feature = withTransition({ insert: false });
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItem")).toBe(true);
    expect(ctx.methods.has("insertItem")).toBe(false);
  });

  it("disables both when both set to false", () => {
    const feature = withTransition({ insert: false, remove: false });
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItem")).toBe(false);
    expect(ctx.methods.has("insertItem")).toBe(false);
  });

  it("applies per-animation timing overrides", () => {
    const feature = withTransition({
      duration: 300,
      insert: { duration: 100 },
      remove: { easing: "linear" },
    });
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItem")).toBe(true);
    expect(ctx.methods.has("insertItem")).toBe(true);
  });
});

// =============================================================================
// Feature Metadata
// =============================================================================

describe("withTransition — Metadata", () => {
  it("has correct name", () => {
    expect(withTransition().name).toBe("transition");
  });

  it("has correct priority", () => {
    expect(withTransition().priority).toBe(45);
  });

  it("conflicts with grid, table, and masonry", () => {
    const feature = withTransition();
    expect(feature.conflicts).toContain("withGrid");
    expect(feature.conflicts).toContain("withTable");
    expect(feature.conflicts).toContain("withMasonry");
  });

  it("has a destroy method", () => {
    expect(typeof withTransition().destroy).toBe("function");
  });
});

// =============================================================================
// Setup
// =============================================================================

describe("withTransition — Setup", () => {
  it("captures baseInsertItem and baseRemoveItem from methods map", () => {
    const baseInsert = mock((_item: TestItem, _index?: number) => {});
    const baseRemove = mock((_id: string | number): boolean => true);

    const { ctx } = createMockContext();
    ctx.methods.set("insertItem", baseInsert);
    ctx.methods.set("removeItem", baseRemove);

    const feature = withTransition();
    feature.setup!(ctx);

    const insertFn = ctx.methods.get("insertItem") as Function;
    const removeFn = ctx.methods.get("removeItem") as Function;

    expect(insertFn).not.toBe(baseInsert);
    expect(removeFn).not.toBe(baseRemove);
  });

  it("captures _dataToLayoutIndex from methods map", () => {
    const { ctx, testDom } = createMockContext();
    const layoutMapper = (i: number): number => i + 1;
    ctx.methods.set("_dataToLayoutIndex", layoutMapper);

    const feature = withTransition();
    feature.setup!(ctx);

    expect(ctx.methods.has("insertItem")).toBe(true);
    expect(ctx.methods.has("removeItem")).toBe(true);
  });

  it("sets transformOrigin to 'top center' for non-reverse", () => {
    const { ctx, testDom } = createMockContext();
    populateDOM(testDom, createTestItems(5), 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    const insertFn = ctx.methods.get("insertItem") as Function;
    const newItem: TestItem = { id: 999, name: "New" };
    insertFn(newItem, 0);

    const anim = allAnimations[allAnimations.length - 1];
    if (anim) {
      const kf = anim.keyframes;
      const hasTopCenter = kf.some(
        (k: any) => k.transformOrigin === "top center",
      );
      expect(hasTopCenter).toBe(true);
    }
    allAnimations.length = 0;
  });

  it("sets transformOrigin to 'bottom center' for reverse mode", () => {
    const { ctx, testDom } = createMockContext({ reverse: true });
    populateDOM(testDom, createTestItems(5), 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    const insertFn = ctx.methods.get("insertItem") as Function;
    const newItem: TestItem = { id: 999, name: "New" };
    insertFn(newItem, 0);

    const anim = allAnimations[allAnimations.length - 1];
    if (anim) {
      const kf = anim.keyframes;
      const hasBottomCenter = kf.some(
        (k: any) => k.transformOrigin === "bottom center",
      );
      expect(hasBottomCenter).toBe(true);
    }
    allAnimations.length = 0;
  });
});

// =============================================================================
// removeItem — Off-Screen Path
// =============================================================================

describe("withTransition — removeItem (off-screen)", () => {
  it("removes item without animation when element is not in DOM", async () => {
    const { ctx, testDom, testItems, emitCalls } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(15);

    expect(result).toBe(true);
    expect(allAnimations.length).toBe(0);
    expect(emitCalls.some((c) => c.event === "data:change")).toBe(true);
    expect(emitCalls.some((c) => c.event === "remove:end")).toBe(true);
    await flushMicrotasks();
  });

  it("returns false and warns for non-existent item", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(9999);

    expect(result).toBe(false);
    await flushMicrotasks();
  });

  it("calls forceRender after removing off-screen item", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(15);

    expect(ctx.forceRender).toHaveBeenCalled();
    await flushMicrotasks();
  });
});

// =============================================================================
// removeItem — Animated Path
// =============================================================================

describe("withTransition — removeItem (animated)", () => {
  it("creates exit clone and animations for visible item", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(3);

    expect(result).toBe(true);
    expect(allAnimations.length).toBeGreaterThan(0);

    const exitClone = testDom.items.lastElementChild as HTMLElement;
    expect(exitClone.style.pointerEvents).toBe("none");
    expect(exitClone.style.overflow).toBe("hidden");
    expect(exitClone.hasAttribute("data-index")).toBe(false);
    expect(exitClone.hasAttribute("data-id")).toBe(false);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes clone after animations finish", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const cloneBefore = testDom.items.querySelector(
      "[style*='pointer-events']",
    );
    expect(cloneBefore).not.toBeNull();

    await flushMicrotasks();

    const cloneAfter = testDom.items.querySelector(
      "[style*='pointer-events: none']",
    );
    expect(cloneAfter).toBeNull();
    allAnimations.length = 0;
  });

  it("emits data:change and remove:end events", async () => {
    const { ctx, testDom, testItems, emitCalls } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    expect(emitCalls.some((c) => c.event === "data:change")).toBe(true);
    const dataChange = emitCalls.find((c) => c.event === "data:change");
    expect((dataChange?.payload as any).type).toBe("remove");
    expect((dataChange?.payload as any).id).toBe(2);

    await flushMicrotasks();

    expect(emitCalls.some((c) => c.event === "remove:end")).toBe(true);
    allAnimations.length = 0;
  });

  it("returns false when baseRemoveItem returns false for visible item", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const baseRemove = mock(
      (_id: string | number): boolean => false,
    );
    ctx.methods.set("removeItem", baseRemove);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(2);

    expect(result).toBe(false);
    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("uses baseRemoveItem when provided by a prior feature", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const baseRemove = mock((_id: string | number): boolean => {
      const index = testItems.findIndex((item) => item.id === _id);
      if (index < 0) return false;
      testItems.splice(index, 1);
      return true;
    });
    ctx.methods.set("removeItem", baseRemove);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(15);
    expect(baseRemove).toHaveBeenCalledWith(15);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("uses translateY for vertical lists", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const cloneAnim = allAnimations[0];
    expect(cloneAnim).toBeDefined();
    const fromTransform = (cloneAnim!.keyframes[0] as any)?.transform ?? "";
    expect(fromTransform).toContain("translateY");

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("strips selected-item attributes from clone", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const el = testDom.items.children[2] as HTMLElement;
    el.setAttribute("aria-selected", "true");
    el.setAttribute("id", "test-id");
    el.classList.add("vlist-item--selected");

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const exitClone = testDom.items.lastElementChild as HTMLElement;
    expect(exitClone.hasAttribute("aria-selected")).toBe(false);
    expect(exitClone.hasAttribute("id")).toBe(false);
    expect(exitClone.classList.contains("vlist-item--selected")).toBe(false);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("cancels previous remove animation when a new one starts", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    removeFn(3);
    const firstBatchCount = allAnimations.length;
    expect(firstBatchCount).toBeGreaterThan(0);

    populateDOM(testDom, testItems, 50, 0, 9);
    removeFn(5);

    const firstAnims = allAnimations.slice(0, firstBatchCount);
    const allCancelled = firstAnims.every((a) => a.playState !== "running");
    expect(allCancelled).toBe(true);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// insertItem — Animated Path
// =============================================================================

describe("withTransition — insertItem (animated)", () => {
  it("inserts item and creates animations", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    const newItem: TestItem = { id: 100, name: "New Item" };
    insertFn(newItem, 0);

    expect(testItems).toContainEqual(newItem);
    expect(ctx.forceRender).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("emits data:change event with insert type", async () => {
    const { ctx, testDom, testItems, emitCalls } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 100, name: "New" }, 2);

    const dataChange = emitCalls.find((c) => c.event === "data:change");
    expect(dataChange).toBeDefined();
    expect((dataChange?.payload as any).type).toBe("insert");
    expect((dataChange?.payload as any).id).toBe(100);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("uses baseInsertItem when provided by a prior feature", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const baseInsert = mock((item: TestItem, index?: number) => {
      testItems.splice(index ?? 0, 0, item);
    });
    ctx.methods.set("insertItem", baseInsert);

    const feature = withTransition();
    feature.setup!(ctx);

    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 200, name: "Base Insert" }, 1);

    expect(baseInsert).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("defaults insertion index to 0 when not provided", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 300, name: "Default Index" });

    expect(testItems[0]!.id).toBe(300);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("cancels pending remove animation when insert starts", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;

    removeFn(3);
    const removeAnims = [...allAnimations];

    insertFn({ id: 500, name: "Interrupt" }, 0);

    const allSettled = removeAnims.every((a) => a.playState !== "running");
    expect(allSettled).toBe(true);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("cancels pending insert animation when a new insert starts", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;

    insertFn({ id: 600, name: "First" }, 0);
    const firstAnims = [...allAnimations];

    insertFn({ id: 601, name: "Second" }, 0);

    const allSettled = firstAnims.every((a) => a.playState !== "running");
    expect(allSettled).toBe(true);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("captures old offsets by data-id before insert", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 700, name: "Middle" }, 2);

    expect(ctx.forceRender).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Horizontal Mode
// =============================================================================

describe("withTransition — Horizontal mode", () => {
  it("uses translateX instead of translateY", async () => {
    const { ctx, testDom, testItems } = createMockContext({ horizontal: true });
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const cloneAnim = allAnimations[0];
    expect(cloneAnim).toBeDefined();
    const fromTransform = (cloneAnim!.keyframes[0] as any)?.transform ?? "";
    expect(fromTransform).toContain("translateX");

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("uses scrollLeft for scroll position in horizontal mode", async () => {
    const { ctx, testDom, testItems } = createMockContext({ horizontal: true });
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    expect(ctx.forceRender).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Reverse Mode
// =============================================================================

describe("withTransition — Reverse mode", () => {
  it("uses 'bottom center' transform origin in reverse mode", async () => {
    const { ctx, testDom, testItems } = createMockContext({ reverse: true });
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const cloneAnim = allAnimations[0];
    expect(cloneAnim).toBeDefined();
    const kf = cloneAnim!.keyframes;
    const hasBottomCenter = kf.some(
      (k: any) => k.transformOrigin === "bottom center",
    );
    expect(hasBottomCenter).toBe(true);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("scrolls to reveal new item when at bottom in reverse mode", async () => {
    const { ctx, testDom, testItems } = createMockContext({ reverse: true });
    populateDOM(testDom, testItems, 50, 0, 5);

    Object.defineProperty(testDom.viewport, "scrollTop", {
      value: 4400,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(testDom.viewport, "scrollHeight", {
      value: 5000,
      writable: true,
      configurable: true,
    });

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 800, name: "Reverse Insert" }, 0);

    expect(ctx.forceRender).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Groups Integration
// =============================================================================

describe("withTransition — Groups integration", () => {
  it("uses _dataToLayoutIndex for insert position when available", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    ctx.methods.set("_dataToLayoutIndex", (i: number) => i + 1);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 900, name: "Grouped Insert" }, 2);

    expect(ctx.forceRender).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("chains through baseInsertItem from groups feature", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const groupInsert = mock((item: TestItem, index?: number) => {
      testItems.splice(index ?? 0, 0, item);
    });
    ctx.methods.set("insertItem", groupInsert);

    const feature = withTransition();
    feature.setup!(ctx);

    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 901, name: "Through Groups" }, 0);

    expect(groupInsert).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("preserves transition wrappers when async groups deletes static overrides", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const staticInsert = (item: TestItem, index?: number): void => {
      testItems.splice(index ?? 0, 0, item);
    };
    const staticRemove = (_id: string | number): boolean => true;
    ctx.methods.set("insertItem", staticInsert);
    ctx.methods.set("removeItem", staticRemove);

    const feature = withTransition();
    feature.setup!(ctx);

    const transitionInsert = ctx.methods.get("insertItem");
    const transitionRemove = ctx.methods.get("removeItem");
    expect(transitionInsert).not.toBe(staticInsert);
    expect(transitionRemove).not.toBe(staticRemove);

    // Simulate what async groups does: only delete if still the static override
    if (ctx.methods.get("removeItem") === staticRemove) ctx.methods.delete("removeItem");
    if (ctx.methods.get("insertItem") === staticInsert) ctx.methods.delete("insertItem");

    expect(ctx.methods.get("insertItem")).toBe(transitionInsert);
    expect(ctx.methods.get("removeItem")).toBe(transitionRemove);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("bypasses stale base methods when data manager is replaced (async groups)", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const staleRemove = mock((_id: string | number): boolean => false);
    ctx.methods.set("removeItem", staleRemove);

    const feature = withTransition();
    feature.setup!(ctx);

    // Simulate async groups replacing the data manager after setup
    const newDataManager = {
      ...ctx.dataManager,
      removeItem: (id: string | number): boolean => {
        const index = testItems.findIndex((item) => item.id === id);
        if (index < 0) return false;
        testItems.splice(index, 1);
        return true;
      },
      getIndexById: ctx.dataManager.getIndexById,
      getTotal: () => testItems.length,
    };
    (ctx as any).dataManager = newDataManager;

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(2);

    expect(result).toBe(true);
    expect(staleRemove).not.toHaveBeenCalled();
    expect(allAnimations.length).toBeGreaterThan(0);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("bypasses stale base insertItem when data manager is replaced", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const staleInsert = mock((_item: TestItem, _index?: number): void => {});
    ctx.methods.set("insertItem", staleInsert);

    const feature = withTransition();
    feature.setup!(ctx);

    // Simulate async groups replacing the data manager
    const newDataManager = {
      ...ctx.dataManager,
      insertItem: (item: TestItem, index: number): void => {
        testItems.splice(index, 0, item);
      },
    };
    (ctx as any).dataManager = newDataManager;

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 950, name: "Async Insert" }, 0);

    expect(staleInsert).not.toHaveBeenCalled();
    expect(testItems[0]!.id).toBe(950);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("chains through baseRemoveItem from groups feature", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const groupRemove = mock((_id: string | number): boolean => {
      const index = testItems.findIndex((item) => item.id === _id);
      if (index < 0) return false;
      testItems.splice(index, 1);
      return true;
    });
    ctx.methods.set("removeItem", groupRemove);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    expect(groupRemove).toHaveBeenCalledWith(2);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Destroy
// =============================================================================

describe("withTransition — Destroy", () => {
  it("flushes pending remove animation on destroy", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(3);

    const removeAnims = [...allAnimations];
    expect(removeAnims.length).toBeGreaterThan(0);

    feature.destroy!();

    const allSettled = removeAnims.every((a) => a.playState !== "running");
    expect(allSettled).toBe(true);
    allAnimations.length = 0;
  });

  it("flushes pending insert animation on destroy", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 400, name: "Pending" }, 0);

    const insertAnims = [...allAnimations];
    expect(insertAnims.length).toBeGreaterThan(0);

    feature.destroy!();

    const allSettled = insertAnims.every((a) => a.playState !== "running");
    expect(allSettled).toBe(true);
    allAnimations.length = 0;
  });

  it("is safe to call destroy when no animations are pending", () => {
    const { ctx } = createMockContext();

    const feature = withTransition();
    feature.setup!(ctx);

    expect(() => feature.destroy!()).not.toThrow();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("withTransition — Edge cases", () => {
  it("handles rapid insert then remove of same item", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    insertFn({ id: 1000, name: "Quick" }, 0);
    removeFn(1000);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("handles remove of already-removed item gracefully", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    const result = removeFn(99999);
    expect(result).toBe(false);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("handles empty items container gracefully", async () => {
    const { ctx } = createMockContext();

    const feature = withTransition();
    feature.setup!(ctx);

    const insertFn = ctx.methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;

    expect(() =>
      insertFn({ id: 1001, name: "Into Empty" }, 0),
    ).not.toThrow();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("animates removal by numeric index when id doesn't match", async () => {
    const items: TestItem[] = [
      { id: 10, name: "Item 10" },
      { id: 11, name: "Item 11" },
      { id: 12, name: "Item 12" },
    ];
    const { ctx, testDom } = createMockContext({ items });
    populateDOM(testDom, items, 50, 0, 3);

    const feature = withTransition();
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(1);

    expect(result).toBe(true);
    expect(allAnimations.length).toBeGreaterThan(0);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("clamps duration to MAX_DURATION (1000ms)", () => {
    const feature = withTransition({ duration: 5000 });
    const { ctx, testDom } = createMockContext();
    populateDOM(testDom, createTestItems(5), 50, 0, 5);
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (id: string | number) => boolean;
    removeFn(2);

    expect(allAnimations.length).toBeGreaterThan(0);
    expect(allAnimations[0]!.options.duration).toBeLessThanOrEqual(1000);
  });

  it("uses safety timeout to finalize animations", async () => {
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);

    const feature = withTransition({ duration: 50 });
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    expect(allAnimations.length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const clone = testDom.items.querySelector(
      "[style*='pointer-events: none']",
    );
    expect(clone).toBeNull();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Batch removeItems
// =============================================================================

describe("withTransition — removeItems", () => {
  it("registers removeItems method during setup", () => {
    const feature = withTransition();
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItems")).toBe(true);
  });

  it("does not register removeItems when remove: false", () => {
    const feature = withTransition({ remove: false });
    const { ctx } = createMockContext();
    feature.setup!(ctx);
    expect(ctx.methods.has("removeItems")).toBe(false);
  });

  it("returns 0 for empty array", () => {
    const feature = withTransition();
    const { ctx, testDom } = createMockContext();
    populateDOM(testDom, createTestItems(5), 50, 0, 5);
    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    expect(removeItemsFn([])).toBe(0);
  });

  it("delegates to single removeItem for array of length 1", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([3]);

    expect(result).toBe(1);
    expect(allAnimations.length).toBeGreaterThan(0);
    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes multiple visible items with animations", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems, emitCalls } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([2, 5, 8]);

    expect(result).toBe(3);
    expect(allAnimations.length).toBeGreaterThan(0);

    const dataChangeEvents = emitCalls.filter(e => e.event === "data:change");
    expect(dataChangeEvents.length).toBe(3);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("creates clone elements for each visible target", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([1, 3, 5]);

    const clones = testDom.items.querySelectorAll("[style*='pointer-events: none']");
    expect(clones.length).toBe(3);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("strips selection attributes from clones", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);

    const el = testDom.items.children[2] as HTMLElement;
    el.setAttribute("aria-selected", "true");
    el.classList.add("vlist-item--selected");

    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([2, 4]);

    const clones = testDom.items.querySelectorAll("[style*='pointer-events: none']");
    for (const clone of clones) {
      expect(clone.getAttribute("aria-selected")).toBeNull();
      expect(clone.classList.contains("vlist-item--selected")).toBe(false);
      expect(clone.getAttribute("data-index")).toBeNull();
      expect(clone.getAttribute("data-id")).toBeNull();
    }

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("cleans up clones after animations finish", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([1, 3]);

    expect(testDom.items.querySelectorAll("[style*='pointer-events: none']").length).toBe(2);

    await flushMicrotasks();

    expect(testDom.items.querySelectorAll("[style*='pointer-events: none']").length).toBe(0);
    allAnimations.length = 0;
  });

  it("emits remove:end for each removed item after finalize", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems, emitCalls } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([0, 4, 7]);

    await flushMicrotasks();

    const removeEndEvents = emitCalls.filter(e => e.event === "remove:end");
    expect(removeEndEvents.length).toBe(3);
    const endIds = removeEndEvents.map(e => (e.payload as any).id);
    expect(endIds).toContain(0);
    expect(endIds).toContain(4);
    expect(endIds).toContain(7);
    allAnimations.length = 0;
  });

  it("returns 0 when no items could be removed", () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([9999, 8888]);

    expect(result).toBe(0);
    allAnimations.length = 0;
  });

  it("handles off-screen-only batch removal without animation", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems, emitCalls } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 5);
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([10, 15]);

    expect(result).toBe(2);
    expect(testDom.items.querySelectorAll("[style*='pointer-events: none']").length).toBe(0);

    const removeEndEvents = emitCalls.filter(e => e.event === "remove:end");
    expect(removeEndEvents.length).toBe(2);
    allAnimations.length = 0;
  });

  it("cancels pending remove animation when batch starts", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (id: string | number) => boolean;
    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;

    removeFn(1);
    const clonesBefore = testDom.items.querySelectorAll("[style*='pointer-events: none']").length;
    expect(clonesBefore).toBe(1);

    removeItemsFn([3, 5]);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("captures offsets for items below viewport", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 8);
    feature.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([0, 1, 2]);

    expect(allAnimations.length).toBeGreaterThan(0);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("uses baseRemoveItem when available and not stale", async () => {
    const baseRemove = mock((_id: string | number): boolean => true);
    const { ctx, testDom, testItems } = createMockContext();
    ctx.methods.set("removeItem", baseRemove);

    populateDOM(testDom, testItems, 50, 0, 12);

    const feature = withTransition();
    feature.setup!(ctx);

    const removeItemsFn = ctx.methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([2, 4]);

    expect(baseRemove).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// removeItem — focus recovery & scroll clamp
// =============================================================================

describe("withTransition — removeItem focus & scroll clamp", () => {
  it("recovers focus after animated removal finishes", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const el = testDom.items.children[5] as HTMLElement;
    el.setAttribute("tabindex", "0");
    el.focus();

    allAnimations.length = 0;
    const removeFn = ctx.methods.get("removeItem") as (id: string | number) => boolean;
    removeFn(3);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// scheduleEnsureRange
// =============================================================================

describe("withTransition — ensureRange scheduling", () => {
  it("schedules ensureRange when data manager supports it", async () => {
    const ensureRangeMock = mock(() => Promise.resolve());
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    (ctx.dataManager as any).ensureRange = ensureRangeMock;
    populateDOM(testDom, testItems, 50, 0, 12);
    feature.setup!(ctx);

    const removeFn = ctx.methods.get("removeItem") as (id: string | number) => boolean;
    removeFn(3);

    await flushMicrotasks();

    expect(ensureRangeMock).toHaveBeenCalled();
    allAnimations.length = 0;
  });
});

// =============================================================================
// insertItem — sibling animation
// =============================================================================

describe("withTransition — insertItem sibling slide", () => {
  it("animates existing siblings when they shift after insert", async () => {
    const feature = withTransition();
    const { ctx, testDom, testItems } = createMockContext();
    populateDOM(testDom, testItems, 50, 0, 10);
    feature.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = ctx.methods.get("insertItem") as (item: TestItem, index?: number) => void;
    insertFn({ id: 999, name: "New Item" }, 0);

    expect(allAnimations.length).toBeGreaterThan(0);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});
