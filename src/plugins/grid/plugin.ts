/**
 * vlist/grid - Builder Plugin
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
 * - Cannot be combined with direction: 'horizontal'
 * - Cannot be combined with reverse: true
 *
 * Can be combined with withGroups for grouped 2D layouts.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, BuilderContext } from "../../builder/types";

import { createGridLayout, type GridLayout } from "./layout";
import { createGridRenderer, type GridRenderer } from "./renderer";
import type { GridConfig } from "./types";

// =============================================================================
// Plugin Config
// =============================================================================

/** Grid plugin configuration */
export interface GridPluginConfig {
  /** Number of columns (required, >= 1) */
  columns: number;

  /** Gap between items in pixels (default: 0) */
  gap?: number;
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create a grid plugin for the builder.
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
  config: GridPluginConfig,
): VListPlugin<T> => {
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

      // Validate direction/reverse constraints
      if (resolvedConfig.horizontal) {
        throw new Error(
          "[vlist/builder] withGrid cannot be used with direction: 'horizontal'",
        );
      }
      if (resolvedConfig.reverse) {
        throw new Error(
          "[vlist/builder] withGrid cannot be used with reverse: true",
        );
      }

      // ── Create grid layout ──
      // Check if groups plugin will be active (items contain group headers)
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
          return item && (item as any).__groupHeader === true;
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
      // In grid mode, each row's height in the height cache = itemHeight + gap
      // so that rows are spaced apart vertically. The grid renderer subtracts
      // the gap when sizing the DOM element.
      const itemConfig = rawConfig.item;
      const baseHeight = (
        resolvedConfig.horizontal ? itemConfig.width : itemConfig.height
      ) as
        | number
        | ((
            index: number,
            context?: import("../types").GridHeightContext,
          ) => number);

      // Store mutable grid state for dynamic height calculation
      const gridState = {
        containerWidth: ctx.getContainerWidth(),
        columns: gridLayout.columns,
        gap: gridLayout.gap,
      };

      if (typeof baseHeight === "function") {
        // Height function - inject grid context
        ctx.setHeightConfig((index: number) => {
          // Calculate grid context
          const innerWidth = gridState.containerWidth - 2; // account for borders
          const totalGaps = (gridState.columns - 1) * gridState.gap;
          const columnWidth = (innerWidth - totalGaps) / gridState.columns;

          const context: import("../types").GridHeightContext = {
            containerWidth: gridState.containerWidth,
            columns: gridState.columns,
            gap: gridState.gap,
            columnWidth,
          };

          // Call user's function with context
          const height = baseHeight(index, context);
          return height + gridState.gap; // Add gap for row spacing
        });
      } else if (gap > 0) {
        // Fixed height - just add gap
        ctx.setHeightConfig(baseHeight + gap);
      }

      // Rebuild height cache with row count
      const totalItems = ctx.dataManager.getTotal();
      const totalRows = gridLayout.getTotalRows(totalItems);
      ctx.rebuildHeightCache();

      // Log total height for debugging scroll issues
      const totalHeight = ctx.heightCache.getTotalHeight();
      console.log(
        `🔍 GRID HEIGHT: ${totalRows} rows, total height: ${totalHeight}px, items: ${totalItems}`,
      );

      // ── Add grid CSS class ──
      dom.root.classList.add(`${classPrefix}--grid`);

      // ── Get container width for grid renderer ──
      // Use ctx.getContainerWidth() which reflects the ResizeObserver-detected width
      const containerWidth = ctx.getContainerWidth();

      // ── Create grid renderer ──
      const template = rawConfig.item.template;

      const createAndSetGridRenderer = () => {
        gridRenderer = createGridRenderer<T>(
          dom.items,
          template,
          ctx.heightCache,
          gridLayout,
          classPrefix,
          containerWidth,
          () => ctx.dataManager.getTotal(),
          resolvedConfig.ariaIdPrefix,
        );

        // ── Replace the list renderer with the grid renderer ──
        ctx.replaceRenderer(
          gridRenderer as unknown as import("../render").Renderer<T>,
        );
      };

      createAndSetGridRenderer();

      // ── Expose grid layout for other plugins (e.g., groups) ──
      ctx.methods.set("_getGridLayout", () => gridLayout);
      ctx.methods.set("_getGridConfig", () => gridConfig);

      // ── Expose method to replace renderer (for groups plugin) ──
      ctx.methods.set("_replaceGridRenderer", (newRenderer: any) => {
        gridRenderer = newRenderer;
      });

      // ── Expose method to update grid layout with isHeaderFn (for groups plugin) ──
      ctx.methods.set(
        "_updateGridLayoutForGroups",
        (isHeaderFn: (index: number) => boolean) => {
          gridLayout.update({ isHeaderFn });

          // Rebuild height cache with new row count
          const totalItems = ctx.dataManager.getTotal();
          const totalRows = gridLayout.getTotalRows(totalItems);
          ctx.rebuildHeightCache();

          const totalHeight = ctx.heightCache.getTotalHeight();
          console.log(
            `🔍 GRID+GROUPS: Updated layout - ${totalRows} rows, total height: ${totalHeight}px, items: ${totalItems}`,
          );

          // Recreate renderer with updated layout
          createAndSetGridRenderer();
        },
      );

      // ── Expose update method for grid config changes ──
      ctx.methods.set("updateGrid", (newConfig: Partial<GridPluginConfig>) => {
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

        // Update grid state for height function
        const containerWidth = ctx.getContainerWidth();
        gridState.containerWidth = containerWidth;
        gridState.columns = gridConfig.columns;
        gridState.gap = gridConfig.gap;

        // Update grid renderer
        if (gridRenderer) {
          gridRenderer.updateContainerWidth(containerWidth);
        }

        // Recalculate total rows
        const totalRows = Math.ceil(
          ctx.dataManager.getTotal() / gridConfig.columns,
        );

        // Rebuild height cache with new row count
        ctx.rebuildHeightCache();

        // Update content size to reflect new total height
        ctx.updateContentSize(ctx.heightCache.getTotalHeight());

        // Update compression mode if compression plugin is active
        ctx.updateCompressionMode();

        // Trigger content size handlers (e.g., snapshots plugin)
        for (let i = 0; i < ctx.contentSizeHandlers.length; i++) {
          ctx.contentSizeHandlers[i]!();
        }

        // Clear and re-render
        if (gridRenderer) {
          gridRenderer.clear();
        }
        ctx.forceRender();
      });

      // ── Override render functions to convert row range → item range ──
      const gridRenderIfNeeded = (): void => {
        if (ctx.state.isDestroyed) return;

        // Calculate visible and render ranges (in row space)
        const scrollTop = ctx.scrollController.getScrollTop();
        const containerHeight = ctx.state.viewportState.containerHeight;
        const totalRows = ctx.getVirtualTotal();

        // Calculate visible row range
        const visibleRange = { start: 0, end: 0 };
        if (totalRows === 0 || containerHeight === 0) {
          visibleRange.start = 0;
          visibleRange.end = 0;
        } else {
          visibleRange.start = Math.max(
            0,
            ctx.heightCache.indexAtOffset(scrollTop),
          );
          let visibleEnd = ctx.heightCache.indexAtOffset(
            scrollTop + containerHeight,
          );
          if (visibleEnd < totalRows - 1) visibleEnd++;
          visibleRange.end = Math.min(totalRows - 1, Math.max(0, visibleEnd));
        }

        // Apply overscan
        const overscan = resolvedConfig.overscan ?? 3;
        const renderRange = {
          start: Math.max(0, visibleRange.start - overscan),
          end: Math.min(totalRows - 1, visibleRange.end + overscan),
        };

        // Update viewport state
        ctx.state.viewportState.scrollTop = scrollTop;
        ctx.state.viewportState.visibleRange = visibleRange;
        ctx.state.viewportState.renderRange = renderRange;

        const lastRange = ctx.state.lastRenderRange;
        const isCompressed = ctx.state.viewportState.isCompressed;

        if (
          renderRange.start === lastRange.start &&
          renderRange.end === lastRange.end
        ) {
          if (isCompressed) {
            gridRenderer!.updatePositions(ctx.getCompressionContext());
          }
          return;
        }

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

        // Pass ITEM range to grid renderer (it positions by item index)
        gridRenderer!.render(
          items,
          itemRange,
          new Set(), // selection — overridden by selection plugin if present
          -1,
          compressionCtx,
        );

        ctx.state.lastRenderRange = { ...renderRange };
        emitter.emit("range:change", { range: renderRange });
      };

      const gridForceRender = (): void => {
        if (ctx.state.isDestroyed) return;

        // Reset last range to force re-render
        ctx.state.lastRenderRange = { start: -1, end: -1 };
        gridRenderIfNeeded();
      };

      // Replace the core's render functions with our grid-aware versions
      ctx.setRenderFns(gridRenderIfNeeded, gridForceRender);

      // ── Resize: update column widths ──
      ctx.resizeHandlers.push((width: number, _height: number): void => {
        if (gridRenderer) {
          gridRenderer.updateContainerWidth(width);
        }
      });

      // ── Override scrollToIndex to convert item index → row ──
      // (Plugins like selection that scrollToIndex with item indices need this)
      // The builder core's scrollToIndex already works with the height cache
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
            | import("../types").ScrollToOptions,
        ): void => {
          // Convert item index to row index
          const rowIndex = Math.floor(index / config.columns);
          // Call the base scrollToIndex (which the builder core provides)
          // We need to call it directly on the scroll controller
          const { align, behavior, duration } =
            resolveScrollArgs(alignOrOptions);

          const dataState = ctx.dataManager.getState();
          const totalRows = gridLayout!.getTotalRows(dataState.total);

          const safeRow = Math.max(0, Math.min(rowIndex, totalRows - 1));

          const position = calculateScrollToIndex(
            safeRow,
            ctx.heightCache,
            ctx.state.viewportState.containerHeight,
            totalRows,
            align,
            ctx.getCachedCompression(),
          );

          if (behavior === "smooth") {
            // For smooth scrolling, just do instant for now
            // (the builder core's animateScroll is local to core.ts)
            ctx.scrollController.scrollTo(position);
          } else {
            ctx.scrollController.scrollTo(position);
          }
        },
      );

      // ── Override snapshot methods for grid if snapshots plugin is present ──
      // This is handled by the snapshots plugin which checks for grid

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
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

// =============================================================================
// Helpers (duplicated from builder/core.ts to keep plugin self-contained)
// =============================================================================

import { calculateScrollToIndex } from "../../render";

const DEFAULT_SMOOTH_DURATION = 300;

const resolveScrollArgs = (
  alignOrOptions?:
    | "start"
    | "center"
    | "end"
    | import("../types").ScrollToOptions,
): {
  align: "start" | "center" | "end";
  behavior: "auto" | "smooth";
  duration: number;
} => {
  if (typeof alignOrOptions === "string") {
    return {
      align: alignOrOptions,
      behavior: "auto",
      duration: DEFAULT_SMOOTH_DURATION,
    };
  }
  if (alignOrOptions && typeof alignOrOptions === "object") {
    return {
      align: alignOrOptions.align ?? "start",
      behavior: alignOrOptions.behavior ?? "auto",
      duration: alignOrOptions.duration ?? DEFAULT_SMOOTH_DURATION,
    };
  }
  return {
    align: "start",
    behavior: "auto",
    duration: DEFAULT_SMOOTH_DURATION,
  };
};
