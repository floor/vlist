/**
 * vlist v2 — Scrollbar Plugin Tests
 * Tests for scrollbar() plugin: factory, setup wiring, DOM class, afterScroll,
 * resize, destroy.
 *
 * Adapted from v1 withScrollbar feature tests to v2 PluginContext API.
 *
 * NOTE: The underlying scrollbar components are tested separately:
 * - scrollbar/controller.test.ts — scroll controller modes
 * - scrollbar/scrollbar.test.ts — custom scrollbar UI
 *
 * This file tests the plugin integration layer that wires the scrollbar into
 * the v2 plugin context.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { scrollbar } from "../../../src/plugins/scrollbar/plugin";
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
