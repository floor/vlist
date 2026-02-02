/**
 * vlist - Event Handlers Tests
 * Tests for scroll, click, and keyboard event handlers
 */

import { describe, it, expect, mock, beforeEach, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import {
  createScrollHandler,
  createClickHandler,
  createKeyboardHandler,
} from "../src/handlers";
import { createSelectionState } from "../src/selection";
import type { VListContext, VListContextConfig, VListContextState } from "../src/context";
import type { VListItem, ViewportState, Range } from "../src/types";
import type { DataManager } from "../src/data";
import type { ScrollController } from "../src/scroll";
import type { Emitter } from "../src/events";
import type { Renderer, DOMStructure, CompressionContext } from "../src/render";

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
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
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
}

const createTestItems = (count: number): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));
};

const createMockConfig = (overrides?: Partial<VListContextConfig>): VListContextConfig => ({
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

const createMockViewportState = (overrides?: Partial<ViewportState>): ViewportState => ({
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

const createMockState = (overrides?: Partial<VListContextState>): VListContextState => ({
  viewportState: createMockViewportState(),
  selectionState: createSelectionState(),
  lastRenderRange: { start: 0, end: 0 },
  isInitialized: true,
  isDestroyed: false,
  ...overrides,
});

const createMockDataManager = <T extends VListItem>(items: T[]): DataManager<T> => ({
  getState: mock(() => ({
    total: items.length,
    cached: items.length,
    isLoading: false,
    hasMore: false,
    cursor: undefined,
  })),
  getItem: mock((index: number) => items[index]),
  getItemById: mock((id: string | number) => items.find(item => item.id === id)),
  getIndexById: mock((id: string | number) => items.findIndex(item => item.id === id)),
  getItemsInRange: mock((start: number, end: number) => items.slice(start, Math.min(end + 1, items.length))),
  isItemLoaded: mock((index: number) => index >= 0 && index < items.length),
  setItems: mock(() => {}),
  setTotal: mock(() => {}),
  updateItem: mock(() => true),
  removeItem: mock(() => true),
  loadRange: mock(async () => {}),
  ensureRange: mock(async () => {}),
  loadInitial: mock(async () => {}),
  loadMore: mock(async () => true),
  reload: mock(async () => {}),
  clear: mock(() => {}),
  reset: mock(() => {}),
});

const createMockScrollController = (): ScrollController => ({
  getScrollTop: mock(() => 0),
  scrollTo: mock(() => {}),
  scrollBy: mock(() => {}),
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
    getItemsForRange: mock((range: Range) => items.slice(range.start, range.end + 1)),
    getAllLoadedItems: mock(() => items),
    getCompressionContext: mock(() => ({
      scrollTop: state.viewportState.scrollTop,
      totalItems: items.length,
      containerHeight: state.viewportState.containerHeight,
      rangeStart: state.viewportState.renderRange.start,
    })),
  };
};

// =============================================================================
// Scroll Handler Tests
// =============================================================================

describe("createScrollHandler", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;
  let renderIfNeeded: ReturnType<typeof mock>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items);
    renderIfNeeded = mock(() => {});
  });

  describe("basic scroll handling", () => {
    it("should update viewport state on scroll", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      // Viewport state should be updated
      expect(ctx.state.viewportState.scrollTop).toBe(500);
    });

    it("should call renderIfNeeded on scroll", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(renderIfNeeded).toHaveBeenCalled();
    });

    it("should emit scroll event", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(ctx.emitter.emit).toHaveBeenCalledWith("scroll", {
        scrollTop: 500,
        direction: "down",
      });
    });

    it("should update scrollbar position", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(ctx.scrollbar?.updatePosition).toHaveBeenCalledWith(500);
      expect(ctx.scrollbar?.show).toHaveBeenCalled();
    });

    it("should not process scroll when destroyed", () => {
      ctx.state.isDestroyed = true;
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(renderIfNeeded).not.toHaveBeenCalled();
      expect(ctx.emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("infinite scroll", () => {
    it("should trigger load more when near bottom with adapter", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      (ctx.dataManager.getState as any).mockReturnValue({
        total: 100,
        cached: 100,
        isLoading: false,
        hasMore: true,
      });

      // Set viewport near bottom
      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400, // Near bottom
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      expect(ctx.emitter.emit).toHaveBeenCalledWith("load:start", expect.any(Object));
      expect(ctx.dataManager.loadMore).toHaveBeenCalled();
    });

    it("should not trigger load when already loading", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      (ctx.dataManager.getState as any).mockReturnValue({
        total: 100,
        cached: 100,
        isLoading: true, // Already loading
        hasMore: true,
      });

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });

    it("should not trigger load when no more data", () => {
      ctx = createMockContext(items, { hasAdapter: true });
      (ctx.dataManager.getState as any).mockReturnValue({
        total: 100,
        cached: 100,
        isLoading: false,
        hasMore: false, // No more data
      });

      ctx.state.viewportState = createMockViewportState({
        totalHeight: 4000,
        containerHeight: 500,
        scrollTop: 3400,
      });

      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(3400, "down");

      expect(ctx.dataManager.loadMore).not.toHaveBeenCalled();
    });
  });

  describe("ensure range", () => {
    it("should ensure visible range is loaded", () => {
      const handler = createScrollHandler(ctx, renderIfNeeded);

      handler(500, "down");

      expect(ctx.dataManager.ensureRange).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Click Handler Tests
// =============================================================================

describe("createClickHandler", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;
  let forceRender: ReturnType<typeof mock>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items, { selectionMode: "single" });
    forceRender = mock(() => {});
  });

  describe("item click handling", () => {
    it("should emit item:click event when clicking an item", () => {
      const handler = createClickHandler(ctx, forceRender);

      // Create a mock item element
      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith("item:click", {
        item: items[5],
        index: 5,
        event,
      });
    });

    it("should not emit when clicking outside items", () => {
      const handler = createClickHandler(ctx, forceRender);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: ctx.dom.items });

      handler(event);

      expect(ctx.emitter.emit).not.toHaveBeenCalledWith("item:click", expect.any(Object));
    });

    it("should not process clicks when destroyed", () => {
      ctx.state.isDestroyed = true;
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("selection on click", () => {
    it("should update selection when clicking an item", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      // Selection should be updated
      expect(ctx.state.selectionState.selected.has(6)).toBe(true); // id is index + 1
      expect(ctx.state.selectionState.focusedIndex).toBe(5);
    });

    it("should emit selection:change event", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith("selection:change", expect.any(Object));
    });

    it("should not update selection when selection mode is none", () => {
      ctx = createMockContext(items, { selectionMode: "none" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should re-render after selection change", () => {
      ctx = createMockContext(items, { selectionMode: "single" });
      const handler = createClickHandler(ctx, forceRender);

      const itemElement = document.createElement("div");
      itemElement.dataset.index = "5";
      ctx.dom.items.appendChild(itemElement);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: itemElement });

      handler(event);

      expect(ctx.renderer.render).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Keyboard Handler Tests
// =============================================================================

describe("createKeyboardHandler", () => {
  let items: TestItem[];
  let ctx: VListContext<TestItem>;
  let scrollToIndex: ReturnType<typeof mock>;

  beforeEach(() => {
    items = createTestItems(100);
    ctx = createMockContext(items, { selectionMode: "single" });
    ctx.state.selectionState.focusedIndex = 5;
    scrollToIndex = mock(() => {});
  });

  describe("arrow key navigation", () => {
    it("should move focus up on ArrowUp", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(4);
    });

    it("should move focus down on ArrowDown", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(6);
    });

    it("should move focus to first item on Home", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Home" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(0);
    });

    it("should move focus to last item on End", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "End" });
      handler(event);

      expect(ctx.state.selectionState.focusedIndex).toBe(99);
    });

    it("should scroll focused item into view", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(scrollToIndex).toHaveBeenCalledWith(6, "center");
    });
  });

  describe("selection with keyboard", () => {
    it("should toggle selection on Space", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      expect(ctx.state.selectionState.selected.has(6)).toBe(true); // Item id at index 5
    });

    it("should toggle selection on Enter", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "Enter" });
      handler(event);

      expect(ctx.state.selectionState.selected.has(6)).toBe(true);
    });

    it("should emit selection:change on Space/Enter", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      expect(ctx.emitter.emit).toHaveBeenCalledWith("selection:change", expect.any(Object));
    });
  });

  describe("event handling", () => {
    it("should prevent default on handled keys", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      const preventDefaultMock = mock(() => {});
      Object.defineProperty(event, "preventDefault", { value: preventDefaultMock });

      handler(event);

      expect(preventDefaultMock).toHaveBeenCalled();
    });

    it("should not handle keys when selection mode is none", () => {
      ctx = createMockContext(items, { selectionMode: "none" });
      ctx.state.selectionState.focusedIndex = 5;
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      // Focus should not change
      expect(ctx.state.selectionState.focusedIndex).toBe(5);
    });

    it("should not process keys when destroyed", () => {
      ctx.state.isDestroyed = true;
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it("should re-render after keyboard navigation", () => {
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      expect(ctx.renderer.render).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should not select on Space if no item is focused", () => {
      ctx.state.selectionState.focusedIndex = -1;
      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: " " });
      handler(event);

      expect(ctx.state.selectionState.selected.size).toBe(0);
    });

    it("should handle empty list", () => {
      ctx = createMockContext([], { selectionMode: "single" });
      (ctx.dataManager.getState as any).mockReturnValue({
        total: 0,
        cached: 0,
        isLoading: false,
        hasMore: false,
      });

      const handler = createKeyboardHandler(ctx, scrollToIndex);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      handler(event);

      // Should not crash
      expect(true).toBe(true);
    });
  });
});
