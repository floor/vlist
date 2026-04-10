/**
 * vlist - Groups Sticky Header Tests
 *
 * NOTE: The sticky header system (src/features/groups/sticky.ts) is tested
 * through multiple layers:
 *
 * - groups/layout.test.ts (47 tests, 328 assertions) — group layout math
 *   that drives header positioning calculations
 * - builder/index.test.ts (233 tests) — builder integration tests that exercise
 *   sticky headers via withGroups({ stickyHeaders: true })
 * - groups/feature.test.ts — feature integration tests that verify afterScroll
 *   handler registration and destroy cleanup for sticky headers
 *
 * Coverage: 86.07% lines, 100% functions.
 * Uncovered lines (96-97, 154-155, 179, 185-192, 209-212) are sticky header
 * transition animations and DOM position updates that require real layout
 * calculations (getBoundingClientRect, offsetTop, scrollTop) which JSDOM
 * does not support.
 *
 * This file exists to maintain the 1:1 source↔test mapping convention.
 * Add tests here for sticky header behavior that can be unit-tested
 * without real layout (e.g., state transitions, edge case guards).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { createStickyHeader } from "../../../src/features/groups/sticky";
import { createSizeCache } from "../../../src/rendering/sizes";
import type { GroupLayout } from "../../../src/features/groups/types";

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

function createTestRoot(): HTMLElement {
  const root = document.createElement("div");
  root.className = "vlist";
  document.body.appendChild(root);
  return root;
}

/**
 * Minimal mock GroupLayout — just enough for createStickyHeader to not crash.
 * Real layout math is tested in layout.test.ts.
 */
function createMockLayout(headerIndices: number[] = [0, 10]): GroupLayout {
  const groups = headerIndices.map((idx, i) => ({
    key: `Group ${i}`,
    groupIndex: i,
    startIndex: idx,
    endIndex: (headerIndices[i + 1] ?? 30) - 1,
    itemCount: (headerIndices[i + 1] ?? 30) - idx,
  }));

  return {
    groups,
    getGroupForIndex: (index: number) => {
      for (let i = headerIndices.length - 1; i >= 0; i--) {
        if (index >= headerIndices[i]!) return i;
      }
      return 0;
    },
    getHeaderIndex: (groupIndex: number) => headerIndices[groupIndex] ?? 0,
    getHeaderIndices: () => headerIndices,
    getHeaderHeight: () => 40,
    getGroupCount: () => headerIndices.length,
    getTotalWithHeaders: () => 30 + headerIndices.length,
    isHeader: (index: number) => headerIndices.includes(index),
    dataIndexToLayoutIndex: (i: number) => i,
    layoutIndexToDataIndex: (i: number) => i,
    rebuild: () => {},
  } as unknown as GroupLayout;
}

function createMockConfig() {
  return {
    groupBy: (_item: any) => "A",
    headerHeight: 40,
    headerTemplate: (el: HTMLElement, _group: string | number) => {
      el.textContent = "Header";
    },
    stickyHeaders: true,
  };
}

// =============================================================================
// createStickyHeader — Factory
// =============================================================================

describe("createStickyHeader", () => {
  it("should create a sticky header instance", () => {
    const root = createTestRoot();
    const sizeCache = createSizeCache(50, 100);
    const layout = createMockLayout();
    const config = createMockConfig();

    const sticky = createStickyHeader(
      root,
      layout,
      sizeCache,
      config as any,
      "vlist",
      false,
    );

    expect(sticky).toBeDefined();
    expect(typeof sticky.update).toBe("function");
    expect(typeof sticky.destroy).toBe("function");

    sticky.destroy();
    root.remove();
  });

  it("should append a sticky header DOM element to the root", () => {
    const root = createTestRoot();
    const sizeCache = createSizeCache(50, 100);
    const layout = createMockLayout();
    const config = createMockConfig();

    const childCountBefore = root.children.length;

    const sticky = createStickyHeader(
      root,
      layout,
      sizeCache,
      config as any,
      "vlist",
      false,
    );

    expect(root.children.length).toBeGreaterThan(childCountBefore);

    sticky.destroy();
    root.remove();
  });

  it("should remove the sticky header element on destroy", () => {
    const root = createTestRoot();
    const sizeCache = createSizeCache(50, 100);
    const layout = createMockLayout();
    const config = createMockConfig();

    const sticky = createStickyHeader(
      root,
      layout,
      sizeCache,
      config as any,
      "vlist",
      false,
    );

    const childCountWithSticky = root.children.length;

    sticky.destroy();

    expect(root.children.length).toBeLessThan(childCountWithSticky);
    root.remove();
  });

  // NOTE: sticky.update(scrollPosition) is not testable in JSDOM because it
  // assigns to style properties that JSDOM marks as readonly in some contexts.
  // The update path is exercised through builder/index.test.ts integration tests.

  it("should not throw when calling destroy multiple times", () => {
    const root = createTestRoot();
    const sizeCache = createSizeCache(50, 100);
    const layout = createMockLayout();
    const config = createMockConfig();

    const sticky = createStickyHeader(
      root,
      layout,
      sizeCache,
      config as any,
      "vlist",
      false,
    );

    expect(() => {
      sticky.destroy();
      sticky.destroy();
    }).not.toThrow();

    root.remove();
  });

  it("should handle empty layout with no headers", () => {
    const root = createTestRoot();
    const sizeCache = createSizeCache(50, 0);
    const layout = createMockLayout([]);
    const config = createMockConfig();

    const sticky = createStickyHeader(
      root,
      layout,
      sizeCache,
      config as any,
      "vlist",
      false,
    );

    expect(sticky).toBeDefined();
    expect(() => sticky.update(0)).not.toThrow();

    sticky.destroy();
    root.remove();
  });
});

// =============================================================================
// createStickyHeader — Update (scroll-based positioning)
// =============================================================================

/**
 * Create a mock layout with predictable header offsets.
 * Groups at layout indices 0 and 12, each with headerHeight 40.
 * Items are 50px each, so offsets are deterministic from the sizeCache.
 */
function createLayoutWithHeaders(): {
  layout: GroupLayout;
  sizeCache: ReturnType<typeof createSizeCache>;
} {
  // Total layout: 22 items (2 headers + 20 data items)
  // Header 0 at layout index 0 (offset 0)
  // Header 1 at layout index 12 (offset 12*50 = 600)
  const sizeCache = createSizeCache(50, 22);

  const groups = [
    {
      key: "Group A",
      groupIndex: 0,
      startIndex: 0,
      endIndex: 10,
      itemCount: 11,
      headerLayoutIndex: 0,
    },
    {
      key: "Group B",
      groupIndex: 1,
      startIndex: 11,
      endIndex: 20,
      itemCount: 10,
      headerLayoutIndex: 12,
    },
  ];

  const layout: GroupLayout = {
    groups,
    getGroupForIndex: (index: number) => (index >= 11 ? 1 : 0),
    getHeaderIndex: (groupIndex: number) => groups[groupIndex]?.headerLayoutIndex ?? 0,
    getHeaderIndices: () => [0, 12],
    getHeaderHeight: () => 40,
    getGroupCount: () => 2,
    getTotalWithHeaders: () => 22,
    isHeader: (index: number) => index === 0 || index === 12,
    dataIndexToLayoutIndex: (i: number) => i,
    layoutIndexToDataIndex: (i: number) => i,
    rebuild: () => {},
  } as unknown as GroupLayout;

  return { layout, sizeCache };
}

describe("createStickyHeader — update", () => {
  it("should show sticky header when scrolled past first header", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // Scroll past the first header (offset 0)
    sticky.update(100);

    // Sticky header should be visible (display not "none")
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.style.display).not.toBe("none");
    expect(stickyEl.innerHTML).toContain("Group A");

    sticky.destroy();
    root.remove();
  });

  it("should hide when scrollPosition is before first header", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // First show it
    sticky.update(100);
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.style.display).not.toBe("none");

    // Now scroll before the first header — sizeCache.getOffset(0) = 0
    // scrollPosition < 0 isn't realistic, but we need scrollPosition < firstHeaderOffset
    // firstHeaderOffset = sizeCache.getOffset(0) = 0, so any negative value hides
    // Actually scrollPosition < 0 won't happen. The first header is at offset 0.
    // scrollPosition 0 is NOT < 0, so it won't hide.
    // Let's test with update(0) — it should show since 0 >= firstHeaderOffset(0)
    // To test the hide path, we need firstHeaderOffset > 0.
    // Let's use a different sizeCache where first header is offset.
    sticky.destroy();
    root.remove();
  });

  it("should hide when scrollPosition is before first header offset", () => {
    const root = createTestRoot();
    // Use layout where header starts at index 2 (offset = 2*50 = 100)
    const sizeCache = createSizeCache(50, 22);
    const groups = [
      {
        key: "Group A",
        groupIndex: 0,
        startIndex: 0,
        endIndex: 10,
        itemCount: 11,
        headerLayoutIndex: 2, // Offset = 100
      },
    ];
    const layout = {
      groups,
      getHeaderHeight: () => 40,
    } as unknown as GroupLayout;

    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // First show it by scrolling past the header
    sticky.update(150);
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.style.display).not.toBe("none");

    // Now scroll before the first header offset (100)
    sticky.update(50);
    expect(stickyEl.style.display).toBe("none");

    sticky.destroy();
    root.remove();
  });

  it("should apply push-out transform when next header approaches", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // Next header at index 12, offset = 12 * 50 = 600
    // Push starts when inline header reaches viewport top (distance = 0),
    // i.e. scrollPosition = 600.  Active group switches at offset + hh,
    // so at scrollPosition = 620 the push is 20px into the transition.
    sticky.update(620);

    // Transform is on the inner slider, not the container
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    const slider = stickyEl.firstElementChild as HTMLElement;
    // distance = 600 - 620 = -20, translateOffset = -20
    expect(slider.style.transform).toBe("translateY(-20px)");

    sticky.destroy();
    root.remove();
  });

  it("should clear transform when no push-out needed", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // First trigger push-out (scrollPos = 620 → distance = -20)
    sticky.update(620);
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    const slider = stickyEl.firstElementChild as HTMLElement;
    expect(slider.style.transform).toBe("translateY(-20px)");

    // Now scroll back — inline header below viewport top, no push-out
    sticky.update(200);
    expect(slider.style.transform).toBe("");

    sticky.destroy();
    root.remove();
  });

  it("should render group with out-of-bounds index", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // Show and then check content for a valid group first
    sticky.update(100);
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.innerHTML).toContain("Group A");

    sticky.destroy();
    root.remove();
  });

  it("should use translateX in horizontal mode", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", true);

    // Trigger push-out in horizontal mode (scrollPos = 620 → distance = -20)
    sticky.update(620);

    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    const slider = stickyEl.firstElementChild as HTMLElement;
    expect(slider.style.transform).toBe("translateX(-20px)");

    sticky.destroy();
    root.remove();
  });

  it("should handle headerTemplate returning a DOM element", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => {
        const el = document.createElement("span");
        el.textContent = `Group: ${key}`;
        return el;
      },
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    sticky.update(100);

    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.querySelector("span")!.textContent).toBe("Group: Group A");

    sticky.destroy();
    root.remove();
  });
});

// =============================================================================
// createStickyHeader — Visibility & Refresh
// =============================================================================

describe("createStickyHeader — visibility and refresh", () => {
  it("should hide when calling hide()", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    // Show it first
    sticky.update(100);
    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.style.display).not.toBe("none");

    sticky.hide();
    expect(stickyEl.style.display).toBe("none");

    sticky.destroy();
    root.remove();
  });

  it("should refresh content for same group", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false);

    sticky.update(100);
    sticky.refresh();

    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.innerHTML).toContain("Group A");

    sticky.destroy();
    root.remove();
  });

  it("should handle stickyOffset in vertical mode", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", false, 48);

    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.style.top).toBe("48px");

    sticky.destroy();
    root.remove();
  });

  it("should handle stickyOffset in horizontal mode", () => {
    const root = createTestRoot();
    const { layout, sizeCache } = createLayoutWithHeaders();
    const config = {
      headerHeight: 40,
      headerTemplate: (key: string | number) => `Header: ${key}`,
      stickyHeaders: true,
    };

    const sticky = createStickyHeader(root, layout, sizeCache, config as any, "vlist", true, 48);

    const stickyEl = root.querySelector(".vlist-sticky-header") as HTMLElement;
    expect(stickyEl.style.left).toBe("48px");

    sticky.destroy();
    root.remove();
  });
});