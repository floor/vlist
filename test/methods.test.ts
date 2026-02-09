/**
 * vlist - Public API Methods Tests
 * Tests for data, scroll, and selection methods
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";
import {
  createDataMethods,
  createScrollMethods,
  createSelectionMethods,
} from "../src/methods";
import { createSelectionState } from "../src/selection";
import type {
  VListContext,
  VListContextConfig,
  VListContextState,
} from "../src/context";
import type { VListItem, ViewportState, Range } from "../src/types";
import type { DataManager } from "../src/data";
import type { ScrollController } from "../src/scroll";
import type { Emitter } from "../src/events";
import type { Renderer, DOMStructure } from "../src/render";

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
  dom.window.close();
});

// =============================================================================
// Test Utilities
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  extra?: string;
}

const createTestItems = (count: number): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));
};

const createMockConfig = (
  overrides?: Partial<VListContextConfig>,
): VListContextConfig => ({
  itemHeight: 40,
  overscan: 3,
  classPrefix: "vlist",
  selectionMode: "none",
  hasAdapter: false,
  ...overrides,
});

const createMockDOM = (): DOMStructure => {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");

  root.appendChild(viewport);
  viewport.appendChild(content);
  content.appendChild(items);

  return { root, viewport, content, items };
};

const createMockViewportState = (
  overrides?: Partial<ViewportState>,
): ViewportState => ({
  scrollTop: 0,
  containerHeight: 500,
  totalHeight: 4000,
  actualHeight: 4000,
  isCompressed: false,
  compressionRatio: 1,
  visibleRange: { start: 0, end: 12 },
  renderRange: { start: 0, end: 15 },
  ...overrides,
});

const createMockState = (
  overrides?: Partial<VListContextState>,
): VListContextState => ({
  viewportState: createMockViewportState(),
  selectionState: createSelectionState(),
  lastRenderRange: { start: 0, end: 0 },
  isInitialized: true,
  isDestroyed: false,
  cachedCompression: null,
  ...overrides,
});

const createMockDataManager = <T extends VListItem>(
  items: T[],
): DataManager<T> => {
  let currentItems = [...items];

  return {
    getState: mock(() => ({
      total: currentItems.length,
      cached: currentItems.length,
      isLoading: false,
      pendingRanges: [],
      error: undefined,
      hasMore: false,
      cursor: undefined,
    })),
    // Direct getters for hot-path access (avoid object allocation)
    getTotal: mock(() => currentItems.length),
    getCached: mock(() => currentItems.length),
    getIsLoading: mock(() => false),
    getHasMore: mock(() => false),
    getStorage: mock(() => ({}) as any),
    getPlaceholders: mock(() => ({}) as any),
    getItem: mock((index: number) => currentItems[index]),
    getItemById: mock((id: string | number) =>
      currentItems.find((item) => item.id === id),
    ),
    getIndexById: mock((id: string | number) =>
      currentItems.findIndex((item) => item.id === id),
    ),
    getItemsInRange: mock((start: number, end: number) =>
      currentItems.slice(start, Math.min(end + 1, currentItems.length)),
    ),
    isItemLoaded: mock(
      (index: number) => index >= 0 && index < currentItems.length,
    ),
    setItems: mock((newItems: T[], offset?: number, total?: number) => {
      if (offset === 0 || offset === undefined) {
        currentItems = [...newItems];
      } else {
        // Insert at offset
        currentItems.splice(offset, 0, ...newItems);
      }
    }),
    setTotal: mock(() => {}),
    updateItem: mock((id: string | number, updates: Partial<T>) => {
      const index = currentItems.findIndex((item) => item.id === id);
      if (index >= 0) {
        currentItems[index] = { ...currentItems[index], ...updates };
        return true;
      }
      return false;
    }),
    removeItem: mock((id: string | number) => {
      const index = currentItems.findIndex((item) => item.id === id);
      if (index >= 0) {
        currentItems.splice(index, 1);
        return true;
      }
      return false;
    }),
    loadRange: mock(async () => {}),
    ensureRange: mock(async () => {}),
    loadInitial: mock(async () => {}),
    loadMore: mock(async () => true),
    reload: mock(async () => {}),
    evictDistant: mock(() => {}),
    clear: mock(() => {
      currentItems = [];
    }),
    reset: mock(() => {}),
  };
};

const createMockScrollController = (): ScrollController => ({
  getScrollTop: mock(() => 0),
  scrollTo: mock(() => {}),
  scrollBy: mock(() => {}),
  isAtTop: mock(() => true),
  isAtBottom: mock(() => false),
  getScrollPercentage: mock(() => 0),
  isCompressed: mock(() => false),
  enableCompression: mock(() => {}),
  disableCompression: mock(() => {}),
  updateConfig: mock(() => {}),
  destroy: mock(() => {}),
});

const createMockRenderer = <T extends VListItem>(): Renderer<T> => ({
  render: mock(() => {}),
  updateItem: mock(() => {}),
  updatePositions: mock(() => {}),
  getElement: mock(() => undefined),
  clear: mock(() => {}),
  destroy: mock(() => {}),
});

const createMockEmitter = (): Emitter<any> => ({
  on: mock(() => () => {}),
  off: mock(() => {}),
  emit: mock(() => {}),
  once: mock(() => () => {}),
  clear: mock(() => {}),
  listenerCount: mock(() => 0),
});

const createMockScrollbar = () => ({
  updateBounds: mock(() => {}),
  updatePosition: mock(() => {}),
  show: mock(() => {}),
  hide: mock(() => {}),
  isVisible: mock(() => false),
  destroy: mock(() => {}),
});

const createMockContext = <T extends VListItem>(
  items: T[],
  configOverrides?: Partial<VListContextConfig>,
  stateOverrides?: Partial<VListContextState>,
): VListContext<T> => {
  const config = createMockConfig(configOverrides);
  const dom = createMockDOM();
  const dataManager = createMockDataManager(items);
  const scrollController = createMockScrollController();
  const renderer = createMockRenderer<T>();
  const emitter = createMockEmitter();
  const scrollbar = createMockScrollbar();
  const state = createMockState(stateOverrides);

  return {
    config,
    dom,
    dataManager,
    scrollController,
    renderer,
    emitter,
    scrollbar,
    state,
    getItemsForRange: mock((range: Range) =>
      items.slice(range.start, range.end + 1),
    ),
    getAllLoadedItems: mock(() => items),
    getCompressionContext: mock(() => ({
      scrollTop: state.viewportState.scrollTop,
      totalItems: items.length,
      containerHeight: state.viewportState.containerHeight,
      rangeStart: state.viewportState.renderRange.start,
    })),
    getCachedCompression: mock(() => ({
      isCompressed: false,
      actualHeight: items.length * config.itemHeight,
      virtualHeight: items.length * config.itemHeight,
      ratio: 1,
    })),
  };
};

// =============================================================================
// Data Methods Tests
// =============================================================================

describe("createDataMethods", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items);
  });

  describe("setItems", () => {
    it("should set items via data manager", () => {
      const methods = createDataMethods(ctx);
      const newItems = createTestItems(50);

      methods.setItems(newItems);

      expect(ctx.dataManager.setItems).toHaveBeenCalledWith(newItems, 0, 50);
    });
  });

  describe("appendItems", () => {
    it("should append items at the end", () => {
      const methods = createDataMethods(ctx);
      const newItems = createTestItems(10);

      methods.appendItems(newItems);

      expect(ctx.dataManager.setItems).toHaveBeenCalledWith(newItems, 100);
    });
  });

  describe("prependItems", () => {
    it("should prepend items at the start", () => {
      const methods = createDataMethods(ctx);
      const newItems: TestItem[] = [
        { id: -2, name: "Prepended 1" },
        { id: -1, name: "Prepended 2" },
      ];

      methods.prependItems(newItems);

      // Should clear and re-add with new items first
      expect(ctx.dataManager.clear).toHaveBeenCalled();
      expect(ctx.dataManager.setItems).toHaveBeenCalled();
    });
  });

  describe("updateItem", () => {
    it("should update item by ID", () => {
      const methods = createDataMethods(ctx);

      methods.updateItem(5, { name: "Updated Item" });

      expect(ctx.dataManager.updateItem).toHaveBeenCalledWith(5, {
        name: "Updated Item",
      });
    });

    it("should re-render visible updated item", () => {
      // Mock getIndexById to return index within render range
      (ctx.dataManager.getIndexById as any).mockReturnValue(10);
      (ctx.dataManager.getItem as any).mockReturnValue(items[10]);
      (ctx.dataManager.updateItem as any).mockReturnValue(true);

      const methods = createDataMethods(ctx);

      methods.updateItem(11, { name: "Updated" });

      expect(ctx.renderer.updateItem).toHaveBeenCalled();
    });
  });

  describe("removeItem", () => {
    it("should remove item by ID", () => {
      const methods = createDataMethods(ctx);

      methods.removeItem(5);

      expect(ctx.dataManager.removeItem).toHaveBeenCalledWith(5);
    });
  });

  describe("reload", () => {
    it("should reload data when using adapter", async () => {
      ctx = createMockContext(items, { hasAdapter: true });
      const methods = createDataMethods(ctx);

      await methods.reload();

      expect(ctx.dataManager.reload).toHaveBeenCalled();
    });

    it("should do nothing without adapter", async () => {
      ctx = createMockContext(items, { hasAdapter: false });
      const methods = createDataMethods(ctx);

      await methods.reload();

      expect(ctx.dataManager.reload).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Scroll Methods Tests
// =============================================================================

describe("createScrollMethods", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items);
  });

  describe("scrollToIndex", () => {
    it("should scroll to index with start alignment", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50, "start");

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });

    it("should scroll to index with center alignment", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50, "center");

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });

    it("should scroll to index with end alignment", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50, "end");

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });

    it("should default to start alignment", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50);

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });
  });

  describe("scrollToItem", () => {
    it("should scroll to item by ID", () => {
      (ctx.dataManager.getIndexById as any).mockReturnValue(25);
      const methods = createScrollMethods(ctx);

      methods.scrollToItem(26); // ID 26 is at index 25

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });

    it("should not scroll if item not found", () => {
      (ctx.dataManager.getIndexById as any).mockReturnValue(-1);
      const methods = createScrollMethods(ctx);

      methods.scrollToItem(999);

      expect(ctx.scrollController.scrollTo).not.toHaveBeenCalled();
    });

    it("should support alignment options", () => {
      (ctx.dataManager.getIndexById as any).mockReturnValue(25);
      const methods = createScrollMethods(ctx);

      methods.scrollToItem(26, "center");

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });
  });

  describe("getScrollPosition", () => {
    it("should return current scroll position", () => {
      (ctx.scrollController.getScrollTop as any).mockReturnValue(500);
      const methods = createScrollMethods(ctx);

      const position = methods.getScrollPosition();

      expect(position).toBe(500);
    });
  });

  describe("scrollToIndex with ScrollToOptions", () => {
    it("should accept options object with align", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50, { align: "center" });

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });

    it("should accept options object with align and behavior auto", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50, { align: "end", behavior: "auto" });

      // behavior: 'auto' should call scrollTo immediately (no animation)
      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });

    it("should schedule animation frame for smooth behavior", () => {
      const rafCalls: Function[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        rafCalls.push(cb);
        return rafCalls.length;
      }) as any;

      try {
        const methods = createScrollMethods(ctx);
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        methods.scrollToIndex(50, { behavior: "smooth" });

        // Should NOT have called scrollTo synchronously
        expect(ctx.scrollController.scrollTo).not.toHaveBeenCalled();
        // Should have scheduled an animation frame
        expect(rafCalls.length).toBe(1);
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
      }
    });

    it("should call scrollTo on each animation frame during smooth scroll", () => {
      const rafCalls: Function[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCAF = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        rafCalls.push(cb);
        return rafCalls.length;
      }) as any;
      globalThis.cancelAnimationFrame = (() => {}) as any;

      try {
        const methods = createScrollMethods(ctx);
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        methods.scrollToIndex(50, { behavior: "smooth", duration: 300 });

        // Simulate first frame (partway through)
        expect(rafCalls.length).toBe(1);
        rafCalls[0](performance.now() + 150); // halfway

        // Should have called scrollTo with an intermediate position
        expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
        // Should have scheduled another frame (animation not done)
        expect(rafCalls.length).toBe(2);
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
      }
    });

    it("should complete animation when time exceeds duration", () => {
      const rafCalls: Function[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCAF = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        rafCalls.push(cb);
        return rafCalls.length;
      }) as any;
      globalThis.cancelAnimationFrame = (() => {}) as any;

      try {
        const methods = createScrollMethods(ctx);
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        methods.scrollToIndex(50, { behavior: "smooth", duration: 300 });

        // Simulate frame past the duration
        rafCalls[0](performance.now() + 500);

        // Should have called scrollTo with final position
        expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
        // Should NOT have scheduled another frame (animation complete)
        expect(rafCalls.length).toBe(1);
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
      }
    });

    it("should skip animation when already at target position", () => {
      const rafCalls: Function[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        rafCalls.push(cb);
        return rafCalls.length;
      }) as any;

      try {
        const methods = createScrollMethods(ctx);
        // Mock: current position is already at the target
        // index 0, start alignment, height 48 → target = 0
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        methods.scrollToIndex(0, { behavior: "smooth" });

        // Should call scrollTo directly (no animation needed)
        expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
        // Should NOT have scheduled an animation frame
        expect(rafCalls.length).toBe(0);
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
      }
    });

    it("should default to align start and behavior auto for empty options", () => {
      const methods = createScrollMethods(ctx);

      methods.scrollToIndex(50, {});

      // behavior 'auto' → immediate scrollTo
      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });
  });

  describe("cancelScroll", () => {
    it("should cancel an in-progress smooth scroll", () => {
      let lastFrameId = 0;
      const cancelledIds: number[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCAF = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        return ++lastFrameId;
      }) as any;
      globalThis.cancelAnimationFrame = ((id: number) => {
        cancelledIds.push(id);
      }) as any;

      try {
        const methods = createScrollMethods(ctx);
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        methods.scrollToIndex(50, { behavior: "smooth" });
        methods.cancelScroll();

        expect(cancelledIds.length).toBe(1);
        expect(cancelledIds[0]).toBe(1);
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
      }
    });

    it("should be a no-op when no animation is running", () => {
      const cancelledIds: number[] = [];
      const originalCAF = globalThis.cancelAnimationFrame;
      globalThis.cancelAnimationFrame = ((id: number) => {
        cancelledIds.push(id);
      }) as any;

      try {
        const methods = createScrollMethods(ctx);

        // No smooth scroll started, cancelScroll should be safe
        methods.cancelScroll();

        expect(cancelledIds.length).toBe(0);
      } finally {
        globalThis.cancelAnimationFrame = originalCAF;
      }
    });

    it("should cancel previous animation when a new instant scroll is requested", () => {
      let lastFrameId = 0;
      const cancelledIds: number[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCAF = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        return ++lastFrameId;
      }) as any;
      globalThis.cancelAnimationFrame = ((id: number) => {
        cancelledIds.push(id);
      }) as any;

      try {
        const methods = createScrollMethods(ctx);
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        // Start a smooth scroll
        methods.scrollToIndex(50, { behavior: "smooth" });

        // Now do an instant scroll — should cancel the smooth one
        methods.scrollToIndex(10, "start");

        expect(cancelledIds.length).toBe(1);
        // The instant scroll should have called scrollTo
        expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
      }
    });
  });

  describe("scrollToItem with ScrollToOptions", () => {
    it("should pass options through to scrollToIndex", () => {
      const rafCalls: Function[] = [];
      const originalRAF = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: Function) => {
        rafCalls.push(cb);
        return rafCalls.length;
      }) as any;

      try {
        (ctx.dataManager.getIndexById as any).mockReturnValue(25);
        const methods = createScrollMethods(ctx);
        (ctx.scrollController.getScrollTop as any).mockReturnValue(0);

        methods.scrollToItem(26, { align: "center", behavior: "smooth" });

        // Smooth behavior → should schedule animation frame
        expect(rafCalls.length).toBe(1);
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
      }
    });

    it("should accept string alignment (backward compat)", () => {
      (ctx.dataManager.getIndexById as any).mockReturnValue(25);
      const methods = createScrollMethods(ctx);

      methods.scrollToItem(26, "center");

      expect(ctx.scrollController.scrollTo).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Selection Methods Tests
// =============================================================================

describe("createSelectionMethods", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items, { selectionMode: "multiple" });
  });

  describe("select", () => {
    it("should select items by ID", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);

      expect(ctx.state.selectionState.selected.has(1)).toBe(true);
      expect(ctx.state.selectionState.selected.has(2)).toBe(true);
      expect(ctx.state.selectionState.selected.has(3)).toBe(true);
    });

    it("should emit selection:change event", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "selection:change",
        expect.any(Object),
      );
    });

    it("should re-render after selection", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);

      expect(ctx.renderer.render).toHaveBeenCalled();
    });

    it("should not select when selection mode is none", () => {
      ctx = createMockContext(items, { selectionMode: "none" });
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should replace selection in single mode", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const methods = createSelectionMethods(ctx);

      methods.select(1);
      methods.select(2);

      expect(ctx.state.selectionState.selected.has(1)).toBe(false);
      expect(ctx.state.selectionState.selected.has(2)).toBe(true);
    });
  });

  describe("deselect", () => {
    it("should deselect items by ID", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      methods.deselect(2);

      expect(ctx.state.selectionState.selected.has(1)).toBe(true);
      expect(ctx.state.selectionState.selected.has(2)).toBe(false);
      expect(ctx.state.selectionState.selected.has(3)).toBe(true);
    });

    it("should emit selection:change event", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      (ctx.emitter.emit as any).mockClear();
      methods.deselect(2);

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "selection:change",
        expect.any(Object),
      );
    });
  });

  describe("toggleSelect", () => {
    it("should toggle selection on", () => {
      const methods = createSelectionMethods(ctx);

      methods.toggleSelect(1);

      expect(ctx.state.selectionState.selected.has(1)).toBe(true);
    });

    it("should toggle selection off", () => {
      const methods = createSelectionMethods(ctx);

      methods.toggleSelect(1);
      methods.toggleSelect(1);

      expect(ctx.state.selectionState.selected.has(1)).toBe(false);
    });

    it("should not toggle when selection mode is none", () => {
      ctx = createMockContext(items, { selectionMode: "none" });
      const methods = createSelectionMethods(ctx);

      methods.toggleSelect(1);

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });
  });

  describe("selectAll", () => {
    it("should select all items in multiple mode", () => {
      const methods = createSelectionMethods(ctx);

      methods.selectAll();

      expect(ctx.state.selectionState.selected.size).toBe(100);
    });

    it("should not select all in single mode", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const methods = createSelectionMethods(ctx);

      methods.selectAll();

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should emit selection:change event", () => {
      const methods = createSelectionMethods(ctx);

      methods.selectAll();

      expect(ctx.emitter.emit).toHaveBeenCalledWith(
        "selection:change",
        expect.any(Object),
      );
    });
  });

  describe("clearSelection", () => {
    it("should clear all selections", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      methods.clearSelection();

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should emit selection:change event with empty arrays", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      (ctx.emitter.emit as any).mockClear();
      methods.clearSelection();

      expect(ctx.emitter.emit).toHaveBeenCalledWith("selection:change", {
        selected: [],
        items: [],
      });
    });

    it("should re-render after clearing", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      (ctx.renderer.render as any).mockClear();
      methods.clearSelection();

      expect(ctx.renderer.render).toHaveBeenCalled();
    });
  });

  describe("getSelected", () => {
    it("should return array of selected IDs", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      const selected = methods.getSelected();

      expect(selected).toContain(1);
      expect(selected).toContain(2);
      expect(selected).toContain(3);
      expect(selected).toHaveLength(3);
    });

    it("should return empty array when nothing selected", () => {
      const methods = createSelectionMethods(ctx);

      const selected = methods.getSelected();

      expect(selected).toHaveLength(0);
    });
  });

  describe("getSelectedItems", () => {
    it("should return selected items", () => {
      const methods = createSelectionMethods(ctx);

      methods.select(1, 2, 3);
      const selectedItems = methods.getSelectedItems();

      expect(selectedItems).toHaveLength(3);
      expect(selectedItems.find((i) => i.id === 1)).toBeDefined();
      expect(selectedItems.find((i) => i.id === 2)).toBeDefined();
      expect(selectedItems.find((i) => i.id === 3)).toBeDefined();
    });

    it("should return empty array when nothing selected", () => {
      const methods = createSelectionMethods(ctx);

      const selectedItems = methods.getSelectedItems();

      expect(selectedItems).toHaveLength(0);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Methods Integration", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items, { selectionMode: "multiple" });
  });

  it("should work together for common workflows", () => {
    const dataMethods = createDataMethods(ctx);
    const scrollMethods = createScrollMethods(ctx);
    const selectionMethods = createSelectionMethods(ctx);

    // Select some items
    selectionMethods.select(1, 2, 3);
    expect(selectionMethods.getSelected()).toHaveLength(3);

    // Scroll to a selected item
    (ctx.dataManager.getIndexById as any).mockReturnValue(1);
    scrollMethods.scrollToItem(2, "center");
    expect(ctx.scrollController.scrollTo).toHaveBeenCalled();

    // Update an item
    dataMethods.updateItem(2, { name: "Updated" });
    expect(ctx.dataManager.updateItem).toHaveBeenCalledWith(2, {
      name: "Updated",
    });

    // Clear selection
    selectionMethods.clearSelection();
    expect(selectionMethods.getSelected()).toHaveLength(0);
  });

  it("should handle selection after data changes", () => {
    const dataMethods = createDataMethods(ctx);
    const selectionMethods = createSelectionMethods(ctx);

    // Select items
    selectionMethods.select(1, 2, 3);

    // Remove an item (selection should still have the ID until explicitly cleared)
    dataMethods.removeItem(2);

    // Selection state still has the ID (client code should handle this)
    expect(ctx.state.selectionState.selected.has(2)).toBe(true);

    // But getSelectedItems won't return it since item is gone
    // (This depends on implementation - our mock doesn't reflect removal in getAllLoadedItems)
  });
});
