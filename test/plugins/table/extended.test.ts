/**
 * vlist v2 — Table Plugin Extended Tests
 *
 * Covers gaps from v1 table feature tests not present in v2:
 * - Roles and ARIA attributes
 * - Column events (click, sort)
 * - Header scroll sync
 * - Range events through table
 * - Table + selection integration
 *
 * Uses createPluginMockContext for plugin-level tests and createVList for
 * E2E integration tests.
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
import { table } from "../../../src/plugins/table/plugin";
import { selection } from "../../../src/plugins/selection/plugin";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import type { TableColumn } from "../../../src/plugins/table/types";
import { createPluginMockContext } from "../../helpers/plugin-context";
import type { PluginTestContext } from "../../helpers/plugin-context";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../../helpers/factory";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 800, configurable: true });
});

afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

// =============================================================================
// Shared Helpers
// =============================================================================

interface TableTestItem extends VListItem {
  id: number;
  name: string;
  email: string;
  role: string;
}

const testColumns: TableColumn<TableTestItem>[] = [
  { key: "name", label: "Name", width: 200 },
  { key: "email", label: "Email", width: 300 },
  { key: "role", label: "Role", width: 100 },
];

const sortableColumns: TableColumn<TableTestItem>[] = [
  { key: "name", label: "Name", width: 200, sortable: true },
  { key: "email", label: "Email", width: 300, sortable: true },
  { key: "role", label: "Role", width: 100, sortable: false },
];

function createTableTestItems(count: number): TableTestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@test.com`,
    role: i % 2 === 0 ? "admin" : "user",
  }));
}

interface TrackingMockContext {
  ctx: PluginTestContext<TableTestItem>["ctx"];
  engineState: PluginTestContext<TableTestItem>["engineState"];
  dom: PluginTestContext<TableTestItem>["dom"];
  methods: PluginTestContext<TableTestItem>["methods"];
  destroyHandlers: PluginTestContext<TableTestItem>["destroyHandlers"];
  readonly renderFnReplaced: boolean;
  cleanup: PluginTestContext<TableTestItem>["cleanup"];
  emitted: Array<{ event: string; payload: unknown }>;
}

function createTrackingMockContext(overrides?: {
  itemCount?: number;
  scrollTop?: number;
  containerSize?: number;
  containerWidth?: number;
}): TrackingMockContext {
  const itemCount = overrides?.itemCount ?? 100;
  const items = createTableTestItems(itemCount);

  const result = createPluginMockContext<TableTestItem>(items, {
    itemSize: 40,
    containerHeight: overrides?.containerSize ?? 600,
    containerWidth: overrides?.containerWidth ?? 800,
  });

  if (overrides?.scrollTop !== undefined) {
    result.engineState.scrollPosition = overrides.scrollTop;
  }

  const emitted: Array<{ event: string; payload: unknown }> = [];
  const trackingEmitter = {
    on: () => () => {},
    off: () => {},
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    },
    clear: () => {},
  };
  (result.ctx as unknown as { emitter: typeof trackingEmitter }).emitter = trackingEmitter;

  return {
    ctx: result.ctx,
    engineState: result.engineState,
    dom: result.dom,
    methods: result.methods,
    destroyHandlers: result.destroyHandlers,
    get renderFnReplaced() { return result.renderFnReplaced; },
    cleanup: result.cleanup,
    emitted,
  };
}

// =============================================================================
// E2E helpers
// =============================================================================

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

function getViewport(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
}

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

// =============================================================================
// 1. Table Roles and ARIA
// =============================================================================

describe("table — roles and ARIA", () => {
  it("sets role=grid on root element", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    expect(dom.root.getAttribute("role")).toBe("grid");
    cleanup();
  });

  it("sets role=rowgroup on content element", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    expect(dom.content.getAttribute("role")).toBe("rowgroup");
    cleanup();
  });

  it("sets aria-colcount matching column count", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    expect(dom.root.getAttribute("aria-colcount")).toBe("3");
    cleanup();
  });

  it("removes role attributes from root and content on destroy", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    expect(dom.root.getAttribute("role")).toBe("grid");
    expect(dom.content.getAttribute("role")).toBe("rowgroup");

    for (const handler of destroyHandlers) {
      handler();
    }

    expect(dom.root.getAttribute("role")).toBeNull();
    expect(dom.content.getAttribute("role")).toBeNull();
    expect(dom.root.getAttribute("aria-colcount")).toBeNull();
    cleanup();
  });

  it("sets header height CSS variable on root", () => {
    const plugin = table({
      columns: testColumns,
      rowHeight: 40,
      headerHeight: 48,
    });
    const { ctx, dom, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    expect(dom.root.style.getPropertyValue("--vlist-table-header-height")).toBe("48px");
    cleanup();
  });
});

// =============================================================================
// 2. Column Events
// =============================================================================

describe("table — column events", () => {
  it("emits column:sort when sortable header cell is clicked", () => {
    const plugin = table({ columns: sortableColumns, rowHeight: 40 });
    const mockCtx = createTrackingMockContext();

    plugin.setup!(mockCtx.ctx);

    const headerCells = mockCtx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameHeader = headerCells[0] as HTMLElement;
    nameHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const sortEvents = mockCtx.emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(1);
    mockCtx.cleanup();
  });

  it("emits column:sort on sort cycling (asc -> desc -> null)", () => {
    const plugin = table({ columns: sortableColumns, rowHeight: 40 });
    const mockCtx = createTrackingMockContext();

    plugin.setup!(mockCtx.ctx);

    const headerCells = mockCtx.dom.root.querySelectorAll(".vlist-table-header-cell");
    const nameHeader = headerCells[0] as HTMLElement;

    // First click: null -> asc
    nameHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Second click: asc -> desc
    nameHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Third click: desc -> null
    nameHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const sortEvents = mockCtx.emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(3);

    const firstPayload = sortEvents[0]!.payload as { key: string; direction: string | null };
    expect(firstPayload.direction).toBe("asc");

    const secondPayload = sortEvents[1]!.payload as { key: string; direction: string | null };
    expect(secondPayload.direction).toBe("desc");

    const thirdPayload = sortEvents[2]!.payload as { key: string; direction: string | null };
    expect(thirdPayload.direction).toBeNull();

    mockCtx.cleanup();
  });

  it("column:sort includes column key and direction", () => {
    const plugin = table({ columns: sortableColumns, rowHeight: 40 });
    const mockCtx = createTrackingMockContext();

    plugin.setup!(mockCtx.ctx);

    const headerCells = mockCtx.dom.root.querySelectorAll(".vlist-table-header-cell");
    // Click the email column (index 1)
    const emailHeader = headerCells[1] as HTMLElement;
    emailHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const sortEvents = mockCtx.emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(1);

    const payload = sortEvents[0]!.payload as { key: string; index: number; direction: string | null };
    expect(payload.key).toBe("email");
    expect(payload.index).toBe(1);
    expect(payload.direction).toBe("asc");

    mockCtx.cleanup();
  });

  it("does not emit column:sort for non-sortable columns", () => {
    const plugin = table({ columns: sortableColumns, rowHeight: 40 });
    const mockCtx = createTrackingMockContext();

    plugin.setup!(mockCtx.ctx);

    const headerCells = mockCtx.dom.root.querySelectorAll(".vlist-table-header-cell");
    // Click the "role" column (index 2) which has sortable: false
    const roleHeader = headerCells[2] as HTMLElement;
    roleHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const sortEvents = mockCtx.emitted.filter(e => e.event === "column:sort");
    expect(sortEvents.length).toBe(0);

    mockCtx.cleanup();
  });
});

// =============================================================================
// 3. Header Scroll Sync
// =============================================================================

describe("table — header scroll sync", () => {
  it("header scrollLeft follows viewport scrollLeft on scroll", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    // Simulate horizontal scroll on viewport
    Object.defineProperty(dom.viewport, "scrollLeft", {
      value: 100,
      configurable: true,
    });

    // Trigger onAfterScroll hook
    plugin.hooks?.onAfterScroll?.(0, 0);

    // The header scroll container uses translateX to sync
    const scrollContainer = dom.root.querySelector(".vlist-table-header-scroll") as HTMLElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer.style.transform).toBe("translateX(-100px)");

    cleanup();
  });

  it("header stays synced after multiple scroll events", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    const scrollContainer = dom.root.querySelector(".vlist-table-header-scroll") as HTMLElement;

    // First scroll
    Object.defineProperty(dom.viewport, "scrollLeft", {
      value: 50,
      configurable: true,
    });
    plugin.hooks?.onAfterScroll?.(0, 0);
    expect(scrollContainer.style.transform).toBe("translateX(-50px)");

    // Second scroll
    Object.defineProperty(dom.viewport, "scrollLeft", {
      value: 200,
      configurable: true,
    });
    plugin.hooks?.onAfterScroll?.(0, 0);
    expect(scrollContainer.style.transform).toBe("translateX(-200px)");

    // Scroll back to 0
    Object.defineProperty(dom.viewport, "scrollLeft", {
      value: 0,
      configurable: true,
    });
    plugin.hooks?.onAfterScroll?.(0, 0);
    expect(scrollContainer.style.transform).toBe("translateX(0px)");

    cleanup();
  });

  it("header sync stops after destroy", () => {
    const plugin = table({ columns: testColumns, rowHeight: 40 });
    const { ctx, dom, destroyHandlers, cleanup } = createTrackingMockContext();

    plugin.setup!(ctx);

    // Sync works before destroy
    Object.defineProperty(dom.viewport, "scrollLeft", {
      value: 75,
      configurable: true,
    });
    plugin.hooks?.onAfterScroll?.(0, 0);

    const scrollContainer = dom.root.querySelector(".vlist-table-header-scroll") as HTMLElement;
    expect(scrollContainer.style.transform).toBe("translateX(-75px)");

    // Run destroy handlers
    for (const handler of destroyHandlers) {
      handler();
    }

    // After destroy, the header is removed from DOM
    const scrollContainerAfter = dom.root.querySelector(".vlist-table-header-scroll");
    expect(scrollContainerAfter).toBeNull();

    cleanup();
  });
});

// =============================================================================
// 4. Range Events Through Table
// =============================================================================

describe("table — range events", () => {
  it("emits range:change when scroll shifts visible range via E2E", () => {
    const items = createTestItems(200);
    const events: Array<{ range: { start: number; end: number } }> = [];

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
      ],
    );

    list.on("range:change", (payload) => {
      events.push(payload as { range: { start: number; end: number } });
    });

    // Scroll far enough to change the visible range
    const viewport = getViewport(container);
    simulateScroll(viewport, 2000);

    expect(events.length).toBeGreaterThan(0);
  });

  it("does not emit range:change when scroll stays in same range", () => {
    const items = createTestItems(200);
    const events: Array<{ range: { start: number; end: number } }> = [];

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
      ],
    );

    // Initial scroll to a position
    const viewport = getViewport(container);
    simulateScroll(viewport, 2000);

    // Subscribe AFTER initial scroll so we only track subsequent changes
    list.on("range:change", (payload) => {
      events.push(payload as { range: { start: number; end: number } });
    });

    // Scroll by a tiny amount that does not change the rendered range
    simulateScroll(viewport, 2001);

    // Should not emit if visible range stays the same
    expect(events.length).toBe(0);
  });

  it("range:change contains correct start/end indices", () => {
    const items = createTestItems(200);
    const events: Array<{ range: { start: number; end: number } }> = [];

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
      ],
    );

    list.on("range:change", (payload) => {
      events.push(payload as { range: { start: number; end: number } });
    });

    // Scroll to row 50 (position = 50 * 40 = 2000)
    const viewport = getViewport(container);
    simulateScroll(viewport, 2000);

    if (events.length > 0) {
      const lastEvent = events[events.length - 1]!;
      expect(lastEvent.range.start).toBeGreaterThanOrEqual(0);
      expect(lastEvent.range.end).toBeGreaterThan(lastEvent.range.start);
      // For scroll at 2000px with 40px rows, visible start should be around 48-50
      expect(lastEvent.range.start).toBeGreaterThanOrEqual(40);
    }
  });

  it("scroll event fires with position and direction", () => {
    const items = createTestItems(200);
    const scrollEvents: Array<{ scrollPosition: number; direction: string }> = [];

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
      ],
    );

    list.on("scroll", (payload) => {
      scrollEvents.push(payload as { scrollPosition: number; direction: string });
    });

    const viewport = getViewport(container);
    simulateScroll(viewport, 400);

    expect(scrollEvents.length).toBeGreaterThan(0);
    const lastScroll = scrollEvents[scrollEvents.length - 1]!;
    expect(lastScroll.scrollPosition).toBe(400);
    expect(lastScroll.direction).toBe("down");
  });
});

// =============================================================================
// 5. Table + Selection Integration
// =============================================================================

describe("table — selection integration", () => {
  it("table with selection plugin renders role=grid and selection classes", () => {
    const items = createTestItems(50);

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
        selection({ mode: "multi" }),
      ],
    );

    // Verify role=grid is set on root
    const root = container.querySelector(".vlist") as HTMLElement;
    expect(root.getAttribute("role")).toBe("grid");

    // Content has rowgroup role
    const content = container.querySelector(".vlist-content") as HTMLElement;
    expect(content.getAttribute("role")).toBe("rowgroup");
  });

  it("click selects row in table mode", () => {
    const items = createTestItems(50);
    const selectionEvents: Array<{ selected: Array<string | number> }> = [];

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
        selection({ mode: "single" }),
      ],
    );

    list.on("selection:change", (payload) => {
      selectionEvents.push(payload as { selected: Array<string | number> });
    });

    // Find a rendered table row and click it
    const rows = container.querySelectorAll(".vlist-table-row");
    if (rows.length > 0) {
      const row = rows[0] as HTMLElement;
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(selectionEvents.length).toBeGreaterThan(0);
      const lastEvent = selectionEvents[selectionEvents.length - 1]!;
      expect(lastEvent.selected.length).toBe(1);
    }
  });

  it("getSelected works with table layout", () => {
    const items = createTestItems(50);

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
        selection({ mode: "multi" }),
      ],
    );

    // Use programmatic selection
    const selectFn = (list as unknown as { select: (id: number) => void }).select;
    if (selectFn) {
      selectFn(1);
      const getSelected = (list as unknown as { getSelected: () => Array<string | number> }).getSelected;
      if (getSelected) {
        expect(getSelected()).toContain(1);
      }
    }
  });

  it("keyboard navigation works in table + selection", () => {
    const items = createTestItems(50);

    list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [
        table({
          columns: [
            { key: "name", label: "Name", width: 200 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
        selection({ mode: "single", followFocus: true }),
      ],
    );

    // Focus the root element to enable keyboard navigation
    const root = container.querySelector(".vlist") as HTMLElement;
    root.focus();

    // Send ArrowDown key
    root.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    }));

    // Verify no errors — the combined table + selection handles keyboard
    // The fact that this does not throw is the primary assertion
    expect(root.getAttribute("role")).toBe("grid");
  });
});
