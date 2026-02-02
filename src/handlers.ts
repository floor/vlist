/**
 * vlist - Event Handlers
 * Scroll, click, and keyboard event handlers
 *
 * All handlers receive the VListContext and operate on its state.
 * This keeps vlist.ts focused on orchestration.
 */

import type { VListItem } from "./types";
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

// =============================================================================
// Scroll Handler
// =============================================================================

/**
 * Create the scroll event handler
 */
export const createScrollHandler = <T extends VListItem>(
  ctx: VListContext<T>,
  renderIfNeeded: RenderFunction,
) => {
  return (scrollTop: number, direction: "up" | "down"): void => {
    if (ctx.state.isDestroyed) return;

    const dataState = ctx.dataManager.getState();

    // Update viewport state with current scroll position
    ctx.state.viewportState = updateViewportState(
      ctx.state.viewportState,
      scrollTop,
      ctx.config.itemHeight,
      dataState.total,
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
    if (ctx.config.hasAdapter && !dataState.isLoading && dataState.hasMore) {
      const distanceFromBottom =
        ctx.state.viewportState.totalHeight -
        scrollTop -
        ctx.state.viewportState.containerHeight;

      if (distanceFromBottom < LOAD_MORE_THRESHOLD) {
        ctx.emitter.emit("load:start", {
          offset: dataState.cached,
          limit: INITIAL_LOAD_SIZE,
        });

        ctx.dataManager.loadMore().catch((error) => {
          ctx.emitter.emit("error", { error, context: "loadMore" });
        });
      }
    }

    // Ensure visible range is loaded (for sparse data)
    const { renderRange } = ctx.state.viewportState;
    ctx.dataManager
      .ensureRange(renderRange.start, renderRange.end)
      .catch((error) => {
        ctx.emitter.emit("error", { error, context: "ensureRange" });
      });
  };
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

    const dataState = ctx.dataManager.getState();
    const totalItems = dataState.total;

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
