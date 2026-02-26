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
 *
 * Performance:
 * - Early exit when scroll position + container size unchanged (zero work per redundant frame)
 * - Cached empty Set for no-selection case (zero allocation per frame)
 * - Viewport state mutated in place (no object creation per frame)
 * - Cached getItem closure (no closure allocation per frame)
 * - Items passed to renderer via data manager reference (no sparse array)
 * - All data mutation methods intercepted for layout recalculation
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
// Shared constants
// =============================================================================

/** Cached empty Set — avoids allocation on every scroll frame when no selection */
const EMPTY_ID_SET: Set<string | number> = new Set();

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

      // ── Item size configuration ──
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

      // ── Cached selection method references ──
      // Resolved once after setup, avoiding Map.get() on every frame
      let selectedIdsGetter: (() => Set<string | number>) | null = null;
      let focusedIndexGetter: (() => number) | null = null;
      let selectionMethodsResolved = false;

      const resolveSelectionMethods = (): void => {
        if (selectionMethodsResolved) return;
        selectionMethodsResolved = true;
        selectedIdsGetter = (ctx.methods.get("_getSelectedIds") as (() => Set<string | number>)) ?? null;
        focusedIndexGetter = (ctx.methods.get("_getFocusedIndex") as (() => number)) ?? null;
      };

      // ── Cached getItem closure — created once, not per frame ──
      const getItem = (index: number): T | undefined =>
        ctx.dataManager.getItem(index) as T | undefined;

      // ── Scroll state for early-exit guard ──
      // When scroll position + container size are identical to last frame,
      // all downstream work (binary search, renderer diffing) is skipped.
      let lastScrollPosition = -1;
      let lastContainerSize = -1;
      let forceNextRender = true; // first render must always run

      // ── Precomputed overscan value ──
      const overscanPx = (resolvedConfig.overscan ?? 3) * 100;

      // ── Override render functions ──
      const masonryRenderIfNeeded = (): void => {
        if (ctx.state.isDestroyed) return;

        // Resolve selection method references on first render
        // (selection feature may set up after masonry)
        resolveSelectionMethods();

        // Calculate visible range in main axis
        const scrollPosition = ctx.scrollController.getScrollTop();
        const containerSize = ctx.state.viewportState.containerSize;

        // ── Early exit: skip all work when nothing changed ──
        if (
          !forceNextRender &&
          scrollPosition === lastScrollPosition &&
          containerSize === lastContainerSize
        ) {
          return;
        }
        lastScrollPosition = scrollPosition;
        lastContainerSize = containerSize;
        forceNextRender = false;

        // Main axis range with overscan
        const mainAxisStart = Math.max(0, scrollPosition - overscanPx);
        const mainAxisEnd = scrollPosition + containerSize + overscanPx;

        // Get visible items from layout (O(k * log(n/k)) with binary search)
        const visiblePlacements = masonryLayout!.getVisibleItems(
          cachedPlacements,
          mainAxisStart,
          mainAxisEnd,
        );

        // Get selection state — use cached empty set to avoid allocation
        const selectedIds = selectedIdsGetter ? selectedIdsGetter() : EMPTY_ID_SET;
        const focusedIndex = focusedIndexGetter ? focusedIndexGetter() : -1;

        // Render visible items — pass cached getItem closure (no allocation)
        if (masonryRenderer && visiblePlacements.length > 0) {
          masonryRenderer.render(
            getItem,
            visiblePlacements,
            selectedIds,
            focusedIndex,
          );
        }

        // Update viewport state — mutate in place to avoid object allocation
        const viewportState = ctx.state.viewportState;
        viewportState.scrollPosition = scrollPosition;

        const vLen = visiblePlacements.length;
        const firstIndex = vLen > 0 ? visiblePlacements[0]!.index : 0;
        const lastIndex = vLen > 0 ? visiblePlacements[vLen - 1]!.index : 0;

        viewportState.visibleRange.start = firstIndex;
        viewportState.visibleRange.end = lastIndex;
        viewportState.renderRange.start = firstIndex;
        viewportState.renderRange.end = lastIndex;

        // Emit range change if changed
        const lastRange = ctx.state.lastRenderRange;
        if (lastRange.start !== firstIndex || lastRange.end !== lastIndex) {
          lastRange.start = firstIndex;
          lastRange.end = lastIndex;
          emitter.emit("range:change", { range: { start: firstIndex, end: lastIndex } });
        }
      };

      const masonryForceRender = (): void => {
        ctx.state.lastRenderRange.start = -1;
        ctx.state.lastRenderRange.end = -1;
        forceNextRender = true;
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

      // Intercept all data mutation methods to recalculate layout
      const dm = ctx.dataManager as any;
      const intercept = (method: string): void => {
        if (typeof dm[method] !== "function") return;
        const original = dm[method].bind(dm);
        dm[method] = (...args: any[]) => { original(...args); handleDataChange(); };
      };
      intercept("setItems");
      intercept("appendItems");
      intercept("prependItems");
      intercept("updateItem");
      intercept("removeItem");

      // ── Scroll to index (map to item position) ──
      ctx.methods.set("scrollToIndex", (index: number, align?: string, behavior?: ScrollBehavior) => {
        const placement = cachedPlacements[index];
        if (!placement) return;

        const mainAxisPosition = placement.y;
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