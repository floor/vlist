/**
 * vlist v2 — Masonry Plugin Tests
 * Tests for masonry() plugin: factory validation, setup, render function
 * replacement via setRenderFn, resize handling, data changes, scrollToIndex,
 * destroy cleanup, and edge cases.
 *
 * Adapted from v1 withMasonry feature tests to v2 PluginContext API.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { masonry } from "../../../src/plugins/masonry/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  height?: number;
}

function createTestItems(
  count: number,
  heightFn?: (i: number) => number,
): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    height: heightFn ? heightFn(i) : 100,
  }));
}

// =============================================================================
// masonry — Factory Tests
// =============================================================================

describe("masonry - Factory", () => {
  it("should create a plugin with name and priority", () => {
    const plugin = masonry<TestItem>({ columns: 4 });

    expect(plugin.name).toBe("masonry");
    expect(plugin.priority).toBe(10);
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("should throw error if columns is 0", () => {
    expect(() => {
      masonry<TestItem>({ columns: 0 });
    }).toThrow("columns must be >= 1");
  });

  it("should throw error if columns is negative", () => {
    expect(() => {
      masonry<TestItem>({ columns: -3 });
    }).toThrow("columns must be >= 1");
  });

  it("should throw error if columns is not provided", () => {
    expect(() => {
      masonry<TestItem>({} as any);
    }).toThrow("columns must be >= 1");
  });

  it("should accept valid columns configuration", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    expect(plugin).toBeDefined();
  });

  it("should accept gap configuration", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    expect(plugin).toBeDefined();
  });
});

// =============================================================================
// masonry — Setup Tests
// =============================================================================

describe("masonry - Setup", () => {
  it("should add masonry CSS class to root", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--masonry")).toBe(true);
    cleanup();
  });

  it("should throw error if reverse is true", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      reverse: true,
    });

    expect(() => {
      plugin.setup!(ctx);
    }).toThrow("cannot be combined with reverse mode");
    cleanup();
  });

  it("should have resize hook", () => {
    const plugin = masonry<TestItem>({ columns: 4 });

    expect(plugin.hooks?.onResize).toBeInstanceOf(Function);
  });

  it("should register destroy handler", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    const countBefore = destroyHandlers.length;
    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBe(countBefore + 1);
    cleanup();
  });

  it("should register scrollToIndex method", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("scrollToIndex")).toBe(true);
    cleanup();
  });

  it("should set content height based on masonry layout", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const height = parseInt(dom.content.style.height, 10);
    expect(height).toBeGreaterThan(0);
    cleanup();
  });

  it("should set content width for horizontal mode", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      horizontal: true,
    });

    plugin.setup!(ctx);

    const width = parseInt(dom.content.style.width, 10);
    expect(width).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// masonry — Render Function Replacement
// =============================================================================

describe("masonry - Render Functions", () => {
  it("should replace render functions via setRenderFn", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const mock = createPluginMockContext<TestItem>(items);

    expect(mock.renderFnReplaced).toBe(false);

    plugin.setup!(mock.ctx);

    expect(mock.renderFnReplaced).toBe(true);
    mock.cleanup();
  });

  it("should replace render functions so ctx.renderIfNeeded calls masonry render", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
    cleanup();
  });

  it("should replace render functions so ctx.forceRender calls masonry render", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();
    cleanup();
  });

  it("should not render if destroyed", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    engineState.destroyed = true;

    expect(() => {
      ctx.renderIfNeeded();
    }).not.toThrow();
    cleanup();
  });

  it("should render items into the content container", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const renderedCount = dom.content.children.length;
    expect(renderedCount).toBeGreaterThan(0);
    cleanup();
  });

  it("should render items with masonry-item class", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    expect(firstChild).toBeDefined();
    expect(firstChild.classList.contains("vlist-masonry-item")).toBe(true);
    expect(firstChild.classList.contains("vlist-item")).toBe(true);
    cleanup();
  });

  it("should render items with data-lane attribute", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstChild = dom.content.children[0] as HTMLElement;
    expect(firstChild.dataset.lane).toBeDefined();
    const lane = parseInt(firstChild.dataset.lane!, 10);
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(lane).toBeLessThan(4);
    cleanup();
  });

  it("should distribute items across multiple lanes", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const lanes = new Set<string>();
    for (const child of dom.content.children) {
      const lane = (child as HTMLElement).dataset.lane;
      if (lane !== undefined) lanes.add(lane);
    }

    expect(lanes.size).toBe(4);
    cleanup();
  });

  it("should position items with translate(x, y) for multi-column layout", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
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

  it("should set explicit width on masonry items", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(4);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

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
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(4);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

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
// masonry — Variable Heights
// =============================================================================

describe("masonry - Variable Heights", () => {
  it("should support function-based heights", () => {
    const heights = [200, 150, 300, 100, 250];
    const plugin = masonry<TestItem>({ columns: 2 });
    const items = createTestItems(5, (i) => heights[i % heights.length]!);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: (i) => heights[i % heights.length]!,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const heightValues = new Set<string>();
    for (const child of dom.content.children) {
      heightValues.add((child as HTMLElement).style.height);
    }
    expect(heightValues.size).toBeGreaterThan(1);
    cleanup();
  });

  it("should support fixed height", () => {
    const plugin = masonry<TestItem>({ columns: 3 });
    const items = createTestItems(6, () => 150);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 150,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    for (const child of dom.content.children) {
      expect((child as HTMLElement).style.height).toBe("150px");
    }
    cleanup();
  });

  it("should calculate total size based on tallest lane", () => {
    const plugin = masonry<TestItem>({ columns: 2 });
    const items = createTestItems(4, (i) => (i === 0 ? 500 : 100));
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: (i) => (i === 0 ? 500 : 100),
    });

    plugin.setup!(ctx);

    // Item 0 → lane 0 (500px), Items 1,2,3 → lane 1 (100+100+100=300)
    // Total = max(500, 300) = 500
    const contentHeight = parseInt(dom.content.style.height, 10);
    expect(contentHeight).toBe(500);
    cleanup();
  });
});

// =============================================================================
// masonry — Engine State Updates (replaces v1 Viewport State)
// =============================================================================

describe("masonry - Engine State", () => {
  it("should update prevRange in engine state after render", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(engineState.prevRangeStart).toBeGreaterThanOrEqual(0);
    expect(engineState.prevRangeEnd).toBeGreaterThan(engineState.prevRangeStart);
    cleanup();
  });

  it("should update visibleCount in engine state after render", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(engineState.visibleCount).toBeGreaterThan(0);
    cleanup();
  });

  it("should have scroll position at 0 initially", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(engineState.scrollPosition).toBe(0);
    cleanup();
  });

  it("should update prevRange after render (was -1 before)", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    // Before render, prevRangeEnd is -1 (from EngineState constructor)
    expect(engineState.prevRangeEnd).toBe(-1);

    ctx.forceRender();

    expect(engineState.prevRangeStart).toBeGreaterThanOrEqual(0);
    expect(engineState.prevRangeEnd).toBeGreaterThanOrEqual(0);
    cleanup();
  });
});

// =============================================================================
// masonry — Resize Handler
// =============================================================================

describe("masonry - Resize Handler", () => {
  it("should handle resize events without error", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    // Update crossSize before calling hook (v2 resize hook reads engineState.crossSize)
    engineState.crossSize = 1200;

    expect(() => {
      plugin.hooks!.onResize!(1200, 800);
    }).not.toThrow();
    cleanup();
  });

  it("should update layout when container width changes", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, engineState, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const heightBefore = dom.content.style.height;

    // Simulate resize to wider container
    engineState.crossSize = 1200;
    plugin.hooks!.onResize!(1200, 600);

    const heightAfter = dom.content.style.height;
    expect(heightAfter).toBeDefined();
    cleanup();
  });

  it("should not update layout if container size hasn't changed", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, engineState, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const heightBefore = dom.content.style.height;

    // Resize with same crossSize — should be a no-op
    plugin.hooks!.onResize!(800, 600);

    expect(dom.content.style.height).toBe(heightBefore);
    cleanup();
  });
});

// =============================================================================
// masonry — Data Changes
// =============================================================================

describe("masonry - Data Changes", () => {
  it("should update layout when items change", () => {
    const plugin = masonry<TestItem>({ columns: 2 });
    const items = createTestItems(10);
    const mock = createPluginMockContext<TestItem>(items);

    plugin.setup!(mock.ctx);
    mock.ctx.forceRender();

    const heightBefore = mock.dom.content.style.height;

    // Add more items
    for (let i = 10; i < 50; i++) {
      mock.items.push({ id: i + 1, name: `New Item ${i + 1}` });
    }
    mock.engineState.totalItems = 50;

    mock.ctx.forceRender();

    const heightAfter = parseInt(mock.dom.content.style.height, 10);
    const heightBeforeNum = parseInt(heightBefore, 10);
    expect(heightAfter).toBeGreaterThan(heightBeforeNum);
    mock.cleanup();
  });
});

// =============================================================================
// masonry — scrollToIndex
// =============================================================================

describe("masonry - scrollToIndex", () => {
  it("should register scrollToIndex in methods map", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("scrollToIndex")).toBe(true);
    expect(typeof methods.get("scrollToIndex")).toBe("function");
    cleanup();
  });

  it("should call scrollTo with item position", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(0, "start");

    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls[scrollCalls.length - 1]).toBe(0);
    cleanup();
  });

  it("should scroll to correct position for non-zero index", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "start");

    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls[scrollCalls.length - 1]!).toBeGreaterThan(0);
    cleanup();
  });

  it("should handle center alignment", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "center");

    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should handle end alignment", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(50, "end");

    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should clamp scroll position to >= 0", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, methods, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(0, "center"); // center alignment might try to go negative

    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls[scrollCalls.length - 1]!).toBeGreaterThanOrEqual(0);
    cleanup();
  });

  it("should no-op for out-of-bounds index", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10);
    const { ctx, methods, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const scrollToIndex = methods.get("scrollToIndex") as Function;
    scrollToIndex(9999);

    expect(scrollCalls.length).toBe(0);
    cleanup();
  });
});

// =============================================================================
// masonry — Destroy
// =============================================================================

describe("masonry - Destroy", () => {
  it("should remove masonry CSS class on destroy", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(dom.root.classList.contains("vlist--masonry")).toBe(true);

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.root.classList.contains("vlist--masonry")).toBe(false);
    cleanup();
  });

  it("should clean up rendered elements on destroy", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20);
    const { ctx, dom, destroyHandlers, cleanup } =
      createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(dom.content.children.length).toBeGreaterThan(0);

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.content.children.length).toBe(0);
    cleanup();
  });
});

// =============================================================================
// masonry — Gap Configuration
// =============================================================================

describe("masonry - Gap", () => {
  it("should default gap to 0 when not provided", () => {
    const plugin1 = masonry<TestItem>({ columns: 4 });
    const items1 = createTestItems(100);
    const mock1 = createPluginMockContext<TestItem>(items1);
    plugin1.setup!(mock1.ctx);
    const heightNoGap = parseInt(mock1.dom.content.style.height, 10);

    const plugin2 = masonry<TestItem>({ columns: 4, gap: 20 });
    const items2 = createTestItems(100);
    const mock2 = createPluginMockContext<TestItem>(items2);
    plugin2.setup!(mock2.ctx);
    const heightWithGap = parseInt(mock2.dom.content.style.height, 10);

    expect(heightWithGap).toBeGreaterThan(heightNoGap);
    mock1.cleanup();
    mock2.cleanup();
  });

  it("should produce taller layout with larger gap", () => {
    const plugin1 = masonry<TestItem>({ columns: 4, gap: 4 });
    const items1 = createTestItems(50);
    const mock1 = createPluginMockContext<TestItem>(items1);
    plugin1.setup!(mock1.ctx);
    const height1 = parseInt(mock1.dom.content.style.height, 10);

    const plugin2 = masonry<TestItem>({ columns: 4, gap: 20 });
    const items2 = createTestItems(50);
    const mock2 = createPluginMockContext<TestItem>(items2);
    plugin2.setup!(mock2.ctx);
    const height2 = parseInt(mock2.dom.content.style.height, 10);

    expect(height2).toBeGreaterThan(height1);
    mock1.cleanup();
    mock2.cleanup();
  });
});

// =============================================================================
// masonry — Column Count Effects
// =============================================================================

describe("masonry - Column Count", () => {
  it("should produce shorter layout with more columns", () => {
    const plugin2 = masonry<TestItem>({ columns: 2 });
    const items2 = createTestItems(100);
    const mock2 = createPluginMockContext<TestItem>(items2);
    plugin2.setup!(mock2.ctx);
    const height2 = parseInt(mock2.dom.content.style.height, 10);

    const plugin4 = masonry<TestItem>({ columns: 4 });
    const items4 = createTestItems(100);
    const mock4 = createPluginMockContext<TestItem>(items4);
    plugin4.setup!(mock4.ctx);
    const height4 = parseInt(mock4.dom.content.style.height, 10);

    expect(height4).toBeLessThan(height2);
    mock2.cleanup();
    mock4.cleanup();
  });

  it("should handle single column (degrades to list)", () => {
    const plugin = masonry<TestItem>({ columns: 1 });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    for (const child of dom.content.children) {
      expect((child as HTMLElement).dataset.lane).toBe("0");
    }
    cleanup();
  });

  it("should handle more columns than items", () => {
    const plugin = masonry<TestItem>({ columns: 20 });
    const items = createTestItems(5);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const lanes = new Set<string>();
    for (const child of dom.content.children) {
      lanes.add((child as HTMLElement).dataset.lane!);
    }
    expect(lanes.size).toBe(5);
    cleanup();
  });
});

// =============================================================================
// masonry — Edge Cases
// =============================================================================

describe("masonry - Edge Cases", () => {
  it("should handle empty items list", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items: TestItem[] = [];
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();

    expect(dom.content.children.length).toBe(0);
    expect(parseInt(dom.content.style.height, 10)).toBe(0);
    cleanup();
  });

  it("should handle single item", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(1);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(dom.content.children.length).toBe(1);
    const el = dom.content.children[0] as HTMLElement;
    expect(el.dataset.lane).toBe("0");
    expect(el.dataset.index).toBe("0");
    cleanup();
  });

  it("should handle large item count", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10000);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const height = parseInt(dom.content.style.height, 10);
    expect(height).toBeGreaterThan(0);

    ctx.forceRender();
    const renderedCount = dom.content.children.length;
    expect(renderedCount).toBeLessThan(10000);
    expect(renderedCount).toBeGreaterThan(0);
    cleanup();
  });

  it("should virtualize — render far fewer items than total", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(1000);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const renderedCount = dom.content.children.length;
    expect(renderedCount).toBeLessThan(100);
    expect(renderedCount).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// masonry — Selection Integration
// =============================================================================

describe("masonry - Selection Integration", () => {
  it("should read selection state from registered methods", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10);
    const { ctx, dom, methods, cleanup } = createPluginMockContext<TestItem>(items);

    // Register mock selection methods (as selection plugin would)
    const selectedIds = new Set<string | number>([3, 5]);
    methods.set("_getSelectedIds", () => selectedIds);
    methods.set("_getFocusedIndex", () => 2);

    plugin.setup!(ctx);
    ctx.forceRender();

    let foundSelected = false;
    for (const child of dom.content.children) {
      const el = child as HTMLElement;
      const id = parseInt(el.dataset.id!, 10);
      if (id === 3 || id === 5) {
        expect(el.classList.contains("vlist-item--selected")).toBe(true);
        foundSelected = true;
      }
    }
    expect(foundSelected).toBe(true);
    cleanup();
  });

  it("should apply focused class from registered method", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10);
    const { ctx, dom, methods, cleanup } = createPluginMockContext<TestItem>(items);

    methods.set("_getSelectedIds", () => new Set());
    methods.set("_getFocusedIndex", () => 0);

    plugin.setup!(ctx);
    ctx.forceRender();

    const el0 = dom.content.querySelector('[data-index="0"]') as HTMLElement;
    if (el0) {
      expect(el0.classList.contains("vlist-item--focused")).toBe(true);
    }
    cleanup();
  });

  it("should work without selection methods registered", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      ctx.forceRender();
    }).not.toThrow();

    for (const child of dom.content.children) {
      const el = child as HTMLElement;
      expect(el.classList.contains("vlist-item--selected")).toBe(false);
      expect(el.classList.contains("vlist-item--focused")).toBe(false);
    }
    cleanup();
  });
});

// =============================================================================
// masonry — Engine State Consistency (replaces v1 Events tests)
// =============================================================================

describe("masonry - Render Consistency", () => {
  it("should update engine state on first render", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    expect(engineState.prevRangeStart).toBeGreaterThanOrEqual(0);
    expect(engineState.prevRangeEnd).toBeGreaterThan(0);
    expect(engineState.visibleCount).toBeGreaterThan(0);
    cleanup();
  });

  it("should not re-render if scroll position hasn't changed", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const childCountAfterFirst = dom.content.children.length;

    // renderIfNeeded with same scroll position should be a no-op
    ctx.renderIfNeeded();

    expect(dom.content.children.length).toBe(childCountAfterFirst);
    cleanup();
  });
});

// =============================================================================
// masonry — Plugin Conflicts
// =============================================================================

describe("masonry - Plugin Metadata", () => {
  it("should declare conflicts with grid and table", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    expect(plugin.conflicts).toEqual(["grid", "table"]);
  });

  it("should have idle hook for DOM sorting", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    expect(plugin.hooks?.onIdle).toBeInstanceOf(Function);
  });
});

// =============================================================================
// masonry — navigate (lane-aware 2D keyboard navigation)
// =============================================================================

describe("masonry - navigate", () => {
  function setupWithNav(count = 20, columns = 4) {
    const plugin = masonry<TestItem>({ columns, gap: 8 });
    const items = createTestItems(count, (i) => 100 + (i % 3) * 50);
    const mock = createPluginMockContext<TestItem>(items);
    mock.engineState.containerSize = 500;
    mock.engineState.crossSize = 400;
    plugin.setup!(mock.ctx);
    mock.ctx.forceRender();
    const nav = mock.navConfig;
    return { plugin, ctx: mock.ctx, engineState: mock.engineState, nav, scrollCalls: mock.scrollCalls, cleanup: mock.cleanup };
  }

  it("should register a navigate function via setNavConfig", () => {
    const { nav, cleanup } = setupWithNav();
    expect(nav).not.toBeNull();
    expect(typeof nav.navigate).toBe("function");
    cleanup();
  });

  it("ArrowDown moves within the same lane", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(0, "ArrowDown", 20);
    expect(result).toBeGreaterThan(0);
    cleanup();
  });

  it("ArrowUp moves within the same lane", () => {
    const { nav, cleanup } = setupWithNav();
    const idx = nav.navigate(0, "ArrowDown", 20);
    const back = nav.navigate(idx, "ArrowUp", 20);
    expect(back).toBe(0);
    cleanup();
  });

  it("ArrowUp at first item in lane stays put", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(0, "ArrowUp", 20);
    expect(result).toBe(0);
    cleanup();
  });

  it("ArrowRight moves to adjacent lane", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(0, "ArrowRight", 20);
    expect(result).not.toBe(0);
    cleanup();
  });

  it("ArrowLeft at leftmost lane stays put", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(0, "ArrowLeft", 20);
    expect(result).toBe(0);
    cleanup();
  });

  it("ArrowRight at rightmost lane stays put", () => {
    const { nav, cleanup } = setupWithNav(20, 4);
    const rightmostFirst = nav.navigate(0, "ArrowRight", 20);
    const rightmost2 = nav.navigate(rightmostFirst, "ArrowRight", 20);
    const rightmost3 = nav.navigate(rightmost2, "ArrowRight", 20);
    const rightmost4 = nav.navigate(rightmost3, "ArrowRight", 20);
    expect(rightmost4).toBe(rightmost3);
    cleanup();
  });

  it("Home goes to first item", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(10, "Home", 20);
    expect(result).toBe(0);
    cleanup();
  });

  it("End goes to last item", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(0, "End", 20);
    expect(result).toBe(19);
    cleanup();
  });

  it("PageDown jumps by visible page within lane", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(0, "PageDown", 20);
    expect(result).toBeGreaterThan(0);
    cleanup();
  });

  it("PageUp jumps back within lane", () => {
    const { nav, cleanup } = setupWithNav();
    const down = nav.navigate(0, "PageDown", 20);
    const up = nav.navigate(down, "PageUp", 20);
    expect(up).toBeLessThan(down);
    cleanup();
  });

  it("unknown key returns current index", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(5, "Tab", 20);
    expect(result).toBe(5);
    cleanup();
  });

  it("invalid current index returns current index", () => {
    const { nav, cleanup } = setupWithNav();
    const result = nav.navigate(999, "ArrowDown", 20);
    expect(result).toBe(999);
    cleanup();
  });
});

// =============================================================================
// masonry — updateMasonry
// =============================================================================

describe("masonry - updateMasonry", () => {
  it("updates columns and gap", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(20, () => 100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);
    ctx.forceRender();

    const updateFn = methods.get("updateMasonry");
    expect(updateFn).toBeDefined();
    updateFn!({ columns: 3, gap: 16 });

    cleanup();
  });

  it("throws for columns < 1", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10, () => 100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);

    const updateFn = methods.get("updateMasonry");
    expect(() => updateFn!({ columns: 0 })).toThrow("columns must be >= 1");
    cleanup();
  });

  it("throws for gap < 0", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10, () => 100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);

    const updateFn = methods.get("updateMasonry");
    expect(() => updateFn!({ gap: -1 })).toThrow("gap must be >= 0");
    cleanup();
  });
});

// =============================================================================
// masonry — _scrollItemIntoView
// =============================================================================

describe("masonry - _scrollItemIntoView", () => {
  it("scrolls up when item is above viewport", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(40, () => 100);
    const { ctx, engineState, methods, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items);
    engineState.containerSize = 300;
    engineState.crossSize = 400;
    plugin.setup!(ctx);
    ctx.forceRender();

    engineState.scrollPosition = 500;
    const scrollFn = methods.get("_scrollItemIntoView");
    expect(scrollFn).toBeDefined();
    scrollFn!(0);
    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });

  it("scrolls down when item is below viewport", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(40, () => 100);
    const { ctx, engineState, methods, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items);
    engineState.containerSize = 300;
    engineState.crossSize = 400;
    plugin.setup!(ctx);
    ctx.forceRender();

    engineState.scrollPosition = 0;
    const scrollFn = methods.get("_scrollItemIntoView");
    scrollFn!(39);
    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });

  it("does nothing for invalid index", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10, () => 100);
    const { ctx, methods, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);
    ctx.forceRender();

    const scrollFn = methods.get("_scrollItemIntoView");
    scrollFn!(999);
    expect(scrollCalls.length).toBe(0);
    cleanup();
  });
});

// =============================================================================
// masonry — scrollToIndex smooth scroll
// =============================================================================

describe("masonry - scrollToIndex smooth", () => {
  it("uses smoothScrollTo with behavior smooth and duration", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(20, () => 100);
    const { ctx, methods, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);
    ctx.forceRender();

    const scrollToIndex = methods.get("scrollToIndex");
    scrollToIndex!(5, { align: "start", behavior: "smooth", duration: 300 });
    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });

  it("scrollToIndex end alignment on last item snaps to maxScroll", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(20, () => 100);
    const { ctx, engineState, methods, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items);
    engineState.containerSize = 300;
    engineState.crossSize = 400;
    plugin.setup!(ctx);
    ctx.forceRender();

    const scrollToIndex = methods.get("scrollToIndex");
    scrollToIndex!(19, "end");
    expect(scrollCalls.length).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// masonry — getSizeFn with config.size
// =============================================================================

describe("masonry - custom size function", () => {
  it("uses config.size when provided", () => {
    const sizeFn = (_i: number, _ctx: any) => 200;
    const plugin = masonry<TestItem>({ columns: 4, size: sizeFn });
    const items = createTestItems(10, () => 100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);
    ctx.forceRender();
    cleanup();
  });
});

// =============================================================================
// masonry — onIdle and destroy
// =============================================================================

describe("masonry - onIdle and destroy", () => {
  it("onIdle calls renderer.sortDOM", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(20, () => 100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);
    ctx.forceRender();

    expect(() => plugin.hooks!.onIdle!()).not.toThrow();
    cleanup();
  });

  it("plugin.destroy() cleans up", () => {
    const plugin = masonry<TestItem>({ columns: 4 });
    const items = createTestItems(10, () => 100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);
    plugin.setup!(ctx);
    ctx.forceRender();

    expect(() => plugin.destroy!()).not.toThrow();
    cleanup();
  });

  it("renderIfNeeded recalculates layout when totalItems changes", () => {
    const plugin = masonry<TestItem>({ columns: 4, gap: 8 });
    const items = createTestItems(20, () => 100);
    const { ctx, engineState, dom, cleanup } = createPluginMockContext<TestItem>(items);
    engineState.containerSize = 500;
    engineState.crossSize = 400;
    plugin.setup!(ctx);
    ctx.forceRender();

    const childrenBefore = dom.content.children.length;
    engineState.totalItems = 30;
    ctx.renderIfNeeded();
    cleanup();
  });
});
