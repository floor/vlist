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

import { LOAD_MORE_THRESHOLD, INITIAL_LOAD_SIZE } from "./constants";

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
    const velocityReliable = ctx.scrollController.isTracking();
    const { cancelLoadThreshold, preloadThreshold, preloadAhead } = ctx.config;

    // Only allow loading when:
    // 1. The velocity tracker has enough samples to be reliable (not during ramp-up)
    // 2. The measured velocity is below the cancellation threshold
    const canLoad = velocityReliable && currentVelocity <= cancelLoadThreshold;

    // Check if velocity just dropped below threshold - load pending range immediately
    // This creates smoother transitions vs waiting for idle
    if (
      pendingRange &&
      previousVelocity > cancelLoadThreshold &&
      currentVelocity <= cancelLoadThreshold
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
    // Pass cached compression to avoid allocating a new CompressionState per frame
    ctx.state.viewportState = updateViewportState(
      ctx.state.viewportState,
      scrollTop,
      ctx.heightCache,
      total,
      ctx.config.overscan,
      ctx.getCachedCompression(),
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
    // Protected by canLoad: during fast scrolling (high velocity or ramp-up),
    // skip loadMore to avoid fetching the next sequential chunk when the user
    // has already scrolled far past it (e.g. scrollbar drag to bottom would
    // request offset=100 when the visible range is near offset=999900).
    if (
      canLoad &&
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

      // Velocity-based load cancellation and preloading:
      // - If scrolling too fast (> CANCEL_LOAD_VELOCITY_THRESHOLD), skip loading
      // - If scrolling at medium speed (> PRELOAD_VELOCITY_THRESHOLD), preload ahead
      // - If scrolling slowly, load visible range only
      // - When velocity drops below threshold, load immediately (handled above)
      // - If idle, always load (handled by onIdle callback as fallback)
      if (canLoad) {
        // Velocity is acceptable, load the range
        pendingRange = null;

        // Calculate preload range based on scroll direction and velocity
        let loadStart = renderRange.start;
        let loadEnd = renderRange.end;

        // Preload ahead when scrolling at medium velocity
        if (currentVelocity > preloadThreshold) {
          if (direction === "down") {
            // Scrolling down - preload items below
            loadEnd = Math.min(renderRange.end + preloadAhead, total - 1);
          } else {
            // Scrolling up - preload items above
            loadStart = Math.max(renderRange.start - preloadAhead, 0);
          }
        }

        ctx.dataManager.ensureRange(loadStart, loadEnd).catch((error) => {
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
        items: getSelectedItems(ctx.state.selectionState, (id) =>
          ctx.dataManager.getItemById(id),
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

    // Capture previous focus index before any state mutation (S3 mutates in-place)
    const previousFocusIndex = ctx.state.selectionState.focusedIndex;

    let handled = false;
    let focusOnly = false;
    let newState = ctx.state.selectionState;

    switch (event.key) {
      case "ArrowUp":
        newState = moveFocusUp(ctx.state.selectionState, totalItems);
        handled = true;
        focusOnly = true;
        break;

      case "ArrowDown":
        newState = moveFocusDown(ctx.state.selectionState, totalItems);
        handled = true;
        focusOnly = true;
        break;

      case "Home":
        newState = moveFocusToFirst(ctx.state.selectionState, totalItems);
        handled = true;
        focusOnly = true;
        break;

      case "End":
        newState = moveFocusToLast(ctx.state.selectionState, totalItems);
        handled = true;
        focusOnly = true;
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

      const newFocusIndex = ctx.state.selectionState.focusedIndex;

      // Scroll focused item into view
      if (newFocusIndex >= 0) {
        scrollToIndex(newFocusIndex, "center");
      }

      if (focusOnly) {
        // M1: Targeted update — only touch the two affected items
        // instead of re-rendering all ~20-50 visible items
        const { selected } = ctx.state.selectionState;

        if (previousFocusIndex >= 0 && previousFocusIndex !== newFocusIndex) {
          const prevItem = ctx.dataManager.getItem(previousFocusIndex);
          if (prevItem) {
            ctx.renderer.updateItemClasses(
              previousFocusIndex,
              selected.has(prevItem.id),
              false,
            );
          }
        }

        if (newFocusIndex >= 0) {
          const newItem = ctx.dataManager.getItem(newFocusIndex);
          if (newItem) {
            ctx.renderer.updateItemClasses(
              newFocusIndex,
              selected.has(newItem.id),
              true,
            );
          }
        }
      } else {
        // Full re-render for selection changes (Space/Enter)
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
      }

      // Emit selection change if selection changed
      if (event.key === " " || event.key === "Enter") {
        ctx.emitter.emit("selection:change", {
          selected: getSelectedIds(ctx.state.selectionState),
          items: getSelectedItems(ctx.state.selectionState, (id) =>
            ctx.dataManager.getItemById(id),
          ),
        });
      }
    }
  };
};
