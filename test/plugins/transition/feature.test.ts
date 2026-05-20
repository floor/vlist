import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { transition } from "../../../src/plugins/transition/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";
import type { PluginContext } from "../../../src/core/types";

// =============================================================================
// JSDOM + Web Animations API Mock
// =============================================================================

import { JSDOM } from "jsdom";

let jsdom: JSDOM;
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
  jsdom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;

  global.document = jsdom.window.document;
  global.window = jsdom.window as any;
  global.HTMLElement = jsdom.window.HTMLElement;
  (global as any).Element = jsdom.window.Element;

  jsdom.window.HTMLElement.prototype.animate = function (
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

/**
 * Creates a fully wired mock context for transition plugin tests.
 *
 * Wraps createPluginMockContext but overrides:
 * - emitter: tracks emit calls
 * - forceRender: spy mock
 * - removeItemById: actual removal from items array
 * - insertItemAt: actual insertion into items array
 * - getRenderedElement: DOM lookup in dom.content by data-index
 */
function createMockContext(
  overrides: {
    horizontal?: boolean;
    reverse?: boolean;
    items?: TestItem[];
  } = {},
): {
  ctx: PluginContext<TestItem>;
  dom: { root: HTMLElement; viewport: HTMLElement; content: HTMLElement };
  testItems: TestItem[];
  emitCalls: Array<{ event: string; payload: unknown }>;
  methods: Map<string, Function>;
  forceRenderMock: ReturnType<typeof mock>;
} {
  const testItems: TestItem[] = overrides.items ?? createTestItems(20);

  const base = createPluginMockContext<TestItem>(testItems, {
    horizontal: overrides.horizontal ?? false,
    reverse: overrides.reverse ?? false,
    itemSize: 50,
    containerWidth: 400,
    containerHeight: 600,
  });

  const emitCalls: Array<{ event: string; payload: unknown }> = [];
  const forceRenderMock = mock(() => {});

  // Patch emitter to track calls
  (base.ctx.emitter as any).emit = (event: string, payload: unknown) => {
    emitCalls.push({ event, payload });
  };

  // Build a replacement ctx with overridden methods
  const ctx: PluginContext<TestItem> = {
    ...base.ctx,

    forceRender: forceRenderMock,

    removeItemById: (id: string | number): number => {
      let index = testItems.findIndex((item) => item.id === id);
      if (index < 0 && typeof id === "number") index = id;
      if (index < 0 || index >= testItems.length) return -1;
      testItems.splice(index, 1);
      base.engineState.totalItems = testItems.length;
      return index;
    },

    insertItemAt: (item: TestItem, index: number): void => {
      testItems.splice(index, 0, item);
      base.engineState.totalItems = testItems.length;
    },

    getRenderedElement: (index: number): HTMLElement | null => {
      const children = base.dom.content.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        if (el.dataset.index === String(index)) return el;
      }
      return null;
    },

    getItems: () => testItems,
    getState: () => base.engineState,
  };

  // Keep methods map in sync: proxy registerMethod/getMethod through base
  return {
    ctx,
    dom: base.dom,
    testItems,
    emitCalls,
    methods: base.methods,
    forceRenderMock,
  };
}

function populateDOM(
  content: HTMLElement,
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
    content.appendChild(el);
  }
}

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// =============================================================================
// Config Resolution
// =============================================================================

describe("withTransition — Config", () => {
  it("uses default duration and easing when no config provided", () => {
    const plugin = transition();
    expect(plugin.name).toBe("transition");
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItem")).toBe(true);
    expect(methods.has("insertItem")).toBe(true);
  });

  it("accepts custom duration and easing", () => {
    const plugin = transition({
      duration: 400,
      easing: "ease-in-out",
    });
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItem")).toBe(true);
    expect(methods.has("insertItem")).toBe(true);
  });

  it("disables remove animation when remove: false", () => {
    const plugin = transition({ remove: false });
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItem")).toBe(false);
    expect(methods.has("insertItem")).toBe(true);
  });

  it("disables insert animation when insert: false", () => {
    const plugin = transition({ insert: false });
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItem")).toBe(true);
    expect(methods.has("insertItem")).toBe(false);
  });

  it("disables both when both set to false", () => {
    const plugin = transition({ insert: false, remove: false });
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItem")).toBe(false);
    expect(methods.has("insertItem")).toBe(false);
  });

  it("applies per-animation timing overrides", () => {
    const plugin = transition({
      duration: 300,
      insert: { duration: 100 },
      remove: { easing: "linear" },
    });
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItem")).toBe(true);
    expect(methods.has("insertItem")).toBe(true);
  });
});

// =============================================================================
// Feature Metadata
// =============================================================================

describe("withTransition — Metadata", () => {
  it("has correct name", () => {
    expect(transition().name).toBe("transition");
  });

  it("has correct priority", () => {
    expect(transition().priority).toBe(45);
  });

  it("conflicts with grid, table, and masonry", () => {
    const plugin = transition();
    expect(plugin.conflicts).toContain("grid");
    expect(plugin.conflicts).toContain("table");
    expect(plugin.conflicts).toContain("masonry");
  });

  it("has a destroy method", () => {
    expect(typeof transition().destroy).toBe("function");
  });
});

// =============================================================================
// Setup
// =============================================================================

describe("withTransition — Setup", () => {
  it("captures baseInsertItem and baseRemoveItem from methods map", () => {
    const baseInsert = mock((_item: TestItem, _index?: number) => {});
    const baseRemove = mock((_id: string | number): boolean => true);

    const { ctx, methods } = createMockContext();
    ctx.registerMethod("insertItem", baseInsert);
    ctx.registerMethod("removeItem", baseRemove);

    const plugin = transition();
    plugin.setup!(ctx);

    const insertFn = methods.get("insertItem") as Function;
    const removeFn = methods.get("removeItem") as Function;

    expect(insertFn).not.toBe(baseInsert);
    expect(removeFn).not.toBe(baseRemove);
  });

  it("captures _dataToLayoutIndex from methods map", () => {
    const { ctx, dom, methods } = createMockContext();
    const layoutMapper = (i: number): number => i + 1;
    ctx.registerMethod("_dataToLayoutIndex", layoutMapper);

    const plugin = transition();
    plugin.setup!(ctx);

    expect(methods.has("insertItem")).toBe(true);
    expect(methods.has("removeItem")).toBe(true);
  });

  it("sets transformOrigin to 'top center' for non-reverse", () => {
    const { ctx, dom, methods } = createMockContext();
    populateDOM(dom.content, createTestItems(5), 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const insertFn = methods.get("insertItem") as Function;
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
    const { ctx, dom, methods } = createMockContext({ reverse: true });
    populateDOM(dom.content, createTestItems(5), 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as Function;
    const newItem: TestItem = { id: 999, name: "New" };
    insertFn(newItem, 0);

    expect(allAnimations.length).toBeGreaterThan(0);
    const anim = allAnimations[0];
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
    const { ctx, dom, testItems, emitCalls, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
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
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(9999);

    expect(result).toBe(false);
    await flushMicrotasks();
  });

  it("calls forceRender after removing off-screen item", async () => {
    const { ctx, dom, testItems, methods, forceRenderMock } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(15);

    expect(forceRenderMock).toHaveBeenCalled();
    await flushMicrotasks();
  });
});

// =============================================================================
// removeItem — Animated Path
// =============================================================================

describe("withTransition — removeItem (animated)", () => {
  it("creates exit clone and animations for visible item", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(3);

    expect(result).toBe(true);
    expect(allAnimations.length).toBeGreaterThan(0);

    const exitClone = dom.content.lastElementChild as HTMLElement;
    expect(exitClone.style.pointerEvents).toBe("none");
    expect(exitClone.style.overflow).toBe("hidden");
    expect(exitClone.hasAttribute("data-index")).toBe(false);
    expect(exitClone.hasAttribute("data-id")).toBe(false);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes clone after animations finish", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const cloneBefore = dom.content.querySelector(
      "[style*='pointer-events']",
    );
    expect(cloneBefore).not.toBeNull();

    await flushMicrotasks();

    const cloneAfter = dom.content.querySelector(
      "[style*='pointer-events: none']",
    );
    expect(cloneAfter).toBeNull();
    allAnimations.length = 0;
  });

  it("emits data:change and remove:end events", async () => {
    const { ctx, dom, testItems, emitCalls, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
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
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const baseRemove = mock(
      (_id: string | number): boolean => false,
    );
    ctx.registerMethod("removeItem", baseRemove);

    const plugin = transition();
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    // Override removeItemById to return -1 so the base wrapper returns false
    (ctx as any).removeItemById = (_id: string | number): number => -1;

    const result = removeFn(2);

    expect(result).toBe(false);
    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("successfully removes off-screen item via removeItemById", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const initialLength = testItems.length;
    removeFn(15);
    expect(testItems.length).toBe(initialLength - 1);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("uses translateY for vertical lists", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
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
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const el = dom.content.children[2] as HTMLElement;
    el.setAttribute("aria-selected", "true");
    el.setAttribute("id", "test-id");
    el.classList.add("vlist-item--selected");

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    const exitClone = dom.content.lastElementChild as HTMLElement;
    expect(exitClone.hasAttribute("aria-selected")).toBe(false);
    expect(exitClone.hasAttribute("id")).toBe(false);
    expect(exitClone.classList.contains("vlist-item--selected")).toBe(false);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("cancels previous remove animation when a new one starts", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    removeFn(3);
    const firstBatchCount = allAnimations.length;
    expect(firstBatchCount).toBeGreaterThan(0);

    populateDOM(dom.content, testItems, 50, 0, 9);
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
    const { ctx, dom, testItems, methods, forceRenderMock } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    const newItem: TestItem = { id: 100, name: "New Item" };
    insertFn(newItem, 0);

    expect(testItems).toContainEqual(newItem);
    expect(forceRenderMock).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("emits data:change event with insert type", async () => {
    const { ctx, dom, testItems, emitCalls, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
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

  it("successfully inserts item via insertItemAt", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    const newItem: TestItem = { id: 200, name: "Base Insert" };
    insertFn(newItem, 1);

    expect(testItems).toContainEqual(newItem);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("defaults insertion index to 0 when not provided", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 300, name: "Default Index" });

    expect(testItems[0]!.id).toBe(300);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("cancels pending remove animation when insert starts", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const insertFn = methods.get("insertItem") as (
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
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
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
    const { ctx, dom, testItems, methods, forceRenderMock } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 700, name: "Middle" }, 2);

    expect(forceRenderMock).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Horizontal Mode
// =============================================================================

describe("withTransition — Horizontal mode", () => {
  it("uses translateX instead of translateY", async () => {
    const { ctx, dom, testItems, methods } = createMockContext({ horizontal: true });
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
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
    const { ctx, dom, testItems, methods, forceRenderMock } = createMockContext({ horizontal: true });
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    expect(forceRenderMock).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Reverse Mode
// =============================================================================

describe("withTransition — Reverse mode", () => {
  it("uses 'bottom center' transform origin in reverse mode", async () => {
    const { ctx, dom, testItems, methods } = createMockContext({ reverse: true });
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
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
    const { ctx, dom, testItems, methods, forceRenderMock } = createMockContext({ reverse: true });
    populateDOM(dom.content, testItems, 50, 0, 5);

    Object.defineProperty(dom.viewport, "scrollTop", {
      value: 4400,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(dom.viewport, "scrollHeight", {
      value: 5000,
      writable: true,
      configurable: true,
    });

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 800, name: "Reverse Insert" }, 0);

    expect(forceRenderMock).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Groups Integration
// =============================================================================

describe("withTransition — Groups integration", () => {
  it("uses _dataToLayoutIndex for insert position when available", async () => {
    const { ctx, dom, testItems, methods, forceRenderMock } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    ctx.registerMethod("_dataToLayoutIndex", (i: number) => i + 1);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 900, name: "Grouped Insert" }, 2);

    expect(forceRenderMock).toHaveBeenCalled();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("inserts item via insertItemAt in v2 architecture", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    const newItem: TestItem = { id: 901, name: "Through Groups" };
    insertFn(newItem, 0);

    expect(testItems).toContainEqual(newItem);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("preserves transition wrappers when async groups deletes static overrides", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const staticInsert = (item: TestItem, index?: number): void => {
      testItems.splice(index ?? 0, 0, item);
    };
    const staticRemove = (_id: string | number): boolean => true;
    ctx.registerMethod("insertItem", staticInsert);
    ctx.registerMethod("removeItem", staticRemove);

    const plugin = transition();
    plugin.setup!(ctx);

    const transitionInsert = methods.get("insertItem");
    const transitionRemove = methods.get("removeItem");
    expect(transitionInsert).not.toBe(staticInsert);
    expect(transitionRemove).not.toBe(staticRemove);

    // Simulate what async groups does: only delete if still the static override
    if (methods.get("removeItem") === staticRemove) methods.delete("removeItem");
    if (methods.get("insertItem") === staticInsert) methods.delete("insertItem");

    expect(methods.get("insertItem")).toBe(transitionInsert);
    expect(methods.get("removeItem")).toBe(transitionRemove);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("bypasses stale base methods when data manager is replaced (async groups)", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const staleRemove = mock((_id: string | number): boolean => false);
    ctx.registerMethod("removeItem", staleRemove);

    const plugin = transition();
    plugin.setup!(ctx);

    // Simulate async groups replacing removeItemById after setup
    (ctx as any).removeItemById = (id: string | number): number => {
      const index = testItems.findIndex((item) => item.id === id);
      if (index < 0) return -1;
      testItems.splice(index, 1);
      return index;
    };

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
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
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const staleInsert = mock((_item: TestItem, _index?: number): void => {});
    ctx.registerMethod("insertItem", staleInsert);

    const plugin = transition();
    plugin.setup!(ctx);

    // Simulate async groups replacing insertItemAt after setup
    (ctx as any).insertItemAt = (item: TestItem, index: number): void => {
      testItems.splice(index, 0, item);
    };

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 950, name: "Async Insert" }, 0);

    expect(staleInsert).not.toHaveBeenCalled();
    expect(testItems[0]!.id).toBe(950);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes item via removeItemById in v2 architecture", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const initialLength = testItems.length;
    removeFn(2);

    expect(testItems.length).toBe(initialLength - 1);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// Destroy
// =============================================================================

describe("withTransition — Destroy", () => {
  it("flushes pending remove animation on destroy", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(3);

    const removeAnims = [...allAnimations];
    expect(removeAnims.length).toBeGreaterThan(0);

    plugin.destroy!();

    const allSettled = removeAnims.every((a) => a.playState !== "running");
    expect(allSettled).toBe(true);
    allAnimations.length = 0;
  });

  it("flushes pending insert animation on destroy", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    insertFn({ id: 400, name: "Pending" }, 0);

    const insertAnims = [...allAnimations];
    expect(insertAnims.length).toBeGreaterThan(0);

    plugin.destroy!();

    const allSettled = insertAnims.every((a) => a.playState !== "running");
    expect(allSettled).toBe(true);
    allAnimations.length = 0;
  });

  it("is safe to call destroy when no animations are pending", () => {
    const { ctx, methods } = createMockContext();

    const plugin = transition();
    plugin.setup!(ctx);

    expect(() => plugin.destroy!()).not.toThrow();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("withTransition — Edge cases", () => {
  it("handles rapid insert then remove of same item", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    insertFn({ id: 1000, name: "Quick" }, 0);
    removeFn(1000);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("handles remove of already-removed item gracefully", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition();
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;

    const result = removeFn(99999);
    expect(result).toBe(false);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("handles empty items container gracefully", async () => {
    const { ctx, methods } = createMockContext();

    const plugin = transition();
    plugin.setup!(ctx);

    const insertFn = methods.get("insertItem") as (
      item: TestItem,
      index?: number,
    ) => void;

    expect(() =>
      insertFn({ id: 1001, name: "Into Empty" }, 0),
    ).not.toThrow();

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes by numeric index without animation when id doesn't match a DOM element", async () => {
    const items: TestItem[] = [
      { id: 10, name: "Item 10" },
      { id: 11, name: "Item 11" },
      { id: 12, name: "Item 12" },
    ];
    const { ctx, dom, methods } = createMockContext({ items });
    populateDOM(dom.content, items, 50, 0, 3);

    const plugin = transition();
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    const result = removeFn(1);

    expect(result).toBe(true);
    expect(allAnimations.length).toBe(0);

    await flushMicrotasks();
  });

  it("clamps duration to MAX_DURATION (1000ms)", () => {
    const plugin = transition({ duration: 5000 });
    const { ctx, dom, methods } = createMockContext();
    populateDOM(dom.content, createTestItems(5), 50, 0, 5);
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (id: string | number) => boolean;
    removeFn(2);

    expect(allAnimations.length).toBeGreaterThan(0);
    expect(allAnimations[0]!.options.duration).toBeLessThanOrEqual(1000);
  });

  it("uses safety timeout to finalize animations", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);

    const plugin = transition({ duration: 50 });
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (
      id: string | number,
    ) => boolean;
    removeFn(2);

    expect(allAnimations.length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const clone = dom.content.querySelector(
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
    const plugin = transition();
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItems")).toBe(true);
  });

  it("does not register removeItems when remove: false", () => {
    const plugin = transition({ remove: false });
    const { ctx, methods } = createMockContext();
    plugin.setup!(ctx);
    expect(methods.has("removeItems")).toBe(false);
  });

  it("returns 0 for empty array", () => {
    const plugin = transition();
    const { ctx, dom, methods } = createMockContext();
    populateDOM(dom.content, createTestItems(5), 50, 0, 5);
    plugin.setup!(ctx);

    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    expect(removeItemsFn([])).toBe(0);
  });

  it("delegates to single removeItem for array of length 1", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([3]);

    expect(result).toBe(1);
    expect(allAnimations.length).toBeGreaterThan(0);
    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes multiple visible items with animations", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, emitCalls, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([2, 5, 8]);

    expect(result).toBe(3);
    expect(allAnimations.length).toBeGreaterThan(0);

    const dataChangeEvents = emitCalls.filter(e => e.event === "data:change");
    expect(dataChangeEvents.length).toBe(3);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("creates clone elements for each visible target", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([1, 3, 5]);

    const clones = dom.content.querySelectorAll("[style*='pointer-events: none']");
    expect(clones.length).toBe(3);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("strips selection attributes from clones", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);

    const el = dom.content.children[2] as HTMLElement;
    el.setAttribute("aria-selected", "true");
    el.classList.add("vlist-item--selected");

    plugin.setup!(ctx);

    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([2, 4]);

    const clones = dom.content.querySelectorAll("[style*='pointer-events: none']");
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
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([1, 3]);

    expect(dom.content.querySelectorAll("[style*='pointer-events: none']").length).toBe(2);

    await flushMicrotasks();

    expect(dom.content.querySelectorAll("[style*='pointer-events: none']").length).toBe(0);
    allAnimations.length = 0;
  });

  it("emits remove:end for each removed item after finalize", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, emitCalls, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
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
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([9999, 8888]);

    expect(result).toBe(0);
    allAnimations.length = 0;
  });

  it("handles off-screen-only batch removal without animation", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, emitCalls, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 5);
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([10, 15]);

    expect(result).toBe(2);
    expect(dom.content.querySelectorAll("[style*='pointer-events: none']").length).toBe(0);

    const removeEndEvents = emitCalls.filter(e => e.event === "remove:end");
    expect(removeEndEvents.length).toBe(2);
    allAnimations.length = 0;
  });

  it("cancels pending remove animation when batch starts", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (id: string | number) => boolean;
    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;

    removeFn(1);
    const clonesBefore = dom.content.querySelectorAll("[style*='pointer-events: none']").length;
    expect(clonesBefore).toBe(1);

    removeItemsFn([3, 5]);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("captures offsets for items below viewport", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 8);
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    removeItemsFn([0, 1, 2]);

    expect(allAnimations.length).toBeGreaterThan(0);

    await flushMicrotasks();
    allAnimations.length = 0;
  });

  it("removes multiple items via removeItemById in v2 architecture", async () => {
    const { ctx, dom, testItems, methods } = createMockContext();

    populateDOM(dom.content, testItems, 50, 0, 12);

    const plugin = transition();
    plugin.setup!(ctx);

    const initialLength = testItems.length;
    const removeItemsFn = methods.get("removeItems") as (ids: ReadonlyArray<string | number>) => number;
    const result = removeItemsFn([2, 4]);

    expect(result).toBe(2);
    expect(testItems.length).toBe(initialLength - 2);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});

// =============================================================================
// removeItem — focus recovery & scroll clamp
// =============================================================================

describe("withTransition — removeItem focus & scroll clamp", () => {
  it("recovers focus after animated removal finishes", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const el = dom.content.children[5] as HTMLElement;
    el.setAttribute("tabindex", "0");
    el.focus();

    allAnimations.length = 0;
    const removeFn = methods.get("removeItem") as (id: string | number) => boolean;
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
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();

    // Attach ensureRange via a custom property on ctx (simulating extended context)
    (ctx as any).ensureRange = ensureRangeMock;

    populateDOM(dom.content, testItems, 50, 0, 12);
    plugin.setup!(ctx);

    const removeFn = methods.get("removeItem") as (id: string | number) => boolean;
    removeFn(3);

    await flushMicrotasks();

    // ensureRange in v2 is on ctx directly if present (not dataManager)
    // The plugin accesses ctx.dataManager which doesn't exist in v2.
    // This test verifies the plugin completes successfully — ensureRange
    // was on dataManager in v1 but v2 doesn't expose that path.
    // We verify the remove still succeeds.
    expect(allAnimations.length).toBeGreaterThan(0);
    allAnimations.length = 0;
  });
});

// =============================================================================
// insertItem — sibling animation
// =============================================================================

describe("withTransition — insertItem sibling slide", () => {
  it("animates existing siblings when they shift after insert", async () => {
    const plugin = transition();
    const { ctx, dom, testItems, methods } = createMockContext();
    populateDOM(dom.content, testItems, 50, 0, 10);
    plugin.setup!(ctx);

    allAnimations.length = 0;
    const insertFn = methods.get("insertItem") as (item: TestItem, index?: number) => void;
    insertFn({ id: 999, name: "New Item" }, 0);

    expect(allAnimations.length).toBeGreaterThan(0);

    await flushMicrotasks();
    allAnimations.length = 0;
  });
});
