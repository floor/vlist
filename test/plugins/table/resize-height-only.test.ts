/**
 * vlist — Table: column widths across viewport changes
 *
 * Core calls the resize hooks when EITHER viewport axis changes. On a
 * classic-scrollbar platform a horizontal scrollbar appearing or disappearing
 * changes the content box on the main axis only — and the table's handler used
 * to re-resolve every column from its definition, discarding a width the user
 * had just dragged (#31, part b).
 *
 * These tests drive the real core ResizeObserver path: a controllable observer
 * stands in for the browser's, so the hook receives exactly what core passes
 * it. Overlay-scrollbar hosts (like the one this suite runs on) cannot show the
 * crossing itself, so the measured mechanism is pinned instead: a height-only
 * change must not move user widths.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createTestItems, createContainer } from "../../helpers/factory";
import { createPluginMockContext } from "../../helpers/plugin-context";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import { table } from "../../../src/plugins/table/plugin";
import { groups } from "../../../src/plugins/groups";
import type { VListPlugin } from "../../../src/core/types";
import type { TableColumn } from "../../../src/plugins/table/types";

beforeAll(() => {
  setupDOM({ immediateResize: false });
});

beforeEach(() => {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = ControlledResizeObserver;
});

afterAll(() => {
  teardownDOM();
});

// =============================================================================
// Controllable ResizeObserver
//
// Keyed by the element it observes, never by construction order: the suite
// runs with `--concurrent`, so several tests build lists at the same time and
// a shared "latest instance" list would hand a test another test's observer.
// =============================================================================

class ControlledResizeObserver {
  static readonly byTarget = new Map<Element, ControlledResizeObserver>();

  readonly callback: ResizeObserverCallback;
  target: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.target = target;
    ControlledResizeObserver.byTarget.set(target, this);
  }

  unobserve(target: Element): void {
    if (ControlledResizeObserver.byTarget.get(target) === this) {
      ControlledResizeObserver.byTarget.delete(target);
    }
  }

  disconnect(): void {
    if (this.target) this.unobserve(this.target);
  }

  /** The observer core created for this container's viewport. */
  static forContainer(container: HTMLElement): ControlledResizeObserver {
    const viewport = container.querySelector(".vlist-viewport");
    if (!viewport) throw new Error("vlist viewport not found in container");
    const observer = ControlledResizeObserver.byTarget.get(viewport);
    if (!observer) throw new Error("vlist did not observe this container's viewport");
    return observer;
  }

  /** Deliver a content-box size the way the browser's observer would. */
  fire(width: number, height: number): void {
    this.callback(
      [
        {
          target: this.target,
          contentRect: {
            width,
            height,
            top: 0,
            left: 0,
            bottom: height,
            right: width,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const COLUMNS: TableColumn<TestItem>[] = [
  { key: "name", label: "Name", width: 350, minWidth: 140 },
  { key: "size", label: "Size", width: 100, minWidth: 70 },
  { key: "modified", label: "Date Modified", width: 200, minWidth: 120 },
  { key: "kind", label: "Kind", width: 140, minWidth: 80 },
];

const template = (item: TestItem): string =>
  COLUMNS.map((c) => `<span class="cell">${String(item[c.key] ?? "")}</span>`).join("");

type TableList = {
  resizeColumn(keyOrIndex: string | number, width: number): void;
  getColumnWidths(): Record<string, number>;
  updateColumns(columns: TableColumn<TestItem>[]): void;
  destroy(): void;
};

interface Scenario {
  /** Viewport content-box width the observer reports. */
  crossWidth: number;
  groupBy?: boolean;
  fillWidth?: boolean | "stretch" | "spacer";
  columns?: TableColumn<TestItem>[];
}

async function setup(options: Scenario) {
  const container = createContainer({ width: 500, height: 500 });
  const items = createTestItems(200).map((it) => ({
    ...it,
    size: `${it.value} B`,
    modified: "2026-10-20",
    kind: it.value! % 2 ? "Folder" : "File",
  }));

  const columns = options.columns ?? COLUMNS;
  const tablePlugin = table<TestItem>({
    columns,
    rowHeight: 28,
    headerHeight: 28,
    resizable: true,
    columnBorders: false,
    rowBorders: false,
    minColumnWidth: 50,
    ...(options.fillWidth !== undefined ? { fillWidth: options.fillWidth } : {}),
  });

  const plugins: VListPlugin<TestItem>[] = [tablePlugin];
  if (options.groupBy) {
    plugins.push(
      groups<TestItem>({
        getGroupForIndex: (i: number) => (i < 100 ? "A" : "B"),
        header: { height: 32, template: (k: string) => `<div>${k}</div>` },
        sticky: false,
      }),
    );
  }

  const list = createVList<TestItem>(
    {
      container,
      items,
      item: { height: 28, template },
      padding: [2, 6],
    },
    plugins,
  );
  await flush();

  const observer = ControlledResizeObserver.forContainer(container);
  // The viewport box the browser would report once laid out.
  observer.fire(options.crossWidth, 500);
  await flush();

  const content = container.querySelector<HTMLElement>(".vlist-content")!;

  return {
    container,
    content,
    observer,
    list: list as unknown as TableList,
    widths: (): Record<string, number> => (list as unknown as TableList).getColumnWidths(),
    minWidth: (): string => content.style.minWidth,
    drag(columnIndex: number, width: number): Promise<void> {
      (list as unknown as TableList).resizeColumn(columnIndex, width);
      return flush();
    },
  };
}

// =============================================================================
// Height-only viewport changes keep user widths
// =============================================================================

describe("table — height-only viewport change", () => {
  it("keeps a dragged column width (fillWidth: false)", async () => {
    const s = await setup({ crossWidth: 500, fillWidth: false });
    await s.drag(0, 400);
    await s.drag(0, 300);

    expect(s.widths().name).toBe(300);
    expect(s.minWidth()).toBe("740px");

    // Horizontal scrollbar appears: the viewport loses height, not width.
    s.observer.fire(500, 492);
    await flush();

    expect(s.widths().name).toBe(300);
    expect(s.widths().size).toBe(100);
    expect(s.minWidth()).toBe("740px");
    s.list.destroy();
  });

  it("keeps a dragged column width with grouped rows", async () => {
    const s = await setup({ crossWidth: 500, fillWidth: false, groupBy: true });
    await s.drag(0, 400);
    await s.drag(0, 300);

    expect(s.widths().name).toBe(300);
    expect(s.minWidth()).toBe("740px");

    s.observer.fire(500, 484);
    await flush();

    expect(s.widths().name).toBe(300);
    expect(s.minWidth()).toBe("740px");
    s.list.destroy();
  });

  it("keeps a dragged column width in spacer fill mode", async () => {
    // Default fill: columns span the extra space with a trailing spacer.
    const s = await setup({ crossWidth: 1000 });
    await s.drag(0, 300);

    expect(s.widths().name).toBe(300);
    expect(s.minWidth()).toBe("1000px");

    s.observer.fire(1000, 492);
    await flush();

    expect(s.widths().name).toBe(300);
    expect(s.minWidth()).toBe("1000px");
    s.list.destroy();
  });

  it("keeps a dragged column width in stretch fill mode", async () => {
    const s = await setup({ crossWidth: 1000, fillWidth: true });
    await s.drag(0, 300);

    expect(s.widths().name).toBe(300);
    // The other columns keep the widths stretch gave them; only Name moved.
    const afterDragMinWidth = s.minWidth();

    s.observer.fire(1000, 492);
    await flush();

    expect(s.widths().name).toBe(300);
    expect(s.minWidth()).toBe(afterDragMinWidth);
    s.list.destroy();
  });
});

// =============================================================================
// The initial observation core dedupes
//
// In a browser the first ResizeObserver entry normally matches the viewport's
// client box, so core's dedupe (create.ts) skips the hook entirely. The plugin
// resolved its layout against the real cross size at setup; that resolve must
// count as the width the layout was resolved at, or the first height-only
// change after a drag re-resolves and discards it. The mock context sets the
// engine's cross size exactly as core does before the observer exists.
// =============================================================================

describe("table — initial observation deduped by core", () => {
  it("keeps a dragged width on the first height-only change", () => {
    const plugin = table<TestItem>({
      columns: COLUMNS,
      rowHeight: 28,
      headerHeight: 28,
      resizable: true,
      fillWidth: false,
    });
    const { ctx, methods, cleanup } = createPluginMockContext<TestItem>(
      createTestItems(200),
      { containerWidth: 500, itemSize: 28 },
    );
    plugin.setup!(ctx);

    const resizeColumn = methods.get("resizeColumn") as (i: number, w: number) => void;
    const widths = methods.get("getColumnWidths") as () => Record<string, number>;

    resizeColumn(0, 300);
    expect(widths().name).toBe(300);

    // No onResize has run: core skipped the entry that matched the viewport.
    // A horizontal scrollbar appears — the height changes, the width does not.
    plugin.hooks?.onResize?.(500, 492);

    expect(widths().name).toBe(300);
    cleanup();
  });
});

// =============================================================================
// The other resize paths still re-resolve
// =============================================================================

describe("table — genuine resizes still re-resolve", () => {
  it("re-resolves flex columns when the viewport width changes", async () => {
    const columns: TableColumn<TestItem>[] = [
      { key: "name", label: "Name", width: 350, minWidth: 140 },
      { key: "extra", label: "Extra", minWidth: 70 },
    ];
    const flexTemplate = (item: TestItem): string =>
      columns.map((c) => `<span class="cell">${String(item[c.key] ?? "")}</span>`).join("");

    const container = createContainer({ width: 500, height: 500 });
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(50),
        item: { height: 28, template: flexTemplate },
        padding: [2, 6],
      },
      [table<TestItem>({ columns, rowHeight: 28, headerHeight: 28, fillWidth: false })],
    );
    await flush();
    const observer = ControlledResizeObserver.forContainer(container);
    observer.fire(500, 500);
    await flush();

    const tableList = list as unknown as TableList;
    expect(tableList.getColumnWidths().extra).toBe(150);

    tableList.resizeColumn(0, 300);
    await flush();
    expect(tableList.getColumnWidths().name).toBe(300);
    expect(tableList.getColumnWidths().extra).toBe(150);

    // A genuine window resize changes both axes; the layout re-resolves.
    observer.fire(700, 480);
    await flush();

    expect(tableList.getColumnWidths().name).toBe(350);
    expect(tableList.getColumnWidths().extra).toBe(350);
    tableList.destroy();
  });

  it("re-resolves to the new definitions on updateColumns", async () => {
    const s = await setup({ crossWidth: 500, fillWidth: false });
    await s.drag(0, 300);
    expect(s.widths().name).toBe(300);

    s.list.updateColumns([
      { key: "name", label: "Name", width: 250, minWidth: 140 },
      ...COLUMNS.slice(1),
    ]);
    await flush();

    expect(s.widths().name).toBe(250);
    expect(s.minWidth()).toBe("690px");
    s.list.destroy();
  });
});
