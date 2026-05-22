/**
 * vlist v2 — Page (Window Scroll) Plugin Tests
 * Tests for page(): factory, setup DOM modifications, context method calls,
 * window resize listener, destroy cleanup.
 *
 * NOTE: page() enables window scroll mode where the list scrolls with the
 * page instead of in its own container. The plugin modifies DOM styles,
 * overrides scroll position functions, and listens for window resize events.
 *
 * JSDOM Limitations:
 * - getBoundingClientRect() returns zeros — scroll position calculations
 *   cannot be meaningfully tested
 * - window.scrollTo() is a no-op — scroll-to-position cannot be tested
 * - window.innerHeight/innerWidth return 0 — container dimension overrides
 *   return 0 instead of real values
 *
 * This file tests what IS testable in JSDOM: factory shape, DOM style
 * modifications, context method delegation, handler registration, and
 * destroy cleanup.
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { page } from "../../../src/plugins/page/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => {
  GlobalRegistrator.register();
  // happy-dom implements scrollTo (unlike JSDOM). Override to no-op to prevent
  // state leaking between tests via window.scrollY.
  window.scrollTo = (() => {}) as any;
});
afterAll(() => { GlobalRegistrator.unregister(); });

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

// =============================================================================
// page — Factory Tests
// =============================================================================

describe("page — Factory", () => {
  it("should create a plugin with correct name and priority", () => {
    const plugin = page();

    expect(plugin.name).toBe("page");
    expect(plugin.priority).toBe(5);
    expect(typeof plugin.setup).toBe("function");
  });

  it("should accept no arguments", () => {
    const plugin = page();
    expect(plugin).toBeDefined();
  });
});

// =============================================================================
// page — DOM Modifications
// =============================================================================

describe("page — DOM Modifications", () => {
  it("should set root overflow to visible", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);
    expect(ctx.dom.root.style.overflow).toBe("visible");
    cleanup();
  });

  it("should set root height to auto", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);
    expect(ctx.dom.root.style.height).toBe("auto");
    cleanup();
  });

  it("should set viewport overflow to visible (vertical mode)", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items, { horizontal: false });

    plugin.setup!(ctx);
    expect(ctx.dom.viewport.style.overflow).toBe("visible");
    cleanup();
  });

  it("should set viewport overflowX and overflowY to visible (horizontal mode)", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items, { horizontal: true });

    plugin.setup!(ctx);
    expect(ctx.dom.viewport.style.overflowX).toBe("visible");
    expect(ctx.dom.viewport.style.overflowY).toBe("visible");
    cleanup();
  });

  it("should remove custom-scrollbar class from viewport", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);

    // Pre-add the class to verify removal
    ctx.dom.viewport.classList.add("vlist-viewport--custom-scrollbar");
    expect(
      ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);

    plugin.setup!(ctx);

    expect(
      ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(false);
    cleanup();
  });
});

// =============================================================================
// page — Context Method Delegation
// =============================================================================

describe("page — Context Method Delegation", () => {
  it("should call disableDefaultScroll", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const disableScrollSpy = mock(() => {});
    (ctx as any).disableDefaultScroll = disableScrollSpy;

    plugin.setup!(ctx);

    expect(disableScrollSpy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("should call disableDefaultResize", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const disableResizeSpy = mock(() => {});
    (ctx as any).disableDefaultResize = disableResizeSpy;

    plugin.setup!(ctx);

    expect(disableResizeSpy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("should call disableDefaultScroll and disableDefaultResize (not setScrollTarget)", () => {
    // v2 page plugin manages scroll via window.addEventListener directly,
    // it does NOT call setScrollTarget — scroll interception is handled internally.
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const setScrollTargetSpy = mock((_target: any) => {});
    (ctx as any).setScrollTarget = setScrollTargetSpy;

    plugin.setup!(ctx);

    // setScrollTarget is not called in v2 — the plugin sets up its own window listener
    expect(setScrollTargetSpy).toHaveBeenCalledTimes(0);
    cleanup();
  });

  it("should call setScrollFns with getTop and setTop functions", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const setScrollFnsSpy = mock((_get: any, _set: any) => {});
    (ctx as any).setScrollFns = setScrollFnsSpy;

    plugin.setup!(ctx);

    expect(setScrollFnsSpy).toHaveBeenCalledTimes(1);
    const [getTop, setTop] = setScrollFnsSpy.mock.calls[0]!;
    expect(typeof getTop).toBe("function");
    expect(typeof setTop).toBe("function");
    cleanup();
  });

  it("should set containerSize from window dimensions after setup", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    // containerSize should be set to window.innerHeight in vertical mode
    expect(typeof engineState.containerSize).toBe("number");
    cleanup();
  });
});

// =============================================================================
// page — Scroll Position Functions
// =============================================================================

describe("page — Scroll Position Functions", () => {
  it("getTop should return a number (0 in JSDOM since getBoundingClientRect returns zeros)", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const setScrollFnsSpy = mock((_get: any, _set: any) => {});
    (ctx as any).setScrollFns = setScrollFnsSpy;

    plugin.setup!(ctx);

    const getTop = setScrollFnsSpy.mock.calls[0]![0] as () => number;
    const position = getTop();

    expect(typeof position).toBe("number");
    // In JSDOM, getBoundingClientRect().top = 0, so Math.max(0, -0) = 0
    expect(position).toBe(0);
    cleanup();
  });

  it("setTop should not throw", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const setScrollFnsSpy = mock((_get: any, _set: any) => {});
    (ctx as any).setScrollFns = setScrollFnsSpy;

    plugin.setup!(ctx);

    const setTop = setScrollFnsSpy.mock.calls[0]![1] as (pos: number) => void;

    // Should not throw — window.scrollTo is a no-op in JSDOM
    expect(() => setTop(100)).not.toThrow();
    expect(() => setTop(0)).not.toThrow();
    cleanup();
  });

  it("getTop should use rect.left in horizontal mode", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items, { horizontal: true });
    const setScrollFnsSpy = mock((_get: any, _set: any) => {});
    (ctx as any).setScrollFns = setScrollFnsSpy;

    plugin.setup!(ctx);

    const getTop = setScrollFnsSpy.mock.calls[0]![0] as () => number;
    const position = getTop();

    expect(typeof position).toBe("number");
    // In JSDOM, getBoundingClientRect().left = 0, so Math.max(0, -0) = 0
    expect(position).toBe(0);
    cleanup();
  });

  it("setTop should use window.scrollTo with horizontal args in horizontal mode", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items, { horizontal: true });
    const setScrollFnsSpy = mock((_get: any, _set: any) => {});
    (ctx as any).setScrollFns = setScrollFnsSpy;

    plugin.setup!(ctx);

    const setTop = setScrollFnsSpy.mock.calls[0]![1] as (pos: number) => void;

    // Should not throw — window.scrollTo is a no-op in JSDOM
    expect(() => setTop(200)).not.toThrow();
    cleanup();
  });
});

// =============================================================================
// page — Handler Registration
// =============================================================================

describe("page — Handler Registration", () => {
  it("should register a destroy handler", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext(items);

    expect(destroyHandlers.length).toBe(0);

    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should not add any public methods (no scrollPadding)", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    // Window scroll mode is automatic — no public API methods registered
    expect(methods.size).toBe(0);
    cleanup();
  });
});

// =============================================================================
// page — Window Resize Handler
// =============================================================================

describe("page — Window Resize Handler", () => {
  it("should emit resize event on window resize", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    // Simulate a meaningful window resize (change > 1px)
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    window.dispatchEvent(new Event("resize"));

    expect(emitSpy).toHaveBeenCalledWith("resize", { width: 1200, height: 900 });

    // Cleanup
    plugin.destroy!();

    // Restore defaults
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    cleanup();
  });

  it("should update engineState.containerSize on window resize", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, engineState, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    window.dispatchEvent(new Event("resize"));

    expect(engineState.containerSize).toBe(900);

    plugin.destroy!();
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    cleanup();
  });

  it("should call forceRender on window resize", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const forceRenderSpy = mock(() => {});
    (ctx as any).forceRender = forceRenderSpy;

    plugin.setup!(ctx);

    // Simulate a meaningful resize
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    window.dispatchEvent(new Event("resize"));

    expect(forceRenderSpy).toHaveBeenCalled();

    plugin.destroy!();
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should skip sub-pixel resize changes (< 1px)", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    // Record current innerHeight (captured during setup as prevH)
    const currentHeight = window.innerHeight;

    // Dispatch resize with the exact same value — sizeDelta = 0 which is < 1
    Object.defineProperty(window, "innerHeight", {
      value: currentHeight,
      configurable: true,
    });
    window.dispatchEvent(new Event("resize"));

    // Should NOT emit resize — no change (delta = 0 < 1)
    expect(emitSpy).not.toHaveBeenCalledWith("resize", expect.anything());

    plugin.destroy!();
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should handle horizontal resize using width as main axis", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items, { horizontal: true });
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    // Simulate a meaningful width change
    Object.defineProperty(window, "innerWidth", { value: 2000, configurable: true });
    window.dispatchEvent(new Event("resize"));

    expect(emitSpy).toHaveBeenCalledWith("resize", expect.objectContaining({ width: 2000 }));

    plugin.destroy!();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    cleanup();
  });
});

// =============================================================================
// page — Destroy Cleanup
// =============================================================================

describe("page — Destroy Cleanup", () => {
  it("should run destroy handlers without error", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    // Should not throw
    for (const handler of destroyHandlers) {
      handler();
    }
    cleanup();
  });

  it("should be safe to call destroy handlers multiple times", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    expect(() => {
      for (const handler of destroyHandlers) {
        handler();
        handler();
      }
    }).not.toThrow();
    cleanup();
  });

  it("should clean up via plugin.destroy()", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    // plugin.destroy() should not throw and should clean up the resize listener
    expect(() => plugin.destroy!()).not.toThrow();
    cleanup();
  });

  it("should be safe to call plugin.destroy() multiple times", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    expect(() => {
      plugin.destroy!();
      plugin.destroy!();
    }).not.toThrow();
    cleanup();
  });

  it("should stop listening to window resize after destroy", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, cleanup } = createPluginMockContext(items);
    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);
    plugin.destroy!();

    // Reset spy
    emitSpy.mockClear();

    // Simulate resize after destroy
    Object.defineProperty(window, "innerHeight", { value: 1500, configurable: true });
    window.dispatchEvent(new Event("resize"));

    // Should not emit — listener was removed
    expect(emitSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });
});

// =============================================================================
// page — scrollPadding
// =============================================================================

describe("page — scrollPadding", () => {
  it("should register _scrollItemIntoView when scrollPadding is provided", () => {
    const plugin = page<TestItem>({ scrollPadding: { top: 60 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    plugin.setup!(ctx);

    expect(methods.has("_scrollItemIntoView")).toBe(true);
    expect(typeof methods.get("_scrollItemIntoView")).toBe("function");
    cleanup();
  });

  it("should NOT register _scrollItemIntoView when no scrollPadding", () => {
    const plugin = page<TestItem>();
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    expect(methods.has("_scrollItemIntoView")).toBe(false);
    cleanup();
  });

  it("should NOT register _scrollItemIntoView when scrollPadding is empty", () => {
    const plugin = page<TestItem>({});
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    expect(methods.has("_scrollItemIntoView")).toBe(false);
    cleanup();
  });

  it("should scroll up when item is above the safe area (behind top inset)", () => {
    const plugin = page<TestItem>({ scrollPadding: { top: 100 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    // Mock getBoundingClientRect: list scrolled well past viewport top
    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: -500, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 8: offset = 400 (8 * 50), screenStart = -500 + 400 = -100
    // safeStart = 100. -100 < 100 → newTarget = listDocPos + 400 - 100 = -200
    scrollItemIntoView(8);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: -200, behavior: "instant" });

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should scroll down when item is below the safe area (behind bottom inset)", () => {
    const plugin = page<TestItem>({ scrollPadding: { bottom: 80 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    // Mock getBoundingClientRect: list slightly scrolled
    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: -100, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 14: offset = 700, screenStart = -100 + 700 = 600, screenEnd = 600 + 50 = 650
    // safeEnd = 600 - 80 = 520. 650 > 520 → newTarget = listDocPos + 700 + 50 - 520 = 130
    scrollItemIntoView(14);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 130, behavior: "instant" });

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should not scroll when item is within the safe area", () => {
    const plugin = page<TestItem>({ scrollPadding: { top: 60, bottom: 60 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: -100, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 5: offset = 250, screenStart = -100 + 250 = 150, screenEnd = 150 + 50 = 200
    // safeStart = 60, safeEnd = 600 - 60 = 540. 150 >= 60 and 200 <= 540 → no scroll
    scrollItemIntoView(5);
    expect(scrollToSpy).not.toHaveBeenCalled();

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should NOT scroll when list is below the sticky bar (hero visible)", () => {
    const plugin = page<TestItem>({ scrollPadding: { top: 100 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    // List is well below the sticky bar (hero still visible)
    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: 400, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 0: offset = 0, screenStart = 400 + 0 = 400, screenEnd = 400 + 50 = 450
    // safeStart = 100. 400 >= 100. safeEnd = 800 - 0 = 800. 450 <= 800 → no scroll
    scrollItemIntoView(0);
    expect(scrollToSpy).not.toHaveBeenCalled();

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should scroll when list partially overlaps the sticky bar", () => {
    const plugin = page<TestItem>({ scrollPadding: { top: 100 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    // List top is at 40, which is above the sticky bar bottom (100)
    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: 40, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 0: offset = 0, screenStart = 40 + 0 = 40
    // safeStart = 100. 40 < 100 → newTarget = listDocPos + 0 - 100 = -60
    scrollItemIntoView(0);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: -60, behavior: "instant" });

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should support dynamic (function) padding values", () => {
    let topPad = 60;
    const plugin = page<TestItem>({
      scrollPadding: { top: () => topPad },
    });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: -200, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 3: offset = 150, screenStart = -200 + 150 = -50
    // safeStart = 60. -50 < 60 → newTarget = listDocPos + 150 - 60 = -110
    scrollItemIntoView(3);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: -110, behavior: "instant" });

    scrollToSpy.mockClear();

    // Now increase the dynamic padding — same item should scroll further
    topPad = 120;
    // Item 3: screenStart still -50. safeStart = 120.
    // newTarget = listDocPos + 150 - 120 = -170
    scrollItemIntoView(3);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: -170, behavior: "instant" });

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });

  it("should use left/right padding in horizontal mode", () => {
    const plugin = page<TestItem>({ scrollPadding: { left: 80, right: 40 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { horizontal: true, itemSize: 50 });

    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });

    // Mock getBoundingClientRect for horizontal: use rect.left
    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: 0, left: -100 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Item 0: offset = 0, screenStart = -100 + 0 = -100
    // safeStart = 80. -100 < 80 → newTarget = listDocPos + 0 - 80 = -180
    scrollItemIntoView(0);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: -180, top: 0, behavior: "instant" });

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    cleanup();
  });

  it("should handle both top and bottom padding together", () => {
    const plugin = page<TestItem>({ scrollPadding: { top: 100, bottom: 50 } });
    const items = createTestItems(100);
    const { ctx, methods, cleanup } = createPluginMockContext(items, { itemSize: 50 });

    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const origGetBCR = ctx.dom.viewport.getBoundingClientRect;
    ctx.dom.viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, top: -500, left: 0 }) as DOMRect;

    const scrollToSpy = mock((..._args: any[]) => {});
    window.scrollTo = scrollToSpy as any;

    plugin.setup!(ctx);

    const scrollItemIntoView = methods.get("_scrollItemIntoView") as (index: number) => void;

    // Test top: item 8, offset = 400, screenStart = -500 + 400 = -100
    // safeStart = 100. -100 < 100 → newTarget = -500 + 400 - 100 = -200
    scrollItemIntoView(8);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: -200, behavior: "instant" });

    scrollToSpy.mockClear();

    // Test bottom: item 22, offset = 1100, screenStart = -500 + 1100 = 600,
    // screenEnd = 600 + 50 = 650. safeEnd = 600 - 50 = 550.
    // 650 > 550 → newTarget = -500 + 1100 + 50 - 550 = 100
    scrollItemIntoView(22);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 100, behavior: "instant" });

    ctx.dom.viewport.getBoundingClientRect = origGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    cleanup();
  });
});
