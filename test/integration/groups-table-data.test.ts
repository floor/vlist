/**
 * Groups + Table + Data integration tests.
 *
 * Validates that three plugins cooperate correctly:
 *   - data plugin loads items asynchronously via adapter
 *   - groups plugin builds a grouped layout (headers + data entries)
 *   - table plugin renders using the grouped layout via getItemFn
 *
 * Key interactions tested:
 *   - getItemFn override ordering (groups must win over data)
 *   - sizeCache.rebuild interception for layout rebuilds
 *   - engineState.totalItems reflects layout count (data + headers)
 *   - snapshots restore + async data race condition
 *   - sticky header population after async data arrives
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { createContainer, type TestItem } from "../helpers/factory";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { table } from "../../src/plugins/table/plugin";
import { snapshots } from "../../src/plugins/snapshots/plugin";
import type { VListAdapter } from "../../src/types";

// =============================================================================
// Setup
// =============================================================================

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

// =============================================================================
// Helpers
// =============================================================================

interface CityItem extends TestItem {
  population: number;
  continent: string;
}

function createCities(offset: number, count: number): CityItem[] {
  const items: CityItem[] = [];
  for (let i = 0; i < count; i++) {
    const idx = offset + i;
    const pop = 20_000_000 - idx * 100_000;
    items.push({
      id: idx + 1,
      name: `City ${idx + 1}`,
      value: pop,
      population: pop,
      continent: idx < 10 ? "Asia" : idx < 20 ? "Europe" : "Americas",
    });
  }
  return items;
}

function createCityAdapter(total: number = 100, chunkSize: number = 50): VListAdapter<CityItem> {
  return {
    read: mock(async ({ offset, limit }: { offset: number; limit: number }) => {
      const end = Math.min(offset + limit, total);
      const items = createCities(offset, end - offset);
      return { items, total, hasMore: end < total };
    }),
  };
}

function getPopTier(_index: number, item?: any): string {
  if (!item || !item.population) return "Unknown";
  const pop = item.population;
  if (pop >= 15_000_000) return "15M+";
  if (pop >= 10_000_000) return "10M+";
  return "< 10M";
}

function getContinentGroup(_index: number, item?: any): string {
  return item?.continent ?? "Unknown";
}

const COLUMNS = [
  { key: "name", label: "City", width: 150 },
  { key: "population", label: "Pop", width: 100 },
  { key: "continent", label: "Continent", width: 100 },
];

function waitForLoad(list: VList<CityItem>): Promise<void> {
  return new Promise((resolve) => {
    const unsub = (list as any).on("load:end", () => {
      unsub();
      resolve();
    });
    setTimeout(resolve, 200);
  });
}

// =============================================================================
// Tests
// =============================================================================

let container: HTMLElement;
let list: VList<CityItem> | null = null;

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

describe("groups + table + data", () => {
  // ── Initialization ──────────────────────────────────────────────

  describe("initialization", () => {
    it("should set up all three plugins without errors", async () => {
      const adapter = createCityAdapter();
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const root = container.querySelector(".vlist") as HTMLElement;
      expect(root).not.toBeNull();
      expect(root.classList.contains("vlist--grouped")).toBe(true);
      expect(root.querySelector(".vlist-table-header")).not.toBeNull();
    });

    it("should produce group headers in the DOM", async () => {
      const adapter = createCityAdapter();
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const headers = container.querySelectorAll(".vlist-table-group-header");
      expect(headers.length).toBeGreaterThan(0);
    });
  });

  // ── getItemFn override ordering ─────────────────────────────────

  describe("getItemFn ordering", () => {
    it("should map layout indices through groups despite data plugin running later", async () => {
      const adapter = createCityAdapter(50);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      // getItemAt should return header pseudo-items at group boundaries
      const item0 = list.getItemAt(0);
      expect(item0).toBeDefined();
      expect((item0 as any).__groupHeader).toBe(true);

      // First data item should be at index 1 (after the first group header)
      const item1 = list.getItemAt(1);
      expect(item1).toBeDefined();
      expect((item1 as any).__groupHeader).toBeUndefined();
      expect(item1!.name).toBe("City 1");
    });
  });

  // ── engineState.totalItems ──────────────────────────────────────

  describe("totalItems", () => {
    it("should include group header count in aria-rowcount", async () => {
      const adapter = createCityAdapter(50);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const root = container.querySelector(".vlist") as HTMLElement;
      const rowCount = parseInt(root.getAttribute("aria-rowcount") ?? "0", 10);
      // aria-rowcount = totalItems + 1 (table header row)
      // totalItems should be 50 data items + N group headers
      expect(rowCount).toBeGreaterThan(51);
    });
  });

  // ── Sticky header ───────────────────────────────────────────────

  describe("sticky header", () => {
    it("should create a sticky header container", async () => {
      const adapter = createCityAdapter();
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
            sticky: true,
          }),
        ],
      );

      await waitForLoad(list);

      const sticky = container.querySelector(".vlist-sticky-header");
      expect(sticky).not.toBeNull();
    });
  });

  // ── Group content ───────────────────────────────────────────────

  describe("group content", () => {
    it("should create groups based on population tiers", async () => {
      const adapter = createCityAdapter(30);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const headers = container.querySelectorAll(".vlist-table-group-header");
      const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
      expect(headerTexts).toContain("15M+");
    });

    it("should use different group keys based on grouping function", async () => {
      const adapter = createCityAdapter(30);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getContinentGroup,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const headers = container.querySelectorAll(".vlist-table-group-header");
      const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
      expect(headerTexts).toContain("Asia");
      expect(headerTexts).toContain("Europe");
    });
  });

  // ── Snapshots restore race ──────────────────────────────────────

  describe("snapshots restore race", () => {
    it("should show correct groups after snapshot restore + data load", async () => {
      // This test creates, destroys, and recreates a vlist within one test
      // to simulate a page reload with a saved snapshot. Under --concurrent
      // mode, the HTMLElement.prototype.clientHeight override may be stomped
      // by another file between destroy and recreate. In sequential mode
      // this test is fully deterministic.
      const adapter = createCityAdapter(100);
      const STORAGE_KEY = "test-gtd-snap-" + Math.random().toString(36).slice(2, 8);

      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
          snapshots({ autoSave: STORAGE_KEY }),
        ],
      );

      await waitForLoad(list);

      // Verify groups exist on first load
      const headersFirstLoad = container.querySelectorAll(".vlist-table-group-header");
      const firstLoadCount = headersFirstLoad.length;

      // Save snapshot (simulates browser session)
      const snap = (list as any).getScrollSnapshot();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snap));

      // Destroy and recreate (simulates page reload with saved snapshot)
      list.destroy();
      container.innerHTML = "";

      // Re-install prototype override (defend against concurrent stomp)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        get() { return 500; },
        configurable: true,
      });
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        get() { return 300; },
        configurable: true,
      });

      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
          snapshots({ autoSave: STORAGE_KEY }),
        ],
      );

      await waitForLoad(list);

      // After snapshot restore + data load, groups must still be present
      const headersAfterRestore = container.querySelectorAll(".vlist-table-group-header");
      expect(headersAfterRestore.length).toBeGreaterThan(0);

      // Header count should be the same as first load
      expect(headersAfterRestore.length).toBe(firstLoadCount);

      sessionStorage.removeItem(STORAGE_KEY);
    });
  });

  // ── Data reload (sort change) ───────────────────────────────────

  describe("data reload", () => {
    it("should rebuild groups after reload", async () => {
      const adapter = createCityAdapter(50);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const headersBefore = container.querySelectorAll(".vlist-table-group-header").length;
      expect(headersBefore).toBeGreaterThan(0);

      // Reload data (simulates sort change).
      // Start listening BEFORE reload so we don't miss the event.
      (adapter.read as any).mockClear();
      const loaded = waitForLoad(list);
      await (list as any).reload();
      await loaded;

      const headersAfter = container.querySelectorAll(".vlist-table-group-header").length;
      expect(headersAfter).toBeGreaterThan(0);
    });

    it("keeps the sticky header displayed (empty) when a reload leaves only placeholders", async () => {
      const adapter = createCityAdapter(50);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
            sticky: true,
          }),
        ],
      );

      await waitForLoad(list);

      const sticky = container.querySelector(".vlist-sticky-header") as HTMLElement;
      expect(sticky).not.toBeNull();
      // With groups resolved, the sticky is shown with a label.
      expect(getComputedStyle(sticky).visibility).not.toBe("hidden");

      // Reload with a failing adapter → the new range is all placeholders →
      // no resolvable groups. An enabled sticky header stays displayed but
      // empty (it must NOT collapse or hide — it fills in on recovery without
      // a layout shift).
      (adapter.read as any).mockImplementation(async () => {
        throw new Error("offline");
      });
      await (list as any).reload();
      await new Promise((r) => setTimeout(r, 30));

      expect(container.querySelectorAll(".vlist-table-group-header").length).toBe(0);
      expect(sticky.style.display).not.toBe("none"); // not collapsed
      expect(sticky.style.visibility).not.toBe("hidden"); // shown, not hidden
      expect((sticky.textContent ?? "").trim()).toBe(""); // empty

      // Recover: data loads again → groups return → the label fills in.
      (adapter.read as any).mockImplementation(async ({ offset, limit }: { offset: number; limit: number }) => {
        const end = Math.min(offset + limit, 50);
        const items = createCities(offset, end - offset);
        return { items, total: 50, hasMore: end < 50 };
      });
      const reloaded = waitForLoad(list);
      await (list as any).loadVisibleRange();
      await reloaded;

      expect(getComputedStyle(sticky).visibility).not.toBe("hidden");
      expect((sticky.textContent ?? "").trim().length).toBeGreaterThan(0);
    });
  });

  // ── Table rendering ─────────────────────────────────────────────

  describe("table rendering", () => {
    it("should render data rows with table cells, not just group headers", async () => {
      const adapter = createCityAdapter(30);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const dataRows = container.querySelectorAll(".vlist-table-row:not(.vlist-table-group-header)");
      expect(dataRows.length).toBeGreaterThan(0);

      // Each data row should have cells matching column count
      const firstRow = dataRows[0] as HTMLElement;
      const cells = firstRow.querySelectorAll(".vlist-table-cell");
      expect(cells.length).toBe(COLUMNS.length);
    });

    it("should not apply vlist-item class to group header rows", async () => {
      const adapter = createCityAdapter(30);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      const headers = container.querySelectorAll(".vlist-table-group-header");
      for (const header of headers) {
        expect(header.classList.contains("vlist-item")).toBe(false);
      }
    });
  });

  // ── Placeholders ─────────────────────────────────────────────────

  describe("placeholders with groups", () => {
    it("should render placeholder rows for unloaded items", async () => {
      // Adapter with large total but small chunk — most items are unloaded
      const adapter: VListAdapter<CityItem> = {
        read: mock(async ({ offset, limit }: { offset: number; limit: number }) => {
          const end = Math.min(offset + limit, 500);
          const items = createCities(offset, end - offset);
          return { items, total: 500, hasMore: end < 500 };
        }),
      };

      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 10 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      // With chunkSize=10, only ~10 items loaded initially.
      // The table should still render rows beyond the loaded range as placeholders.
      const allRows = container.querySelectorAll(".vlist-table-row");
      expect(allRows.length).toBeGreaterThan(0);

      // Total rendered items (rows + headers) should fill the viewport
      const allItems = container.querySelectorAll("[data-index]");
      expect(allItems.length).toBeGreaterThan(5);
    });

    it("should render same number of rows with and without groups", async () => {
      const adapter = createCityAdapter(200);

      // Without groups
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
        ],
      );
      await waitForLoad(list);
      const rowsWithout = container.querySelectorAll(".vlist-table-row").length;
      list.destroy();
      container.innerHTML = "";

      // With groups
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );
      await waitForLoad(list);
      const rowsWith = container.querySelectorAll(".vlist-table-row:not(.vlist-table-group-header)").length;
      const headers = container.querySelectorAll(".vlist-table-group-header").length;

      // With groups: data rows + headers ≈ rows without groups
      // (headers take space so slightly fewer data rows fit)
      expect(rowsWith + headers).toBeGreaterThanOrEqual(rowsWithout - 2);
    });

    it("data plugin should register _getItem method", async () => {
      const adapter = createCityAdapter(50);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
          groups({
            getGroupForIndex: getPopTier,
            header: { height: 28, template: (key) => key },
          }),
        ],
      );

      await waitForLoad(list);

      // getItemAt(0) should return a group header (not undefined)
      const item0 = list.getItemAt(0);
      expect(item0).toBeDefined();
      expect((item0 as any).__groupHeader).toBe(true);

      // getItemAt(1) should return a data item (not undefined)
      const item1 = list.getItemAt(1);
      expect(item1).toBeDefined();
      expect((item1 as any).__groupHeader).toBeUndefined();
    });
  });

  // ── Without groups (baseline) ───────────────────────────────────

  describe("without groups (baseline)", () => {
    it("should render a plain table with no group headers", async () => {
      const adapter = createCityAdapter(30);
      list = createVList<CityItem>(
        { container, item: { height: 36, template: () => "" } },
        [
          dataPlugin({ adapter, storage: { chunkSize: 50 } }),
          table({ columns: COLUMNS, rowHeight: 36, headerHeight: 36 }),
        ],
      );

      await waitForLoad(list);

      const headers = container.querySelectorAll(".vlist-table-group-header");
      expect(headers.length).toBe(0);

      const dataRows = container.querySelectorAll(".vlist-table-row");
      expect(dataRows.length).toBeGreaterThan(0);
    });
  });
});
