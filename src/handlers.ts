/**
 * vlist - Event Handlers
 * Scroll, click, and keyboard event handlers
 */

import type { VListItem, Range } from "./types";
import type { VListContext } from "./context";

import { updateViewportState } from "./render";
import {
  setFocusedIndex,
  toggleSelection,
  moveFocusUp,
  moveFocusDown,
  moveFocusToFirst,
  moveFocusToLast,
  getSelectedIds,
  getSelectedItems,
} from "./selection";

import {
  LOAD_MORE_THRESHOLD,
  INITIAL_LOAD_SIZE,
  CANCEL_LOAD_VELOCITY_THRESHOLD,
} from "./constants";

// =============================================================================
// Types
// =============================================================================

/** Render function type (passed from vlist.ts) */
export type RenderFunction = () => void;

/** Scroll to index function type (passed from vlist.ts) */
export type ScrollToIndexFunction = (
  index: number,
  align?: "start" | "center" | "end",
) => void;

/** Scroll handler with velocity-aware loading */
export interface ScrollHandler {
  (scrollTop: number, direction: "up" | "down"): void;
  /** Load any pending range that was skipped due to high velocity (called on idle) */
  loadPendingRange: () => void;
}

// =============================================================================
// Scroll Handler
// =============================================================================

/**
 * Create the scroll event handler
 *
 * Implements velocity-based load cancellation:
 * - When scrolling fast (velocity > CANCEL_LOAD_VELOCITY_THRESHOLD), skip loading
 * - When scrolling slowly (velocity < SLOW_SCROLL_VELOCITY_THRESHOLD), allow loading
 * - When idle (onIdle callback), always load the visible range
 */
export const createScrollHandler = <T extends VListItem>(
  ctx: VListContext<T>,
  renderIfNeeded: RenderFunction,
): ScrollHandler => {
  // Track last ensured range to avoid redundant ensureRange calls
  let lastEnsuredRange: Range | null = null;

  // Track pending range that was skipped due to high velocity
  let pendingRange: Range | null = null;

  // Track previous velocity to detect when it crosses below threshold
  let previousVelocity = 0;

  /**
   * Load the pending range if any (called on idle)
   */
  const loadPendingRange = (): void => {
    if (pendingRange && ctx.config.hasAdapter) {
      const range = pendingRange;
      pendingRange = null;

      // Always load on idle, regardless of previous state
      ctx.dataManager.ensureRange(range.start, range.end).catch((error) => {
        ctx.emitter.emit("error", { error, context: "ensureRange" });
      });
    }
  };

  // Create the main scroll handler
  const handleScroll = (scrollTop: number, direction: "up" | "down"): void => {
    if (ctx.state.isDestroyed) return;

    // Get current velocity for threshold checks
    const currentVelocity = ctx.scrollController.getVelocity();
    const canLoad = currentVelocity <= CANCEL_LOAD_VELOCITY_THRESHOLD;

    // Check if velocity just dropped below threshold - load pending range immediately
    // This creates smoother transitions vs waiting for idle
    if (
      pendingRange &&
      previousVelocity > CANCEL_LOAD_VELOCITY_THRESHOLD &&
      currentVelocity <= CANCEL_LOAD_VELOCITY_THRESHOLD
    ) {
      const range = pendingRange;
      pendingRange = null;
      ctx.dataManager.ensureRange(range.start, range.end).catch((error) => {
        ctx.emitter.emit("error", { error, context: "ensureRange" });
      });
    }

    // Update previous velocity for next tick
    previousVelocity = currentVelocity;

    // Use direct getters to avoid object allocation on every scroll tick
    const total = ctx.dataManager.getTotal();

    // Update viewport state with current scroll position
    ctx.state.viewportState = updateViewportState(
      ctx.state.viewportState,
      scrollTop,
      ctx.config.itemHeight,
      total,
      ctx.config.overscan,
    );

    // Update custom scrollbar position
    if (ctx.scrollbar) {
      ctx.scrollbar.updatePosition(scrollTop);
      ctx.scrollbar.show();
    }

    // Render if needed
    renderIfNeeded();

    // Emit scroll event
    ctx.emitter.emit("scroll", { scrollTop, direction });

    // Check for infinite scroll (use virtual height for distance calculation)
    // Use direct getters to avoid object allocation
    if (
      ctx.config.hasAdapter &&
      !ctx.dataManager.getIsLoading() &&
      ctx.dataManager.getHasMore()
    ) {
      const distanceFromBottom =
        ctx.state.viewportState.totalHeight -
        scrollTop -
        ctx.state.viewportState.containerHeight;

      if (distanceFromBottom < LOAD_MORE_THRESHOLD) {
        ctx.emitter.emit("load:start", {
          offset: ctx.dataManager.getCached(),
          limit: INITIAL_LOAD_SIZE,
        });

        ctx.dataManager.loadMore().catch((error) => {
          ctx.emitter.emit("error", { error, context: "loadMore" });
        });
      }
    }

    // Ensure visible range is loaded (for sparse data)
    // Only call when range actually changes to avoid redundant async operations
    // (inlined rangesEqual check for hot path performance)
    const { renderRange } = ctx.state.viewportState;
    const rangeChanged =
      !lastEnsuredRange ||
      renderRange.start !== lastEnsuredRange.start ||
      renderRange.end !== lastEnsuredRange.end;

    if (rangeChanged) {
      lastEnsuredRange = { start: renderRange.start, end: renderRange.end };

      // Velocity-based load cancellation:
      // - If scrolling too fast, skip loading and save range for later
      // - If scrolling slowly, load immediately
      // - When velocity drops below threshold, load immediately (handled above)
      // - If idle, always load (handled by onIdle callback as fallback)
      if (canLoad) {
        // Velocity is acceptable, load the range
        pendingRange = null;
        ctx.dataManager
          .ensureRange(renderRange.start, renderRange.end)
          .catch((error) => {
            ctx.emitter.emit("error", { error, context: "ensureRange" });
          });
      } else {
        // Scrolling too fast - save range for loading when idle
        pendingRange = { start: renderRange.start, end: renderRange.end };
      }
    }
  };

  // Attach the idle handler for loading pending ranges
  (handleScroll as ScrollHandler).loadPendingRange = loadPendingRange;

  return handleScroll as ScrollHandler;
};

// =============================================================================
// Click Handler
// =============================================================================

/**
 * Create the item click handler
 */
export const createClickHandler = <T extends VListItem>(
  ctx: VListContext<T>,
  _forceRender: RenderFunction,
) => {
  return (event: MouseEvent): void => {
    if (ctx.state.isDestroyed) return;

    const target = event.target as HTMLElement;
    const itemElement = target.closest("[data-index]") as HTMLElement | null;

    if (!itemElement) return;

    const index = parseInt(itemElement.dataset.index ?? "-1", 10);
    if (index < 0) return;

    const item = ctx.dataManager.getItem(index);
    if (!item) return;

    // Emit click event
    ctx.emitter.emit("item:click", { item, index, event });

    // Handle selection
    if (ctx.config.selectionMode !== "none") {
      // Update focused index
      ctx.state.selectionState = setFocusedIndex(
        ctx.state.selectionState,
        index,
      );

      // Toggle selection
      ctx.state.selectionState = toggleSelection(
        ctx.state.selectionState,
        item.id,
        ctx.config.selectionMode,
      );

      // Re-render
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

      // Emit selection change
      ctx.emitter.emit("selection:change", {
        selected: getSelectedIds(ctx.state.selectionState),
        items: getSelectedItems(
          ctx.state.selectionState,
          ctx.getAllLoadedItems(),
        ),
      });
    }
  };
};

// =============================================================================
// Keyboard Handler
// =============================================================================

/**
 * Create the keyboard navigation handler
 */
export const createKeyboardHandler = <T extends VListItem>(
  ctx: VListContext<T>,
  scrollToIndex: ScrollToIndexFunction,
) => {
  return (event: KeyboardEvent): void => {
    if (ctx.state.isDestroyed || ctx.config.selectionMode === "none") return;

    // Use direct getter to avoid object allocation
    const totalItems = ctx.dataManager.getTotal();

    let handled = false;
    let newState = ctx.state.selectionState;

    switch (event.key) {
      case "ArrowUp":
        newState = moveFocusUp(ctx.state.selectionState, totalItems);
        handled = true;
        break;

      case "ArrowDown":
        newState = moveFocusDown(ctx.state.selectionState, totalItems);
        handled = true;
        break;

      case "Home":
        newState = moveFocusToFirst(ctx.state.selectionState, totalItems);
        handled = true;
        break;

      case "End":
        newState = moveFocusToLast(ctx.state.selectionState, totalItems);
        handled = true;
        break;

      case " ":
      case "Enter":
        if (ctx.state.selectionState.focusedIndex >= 0) {
          const focusedItem = ctx.dataManager.getItem(
            ctx.state.selectionState.focusedIndex,
          );
          if (focusedItem) {
            newState = toggleSelection(
              ctx.state.selectionState,
              focusedItem.id,
              ctx.config.selectionMode,
            );
          }
          handled = true;
        }
        break;
    }

    if (handled) {
      event.preventDefault();
      ctx.state.selectionState = newState;

      // Scroll focused item into view
      if (ctx.state.selectionState.focusedIndex >= 0) {
        scrollToIndex(ctx.state.selectionState.focusedIndex, "center");
      }

      // Re-render
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

      // Emit selection change if selection changed
      if (event.key === " " || event.key === "Enter") {
        ctx.emitter.emit("selection:change", {
          selected: getSelectedIds(ctx.state.selectionState),
          items: getSelectedItems(
            ctx.state.selectionState,
            ctx.getAllLoadedItems(),
          ),
        });
      }
    }
  };
};
