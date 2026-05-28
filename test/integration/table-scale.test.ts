/**
 * Table + Scale integration tests
 *
 * Verifies that the table plugin correctly handles compressed scroll space
 * when combined with the scale plugin for large datasets (1M+ items).
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
import type { TableColumn } from "../../src/plugins/table/types";
import { table } from "../../src/plugins/table/plugin";
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

const ROW_HEIGHT = 36;

const columns: TableColumn<TestItem>[] = [
  { key: "name", label: "Name", width: 200 },
  { key: "value", label: "Value", width: 100 },
];

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

function getRowTransformY(el: Element): number {
  const match = (el as HTMLElement).style.transform.match(/translateY\(([-\d.]+)px\)/);
  return match ? parseFloat(match[1]!) : NaN;
}

// =============================================================================
// Tests
// =============================================================================

describe("table + scale integration", () => {
  describe("creation and initialization", () => {
    it("creates a list with table + scale without errors", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      expect(list.total).toBe(1000);
    });

    it("renders table rows with scale plugin present (non-compressed)", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      const rows = list.element.querySelectorAll(".vlist-table-row");
      expect(rows.length).toBeGreaterThan(0);
    });

    it("creates with table + scale + scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [
          table({ columns, rowHeight: ROW_HEIGHT }),
          scale(),
          scrollbar(),
        ],
      );

      expect(list.total).toBe(1000);
      expect(list.element.querySelector("[class*='scrollbar']")).not.toBeNull();
    });
  });

  describe("compressed mode", () => {
    const LARGE_COUNT = 500_000;

    it("activates compression for datasets exceeding browser limit", () => {
      const totalHeight = LARGE_COUNT * ROW_HEIGHT;
      expect(totalHeight).toBeGreaterThan(MAX_VIRTUAL_SIZE);

      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      expect(list.total).toBe(LARGE_COUNT);
    });

    it("renders rows at initial position in compressed mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      expect(indices[0]).toBe(0);
    });

    it("positions rows relative to viewport in compressed mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      const rows = list.element.querySelectorAll(".vlist-table-row");
      expect(rows.length).toBeGreaterThan(0);

      const firstY = getRowTransformY(rows[0]!);
      expect(firstY).not.toBeNaN();
      // At scroll position 0, first row should be near top of viewport
      expect(Math.abs(firstY)).toBeLessThan(ROW_HEIGHT);
    });

    it("renders correct rows after scrollToIndex in compressed mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      list.scrollToIndex(250_000, "start");

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      // Rendered range should be near the target index
      const minIdx = Math.min(...indices);
      const maxIdx = Math.max(...indices);
      expect(minIdx).toBeLessThanOrEqual(250_000);
      expect(maxIdx).toBeGreaterThanOrEqual(250_000);
    });

    it("renders correct rows near the end of the list", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      list.scrollToIndex(LARGE_COUNT - 1, "end");

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      expect(Math.max(...indices)).toBe(LARGE_COUNT - 1);
    });

    it("rows have viewport-relative positions (not absolute multi-million px)", () => {
      list = createVList(
        {
          container,
          items: createTestItems(LARGE_COUNT),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      list.scrollToIndex(250_000, "start");

      const rows = list.element.querySelectorAll(".vlist-table-row");
      for (const row of rows) {
        const y = getRowTransformY(row);
        expect(y).not.toBeNaN();
        // In compressed mode, positions are viewport-relative (small values),
        // not absolute offsets (which would be ~9M px at index 250K)
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
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale({ force: true })],
      );

      expect(list.total).toBe(100);

      const indices = getRenderedIndices();
      expect(indices.length).toBeGreaterThan(0);
      expect(indices[0]).toBe(0);
    });

    it("scrollToIndex works with forced compression", () => {
      list = createVList(
        {
          container,
          items: createTestItems(500),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale({ force: true })],
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
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      const totalHeight = 1000 * ROW_HEIGHT;
      expect(totalHeight).toBeLessThan(MAX_VIRTUAL_SIZE);

      // First row should be at absolute offset 0
      const firstRow = list.element.querySelector("[data-index='0']") as HTMLElement;
      expect(firstRow).not.toBeNull();
      expect(getRowTransformY(firstRow)).toBe(0);

      // Second row at absolute offset = ROW_HEIGHT
      const secondRow = list.element.querySelector("[data-index='1']") as HTMLElement;
      expect(secondRow).not.toBeNull();
      expect(getRowTransformY(secondRow)).toBe(ROW_HEIGHT);
    });

    it("scrollToIndex does not throw without compression", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      expect(() => list!.scrollToIndex(500, "start")).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("destroys cleanly with table + scale", () => {
      list = createVList(
        {
          container,
          items: createTestItems(500_000),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [table({ columns, rowHeight: ROW_HEIGHT }), scale()],
      );

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });

    it("destroys cleanly with table + scale + scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: ROW_HEIGHT, template: simpleTemplate },
        },
        [
          table({ columns, rowHeight: ROW_HEIGHT }),
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
