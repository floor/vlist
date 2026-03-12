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
 *
 * - Items passed to renderer via data manager reference (no sparse array)
 * - All data mutation methods intercepted for layout recalculation
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";
import { resolvePadding, crossAxisPaddingFrom, mainAxisPaddingFrom } from "../../utils/padding";
import { resolveScrollArgs, createSmoothScroll } from "../../builder/scroll";

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

// =============================================================================
// Constants
// =============================================================================

/**
 * Pixel multiplier for the overscan count.
 * Masonry items have variable heights, so overscan is expressed in pixels
 * rather than rows. Each overscan unit adds this many pixels of buffer
 * above and below the viewport.
 */
const OVERSCAN = 100;

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

    // Conflict with other layout features
    conflicts: ["withGrid", "withTable"],

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

      // ── Resolve padding from config ──
      const resolvedPad = resolvePadding(rawConfig.padding);
      const crossAxisPadding = crossAxisPaddingFrom(resolvedPad, isHorizontal);
      const mainAxisPadding = mainAxisPaddingFrom(resolvedPad, isHorizontal);

      // ── Get container size (cross-axis dimension minus padding) ──
      const getCrossAxisSize = (): number => {
        const raw = isHorizontal ? dom.viewport.clientHeight : dom.viewport.clientWidth;
        return raw - crossAxisPadding;
      };

      // ── Create masonry layout ──
      const masonryConfig = {
        columns: config.columns,
        gap: config.gap ?? 0,
        containerSize: getCrossAxisSize(),
      };

      masonryLayout = createMasonryLayout(masonryConfig);

      // ── Item size configuration ──
      // When the user provides a function, inject masonry context (columnWidth,
      // columns, gap, containerSize) so heights can be expressed relative to
      // the current column width — identical pattern to the grid feature.
      const item = rawConfig.item;
      const rawSizeFn = isHorizontal && rawConfig.item.width
        ? rawConfig.item.width
        : item.height;

      // Reusable context object — mutated in place once per layout pass.
      // Single allocation for the lifetime of the list.
      const masonryContext = {
        containerWidth: 0,
        columns: 0,
        gap: 0,
        columnWidth: 0,
      };

      // Size function hoisted once — captures masonryContext by reference.
      // For number configs the wrapper is a trivial constant return.
      const sizeFn: (index: number) => number =
        typeof rawSizeFn === "function"
          ? (index: number): number => rawSizeFn(index, masonryContext)
          : () => rawSizeFn as number;

      // ── Calculate layout (on initialization and when data changes) ──
      const calculateLayout = (): void => {
        const totalItems = ctx.dataManager.getTotal();

        // Refresh context once before the O(n) layout loop.
        // Arithmetic is cheaper than a dirty-check branch per item.
        const ml = masonryLayout!;
        masonryContext.containerWidth = ml.containerSize;
        masonryContext.columns = ml.columns;
        masonryContext.gap = ml.gap;
        const totalGap = (ml.columns - 1) * ml.gap;
        masonryContext.columnWidth = Math.max(0, (masonryContext.containerWidth - totalGap) / ml.columns);

        cachedPlacements = ml.calculateLayout(
          totalItems,
          sizeFn,
        );

        // Update total size
        const totalSize = masonryLayout!.getTotalSize(cachedPlacements);
        ctx.sizeCache.getTotalSize = () => totalSize;

        // Update DOM content size (padding compensation handled by updateContentSize)
        ctx.updateContentSize(totalSize);
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
      const overscanPx = resolvedConfig.overscan * OVERSCAN;

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
        const newContainerSize = (isHorizontal ? height : width) - crossAxisPadding;

        if (masonryLayout && masonryLayout.containerSize !== newContainerSize) {
          masonryLayout.update({ containerSize: newContainerSize });
          calculateLayout();
          if (masonryRenderer) masonryRenderer.clear();
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
      const { animateScroll, cancelScroll } = createSmoothScroll(
        ctx.scrollController,
        ctx.renderIfNeeded,
      );

      ctx.methods.set("cancelScroll", cancelScroll);

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
          const placement = cachedPlacements[index];
          if (!placement) return;

          const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);

          const mainAxisPosition = placement.y;
          const containerSize = ctx.state.viewportState.containerSize;

          let scrollTarget = mainAxisPosition;

          if (align === "center") {
            scrollTarget = mainAxisPosition - containerSize / 2 + placement.size / 2;
          } else if (align === "end") {
            scrollTarget = mainAxisPosition - containerSize + placement.size;
            // For the last item, scroll to the true bottom (show end padding).
            // In masonry the last item by index may not be in the tallest lane,
            // but "end" on the final item should reach the absolute bottom.
            const totalSize = masonryLayout!.getTotalSize(cachedPlacements);
            if (index === cachedPlacements.length - 1) {
              const paddedMax = Math.max(0, totalSize + mainAxisPadding - containerSize);
              scrollTarget = paddedMax;
            }
          }

          scrollTarget = Math.max(0, scrollTarget);
          scrollTarget = ctx.adjustScrollPosition(scrollTarget);

          if (behavior === "smooth") {
            animateScroll(ctx.scrollController.getScrollTop(), scrollTarget, duration);
          } else {
            cancelScroll();
            ctx.scrollController.scrollTo(scrollTarget);
          }
        },
      );

      // ── Initial layout calculation ──
      calculateLayout();

      // ── Accessibility: reorder DOM on scroll idle ──
      ctx.idleHandlers.push(() => {
        if (masonryRenderer) masonryRenderer.sortDOM();
      });

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        cancelScroll();
        if (masonryRenderer) {
          masonryRenderer.destroy();
        }
        dom.root.classList.remove(`${classPrefix}--masonry`);
      });
    },
  };
};