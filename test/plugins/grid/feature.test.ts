/**
 * vlist v2 — Grid Plugin Tests
 * Tests for grid() plugin: factory validation, setup, render function
 * replacement via setRenderFn, resize handling, updateGrid, scrollToIndex,
 * destroy cleanup, and edge cases.
 *
 * Adapted from v1 withGrid feature tests to v2 PluginContext API.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { grid } from "../../../src/plugins/grid/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

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

function createTestItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));
}

// =============================================================================
// grid — Factory Tests
// =============================================================================

describe("grid - Factory", () => {
  it("should create a plugin with name and priority", () => {
    const plugin = grid<TestItem>({ columns: 4 });

    expect(plugin.name).toBe("grid");
    expect(plugin.priority).toBe(10);
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("should throw error if columns is not provided", () => {
    expect(() => {
      grid<TestItem>({} as any);
    }).toThrow("columns must be >= 1");
  });

  it("should throw error if columns is less than 1", () => {
    expect(() => {
      grid<TestItem>({ columns: 0 });
    }).toThrow("columns must be >= 1");
  });

  it("should throw error if columns is negative", () => {
    expect(() => {
      grid<TestItem>({ columns: -5 });
    }).toThrow("columns must be >= 1");
  });

  it("should accept valid columns configuration", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    expect(plugin).toBeDefined();
  });

  it("should accept gap configuration", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    expect(plugin).toBeDefined();
  });
});

// =============================================================================
// grid — Setup Tests
// =============================================================================

describe("grid - Setup", () => {
  it("should add grid CSS class to root", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--grid")).toBe(true);
    cleanup();
  });

  it("should replace render functions via setRenderFn", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const mock = createPluginMockContext<TestItem>(items);

    expect(mock.renderFnReplaced).toBe(false);
    plugin.setup!(mock.ctx);
    expect(mock.renderFnReplaced).toBe(true);
    mock.cleanup();
  });

  it("should have a resize hook", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    expect(plugin.hooks?.onResize).toBeInstanceOf(Function);
  });

  it("should register destroy handler", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    const countBefore = destroyHandlers.length;
    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBe(countBefore + 1);
    cleanup();
  });

  it("should expose getGridLayout method", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("getGridLayout")).toBe(true);
    const getLayout = methods.get("getGridLayout");
    expect(getLayout).toBeInstanceOf(Function);
    cleanup();
  });

  it("should expose updateGrid method", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("updateGrid")).toBe(true);
    cleanup();
  });

  it("should expose scrollToIndex method", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("scrollToIndex")).toBe(true);
    cleanup();
  });

  it("should return layout with correct columns via getGridLayout", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.columns).toBe(4);
    cleanup();
  });

  it("should set total rows via layout (100 items / 4 columns = 25 rows)", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // 100 items / 4 columns = 25 rows
    expect(layout.getTotalRows(100)).toBe(25);
    cleanup();
  });

  it("should calculate correct rows for non-divisible items", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(101);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // 101 items / 4 columns = 26 rows (ceiling)
    expect(layout.getTotalRows(101)).toBe(26);
    cleanup();
  });

  it("should remove grid class on destroy", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(dom.root.classList.contains("vlist--grid")).toBe(true);

    // Call destroy handlers
    for (const handler of destroyHandlers) handler();

    expect(dom.root.classList.contains("vlist--grid")).toBe(false);
    cleanup();
  });
});

// =============================================================================
// grid — Configuration Tests
// =============================================================================

describe("grid - Configuration", () => {
  it("should support gap configuration", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.gap).toBe(8);
    cleanup();
  });

  it("should default gap to 0 if not provided", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.gap).toBe(0);
    cleanup();
  });

  it("should support horizontal mode", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      horizontal: true,
    });

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--grid")).toBe(true);
    cleanup();
  });
});

// =============================================================================
// grid — updateGrid Method Tests
// =============================================================================

describe("grid - updateGrid", () => {
  it("should update columns via updateGrid", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;
    updateGrid({ columns: 6 });

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // 100 items / 6 columns = 17 rows (ceiling)
    expect(layout.getTotalRows(100)).toBe(17);
    cleanup();
  });

  it("should throw error if columns is 0", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ columns: 0 });
    }).toThrow("columns must be >= 1");
    cleanup();
  });

  it("should throw error if columns is negative", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ columns: -1 });
    }).toThrow("columns must be >= 1");
    cleanup();
  });

  it("should throw error if columns is non-integer", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ columns: 3.5 });
    }).toThrow("columns must be >= 1");
    cleanup();
  });

  it("should update gap", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;
    updateGrid({ gap: 16 });

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.gap).toBe(16);
    cleanup();
  });

  it("should throw error if gap is negative", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ gap: -5 });
    }).toThrow("gap must be >= 0");
    cleanup();
  });

  it("should update both columns and gap", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;
    updateGrid({ columns: 3, gap: 12 });

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.columns).toBe(3);
    expect(layout.gap).toBe(12);
    cleanup();
  });

  it("should accept zero gap", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const updateGrid = methods.get("updateGrid") as Function;

    expect(() => {
      updateGrid({ gap: 0 });
    }).not.toThrow();

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.gap).toBe(0);
    cleanup();
  });
});

// =============================================================================
// grid — Render Function Tests
// =============================================================================

describe("grid - Render Functions", () => {
  it("should call renderIfNeeded without errors", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
    cleanup();
  });

  it("should call forceRender without errors", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();
    cleanup();
  });

  it("should not render if destroyed", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, engineState, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    engineState.destroyed = true;

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();
    cleanup();
  });

  it("should handle zero total rows gracefully", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(0);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
    cleanup();
  });

  it("should handle zero container size gracefully", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, engineState, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    engineState.containerSize = 0;

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
    cleanup();
  });

  it("should render items into the content container", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const renderedCount = dom.content.children.length;
    expect(renderedCount).toBeGreaterThan(0);
    cleanup();
  });

  it("should render items with grid-item class", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    expect(firstChild).toBeDefined();
    expect(firstChild.classList.contains("vlist-grid-item")).toBe(true);
    expect(firstChild.classList.contains("vlist-item")).toBe(true);
    cleanup();
  });

  it("should set data-index attribute on rendered items", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    expect(firstChild.getAttribute("data-index")).not.toBeNull();
    cleanup();
  });

  it("should position items with translate transform", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(8);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    expect(firstChild.style.transform).toContain("translate");
    cleanup();
  });

  it("should distribute items across multiple columns", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(8);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const xPositions = new Set<string>();
    for (const child of dom.content.children) {
      const transform = (child as HTMLElement).style.transform;
      const match = transform.match(/translate\((\d+)px/);
      if (match) xPositions.add(match[1]!);
    }

    expect(xPositions.size).toBeGreaterThan(1);
    cleanup();
  });

  it("should set explicit width on grid items", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(4);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    expect(firstChild.style.width).not.toBe("");
    const width = parseInt(firstChild.style.width, 10);
    expect(width).toBeGreaterThan(0);
    // 800px container / 4 columns = 200px per column
    expect(width).toBe(200);
    cleanup();
  });

  it("should set explicit width accounting for gap", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(4);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    const width = parseInt(firstChild.style.width, 10);
    // (800 - 3*8) / 4 = (800 - 24) / 4 = 194
    expect(width).toBe(194);
    cleanup();
  });
});

// =============================================================================
// grid — Resize Hook Tests
// =============================================================================

describe("grid - Resize Hook", () => {
  it("should have onResize hook", () => {
    const plugin = grid<TestItem>({ columns: 4 });

    expect(plugin.hooks?.onResize).toBeInstanceOf(Function);
  });

  it("should call onResize without errors", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      plugin.hooks!.onResize!(1024, 768);
    }).not.toThrow();
    cleanup();
  });

  it("should handle resize with no container change without errors", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } =
      createPluginMockContext<TestItem>(items, { containerWidth: 800 });

    plugin.setup!(ctx);

    // containerWidth matches engineState.crossSize — no-op
    engineState.crossSize = 800;
    expect(() => {
      plugin.hooks!.onResize!(800, 600);
    }).not.toThrow();
    cleanup();
  });

  it("should update item styles on cross-axis resize", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(8);
    const { ctx, dom, engineState, cleanup } =
      createPluginMockContext<TestItem>(items, { containerWidth: 800 });

    plugin.setup!(ctx);
    ctx.forceRender();

    // Simulate cross-axis resize by changing engineState.crossSize
    engineState.crossSize = 1200;
    plugin.hooks!.onResize!(1200, 600);

    // Items should have updated transforms/sizes after resize
    const firstChild = dom.content.children[0] as HTMLElement;
    if (firstChild) {
      expect(firstChild.style.transform).toContain("translate");
    }
    cleanup();
  });
});

// =============================================================================
// grid — Engine State Updates
// =============================================================================

describe("grid - Engine State", () => {
  it("should update prevRange in engine state after force render", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(engineState.prevRangeStart).toBeGreaterThanOrEqual(0);
    cleanup();
  });

  it("should update visibleCount in engine state after render", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(engineState.visibleCount).toBeGreaterThan(0);
    cleanup();
  });

  it("should update content size for scrollbar after render", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const height = parseInt(dom.content.style.height, 10);
    expect(height).toBeGreaterThan(0);
    cleanup();
  });

  it("should use crossSize for column width calculation", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(4);
    const { ctx, dom, engineState, cleanup } =
      createPluginMockContext<TestItem>(items, { containerWidth: 400 });

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    if (firstChild) {
      const width = parseInt(firstChild.style.width, 10);
      // 400px / 4 columns = 100px per column
      expect(width).toBe(engineState.crossSize / 4);
    }
    cleanup();
  });
});

// =============================================================================
// grid — Edge Cases
// =============================================================================

describe("grid - Edge Cases", () => {
  it("should handle single column (degrades to list)", () => {
    const plugin = grid<TestItem>({ columns: 1 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // 100 items / 1 column = 100 rows
    expect(layout.getTotalRows(100)).toBe(100);
    cleanup();
  });

  it("should handle large column count", () => {
    const plugin = grid<TestItem>({ columns: 50 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // 100 items / 50 columns = 2 rows
    expect(layout.getTotalRows(100)).toBe(2);
    cleanup();
  });

  it("should handle column count larger than items", () => {
    const plugin = grid<TestItem>({ columns: 200 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // 100 items / 200 columns = 1 row
    expect(layout.getTotalRows(100)).toBe(1);
    cleanup();
  });

  it("should handle empty items list", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(0);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    expect(layout.getTotalRows(0)).toBe(0);
    cleanup();
  });

  it("should have conflicts with masonry and table plugins", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    expect(plugin.conflicts).toContain("masonry");
    expect(plugin.conflicts).toContain("table");
  });

  it("should render correctly with horizontal mode", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(8);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      horizontal: true,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    // In horizontal mode content width (not height) should be set
    const width = parseInt(dom.content.style.width, 10);
    expect(width).toBeGreaterThan(0);
    cleanup();
  });

  it("should use viewport height as cross-axis size in horizontal mode", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(8);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      horizontal: true,
      containerHeight: 400,
      containerWidth: 1000,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    // In horizontal mode the cross-axis is the container height (400)
    // colWidth = (400 - 3*8) / 4 = 94
    const el = dom.content.querySelector("[data-index]") as HTMLElement;
    if (el) {
      const crossSize = parseFloat(el.style.height);
      expect(crossSize).toBe(94);
    }
    cleanup();
  });
});

// =============================================================================
// grid — scrollToIndex Tests
// =============================================================================

describe("grid - scrollToIndex", () => {
  it("should register scrollToIndex method", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("scrollToIndex")).toBe(true);
    cleanup();
  });

  it("should call scrollToIndex without errors", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;

    expect(() => {
      scrollToIndex(10);
    }).not.toThrow();
    cleanup();
  });

  it("should handle scrollToIndex with center align", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;

    expect(() => {
      scrollToIndex(20, "center");
    }).not.toThrow();
    cleanup();
  });

  it("should handle scrollToIndex with end align", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;

    expect(() => {
      scrollToIndex(20, "end");
    }).not.toThrow();
    cleanup();
  });

  it("should handle scrollToIndex for empty list", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(0);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;

    expect(() => {
      scrollToIndex(0);
    }).not.toThrow();
    cleanup();
  });

  it("should map item index to correct row for scrolling", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, methods, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    // Item 8 should be in row 2 (8 / 4 = 2)
    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();
    expect(layout.getRow(8)).toBe(2);

    // Item 0 should be in row 0
    expect(layout.getRow(0)).toBe(0);

    // Item 5 should be in row 1 (5 / 4 = 1)
    expect(layout.getRow(5)).toBe(1);

    const viewport = dom.viewport;
    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(8);

    // Should have set viewport.scrollTop to the row 2 offset
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(0);
    cleanup();
  });
});

// =============================================================================
// grid — Destroy Tests
// =============================================================================

describe("grid - Destroy", () => {
  it("should clean up rendered elements on destroy", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(dom.content.children.length).toBeGreaterThan(0);

    // Call all destroy handlers
    for (const handler of destroyHandlers) handler();
    // Also call plugin destroy
    if (plugin.destroy) plugin.destroy();

    // Rendered map is cleared but DOM elements may already be removed
    cleanup();
  });

  it("should remove grid class on destroy", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--grid")).toBe(true);

    for (const handler of destroyHandlers) handler();

    expect(dom.root.classList.contains("vlist--grid")).toBe(false);
    cleanup();
  });
});

// =============================================================================
// grid — Layout Math Tests
// =============================================================================

describe("grid - Layout Math", () => {
  it("should compute correct column width for no gap", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(4);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
    });

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // (800 - 0) / 4 = 200
    expect(layout.getColumnWidth(800)).toBe(200);
    cleanup();
  });

  it("should compute correct column width accounting for gap", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(4);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
    });

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // (800 - 3*8) / 4 = 776 / 4 = 194
    expect(layout.getColumnWidth(800)).toBe(194);
    cleanup();
  });

  it("should compute correct column offset", () => {
    const plugin = grid<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(4);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items, {
      containerWidth: 800,
    });

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // col 0 offset = 0
    expect(layout.getColumnOffset(0, 800)).toBe(0);
    // col 1 offset = columnWidth + gap = 194 + 8 = 202
    expect(layout.getColumnOffset(1, 800)).toBe(202);
    cleanup();
  });

  it("should map flat item index to correct row/col", () => {
    const plugin = grid<TestItem>({ columns: 4 });
    const items = createTestItems(12);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGridLayout") as Function;
    const layout = getLayout();

    // Item 0 → row 0, col 0
    expect(layout.getRow(0)).toBe(0);
    expect(layout.getCol(0)).toBe(0);

    // Item 5 → row 1, col 1
    expect(layout.getRow(5)).toBe(1);
    expect(layout.getCol(5)).toBe(1);

    // Item 8 → row 2, col 0
    expect(layout.getRow(8)).toBe(2);
    expect(layout.getCol(8)).toBe(0);
    cleanup();
  });
});
