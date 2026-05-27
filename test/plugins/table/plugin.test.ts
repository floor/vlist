/**
 * vlist v2 — Table Plugin Tests
 * Tests for table() plugin: initialization, configuration, render pipeline,
 * resize handlers, public methods, and event emission.
 *
 * Uses createPluginMockContext to verify the plugin wires correctly without
 * needing a full materialized vlist instance.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { table } from "../../../src/plugins/table/plugin";
import type { VListItem } from "../../../src/types";
import type { TableColumn } from "../../../src/plugins/table/types";
import { createPluginMockContext } from "../../helpers/plugin-context";
import type { PluginTestContext } from "../../helpers/plugin-context";

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
  email: string;
  role: string;
}

const testColumns: TableColumn<TestItem>[] = [
  { key: "name", label: "Name", width: 200 },
  { key: "email", label: "Email", width: 300 },
  { key: "role", label: "Role", width: 100 },
];

function createTestItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@test.com`,
    role: i % 2 === 0 ? "admin" : "user",
  }));
}

interface TableTestContext {
  ctx: PluginTestContext<TestItem>["ctx"];
  engineState: PluginTestContext<TestItem>["engineState"];
  dom: PluginTestContext<TestItem>["dom"];
  methods: PluginTestContext<TestItem>["methods"];
  destroyHandlers: PluginTestContext<TestItem>["destroyHandlers"];
  clickHandlers: PluginTestContext<TestItem>["clickHandlers"];
  keydownHandlers: PluginTestContext<TestItem>["keydownHandlers"];
  items: PluginTestContext<TestItem>["items"];
  scrollCalls: PluginTestContext<TestItem>["scrollCalls"];
  readonly renderFnReplaced: boolean;
  cleanup: PluginTestContext<TestItem>["cleanup"];
  emitted: Array<{ event: string; payload: any }>;
}

function createTableMockContext(overrides?: {
  itemCount?: number;
  scrollTop?: number;
  containerSize?: number;
  containerWidth?: number;
}): TableTestContext {
  const itemCount = overrides?.itemCount ?? 100;
  const items = createTestItems(itemCount);

  const result = createPluginMockContext<TestItem>(items, {
    itemSize: 40,
    containerHeight: overrides?.containerSize ?? 600,
    containerWidth: overrides?.containerWidth ?? 800,
  });

  // Override engineState scroll position if requested
  if (overrides?.scrollTop !== undefined) {
    result.engineState.scrollPosition = overrides.scrollTop;
  }

  // Inject a tracking emitter BEFORE plugin.setup() so plugin captures it
  const emitted: Array<{ event: string; payload: any }> = [];
  const trackingEmitter = {
    on: () => () => {},
    off: () => {},
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    clear: () => {},
  };
  (result.ctx as any).emitter = trackingEmitter;

  return {
    ctx: result.ctx,
    engineState: result.engineState,
    dom: result.dom,
    methods: result.methods,
    destroyHandlers: result.destroyHandlers,
    clickHandlers: result.clickHandlers,
    keydownHandlers: result.keydownHandlers,
    items: result.items,
    scrollCalls: result.scrollCalls,
    get renderFnReplaced() { return result.renderFnReplaced; },
    cleanup: result.cleanup,
    emitted,
  };
}

// =============================================================================
// table — Factory Tests
// =============================================================================

describe("table - Factory", () => {
  it("should create a plugin with name and priority", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
    });

    expect(plugin.name).toBe("table");
    expect(plugin.priority).toBe(10);
  });

  it("should declare conflicts with grid and masonry", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
    });

    expect(plugin.conflicts).toContain("grid");
    expect(plugin.conflicts).toContain("masonry");
  });

  it("should throw if columns is empty", () => {
    expect(() => {
      table({ columns: [], rowHeight: 40 });
    }).toThrow("columns must be a non-empty array");
  });

  it("should throw if both rowHeight and estimatedRowHeight are missing", () => {
    expect(() => {
      table({ columns: testColumns } as any);
    }).toThrow("either rowHeight or estimatedRowHeight is required");
  });

  it("should accept valid configuration", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 44,
      resizable: true,
      columnBorders: true,
      rowBorders: false,
    });

    expect(plugin.name).toBe("table");
  });
});

// =============================================================================
// table — Setup
// =============================================================================

describe("table - Setup", () => {
  it("should add table CSS class to root", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--table")).toBe(true);
    cleanup();
  });

  it("should set role=grid on root", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.getAttribute("role")).toBe("grid");
    cleanup();
  });

  it("should set role=rowgroup on content", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.content.getAttribute("role")).toBe("rowgroup");
    cleanup();
  });

  it("should set aria-colcount on root", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.getAttribute("aria-colcount")).toBe("3");
    cleanup();
  });

  it("should throw if horizontal is true", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, { horizontal: true });

    expect(() => plugin.setup!(ctx)).toThrow("cannot be used with horizontal orientation");
    cleanup();
  });

  it("should throw if reverse is true", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const items = createTestItems(10);
    const { ctx, cleanup } = createPluginMockContext<TestItem>(items, { reverse: true });

    expect(() => plugin.setup!(ctx)).toThrow("cannot be used with reverse mode");
    cleanup();
  });

  it("should create a table header element in the root", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const header = dom.root.querySelector(".vlist-table-header");
    expect(header).not.toBeNull();
    cleanup();
  });

  it("should create header cells for each column", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const cells = dom.root.querySelectorAll(".vlist-table-header-cell");
    expect(cells.length).toBe(3);
    cleanup();
  });

  it("should set header height CSS variable on root", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 44,
    });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.style.getPropertyValue("--vlist-table-header-height")).toBe("44px");
    cleanup();
  });

  it("should default header height to rowHeight when fixed", () => {
    const plugin = table({ columns: testColumns, rowHeight: 36 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.style.getPropertyValue("--vlist-table-header-height")).toBe("36px");
    cleanup();
  });

  it("should set content min-width to total column width", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    // 200 + 300 + 100 = 600
    expect(dom.content.style.minWidth).toBe("600px");
    cleanup();
  });

  it("should replace render function via setRenderFn", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const mockCtx = createTableMockContext();

    plugin.setup!(mockCtx.ctx);

    expect(mockCtx.renderFnReplaced).toBe(true);
    mockCtx.cleanup();
  });

  it("should register a destroy handler", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, destroyHandlers, cleanup } = createTableMockContext();

    const beforeCount = destroyHandlers.length;
    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBe(beforeCount + 1);
    cleanup();
  });
});

// =============================================================================
// table — Render Functions (CRITICAL)
// =============================================================================

describe("table - Render Functions", () => {
  it("should replace render functions via setRenderFn", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const mockCtx = createTableMockContext();

    plugin.setup!(mockCtx.ctx);

    expect(mockCtx.renderFnReplaced).toBe(true);
    mockCtx.cleanup();
  });

  it("should not render if destroyed", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, engineState, cleanup } = createTableMockContext();

    plugin.setup!(ctx);
    engineState.destroyed = true;

    // Should not throw
    ctx.renderIfNeeded();
    ctx.forceRender();
    cleanup();
  });

  it("should render rows on first renderIfNeeded call", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({ containerSize: 200 });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // With container 200px and row height 40px, should see ~5 visible rows + overscan
    const rows = dom.content.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should skip render when scroll position and container size unchanged", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({ containerSize: 200 });
    engineState.containerSize = 200;

    plugin.setup!(ctx);

    // First render
    ctx.renderIfNeeded();
    const rowCount1 = dom.content.querySelectorAll(".vlist-table-row").length;

    // Second render with same state — should be a no-op (early exit)
    ctx.renderIfNeeded();
    const rowCount2 = dom.content.querySelectorAll(".vlist-table-row").length;

    expect(rowCount2).toBe(rowCount1);
    cleanup();
  });

  it("should re-render when scroll position changes", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({
      containerSize: 200,
      scrollTop: 0,
    });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    const firstRowBefore = dom.content.querySelector(".vlist-table-row[data-index='0']");
    expect(firstRowBefore).not.toBeNull();

    // Scroll down
    engineState.scrollPosition = 800; // 800 / 40 = row 20
    ctx.renderIfNeeded();

    // Rows around index 20 should exist
    const row20 = dom.content.querySelector(".vlist-table-row[data-index='20']");
    expect(row20).not.toBeNull();
    cleanup();
  });

  it("should force render even when position unchanged", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({ containerSize: 200 });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // Force render should work even though nothing changed
    ctx.forceRender();

    const rows = dom.content.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should handle zero total items gracefully", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({ itemCount: 0 });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    const rows = dom.content.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBe(0);
    cleanup();
  });

  it("should handle zero container height gracefully", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, engineState, cleanup } = createTableMockContext({ containerSize: 0 });
    engineState.containerSize = 0;

    plugin.setup!(ctx);

    // Should not throw — graceful handling is the requirement
    ctx.renderIfNeeded();

    cleanup();
  });
});

// =============================================================================
// table — Engine State Updates
// =============================================================================

describe("table - Engine State", () => {
  it("should update engineState.prevRangeStart/End on render", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, engineState, cleanup } = createTableMockContext({ containerSize: 200 });
    engineState.containerSize = 200;

    plugin.setup!(ctx);

    expect(engineState.prevRangeStart).toBe(0);
    expect(engineState.prevRangeEnd).toBe(-1);

    ctx.renderIfNeeded();

    expect(engineState.prevRangeStart).toBeGreaterThanOrEqual(0);
    expect(engineState.prevRangeEnd).toBeGreaterThanOrEqual(0);
    cleanup();
  });

  it("should track scrollPosition in engineState", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, engineState, cleanup } = createTableMockContext({
      containerSize: 200,
      scrollTop: 160,
    });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // engineState.scrollPosition was set to 160 before render
    expect(engineState.scrollPosition).toBe(160);
    cleanup();
  });

  it("should update renderRange with overscan", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, engineState, cleanup } = createTableMockContext({
      containerSize: 200,
      scrollTop: 200,
    });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // Render range should extend by overscan beyond visible range
    // visStart at scroll=200, rowHeight=40 → index 5
    // visEnd at scroll=200+200=400, rowHeight=40 → index 9 (approx)
    // renderStart = max(0, 5 - 2) = 3; renderEnd = min(99, 9 + 2) = 11
    expect(engineState.prevRangeStart).toBeLessThan(5);
    expect(engineState.prevRangeEnd).toBeGreaterThan(9);
    cleanup();
  });
});

// =============================================================================
// table — Event Emission
// =============================================================================

describe("table - Events", () => {
  it("should emit column:resize when resizeColumn is called", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const tableCtx = createTableMockContext();

    plugin.setup!(tableCtx.ctx);

    const resizeColumn = tableCtx.methods.get("resizeColumn") as (k: string | number, w: number) => void;
    resizeColumn("name", 250);

    const resizeEvents = tableCtx.emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(1);
    expect(resizeEvents[0]!.payload.key).toBe("name");
    expect(resizeEvents[0]!.payload.width).toBe(250);
    tableCtx.cleanup();
  });

  it("should emit column:sort when sortable header cell is clicked", () => {
    const sortableColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, sortable: true },
    ];
    const plugin = table({ columns: sortableColumns, rowHeight: 40 });
    const tableCtx = createTableMockContext();

    plugin.setup!(tableCtx.ctx);

    const headerCells = tableCtx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameHeader = headerCells[0] as HTMLElement;
    const clickEvt = new MouseEvent("click", { bubbles: true });
    nameHeader.dispatchEvent(clickEvt);

    const sortEvents = tableCtx.emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(1);
    expect(sortEvents[0]!.payload.key).toBe("name");
    tableCtx.cleanup();
  });
});

// =============================================================================
// table — Public Methods
// =============================================================================

describe("table - Public Methods", () => {
  it("should expose updateColumns method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(methods.has("updateColumns")).toBe(true);
    cleanup();
  });

  it("should expose resizeColumn method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(methods.has("resizeColumn")).toBe(true);
    cleanup();
  });

  it("should expose getColumnWidths method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(methods.has("getColumnWidths")).toBe(true);
    cleanup();
  });

  it("should expose setSort method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(methods.has("setSort")).toBe(true);
    cleanup();
  });

  it("should expose getSort method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(methods.has("getSort")).toBe(true);
    cleanup();
  });

  it("should expose _getTableLayout internal method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(methods.has("_getTableLayout")).toBe(true);
    const getLayout = methods.get("_getTableLayout") as Function;
    const layout = getLayout();
    expect(layout).toBeDefined();
    expect(layout.columns.length).toBe(3);
    cleanup();
  });

  it("getColumnWidths should return current widths keyed by column key", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const getColumnWidths = methods.get("getColumnWidths") as () => Record<string, number>;
    const widths = getColumnWidths();

    expect(widths.name).toBe(200);
    expect(widths.email).toBe(300);
    expect(widths.role).toBe(100);
    cleanup();
  });

  it("setSort should update sort state", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const setSort = methods.get("setSort") as (key: string | null, dir?: "asc" | "desc") => void;
    const getSort = methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };

    setSort("name", "desc");
    const sort = getSort();
    expect(sort.key).toBe("name");
    expect(sort.direction).toBe("desc");
    cleanup();
  });

  it("setSort with null should clear sort", () => {
    const plugin = table<TestItem>({
      columns: testColumns,
      rowHeight: 40,
      sort: { key: "name", direction: "asc" },
    });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const setSort = methods.get("setSort") as (key: string | null, dir?: "asc" | "desc") => void;
    const getSort = methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };

    setSort(null);
    const sort = getSort();
    expect(sort.key).toBeNull();
    cleanup();
  });

  it("resizeColumn by key should emit column:resize", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const tableCtx = createTableMockContext();

    plugin.setup!(tableCtx.ctx);

    const resizeColumn = tableCtx.methods.get("resizeColumn") as (keyOrIndex: string | number, width: number) => void;
    resizeColumn("name", 250);

    const resizeEvents = tableCtx.emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(1);
    expect(resizeEvents[0]!.payload.key).toBe("name");
    expect(resizeEvents[0]!.payload.width).toBe(250);
    expect(resizeEvents[0]!.payload.previousWidth).toBe(200);
    tableCtx.cleanup();
  });

  it("resizeColumn by index should emit column:resize", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const tableCtx = createTableMockContext();

    plugin.setup!(tableCtx.ctx);

    const resizeColumn = tableCtx.methods.get("resizeColumn") as (keyOrIndex: string | number, width: number) => void;
    resizeColumn(1, 400);

    const resizeEvents = tableCtx.emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(1);
    expect(resizeEvents[0]!.payload.key).toBe("email");
    expect(resizeEvents[0]!.payload.width).toBe(400);
    tableCtx.cleanup();
  });

  it("resizeColumn with invalid key should be a no-op", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const tableCtx = createTableMockContext();

    plugin.setup!(tableCtx.ctx);

    const resizeColumn = tableCtx.methods.get("resizeColumn") as (keyOrIndex: string | number, width: number) => void;
    resizeColumn("nonexistent", 250);

    const resizeEvents = tableCtx.emitted.filter(e => e.event === "column:resize");
    expect(resizeEvents.length).toBe(0);
    tableCtx.cleanup();
  });

  it("updateColumns should rebuild header and re-render", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, dom, engineState, cleanup } = createTableMockContext();
    engineState.containerSize = 600;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    const updateColumns = methods.get("updateColumns") as (cols: TableColumn<TestItem>[]) => void;
    const newColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 150 },
      { key: "email", label: "Email", width: 350 },
    ];

    updateColumns(newColumns);

    // Header should have been rebuilt with 2 columns
    const headerCells = dom.root.querySelectorAll(".vlist-table-header-cell");
    expect(headerCells.length).toBe(2);

    // Content width should be updated
    expect(dom.content.style.minWidth).toBe("500px");

    cleanup();
  });
});

// =============================================================================
// table — Resize Handler (via plugin.hooks.onResize)
// =============================================================================

describe("table - Resize Handler", () => {
  it("should handle resize events without errors", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, engineState, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    // Update crossSize to simulate the resize context
    engineState.crossSize = 1000;

    // Should not throw
    plugin.hooks?.onResize?.(1000, 600);

    cleanup();
  });

  it("should re-resolve column widths on container resize", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200 },
      { key: "email", label: "Email" }, // flex column
    ];

    const plugin = table({ columns, rowHeight: 40 });
    const { ctx, methods, engineState, cleanup } = createTableMockContext({ containerWidth: 800 });

    plugin.setup!(ctx);

    const getLayout = methods.get("_getTableLayout") as () => any;
    const layout = getLayout();

    // Initial flex column width based on container 800 - 200 = 600
    const initialEmailWidth = layout.columns[1].width;
    expect(initialEmailWidth).toBe(600);

    // Resize container to 1000
    engineState.crossSize = 1000;
    plugin.hooks?.onResize?.(1000, 600);

    // Flex column should expand to fill: 1000 - 200 = 800
    const newEmailWidth = layout.columns[1].width;
    expect(newEmailWidth).toBe(800);

    cleanup();
  });

  it("should update content min-width after resize", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200 },
      { key: "email", label: "Email" }, // flex
    ];

    const plugin = table({ columns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    engineState.crossSize = 1200;
    plugin.hooks?.onResize?.(1200, 600);

    expect(dom.content.style.minWidth).toBe("1200px");
    cleanup();
  });
});

// =============================================================================
// table — Sort Configuration
// =============================================================================

describe("table - Sort", () => {
  it("should initialize with sort state from config", () => {
    const plugin = table<TestItem>({
      columns: [
        { key: "name", label: "Name", width: 200, sortable: true },
        { key: "email", label: "Email", width: 300, sortable: true },
      ],
      rowHeight: 40,
      sort: { key: "name", direction: "desc" },
    });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const getSort = methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    const sort = getSort();
    expect(sort.key).toBe("name");
    expect(sort.direction).toBe("desc");
    cleanup();
  });

  it("should default sort direction to asc", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const getSort = methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    const sort = getSort();
    expect(sort.key).toBeNull();
    expect(sort.direction).toBe("asc");
    cleanup();
  });
});

// =============================================================================
// table — Configuration Options
// =============================================================================

describe("table - Configuration", () => {
  it("should support function-based row height", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: (index: number) => (index % 2 === 0 ? 40 : 60),
    });
    const { ctx, dom, engineState, cleanup } = createTableMockContext();
    engineState.containerSize = 500;

    // Should not throw
    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    const rows = dom.content.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);
    cleanup();
  });

  it("should use default header height of 40 for function-based rowHeight", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: (index: number) => 40 + index,
    });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.style.getPropertyValue("--vlist-table-header-height")).toBe("40px");
    cleanup();
  });

  it("should support explicit header height", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 56,
    });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.style.getPropertyValue("--vlist-table-header-height")).toBe("56px");
    cleanup();
  });

  it("should respect resizable: false on global config", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200 },
    ];

    const plugin = table({
      columns,
      rowHeight: 40,
      resizable: false,
    });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const getLayout = methods.get("_getTableLayout") as () => any;
    const layout = getLayout();
    expect(layout.columns[0].resizable).toBe(false);
    cleanup();
  });

  it("should respect per-column resizable override", () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, resizable: false },
      { key: "email", label: "Email", width: 300, resizable: true },
    ];

    const plugin = table({
      columns,
      rowHeight: 40,
      resizable: true,
    });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const getLayout = methods.get("_getTableLayout") as () => any;
    const layout = getLayout();
    expect(layout.columns[0].resizable).toBe(false);
    expect(layout.columns[1].resizable).toBe(true);
    cleanup();
  });
});

// =============================================================================
// table — Destroy
// =============================================================================

describe("table - Destroy", () => {
  it("should remove table CSS class on destroy handler", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTableMockContext();

    plugin.setup!(ctx);
    expect(dom.root.classList.contains("vlist--table")).toBe(true);

    // Run destroy handlers
    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.root.classList.contains("vlist--table")).toBe(false);
    cleanup();
  });

  it("should remove role from root and content on destroy handler", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTableMockContext();

    plugin.setup!(ctx);
    expect(dom.root.getAttribute("role")).toBe("grid");
    expect(dom.content.getAttribute("role")).toBe("rowgroup");

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.root.getAttribute("role")).toBeNull();
    expect(dom.content.getAttribute("role")).toBeNull();
    cleanup();
  });

  it("should remove aria-colcount on destroy handler", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTableMockContext();

    plugin.setup!(ctx);
    expect(dom.root.getAttribute("aria-colcount")).toBe("3");

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.root.getAttribute("aria-colcount")).toBeNull();
    cleanup();
  });

  it("should remove header element on destroy handler", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTableMockContext();

    plugin.setup!(ctx);
    expect(dom.root.querySelector(".vlist-table-header")).not.toBeNull();

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.root.querySelector(".vlist-table-header")).toBeNull();
    cleanup();
  });

  it("should reset content min-width on destroy handler", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTableMockContext();

    plugin.setup!(ctx);
    expect(dom.content.style.minWidth).not.toBe("");

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.content.style.minWidth).toBe("");
    cleanup();
  });

  it("should clean up via plugin.destroy() method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    // Should not throw
    plugin.destroy?.();
    cleanup();
  });
});

// =============================================================================
// table — Integration
// =============================================================================

describe("table - Integration", () => {
  it("should render cells with correct content for visible rows", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({ containerSize: 120 });
    engineState.containerSize = 120; // ~3 visible rows

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // Should have rendered rows with cells
    const rows = dom.content.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);

    // Check first row has correct content
    const firstRow = rows[0]!;
    const cells = firstRow.querySelectorAll(".vlist-table-cell");
    expect(cells.length).toBe(3);
    expect(cells[0]!.textContent).toBe("User 0");
    expect(cells[1]!.textContent).toBe("user0@test.com");
    expect(cells[2]!.textContent).toBe("admin");

    cleanup();
  });

  it("should only render visible rows (virtualization works)", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({
      itemCount: 10000,
      containerSize: 200,
    });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    const rows = dom.content.querySelectorAll(".vlist-table-row");
    // With 200px container and 40px rows = 5 visible + 2 overscan each side ≈ 9
    // Should be MUCH less than 10000
    expect(rows.length).toBeLessThan(20);
    expect(rows.length).toBeGreaterThan(0);

    cleanup();
  });

  it("should re-render rows after updateColumns changes column count", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, methods, engineState, cleanup } = createTableMockContext({ containerSize: 200 });
    engineState.containerSize = 200;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // Verify 3 cells per row initially
    let firstRow = dom.content.querySelector(".vlist-table-row")!;
    expect(firstRow.querySelectorAll(".vlist-table-cell").length).toBe(3);

    // Update to 2 columns
    const updateColumns = methods.get("updateColumns") as Function;
    updateColumns([
      { key: "name", label: "Name", width: 400 },
      { key: "email", label: "Email", width: 400 },
    ]);

    // After update, rows are cleared and re-rendered with new column count.
    const rows = dom.content.querySelectorAll(".vlist-table-row");
    expect(rows.length).toBeGreaterThan(0);

    // Each row should now have exactly 2 cells
    for (const row of rows) {
      expect(row.querySelectorAll(".vlist-table-cell").length).toBe(2);
    }

    // Header should also have 2 cells
    const headerCells = dom.root.querySelectorAll(".vlist-table-header-cell");
    expect(headerCells.length).toBe(2);

    // Content width should reflect new total: 400 + 400 = 800
    expect(dom.content.style.minWidth).toBe("800px");

    cleanup();
  });

  it("should work with selection getters when selection plugin is present", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, engineState, cleanup } = createTableMockContext({ containerSize: 200 });
    engineState.containerSize = 200;

    // Simulate selection plugin registering methods
    const selectedIds = new Set<string | number>([0, 2]);
    ctx.registerMethod("_getSelectedIds", () => selectedIds);
    ctx.registerMethod("_getFocusedIndex", () => 0);

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    // Row 0 should be selected and focused
    const row0 = dom.content.querySelector(".vlist-table-row[data-index='0']") as HTMLElement;
    expect(row0).not.toBeNull();
    expect(row0.classList.contains("vlist-item--selected")).toBe(true);
    expect(row0.classList.contains("vlist-item--focused")).toBe(true);

    // Row 1 should not be selected
    const row1 = dom.content.querySelector(".vlist-table-row[data-index='1']") as HTMLElement;
    if (row1) {
      expect(row1.classList.contains("vlist-item--selected")).toBe(false);
      expect(row1.classList.contains("vlist-item--focused")).toBe(false);
    }

    // Row 2 should be selected but not focused
    const row2 = dom.content.querySelector(".vlist-table-row[data-index='2']") as HTMLElement;
    if (row2) {
      expect(row2.classList.contains("vlist-item--selected")).toBe(true);
      expect(row2.classList.contains("vlist-item--focused")).toBe(false);
    }

    cleanup();
  });

  it("should add column-borders class when columnBorders is true", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
      columnBorders: true,
    });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    expect(dom.root.classList.contains("vlist--table-col-borders")).toBe(true);
    cleanup();
  });

  it("should sync header scroll with viewport scrollLeft via hooks.onAfterScroll", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    // Simulate horizontal scroll on viewport
    Object.defineProperty(dom.viewport, "scrollLeft", {
      value: 50,
      configurable: true,
    });

    // Trigger onAfterScroll hook
    plugin.hooks?.onAfterScroll?.(0, 0);

    // The header scroll container should have been synced
    const scrollContainer = dom.root.querySelector(".vlist-table-header-scroll") as HTMLElement;
    if (scrollContainer) {
      expect(scrollContainer.style.transform).toContain("translateX");
    }
    cleanup();
  });

  it("should restore sort indicator after updateColumns when sort is active", () => {
    const sortableColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, sortable: true },
      { key: "email", label: "Email", width: 300, sortable: true },
    ];
    const plugin = table({
      columns: sortableColumns,
      rowHeight: 40,
      sort: { key: "name", direction: "desc" },
    });
    const { ctx, methods, dom, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    // Verify initial sort
    const getSort = methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    expect(getSort().key).toBe("name");

    // Update columns — sort indicator should be restored
    const updateColumns = methods.get("updateColumns") as Function;
    updateColumns([
      { key: "name", label: "Full Name", width: 250, sortable: true },
      { key: "email", label: "E-mail", width: 350, sortable: true },
    ]);

    // Sort state should be preserved
    expect(getSort().key).toBe("name");
    expect(getSort().direction).toBe("desc");

    // Header should show sort indicator on name column
    const headerCells = dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameCell = headerCells[0] as HTMLElement;
    expect(nameCell.getAttribute("aria-sort")).toBe("descending");

    cleanup();
  });

  it("should emit column:sort when sortable header cell is clicked", () => {
    const sortableColumns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 200, sortable: true },
      { key: "email", label: "Email", width: 300, sortable: true },
    ];
    const plugin = table({ columns: sortableColumns, rowHeight: 40 });
    const tableCtx = createTableMockContext();

    plugin.setup!(tableCtx.ctx);

    // Click on a sortable header cell to trigger sort
    const headerCells = tableCtx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameHeader = headerCells[0] as HTMLElement;

    const clickEvt = new MouseEvent("click", { bubbles: true });
    nameHeader.dispatchEvent(clickEvt);

    const sortEvents = tableCtx.emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(1);
    expect(sortEvents[0]!.payload.key).toBe("name");
    expect(sortEvents[0]!.payload.direction).toBe("asc");

    // Check getSort reflects the new state
    const getSort = tableCtx.methods.get("getSort") as () => { key: string | null; direction: "asc" | "desc" };
    expect(getSort().key).toBe("name");
    expect(getSort().direction).toBe("asc");

    tableCtx.cleanup();
  });

  it("should expose _updateTableForGroups method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, engineState, cleanup } = createTableMockContext();
    engineState.containerSize = 600;

    plugin.setup!(ctx);
    ctx.renderIfNeeded();

    const updateForGroups = methods.get("_updateTableForGroups") as Function;
    expect(updateForGroups).toBeDefined();

    // Call it with a header check function
    updateForGroups(
      (item: any) => item._isGroupHeader === true,
      (key: string) => `<div class="group">${key}</div>`,
    );

    cleanup();
  });

  it("should expose _replaceTableRenderer method", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, methods, cleanup } = createTableMockContext();

    plugin.setup!(ctx);

    const replaceRenderer = methods.get("_replaceTableRenderer") as Function;
    expect(replaceRenderer).toBeDefined();

    // Should accept a mock renderer
    const mockRenderer = {
      render: () => {},
      updateColumnLayout: () => {},
      clear: () => {},
      destroy: () => {},
      setGroupHeaderFn: () => {},
      updateItem: () => {},
      updateItemClasses: () => {},
      getElement: () => undefined,
    };
    expect(() => replaceRenderer(mockRenderer)).not.toThrow();

    cleanup();
  });
});
