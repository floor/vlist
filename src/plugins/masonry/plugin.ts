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

  // Persistent getItem closure — avoids per-render allocation
  let cachedItems: readonly T[] = [];
  const getItem = (index: number): T | undefined => cachedItems[index];

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

  // ── Per-lane navigation index ──
  let laneItems: number[][] = [];
  let itemLanePos: Int32Array = new Int32Array(0);
  let laneYCenters: Float64Array[] = [];

  function rebuildLaneIndex(): void {
    const cols = layout.columns;
    const total = cachedPlacements.length;

    laneItems = new Array(cols);
    for (let c = 0; c < cols; c++) laneItems[c] = [];

    if (itemLanePos.length < total) {
      itemLanePos = new Int32Array(total);
    }

    for (let i = 0; i < total; i++) {
      const p = cachedPlacements[i]!;
      const pos = laneItems[p.lane]!.length;
      laneItems[p.lane]!.push(i);
      itemLanePos[i] = pos;
    }

    laneYCenters = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const items = laneItems[c]!;
      const yc = new Float64Array(items.length);
      for (let j = 0; j < items.length; j++) {
        const p = cachedPlacements[items[j]!]!;
        yc[j] = p.y + p.size * 0.5;
      }
      laneYCenters[c] = yc;
    }
  }

  function bsNearest(arr: Float64Array, target: number): number {
    const len = arr.length;
    if (!len) return -1;
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(arr[lo - 1]! - target) <= Math.abs(arr[lo]! - target)) {
      return lo - 1;
    }
    return lo;
  }

  function navigate(currentIndex: number, key: string, total: number): number {
    const placement = cachedPlacements[currentIndex];
    if (!placement) return currentIndex;
    const lane = placement.lane;
    const cols = layout.columns;
    const posInLane = itemLanePos[currentIndex]!;
    const myLane = laneItems[lane]!;

    const k = hz
      ? key === "ArrowDown" ? "ArrowRight"
        : key === "ArrowUp" ? "ArrowLeft"
        : key === "ArrowRight" ? "ArrowDown"
        : key === "ArrowLeft" ? "ArrowUp"
        : key
      : key;

    switch (k) {
      case "ArrowDown":
        if (posInLane + 1 < myLane.length) return myLane[posInLane + 1]!;
        return currentIndex;
      case "ArrowUp":
        if (posInLane > 0) return myLane[posInLane - 1]!;
        return currentIndex;
      case "ArrowRight": {
        if (lane >= cols - 1) return currentIndex;
        const targetLane = lane + 1;
        const yCenter = placement.y + placement.size * 0.5;
        const targetItems = laneItems[targetLane]!;
        if (!targetItems.length) return currentIndex;
        const pos = bsNearest(laneYCenters[targetLane]!, yCenter);
        return pos >= 0 ? targetItems[pos]! : currentIndex;
      }
      case "ArrowLeft": {
        if (lane <= 0) return currentIndex;
        const targetLane = lane - 1;
        const yCenter = placement.y + placement.size * 0.5;
        const targetItems = laneItems[targetLane]!;
        if (!targetItems.length) return currentIndex;
        const pos = bsNearest(laneYCenters[targetLane]!, yCenter);
        return pos >= 0 ? targetItems[pos]! : currentIndex;
      }
      case "Home":
        return 0;
      case "End":
        return total - 1;
      case "PageDown": {
        const containerSize = engineState.containerSize;
        const itemSize = placement.size > 0 ? placement.size : 150;
        const jump = Math.max(1, Math.floor(containerSize / itemSize));
        const target = Math.min(posInLane + jump, myLane.length - 1);
        return myLane[target]!;
      }
      case "PageUp": {
        const containerSize = engineState.containerSize;
        const itemSize = placement.size > 0 ? placement.size : 150;
        const jump = Math.max(1, Math.floor(containerSize / itemSize));
        const target = Math.max(0, posInLane - jump);
        return myLane[target]!;
      }
    }
    return currentIndex;
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
    rebuildLaneIndex();

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

    cachedItems = storedCtx.getItems();

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
    calculateLayout();
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
        renderer?.clear();
        masonryForceRender();
      });

      // scrollToIndex: map item index to its placement position
      ctx.registerMethod("scrollToIndex", (
        index: number,
        alignOrOptions: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number } = "start",
      ) => {
        const placement = cachedPlacements[index];
        if (!placement) return;

        const align = typeof alignOrOptions === "string" ? alignOrOptions : (alignOrOptions.align ?? "start");
        const behavior = typeof alignOrOptions === "object" ? alignOrOptions.behavior : undefined;
        const duration = typeof alignOrOptions === "object" ? alignOrOptions.duration : undefined;

        const containerSize = engineState.containerSize;
        const totalSize = layout.getTotalSize(cachedPlacements);
        const maxScroll = Math.max(0, totalSize - containerSize);

        let pos = placement.y;
        if (align === "center") {
          pos = placement.y - containerSize / 2 + placement.size / 2;
        } else if (align === "end") {
          pos = placement.y - containerSize + placement.size;
          if (index >= engineState.totalItems - 1 && placement.y + placement.size > maxScroll) {
            pos = maxScroll;
          }
        }
        pos = Math.max(0, Math.min(pos, maxScroll));

        if (behavior === "smooth" && duration && duration > 0) {
          ctx.smoothScrollTo(pos, duration);
        } else {
          ctx.scrollTo(pos);
        }
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

      // ── Lane-aware 2D keyboard navigation ─────────────────────

      ctx.setNavConfig({
        total: () => engineState.totalItems,
        navigate,
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
