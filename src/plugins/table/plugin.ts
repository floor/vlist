/**
 * vlist v2 — Table Plugin
 *
 * Switches from list layout to a data table with columns, resizable headers,
 * sticky header row, and cell-based rendering.
 *
 * Priority 10 — runs before selection (50) so layout is ready.
 *
 * Restrictions:
 * - Cannot be combined with grid or masonry plugins
 * - Cannot be combined with horizontal orientation
 * - Cannot be combined with reverse mode
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";

import { createTableLayout } from "./layout";
import { createTableHeader } from "./header";
import { createTableRenderer, type TableRendererInstance } from "./renderer";

import type {
  TableConfig,
  TableColumn,
  TableLayout,
  ColumnResizeEvent,
  ColumnSortEvent,
} from "./types";

// =============================================================================
// Config
// =============================================================================

const EMPTY_ID_SET: Set<string | number> = new Set();

export interface TablePluginConfig<T extends VListItem = VListItem> extends TableConfig<T> {}

// =============================================================================
// Factory
// =============================================================================

export function table<T extends VListItem = VListItem>(
  config: TablePluginConfig<T>,
): VListPlugin<T> {
  if (!config.columns?.length) {
    throw new Error("[vlist] table: columns must be a non-empty array");
  }

  if (config.rowHeight === undefined && config.estimatedRowHeight === undefined) {
    throw new Error("[vlist] table: either rowHeight or estimatedRowHeight is required");
  }

  let tableLayout: TableLayout<T> | null = null;
  let tableHeader: ReturnType<typeof createTableHeader<T>> | null = null;
  let tableRenderer: TableRendererInstance<T> | null = null;
  let engineState: EngineState;
  let sizeCache: SizeCache;
  let storedCtx: PluginContext<T> | null = null;

  let selectedIdsGetter: (() => Set<string | number>) | null = null;
  let focusedIndexGetter: (() => number) | null = null;
  let selectionResolved = false;

  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let lastTotalItems = -1;
  let forceNextRender = true;
  let lastAriaRowCount = -1;

  function resolveSelectionMethods(): void {
    if (selectionResolved || !storedCtx) return;
    selectionResolved = true;
    selectedIdsGetter = (storedCtx.getMethod("_getSelectedIds") as (() => Set<string | number>)) ?? null;
    focusedIndexGetter = (storedCtx.getMethod("_getFocusedIndex") as (() => number)) ?? null;
  }

  // =========================================================================
  // Render Functions
  // =========================================================================

  function tableRenderIfNeeded(): void {
    if (engineState.destroyed || !storedCtx || !tableRenderer || !tableLayout) return;

    const scrollPos = engineState.scrollPosition;
    const containerSize = engineState.containerSize;
    const totalItems = engineState.totalItems;

    if (
      !forceNextRender &&
      scrollPos === lastScrollPosition &&
      containerSize === lastContainerSize &&
      totalItems === lastTotalItems
    ) {
      return;
    }
    lastScrollPosition = scrollPos;
    lastContainerSize = containerSize;
    lastTotalItems = totalItems;
    forceNextRender = false;

    if (containerSize <= 0 || totalItems === 0) return;

    // Update aria-rowcount when item count changes (+1 for header row)
    const ariaRowCount = totalItems + 1;
    if (ariaRowCount !== lastAriaRowCount) {
      lastAriaRowCount = ariaRowCount;
      storedCtx.dom.root.setAttribute("aria-rowcount", `${ariaRowCount}`);
    }

    // Calculate visible range
    let visStart = sizeCache.indexAtOffset(scrollPos);
    let visEnd = sizeCache.indexAtOffset(scrollPos + containerSize);
    if (visEnd < totalItems - 1) visEnd++;
    visStart = Math.max(0, visStart);
    visEnd = Math.min(totalItems - 1, visEnd);

    const overscan = storedCtx.config.overscan;
    const renderStart = Math.max(0, visStart - overscan);
    const renderEnd = Math.min(totalItems - 1, visEnd + overscan);

    if (
      renderStart === engineState.prevRangeStart &&
      renderEnd === engineState.prevRangeEnd &&
      !engineState.renderPending
    ) {
      return;
    }

    resolveSelectionMethods();
    const selectedIds = selectedIdsGetter?.() ?? EMPTY_ID_SET;
    const focusedIndex = focusedIndexGetter?.() ?? -1;

    const rangeItems: T[] = [];
    for (let i = renderStart; i <= renderEnd; i++) {
      const item = storedCtx.getItem(i);
      if (item) rangeItems.push(item);
    }

    const range = { start: renderStart, end: renderEnd };
    tableRenderer.render(rangeItems, range, selectedIds, focusedIndex);

    // Update engine state
    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    engineState.renderPending = false;

    const count = renderEnd - renderStart + 1;
    engineState.visibleCount = Math.min(count, engineState.capacity);
    engineState.startIndex = renderStart;
    for (let i = 0; i < engineState.visibleCount; i++) {
      const idx = renderStart + i;
      engineState.visibleIndices[i] = idx;
      engineState.visibleOffsets[i] = sizeCache.getOffset(idx);
      engineState.visibleSizes[i] = sizeCache.getSize(idx);
    }

    // Update content size
    storedCtx.dom.content.style.height = sizeCache.getTotalSize() + "px";
  }

  function tableForceRender(): void {
    if (engineState.destroyed) return;
    engineState.prevRangeStart = -1;
    engineState.prevRangeEnd = -1;
    engineState.renderPending = true;
    forceNextRender = true;
    tableRenderIfNeeded();
  }

  // =========================================================================
  // Plugin
  // =========================================================================

  return {
    name: "table",
    priority: 10,
    conflicts: ["grid", "masonry"],

    setup(ctx: PluginContext<T>): void {
      storedCtx = ctx;
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;

      const { dom, config: resolvedConfig, emitter } = ctx;
      const { classPrefix } = resolvedConfig;

      if (resolvedConfig.horizontal) {
        throw new Error("[vlist] table: cannot be used with horizontal orientation");
      }
      if (resolvedConfig.reverse) {
        throw new Error("[vlist] table: cannot be used with reverse mode");
      }

      // ── Resolve config ──────────────────────────────────────────
      const resizable = config.resizable ?? true;
      const minColumnWidth = config.minColumnWidth ?? 50;
      const maxColumnWidth = config.maxColumnWidth ?? Infinity;
      const rowBorders = config.rowBorders ?? true;
      const rowHeight = config.rowHeight;

      const headerHeight = config.headerHeight ??
        (typeof rowHeight === "number" ? rowHeight : 40);

      // ── Sort state ──────────────────────────────────────────────
      let sortKey: string | null = config.sort?.key ?? null;
      let sortDirection: "asc" | "desc" = config.sort?.direction ?? "asc";

      // ── Create table layout ─────────────────────────────────────
      tableLayout = createTableLayout<T>(
        config.columns,
        minColumnWidth,
        maxColumnWidth,
        resizable,
      );

      // ── Set row height ──────────────────────────────────────────
      if (typeof rowHeight === "function" || typeof rowHeight === "number") {
        ctx.setSizeConfig(rowHeight);
      }
      ctx.rebuildSizeCache();

      // ── CSS classes ─────────────────────────────────────────────
      dom.root.classList.add(`${classPrefix}--table`);
      if (rowBorders) dom.root.classList.add(`${classPrefix}--table-row-borders`);
      if (config.columnBorders) dom.root.classList.add(`${classPrefix}--table-col-borders`);

      // ── ARIA ────────────────────────────────────────────────────
      if (resolvedConfig.interactive) {
        dom.root.setAttribute("tabindex", "0");
      }
      dom.root.setAttribute("role", "grid");
      dom.root.setAttribute("aria-colcount", `${config.columns.length}`);
      dom.viewport.setAttribute("role", "none");
      dom.content.setAttribute("role", "rowgroup");

      // ── Resolve initial column widths ───────────────────────────
      const containerWidth = engineState.crossSize;
      tableLayout.resolve(containerWidth);

      // ── Content width ───────────────────────────────────────────
      const updateContentWidth = (): void => {
        if (!tableLayout) return;
        dom.content.style.minWidth = `${tableLayout.totalWidth}px`;
      };

      // ── Column resize handler ───────────────────────────────────
      const onColumnResize = (columnIndex: number, newWidth: number): void => {
        if (!tableLayout) return;
        const col = tableLayout.getColumn(columnIndex);
        if (!col) return;
        const previousWidth = col.width;
        const actualWidth = tableLayout.resizeColumn(columnIndex, newWidth);
        tableHeader?.update(tableLayout);
        tableRenderer?.updateColumnLayout(tableLayout);
        updateContentWidth();
        emitter.emit("column:resize" as never, {
          key: col.def.key,
          index: columnIndex,
          previousWidth,
          width: actualWidth,
        } as ColumnResizeEvent as never);
      };

      // ── Column sort handler ─────────────────────────────────────
      const onColumnSort = (event: ColumnSortEvent): void => {
        sortKey = event.direction === null ? null : event.key;
        sortDirection = event.direction ?? "asc";
        tableHeader?.updateSort(sortKey, sortDirection);
        emitter.emit("column:sort" as never, event as never);
      };

      // ── Create table header ─────────────────────────────────────
      tableHeader = createTableHeader<T>(
        dom.root,
        headerHeight,
        classPrefix,
        onColumnResize,
        onColumnSort,
      );

      tableHeader.rebuild(tableLayout);
      if (sortKey) tableHeader.updateSort(sortKey, sortDirection);
      updateContentWidth();

      // ── Create table renderer ───────────────────────────────────
      tableRenderer = createTableRenderer<T>(
        dom.content,
        () => sizeCache,
        tableLayout,
        config.columns,
        classPrefix,
        classPrefix,
        () => engineState.totalItems,
        resolvedConfig.striped || undefined,
      );

      // ── Wire render pipeline ────────────────────────────────────
      ctx.setRenderFn(tableRenderIfNeeded, tableForceRender);

      // ── Header scroll sync ──────────────────────────────────────
      const headerWithSync = tableHeader as typeof tableHeader &
        { syncScroll?: (scrollLeft: number) => void };
      let lastSyncedScrollLeft = -1;

      const syncHeaderScroll = (): void => {
        const scrollLeft = dom.viewport.scrollLeft;
        if (scrollLeft !== lastSyncedScrollLeft) {
          lastSyncedScrollLeft = scrollLeft;
          headerWithSync?.syncScroll?.(scrollLeft);
        }
      };

      dom.viewport.addEventListener("scroll", syncHeaderScroll, { passive: true });

      // ── Public methods ──────────────────────────────────────────

      ctx.registerMethod("updateColumns", (columns: TableColumn<T>[]): void => {
        if (!tableLayout || !tableHeader) return;
        tableLayout.updateColumns(columns);
        tableLayout.resolve(engineState.crossSize);
        tableHeader.rebuild(tableLayout);
        if (sortKey) tableHeader.updateSort(sortKey, sortDirection);
        updateContentWidth();
        tableRenderer?.updateColumnLayout(tableLayout);
        tableRenderer?.clear();
        ctx.forceRender();
      });

      ctx.registerMethod("resizeColumn", (keyOrIndex: string | number, width: number): void => {
        if (!tableLayout) return;
        let columnIndex: number;
        if (typeof keyOrIndex === "string") {
          const cols = tableLayout.columns;
          columnIndex = -1;
          for (let i = 0; i < cols.length; i++) {
            if (cols[i]!.def.key === keyOrIndex) { columnIndex = i; break; }
          }
          if (columnIndex === -1) return;
        } else {
          columnIndex = keyOrIndex;
        }
        onColumnResize(columnIndex, width);
      });

      ctx.registerMethod("getColumnWidths", (): Record<string, number> => {
        if (!tableLayout) return {};
        const result: Record<string, number> = {};
        const cols = tableLayout.columns;
        for (let i = 0; i < cols.length; i++) {
          result[cols[i]!.def.key] = cols[i]!.width;
        }
        return result;
      });

      ctx.registerMethod("setSort", (key: string | null, direction?: "asc" | "desc"): void => {
        sortKey = key;
        sortDirection = direction ?? "asc";
        tableHeader?.updateSort(sortKey, sortDirection);
      });

      ctx.registerMethod("getSort", (): { key: string | null; direction: "asc" | "desc" } => {
        return { key: sortKey, direction: sortDirection };
      });

      ctx.registerMethod("_getTableLayout", () => tableLayout);
      ctx.registerMethod("_getTableHeaderHeight", () => headerHeight);

      ctx.registerMethod("_updateRenderedItem", (
        index: number, item: T, isSelected: boolean, isFocused: boolean,
      ) => {
        tableRenderer?.updateItem(index, item, isSelected, isFocused);
      });

      ctx.registerMethod("_replaceTableRenderer", (newRenderer: TableRendererInstance<T>) => {
        tableRenderer = newRenderer;
      });

      ctx.registerMethod("_updateTableForGroups", (
        isHeaderFn: (item: T) => boolean,
        headerTemplate: (key: string, groupIndex: number) => HTMLElement | string,
      ) => {
        tableRenderer?.setGroupHeaderFn(isHeaderFn, headerTemplate);
      });

      // Replace item-class updater for selection integration
      ctx.registerMethod("_updateItemClasses", (
        index: number, isSelected: boolean, isFocused: boolean,
      ): void => {
        tableRenderer?.updateItemClasses(index, isSelected, isFocused);
      });

      // ── Keyboard horizontal scroll ─────────────────────────────
      ctx.registerKeydownHandler((event: KeyboardEvent): void => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (!tableLayout) return;

        const cols = tableLayout.columns;
        if (cols.length === 0) return;

        const viewportWidth = dom.viewport.clientWidth;
        if (tableLayout.totalWidth <= viewportWidth) return;

        const scrollLeft = dom.viewport.scrollLeft;

        if (event.key === "ArrowRight") {
          for (let i = 0; i < cols.length; i++) {
            if (cols[i]!.offset > scrollLeft + 1) {
              dom.viewport.scrollLeft = cols[i]!.offset;
              event.preventDefault();
              return;
            }
          }
        } else {
          for (let i = cols.length - 1; i >= 0; i--) {
            if (cols[i]!.offset < scrollLeft - 1) {
              dom.viewport.scrollLeft = cols[i]!.offset;
              event.preventDefault();
              return;
            }
          }
          if (scrollLeft > 0) {
            dom.viewport.scrollLeft = 0;
            event.preventDefault();
          }
        }
      });

      // ── Cleanup ─────────────────────────────────────────────────
      ctx.registerDestroyHandler((): void => {
        dom.viewport.removeEventListener("scroll", syncHeaderScroll);
        tableHeader?.destroy();
        tableHeader = null;
        tableRenderer?.destroy();
        tableRenderer = null;
        dom.content.style.minWidth = "";
        dom.root.classList.remove(`${classPrefix}--table`);
        dom.root.classList.remove(`${classPrefix}--table-row-borders`);
        dom.root.classList.remove(`${classPrefix}--table-col-borders`);
        dom.root.removeAttribute("role");
        dom.root.removeAttribute("aria-colcount");
        dom.root.removeAttribute("aria-rowcount");
        dom.root.removeAttribute("tabindex");
        dom.viewport.removeAttribute("role");
        dom.content.removeAttribute("role");
      });
    },

    hooks: {
      onResize(_width: number, _height: number): void {
        if (!tableLayout || !storedCtx) return;
        const newCross = engineState.crossSize;
        tableLayout.resolve(newCross);
        tableHeader?.update(tableLayout);
        tableRenderer?.updateColumnLayout(tableLayout);
        if (tableLayout) {
          storedCtx.dom.content.style.minWidth = `${tableLayout.totalWidth}px`;
        }
      },

      onAfterScroll(): void {
        if (!storedCtx || !tableHeader) return;
        const h = tableHeader as typeof tableHeader &
          { syncScroll?: (scrollLeft: number) => void };
        h?.syncScroll?.(storedCtx.dom.viewport.scrollLeft);
      },
    },

    destroy(): void {
      tableHeader?.destroy();
      tableHeader = null;
      tableRenderer?.destroy();
      tableRenderer = null;
      storedCtx = null;
    },
  };
}
