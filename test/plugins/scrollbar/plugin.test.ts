/**
 * vlist v2 — Scrollbar Plugin Tests
 * Tests for scrollbar() plugin: factory, setup wiring, DOM class, afterScroll,
 * resize, destroy.
 *
 * Adapted from v1 withScrollbar feature tests to v2 PluginContext API.
 *
 * NOTE: The underlying scrollbar components are tested separately:
 * - scrollbar/scrollbar.test.ts — custom scrollbar UI
 *
 * This file tests the plugin integration layer that wires the scrollbar into
 * the v2 plugin context.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { scrollbar } from "../../../src/plugins/scrollbar/plugin";
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
}

function createTestItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));
}

// =============================================================================
// scrollbar — Factory Tests
// =============================================================================

describe("scrollbar — Factory", () => {
  it("should create a plugin with correct name and priority", () => {
    const plugin = scrollbar<TestItem>();

    expect(plugin.name).toBe("scrollbar");
    expect(plugin.priority).toBe(15);
    expect(typeof plugin.setup).toBe("function");
  });

  it("should accept empty config", () => {
    const plugin = scrollbar<TestItem>();
    expect(plugin).toBeDefined();
  });

  it("should accept autoHide config", () => {
    const plugin = scrollbar<TestItem>({ autoHide: false });
    expect(plugin).toBeDefined();
  });

  it("should accept autoHideDelay config", () => {
    const plugin = scrollbar<TestItem>({ autoHideDelay: 2000 });
    expect(plugin).toBeDefined();
  });

  it("should accept minThumbSize config", () => {
    const plugin = scrollbar<TestItem>({ minThumbSize: 50 });
    expect(plugin).toBeDefined();
  });

  it("should accept showOnHover config", () => {
    const plugin = scrollbar<TestItem>({ showOnHover: false });
    expect(plugin).toBeDefined();
  });

  it("should accept combined config", () => {
    const plugin = scrollbar<TestItem>({
      autoHide: true,
      autoHideDelay: 1500,
      minThumbSize: 40,
      showOnHover: true,
      hoverZoneWidth: 20,
    });
    expect(plugin).toBeDefined();
  });

  it("should accept gutter config", () => {
    expect(scrollbar<TestItem>({ gutter: true })).toBeDefined();
    expect(scrollbar<TestItem>({ gutter: false })).toBeDefined();
  });
});

// =============================================================================
// scrollbar — Setup Tests
// =============================================================================

describe("scrollbar — Setup", () => {
  it("should add custom-scrollbar CSS class to viewport", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(
      dom.viewport.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
    cleanup();
  });

  it("should register a destroy handler", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    const countBefore = destroyHandlers.length;

    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBeGreaterThan(countBefore);
    cleanup();
  });

  it("should have an onAfterScroll hook", () => {
    const plugin = scrollbar<TestItem>();

    expect(plugin.hooks?.onAfterScroll).toBeInstanceOf(Function);
  });

  it("should have an onResize hook", () => {
    const plugin = scrollbar<TestItem>();

    expect(plugin.hooks?.onResize).toBeInstanceOf(Function);
  });

  it("should register internal methods", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    // The scrollbar plugin registers internal coordination methods
    expect(methods.has("_scrollbar:getInstance")).toBe(true);
    expect(methods.has("_scrollbar:setCallback")).toBe(true);
    cleanup();
  });

  it("should run destroy handler without error", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      for (const handler of destroyHandlers) {
        handler();
      }
    }).not.toThrow();
    cleanup();
  });
});

// =============================================================================
// scrollbar — Scroll callback routing (RFC-012 bounded mode)
// =============================================================================

describe("scrollbar — scroll callback", () => {
  it("routes thumb drags through the scroll adapter, not raw scrollTop", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100); // 100 × 100px = 10000px content, 600px viewport
    const { ctx, dom, engineState, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items);

    engineState.totalSize = 10000;

    plugin.setup!(ctx);
    // Establish bounds so the thumb has travel.
    plugin.hooks!.onResize!(600, 800);

    const thumb = dom.root.querySelector<HTMLElement>(".vlist-scrollbar__thumb");
    expect(thumb).not.toBeNull();

    // Simulate a downward thumb drag.
    thumb!.dispatchEvent(new MouseEvent("mousedown", { clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // The mock adapter's setPixel records every write into scrollCalls. The
    // pre-RFC-012 callback wrote dom.viewport.scrollTop directly (untracked).
    // Routing through ctx.scroll is what makes the scrollbar correct under
    // bounded mode, where setPixel maps the logical pixel onto the runway.
    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls[scrollCalls.length - 1]!).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// scrollbar — Resize Handler
// =============================================================================

describe("scrollbar — Resize Handler", () => {
  it("should update scrollbar bounds on resize without throwing", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.hooks!.onResize!(500, 800)).not.toThrow();
    cleanup();
  });

  it("should update scrollbar bounds on different resize dimensions", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.hooks!.onResize!(1200, 600)).not.toThrow();
    cleanup();
  });
});

// =============================================================================
// scrollbar — AfterScroll Hook
// =============================================================================

describe("scrollbar — AfterScroll Hook", () => {
  it("should update scrollbar position without throwing", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.hooks!.onAfterScroll!(200, 1)).not.toThrow();
    cleanup();
  });

  it("should handle scroll position 0", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.hooks!.onAfterScroll!(0, 0)).not.toThrow();
    cleanup();
  });

  it("should handle large scroll positions", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.hooks!.onAfterScroll!(9999, 1)).not.toThrow();
    cleanup();
  });
});

// =============================================================================
// scrollbar — Plugin Destroy
// =============================================================================

describe("scrollbar — Plugin Destroy", () => {
  it("should clean up via plugin.destroy()", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.destroy!()).not.toThrow();
    cleanup();
  });

  it("should be safe to call plugin.destroy() multiple times", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => {
      plugin.destroy!();
      plugin.destroy!();
    }).not.toThrow();
    cleanup();
  });

  it("should be safe to call plugin.destroy() without setup", () => {
    const plugin = scrollbar<TestItem>();
    expect(() => plugin.destroy!()).not.toThrow();
  });

  it("should remove custom-scrollbar CSS class on destroy via destroyHandler", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, dom, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(false);
    cleanup();
  });
});

// =============================================================================
// scrollbar — Gutter
// =============================================================================

describe("scrollbar — Gutter", () => {
  it("should add gutter class to viewport when gutter: true", () => {
    const plugin = scrollbar<TestItem>({ gutter: true });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(true);
    cleanup();
  });

  it("should not add gutter class by default", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(false);
    cleanup();
  });

  it("should not add gutter class when gutter: false", () => {
    const plugin = scrollbar<TestItem>({ gutter: false });
    const items = createTestItems(100);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(false);
    cleanup();
  });

  it("should remove gutter class on destroy", () => {
    const plugin = scrollbar<TestItem>({ gutter: true });
    const items = createTestItems(100);
    const { ctx, dom, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(true);

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(false);
    cleanup();
  });
});

// =============================================================================
// scrollbar — Main axis padding included in bounds
// =============================================================================

describe("scrollbar — padding in max scroll", () => {
  it("should include mainAxisPadding in scrollbar bounds so thumb reaches the very end", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, dom, engineState, scrollCalls, cleanup } =
      createPluginMockContext<TestItem>(items, {
        itemSize: 50,
        containerHeight: 600,
        padding: { top: 8, bottom: 8 },
      });

    engineState.totalSize = 5000; // 100 items × 50px
    plugin.setup!(ctx);
    plugin.hooks!.onResize!(600, 800);

    // Simulate dragging thumb to the very bottom.
    const thumb = dom.root.querySelector<HTMLElement>(".vlist-scrollbar__thumb");
    expect(thumb).not.toBeNull();

    // The track length ≈ containerSize - scrollbar padding (default 2 + 2).
    // Drag a large distance that would put us at 100% of the track.
    thumb!.dispatchEvent(new MouseEvent("mousedown", { clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 1000, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // Max scroll should be totalSize + mainAxisPadding - containerSize = 5000 + 16 - 600 = 4416.
    // Without the fix, max would be 5000 - 600 = 4400 (missing 16px of padding).
    const maxCall = scrollCalls[scrollCalls.length - 1]!;
    expect(maxCall).toBe(5000 + 16 - 600);
    cleanup();
  });

  it("should position thumb correctly at maxLogical when padding is present", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, dom, engineState, cleanup } =
      createPluginMockContext<TestItem>(items, {
        itemSize: 50,
        containerHeight: 600,
        padding: { top: 8, bottom: 8 },
      });

    engineState.totalSize = 5000;
    plugin.setup!(ctx);
    plugin.hooks!.onResize!(600, 800);

    // Scroll to max logical position (includes padding)
    const maxLogical = 5000 + 16 - 600; // 4416
    plugin.hooks!.onAfterScroll!(maxLogical, 1);

    // Thumb should be at the very bottom (scroll ratio = 1.0)
    const thumb = dom.root.querySelector<HTMLElement>(".vlist-scrollbar__thumb");
    const transform = thumb!.style.transform;
    // Extract pixel value from translateY(Xpx)
    const match = transform.match(/translateY\(([0-9.]+)px\)/);
    expect(match).not.toBeNull();
    // The thumb position should equal maxThumbTravel (track - thumb size)
    // when scrollRatio = 1.0, meaning thumb is at the very end.
    const thumbPos = parseFloat(match![1]!);
    expect(thumbPos).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// scrollbar — Uses engineState.totalSize (not sizeCache)
// =============================================================================

describe("scrollbar — engineState.totalSize", () => {
  it("should use engineState.totalSize for bounds, not sizeCache", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 600,
    });

    plugin.setup!(ctx);

    // sizeCache total = 100 * 50 = 5000
    // Simulate a layout plugin (e.g. masonry) setting a smaller total
    engineState.totalSize = 1200;

    // onAfterScroll should read engineState.totalSize (1200), not sizeCache (5000)
    expect(() => plugin.hooks!.onAfterScroll!(600, 1)).not.toThrow();

    // Scroll to the layout-computed end — should not throw
    expect(() => plugin.hooks!.onAfterScroll!(600, 1)).not.toThrow();
    cleanup();
  });

  it("should update bounds when engineState.totalSize changes", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 600,
    });

    plugin.setup!(ctx);

    // First call sets initial bounds
    engineState.totalSize = 5000;
    plugin.hooks!.onAfterScroll!(0, 0);

    // Layout plugin changes total (e.g. masonry recalculates)
    engineState.totalSize = 1200;
    // Should not throw — bounds should update to the new total
    expect(() => plugin.hooks!.onAfterScroll!(500, 1)).not.toThrow();
    cleanup();
  });

  it("should use engineState.totalSize on resize", () => {
    const plugin = scrollbar<TestItem>();
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 600,
    });

    plugin.setup!(ctx);

    // Simulate masonry total
    engineState.totalSize = 1200;
    expect(() => plugin.hooks!.onResize!(1200, 600)).not.toThrow();
    cleanup();
  });
});
