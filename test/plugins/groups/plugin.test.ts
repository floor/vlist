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
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { groups } from "../../../src/plugins/groups/plugin";
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
      isX: true,
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

  it("data items have id, aria-posinset, aria-setsize when selection plugin present", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    ctx.registerMethod("_getSelectedIds", () => new Set());
    plugin.setup!(ctx);
    ctx.forceRender();

    const dataItems = Array.from(dom.content.querySelectorAll('[role="option"]'));
    expect(dataItems.length).toBeGreaterThan(0);

    for (const el of dataItems) {
      expect(el.id).toMatch(/^vlist-item-\d+$/);
      expect(el.getAttribute("aria-posinset")).not.toBeNull();
      expect(el.getAttribute("aria-setsize")).toBe("10");
    }
    cleanup();
  });

  it("data items do not have id or aria attributes when no selection plugin", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const dataItems = Array.from(dom.content.querySelectorAll('[role="listitem"]'));
    expect(dataItems.length).toBeGreaterThan(0);

    for (const el of dataItems) {
      expect(el.id).toBe("");
      expect(el.getAttribute("aria-posinset")).toBeNull();
      expect(el.getAttribute("aria-setsize")).toBeNull();
    }
    cleanup();
  });

  it("group headers do not have id or aria-posinset", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    ctx.registerMethod("_getSelectedIds", () => new Set());
    plugin.setup!(ctx);
    ctx.forceRender();

    const headers = Array.from(dom.content.querySelectorAll('[role="presentation"]'));
    expect(headers.length).toBeGreaterThan(0);

    for (const el of headers) {
      expect(el.id).toBe("");
      expect(el.getAttribute("aria-posinset")).toBeNull();
      expect(el.getAttribute("aria-setsize")).toBeNull();
    }
    cleanup();
  });
});

// =============================================================================
// groups — Registered Methods
// =============================================================================

describe("groups — Registered Methods", () => {
  it("registers _dataToLayoutIndex that maps data indices to layout indices", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const d2l = methods.get("_dataToLayoutIndex") as (i: number) => number;
    expect(d2l).toBeDefined();
    // Layout: [hdrA, item0..item4, hdrB, item5..item9]
    expect(d2l(0)).toBe(1); // first item after header A
    expect(d2l(5)).toBe(7); // first item after header B
    cleanup();
  });

  it("registers _layoutToDataIndex that maps layout indices to data indices", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const l2d = methods.get("_layoutToDataIndex") as (i: number) => number;
    expect(l2d).toBeDefined();
    expect(l2d(0)).toBe(-1); // header A
    expect(l2d(1)).toBe(0);  // first data item
    expect(l2d(6)).toBe(-1); // header B
    cleanup();
  });

  it("registers _getRenderedElement that returns rendered elements by layout index", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const getEl = methods.get("_getRenderedElement") as (i: number) => HTMLElement | null;
    expect(getEl).toBeDefined();
    expect(getEl(0)).not.toBeNull(); // header A should be rendered
    expect(getEl(1)).not.toBeNull(); // first data item should be rendered
    expect(getEl(999)).toBeNull();   // out of range
    cleanup();
  });

  it("registers _isGroupHeader that identifies header layout indices", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    });
    const items = createTestItems(10);
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);

    const isHeader = methods.get("_isGroupHeader") as (i: number) => boolean;
    expect(isHeader).toBeDefined();
    expect(isHeader(0)).toBe(true);  // header A
    expect(isHeader(1)).toBe(false); // data item
    expect(isHeader(6)).toBe(true);  // header B
    cleanup();
  });
});

// =============================================================================
// groups — scrollToIndex
// =============================================================================

describe("groups — scrollToIndex", () => {
  const makePlugin = () => groups<TestItem>({
    getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
    header: { height: 32, template: (key) => `<h2>${key}</h2>` },
    sticky: false,
  });

  it("scrolls to start of a data item by default", () => {
    const plugin = makePlugin();
    const items = createTestItems(10);
    const { ctx, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 200,
    });

    plugin.setup!(ctx);

    const scrollToIndex = ctx.getMethod("scrollToIndex") as Function;
    scrollToIndex(0); // data index 0 → layout index 1
    // Mock sizeCache: each entry is 50px, so layout index 1 offset = 50
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]).toBe(50);
    cleanup();
  });

  it("scrolls to center of a data item", () => {
    const plugin = makePlugin();
    const items = createTestItems(10);
    const { ctx, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 200,
    });

    plugin.setup!(ctx);

    const scrollToIndex = ctx.getMethod("scrollToIndex") as Function;
    scrollToIndex(0, "center");
    // offset=32, itemSize=50, container=200 → 32 - (200-50)/2 = 32-75 = -43 → clamped to 0
    expect(scrollCalls[0]).toBe(0);
    cleanup();
  });

  it("scrolls to end alignment", () => {
    const plugin = makePlugin();
    const items = createTestItems(10);
    const { ctx, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 200,
    });

    plugin.setup!(ctx);

    const scrollToIndex = ctx.getMethod("scrollToIndex") as Function;
    scrollToIndex(5); // data index 5, first item of group B
    const pos = scrollCalls[0]!;
    expect(pos).toBeGreaterThan(0);

    scrollCalls.length = 0;
    scrollToIndex(5, "end");
    // end alignment: offset - containerSize + itemSize
    expect(scrollCalls[0]).not.toBe(pos);
    cleanup();
  });

  it("scrolls with object options including smooth", () => {
    const plugin = makePlugin();
    const items = createTestItems(10);
    const { ctx, scrollCalls, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 200,
    });

    plugin.setup!(ctx);

    const scrollToIndex = ctx.getMethod("scrollToIndex") as Function;
    scrollToIndex(3, { align: "start", behavior: "smooth", duration: 300 });
    expect(scrollCalls.length).toBe(1);
    cleanup();
  });
});

// =============================================================================
// groups — Horizontal Mode
// =============================================================================

describe("groups — Horizontal Mode", () => {
  it("uses horizontal transforms and size styles", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { width: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      isX: true,
      itemSize: 80,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const firstItem = dom.content.querySelector('[role="listitem"]') as HTMLElement;
    expect(firstItem).not.toBeNull();
    expect(firstItem.style.transform).toContain("translate(");
    expect(firstItem.style.width).toBeTruthy();
    cleanup();
  });
});

// =============================================================================
// groups — Render Lifecycle
// =============================================================================

describe("groups — Render Lifecycle", () => {
  it("clears rendered elements when containerSize becomes zero", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();
    expect(dom.content.children.length).toBeGreaterThan(0);

    engineState.containerSize = 0;
    ctx.forceRender();
    expect(dom.content.children.length).toBe(0);
    cleanup();
  });

  it("recycles elements outside the visible range on scroll", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(30);
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 200,
      overscan: 1,
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const initialCount = dom.content.children.length;
    expect(initialCount).toBeGreaterThan(0);

    // Scroll far down — old elements should be recycled
    engineState.scrollPosition = 1000;
    ctx.renderIfNeeded();

    const afterScrollCount = dom.content.children.length;
    expect(afterScrollCount).toBeGreaterThan(0);
    cleanup();
  });

  it("skips render when scroll position and container size unchanged", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const countAfterFirst = dom.content.children.length;

    // Second render with same state — should be a no-op
    ctx.renderIfNeeded();
    expect(dom.content.children.length).toBe(countAfterFirst);
    cleanup();
  });

  it("updates ARIA attributes when element is reused at a different layout index", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 200,
      overscan: 0,
    });

    ctx.registerMethod("_getSelectedIds", () => new Set());
    plugin.setup!(ctx);
    ctx.forceRender();

    // Record initial state
    const firstOption = dom.content.querySelector('[role="option"]') as HTMLElement;
    expect(firstOption).not.toBeNull();
    const initialPosinset = firstOption.getAttribute("aria-posinset");

    // Scroll to trigger re-render with different items in view
    engineState.scrollPosition = 400;
    ctx.forceRender();

    // Items should still have valid ARIA attributes
    const options = Array.from(dom.content.querySelectorAll('[role="option"]'));
    for (const el of options) {
      expect(el.getAttribute("aria-posinset")).not.toBeNull();
      expect(el.getAttribute("aria-setsize")).toBe("10");
    }
    cleanup();
  });

  it("rebuilds layout when totalItems changes between renders", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();
    const firstCount = dom.content.children.length;

    // Add more items and re-render
    for (let i = 10; i < 20; i++) {
      items.push({ id: i, name: `Item ${i}`, category: "C" });
    }
    engineState.totalItems = items.length;
    ctx.forceRender();

    // Should have re-rendered (layout rebuilds on totalItems change)
    expect(dom.content.children.length).toBeGreaterThan(0);
    cleanup();
  });

  it("handles template returning HTMLElement instead of string", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items, {
      template: (item: TestItem) => {
        const el = document.createElement("span");
        el.textContent = item.name;
        return el as unknown as string;
      },
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const option = dom.content.querySelector('[role="listitem"]') as HTMLElement;
    expect(option).not.toBeNull();
    expect(option.querySelector("span")).not.toBeNull();
    cleanup();
  });

  it("adds placeholder class to items that are placeholders", () => {
    const placeholderItems: TestItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      category: i < 5 ? "A" : "B",
      _isPlaceholder: true,
    } as TestItem));

    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(placeholderItems);

    plugin.setup!(ctx);
    ctx.forceRender();

    const placeholders = dom.content.querySelectorAll(".vlist-item--placeholder");
    expect(placeholders.length).toBeGreaterThan(0);
    cleanup();
  });

  it("applies selection state classes when itemStateFn is set", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    // Register an itemStateFn that marks index 1 as selected
    ctx.setItemStateFn((layoutIndex: number, state) => {
      state.selected = layoutIndex === 1;
      state.focused = layoutIndex === 2;
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const selectedEls = dom.content.querySelectorAll(".vlist-item--selected");
    expect(selectedEls.length).toBe(1);
    expect(selectedEls[0]!.getAttribute("aria-selected")).toBe("true");

    const focusedEls = dom.content.querySelectorAll(".vlist-item--focused");
    expect(focusedEls.length).toBe(1);
    cleanup();
  });

  it("removes aria-selected from non-selected items", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    ctx.setItemStateFn((_layoutIndex: number, state) => {
      state.selected = false;
      state.focused = false;
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    const items_els = dom.content.querySelectorAll('[role="listitem"]');
    expect(items_els.length).toBeGreaterThan(0);
    for (const el of Array.from(items_els)) {
      expect(el.getAttribute("aria-selected")).toBeNull();
    }
    cleanup();
  });
});

// =============================================================================
// groups — Placeholder → Real Data Transition
// =============================================================================

describe("groups — Placeholder → Real Data Transition", () => {
  it("replaces placeholder content when real data arrives on forceRender", () => {
    // Placeholders use temporary IDs; when real data arrives, the item gets a new ID
    const items: TestItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `__placeholder_${i}` as unknown as number,
      name: "",
      category: i < 5 ? "A" : "B",
      _isPlaceholder: true,
    } as TestItem));

    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const placeholdersBefore = dom.content.querySelectorAll(".vlist-item--placeholder").length;
    expect(placeholdersBefore).toBeGreaterThan(0);

    // Replace placeholders with real items (different IDs)
    for (let i = 0; i < 10; i++) {
      items[i] = { id: i, name: `Item ${i}`, category: i < 5 ? "A" : "B" };
    }

    ctx.forceRender();

    const placeholdersAfter = dom.content.querySelectorAll(".vlist-item--placeholder").length;
    expect(placeholdersAfter).toBe(0);
    cleanup();
  });
});

// =============================================================================
// groups — Null Item Handling
// =============================================================================

describe("groups — Null Item Handling", () => {
  it("handles getItem returning undefined gracefully", () => {
    const items = createTestItems(10);
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    // Override getItem to return undefined for some indices
    ctx.setGetItemFn((index: number) => {
      if (index >= 5) return undefined;
      return items[index];
    });

    plugin.setup!(ctx);
    ctx.forceRender();

    // Should still render without errors
    expect(dom.content.children.length).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// groups — Range Early Exit
// =============================================================================

describe("groups — Range Early Exit", () => {
  it("skips re-render when range is unchanged and no render pending", () => {
    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 5 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const items = createTestItems(10);
    const { ctx, dom, cleanup } = createPluginMockContext<TestItem>(items);

    plugin.setup!(ctx);
    ctx.forceRender();

    const count1 = dom.content.children.length;

    // renderIfNeeded with same scroll position — should hit the range-unchanged early exit
    ctx.renderIfNeeded();
    ctx.renderIfNeeded();

    expect(dom.content.children.length).toBe(count1);
    cleanup();
  });
});

// =============================================================================
// groups — forceRender with async data
// =============================================================================

describe("groups — forceRender with async data", () => {
  it("rebuilds layout when loaded count changes and boundaries shift", () => {
    let loadedCount = 0;
    const items: TestItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      category: "A",
    }));

    const plugin = groups<TestItem>({
      getGroupForIndex: () => "A",
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const { ctx, methods, dom, cleanup } = createPluginMockContext<TestItem>(items);

    // Register _getLoadedCount so forceRender's boundary check runs
    methods.set("_getLoadedCount", () => loadedCount);

    plugin.setup!(ctx);
    ctx.forceRender();
    expect(dom.content.children.length).toBeGreaterThan(0);

    // Simulate async data arriving
    loadedCount = 5;
    ctx.forceRender();
    expect(dom.content.children.length).toBeGreaterThan(0);
    cleanup();
  });

  it("detaches elements when boundary shift is within rendered range", () => {
    let loadedCount = 0;
    const items: TestItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      category: i < 10 ? "A" : "B",
    }));

    const plugin = groups<TestItem>({
      getGroupForIndex: (i) => (i < 10 ? "A" : "B"),
      header: { height: 32, template: (key) => `<h2>${key}</h2>` },
      sticky: false,
    });
    const { ctx, methods, dom, engineState, cleanup } = createPluginMockContext<TestItem>(items);

    methods.set("_getLoadedCount", () => loadedCount);
    methods.set("_getLoadedItem", (i: number) => items[i]);

    plugin.setup!(ctx);
    ctx.forceRender();
    const initialCount = dom.content.children.length;

    // Change grouping so boundaries shift within rendered range
    loadedCount = 10;
    items[4]!.category = "B";
    ctx.forceRender();

    expect(dom.content.children.length).toBeGreaterThan(0);
    cleanup();
  });
});
