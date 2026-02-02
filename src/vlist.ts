/**
 * vlist - Main Entry Point
 * Creates a virtual list instance with all features
 *
 * This is the composition root that:
 * 1. Validates configuration
 * 2. Creates all domain components
 * 3. Wires them together via context
 * 4. Attaches handlers and returns public API
 */

import type {
  VListConfig,
  VListItem,
  VList,
  VListEvents,
  EventHandler,
  Unsubscribe,
  SelectionMode,
} from "./types";

// Domain imports
import {
  createViewportState,
  updateViewportItems,
  getCompression,
  createRenderer,
  createDOMStructure,
  updateContentHeight,
  resolveContainer,
  getContainerDimensions,
  rangesEqual,
} from "./render";

import { createEmitter } from "./events";
import { createSelectionState } from "./selection";
import { createScrollController, createScrollbar } from "./scroll";
import { createDataManager } from "./data";

// Context, handlers, and methods
import { createContext, type VListContext } from "./context";
import {
  createScrollHandler,
  createClickHandler,
  createKeyboardHandler,
} from "./handlers";
import {
  createDataMethods,
  createScrollMethods,
  createSelectionMethods,
} from "./methods";

// Constants
import {
  DEFAULT_OVERSCAN,
  DEFAULT_CLASS_PREFIX,
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
  // ===========================================================================
  // Validation
  // ===========================================================================

  if (!config.container) {
    throw new Error("[vlist] Container is required");
  }
  if (!config.itemHeight || config.itemHeight <= 0) {
    throw new Error("[vlist] itemHeight must be a positive number");
  }
  if (!config.template) {
    throw new Error("[vlist] Template is required");
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

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

  // ===========================================================================
  // Create Domain Components
  // ===========================================================================

  // Resolve container and create DOM structure
  const containerElement = resolveContainer(config.container);
  const dom = createDOMStructure(containerElement, classPrefix);

  // Create event emitter
  const emitter = createEmitter<VListEvents<T>>();

  // Mutable reference to context (needed for callbacks that run after ctx is created)
  let ctxRef: VListContext<T> | null = null;

  // Create data manager
  const dataManager = createDataManager<T>({
    ...(adapter ? { adapter } : {}),
    ...(initialItems ? { initialItems } : {}),
    ...(initialItems?.length ? { initialTotal: initialItems.length } : {}),
    pageSize: INITIAL_LOAD_SIZE,
    onStateChange: () => {
      if (ctxRef?.state.isInitialized) {
        updateViewport();
      }
    },
    onItemsLoaded: (loadedItems, offset, total) => {
      if (ctxRef?.state.isInitialized) {
        const { renderRange } = ctxRef.state.viewportState;
        const loadedEnd = offset + loadedItems.length - 1;
        // Always re-render when items load - the current range may have placeholders
        forceRender();
        emitter.emit("load:end", { items: loadedItems, total });
      }
    },
  });

  // Get container dimensions
  const dimensions = getContainerDimensions(dom.viewport);

  // Create initial viewport state
  const initialViewportState = createViewportState(
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

  // Create scroll controller
  const scrollController = createScrollController(dom.viewport, {
    compressed: initialCompression.isCompressed,
    ...(initialCompression.isCompressed
      ? { compression: initialCompression }
      : {}),
    onScroll: (data) => {
      handleScroll(data.scrollTop, data.direction);
    },
    onIdle: () => {
      // Could emit idle event if needed
    },
  });

  // Create renderer
  const renderer = createRenderer<T>(
    dom.items,
    template,
    itemHeight,
    classPrefix,
    () => dataManager.getState().total,
  );

  // Create scrollbar (auto-enable when compressed)
  const shouldEnableScrollbar =
    scrollbarConfig?.enabled ?? initialCompression.isCompressed;
  let scrollbar = shouldEnableScrollbar
    ? createScrollbar(
        dom.viewport,
        (position) => scrollController.scrollTo(position),
        scrollbarConfig,
        classPrefix,
      )
    : null;

  if (scrollbar) {
    scrollbar.updateBounds(initialCompression.virtualHeight, dimensions.height);
    dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);
  }

  // ===========================================================================
  // Create Context
  // ===========================================================================

  const ctx: VListContext<T> = (ctxRef = createContext(
    {
      itemHeight,
      overscan,
      classPrefix,
      selectionMode,
      hasAdapter: !!adapter,
    },
    dom,
    dataManager,
    scrollController,
    renderer,
    emitter,
    scrollbar,
    {
      viewportState: initialViewportState,
      selectionState: createSelectionState(selectionConfig?.initial),
      lastRenderRange: { start: 0, end: 0 },
      isInitialized: false,
      isDestroyed: false,
    },
  ));

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Update compression mode when total items changes
   */
  const updateCompressionMode = (): void => {
    const total = dataManager.getState().total;
    const compression = getCompression(total, itemHeight);

    if (compression.isCompressed && !scrollController.isCompressed()) {
      scrollController.enableCompression(compression);

      // Create scrollbar if not exists and auto-enable is on
      if (!scrollbar && scrollbarConfig?.enabled !== false) {
        scrollbar = createScrollbar(
          dom.viewport,
          (position) => scrollController.scrollTo(position),
          scrollbarConfig,
          classPrefix,
        );
        dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);
        // Update context reference
        (ctx as any).scrollbar = scrollbar;
      }
    } else if (!compression.isCompressed && scrollController.isCompressed()) {
      scrollController.disableCompression();
    } else if (compression.isCompressed) {
      scrollController.updateConfig({ compression });
    }

    // Update scrollbar bounds
    if (scrollbar) {
      scrollbar.updateBounds(
        compression.virtualHeight,
        ctx.state.viewportState.containerHeight,
      );
    }
  };

  /**
   * Update viewport state and re-render if needed
   */
  const updateViewport = (): void => {
    if (ctx.state.isDestroyed) return;

    const dataState = dataManager.getState();

    // Update compression mode if needed
    updateCompressionMode();

    // Update viewport state with new item count
    ctx.state.viewportState = updateViewportItems(
      ctx.state.viewportState,
      itemHeight,
      dataState.total,
      overscan,
    );

    // Update content height
    updateContentHeight(dom.content, ctx.state.viewportState.totalHeight);

    // Re-render
    renderIfNeeded();
  };

  /**
   * Render if the range has changed
   */
  const renderIfNeeded = (): void => {
    if (ctx.state.isDestroyed) return;

    const { renderRange, isCompressed } = ctx.state.viewportState;

    // Check if render range changed
    if (rangesEqual(renderRange, ctx.state.lastRenderRange)) {
      // Range unchanged, but still update positions in compressed mode
      if (isCompressed) {
        renderer.updatePositions(ctx.getCompressionContext());
      }
      return;
    }

    // Render new range
    const items = ctx.getItemsForRange(renderRange);
    const compressionCtx = isCompressed
      ? ctx.getCompressionContext()
      : undefined;

    renderer.render(
      items,
      renderRange,
      ctx.state.selectionState.selected,
      ctx.state.selectionState.focusedIndex,
      compressionCtx,
    );

    ctx.state.lastRenderRange = { ...renderRange };

    // Emit range change
    emitter.emit("range:change", { range: renderRange });
  };

  /**
   * Force re-render current range
   */
  const forceRender = (): void => {
    if (ctx.state.isDestroyed) return;

    const { renderRange, isCompressed } = ctx.state.viewportState;
    const items = ctx.getItemsForRange(renderRange);
    const compressionCtx = isCompressed
      ? ctx.getCompressionContext()
      : undefined;

    renderer.render(
      items,
      renderRange,
      ctx.state.selectionState.selected,
      ctx.state.selectionState.focusedIndex,
      compressionCtx,
    );
  };

  // ===========================================================================
  // Create Handlers
  // ===========================================================================

  const handleScroll = createScrollHandler(ctx, renderIfNeeded);
  const handleClick = createClickHandler(ctx, forceRender);

  // Create scroll methods first (needed by keyboard handler)
  const scrollMethods = createScrollMethods(ctx);
  const handleKeydown = createKeyboardHandler(ctx, scrollMethods.scrollToIndex);

  // ===========================================================================
  // Create API Methods
  // ===========================================================================

  const dataMethods = createDataMethods(ctx);
  const selectionMethods = createSelectionMethods(ctx);

  // ===========================================================================
  // Event Subscription
  // ===========================================================================

  const on = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): Unsubscribe => {
    return emitter.on(event, handler);
  };

  const off = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): void => {
    emitter.off(event, handler);
  };

  // ===========================================================================
  // Destroy
  // ===========================================================================

  const destroy = (): void => {
    if (ctx.state.isDestroyed) return;

    ctx.state.isDestroyed = true;

    // Remove event listeners
    dom.items.removeEventListener("click", handleClick);
    dom.root.removeEventListener("keydown", handleKeydown);

    // Cleanup components
    scrollController.destroy();
    if (scrollbar) {
      scrollbar.destroy();
    }
    renderer.destroy();
    emitter.clear();

    // Remove DOM
    dom.root.remove();
  };

  // ===========================================================================
  // Initialization
  // ===========================================================================

  // Attach event listeners
  dom.items.addEventListener("click", handleClick);
  dom.root.addEventListener("keydown", handleKeydown);

  // Mark as initialized
  ctx.state.isInitialized = true;

  // Initial render
  updateContentHeight(dom.content, ctx.state.viewportState.totalHeight);
  renderIfNeeded();

  // Load initial data if using adapter
  if (adapter && (!initialItems || initialItems.length === 0)) {
    emitter.emit("load:start", { offset: 0, limit: INITIAL_LOAD_SIZE });

    dataManager.loadInitial().catch((error) => {
      emitter.emit("error", { error, context: "loadInitial" });
    });
  }

  // ===========================================================================
  // Return Public API
  // ===========================================================================

  return {
    // Properties
    get element() {
      return dom.root;
    },

    get items() {
      return ctx.getAllLoadedItems() as readonly T[];
    },

    get total() {
      return dataManager.getState().total;
    },

    // Data methods
    ...dataMethods,

    // Scroll methods
    ...scrollMethods,

    // Selection methods
    select: selectionMethods.select,
    deselect: selectionMethods.deselect,
    toggleSelect: selectionMethods.toggleSelect,
    selectAll: selectionMethods.selectAll,
    clearSelection: selectionMethods.clearSelection,
    getSelected: selectionMethods.getSelected,
    getSelectedItems: selectionMethods.getSelectedItems,

    // Events
    on,
    off,

    // Lifecycle
    destroy,
  };
};
