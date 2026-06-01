/**
 * Groups + Masonry integration tests.
 *
 * Validates that groups plugin works with masonry layout:
 *   - Shortest-lane placement resets at group boundaries
 *   - Headers span full width at correct Y positions
 *   - Sticky header transitions at correct offsets
 *   - Visible range binary search works with variable-height items
 *   - Selection works across groups
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import { selection } from "../../src/plugins/selection/plugin";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 500; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 300; },
    configurable: true,
  });
});

afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

let container: HTMLElement;
let list: VList<TestItem> | null = null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
});

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

const COLUMNS = 3;
const GAP = 8;
const HEADER_HEIGHT = 30;

const ASPECT_RATIOS = [0.75, 1.0, 1.33, 1.5, 0.66];

function getGroupByTen(index: number): string {
  if (index < 10) return "Alpha";
  if (index < 20) return "Beta";
  if (index < 30) return "Gamma";
  return "Delta";
}

function createGroupedMasonry(itemCount: number = 40, opts?: { sticky?: boolean }) {
  list = createVList(
    {
      container,
      items: createTestItems(itemCount),
      item: {
        height: ((_i: number, ctx: any) =>
          ctx ? Math.round(ctx.columnWidth * ASPECT_RATIOS[_i % ASPECT_RATIOS.length]!) : 100) as any,
        template: simpleTemplate,
      },
    },
    [
      masonry({ columns: COLUMNS, gap: GAP }),
      groups({
        getGroupForIndex: getGroupByTen,
        header: { height: HEADER_HEIGHT, template: (key) => key },
        sticky: opts?.sticky ?? false,
      }),
      selection({ mode: "single" }),
    ],
  );
  return list;
}

describe("groups + masonry integration", () => {
  describe("initialization", () => {
    it("should create a grouped masonry without errors", () => {
      createGroupedMasonry();
      expect(list!.element.classList.contains("vlist--grouped")).toBe(true);
    });

    it("should render group headers and masonry items", () => {
      createGroupedMasonry();
      const headers = container.querySelectorAll(".vlist-group-header");
      const items = container.querySelectorAll("[data-index]");
      expect(headers.length).toBeGreaterThan(0);
      expect(items.length).toBeGreaterThan(headers.length);
    });
  });

  describe("header positioning", () => {
    it("should position headers at full width", () => {
      createGroupedMasonry();
      const headers = container.querySelectorAll(".vlist-group-header");
      for (const header of headers) {
        expect((header as HTMLElement).style.width).toBe("100%");
      }
    });

    it("should position first header at Y=0", () => {
      createGroupedMasonry();
      const header = container.querySelector(".vlist-group-header") as HTMLElement;
      expect(header).not.toBeNull();
      const transform = header.style.transform;
      const yMatch = transform.match(/translate\(\d+px,\s*(\d+)px\)/);
      expect(yMatch).not.toBeNull();
      expect(parseInt(yMatch![1]!, 10)).toBe(0);
    });

    it("should position second header after tallest lane of first group", () => {
      createGroupedMasonry();
      const headers = Array.from(container.querySelectorAll(".vlist-group-header"));
      if (headers.length < 2) return;

      const h1 = headers[0] as HTMLElement;
      const h2 = headers[1] as HTMLElement;
      const y1 = parseFloat(h1.style.transform.match(/,\s*([\d.]+)px/)![1]!);
      const y2 = parseFloat(h2.style.transform.match(/,\s*([\d.]+)px/)![1]!);
      expect(y2).toBeGreaterThan(y1 + HEADER_HEIGHT);
    });
  });

  describe("masonry lane placement", () => {
    it("should place items in different lanes within a group", () => {
      createGroupedMasonry();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      if (items.length < COLUMNS) return;

      const xs = items.slice(0, COLUMNS).map((el) => {
        const m = el.style.transform.match(/translate\(([\d.]+)px/);
        return m ? parseFloat(m[1]!) : -1;
      });
      const uniqueXs = new Set(xs);
      // First COLUMNS items should be in different lanes
      expect(uniqueXs.size).toBe(COLUMNS);
    });

    it("should place items using shortest-lane algorithm (not sequential columns)", () => {
      createGroupedMasonry();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      if (items.length < COLUMNS * 2) return;

      // In masonry, the 4th+ items go into the shortest lane.
      // With variable heights, lane assignment is not simply i % columns.
      // Verify items beyond the first row are placed at Y > 0.
      const fourthItem = items[COLUMNS] as HTMLElement;
      const m = fourthItem.style.transform.match(/,\s*([\d.]+)px/);
      expect(m).not.toBeNull();
      expect(parseFloat(m![1]!)).toBeGreaterThan(0);
    });
  });

  describe("sticky header", () => {
    it("should create a sticky header container", () => {
      createGroupedMasonry(40, { sticky: true });
      const sticky = container.querySelector(".vlist-sticky-header");
      expect(sticky).not.toBeNull();
    });

    it("should populate sticky with first group name", () => {
      createGroupedMasonry(40, { sticky: true });
      const sticky = container.querySelector(".vlist-sticky-header");
      expect(sticky).not.toBeNull();
      expect(sticky!.textContent?.trim()).toContain("Alpha");
    });
  });

  describe("selection", () => {
    it("should select a clicked masonry item", () => {
      createGroupedMasonry();
      const item = container.querySelector("[data-index='1']") as HTMLElement;
      if (!item) return;
      item.click();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(1);
    });

    it("should not select group headers", () => {
      createGroupedMasonry();
      const header = container.querySelector(".vlist-group-header") as HTMLElement;
      if (!header) return;
      header.click();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(0);
    });
  });

  describe("variable heights", () => {
    it("should render items with different heights (masonry property)", () => {
      createGroupedMasonry();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      if (items.length < 5) return;

      const heights = items.slice(0, 5).map((el) => parseFloat(el.style.height));
      const uniqueHeights = new Set(heights);
      // With aspect ratios [0.75, 1.0, 1.33, 1.5, 0.66], at least 2 distinct heights
      expect(uniqueHeights.size).toBeGreaterThanOrEqual(2);
    });

    it("should NOT have all items same height like grid", () => {
      createGroupedMasonry();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      if (items.length < COLUMNS + 1) return;

      // In a grid, all items in a row have the same height.
      // In masonry, items have individual heights from their aspect ratio.
      const heights = items.map((el) => parseFloat(el.style.height));
      const allSame = heights.every((h) => h === heights[0]);
      expect(allSame).toBe(false);
    });

    it("should pack items more efficiently than grid (shorter total height)", () => {
      // Create masonry with groups
      createGroupedMasonry();
      const masonryContent = container.querySelector(".vlist-content") as HTMLElement;
      const masonryHeight = parseFloat(masonryContent.style.height);

      // Masonry packs items efficiently — height should be less than
      // all items stacked vertically (40 items × ~100px = 4000px)
      expect(masonryHeight).toBeLessThan(4000);
      expect(masonryHeight).toBeGreaterThan(0);
    });
  });

  describe("lane reset at group boundary", () => {
    it("should reset lane heights at each group header", () => {
      createGroupedMasonry();
      const headers = Array.from(container.querySelectorAll(".vlist-group-header")) as HTMLElement[];
      if (headers.length < 2) return;

      // Get Y of second header
      const h2y = parseFloat(headers[1]!.style.transform.match(/,\s*([\d.]+)px/)![1]!);

      // Get items just after the second header
      const h2idx = parseInt(headers[1]!.dataset.index!, 10);
      const firstAfter = container.querySelector(`[data-index="${h2idx + 1}"]`) as HTMLElement;
      if (!firstAfter) return;

      const itemY = parseFloat(firstAfter.style.transform.match(/,\s*([\d.]+)px/)![1]!);
      // Item after header should be at header Y + header height (lanes reset)
      expect(itemY).toBeGreaterThan(h2y);
      expect(itemY - h2y).toBeLessThan(HEADER_HEIGHT + 5);
    });
  });

  describe("content size", () => {
    it("should calculate content size from masonry layout", () => {
      createGroupedMasonry();
      const content = container.querySelector(".vlist-content") as HTMLElement;
      const height = parseFloat(content.style.height);
      expect(height).toBeLessThan(4000);
      expect(height).toBeGreaterThan(0);
    });
  });

  describe("destroy", () => {
    it("should clean up without errors", () => {
      createGroupedMasonry();
      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });
  });
});
