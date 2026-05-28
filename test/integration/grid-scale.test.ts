/**
 * Grid + Scale integration tests
 *
 * Verifies that the grid plugin correctly handles compressed scroll space
 * when combined with the scale plugin for large datasets (1M+ items).
 * The grid operates in ROW space, so compression maps virtual scroll
 * positions to row indices via the size cache.
 *
 * Note: grid's setVirtualTotalFn makes list.total return the row count,
 * not the item count. Tests use getRenderedIndices() for item-level checks.
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
import { grid } from "../../src/plugins/grid/plugin";
import { scale } from "../../src/plugins/scale/plugin";
import { scrollbar } from "../../src/plugins/scrollbar/plugin";
import { MAX_VIRTUAL_SIZE } from "../../src/rendering/scale";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  origClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 500; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 800; },
    configurable: true,
  });
});

afterAll(() => {
  if (origClientHeight)
    Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth)
    Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

// =============================================================================
// Helpers
// =============================================================================

const ITEM_HEIGHT = 120;
const COLUMNS = 4;
const GAP = 8;
const ROW_SIZE = ITEM_HEIGHT + GAP; // 128px per row in size cache

let container: HTMLElement;
let list: VList<TestItem> | null = null;

beforeEach(() => {
  container = createContainer({ width: 800, height: 500 });
});

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

function getRenderedIndices(): number[] {
  if (!list) return [];
  return Array.from(list.element.querySelectorAll("[data-index]"))
    .map((el) => parseInt(el.getAttribute("data-index")!, 10))
    .sort((a, b) => a - b);
}

function getItemTransformY(el: Element): number {
  const match = (el as HTMLElement).style.transform.match(/translate\([-\d.]+px,\s*([-\d.]+)px\)/);
  return match ? parseFloat(match[1]!) : NaN;
}

// =============================================================================
// Tests
// =============================================================================

describe("grid + scale integration", () => {
  describe("creation and initialization", () => {
    it("creates a list with grid + scale without errors", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      // grid virtualizes total to row count
      expect(list.total).toBe(Math.ceil(1000 / COLUMNS));
    });

    it("renders grid items with scale plugin present (non-compressed)", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      const items = list.element.querySelectorAll(".vlist-grid-item");
      expect(items.length).toBeGreaterThan(0);
    });

    it("creates with grid + scale + scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [
          grid({ columns: COLUMNS, gap: GAP }),
          scale(),
          scrollbar(),
        ],
      );

      expect(list.total).toBe(Math.ceil(1000 / COLUMNS));
      expect(list.element.querySelector("[class*='scrollbar']")).not.toBeNull();
    });
  });

  describe("compressed mode", () => {
    // 600K items → 150K rows → 150K × 128 = 19.2M px > 16M limit
    const LARGE_COUNT = 600_000;

    it("activates compression for datasets exceeding browser limit", () => {
      const totalRows = Math.ceil(LARGE_COUNT / COLUMNS);
      const totalHeight = totalRows * ROW_SIZE;
      expect(totalHeight).toBeGreaterThan(MAX_VIRTUAL_SIZE);

      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      expect(list.total).toBe(Math.ceil(LARGE_COUNT / COLUMNS));
    });

    it("renders items at initial position in compressed mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      expect(indices[0]).toBe(0);
    });

    it("renders multiple columns per row", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      const indices = getRenderedIndices();
      expect(indices).toContain(0);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
      expect(indices).toContain(3);
    });

    it("positions items relative to viewport in compressed mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      const items = list.element.querySelectorAll(".vlist-grid-item");
      expect(items.length).toBeGreaterThan(0);

      const firstY = getItemTransformY(items[0]!);
      expect(firstY).not.toBeNaN();
      expect(Math.abs(firstY)).toBeLessThan(ITEM_HEIGHT + GAP);
    });

    it("renders correct items after scrollToIndex in compressed mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      list.scrollToIndex(300_000, "start");

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      const minIdx = Math.min(...indices);
      const maxIdx = Math.max(...indices);
      expect(minIdx).toBeLessThanOrEqual(300_000);
      expect(maxIdx).toBeGreaterThanOrEqual(300_000);
    });

    it("renders correct items near the end of the list", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      list.scrollToIndex(LARGE_COUNT - 1, "end");

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      expect(Math.max(...indices)).toBe(LARGE_COUNT - 1);
    });

    it("items have viewport-relative positions (not absolute multi-million px)", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      list.scrollToIndex(300_000, "start");

      const items = list.element.querySelectorAll(".vlist-grid-item");
      for (const item of items) {
        const y = getItemTransformY(item);
        expect(y).not.toBeNaN();
        expect(Math.abs(y)).toBeLessThan(5000);
      }
    });
  });

  describe("force compression", () => {
    it("works with scale({ force: true }) on small datasets", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale({ force: true })],
      );

      expect(list.total).toBe(Math.ceil(100 / COLUMNS));

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      expect(indices[0]).toBe(0);
    });

    it("scrollToIndex works with forced compression", () => {
      list = createVList(
        {
          container,
          items: createTestItems(500),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale({ force: true })],
      );

      list.scrollToIndex(250, "center");

      const indices = getRenderedIndices();
      expect(indices).toContain(250);
    });
  });

  describe("non-compressed (scale present but below threshold)", () => {
    it("uses standard positioning when below compression threshold", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      const totalRows = Math.ceil(1000 / COLUMNS);
      const totalHeight = totalRows * ROW_SIZE;
      expect(totalHeight).toBeLessThan(MAX_VIRTUAL_SIZE);

      // First item at position (x, 0)
      const firstItem = list.element.querySelector("[data-index='0']") as HTMLElement;
      expect(firstItem).not.toBeNull();
      expect(getItemTransformY(firstItem)).toBe(0);
    });

    it("scrollToIndex does not throw without compression", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      expect(() => list!.scrollToIndex(500, "start")).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("destroys cleanly with grid + scale", () => {
      list = createVList(
        {
          container,
          items: createTestItems(600_000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [grid({ columns: COLUMNS, gap: GAP }), scale()],
      );

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });

    it("destroys cleanly with grid + scale + scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [
          grid({ columns: COLUMNS, gap: GAP }),
          scale(),
          scrollbar(),
        ],
      );

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });
  });
});
