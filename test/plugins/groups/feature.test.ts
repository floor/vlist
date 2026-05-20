/**
 * vlist v2 — Groups Plugin Tests
 * Tests for groups() plugin: factory validation, setup wiring, DOM class,
 * size config, render function replacement, sticky header, destroy cleanup.
 *
 * Adapted from v1 withGroups feature tests to v2 PluginContext API.
 *
 * NOTE: The underlying group components are tested separately:
 * - groups/layout.test.ts — group layout math
 * - groups/sticky.test.ts — sticky header behavior
 *
 * This file tests the plugin integration layer (groups()) that wires
 * group layout, sticky headers, and size dispatch into the plugin context.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { groups } from "../../../src/plugins/groups/plugin";
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
  category: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    category: i < 10 ? "A" : i < 20 ? "B" : "C",
  }));

// =============================================================================
// groups — Factory Tests
// =============================================================================

describe("groups — Factory", () => {
  it("should create a plugin with correct name and priority", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: (key) => `<div>${key}</div>` },
    });

    expect(plugin.name).toBe("groups");
    expect(plugin.priority).toBe(10);
    expect(typeof plugin.setup).toBe("function");
  });

  it("should require getGroupForIndex function", () => {
    expect(() => {
      groups<TestItem>({
        getGroupForIndex: undefined as any,
        header: { height: 40, template: () => "Header" },
      });
    }).toThrow();
  });

  it("should require header template", () => {
    expect(() => {
      groups<TestItem>({
        getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
        header: { height: 40, template: undefined as any },
      });
    }).toThrow();
  });

  it("should require a positive header height", () => {
    expect(() => {
      groups<TestItem>({
        getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
        header: { height: 0, template: () => "Header" },
      });
    }).toThrow();
  });

  it("should accept sticky option true", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    expect(plugin).toBeDefined();
  });

  it("should accept sticky option false", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: false,
    });
    expect(plugin).toBeDefined();
  });

  it("should accept header.width for horizontal orientation", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: {
        width: 48,
        template: (key) => `<div>${key}</div>`,
      },
    });
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("groups");
  });

  it("should accept legacy headerHeight/headerTemplate", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      headerHeight: 32,
      headerTemplate: (key) => `<div>${key}</div>`,
    });
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("groups");
  });

  it("should have an onAfterScroll hook", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    expect(typeof plugin.hooks?.onAfterScroll).toBe("function");
  });

  it("should have a destroy method", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    expect(typeof plugin.destroy).toBe("function");
  });
});

// =============================================================================
// groups — Setup Tests
// =============================================================================

describe("groups — Setup", () => {
  it("should add grouped CSS class to root", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--grouped")).toBe(true);
    cleanup();
  });

  it("should register a destroy handler", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    const countBefore = destroyHandlers.length;
    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBeGreaterThan(countBefore);
    cleanup();
  });

  it("should replace the size config with a grouped size function", () => {
    let sizeConfigReplaced = false;
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);
    ctx.setSizeConfig = () => { sizeConfigReplaced = true; };

    plugin.setup!(ctx);

    expect(sizeConfigReplaced).toBe(true);
    cleanup();
  });

  it("should replace the virtual total function", () => {
    let virtualTotalReplaced = false;
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);
    ctx.setVirtualTotalFn = () => { virtualTotalReplaced = true; };

    plugin.setup!(ctx);

    expect(virtualTotalReplaced).toBe(true);
    cleanup();
  });

  it("should replace the render function via setRenderFn", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const mock = createPluginMockContext<TestItem>(items);

    expect(mock.renderFnReplaced).toBe(false);
    plugin.setup!(mock.ctx);
    expect(mock.renderFnReplaced).toBe(true);
    mock.cleanup();
  });

  it("should register getGroupLayout method", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(methods.has("getGroupLayout")).toBe(true);
    cleanup();
  });

  it("getGroupLayout method returns the layout object", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const getLayout = methods.get("getGroupLayout") as () => any;
    const layout = getLayout();
    expect(layout).toBeDefined();
    expect(typeof layout.totalEntries).toBe("number");
    expect(typeof layout.groupCount).toBe("number");
    cleanup();
  });

  it("should create a sticky header element when sticky is enabled", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "<span>Header</span>" },
      sticky: true,
    });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const stickyEl = dom.root.querySelector(".vlist-sticky-header");
    expect(stickyEl).not.toBeNull();
    cleanup();
  });

  it("should NOT create a sticky header element when sticky is disabled", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "<span>Header</span>" },
      sticky: false,
    });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const stickyEl = dom.root.querySelector(".vlist-sticky-header");
    expect(stickyEl).toBeNull();
    cleanup();
  });

  it("should set content size on the DOM after setup", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    // Trigger a render cycle
    ctx.forceRender();

    const height = parseInt(dom.content.style.height, 10);
    expect(height).toBeGreaterThan(0);
    cleanup();
  });

  it("should work with legacy headerHeight/headerTemplate config", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      headerHeight: 32,
      headerTemplate: (key) => `<div>${key}</div>`,
    });
    const items = createTestItems(30);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    expect(() => plugin.setup!(ctx)).not.toThrow();
    expect(dom.root.classList.contains("vlist--grouped")).toBe(true);
    cleanup();
  });

  it("should use header.width for horizontal layout", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { width: 48, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, {
      horizontal: true,
    });

    expect(() => plugin.setup!(ctx)).not.toThrow();
    cleanup();
  });
});

// =============================================================================
// groups — Render Function Tests
// =============================================================================

describe("groups — Render Functions", () => {
  it("ctx.renderIfNeeded calls groups render without throwing", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => ctx.renderIfNeeded()).not.toThrow();
    cleanup();
  });

  it("ctx.forceRender calls groups render without throwing", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => ctx.forceRender()).not.toThrow();
    cleanup();
  });

  it("forceRender re-renders even when scroll position has not changed", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstHeight = dom.content.style.height;
    ctx.forceRender();

    // Content size should remain set (render ran twice without error)
    expect(dom.content.style.height).toBe(firstHeight);
    cleanup();
  });

  it("render skips when containerSize is 0", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    engineState.containerSize = 0;
    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // With containerSize=0 the render bails early — content height stays unset
    expect(dom.content.style.height).toBe("");
    cleanup();
  });

  it("render skips when destroyed", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    engineState.destroyed = true;
    ctx.forceRender();

    // After destroyed flag is set, render is a no-op
    expect(dom.content.style.height).toBe("");
    cleanup();
  });
});

// =============================================================================
// groups — Layout Correctness
// =============================================================================

describe("groups — Layout", () => {
  it("layout.totalEntries equals items + number of groups", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : i < 20 ? "B" : "C"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    // 30 items spanning 3 groups → 30 + 3 = 33 layout entries
    const items = createTestItems(30);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    expect(layout.totalEntries).toBe(33);
    expect(layout.groupCount).toBe(3);
    cleanup();
  });

  it("layout entry 0 is a header for the first group", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    const entry0 = layout.getEntry(0);
    expect(entry0.type).toBe("header");
    expect(entry0.group.key).toBe("A");
    cleanup();
  });

  it("layout entry 1 is the first data item", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    const entry1 = layout.getEntry(1);
    expect(entry1.type).toBe("item");
    expect(entry1.dataIndex).toBe(0);
    cleanup();
  });

  it("layoutToDataIndex returns -1 for header entries", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    expect(layout.layoutToDataIndex(0)).toBe(-1); // header A
    expect(layout.layoutToDataIndex(11)).toBe(-1); // header B (index 11 = 1 + 10)
    cleanup();
  });

  it("layoutToDataIndex maps item layout indices to data indices", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    // Layout: [H(A)=0, D0=1, D1=2, ..., D9=10, H(B)=11, D10=12, ..., D19=21]
    expect(layout.layoutToDataIndex(1)).toBe(0);
    expect(layout.layoutToDataIndex(10)).toBe(9);
    expect(layout.layoutToDataIndex(12)).toBe(10);
    cleanup();
  });

  it("dataToLayoutIndex maps data indices to layout indices", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { height: 32, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    expect(layout.dataToLayoutIndex(0)).toBe(1);
    expect(layout.dataToLayoutIndex(9)).toBe(10);
    expect(layout.dataToLayoutIndex(10)).toBe(12); // after header B at index 11
    cleanup();
  });
});

// =============================================================================
// groups — onAfterScroll Hook
// =============================================================================

describe("groups — onAfterScroll Hook", () => {
  it("should update the sticky header on scroll when sticky is enabled", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "<span>Sticky</span>" },
      sticky: true,
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    // onAfterScroll should not throw when sticky header is active
    expect(() => plugin.hooks!.onAfterScroll!(100, 1)).not.toThrow();
    cleanup();
  });

  it("should not throw on scroll when sticky is disabled", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "<span>Sticky</span>" },
      sticky: false,
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    expect(() => plugin.hooks!.onAfterScroll!(100, 1)).not.toThrow();
    cleanup();
  });

  it("should not throw on scroll before setup", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });

    // onAfterScroll before setup — stickyHeader is null
    expect(() => plugin.hooks!.onAfterScroll!(0, 0)).not.toThrow();
  });
});

// =============================================================================
// groups — Destroy
// =============================================================================

describe("groups — Destroy", () => {
  it("should run destroy handler registered via ctx without error", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    for (const handler of destroyHandlers) {
      expect(() => handler()).not.toThrow();
    }
    cleanup();
  });

  it("should remove grouped CSS class via destroy handler", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(dom.root.classList.contains("vlist--grouped")).toBe(true);

    for (const handler of destroyHandlers) {
      handler();
    }
    expect(dom.root.classList.contains("vlist--grouped")).toBe(false);
    cleanup();
  });

  it("should remove sticky header element via destroy handler", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    const items = createTestItems(20);
    const { ctx, dom, destroyHandlers, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(dom.root.querySelector(".vlist-sticky-header")).not.toBeNull();

    for (const handler of destroyHandlers) {
      handler();
    }
    // Sticky header element should be removed after destroy
    expect(dom.root.querySelector(".vlist-sticky-header")).toBeNull();
    cleanup();
  });

  it("plugin.destroy() cleans up sticky header without error", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(() => plugin.destroy!()).not.toThrow();
    cleanup();
  });

  it("plugin.destroy() is safe to call without setup", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });

    expect(() => plugin.destroy!()).not.toThrow();
  });

  it("plugin.destroy() is safe to call multiple times", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
      sticky: true,
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    expect(() => {
      plugin.destroy!();
      plugin.destroy!();
    }).not.toThrow();
    cleanup();
  });
});

// =============================================================================
// groups — Edge Cases
// =============================================================================

describe("groups — Edge Cases", () => {
  it("should handle empty items list without error", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: () => "A",
      header: { height: 40, template: () => "Header" },
    });
    const { ctx, cleanup } = createPluginMockContext<TestItem>([]);

    expect(() => plugin.setup!(ctx)).not.toThrow();
    cleanup();
  });

  it("should handle all items in the same group", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: () => "SINGLE",
      header: { height: 40, template: (key) => `<div>${key}</div>` },
    });
    const items = createTestItems(20);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    expect(layout.groupCount).toBe(1);
    expect(layout.totalEntries).toBe(21); // 20 items + 1 header
    cleanup();
  });

  it("should handle one item per group", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => `Group${i}`,
      header: { height: 32, template: (key) => `<h3>${key}</h3>` },
    });
    const items = createTestItems(5);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const layout = (methods.get("getGroupLayout") as () => any)();
    expect(layout.groupCount).toBe(5);
    expect(layout.totalEntries).toBe(10); // 5 items + 5 headers
    cleanup();
  });

  it("should render items into the content element on forceRender", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    // Some items should have been rendered into the content element
    const rendered = dom.content.querySelectorAll("[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
    cleanup();
  });

  it("rendered elements have data-index and data-id attributes", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const elements = dom.content.querySelectorAll("[data-index]");
    for (const el of Array.from(elements)) {
      expect(el.getAttribute("data-index")).not.toBeNull();
      expect(el.getAttribute("data-id")).not.toBeNull();
    }
    cleanup();
  });

  it("header items in rendered output have group header id format", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    // First rendered element (layout index 0) is a group header
    const firstEl = dom.content.querySelector("[data-index='0']");
    expect(firstEl).not.toBeNull();
    expect(firstEl!.getAttribute("data-id")).toMatch(/^__group_header_/);
    cleanup();
  });

  it("should work with a function-based header height", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: {
        height: (key: string, groupIndex: number) => (groupIndex === 0 ? 48 : 32),
        template: (key) => `<div>${key}</div>`,
      },
    });
    const items = createTestItems(20);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items);

    expect(() => plugin.setup!(ctx)).not.toThrow();
    cleanup();
  });

  it("should use classPrefix from config for CSS class names", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
      header: { height: 40, template: () => "Header" },
    });
    const items = createTestItems(20);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      classPrefix: "mylist",
    });

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("mylist--grouped")).toBe(true);
    cleanup();
  });
});
