/**
 * vlist - Public API Methods
 * Data, scroll, and selection methods
 *
 * All methods receive the VListContext and operate on its state.
 * This keeps vlist.ts focused on orchestration.
 */

import type { VListItem, ScrollToOptions, ScrollSnapshot } from "./types";
import type { VListContext } from "./context";

import { calculateScrollToIndex } from "./render";
import {
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  getSelectedIds,
  getSelectedItems,
  isSelected,
} from "./selection";

// =============================================================================
// Types
// =============================================================================

/** Data API methods */
export interface DataMethods<T extends VListItem> {
  setItems: (items: T[]) => void;
  appendItems: (items: T[]) => void;
  prependItems: (items: T[]) => void;
  updateItem: (id: string | number, updates: Partial<T>) => void;
  removeItem: (id: string | number) => void;
  reload: () => Promise<void>;
}

/** Scroll API methods */
export interface ScrollMethods {
  scrollToIndex: (
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ) => void;
  scrollToItem: (
    id: string | number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ) => void;
  cancelScroll: () => void;
  getScrollPosition: () => number;
}

/** Snapshot API methods */
export interface SnapshotMethods {
  getScrollSnapshot: () => ScrollSnapshot;
  restoreScroll: (snapshot: ScrollSnapshot) => void;
}

/** Selection API methods */
export interface SelectionMethods<T extends VListItem> {
  select: (...ids: Array<string | number>) => void;
  deselect: (...ids: Array<string | number>) => void;
  toggleSelect: (id: string | number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  getSelected: () => Array<string | number>;
  getSelectedItems: () => T[];
}

// =============================================================================
// Data Methods
// =============================================================================

/**
 * Create data manipulation methods
 */
export const createDataMethods = <T extends VListItem>(
  ctx: VListContext<T>,
): DataMethods<T> => ({
  /**
   * Set items (replaces all)
   */
  setItems: (items: T[]): void => {
    ctx.dataManager.setItems(items, 0, items.length);
  },

  /**
   * Append items to the end
   */
  appendItems: (items: T[]): void => {
    const currentTotal = ctx.dataManager.getState().total;
    ctx.dataManager.setItems(items, currentTotal);
  },

  /**
   * Prepend items to the start
   * Note: This shifts all existing indices, so we need to reload
   */
  prependItems: (items: T[]): void => {
    const existingTotal = ctx.dataManager.getState().total;
    const existingItems =
      existingTotal > 0
        ? ctx.dataManager.getItemsInRange(0, existingTotal - 1)
        : [];

    // Clear and re-add with new items first
    ctx.dataManager.clear();
    ctx.dataManager.setItems([...items, ...existingItems], 0);
  },

  /**
   * Update a single item by ID
   */
  updateItem: (id: string | number, updates: Partial<T>): void => {
    const updated = ctx.dataManager.updateItem(id, updates);

    if (updated) {
      // Re-render the specific item if visible
      const index = ctx.dataManager.getIndexById(id);
      const item = ctx.dataManager.getItem(index);

      if (
        item &&
        index >= ctx.state.viewportState.renderRange.start &&
        index <= ctx.state.viewportState.renderRange.end
      ) {
        ctx.renderer.updateItem(
          index,
          item,
          isSelected(ctx.state.selectionState, id),
          ctx.state.selectionState.focusedIndex === index,
        );
      }
    }
  },

  /**
   * Remove item by ID
   */
  removeItem: (id: string | number): void => {
    ctx.dataManager.removeItem(id);
  },

  /**
   * Reload data
   */
  reload: async (): Promise<void> => {
    if (ctx.config.hasAdapter) {
      await ctx.dataManager.reload();
    }
  },
});

// =============================================================================
// Scroll Methods
// =============================================================================

/** Default smooth scroll duration in ms */
const DEFAULT_SMOOTH_DURATION = 300;

/**
 * Parse align-or-options argument into resolved align and options
 */
const resolveScrollArgs = (
  alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
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

/**
 * Ease-in-out quadratic easing function
 * t in [0, 1] → eased value in [0, 1]
 */
const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/**
 * Create scroll methods
 */
export const createScrollMethods = <T extends VListItem>(
  ctx: VListContext<T>,
): ScrollMethods => {
  /** Active animation frame ID (null when idle) */
  let animationFrameId: number | null = null;

  /**
   * Cancel any in-progress smooth scroll animation
   */
  const cancelScroll = (): void => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  /**
   * Animate scroll from current position to target over duration ms
   */
  const animateScroll = (from: number, to: number, duration: number): void => {
    // Cancel any existing animation
    cancelScroll();

    // If already at target (or close enough), skip animation
    if (Math.abs(to - from) < 1) {
      ctx.scrollController.scrollTo(to);
      return;
    }

    const start = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeInOutQuad(t);
      const position = from + (to - from) * eased;

      ctx.scrollController.scrollTo(position);

      if (t < 1) {
        animationFrameId = requestAnimationFrame(tick);
      } else {
        animationFrameId = null;
      }
    };

    animationFrameId = requestAnimationFrame(tick);
  };

  const scrollToIndex = (
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ): void => {
    const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);
    const dataState = ctx.dataManager.getState();

    // Wrap around when scroll.wrap is enabled
    if (ctx.config.wrap && dataState.total > 0) {
      index = ((index % dataState.total) + dataState.total) % dataState.total;
    }

    const position = calculateScrollToIndex(
      index,
      ctx.heightCache,
      ctx.state.viewportState.containerHeight,
      dataState.total,
      align,
      ctx.getCachedCompression(),
    );

    if (behavior === "smooth") {
      const from = ctx.scrollController.getScrollTop();
      animateScroll(from, position, duration);
    } else {
      cancelScroll();
      ctx.scrollController.scrollTo(position);
    }
  };

  return {
    scrollToIndex,

    /**
     * Scroll to specific item by ID
     */
    scrollToItem: (
      id: string | number,
      alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
    ): void => {
      const index = ctx.dataManager.getIndexById(id);
      if (index >= 0) {
        scrollToIndex(index, alignOrOptions);
      }
    },

    /**
     * Cancel any in-progress smooth scroll animation
     */
    cancelScroll,

    /**
     * Get current scroll position
     */
    getScrollPosition: (): number => {
      return ctx.scrollController.getScrollTop();
    },
  };
};

// =============================================================================
// Snapshot Methods
// =============================================================================

/**
 * Create snapshot methods for scroll save/restore
 */
export const createSnapshotMethods = <T extends VListItem>(
  ctx: VListContext<T>,
): SnapshotMethods => ({
  /**
   * Get a snapshot of the current scroll position for save/restore.
   *
   * Returns the first visible item index and the pixel offset within that item,
   * plus any selected item IDs. This is enough to precisely restore the scroll
   * position later, even if the list has been destroyed and recreated.
   *
   * Works correctly with both normal and compressed (1M+ items) modes.
   */
  getScrollSnapshot: (): ScrollSnapshot => {
    const scrollTop = ctx.scrollController.getScrollTop();
    const compression = ctx.getCachedCompression();
    const totalItems = ctx.getVirtualTotal();
    const selectedIds =
      ctx.state.selectionState.selected.size > 0
        ? Array.from(ctx.state.selectionState.selected)
        : undefined;

    if (totalItems === 0) {
      const snapshot: ScrollSnapshot = { index: 0, offsetInItem: 0 };
      if (selectedIds) snapshot.selectedIds = selectedIds;
      return snapshot;
    }

    let index: number;
    let offsetInItem: number;

    if (compression.isCompressed) {
      // Compressed: scroll position maps linearly to item index
      const scrollRatio = scrollTop / compression.virtualHeight;
      const exactIndex = scrollRatio * totalItems;
      index = Math.max(0, Math.min(Math.floor(exactIndex), totalItems - 1));
      const fraction = exactIndex - index;
      offsetInItem = fraction * ctx.heightCache.getHeight(index);
    } else {
      // Normal: direct offset lookup
      index = ctx.heightCache.indexAtOffset(scrollTop);
      offsetInItem = scrollTop - ctx.heightCache.getOffset(index);
    }

    // Clamp offsetInItem to non-negative (floating point edge cases)
    offsetInItem = Math.max(0, offsetInItem);

    const snapshot: ScrollSnapshot = { index, offsetInItem };
    if (selectedIds) snapshot.selectedIds = selectedIds;
    return snapshot;
  },

  /**
   * Restore scroll position (and optionally selection) from a snapshot.
   *
   * Scrolls to the exact sub-pixel position captured by getScrollSnapshot().
   * If the snapshot contains selectedIds and the list has selection enabled,
   * selection is also restored.
   */
  restoreScroll: (snapshot: ScrollSnapshot): void => {
    const { index, offsetInItem, selectedIds } = snapshot;
    const compression = ctx.getCachedCompression();
    const totalItems = ctx.getVirtualTotal();

    if (totalItems === 0) return;

    const safeIndex = Math.max(0, Math.min(index, totalItems - 1));
    let scrollPosition: number;

    if (compression.isCompressed) {
      // Compressed: reverse the linear mapping
      const itemHeight = ctx.heightCache.getHeight(safeIndex);
      const fraction = itemHeight > 0 ? offsetInItem / itemHeight : 0;
      scrollPosition =
        ((safeIndex + fraction) / totalItems) * compression.virtualHeight;
    } else {
      // Normal: direct offset
      scrollPosition = ctx.heightCache.getOffset(safeIndex) + offsetInItem;
    }

    // Clamp to valid range
    const maxScroll = Math.max(
      0,
      compression.virtualHeight - ctx.state.viewportState.containerHeight,
    );
    scrollPosition = Math.max(0, Math.min(scrollPosition, maxScroll));

    ctx.scrollController.scrollTo(scrollPosition);

    // Restore selection if provided and selection is enabled
    if (
      selectedIds &&
      selectedIds.length > 0 &&
      ctx.config.selectionMode !== "none"
    ) {
      ctx.state.selectionState = selectItems(
        ctx.state.selectionState,
        selectedIds,
        ctx.config.selectionMode,
      );
    }
  },
});

// =============================================================================
// Selection Methods
// =============================================================================

/**
 * Helper to render and emit selection change
 */
const renderAndEmitSelection = <T extends VListItem>(
  ctx: VListContext<T>,
): void => {
  const items = ctx.getItemsForRange(ctx.state.viewportState.renderRange);
  const compressionCtx = ctx.state.viewportState.isCompressed
    ? ctx.getCompressionContext()
    : undefined;

  ctx.renderer.render(
    items,
    ctx.state.viewportState.renderRange,
    ctx.state.selectionState.selected,
    ctx.state.selectionState.focusedIndex,
    compressionCtx,
  );

  ctx.emitter.emit("selection:change", {
    selected: getSelectedIds(ctx.state.selectionState),
    items: getSelectedItems(ctx.state.selectionState, (id) =>
      ctx.dataManager.getItemById(id),
    ),
  });
};

/**
 * Create selection methods
 */
export const createSelectionMethods = <T extends VListItem>(
  ctx: VListContext<T>,
): SelectionMethods<T> => ({
  /**
   * Select item(s) by ID
   */
  select: (...ids: Array<string | number>): void => {
    if (ctx.config.selectionMode === "none") return;

    ctx.state.selectionState = selectItems(
      ctx.state.selectionState,
      ids,
      ctx.config.selectionMode,
    );

    renderAndEmitSelection(ctx);
  },

  /**
   * Deselect item(s) by ID
   */
  deselect: (...ids: Array<string | number>): void => {
    ctx.state.selectionState = deselectItems(ctx.state.selectionState, ids);
    renderAndEmitSelection(ctx);
  },

  /**
   * Toggle selection
   */
  toggleSelect: (id: string | number): void => {
    if (ctx.config.selectionMode === "none") return;

    ctx.state.selectionState = toggleSelection(
      ctx.state.selectionState,
      id,
      ctx.config.selectionMode,
    );

    renderAndEmitSelection(ctx);
  },

  /**
   * Select all items
   */
  selectAll: (): void => {
    if (ctx.config.selectionMode !== "multiple") return;

    const allItems = ctx.getAllLoadedItems();
    ctx.state.selectionState = selectAll(
      ctx.state.selectionState,
      allItems,
      ctx.config.selectionMode,
    );

    renderAndEmitSelection(ctx);
  },

  /**
   * Clear selection
   */
  clearSelection: (): void => {
    ctx.state.selectionState = clearSelection(ctx.state.selectionState);

    const items = ctx.getItemsForRange(ctx.state.viewportState.renderRange);
    const compressionCtx = ctx.state.viewportState.isCompressed
      ? ctx.getCompressionContext()
      : undefined;

    ctx.renderer.render(
      items,
      ctx.state.viewportState.renderRange,
      ctx.state.selectionState.selected,
      ctx.state.selectionState.focusedIndex,
      compressionCtx,
    );

    ctx.emitter.emit("selection:change", {
      selected: [],
      items: [],
    });
  },

  /**
   * Get selected item IDs
   */
  getSelected: (): Array<string | number> => {
    return getSelectedIds(ctx.state.selectionState);
  },

  /**
   * Get selected items
   */
  getSelectedItems: (): T[] => {
    return getSelectedItems(ctx.state.selectionState, (id) =>
      ctx.dataManager.getItemById(id),
    );
  },
});
