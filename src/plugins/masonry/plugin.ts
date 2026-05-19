/**
 * vlist v2 — Masonry Plugin
 *
 * Switches from list layout to masonry/Pinterest-style layout with
 * shortest-lane placement. Each item is positioned in the shortest
 * column, creating an organic packed layout.
 *
 * Priority 10 — runs before selection (50) so layout is ready.
 *
 * Restrictions:
 * - Cannot be combined with grid or table plugins
 * - Cannot be combined with reverse: true
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import { createMasonryLayout } from "./layout";
import { createMasonryRenderer, type MasonryRenderer } from "./renderer";
import type { MasonryLayout } from "./types";
import type { ItemPlacement } from "./types";

// =============================================================================
// Config
// =============================================================================

export interface MasonryPluginConfig {
  columns: number;
  gap?: number;
  /**
   * Optional size function for responsive sizing relative to column width.
   * If omitted, reads sizes from the main config's item.height/width.
   */
  size?: (index: number, context: MasonryContext) => number;
}

export interface MasonryContext {
  columnWidth: number;
  columns: number;
  gap: number;
  containerWidth: number;
}

// =============================================================================
// Constants
// =============================================================================

const OVERSCAN_PX_PER_UNIT = 100;
const EMPTY_ID_SET: Set<string | number> = new Set();

// =============================================================================
// Factory
// =============================================================================

export function masonry<T extends VListItem = VListItem>(
  config: MasonryPluginConfig,
): VListPlugin<T> {
  if (!config.columns || config.columns < 1) {
    throw new Error("[vlist] masonry: columns must be >= 1");
  }

  let layout: MasonryLayout;
  let renderer: MasonryRenderer<T> | null = null;
  let engineState: EngineState;
  let storedCtx: PluginContext<T> | null = null;
  let hz: boolean;
  let classPrefix: string;
  let overscanPx: number;
  let cachedPlacements: ItemPlacement[] = [];

  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let forceNextRender = true;
  let lastLayoutTotal = -1;

  // Reusable masonry context for size function
  const masonryCtx: MasonryContext = {
    columnWidth: 0,
    columns: 0,
    gap: 0,
    containerWidth: 0,
  };

  // Selection method references (resolved lazily)
  let selectedIdsGetter: (() => Set<string | number>) | null = null;
  let focusedIndexGetter: (() => number) | null = null;
  let selectionResolved = false;

  function resolveSelectionMethods(): void {
    if (selectionResolved || !storedCtx) return;
    selectionResolved = true;
    selectedIdsGetter = (storedCtx.getMethod("_getSelectedIds") as (() => Set<string | number>)) ?? null;
    focusedIndexGetter = (storedCtx.getMethod("_getFocusedIndex") as (() => number)) ?? null;
  }

  let rawSizeSpec: number | ((index: number, ...args: unknown[]) => number) | null = null;

  function getSizeFn(): (index: number) => number {
    if (config.size) {
      return (index: number): number => config.size!(index, masonryCtx);
    }
    if (rawSizeSpec !== null && typeof rawSizeSpec === "function") {
      return (index: number): number => (rawSizeSpec as Function)(index, masonryCtx);
    }
    return (index: number): number => storedCtx!.sizeCache.getSize(index);
  }

  function updateMasonryContext(): void {
    const cols = layout.columns;
    const g = layout.gap;
    masonryCtx.containerWidth = layout.containerSize;
    masonryCtx.columns = cols;
    masonryCtx.gap = g;
    masonryCtx.columnWidth = Math.max(0, (layout.containerSize - (cols - 1) * g) / cols);
  }

  function calculateLayout(): void {
    if (!storedCtx) return;

    updateMasonryContext();
    const totalItems = engineState.totalItems;
    cachedPlacements = layout.calculateLayout(totalItems, getSizeFn());
    lastLayoutTotal = totalItems;

    const totalSize = layout.getTotalSize(cachedPlacements);
    storedCtx.updateContentSize(totalSize);
  }

  function masonryRenderIfNeeded(): void {
    if (engineState.destroyed || !storedCtx || !renderer) return;

    // Recalculate layout if data changed
    if (engineState.totalItems !== lastLayoutTotal) {
      calculateLayout();
    }

    resolveSelectionMethods();

    const scrollPosition = engineState.scrollPosition;
    const containerSize = engineState.containerSize;

    if (!forceNextRender && scrollPosition === lastScrollPosition && containerSize === lastContainerSize) {
      return;
    }
    lastScrollPosition = scrollPosition;
    lastContainerSize = containerSize;
    forceNextRender = false;

    if (containerSize <= 0 || cachedPlacements.length === 0) return;

    const mainAxisStart = Math.max(0, scrollPosition - overscanPx);
    const mainAxisEnd = scrollPosition + containerSize + overscanPx;

    const visiblePlacements = layout.getVisibleItems(cachedPlacements, mainAxisStart, mainAxisEnd);

    const selectedIds = selectedIdsGetter?.() ?? EMPTY_ID_SET;
    const focusedIndex = focusedIndexGetter?.() ?? -1;

    const items = storedCtx.getItems();
    const getItem = (index: number): T | undefined => items[index];

    renderer.render(getItem, visiblePlacements, selectedIds, focusedIndex);

    // Update engine state for other plugins
    const vLen = visiblePlacements.length;
    const firstIndex = vLen > 0 ? visiblePlacements[0]!.index : 0;
    const lastIndex = vLen > 0 ? visiblePlacements[vLen - 1]!.index : 0;

    engineState.prevRangeStart = firstIndex;
    engineState.prevRangeEnd = lastIndex;
    engineState.renderPending = false;

    // Fill EngineState buffers for plugins that read them
    const count = Math.min(vLen, engineState.capacity);
    engineState.visibleCount = count;
    engineState.startIndex = firstIndex;
    for (let i = 0; i < count; i++) {
      const p = visiblePlacements[i]!;
      engineState.visibleIndices[i] = p.index;
      engineState.visibleOffsets[i] = p.y;
      engineState.visibleSizes[i] = p.size;
    }
  }

  function masonryForceRender(): void {
    if (engineState.destroyed) return;
    engineState.prevRangeStart = -1;
    engineState.prevRangeEnd = -1;
    engineState.renderPending = true;
    forceNextRender = true;
    masonryRenderIfNeeded();
  }

  return {
    name: "masonry",
    priority: 10,
    conflicts: ["grid", "table"],

    setup(ctx: PluginContext<T>): void {
      storedCtx = ctx;
      engineState = ctx.getState();
      rawSizeSpec = ctx.rawSizeSpec;
      hz = ctx.config.horizontal;
      classPrefix = ctx.config.classPrefix;
      overscanPx = ctx.config.overscan * OVERSCAN_PX_PER_UNIT;

      if (ctx.config.reverse) {
        throw new Error("[vlist] masonry: cannot be combined with reverse mode");
      }

      const containerCrossSize = engineState.crossSize;

      layout = createMasonryLayout({
        columns: config.columns,
        gap: config.gap ?? 0,
        containerSize: containerCrossSize,
      });

      renderer = createMasonryRenderer<T>(
        ctx.dom.content,
        ctx.template,
        classPrefix,
        hz,
        () => engineState.totalItems,
        undefined,
        undefined,
        ctx.config.interactive,
      );

      ctx.dom.root.classList.add(`${classPrefix}--masonry`);

      // Replace render pipeline
      ctx.setRenderFn(masonryRenderIfNeeded, masonryForceRender);

      // Initial layout
      calculateLayout();

      // ── Public methods ─────────────────────────────────────────

      ctx.registerMethod("getMasonryLayout", () => layout);

      ctx.registerMethod("updateMasonry", (newConfig: Partial<MasonryPluginConfig>) => {
        if (newConfig.columns !== undefined && newConfig.columns < 1) {
          throw new Error("[vlist] updateMasonry: columns must be >= 1");
        }
        if (newConfig.gap !== undefined && newConfig.gap < 0) {
          throw new Error("[vlist] updateMasonry: gap must be >= 0");
        }
        const updates: Partial<{ columns: number; gap: number }> = {};
        if (newConfig.columns !== undefined) updates.columns = newConfig.columns;
        if (newConfig.gap !== undefined) updates.gap = newConfig.gap;
        layout.update(updates);
        calculateLayout();
        renderer?.clear();
        masonryForceRender();
      });

      // scrollToIndex: map item index to its placement position
      ctx.registerMethod("scrollToIndex", (
        index: number,
        align: "start" | "center" | "end" = "start",
      ) => {
        const placement = cachedPlacements[index];
        if (!placement) return;

        const containerSize = engineState.containerSize;
        const totalSize = layout.getTotalSize(cachedPlacements);
        const maxScroll = Math.max(0, totalSize - containerSize);

        let pos = placement.y;
        if (align === "center") {
          pos = placement.y - containerSize / 2 + placement.size / 2;
        } else if (align === "end") {
          pos = placement.y - containerSize + placement.size;
        }
        pos = Math.max(0, Math.min(pos, maxScroll));
        ctx.scrollTo(pos);
      });

      // Placement-based scroll into view (used by selection focus)
      ctx.registerMethod("_scrollItemIntoView", (index: number): void => {
        const placement = cachedPlacements[index];
        if (!placement) return;

        const scrollPos = engineState.scrollPosition;
        const containerSize = engineState.containerSize;
        const itemTop = placement.y;
        const itemBottom = itemTop + placement.size;

        if (itemTop < scrollPos) {
          ctx.scrollTo(Math.max(0, itemTop));
        } else if (itemBottom > scrollPos + containerSize) {
          ctx.scrollTo(itemBottom - containerSize);
        }
      });

      // ── Cleanup ────────────────────────────────────────────────

      ctx.registerDestroyHandler(() => {
        renderer?.destroy();
        renderer = null;
        ctx.dom.root.classList.remove(`${classPrefix}--masonry`);
      });
    },

    hooks: {
      onResize(_width: number, _height: number): void {
        if (!layout || !storedCtx) return;

        const newCross = engineState.crossSize;
        if (Math.abs(newCross - layout.containerSize) < 1) return;

        layout.update({ containerSize: newCross });
        calculateLayout();
        renderer?.clear();
        masonryForceRender();
      },

      onIdle(): void {
        renderer?.sortDOM();
      },
    },

    destroy(): void {
      renderer?.destroy();
      renderer = null;
      cachedPlacements = [];
      storedCtx = null;
    },
  };
}
