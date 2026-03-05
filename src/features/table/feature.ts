/**
 * vlist/table - Builder Feature
 * Switches from list layout to a data table with columns, resizable headers,
 * sticky header row, and cell-based rendering.
 *
 * Priority: 10 (runs first — replaces the renderer before anything else renders)
 *
 * What it wires:
 * - Replaces render functions — swaps the core render loop with table-aware rendering
 * - Sticky header — creates a fixed header row above the viewport
 * - Column layout — manages column widths, offsets, and resize logic
 * - Resize interaction — drag handles on header column borders
 * - Sort events — click on sortable header emits column:sort
 * - Horizontal scroll sync — header scrolls in sync with the viewport
 * - CSS class — adds .vlist--table to the root element
 * - Variable row heights — supports fixed and function-based heights
 *
 * Critical design: This feature uses ctx.setRenderFns() to completely replace
 * the core's render loop, NOT ctx.replaceRenderer() which is a no-op in the
 * materialize context. This follows the same pattern as withGrid.
 *
 * Restrictions:
 * - Cannot be combined with withGrid or withMasonry (conflicting layout modes)
 * - Cannot be combined with orientation: 'horizontal' (tables are always vertical)
 *
 * Can be combined with:
 * - withSelection (row selection works as-is)
 * - withScrollbar (custom scrollbar)
 * - withAsync (async data loading)
 * - withSnapshots (scroll position save/restore)
 * - withScale (large dataset compression)
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

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
// Shared Constants
// =============================================================================

/** Cached empty Set — avoids allocation on every scroll frame when no selection */
const EMPTY_ID_SET: Set<string | number> = new Set();

// =============================================================================
// Feature Config (re-export for convenience)
// =============================================================================

/** Table feature configuration — re-exported as TableFeatureConfig */
export type TableFeatureConfig<T extends VListItem = VListItem> = TableConfig<T>;

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a table feature for the builder.
 *
 * Switches from list layout to a data table with column headers, resizable
 * columns, and cell-based row rendering.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withTable } from 'vlist/table'
 *
 * const table = vlist({
 *   container: '#my-table',
 *   item: { height: 40, template: () => '' },
 *   items: users,
 * })
 * .use(withTable({
 *   columns: [
 *     { key: 'name',   label: 'Name',   width: 200 },
 *     { key: 'email',  label: 'Email',  width: 300 },
 *     { key: 'role',   label: 'Role',   width: 120 },
 *   ],
 *   rowHeight: 40,
 *   headerHeight: 44,
 *   resizable: true,
 * }))
 * .build()
 * ```
 */
export const withTable = <T extends VListItem = VListItem>(
  config: TableFeatureConfig<T>,
): VListFeature<T> => {
  // ── Validate ──
  if (!config.columns || config.columns.length === 0) {
    throw new Error(
      "[vlist/builder] withTable: columns must be a non-empty array",
    );
  }

  if (config.rowHeight === undefined && config.estimatedRowHeight === undefined) {
    throw new Error(
      "[vlist/builder] withTable: either rowHeight or estimatedRowHeight is required",
    );
  }

  // ── Feature state ──
  let tableLayout: TableLayout<T> | null = null;
  let tableHeader: (ReturnType<typeof createTableHeader<T>>) | null = null;
  let tableRenderer: TableRendererInstance<T> | null = null;

  return {
    name: "withTable",
    priority: 10,

    // Conflict with other layout features
    conflicts: ["withGrid", "withMasonry"],

    setup(ctx: BuilderContext<T>): void {
      const { dom, emitter, config: resolvedConfig } = ctx;
      const { classPrefix } = resolvedConfig;

      // ── Validate constraints ──
      if (resolvedConfig.horizontal) {
        throw new Error(
          "[vlist/builder] withTable cannot be used with orientation: 'horizontal'",
        );
      }

      if (resolvedConfig.reverse) {
        throw new Error(
          "[vlist/builder] withTable cannot be used with reverse: true",
        );
      }

      // ── Resolve config ──
      const resizable = config.resizable ?? true;
      const minColumnWidth = config.minColumnWidth ?? 50;
      const maxColumnWidth = config.maxColumnWidth ?? Infinity;
      const columnBorders = config.columnBorders ?? false;
      const rowBorders = config.rowBorders ?? true;
      const rowHeight = config.rowHeight;

      // Header height: explicit, or fixed rowHeight, or default 40
      const headerHeight = config.headerHeight ??
        (typeof rowHeight === "number" ? rowHeight : 40);

      // ── Sort state ──
      let sortKey: string | null = config.sort?.key ?? null;
      let sortDirection: "asc" | "desc" = config.sort?.direction ?? "asc";

      // ── Create table layout ──
      tableLayout = createTableLayout<T>(
        config.columns,
        minColumnWidth,
        maxColumnWidth,
        resizable,
      );

      // ── Set item height config ──
      // The table uses its own rowHeight config, overriding whatever the
      // builder was given in item.height. This keeps the API clean:
      // the user specifies height in the table config, not in item config.
      if (typeof rowHeight === "function") {
        ctx.setSizeConfig(rowHeight);
      } else if (typeof rowHeight === "number") {
        ctx.setSizeConfig(rowHeight);
      }

      // Rebuild size cache with the new height config
      ctx.rebuildSizeCache();

      // ── Add table CSS classes ──
      dom.root.classList.add(`${classPrefix}--table`);
      if (rowBorders) {
        dom.root.classList.add(`${classPrefix}--table-row-borders`);
      }
      if (columnBorders) {
        dom.root.classList.add(`${classPrefix}--table-col-borders`);
      }
      // Set role to grid (more appropriate for tables than listbox)
      dom.items.setAttribute("role", "grid");
      dom.items.setAttribute("aria-colcount", String(config.columns.length));

      // ── Resolve initial column widths ──
      const containerWidth = ctx.getContainerWidth();
      tableLayout.resolve(containerWidth);

      // ── Create table header ──
      const onColumnResize = (columnIndex: number, newWidth: number): void => {
        if (!tableLayout) return;

        const col = tableLayout.getColumn(columnIndex);
        if (!col) return;

        const previousWidth = col.width;
        const actualWidth = tableLayout.resizeColumn(columnIndex, newWidth);

        // Update header cell widths
        if (tableHeader) {
          tableHeader.update(tableLayout);
        }

        // Update all rendered row cell widths
        if (tableRenderer) {
          tableRenderer.updateColumnLayout(tableLayout);
        }

        // Update content width for horizontal scrolling
        updateContentWidth();

        // Emit resize event
        emitter.emit("column:resize" as any, {
          key: col.def.key,
          index: columnIndex,
          previousWidth,
          width: actualWidth,
        } as ColumnResizeEvent);
      };

      const onColumnSort = (event: ColumnSortEvent): void => {
        if (event.direction === null) {
          sortKey = null;
          sortDirection = "asc";
        } else {
          sortKey = event.key;
          sortDirection = event.direction;
        }

        // Update header sort indicator
        if (tableHeader) {
          tableHeader.updateSort(sortKey, sortDirection);
        }

        // Emit sort event — consumer handles actual sorting via setItems()
        emitter.emit("column:sort" as any, event);
      };

      const onColumnClick = (event: { key: string; index: number; event: MouseEvent }): void => {
        emitter.emit("column:click" as any, event);
      };

      tableHeader = createTableHeader<T>(
        dom.root,
        dom.viewport,
        headerHeight,
        classPrefix,
        onColumnResize,
        onColumnSort,
        onColumnClick,
      );

      // Build header cells
      tableHeader.rebuild(tableLayout);

      // Set initial sort indicator
      if (sortKey) {
        tableHeader.updateSort(sortKey, sortDirection);
      }

      // ── Update content width ──
      const updateContentWidth = (): void => {
        if (!tableLayout) return;
        const totalColWidth = tableLayout.totalWidth;
        dom.content.style.minWidth = `${totalColWidth}px`;
        dom.items.style.minWidth = `${totalColWidth}px`;
      };

      updateContentWidth();

      // ── Create table renderer ──
      tableRenderer = createTableRenderer<T>(
        dom.items,
        () => ctx.sizeCache,
        tableLayout,
        config.columns,
        classPrefix,
        resolvedConfig.ariaIdPrefix,
        () => ctx.dataManager.getTotal(),
        ctx.rawConfig.item?.striped,
      );

      // ── Cached selection getter references ──
      // Resolved lazily on first render frame. The selection feature registers
      // _getSelectedIds / _getFocusedIndex on ctx.methods at priority 50,
      // which runs before the initial render. Caching the function references
      // avoids a Map.get() on every scroll frame.
      let selectionIdsGetter: (() => Set<string | number>) | null = null;
      let selectionFocusGetter: (() => number) | null = null;
      let selectionGettersResolved = false;

      const resolveSelectionGetters = (): void => {
        if (selectionGettersResolved) return;
        selectionGettersResolved = true;
        selectionIdsGetter = (ctx.methods.get("_getSelectedIds") as (() => Set<string | number>)) ?? null;
        selectionFocusGetter = (ctx.methods.get("_getFocusedIndex") as (() => number)) ?? null;
      };

      // ── Scroll state for early-exit guard ──
      // When scroll position + container size are identical to last frame,
      // all downstream work (range calc, renderer diffing) is skipped.
      let lastScrollPosition = -1;
      let lastContainerSize = -1;
      let forceNextRender = true; // first render must always run

      // ── Precomputed overscan value ──
      const overscan = resolvedConfig.overscan ?? 3;

      // ── Mutable range objects — reused across frames (no allocation) ──
      const visibleRange = { start: 0, end: 0 };
      const renderRange = { start: 0, end: 0 };

      // =====================================================================
      // tableRenderIfNeeded — the core render loop replacement
      // =====================================================================
      const tableRenderIfNeeded = (): void => {
        if (ctx.state.isDestroyed) return;

        // Read scroll position from the scroll controller (not raw DOM)
        const scrollTop = ctx.scrollController.getScrollTop();
        const containerHeight = ctx.state.viewportState.containerSize;

        // ── Early exit: skip all work when nothing changed ──
        if (
          !forceNextRender &&
          scrollTop === lastScrollPosition &&
          containerHeight === lastContainerSize
        ) {
          return;
        }
        lastScrollPosition = scrollTop;
        lastContainerSize = containerHeight;
        forceNextRender = false;

        // Total items (tables are 1:1 rows to items, unlike grid)
        const totalItems = ctx.getVirtualTotal();

        // Calculate visible range from size cache (mutate in place)
        if (totalItems === 0 || containerHeight === 0) {
          visibleRange.start = 0;
          visibleRange.end = 0;
        } else {
          visibleRange.start = Math.max(
            0,
            ctx.sizeCache.indexAtOffset(scrollTop),
          );
          let visibleEnd = ctx.sizeCache.indexAtOffset(
            scrollTop + containerHeight,
          );
          if (visibleEnd < totalItems - 1) visibleEnd++;
          visibleRange.end = Math.min(totalItems - 1, Math.max(0, visibleEnd));
        }

        // Apply overscan (mutate in place)
        renderRange.start = Math.max(0, visibleRange.start - overscan);
        renderRange.end = Math.min(totalItems - 1, visibleRange.end + overscan);

        // Update viewport state — mutate in place to avoid object allocation
        const viewportState = ctx.state.viewportState;
        viewportState.scrollPosition = scrollTop;
        viewportState.visibleRange.start = visibleRange.start;
        viewportState.visibleRange.end = visibleRange.end;
        viewportState.renderRange.start = renderRange.start;
        viewportState.renderRange.end = renderRange.end;

        const lastRange = ctx.state.lastRenderRange;

        // Get items from the data manager for the render range
        const items = ctx.dataManager.getItemsInRange(
          renderRange.start,
          renderRange.end,
        ) as T[];

        // Read selection state — prefer live getters from selection feature,
        // fall back to EMPTY_ID_SET / -1 when no selection feature is present.
        resolveSelectionGetters();
        const selectedIds = selectionIdsGetter ? selectionIdsGetter() : EMPTY_ID_SET;
        const focusedIndex = selectionFocusGetter ? selectionFocusGetter() : -1;

        // Render! The renderer's change tracking makes unchanged items a no-op
        // (skips template, class, and position updates). The grace-period
        // release loop inside render() advances the frame counter on every call,
        // so items that left the range are eventually released even when the
        // row-level range is unchanged.
        tableRenderer!.render(items, renderRange, selectedIds, focusedIndex);

        // Emit range:change only when range actually changed
        if (lastRange.start !== renderRange.start || lastRange.end !== renderRange.end) {
          lastRange.start = renderRange.start;
          lastRange.end = renderRange.end;
          emitter.emit("range:change", {
            range: { start: renderRange.start, end: renderRange.end },
          });
        }
      };

      // =====================================================================
      // tableForceRender — force a full re-render
      // =====================================================================
      const tableForceRender = (): void => {
        if (ctx.state.isDestroyed) return;

        // Reset last range and force flag to ensure re-render
        ctx.state.lastRenderRange.start = -1;
        ctx.state.lastRenderRange.end = -1;
        forceNextRender = true;
        tableRenderIfNeeded();
      };

      // =====================================================================
      // Wire into the core — THIS IS THE KEY LINE
      // ctx.setRenderFns() replaces $.rfn and $.ffn in the materialize refs,
      // which means the scroll pipeline will call our functions instead of
      // the inlined list renderer. ctx.replaceRenderer() is a no-op.
      // =====================================================================
      ctx.setRenderFns(tableRenderIfNeeded, tableForceRender);

      // ── Horizontal scroll sync ──
      // Keep the header scrolled in sync with the viewport.
      const headerWithSync = tableHeader as ReturnType<typeof createTableHeader<T>> &
        { syncScroll?: (scrollLeft: number) => void };

      let lastSyncedScrollLeft = -1;

      const syncHeaderScroll = (): void => {
        const scrollLeft = dom.viewport.scrollLeft;
        if (scrollLeft !== lastSyncedScrollLeft) {
          lastSyncedScrollLeft = scrollLeft;
          if (headerWithSync.syncScroll) {
            headerWithSync.syncScroll(scrollLeft);
          }
        }
      };

      // Sync on every scroll frame (afterScroll fires after render)
      ctx.afterScroll.push((): void => {
        syncHeaderScroll();
      });

      // Also listen for horizontal scroll directly on the viewport
      // (afterScroll may only fire for vertical scroll changes)
      const onViewportScroll = (): void => {
        syncHeaderScroll();
      };
      dom.viewport.addEventListener("scroll", onViewportScroll, { passive: true });

      // ── Resize handler ──
      // When the container resizes, re-resolve column widths for flex columns.
      ctx.resizeHandlers.push((width: number, _height: number): void => {
        if (!tableLayout) return;

        tableLayout.resolve(width);

        // Update header
        if (tableHeader) {
          tableHeader.update(tableLayout);
        }

        // Update all rendered rows
        if (tableRenderer) {
          tableRenderer.updateColumnLayout(tableLayout);
        }

        updateContentWidth();
      });

      // ── Expose public methods ──

      /**
       * Update column definitions at runtime.
       * Rebuilds header and re-renders all visible rows.
       */
      ctx.methods.set("updateColumns", (columns: TableColumn<T>[]): void => {
        if (!tableLayout || !tableHeader) return;

        // Update layout
        tableLayout.updateColumns(columns);
        tableLayout.resolve(ctx.getContainerWidth());

        // Rebuild header
        tableHeader.rebuild(tableLayout);

        // Restore sort indicator
        if (sortKey) {
          tableHeader.updateSort(sortKey, sortDirection);
        }

        // Update content width
        updateContentWidth();

        // Update rendered rows
        if (tableRenderer) {
          tableRenderer.updateColumnLayout(tableLayout);
          tableRenderer.clear();
        }

        ctx.forceRender();
      });

      /**
       * Resize a column programmatically.
       */
      ctx.methods.set("resizeColumn", (keyOrIndex: string | number, width: number): void => {
        if (!tableLayout) return;

        let columnIndex: number;
        if (typeof keyOrIndex === "string") {
          const cols = tableLayout.columns;
          columnIndex = -1;
          for (let i = 0; i < cols.length; i++) {
            if (cols[i]!.def.key === keyOrIndex) {
              columnIndex = i;
              break;
            }
          }
          if (columnIndex === -1) return;
        } else {
          columnIndex = keyOrIndex;
        }

        onColumnResize(columnIndex, width);
      });

      /**
       * Get current column widths.
       */
      ctx.methods.set("getColumnWidths", (): Record<string, number> => {
        if (!tableLayout) return {};

        const result: Record<string, number> = {};
        const cols = tableLayout.columns;
        for (let i = 0; i < cols.length; i++) {
          result[cols[i]!.def.key] = cols[i]!.width;
        }
        return result;
      });

      /**
       * Set sort state (visual indicator only — does NOT sort data).
       */
      ctx.methods.set("setSort", (key: string | null, direction?: "asc" | "desc"): void => {
        sortKey = key;
        sortDirection = direction ?? "asc";
        if (tableHeader) {
          tableHeader.updateSort(sortKey, sortDirection);
        }
      });

      /**
       * Get current sort state.
       */
      ctx.methods.set("getSort", (): { key: string | null; direction: "asc" | "desc" } => {
        return { key: sortKey, direction: sortDirection };
      });

      /**
       * Get the table layout (for advanced usage / internal).
       */
      ctx.methods.set("_getTableLayout", () => tableLayout);

      /**
       * Replace the table renderer instance (for groups feature integration).
       * The groups feature calls this to swap in a groups-aware renderer.
       */
      ctx.methods.set("_replaceTableRenderer", (newRenderer: TableRendererInstance<T>) => {
        tableRenderer = newRenderer;
      });

      /**
       * Tell the table renderer about group header items.
       * The groups feature calls this so the renderer can distinguish
       * group headers from data rows and render them full-width.
       */
      ctx.methods.set("_updateTableForGroups", (
        isHeaderFn: (item: T) => boolean,
        headerTemplate: (key: string, groupIndex: number) => HTMLElement | string,
      ) => {
        if (tableRenderer) {
          tableRenderer.setGroupHeaderFn(isHeaderFn, headerTemplate);
        }
      });

      /**
       * Get the table column header height (for sticky group header offset).
       * The groups feature needs this to position its sticky header below
       * the table's column header row.
       */
      ctx.methods.set("_getTableHeaderHeight", () => headerHeight);

      // ── Content size handlers ──
      // When data changes, update content width too
      ctx.contentSizeHandlers.push((): void => {
        updateContentWidth();
      });

      // ── Cleanup ──
      ctx.destroyHandlers.push((): void => {
        dom.viewport.removeEventListener("scroll", onViewportScroll);

        if (tableHeader) {
          tableHeader.destroy();
          tableHeader = null;
        }

        if (tableRenderer) {
          tableRenderer.destroy();
          tableRenderer = null;
        }

        // Reset styles
        dom.content.style.minWidth = "";
        dom.items.style.minWidth = "";
        dom.root.classList.remove(`${classPrefix}--table`);
        dom.items.setAttribute("role", "listbox"); // Restore default role
        dom.items.removeAttribute("aria-colcount");
      });
    },

    destroy(): void {
      if (tableHeader) {
        tableHeader.destroy();
        tableHeader = null;
      }
      if (tableRenderer) {
        tableRenderer.destroy();
        tableRenderer = null;
      }
    },
  };
};