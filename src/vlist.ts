/**
 * vlist - Main Entry Point
 * Creates a virtual list instance with all features
 * Supports compression for handling 1M+ items via manual wheel scrolling
 */

import type {
  VListConfig,
  VListItem,
  VList,
  VListEvents,
  EventHandler,
  Unsubscribe,
  Range,
  SelectionMode,
} from "./types";

// Domain imports
import {
  createViewportState,
  updateViewportState,
  updateViewportItems,
  calculateScrollToIndex,
  rangesEqual,
  getCompressionState,
  getCompression,
  calculateCompressedItemPosition,
  createRenderer,
  createDOMStructure,
  updateContentHeight,
  resolveContainer,
  getContainerDimensions,
  type CompressionContext,
} from "./render";

import { createEmitter } from "./events";

import {
  createSelectionState,
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  setFocusedIndex,
  moveFocusUp,
  moveFocusDown,
  moveFocusToFirst,
  moveFocusToLast,
  selectFocused,
  getSelectedIds,
  getSelectedItems,
  isSelected,
} from "./selection";

import {
  createScrollController,
  createScrollbar,
  type Scrollbar,
} from "./scroll";

import { createDataManager, type DataManager } from "./data";

import {
  DEFAULT_OVERSCAN,
  DEFAULT_CLASS_PREFIX,
  LOAD_MORE_THRESHOLD,
  INITIAL_LOAD_SIZE,
} from "./constants";

// =============================================================================
// Main Factory
// =============================================================================

/**
 * Create a virtual list instance
 */
export const createVList = <T extends VListItem = VListItem>(
  config: VListConfig<T>,
): VList<T> => {
  // Validate config
  if (!config.container) {
    throw new Error("[vlist] Container is required");
  }
  if (!config.itemHeight || config.itemHeight <= 0) {
    throw new Error("[vlist] itemHeight must be a positive number");
  }
  if (!config.template) {
    throw new Error("[vlist] Template is required");
  }

  // Configuration
  const {
    itemHeight,
    template,
    items: initialItems,
    adapter,
    overscan = DEFAULT_OVERSCAN,
    selection: selectionConfig,
    scrollbar: scrollbarConfig,
    classPrefix = DEFAULT_CLASS_PREFIX,
  } = config;

  const selectionMode: SelectionMode = selectionConfig?.mode ?? "none";

  // Resolve container
  const containerElement = resolveContainer(config.container);

  // Create DOM structure
  const dom = createDOMStructure(containerElement, classPrefix);

  // Create event emitter
  const emitter = createEmitter<VListEvents<T>>();

  // Track if initialized (to avoid calling updateViewport before renderer exists)
  let isInitialized = false;

  // Create data manager with config object
  const dataManager: DataManager<T> = createDataManager<T>({
    adapter,
    initialItems,
    initialTotal: initialItems?.length,
    pageSize: INITIAL_LOAD_SIZE,
    onStateChange: () => {
      // Only update viewport after initialization is complete
      if (isInitialized) {
        updateViewport();
      }
    },
    onItemsLoaded: (loadedItems, offset, total) => {
      if (isInitialized) {
        // Force re-render to replace placeholders with loaded data
        forceRender();

        emitter.emit("load:end", {
          items: loadedItems,
          total,
        });
      }
    },
  });

  // Create selection state
  let selectionState = createSelectionState(selectionConfig?.initial);

  // Get container dimensions
  const dimensions = getContainerDimensions(dom.viewport);

  // Create viewport state
  let viewportState = createViewportState(
    dimensions.height,
    itemHeight,
    dataManager.getState().total,
    overscan,
  );

  // Get initial compression state
  const initialCompression = getCompression(
    dataManager.getState().total,
    itemHeight,
  );

  // Create scroll controller with compression support if needed
  const scrollController = createScrollController(dom.viewport, {
    compressed: initialCompression.isCompressed,
    compression: initialCompression.isCompressed
      ? initialCompression
      : undefined,
    onScroll: (data) => {
      handleScroll(data.scrollTop, data.direction);
    },
    onIdle: () => {
      // Could emit idle event if needed
    },
  });

  // Create renderer (with totalItems getter for compression)
  const renderer = createRenderer<T>(
    dom.items,
    template,
    itemHeight,
    classPrefix,
    () => dataManager.getState().total,
  );

  // Create custom scrollbar for compressed mode
  // Auto-enable when compressed, unless explicitly disabled
  const shouldEnableScrollbar =
    scrollbarConfig?.enabled ?? initialCompression.isCompressed;

  let scrollbar: Scrollbar | null = null;

  if (shouldEnableScrollbar) {
    scrollbar = createScrollbar(
      dom.viewport,
      (position) => {
        // Scrollbar interaction triggers scroll
        scrollController.scrollTo(position);
      },
      scrollbarConfig,
      classPrefix,
    );

    // Initialize scrollbar bounds
    scrollbar.updateBounds(initialCompression.virtualHeight, dimensions.height);

    // Add class to hide native scrollbar
    dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);
  }

  // Track last render range to avoid unnecessary re-renders
  let lastRenderRange: Range = { start: 0, end: 0 };

  // Track if destroyed
  let isDestroyed = false;

  // =============================================================================
  // Helper Functions
  // =============================================================================

  /**
   * Get items for the current render range
   */
  const getItemsForRange = (range: Range): T[] => {
    return dataManager.getItemsInRange(range.start, range.end);
  };

  /**
   * Get all loaded items (for selection operations)
   */
  const getAllLoadedItems = (): T[] => {
    const total = dataManager.getState().total;
    if (total === 0) return [];
    return dataManager.getItemsInRange(0, total - 1);
  };

  // =============================================================================
  // Internal Methods
  // =============================================================================

  /**
   * Get compression context for rendering
   * In compressed mode, items are positioned relative to viewport using the virtual scroll index
   */
  const getCompressionContext = (): CompressionContext => ({
    scrollTop: viewportState.scrollTop,
    totalItems: dataManager.getState().total,
    containerHeight: viewportState.containerHeight,
    rangeStart: viewportState.renderRange.start,
  });

  /**
   * Update compression mode when total items changes
   */
  const updateCompressionMode = (): void => {
    const total = dataManager.getState().total;
    const compression = getCompression(total, itemHeight);

    if (compression.isCompressed && !scrollController.isCompressed()) {
      // Enable compression mode
      scrollController.enableCompression(compression);

      // Create scrollbar if not exists and auto-enable is on
      if (!scrollbar && scrollbarConfig?.enabled !== false) {
        scrollbar = createScrollbar(
          dom.viewport,
          (position) => {
            scrollController.scrollTo(position);
          },
          scrollbarConfig,
          classPrefix,
        );
        dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);
      }
    } else if (!compression.isCompressed && scrollController.isCompressed()) {
      // Disable compression mode
      scrollController.disableCompression();
    } else if (compression.isCompressed) {
      // Update compression config
      scrollController.updateConfig({ compression });
    }

    // Update scrollbar bounds
    if (scrollbar) {
      scrollbar.updateBounds(
        compression.virtualHeight,
        viewportState.containerHeight,
      );
    }
  };

  /**
   * Update viewport state and re-render if needed
   */
  const updateViewport = (): void => {
    if (isDestroyed) return;

    const dataState = dataManager.getState();

    // Update compression mode if needed
    updateCompressionMode();

    // Update viewport state with new item count
    viewportState = updateViewportItems(
      viewportState,
      itemHeight,
      dataState.total,
      overscan,
    );

    // Update content height (uses virtualHeight, capped for compression)
    // In compressed mode, this sets the virtual height for scroll bounds
    updateContentHeight(dom.content, viewportState.totalHeight);

    // Render if range changed
    renderIfNeeded();
  };

  /**
   * Render items if the range has changed
   */
  const renderIfNeeded = (): void => {
    if (isDestroyed) return;

    const { renderRange, isCompressed } = viewportState;

    if (!rangesEqual(renderRange, lastRenderRange)) {
      const items = getItemsForRange(renderRange);
      const compressionCtx = isCompressed ? getCompressionContext() : undefined;

      renderer.render(
        items,
        renderRange,
        selectionState.selected,
        selectionState.focusedIndex,
        compressionCtx,
      );

      lastRenderRange = { ...renderRange };

      // Emit range change
      emitter.emit("range:change", { range: renderRange });
    } else if (isCompressed) {
      // Range didn't change but we're compressed - update positions on scroll
      // In compressed mode (manual wheel scroll), items are positioned relative to viewport
      renderer.updatePositions(getCompressionContext());
    }
  };

  /**
   * Force re-render current range (used when data loads to replace placeholders)
   */
  const forceRender = (): void => {
    if (isDestroyed) return;

    const { renderRange, isCompressed } = viewportState;
    const items = getItemsForRange(renderRange);
    const compressionCtx = isCompressed ? getCompressionContext() : undefined;

    renderer.render(
      items,
      renderRange,
      selectionState.selected,
      selectionState.focusedIndex,
      compressionCtx,
    );
  };

  /**
   * Handle scroll events (works for both native and compressed scroll)
   */
  const handleScroll = (scrollTop: number, direction: "up" | "down"): void => {
    if (isDestroyed) return;

    const dataState = dataManager.getState();

    // Update viewport state with current scroll position
    viewportState = updateViewportState(
      viewportState,
      scrollTop,
      itemHeight,
      dataState.total,
      overscan,
    );

    // Update custom scrollbar position
    if (scrollbar) {
      scrollbar.updatePosition(scrollTop);
      scrollbar.show();
    }

    // Render if needed
    renderIfNeeded();

    // Emit scroll event
    emitter.emit("scroll", { scrollTop, direction });

    // Check for infinite scroll (use virtual height for distance calculation)
    if (adapter && !dataState.isLoading && dataState.hasMore) {
      const distanceFromBottom =
        viewportState.totalHeight - scrollTop - viewportState.containerHeight;

      if (distanceFromBottom < LOAD_MORE_THRESHOLD) {
        emitter.emit("load:start", {
          offset: dataState.cached,
          limit: INITIAL_LOAD_SIZE,
        });

        dataManager.loadMore().catch((error) => {
          emitter.emit("error", { error, context: "loadMore" });
        });
      }
    }

    // Ensure visible range is loaded (for sparse data)
    const { renderRange } = viewportState;
    dataManager
      .ensureRange(renderRange.start, renderRange.end)
      .catch((error) => {
        emitter.emit("error", { error, context: "ensureRange" });
      });
  };

  /**
   * Handle item click
   */
  const handleItemClick = (event: MouseEvent): void => {
    if (isDestroyed) return;

    const target = event.target as HTMLElement;
    const itemElement = target.closest("[data-index]") as HTMLElement | null;

    if (!itemElement) return;

    const index = parseInt(itemElement.dataset.index ?? "-1", 10);
    if (index < 0) return;

    const item = dataManager.getItem(index);
    if (!item) return;

    // Emit click event
    emitter.emit("item:click", { item, index, event });

    // Handle selection
    if (selectionMode !== "none") {
      // Update focused index
      selectionState = setFocusedIndex(selectionState, index);

      // Toggle selection
      selectionState = toggleSelection(selectionState, item.id, selectionMode);

      // Re-render
      const items = getItemsForRange(viewportState.renderRange);
      const compressionCtx = viewportState.isCompressed
        ? getCompressionContext()
        : undefined;
      renderer.render(
        items,
        viewportState.renderRange,
        selectionState.selected,
        selectionState.focusedIndex,
        compressionCtx,
      );

      // Emit selection change
      emitter.emit("selection:change", {
        selected: getSelectedIds(selectionState),
        items: getSelectedItems(selectionState, getAllLoadedItems()),
      });
    }
  };

  /**
   * Handle keyboard navigation
   */
  const handleKeydown = (event: KeyboardEvent): void => {
    if (isDestroyed || selectionMode === "none") return;

    const dataState = dataManager.getState();
    const totalItems = dataState.total;

    let handled = false;
    let newState = selectionState;

    switch (event.key) {
      case "ArrowUp":
        newState = moveFocusUp(selectionState, totalItems);
        handled = true;
        break;

      case "ArrowDown":
        newState = moveFocusDown(selectionState, totalItems);
        handled = true;
        break;

      case "Home":
        newState = moveFocusToFirst(selectionState, totalItems);
        handled = true;
        break;

      case "End":
        newState = moveFocusToLast(selectionState, totalItems);
        handled = true;
        break;

      case " ":
      case "Enter":
        if (selectionState.focusedIndex >= 0) {
          const focusedItem = dataManager.getItem(selectionState.focusedIndex);
          if (focusedItem) {
            newState = toggleSelection(
              selectionState,
              focusedItem.id,
              selectionMode,
            );
          }
          handled = true;
        }
        break;
    }

    if (handled) {
      event.preventDefault();
      selectionState = newState;

      // Scroll focused item into view
      if (selectionState.focusedIndex >= 0) {
        scrollToIndex(selectionState.focusedIndex, "center");
      }

      // Re-render
      const items = getItemsForRange(viewportState.renderRange);
      const compressionCtx = viewportState.isCompressed
        ? getCompressionContext()
        : undefined;
      renderer.render(
        items,
        viewportState.renderRange,
        selectionState.selected,
        selectionState.focusedIndex,
        compressionCtx,
      );

      // Emit selection change if selection changed
      if (event.key === " " || event.key === "Enter") {
        emitter.emit("selection:change", {
          selected: getSelectedIds(selectionState),
          items: getSelectedItems(selectionState, getAllLoadedItems()),
        });
      }
    }
  };

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Set items (replaces all)
   */
  const setItems = (items: T[]): void => {
    dataManager.setItems(items, 0, items.length);
  };

  /**
   * Append items to the end
   */
  const appendItems = (items: T[]): void => {
    const currentTotal = dataManager.getState().total;
    dataManager.setItems(items, currentTotal);
  };

  /**
   * Prepend items to the start
   * Note: This shifts all existing indices, so we need to reload
   */
  const prependItems = (items: T[]): void => {
    // Get existing items
    const existingTotal = dataManager.getState().total;
    const existingItems =
      existingTotal > 0
        ? dataManager.getItemsInRange(0, existingTotal - 1)
        : [];

    // Clear and re-add with new items first
    dataManager.clear();
    dataManager.setItems([...items, ...existingItems], 0);
  };

  /**
   * Update a single item by ID
   */
  const updateItem = (id: string | number, updates: Partial<T>): void => {
    const updated = dataManager.updateItem(id, updates);

    if (updated) {
      // Re-render the specific item if visible
      const index = dataManager.getIndexById(id);
      const item = dataManager.getItem(index);

      if (
        item &&
        index >= viewportState.renderRange.start &&
        index <= viewportState.renderRange.end
      ) {
        renderer.updateItem(
          index,
          item,
          isSelected(selectionState, id),
          selectionState.focusedIndex === index,
        );
      }
    }
  };

  /**
   * Remove item by ID
   */
  const removeItem = (id: string | number): void => {
    dataManager.removeItem(id);
  };

  /**
   * Reload data
   */
  const reload = async (): Promise<void> => {
    if (adapter) {
      await dataManager.reload();
    }
  };

  /**
   * Scroll to specific index (compression-aware)
   */
  const scrollToIndex = (
    index: number,
    align: "start" | "center" | "end" = "start",
  ): void => {
    const dataState = dataManager.getState();
    const position = calculateScrollToIndex(
      index,
      itemHeight,
      viewportState.containerHeight,
      dataState.total,
      align,
    );

    scrollController.scrollTo(position);
  };

  /**
   * Scroll to specific item by ID
   */
  const scrollToItem = (
    id: string | number,
    align: "start" | "center" | "end" = "start",
  ): void => {
    const index = dataManager.getIndexById(id);
    if (index >= 0) {
      scrollToIndex(index, align);
    }
  };

  /**
   * Get current scroll position
   */
  const getScrollPosition = (): number => {
    return scrollController.getScrollTop();
  };

  /**
   * Select item(s) by ID
   */
  const select = (...ids: Array<string | number>): void => {
    if (selectionMode === "none") return;

    selectionState = selectItems(selectionState, ids, selectionMode);

    const items = getItemsForRange(viewportState.renderRange);
    const compressionCtx = viewportState.isCompressed
      ? getCompressionContext()
      : undefined;
    renderer.render(
      items,
      viewportState.renderRange,
      selectionState.selected,
      selectionState.focusedIndex,
      compressionCtx,
    );

    emitter.emit("selection:change", {
      selected: getSelectedIds(selectionState),
      items: getSelectedItems(selectionState, getAllLoadedItems()),
    });
  };

  /**
   * Deselect item(s) by ID
   */
  const deselect = (...ids: Array<string | number>): void => {
    selectionState = deselectItems(selectionState, ids);

    const items = getItemsForRange(viewportState.renderRange);
    const compressionCtx = viewportState.isCompressed
      ? getCompressionContext()
      : undefined;
    renderer.render(
      items,
      viewportState.renderRange,
      selectionState.selected,
      selectionState.focusedIndex,
      compressionCtx,
    );

    emitter.emit("selection:change", {
      selected: getSelectedIds(selectionState),
      items: getSelectedItems(selectionState, getAllLoadedItems()),
    });
  };

  /**
   * Toggle selection
   */
  const toggleSelect = (id: string | number): void => {
    if (selectionMode === "none") return;

    selectionState = toggleSelection(selectionState, id, selectionMode);

    const items = getItemsForRange(viewportState.renderRange);
    const compressionCtx = viewportState.isCompressed
      ? getCompressionContext()
      : undefined;
    renderer.render(
      items,
      viewportState.renderRange,
      selectionState.selected,
      selectionState.focusedIndex,
      compressionCtx,
    );

    emitter.emit("selection:change", {
      selected: getSelectedIds(selectionState),
      items: getSelectedItems(selectionState, getAllLoadedItems()),
    });
  };

  /**
   * Select all items
   */
  const selectAllItems = (): void => {
    if (selectionMode !== "multiple") return;

    const allItems = getAllLoadedItems();
    selectionState = selectAll(selectionState, allItems, selectionMode);

    const items = getItemsForRange(viewportState.renderRange);
    const compressionCtx = viewportState.isCompressed
      ? getCompressionContext()
      : undefined;
    renderer.render(
      items,
      viewportState.renderRange,
      selectionState.selected,
      selectionState.focusedIndex,
      compressionCtx,
    );

    emitter.emit("selection:change", {
      selected: getSelectedIds(selectionState),
      items: getSelectedItems(selectionState, allItems),
    });
  };

  /**
   * Clear selection
   */
  const clearSelectionState = (): void => {
    selectionState = clearSelection(selectionState);

    const items = getItemsForRange(viewportState.renderRange);
    const compressionCtx = viewportState.isCompressed
      ? getCompressionContext()
      : undefined;
    renderer.render(
      items,
      viewportState.renderRange,
      selectionState.selected,
      selectionState.focusedIndex,
      compressionCtx,
    );

    emitter.emit("selection:change", {
      selected: [],
      items: [],
    });
  };

  /**
   * Get selected item IDs
   */
  const getSelected = (): Array<string | number> => {
    return getSelectedIds(selectionState);
  };

  /**
   * Get selected items
   */
  const getSelectedItemsList = (): T[] => {
    return getSelectedItems(selectionState, getAllLoadedItems());
  };

  /**
   * Subscribe to an event
   */
  const on = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): Unsubscribe => {
    return emitter.on(event, handler);
  };

  /**
   * Unsubscribe from an event
   */
  const off = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): void => {
    emitter.off(event, handler);
  };

  /**
   * Destroy the instance
   */
  const destroy = (): void => {
    if (isDestroyed) return;

    isDestroyed = true;

    // Remove event listeners
    dom.items.removeEventListener("click", handleItemClick);
    dom.root.removeEventListener("keydown", handleKeydown);

    // Cleanup
    scrollController.destroy();
    if (scrollbar) {
      scrollbar.destroy();
      scrollbar = null;
    }
    renderer.destroy();
    emitter.clear();

    // Remove DOM
    dom.root.remove();
  };

  // =============================================================================
  // Initialization
  // =============================================================================

  // Attach event listeners
  // Note: scroll handling is set up via config callback in createScrollController
  dom.items.addEventListener("click", handleItemClick);
  dom.root.addEventListener("keydown", handleKeydown);

  // Mark as initialized
  isInitialized = true;

  // Initial render
  updateContentHeight(dom.content, viewportState.totalHeight);
  renderIfNeeded();

  // Load initial data if using adapter
  if (adapter && (!initialItems || initialItems.length === 0)) {
    emitter.emit("load:start", { offset: 0, limit: INITIAL_LOAD_SIZE });

    dataManager.loadInitial().catch((error) => {
      emitter.emit("error", { error, context: "loadInitial" });
    });
  }

  // =============================================================================
  // Return Public API
  // =============================================================================

  return {
    get element() {
      return dom.root;
    },

    get items() {
      return getAllLoadedItems() as readonly T[];
    },

    get total() {
      return dataManager.getState().total;
    },

    setItems,
    appendItems,
    prependItems,
    updateItem,
    removeItem,
    reload,

    scrollToIndex,
    scrollToItem,
    getScrollPosition,

    select,
    deselect,
    toggleSelect,
    selectAll: selectAllItems,
    clearSelection: clearSelectionState,
    getSelected,
    getSelectedItems: getSelectedItemsList,

    on,
    off,

    destroy,
  };
};
