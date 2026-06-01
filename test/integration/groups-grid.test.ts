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
import { grid } from "../../src/plugins/grid/plugin";
import { selection } from "../../src/plugins/selection/plugin";

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
    get() {
      return 500;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 300;
    },
    configurable: true,
  });
});
afterAll(() => {
  if (origClientHeight)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      origClientHeight,
    );
  if (origClientWidth)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      origClientWidth,
    );
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

const getGroup = (index: number): string => {
  if (index < 10) return "Group A";
  if (index < 20) return "Group B";
  return "Group C";
};

describe("groups + selection integration", () => {
  describe("groups with selection", () => {
    it("should create a list with groups and selection", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      expect(list.items.length).toBe(30);
      expect(typeof (list as any).getSelected).toBe("function");
    });

    it("should select items across groups", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      (list as any).select(1, 15, 25);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(15);
      expect(selected).toContain(25);
    });

    it("should clear selection across groups", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      (list as any).selectAll();
      (list as any).clearSelection();
      expect((list as any).getSelected().length).toBe(0);
    });
  });

  describe("groups rendering", () => {
    it("should render group header elements", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
        ],
      );

      const headers = list.element.querySelectorAll(".group-header");
      expect(headers.length).toBeGreaterThan(0);
    });

    it("should render items alongside group headers", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
        ],
      );

      const items = list.element.querySelectorAll("[data-index]");
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe("destroy with groups", () => {
    it("should clean up groups + selection on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      (list as any).selectAll();

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });
  });
});

// =============================================================================
// Groups + Grid integration
// =============================================================================

describe("groups + grid integration", () => {
  const COLUMNS = 4;
  const GAP = 8;
  const ITEM_HEIGHT = 100;
  const HEADER_HEIGHT = 30;

  function getGroupByTen(index: number): string {
    if (index < 10) return "Alpha";
    if (index < 20) return "Beta";
    if (index < 30) return "Gamma";
    return "Delta";
  }

  function createGroupedGrid(itemCount: number = 40, opts?: { sticky?: boolean }) {
    list = createVList(
      {
        container,
        items: createTestItems(itemCount),
        item: { height: ITEM_HEIGHT, template: simpleTemplate },
      },
      [
        grid({ columns: COLUMNS, gap: GAP }),
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

  describe("initialization", () => {
    it("should create a grouped grid without errors", () => {
      createGroupedGrid();
      expect(list!.element.classList.contains("vlist--grouped")).toBe(true);
    });

    it("should render group headers and grid items", () => {
      createGroupedGrid();
      const headers = container.querySelectorAll(".vlist-group-header");
      const items = container.querySelectorAll("[data-index]");
      expect(headers.length).toBeGreaterThan(0);
      expect(items.length).toBeGreaterThan(headers.length);
    });
  });

  describe("header positioning", () => {
    it("should position headers at full width (col=-1)", () => {
      createGroupedGrid();
      const headers = container.querySelectorAll(".vlist-group-header");
      for (const header of headers) {
        const el = header as HTMLElement;
        expect(el.style.width).toBe("100%");
      }
    });

    it("should position grid items at column width", () => {
      createGroupedGrid();
      const items = container.querySelectorAll("[data-index]:not(.vlist-group-header)");
      expect(items.length).toBeGreaterThan(0);
      const first = items[0] as HTMLElement;
      const w = parseFloat(first.style.width);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(300);
    });

    it("should position headers at Y=0 for the first group", () => {
      createGroupedGrid();
      const header = container.querySelector(".vlist-group-header") as HTMLElement;
      expect(header).not.toBeNull();
      const transform = header.style.transform;
      const yMatch = transform.match(/translate\(\d+px,\s*(\d+)px\)/);
      expect(yMatch).not.toBeNull();
      expect(parseInt(yMatch![1]!, 10)).toBe(0);
    });

    it("should position second group header after first group's grid rows", () => {
      createGroupedGrid();
      const headers = Array.from(container.querySelectorAll(".vlist-group-header"));
      if (headers.length < 2) return;

      const h1 = headers[0] as HTMLElement;
      const h2 = headers[1] as HTMLElement;
      const y1 = parseFloat(h1.style.transform.match(/,\s*([\d.]+)px/)![1]!);
      const y2 = parseFloat(h2.style.transform.match(/,\s*([\d.]+)px/)![1]!);
      // Second header must be below the first group's content
      expect(y2).toBeGreaterThan(y1 + HEADER_HEIGHT);
    });
  });

  describe("grid items within groups", () => {
    it("should arrange items in columns within each group", () => {
      createGroupedGrid();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)")
      ) as HTMLElement[];
      if (items.length < COLUMNS) return;

      const xs = items.slice(0, COLUMNS).map((el) => {
        const match = el.style.transform.match(/translate\(([\d.]+)px/);
        return match ? parseFloat(match[1]!) : -1;
      });
      // First COLUMNS items should have distinct X positions (columns)
      const uniqueXs = new Set(xs);
      expect(uniqueXs.size).toBe(COLUMNS);
    });

    it("should reset column counter at group boundary", () => {
      createGroupedGrid();
      // Find items from the second group (data indices 10-19)
      const allItems = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)")
      ) as HTMLElement[];

      // Items in the second group should start at column 0
      // The first item after a header should have X = 0
      const headers = Array.from(container.querySelectorAll(".vlist-group-header"));
      if (headers.length < 2) return;
      const secondHeaderIdx = parseInt(
        (headers[1] as HTMLElement).getAttribute("data-index")!,
        10,
      );
      const firstAfterHeader = container.querySelector(
        `[data-index="${secondHeaderIdx + 1}"]`,
      ) as HTMLElement;
      if (!firstAfterHeader) return;
      const x = parseFloat(
        firstAfterHeader.style.transform.match(/translate\(([\d.]+)px/)![1]!,
      );
      expect(x).toBe(0);
    });
  });

  describe("visible range (binary search)", () => {
    it("should render items beyond the first group", () => {
      // 40 items, 4 columns = 10 rows per group.
      // With 100px height per row + headers, the first group is ~1030px.
      // Viewport is 500px, so we should see items from group Alpha and possibly Beta.
      createGroupedGrid();
      const allItems = Array.from(
        container.querySelectorAll("[data-index]"),
      ) as HTMLElement[];
      // With overscan, should render well into the first group
      expect(allItems.length).toBeGreaterThan(COLUMNS + 1);
    });

    it("should render items from multiple groups", () => {
      // Use smaller items so multiple groups fit in the viewport
      list = createVList(
        {
          container,
          items: createTestItems(40),
          item: { height: 30, template: simpleTemplate },
        },
        [
          grid({ columns: COLUMNS, gap: 4 }),
          groups({
            getGroupForIndex: getGroupByTen,
            header: { height: 20, template: (key) => key },
          }),
        ],
      );

      const headers = container.querySelectorAll(".vlist-group-header");
      // With 30px rows, 4 cols, 10 items per group = 3 rows × 30px = 90px per group + 20px header
      // 500px viewport should show at least 4 groups
      expect(headers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sticky header with grid", () => {
    it("should create a sticky header container", () => {
      createGroupedGrid(40, { sticky: true });
      const sticky = container.querySelector(".vlist-sticky-header");
      expect(sticky).not.toBeNull();
    });

    it("should populate sticky header with first group name", () => {
      createGroupedGrid(40, { sticky: true });
      const sticky = container.querySelector(".vlist-sticky-header");
      expect(sticky).not.toBeNull();
      expect(sticky!.textContent?.trim()).toContain("Alpha");
    });
  });

  describe("selection with grouped grid", () => {
    it("should select clicked item", () => {
      createGroupedGrid();
      // Click the first data item (layout index 1, after header at 0)
      const item = container.querySelector("[data-index='1']") as HTMLElement;
      if (!item) return;
      item.click();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(1);
    });

    it("should not select group headers on click", () => {
      createGroupedGrid();
      const header = container.querySelector(".vlist-group-header") as HTMLElement;
      if (!header) return;
      header.click();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(0);
    });
  });

  describe("content size", () => {
    it("should calculate content size based on grid rows, not item count", () => {
      createGroupedGrid();
      const content = container.querySelector(".vlist-content") as HTMLElement;
      const height = parseFloat(content.style.height);
      // 40 items / 4 columns = 10 rows per group × 4 groups = 40 rows
      // But with group headers (30px each × 4) + gaps, total should be much less
      // than 40 items × 100px = 4000px (non-grid total)
      expect(height).toBeLessThan(4000);
      expect(height).toBeGreaterThan(0);
    });

  });

  describe("padding", () => {
    const PADDING = 16;

    function createPaddedGrid(itemCount: number = 40) {
      list = createVList(
        {
          container,
          items: createTestItems(itemCount),
          padding: PADDING,
          item: { height: ITEM_HEIGHT, template: simpleTemplate },
        },
        [
          grid({ columns: COLUMNS, gap: GAP }),
          groups({
            getGroupForIndex: getGroupByTen,
            header: { height: HEADER_HEIGHT, template: (key) => key },
          }),
          selection({ mode: "single" }),
        ],
      );
      return list;
    }

    it("should offset grid items by crossPadStart", () => {
      createPaddedGrid();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      expect(items.length).toBeGreaterThan(0);

      const firstItem = items[0]!;
      const xMatch = firstItem.style.transform.match(/translate\(([\d.]+)px/);
      expect(xMatch).not.toBeNull();
      const x = parseFloat(xMatch![1]!);
      expect(x).toBe(PADDING);
    });

    it("should calculate column width accounting for padding", () => {
      createPaddedGrid();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      expect(items.length).toBeGreaterThan(0);

      const w = parseFloat(items[0]!.style.width);
      // containerWidth=300, padding=16 on each side, 4 cols, gap=8
      // available = 300 - 32 = 268, colWidth = (268 - 3*8) / 4 = 61
      const expected = (300 - PADDING * 2 - (COLUMNS - 1) * GAP) / COLUMNS;
      expect(Math.abs(w - expected)).toBeLessThan(1);
    });

    it("should make grid column width narrower than without padding", () => {
      // Create without padding for comparison
      createGroupedGrid();
      const noPadItems = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      const noPadW = parseFloat(noPadItems[0]!.style.width);

      list!.destroy();
      container.innerHTML = "";

      // Create with padding
      createPaddedGrid();
      const padItems = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      const padW = parseFloat(padItems[0]!.style.width);

      expect(padW).toBeLessThan(noPadW);
    });

    it("should position second column item at crossPadStart + colWidth + gap", () => {
      createPaddedGrid();
      const items = Array.from(
        container.querySelectorAll("[data-index]:not(.vlist-group-header)"),
      ) as HTMLElement[];
      if (items.length < 2) return;

      const x1 = parseFloat(items[0]!.style.transform.match(/translate\(([\d.]+)px/)![1]!);
      const x2 = parseFloat(items[1]!.style.transform.match(/translate\(([\d.]+)px/)![1]!);
      const w = parseFloat(items[0]!.style.width);
      // Second column should be at padStart + colWidth + gap
      expect(Math.abs(x2 - (x1 + w + GAP))).toBeLessThan(1);
    });

    it("should position headers at x=0 (headers span full width including padding area)", () => {
      createPaddedGrid();
      const header = container.querySelector(".vlist-group-header") as HTMLElement;
      if (!header) return;
      const xMatch = header.style.transform.match(/translate\(([\d.]+)px/);
      expect(xMatch).not.toBeNull();
      expect(parseFloat(xMatch![1]!)).toBe(0);
    });

    it("should include mainAxisPadding in content height", () => {
      createPaddedGrid();
      const content = container.querySelector(".vlist-content") as HTMLElement;
      const height = parseFloat(content.style.height);
      // mainAxisPadding = PADDING * 2 = 32. Content height must include it.
      // Without padding, pure grid content is ~1300-1500px.
      // With PADDING=16, height must be at least pure content + 32.
      expect(height).toBeGreaterThan(1300 + PADDING * 2);
    });
  });

  describe("destroy", () => {
    it("should clean up groups + grid + selection without errors", () => {
      createGroupedGrid();
      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });
  });
});
