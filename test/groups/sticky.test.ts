/**
 * vlist - Sticky Header Tests
 * Tests for the sticky header manager that pins group headers
 * to the top of the viewport during scrolling.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";
import { createStickyHeader } from "../../src/groups/sticky";
import {
  createGroupLayout,
  createGroupedHeightFn,
} from "../../src/groups/layout";
import { createHeightCache } from "../../src/render/heights";
import type { GroupsConfig } from "../../src/groups/types";
import type { GroupLayout } from "../../src/groups/types";
import type { HeightCache } from "../../src/render/heights";

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
  dom.window.close();
});

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Build a groups config for a simple scenario:
 *   Group "A": items 0, 1, 2
 *   Group "B": items 3, 4
 *   Group "C": items 5
 *
 * Total data items: 6
 * Layout (with headers):
 *   [headerA, item0, item1, item2, headerB, item3, item4, headerC, item5]
 *   indices: 0       1      2      3       4       5      6       7       8
 */
const ITEM_HEIGHT = 40;
const HEADER_HEIGHT = 30;

const makeGroupsConfig = (
  templateFn?: (key: string, groupIndex: number) => string | HTMLElement,
): GroupsConfig => ({
  getGroupForIndex: (index: number): string => {
    if (index < 3) return "A";
    if (index < 5) return "B";
    return "C";
  },
  headerHeight: HEADER_HEIGHT,
  headerTemplate: templateFn ?? ((key: string) => `<div>Group ${key}</div>`),
  sticky: true,
});

/**
 * Create a layout height cache that accounts for group headers.
 * The grouped height function dispatches to header height or item height
 * based on whether the layout index is a header or an item.
 */
const createTestFixtures = (
  config?: GroupsConfig,
): {
  layout: GroupLayout;
  heightCache: HeightCache;
  config: GroupsConfig;
} => {
  const groupsConfig = config ?? makeGroupsConfig();
  const layout = createGroupLayout(6, groupsConfig);
  // Layout total: 6 items + 3 headers = 9 entries
  const groupedHeightFn = createGroupedHeightFn(layout, ITEM_HEIGHT);
  const heightCache = createHeightCache(groupedHeightFn, layout.totalEntries);

  return { layout, heightCache, config: groupsConfig };
};

const createRoot = (): HTMLElement => {
  const root = document.createElement("div");
  root.className = "vlist";
  root.style.position = "relative";
  document.body.appendChild(root);
  return root;
};

const cleanupRoot = (root: HTMLElement): void => {
  if (root.parentNode) {
    root.parentNode.removeChild(root);
  }
};

/**
 * Compute the pixel offset of each layout entry.
 *
 * Layout for the default fixture:
 *   Index 0: headerA  (offset 0,   height 30)
 *   Index 1: item0    (offset 30,  height 40)
 *   Index 2: item1    (offset 70,  height 40)
 *   Index 3: item2    (offset 110, height 40)
 *   Index 4: headerB  (offset 150, height 30)
 *   Index 5: item3    (offset 180, height 40)
 *   Index 6: item4    (offset 220, height 40)
 *   Index 7: headerC  (offset 260, height 30)
 *   Index 8: item5    (offset 290, height 40)
 *   Total height: 330
 */

// =============================================================================
// Tests
// =============================================================================

describe("createStickyHeader", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanupRoot(root);
  });

  // ===========================================================================
  // DOM Setup
  // ===========================================================================

  describe("DOM setup", () => {
    it("should create a sticky header element in the root", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header");
      expect(el).not.toBeNull();

      sticky.destroy();
    });

    it("should insert the sticky header as the first child of root", () => {
      // Add a child before creating sticky to verify insertion order
      const existingChild = document.createElement("div");
      existingChild.className = "vlist-viewport";
      root.appendChild(existingChild);

      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      expect(root.firstChild).toBe(root.querySelector(".vlist-sticky-header"));

      sticky.destroy();
    });

    it("should set correct accessibility attributes", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;
      expect(el.getAttribute("role")).toBe("presentation");
      expect(el.getAttribute("aria-hidden")).toBe("true");

      sticky.destroy();
    });

    it("should set correct positioning styles", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;
      expect(el.style.position).toBe("absolute");
      expect(el.style.top).toBe("0px");
      expect(el.style.left).toBe("0px");
      expect(el.style.right).toBe("0px");
      expect(el.style.zIndex).toBe("5");
      expect(el.style.pointerEvents).toBe("none");

      sticky.destroy();
    });

    it("should be hidden initially", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;
      expect(el.style.display).toBe("none");

      sticky.destroy();
    });

    it("should use custom class prefix", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "mylist",
      );

      const el = root.querySelector(".mylist-sticky-header");
      expect(el).not.toBeNull();

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Update (scroll position tracking)
  // ===========================================================================

  describe("update", () => {
    it("should show sticky header when scrolled past the first group header", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Scroll to 0 — first header is at offset 0, so scrollTop >= 0 shows it
      sticky.update(0);
      expect(el.style.display).toBe("");

      sticky.destroy();
    });

    it("should hide sticky header when scrolled before the first group header", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // First header is at offset 0; scrollTop < 0 is not realistic, but
      // if the first header were at offset > 0, scrolling before it hides the sticky.
      // For this layout, scrollTop 0 is exactly at the first header so it shows.
      sticky.update(0);
      expect(el.style.display).toBe("");

      sticky.destroy();
    });

    it("should render group A header when scrolled within group A items", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Scroll to 50 (within item0, which is in group A)
      sticky.update(50);

      expect(el.style.display).toBe("");
      expect(el.innerHTML).toContain("Group A");

      sticky.destroy();
    });

    it("should render group B header when scrolled into group B", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // headerB is at offset 150; scroll past it
      sticky.update(160);

      expect(el.style.display).toBe("");
      expect(el.innerHTML).toContain("Group B");

      sticky.destroy();
    });

    it("should render group C header when scrolled into group C", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // headerC is at offset 260; scroll past it
      sticky.update(270);

      expect(el.style.display).toBe("");
      expect(el.innerHTML).toContain("Group C");

      sticky.destroy();
    });

    it("should set the sticky header height to match the group header height", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      sticky.update(50);
      expect(el.style.height).toBe(`${HEADER_HEIGHT}px`);

      sticky.destroy();
    });

    it("should not re-render if the active group has not changed", () => {
      let renderCount = 0;
      const trackingConfig = makeGroupsConfig((key) => {
        renderCount++;
        return `<div>Group ${key}</div>`;
      });
      const { layout, heightCache } = createTestFixtures(trackingConfig);
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        trackingConfig,
        "vlist",
      );

      // First update — renders group A
      sticky.update(50);
      const firstRenderCount = renderCount;

      // Second update still within group A — should NOT re-render
      sticky.update(80);
      expect(renderCount).toBe(firstRenderCount);

      sticky.destroy();
    });

    it("should re-render when group changes", () => {
      let renderCount = 0;
      const trackingConfig = makeGroupsConfig((key) => {
        renderCount++;
        return `<div>Group ${key}</div>`;
      });
      const { layout, heightCache } = createTestFixtures(trackingConfig);
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        trackingConfig,
        "vlist",
      );

      sticky.update(50); // group A
      const afterA = renderCount;

      sticky.update(160); // group B
      expect(renderCount).toBe(afterA + 1);

      sticky.destroy();
    });

    it("should handle empty groups gracefully", () => {
      const emptyConfig: GroupsConfig = {
        getGroupForIndex: () => "A",
        headerHeight: 30,
        headerTemplate: (key) => `<div>${key}</div>`,
      };
      const layout = createGroupLayout(0, emptyConfig);
      const heightFn = createGroupedHeightFn(layout, 40);
      const heightCache = createHeightCache(heightFn, layout.totalEntries);

      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        emptyConfig,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Should hide when there are no groups
      sticky.update(0);
      expect(el.style.display).toBe("none");

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Push-out transition
  // ===========================================================================

  describe("push-out transition", () => {
    it("should apply no transform when next header is far away", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Scroll within group A, far from headerB (at offset 150)
      sticky.update(50);

      // No push-out needed — transform should be empty
      expect(el.style.transform).toBe("");

      sticky.destroy();
    });

    it("should push sticky header upward when next header approaches", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // headerB is at offset 150, headerA height is 30
      // When scrollTop = 140, distance to headerB = 150 - 140 = 10
      // Since 10 < 30 (headerA height), push-out = 10 - 30 = -20
      sticky.update(140);

      expect(el.style.transform).toBe("translateY(-20px)");

      sticky.destroy();
    });

    it("should fully push out sticky header when next header is at scroll position", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Scroll exactly to headerB at offset 150
      // distance = 150 - 150 = 0, which < 30 (header height)
      // push-out = 0 - 30 = -30
      sticky.update(150);

      // At exactly the boundary, the sticky switches to group B
      // and headerC becomes the "next" header at offset 260
      // distance = 260 - 150 = 110, which > 30, so no push-out
      expect(el.style.transform).toBe("");

      sticky.destroy();
    });

    it("should progressively push the header as scroll approaches next group", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // headerB at offset 150, headerA height = 30
      // Start of push zone: 150 - 30 = 120

      // Just before push zone — no transform
      sticky.update(119);
      expect(el.style.transform).toBe("");

      // At start of push zone: distance = 150 - 120 = 30, equals header height
      // push-out = 30 - 30 = 0 → no transform (boundary)
      sticky.update(120);
      expect(el.style.transform).toBe("");

      // Midway through push: distance = 150 - 135 = 15
      // push-out = 15 - 30 = -15
      sticky.update(135);
      expect(el.style.transform).toBe("translateY(-15px)");

      // Almost fully pushed: distance = 150 - 149 = 1
      // push-out = 1 - 30 = -29
      sticky.update(149);
      expect(el.style.transform).toBe("translateY(-29px)");

      sticky.destroy();
    });

    it("should not apply transform when there is no next group (last group)", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Scroll into group C (the last group) — no next header to push
      sticky.update(280);

      expect(el.innerHTML).toContain("Group C");
      expect(el.style.transform).toBe("");

      sticky.destroy();
    });

    it("should only update transform when it changes (avoid layout thrash)", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Set a transform
      sticky.update(140); // push-out = -20
      expect(el.style.transform).toBe("translateY(-20px)");

      // Spy on style.transform assignment by checking the value stays the same
      // Move scroll but keep same rounded transform
      sticky.update(140); // identical scroll position, same transform
      expect(el.style.transform).toBe("translateY(-20px)");

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Template rendering
  // ===========================================================================

  describe("template rendering", () => {
    it("should render string templates as innerHTML", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;
      sticky.update(50);

      expect(el.innerHTML).toBe("<div>Group A</div>");

      sticky.destroy();
    });

    it("should render HTMLElement templates via replaceChildren", () => {
      const elementConfig = makeGroupsConfig((key) => {
        const span = document.createElement("span");
        span.textContent = `Group ${key}`;
        return span;
      });
      const { layout, heightCache } = createTestFixtures(elementConfig);
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        elementConfig,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;
      sticky.update(50);

      const span = el.querySelector("span");
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe("Group A");

      sticky.destroy();
    });

    it("should pass correct group key and group index to template", () => {
      const calls: Array<{ key: string; groupIndex: number }> = [];
      const trackingConfig = makeGroupsConfig((key, groupIndex) => {
        calls.push({ key, groupIndex });
        return `<div>${key}</div>`;
      });
      const { layout, heightCache } = createTestFixtures(trackingConfig);
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        trackingConfig,
        "vlist",
      );

      sticky.update(0); // group A (index 0)
      sticky.update(160); // group B (index 1)
      sticky.update(270); // group C (index 2)

      expect(calls).toEqual([
        { key: "A", groupIndex: 0 },
        { key: "B", groupIndex: 1 },
        { key: "C", groupIndex: 2 },
      ]);

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Show / Hide
  // ===========================================================================

  describe("show / hide", () => {
    it("should show the sticky header", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      sticky.show();
      expect(el.style.display).toBe("");

      sticky.destroy();
    });

    it("should hide the sticky header", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      sticky.show();
      sticky.hide();
      expect(el.style.display).toBe("none");

      sticky.destroy();
    });

    it("should not toggle if already in the target state", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Already hidden — hide should be a no-op
      sticky.hide();
      expect(el.style.display).toBe("none");

      // Show twice — second should be no-op
      sticky.show();
      sticky.show();
      expect(el.style.display).toBe("");

      sticky.destroy();
    });

    it("should reset state when hiding", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Show and render a group
      sticky.update(50);
      expect(el.innerHTML).toContain("Group A");

      // Apply a transform
      sticky.update(140);
      expect(el.style.transform).toBe("translateY(-20px)");

      // Hide — should clear transform
      sticky.hide();
      expect(el.style.transform).toBe("");

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Refresh
  // ===========================================================================

  describe("refresh", () => {
    it("should force re-render the current group header", () => {
      let renderCount = 0;
      const trackingConfig = makeGroupsConfig((key) => {
        renderCount++;
        return `<div>Group ${key} (v${renderCount})</div>`;
      });
      const { layout, heightCache } = createTestFixtures(trackingConfig);
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        trackingConfig,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Initial render
      sticky.update(50);
      expect(el.innerHTML).toContain("v1");

      // Normal update within the same group — no re-render
      sticky.update(80);
      expect(el.innerHTML).toContain("v1");

      // Refresh forces re-render
      sticky.refresh();
      expect(el.innerHTML).toContain("v2");

      sticky.destroy();
    });

    it("should be a no-op if no group was ever rendered", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Never called update, so currentGroupIndex is -1
      sticky.refresh();

      // Should not crash or render anything
      expect(el.innerHTML).toBe("");

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Destroy
  // ===========================================================================

  describe("destroy", () => {
    it("should remove the sticky header element from the DOM", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      expect(root.querySelector(".vlist-sticky-header")).not.toBeNull();

      sticky.destroy();

      expect(root.querySelector(".vlist-sticky-header")).toBeNull();
    });

    it("should reset internal state", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );

      sticky.update(50);
      sticky.destroy();

      // Element should be gone
      expect(root.querySelector(".vlist-sticky-header")).toBeNull();
    });
  });

  // ===========================================================================
  // Variable header heights
  // ===========================================================================

  describe("variable header heights", () => {
    it("should support function-based header heights", () => {
      const variableConfig: GroupsConfig = {
        getGroupForIndex: (index: number): string => {
          if (index < 3) return "A";
          if (index < 5) return "B";
          return "C";
        },
        headerHeight: (_group: string, groupIndex: number) =>
          20 + groupIndex * 10,
        headerTemplate: (key) => `<div>Group ${key}</div>`,
        sticky: true,
      };

      const layout = createGroupLayout(6, variableConfig);
      const groupedHeightFn = createGroupedHeightFn(layout, ITEM_HEIGHT);
      const heightCache = createHeightCache(
        groupedHeightFn,
        layout.totalEntries,
      );

      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        variableConfig,
        "vlist",
      );
      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Group A header height = 20 + 0*10 = 20
      sticky.update(5);
      expect(el.style.height).toBe("20px");

      // Scroll to group B — header height = 20 + 1*10 = 30
      // Group A header = 20px, items 0-2 = 3*40 = 120px
      // headerB offset = 20 + 120 = 140
      sticky.update(145);
      expect(el.style.height).toBe("30px");

      sticky.destroy();
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle single group with single item", () => {
      const singleConfig: GroupsConfig = {
        getGroupForIndex: () => "only",
        headerHeight: 25,
        headerTemplate: (key) => `<div>${key}</div>`,
      };
      const layout = createGroupLayout(1, singleConfig);
      const heightFn = createGroupedHeightFn(layout, 40);
      const heightCache = createHeightCache(heightFn, layout.totalEntries);

      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        singleConfig,
        "vlist",
      );
      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      sticky.update(10);
      expect(el.innerHTML).toContain("only");
      // No next group, so no push-out
      expect(el.style.transform).toBe("");

      sticky.destroy();
    });

    it("should handle many groups with one item each", () => {
      const manyConfig: GroupsConfig = {
        getGroupForIndex: (index: number) => String.fromCharCode(65 + index),
        headerHeight: 20,
        headerTemplate: (key) => `<div>${key}</div>`,
      };
      const layout = createGroupLayout(5, manyConfig);
      const heightFn = createGroupedHeightFn(layout, 30);
      const heightCache = createHeightCache(heightFn, layout.totalEntries);

      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        manyConfig,
        "vlist",
      );
      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Each group: 20px header + 30px item = 50px
      // Group A: offset 0, Group B: offset 50, Group C: offset 100, etc.

      sticky.update(0);
      expect(el.innerHTML).toContain("A");

      sticky.update(55);
      expect(el.innerHTML).toContain("B");

      sticky.update(105);
      expect(el.innerHTML).toContain("C");

      sticky.update(155);
      expect(el.innerHTML).toContain("D");

      sticky.update(205);
      expect(el.innerHTML).toContain("E");

      sticky.destroy();
    });

    it("should handle scrolling backward through groups", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );
      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Scroll forward to group C
      sticky.update(270);
      expect(el.innerHTML).toContain("Group C");

      // Scroll back to group B
      sticky.update(160);
      expect(el.innerHTML).toContain("Group B");

      // Scroll back to group A
      sticky.update(10);
      expect(el.innerHTML).toContain("Group A");

      sticky.destroy();
    });

    it("should clear content for invalid group index", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );
      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Render a valid group
      sticky.update(50);
      expect(el.innerHTML).toContain("Group A");

      // Hide resets currentGroupIndex, then update with empty groups hides
      sticky.hide();
      expect(el.innerHTML).toContain("Group A"); // content still there, just hidden

      sticky.destroy();
    });

    it("should handle rapid scroll position changes", () => {
      const { layout, heightCache, config } = createTestFixtures();
      const sticky = createStickyHeader(
        root,
        layout,
        heightCache,
        config,
        "vlist",
      );
      const el = root.querySelector(".vlist-sticky-header") as HTMLElement;

      // Rapid updates across groups
      for (let i = 0; i < 330; i += 10) {
        sticky.update(i);
      }

      // Should end up on group C (last group, headerC at offset 260)
      expect(el.innerHTML).toContain("Group C");
      expect(el.style.display).toBe("");

      sticky.destroy();
    });
  });
});
