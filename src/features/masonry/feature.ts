/**
 * vlist/masonry - Builder Feature
 * Switches from list layout to masonry/Pinterest-style layout.
 *
 * Priority: 10 (runs first — replaces the renderer before anything else renders)
 *
 * What it does:
 * - Replaces renderer — swaps the list renderer with a masonry renderer
 * - Calculates item placements using shortest-lane algorithm
 * - Positions items using absolute coordinates (no row alignment)
 * - Renders only visible items based on scroll position
 * - CSS class — adds .vlist--masonry to the root element
 *
 * Key differences from grid:
 * - No row-based virtualization (items flow into shortest column/row)
 * - O(n) layout calculation (must track lane heights)
 * - Items positioned by cached x/y coordinates
 * - Variable heights create organic, packed layout
 *
 * Restrictions:
 * - Cannot be combined with reverse: true
 * - Item sizes must be deterministic (no dynamic content sizing)
 *
 * Can be combined with withSelection for selectable masonry layouts.
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

import { createMasonryLayout } from "./layout";
import { createMasonryRenderer, type MasonryRenderer } from "./renderer";
import type { MasonryLayout, ItemPlacement } from "./types";

// =============================================================================
// Feature Config
// =============================================================================

/** Masonry feature configuration */
export interface MasonryFeatureConfig {
  /** Number of cross-axis divisions (columns in vertical, rows in horizontal) */
  columns: number;

  /** Gap between items in pixels (default: 0) */
  gap?: number;
}

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a masonry feature for the builder.
 *
 * Switches from list layout to masonry with shortest-lane placement.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withMasonry } from 'vlist/masonry'
 *
 * const gallery = vlist({
 *   container: '#gallery',
 *   item: {
 *     height: (item) => item.height, // Variable heights
 *     template: renderPhoto,
 *   },
 *   items: photos,
 * })
 * .use(withMasonry({ columns: 4, gap: 8 }))
 * .build()
 * ```
 */
export const withMasonry = <T extends VListItem = VListItem>(
  config: MasonryFeatureConfig,
): VListFeature<T> => {
  // Validate
  if (!config.columns || config.columns < 1) {
    throw new Error(
      "[vlist/builder] withMasonry: columns must be a positive integer >= 1",
    );
  }

  let masonryLayout: MasonryLayout | null = null;
  let masonryRenderer: MasonryRenderer<T> | null = null;
  let cachedPlacements: ItemPlacement[] = [];

  return {
    name: "withMasonry",
    priority: 10,

    setup(ctx: BuilderContext<T>): void {
      const { dom, emitter, config: resolvedConfig, rawConfig } = ctx;
      const classPrefix = resolvedConfig.classPrefix;
      const isHorizontal = resolvedConfig.horizontal;

      // Validate restrictions
      if (resolvedConfig.reverse) {
        throw new Error(
          "[vlist/builder] withMasonry: cannot be combined with reverse mode",
        );
      }

      // ── Add masonry CSS class ──
      dom.root.classList.add(`${classPrefix}--masonry`);

      // ── Get container size (cross-axis dimension) ──
      const getCrossAxisSize = (): number => {
        return isHorizontal ? dom.viewport.clientHeight : dom.viewport.clientWidth;
      };

      // ── Create masonry layout ──
      const masonryConfig = {
        columns: config.columns,
        gap: config.gap ?? 0,
        containerSize: getCrossAxisSize(),
      };

      masonryLayout = createMasonryLayout(masonryConfig);

      // ── Item configuration ──
      const item = rawConfig.item;
      const itemSizeFn = typeof item.height === "function" 
        ? item.height 
        : (_index: number) => item.height as number;

      // For horizontal mode, use width if provided
      const getItemSize = isHorizontal && rawConfig.item.width
        ? (typeof rawConfig.item.width === "function"
          ? rawConfig.item.width
          : (_index: number) => rawConfig.item.width as number)
        : itemSizeFn;

      // ── Calculate layout (on initialization and when data changes) ──
      const calculateLayout = (): void => {
        const totalItems = ctx.dataManager.getTotal();
        
        cachedPlacements = masonryLayout!.calculateLayout(
          totalItems,
          (index: number) => {
            return getItemSize(index) as number;
          },
        );

        // Update total size
        const totalSize = masonryLayout!.getTotalSize(cachedPlacements);
        ctx.sizeCache.getTotalSize = () => totalSize;

        // Update DOM content size
        if (isHorizontal) {
          dom.content.style.width = `${totalSize}px`;
        } else {
          dom.content.style.height = `${totalSize}px`;
        }
      };

      // ── Create masonry renderer ──
      const template = rawConfig.item.template;

      masonryRenderer = createMasonryRenderer<T>(
        dom.items,
        template,
        classPrefix,
        isHorizontal,
        () => ctx.dataManager.getTotal(),
        resolvedConfig.ariaIdPrefix,
      );

      // ── Override render functions ──
      const masonryRenderIfNeeded = (): void => {
        if (ctx.state.isDestroyed) return;

        // Calculate visible range in main axis
        const scrollPosition = ctx.scrollController.getScrollTop();
        const containerSize = ctx.state.viewportState.containerSize;
        const overscan = resolvedConfig.overscan ?? 3;

        // Main axis range with overscan
        const mainAxisStart = Math.max(0, scrollPosition - overscan * 100);
        const mainAxisEnd = scrollPosition + containerSize + overscan * 100;

        // Get visible items
        const visiblePlacements = masonryLayout!.getVisibleItems(
          cachedPlacements,
          mainAxisStart,
          mainAxisEnd,
        );

        // Get items data — sparse array indexed by global position
        // so the renderer can access items[placement.index] correctly
        const items: T[] = [];
        for (const placement of visiblePlacements) {
          const item = ctx.dataManager.getItem(placement.index);
          if (item) items[placement.index] = item;
        }

        // Get selection state
        const selectedIdsGetter = ctx.methods.get("_getSelectedIds") as (() => Set<string | number>) | undefined;
        const selectedIds = selectedIdsGetter ? selectedIdsGetter() : new Set<string | number>();
        const focusedIndexGetter = ctx.methods.get("_getFocusedIndex") as (() => number) | undefined;
        const focusedIndex = focusedIndexGetter ? focusedIndexGetter() : -1;

        // Render
        if (masonryRenderer && items.length > 0) {
          masonryRenderer.render(
            items,
            visiblePlacements,
            selectedIds,
            focusedIndex,
          );
        }

        // Update viewport state
        ctx.state.viewportState.scrollPosition = scrollPosition;
        ctx.state.viewportState.visibleRange = {
          start: visiblePlacements[0]?.index ?? 0,
          end: visiblePlacements[visiblePlacements.length - 1]?.index ?? 0,
        };
        ctx.state.viewportState.renderRange = ctx.state.viewportState.visibleRange;

        // Emit range change if changed
        const lastRange = ctx.state.lastRenderRange;
        const newRange = ctx.state.viewportState.renderRange;
        if (lastRange.start !== newRange.start || lastRange.end !== newRange.end) {
          ctx.state.lastRenderRange = newRange;
          emitter.emit("range:change", { range: newRange });
        }
      };

      const masonryForceRender = (): void => {
        ctx.state.lastRenderRange = { start: -1, end: -1 };
        masonryRenderIfNeeded();
      };

      // ── Replace core render functions ──
      ctx.setRenderFns(masonryRenderIfNeeded, masonryForceRender);

      // ── Handle resize ──
      const handleResize = (width: number, height: number): void => {
        const newContainerSize = isHorizontal ? height : width;
        
        if (masonryLayout && masonryLayout.containerSize !== newContainerSize) {
          masonryLayout.update({ containerSize: newContainerSize });
          calculateLayout();
          masonryForceRender();
        }
      };

      ctx.resizeHandlers.push(handleResize);

      // ── Handle data changes ──
      const handleDataChange = (): void => {
        calculateLayout();
        masonryForceRender();
      };

      // Override data manager methods to recalculate layout
      const originalSetItems = ctx.dataManager.setItems.bind(ctx.dataManager);
      ctx.dataManager.setItems = (items: T[]) => {
        originalSetItems(items);
        handleDataChange();
      };

      // ── Scroll to index (map to item position) ──
      ctx.methods.set("scrollToIndex", (index: number, align?: string, behavior?: ScrollBehavior) => {
        const placement = cachedPlacements[index];
        if (!placement) return;

        const mainAxisPosition = placement.position.y; // y for vertical, will be swapped for horizontal
        const containerSize = ctx.state.viewportState.containerSize;
        
        let scrollTarget = mainAxisPosition;
        
        if (align === "center") {
          scrollTarget = mainAxisPosition - containerSize / 2 + placement.size / 2;
        } else if (align === "end") {
          scrollTarget = mainAxisPosition - containerSize + placement.size;
        }
        
        scrollTarget = Math.max(0, scrollTarget);
        
        ctx.scrollController.scrollTo(scrollTarget, behavior === "smooth");
      });

      // ── Initial layout calculation ──
      calculateLayout();

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        if (masonryRenderer) {
          masonryRenderer.destroy();
        }
        dom.root.classList.remove(`${classPrefix}--masonry`);
      });
    },
  };
};