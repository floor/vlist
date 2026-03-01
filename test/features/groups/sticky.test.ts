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