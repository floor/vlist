/**
 * vlist.ts Entry Point Coverage Tests
 * Tests for the vlist entry point that auto-applies plugins based on config
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { JSDOM } from "jsdom";
import { createVList } from "../src/vlist";
import type { VListConfig, VListItem } from "../src/types";

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
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;

  let rafId = 0;
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    rafId++;
    setTimeout(() => cb(performance.now()), 0);
    return rafId;
  };
  global.cancelAnimationFrame = () => {};
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
  group?: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));

const createGroupedItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    group: i < count / 2 ? "Group A" : "Group B",
  }));

const template = (item: TestItem) => `<div>${item.name}</div>`;

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
  document.body.appendChild(container);
});

afterEach(() => {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
});

// =============================================================================
// Tests
// =============================================================================

describe("vlist entry point", () => {
  describe("plugin auto-application", () => {
    it("should auto-apply compression and snapshots plugins by default", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
      });

      // Compression and snapshots should be applied
      expect(list.getScrollSnapshot).toBeDefined();
      expect(list.restoreScroll).toBeDefined();

      list.destroy();
    });

    it("should auto-apply grid plugin when layout='grid'", () => {
      const list = createVList({
        container,
        item: { height: 100, template },
        items: createTestItems(20),
        layout: "grid",
        grid: { columns: 4 },
      });

      expect(list.element.classList.contains("vlist--grid")).toBe(true);
      expect(list.total).toBe(20); // Should return flat item count

      list.destroy();
    });

    it("should auto-apply groups plugin when groups config provided", () => {
      const items = createGroupedItems(12);
      const list = createVList({
        container,
        item: { height: 40, template },
        items,
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: 30,
          headerTemplate: (group) => `<div>${group}</div>`,
        },
      });

      expect(list.element.classList.contains("vlist--grouped")).toBe(true);
      expect(list.total).toBe(12); // Should return original items count

      list.destroy();
    });

    it("should auto-apply selection plugin with mode='none' for backwards compatibility", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
        // No selection config - should still get stub methods
      });

      expect((list as any).select).toBeDefined();
      expect((list as any).getSelected).toBeDefined();
      expect((list as any).getSelected()).toEqual([]);

      list.destroy();
    });

    it("should auto-apply selection plugin with specified mode", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
        selection: { mode: "single" },
      });

      expect((list as any).select).toBeDefined();
      expect((list as any).getSelected).toBeDefined();

      list.destroy();
    });

    it("should auto-apply scrollbar plugin by default", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(100),
      });

      // Scrollbar should be created
      const scrollbar = list.element.querySelector(".vlist-scrollbar");
      expect(scrollbar).toBeDefined();

      list.destroy();
    });

    it("should skip scrollbar when scrollbar='none'", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(100),
        scrollbar: "none",
      });

      // Scrollbar should not be created
      const scrollbar = list.element.querySelector(".vlist-scrollbar");
      expect(scrollbar).toBeNull();

      list.destroy();
    });
  });

  describe("update() method", () => {
    it("should have update() method for backwards compatibility", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
      });

      expect((list as any).update).toBeDefined();
      expect(typeof (list as any).update).toBe("function");

      list.destroy();
    });

    it("should update grid config via updateGrid", () => {
      const list = createVList({
        container,
        item: { height: 100, template },
        items: createTestItems(20),
        layout: "grid",
        grid: { columns: 4 },
      });

      // Update grid columns
      (list as any).update({ grid: { columns: 3 } });

      // Grid should be updated
      expect(list).toBeDefined();

      list.destroy();
    });

    it("should update selection mode via setSelectionMode", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
        selection: { mode: "single" },
      });

      // Update selection mode
      (list as any).update({ selectionMode: "multiple" });

      // Should not throw
      expect(list).toBeDefined();

      list.destroy();
    });

    it("should warn when updating itemHeight (not supported)", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
      });

      const consoleSpy = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      // Try to update itemHeight
      (list as any).update({ itemHeight: 50 });

      // Should have warned
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("itemHeight");
      expect(warnings[0]).toContain("not yet supported");

      console.warn = consoleSpy;
      list.destroy();
    });

    it("should warn when updating overscan (not supported)", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
      });

      const consoleSpy = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      // Try to update overscan
      (list as any).update({ overscan: 5 });

      // Should have warned
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("overscan");
      expect(warnings[0]).toContain("not yet supported");

      console.warn = consoleSpy;
      list.destroy();
    });

    it("should handle multiple update calls", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
        layout: "grid",
        grid: { columns: 4 },
        selection: { mode: "single" },
      });

      const consoleSpy = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      // Update grid
      (list as any).update({ grid: { columns: 3 } });

      // Update selection mode
      (list as any).update({ selectionMode: "multiple" });

      // Try unsupported updates
      (list as any).update({ itemHeight: 50, overscan: 5 });

      // Should have 2 warnings (itemHeight and overscan)
      expect(warnings.length).toBe(2);

      console.warn = consoleSpy;
      list.destroy();
    });
  });

  describe("plugin combinations", () => {
    it("should combine grid + groups for 2D grouped layouts", () => {
      const items = createGroupedItems(20);
      const list = createVList({
        container,
        item: { height: 80, template },
        items,
        layout: "grid",
        grid: { columns: 4, gap: 8 },
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: 30,
          headerTemplate: (group) => `<div>${group}</div>`,
          sticky: true,
        },
      });

      expect(list.element.classList.contains("vlist--grid")).toBe(true);
      expect(list.element.classList.contains("vlist--grouped")).toBe(true);
      expect(list.total).toBe(20); // Original items count

      list.destroy();
    });

    it("should combine grid + selection", () => {
      const list = createVList({
        container,
        item: { height: 80, template },
        items: createTestItems(20),
        layout: "grid",
        grid: { columns: 4 },
        selection: { mode: "multiple" },
      });

      expect(list.element.classList.contains("vlist--grid")).toBe(true);
      expect((list as any).select).toBeDefined();

      list.destroy();
    });

    it("should combine groups + selection + scrollbar", () => {
      const items = createGroupedItems(50);
      const list = createVList({
        container,
        item: { height: 40, template },
        items,
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: 30,
          headerTemplate: (group) => `<div>${group}</div>`,
        },
        selection: { mode: "single" },
        scrollbar: { autoHide: true },
      });

      expect(list.element.classList.contains("vlist--grouped")).toBe(true);
      expect((list as any).select).toBeDefined();
      expect(list.element.querySelector(".vlist-scrollbar")).toBeDefined();

      list.destroy();
    });
  });

  describe("scrollbar configuration", () => {
    it("should handle scrollbar as object config", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(100),
        scrollbar: { autoHide: true, trackColor: "#ccc" },
      });

      expect(list.element.querySelector(".vlist-scrollbar")).toBeDefined();

      list.destroy();
    });

    it("should handle scroll.scrollbar config", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(100),
        scroll: { scrollbar: { autoHide: false } },
      });

      expect(list.element.querySelector(".vlist-scrollbar")).toBeDefined();

      list.destroy();
    });
  });

  describe("groups config variations", () => {
    it("should handle groups with sticky option", () => {
      const items = createGroupedItems(20);
      const list = createVList({
        container,
        item: { height: 40, template },
        items,
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: 30,
          headerTemplate: (group) => `<div>${group}</div>`,
          sticky: true,
        },
      });

      expect(list.element.classList.contains("vlist--grouped")).toBe(true);

      list.destroy();
    });

    it("should handle groups without sticky option (default false)", () => {
      const items = createGroupedItems(20);
      const list = createVList({
        container,
        item: { height: 40, template },
        items,
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: 30,
          headerTemplate: (group) => `<div>${group}</div>`,
          // sticky not specified - should default to false
        },
      });

      expect(list.element.classList.contains("vlist--grouped")).toBe(true);

      list.destroy();
    });

    it("should handle groups with function-based headerHeight", () => {
      const items = createGroupedItems(20);
      const list = createVList({
        container,
        item: { height: 40, template },
        items,
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: (group: string) => (group === "Group A" ? 30 : 40),
          headerTemplate: (group) => `<div>${group}</div>`,
        },
      });

      expect(list.element.classList.contains("vlist--grouped")).toBe(true);

      list.destroy();
    });
  });

  describe("grid config variations", () => {
    it("should handle grid with gap", () => {
      const list = createVList({
        container,
        item: { height: 80, template },
        items: createTestItems(20),
        layout: "grid",
        grid: { columns: 4, gap: 16 },
      });

      expect(list.element.classList.contains("vlist--grid")).toBe(true);

      list.destroy();
    });

    it("should handle grid without gap (default 0)", () => {
      const list = createVList({
        container,
        item: { height: 80, template },
        items: createTestItems(20),
        layout: "grid",
        grid: { columns: 4 },
      });

      expect(list.element.classList.contains("vlist--grid")).toBe(true);

      list.destroy();
    });
  });

  describe("selection config variations", () => {
    it("should handle selection with initial items", () => {
      const items = createTestItems(20);
      const list = createVList({
        container,
        item: { height: 40, template },
        items,
        selection: { mode: "multiple", initial: [1, 2, 3] },
      });

      expect((list as any).getSelected()).toEqual([1, 2, 3]);

      list.destroy();
    });

    it("should handle selection without initial items", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(20),
        selection: { mode: "single" },
      });

      expect((list as any).getSelected()).toEqual([]);

      list.destroy();
    });
  });

  describe("backwards compatibility", () => {
    it("should maintain all API methods from plugins", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(20),
        selection: { mode: "single" },
      });

      // Data methods
      expect(list.setItems).toBeDefined();
      expect(list.appendItems).toBeDefined();
      expect(list.prependItems).toBeDefined();
      expect(list.updateItem).toBeDefined();
      expect(list.removeItem).toBeDefined();

      // Scroll methods
      expect(list.scrollToIndex).toBeDefined();
      expect(list.scrollToItem).toBeDefined();
      expect(list.getScrollPosition).toBeDefined();
      expect(list.cancelScroll).toBeDefined();

      // Selection methods
      expect((list as any).select).toBeDefined();
      expect((list as any).getSelected).toBeDefined();
      expect((list as any).clearSelection).toBeDefined();

      // Snapshot methods
      expect(list.getScrollSnapshot).toBeDefined();
      expect(list.restoreScroll).toBeDefined();

      // Event methods
      expect(list.on).toBeDefined();
      expect(list.off).toBeDefined();

      // Properties
      expect(list.element).toBeDefined();
      expect(list.items).toBeDefined();
      expect(list.total).toBeDefined();

      list.destroy();
    });

    it("should maintain getters after data mutations", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: createTestItems(10),
      });

      expect(list.total).toBe(10);
      expect(list.items.length).toBe(10);

      // Mutate data
      list.appendItems(createTestItems(5).map(item => ({ ...item, id: item.id + 10 })));

      // Getters should still work
      expect(list.total).toBe(15);
      expect(list.items.length).toBe(15);

      list.destroy();
    });
  });

  describe("edge cases", () => {
    it("should handle empty items array", () => {
      const list = createVList({
        container,
        item: { height: 40, template },
        items: [],
      });

      expect(list.total).toBe(0);
      expect(list.items.length).toBe(0);

      list.destroy();
    });

    it("should handle all plugins together", () => {
      const items = createGroupedItems(50);
      const list = createVList({
        container,
        item: { height: 80, template },
        items,
        layout: "grid",
        grid: { columns: 3, gap: 8 },
        groups: {
          getGroupForIndex: (i) => items[i]!.group!,
          headerHeight: 30,
          headerTemplate: (group) => `<div>${group}</div>`,
          sticky: true,
        },
        selection: { mode: "multiple", initial: [1, 2] },
        scrollbar: { autoHide: true },
      });

      expect(list.element.classList.contains("vlist--grid")).toBe(true);
      expect(list.element.classList.contains("vlist--grouped")).toBe(true);
      expect((list as any).getSelected()).toEqual([1, 2]);
      expect(list.total).toBe(50);

      list.destroy();
    });
  });
});
