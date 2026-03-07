/**
 * vlist/grid - Builder Feature
 * Switches from list layout to a 2D grid with configurable columns and gap.
 *
 * Priority: 10 (runs first — replaces the renderer before anything else renders)
 *
 * What it wires:
 * - Replaces renderer — swaps the list renderer with a grid renderer
 * - Redefines virtual total — the virtualizer sees rows, not items
 * - Column width calculation — recalculated on resize
 * - Item positioning — each item gets translateX (column) and translateY (row)
 * - CSS class — adds .vlist--grid to the root element
 *
 * Restrictions:
 * - Cannot be combined with orientation: 'horizontal'
 * - Cannot be combined with reverse: true
 *
 * Can be combined with withGroups for grouped 2D layouts.
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";
import { resolveScrollArgs, createSmoothScroll } from "../../builder/scroll";
import { calculateScrollToIndex } from "../../rendering";

import { createGridLayout } from "./layout";
import { createGridRenderer, type GridRenderer } from "./renderer";
import type { GridLayout } from "./types";

// =============================================================================
// Shared constants
// =============================================================================

/** Cached empty Set — avoids allocation on every scroll frame when no selection */
const EMPTY_ID_SET: Set<string | number> = new Set();

// =============================================================================
// Feature Config
// =============================================================================

/** Grid feature configuration */
export interface GridFeatureConfig {
  /** Number of columns (required, >= 1) */
  columns: number;

  /** Gap between items in pixels (default: 0) */
  gap?: number;
}

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a grid feature for the builder.
 *
 * Switches from list layout to a 2D grid with configurable columns and gap.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withGrid } from 'vlist/grid'
 *
 * const gallery = vlist({
 *   container: '#gallery',
 *   item: { height: 200, template: renderPhoto },
 *   items: photos,
 * })
 * .use(withGrid({ columns: 4, gap: 8 }))
 * .build()
 * ```
 */
export const withGrid = <T extends VListItem = VListItem>(
  config: GridFeatureConfig,
): VListFeature<T> => {
  // Validate
  if (!config.columns || config.columns < 1) {
    throw new Error(
      "[vlist/builder] withGrid: columns must be a positive integer >= 1",
    );
  }

  let gridLayout: GridLayout | null = null;
  let gridRenderer: GridRenderer<T> | null = null;

  return {
    name: "withGrid",
    priority: 10,

    setup(ctx: BuilderContext<T>): void {
      const { dom, emitter, config: resolvedConfig, rawConfig } = ctx;
      const { classPrefix } = resolvedConfig;

      // Validate reverse constraint
      if (resolvedConfig.reverse) {
        throw new Error(
          "[vlist/builder] withGrid cannot be used with reverse: true",
        );
      }

      const isHorizontal = resolvedConfig.horizontal;

      // Helper: get cross-axis container dimension.
      // In vertical mode the cross-axis is horizontal (viewport width).
      // In horizontal mode the cross-axis is vertical (viewport height).
      const getCrossAxisSize = (): number =>
        isHorizontal ? dom.viewport.clientHeight : ctx.getContainerWidth();

      // ── Create grid layout ──
      // Check if groups feature will be active (items contain group headers)
      const hasGroups = rawConfig.items?.some(
        (item: any) => item.__groupHeader === true,
      );

      const gridConfig: import("./layout").GridConfigWithGroups = {
        columns: config.columns,
        gap: config.gap ?? 0,
      };

      // If groups detected, add isHeaderFn for groups-aware layout
      if (hasGroups) {
        gridConfig.isHeaderFn = (index: number) => {
          const item = ctx.dataManager.getItem(index);
          return !!(item && (item as any).__groupHeader === true);
        };
      }

      gridLayout = createGridLayout(gridConfig);
      const gap = gridLayout.gap;

      // ── Set virtual total to row count ──
      ctx.setVirtualTotalFn(() => {
        const rawTotal = ctx.dataManager.getTotal();
        return gridLayout!.getTotalRows(rawTotal);
      });

      // ── Update height config to include gap and inject grid context ──
      // In grid mode, each row's size in the size cache = itemSize + gap
      // so that rows are spaced apart vertically. The grid renderer subtracts
      // the gap when sizing the DOM element.
      const itemConfig = rawConfig.item;
      const baseSize = (
        resolvedConfig.horizontal ? itemConfig.width : itemConfig.height
      ) as
        | number
        | ((
            index: number,
            context?: {
              row: number;
              column: number;
              totalRows: number;
              totalColumns: number;
            },
          ) => number);

      // Store mutable grid state for dynamic height calculation
      // containerWidth here means "cross-axis container dimension"
      const gridState = {
        containerWidth: getCrossAxisSize(),
        columns: gridLayout.columns,
        gap: gridLayout.gap,
      };

      // Reusable context object — mutated in place per call, single
      // allocation for the lifetime of the list. The static fields
      // (containerWidth … totalColumns) are the same for every item in
      // a build pass; recomputing them is a handful of arithmetic ops
      // — cheaper than the branch-prediction cost of a dirty check.
      const gridContext = {
        containerWidth: 0,
        columns: 0,
        gap: 0,
        columnWidth: 0,
        row: 0,
        column: 0,
        totalRows: 0,
        totalColumns: 0,
      };

      if (typeof baseSize === "function") {
        // Size function - inject grid context
        ctx.setSizeConfig((index: number) => {
          const innerWidth = gridState.containerWidth - 2;
          const totalGaps = (gridState.columns - 1) * gridState.gap;

          gridContext.containerWidth = gridState.containerWidth;
          gridContext.columns = gridState.columns;
          gridContext.gap = gridState.gap;
          gridContext.columnWidth = (innerWidth - totalGaps) / gridState.columns;
          gridContext.row = gridLayout!.getRow(index);
          gridContext.column = gridLayout!.getCol(index);
          gridContext.totalRows = gridLayout!.getTotalRows(ctx.dataManager.getTotal());
          gridContext.totalColumns = gridState.columns;

          return baseSize(index, gridContext) + gridState.gap;
        });
      } else if (gap > 0) {
        // Fixed size - just add gap
        ctx.setSizeConfig(baseSize + gap);
      }

      // Rebuild size cache with row count
      ctx.rebuildSizeCache();

      // ── Fix trailing gap ──
      // Each row's cached size = itemSize + gap (for row spacing).
      // This means getTotalSize() includes a trailing gap after the last row.
      // We subtract it so there's no extra space at the bottom of the grid.
      if (gap > 0) {
        const origGetTotalSize = ctx.sizeCache.getTotalSize;
        ctx.sizeCache.getTotalSize = (): number => {
          const total = origGetTotalSize();
          return total > 0 ? total - gridState.gap : 0;
        };
      }

      // ── Add grid CSS class ──
      dom.root.classList.add(`${classPrefix}--grid`);

      // ── Get cross-axis container size for grid renderer ──
      // In vertical mode this is the viewport width; in horizontal mode the viewport height.
      const containerWidth = getCrossAxisSize();

      // ── Create grid renderer ──
      const template = rawConfig.item.template;

      const createAndSetGridRenderer = () => {
        gridRenderer = createGridRenderer<T>(
          dom.items,
          template,
          ctx.sizeCache,
          gridLayout!,
          classPrefix,
          containerWidth,
          () => ctx.dataManager.getTotal(),
          resolvedConfig.ariaIdPrefix,
          resolvedConfig.horizontal,
        );

        // ── Replace the list renderer with the grid renderer ──
        ctx.replaceRenderer(gridRenderer as unknown as any);
      };

      createAndSetGridRenderer();

      // ── Expose grid layout for other features (e.g., groups) ──
      ctx.methods.set("_getGridLayout", () => gridLayout);
      ctx.methods.set("_getGridConfig", () => gridConfig);

      // ── Expose method to replace renderer (for groups feature) ──
      ctx.methods.set("_replaceGridRenderer", (newRenderer: any) => {
        gridRenderer = newRenderer;
      });

      // ── Expose method to update grid layout with isHeaderFn (for groups feature) ──
      ctx.methods.set(
        "_updateGridLayoutForGroups",
        (isHeaderFn: (index: number) => boolean) => {
          gridLayout!.update({ isHeaderFn } as any);

          // Calculate correct total height by summing only column 0 items
          const totalItems = ctx.dataManager.getTotal();
          let correctTotalHeight = 0;
          for (let i = 0; i < totalItems; i++) {
            if (gridLayout!.getCol(i) === 0) {
              const height = ctx.sizeCache.getSize(i);
              correctTotalHeight += height;
            }
          }

          // Override size cache getTotalSize to return corrected value
          // This ensures everything (DOM, scrollbar, calculations) uses the correct height
          ctx.sizeCache.getTotalSize = () => correctTotalHeight;

          // Manually update DOM content size (height for vertical, width for horizontal)
          if (resolvedConfig.horizontal) {
            ctx.dom.content.style.width = `${correctTotalHeight}px`;
          } else {
            ctx.dom.content.style.height = `${correctTotalHeight}px`;
          }

          // Recreate renderer with updated layout
          createAndSetGridRenderer();
        },
      );

      // ── Expose update method for grid config changes ──
      ctx.methods.set("updateGrid", (newConfig: Partial<GridFeatureConfig>) => {
        if (newConfig.columns !== undefined) {
          if (!Number.isInteger(newConfig.columns) || newConfig.columns < 1) {
            throw new Error(
              "[vlist/builder] updateGrid: columns must be a positive integer >= 1",
            );
          }
          gridConfig.columns = newConfig.columns;
        }

        if (newConfig.gap !== undefined) {
          if (newConfig.gap < 0) {
            throw new Error(
              "[vlist/builder] updateGrid: gap must be non-negative",
            );
          }
          gridConfig.gap = newConfig.gap;
        }

        // Update grid layout
        if (gridLayout) {
          gridLayout.update(gridConfig);
        }

        // Update grid state for size function (cross-axis dimension)
        const containerWidth = getCrossAxisSize();
        gridState.containerWidth = containerWidth;
        gridState.columns = gridConfig.columns;
        gridState.gap = gridConfig.gap ?? 0;

        // Update grid renderer
        if (gridRenderer) {
          gridRenderer.updateContainerWidth(containerWidth);
        }

        // Rebuild size cache with new row count
        ctx.rebuildSizeCache();

        // Update content size to reflect new total height
        ctx.updateContentSize(ctx.sizeCache.getTotalSize());

        // Update compression mode if compression feature is active
        ctx.updateCompressionMode();

        // Trigger content size handlers (e.g., snapshots feature)
        for (let i = 0; i < ctx.contentSizeHandlers.length; i++) {
          ctx.contentSizeHandlers[i]!();
        }

        // Clear and re-render
        if (gridRenderer) {
          gridRenderer.clear();
        }
        ctx.forceRender();
      });

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
      const overscan = resolvedConfig.overscan;

      // ── Mutable range objects — reused across frames (no allocation) ──
      const visibleRange = { start: 0, end: 0 };
      const renderRange = { start: 0, end: 0 };

      // ── Override render functions to convert row range → item range ──
      const gridRenderIfNeeded = (): void => {
        if (ctx.state.isDestroyed) return;

        // Calculate visible and render ranges (in row space)
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

        const totalRows = ctx.getVirtualTotal();

        // Calculate visible row range (mutate in place)
        if (totalRows === 0 || containerHeight === 0) {
          visibleRange.start = 0;
          visibleRange.end = 0;
        } else {
          visibleRange.start = Math.max(
            0,
            ctx.sizeCache.indexAtOffset(scrollTop),
          );
          // containerHeight is exclusive: pixel at (scrollTop + containerHeight) is
          // the first pixel NOT shown.  Using -1 converts to the last visible pixel
          // so we don't include a row whose first pixel sits exactly on the boundary.
          visibleRange.end = Math.min(
            totalRows - 1,
            Math.max(0, ctx.sizeCache.indexAtOffset(scrollTop + containerHeight - 1)),
          );
        }

        // Apply overscan (mutate in place)
        renderRange.start = Math.max(0, visibleRange.start - overscan);
        renderRange.end = Math.min(totalRows - 1, visibleRange.end + overscan);

        // Update viewport state — mutate in place to avoid object allocation
        const viewportState = ctx.state.viewportState;
        viewportState.scrollPosition = scrollTop;
        viewportState.visibleRange.start = visibleRange.start;
        viewportState.visibleRange.end = visibleRange.end;
        viewportState.renderRange.start = renderRange.start;
        viewportState.renderRange.end = renderRange.end;

        const lastRange = ctx.state.lastRenderRange;
        const isCompressed = viewportState.isCompressed;

        // Convert row range to flat item range
        const totalItems = ctx.dataManager.getTotal();
        const itemRange = gridLayout!.getItemRange(
          renderRange.start,
          renderRange.end,
          totalItems,
        );

        const items = ctx.dataManager.getItemsInRange(
          itemRange.start,
          itemRange.end,
        ) as T[];

        const compressionCtx = isCompressed
          ? ctx.getCompressionContext()
          : undefined;

        // Read selection state — prefer live getters from selection feature,
        // fall back to EMPTY_ID_SET / -1 when no selection feature is present.
        resolveSelectionGetters();
        const selectedIds = selectionIdsGetter ? selectionIdsGetter() : EMPTY_ID_SET;
        const focusedIndex = selectionFocusGetter ? selectionFocusGetter() : -1;

        // Always call render() — the renderer's change tracking makes unchanged
        // items a no-op (skips template, class, and position updates). This
        // eliminates the need for a separate tick() path: the grace-period
        // release loop inside render() advances the frame counter on every call,
        // so items that left the range are eventually released even when the
        // row-level range is unchanged.
        gridRenderer!.render(
          items,
          itemRange,
          selectedIds,
          focusedIndex,
          compressionCtx,
        );

        // Emit range:change only when range actually changed
        if (lastRange.start !== renderRange.start || lastRange.end !== renderRange.end) {
          lastRange.start = renderRange.start;
          lastRange.end = renderRange.end;
          emitter.emit("range:change", { range: { start: renderRange.start, end: renderRange.end } });
        }
      };

      const gridForceRender = (): void => {
        if (ctx.state.isDestroyed) return;

        // Reset last range and force flag to ensure re-render
        ctx.state.lastRenderRange.start = -1;
        ctx.state.lastRenderRange.end = -1;
        forceNextRender = true;
        gridRenderIfNeeded();
      };

      // Replace the core's render functions with our grid-aware versions
      ctx.setRenderFns(gridRenderIfNeeded, gridForceRender);

      // ── Resize: update cross-axis cell sizes ──
      const isDynamicSize = typeof baseSize === "function";

      ctx.resizeHandlers.push((width: number, height: number): void => {
        // Use the cross-axis dimension: width for vertical, height for horizontal
        const crossAxisSize = isHorizontal ? height : width;

        // Always update grid state (used by dynamic height functions)
        gridState.containerWidth = crossAxisSize;

        if (gridRenderer) {
          gridRenderer.updateContainerWidth(crossAxisSize);
        }

        // Dynamic heights depend on containerWidth via the grid context,
        // so the size cache must be rebuilt when the cross-axis changes.
        if (isDynamicSize) {
          ctx.rebuildSizeCache();
          ctx.updateContentSize(ctx.sizeCache.getTotalSize());
          ctx.updateCompressionMode();

          for (let i = 0; i < ctx.contentSizeHandlers.length; i++) {
            ctx.contentSizeHandlers[i]!();
          }

          if (gridRenderer) {
            gridRenderer.clear();
          }
          ctx.forceRender();
        }
      });

      // ── Smooth scroll support ──
      const { animateScroll, cancelScroll } = createSmoothScroll(
        ctx.scrollController,
        ctx.renderIfNeeded,
      );

      ctx.methods.set("cancelScroll", cancelScroll);

      // ── Override scrollToIndex to convert item index → row ──
      // (Features like selection that scrollToIndex with item indices need this)
      // The builder core's scrollToIndex already works with the size cache
      // which is in row-space, so we just need to ensure the public API
      // scrollToIndex maps item index → row index.
      ctx.methods.set(
        "scrollToIndex",
        (
          index: number,
          alignOrOptions?:
            | "start"
            | "center"
            | "end"
            | {
                align?: "start" | "center" | "end";
                behavior?: "auto" | "smooth";
                duration?: number;
              },
        ): void => {
          // Convert item index to row index
          const rowIndex = Math.floor(index / config.columns);
          const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);

          const dataState = ctx.dataManager.getState();
          const totalRows = gridLayout!.getTotalRows(dataState.total);

          const safeRow = Math.max(0, Math.min(rowIndex, totalRows - 1));

          const position = calculateScrollToIndex(
            safeRow,
            ctx.sizeCache,
            ctx.state.viewportState.containerSize,
            totalRows,
            align,
            ctx.getCachedCompression(),
          );

          if (behavior === "smooth") {
            animateScroll(ctx.scrollController.getScrollTop(), position, duration);
          } else {
            cancelScroll();
            ctx.scrollController.scrollTo(position);
          }
        },
      );

      // ── Override total getter to return flat item count (not row count) ──
      // Only set if not already set by another feature (e.g., groups)
      if (!ctx.methods.has("_getTotal")) {
        ctx.methods.set("_getTotal", () => ctx.dataManager.getTotal());
      }

      // ── Override snapshot methods for grid if snapshots feature is present ──
      // This is handled by the snapshots feature which checks for grid

      // ── Accessibility: reorder DOM on scroll idle ──
      ctx.idleHandlers.push(() => {
        if (gridRenderer) gridRenderer.sortDOM();
      });

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        cancelScroll();
        if (gridRenderer) {
          gridRenderer.destroy();
          gridRenderer = null;
        }
        dom.root.classList.remove(`${classPrefix}--grid`);
      });
    },

    destroy(): void {
      if (gridRenderer) {
        gridRenderer.destroy();
        gridRenderer = null;
      }
    },
  };
};

