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
  updateViewportSize,
  updateViewportItems,
  getCompression,
  createRenderer,
  createDOMStructure,
  updateContentHeight,
  resolveContainer,
  getContainerDimensions,
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
  CANCEL_LOAD_VELOCITY_THRESHOLD,
  PRELOAD_VELOCITY_THRESHOLD,
  PRELOAD_ITEMS_AHEAD,
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
  if (!config.item) {
    throw new Error("[vlist] item configuration is required");
  }
  if (!config.item.height || config.item.height <= 0) {
    throw new Error("[vlist] item.height must be a positive number");
  }
  if (!config.item.template) {
    throw new Error("[vlist] item.template is required");
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  const {
    item: itemConfig,
    items: initialItems,
    adapter,
    overscan = DEFAULT_OVERSCAN,
    selection: selectionConfig,
    scrollbar: scrollbarConfig,
    loading: loadingConfig,
    classPrefix = DEFAULT_CLASS_PREFIX,
  } = config;

  const { height: itemHeight, template } = itemConfig;

  const selectionMode: SelectionMode = selectionConfig?.mode ?? "none";

  // Loading thresholds (with defaults from constants)
  const cancelLoadThreshold =
    loadingConfig?.cancelThreshold ?? CANCEL_LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold =
    loadingConfig?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = loadingConfig?.preloadAhead ?? PRELOAD_ITEMS_AHEAD;

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
    onItemsLoaded: (loadedItems, _offset, total) => {
      if (ctxRef?.state.isInitialized) {
        // Always re-render when items load - the current range may have placeholders
        forceRender();
        emitter.emit("load:end", { items: loadedItems, total });
      }
    },
  });

  // Get container dimensions
  const dimensions = getContainerDimensions(dom.viewport);

  // Get initial compression state (must be before createViewportState which uses it)
  const initialCompression = getCompression(
    dataManager.getState().total,
    itemHeight,
  );

  // Create initial viewport state (pass compression to avoid redundant calculation)
  const initialViewportState = createViewportState(
    dimensions.height,
    itemHeight,
    dataManager.getState().total,
    overscan,
    initialCompression,
  );

  // Mutable reference to scroll handler (needed for idle callback)
  let handleScrollRef: ReturnType<typeof createScrollHandler> | null = null;

  // Create scroll controller
  const scrollController = createScrollController(dom.viewport, {
    compressed: initialCompression.isCompressed,
    ...(initialCompression.isCompressed
      ? { compression: initialCompression }
      : {}),
    onScroll: (data) => {
      // M3: Suppress CSS transitions during active scroll
      if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
        dom.root.classList.add(`${classPrefix}--scrolling`);
      }
      if (handleScrollRef) {
        handleScrollRef(data.scrollTop, data.direction);
      }
    },
    onIdle: () => {
      // M3: Re-enable CSS transitions when scrolling stops
      dom.root.classList.remove(`${classPrefix}--scrolling`);
      // When scrolling stops, load any pending ranges that were skipped
      // due to high velocity scrolling
      if (handleScrollRef?.loadPendingRange) {
        handleScrollRef.loadPendingRange();
      }
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
      cancelLoadThreshold,
      preloadThreshold,
      preloadAhead,
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
      cachedCompression: {
        state: initialCompression,
        totalItems: dataManager.getState().total,
      },
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
    // Pass cached compression to avoid allocating a new CompressionState
    ctx.state.viewportState = updateViewportItems(
      ctx.state.viewportState,
      itemHeight,
      dataState.total,
      overscan,
      ctx.getCachedCompression(),
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
    const lastRange = ctx.state.lastRenderRange;

    // Check if render range changed (inlined for hot path performance)
    if (
      renderRange.start === lastRange.start &&
      renderRange.end === lastRange.end
    ) {
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
  // Wire up the scroll handler reference for the scroll controller callbacks
  handleScrollRef = handleScroll;

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

  // ===========================================================================
  // ResizeObserver for Container Resize
  // ===========================================================================

  const resizeObserver = new ResizeObserver((entries) => {
    if (ctx.state.isDestroyed) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      const currentHeight = ctx.state.viewportState.containerHeight;

      // Only update if height changed significantly (>1px to avoid float precision issues)
      if (Math.abs(newHeight - currentHeight) > 1) {
        ctx.state.viewportState = updateViewportSize(
          ctx.state.viewportState,
          newHeight,
          itemHeight,
          dataManager.getTotal(),
          overscan,
          ctx.getCachedCompression(),
        );

        // Update content height and scrollbar bounds
        updateContentHeight(dom.content, ctx.state.viewportState.totalHeight);
        if (scrollbar) {
          scrollbar.updateBounds(
            ctx.state.viewportState.totalHeight,
            newHeight,
          );
        }

        // Re-render with new visible range
        renderIfNeeded();

        // Emit resize event
        emitter.emit("resize", {
          height: newHeight,
          width: entry.contentRect.width,
        });
      }
    }
  });

  // ===========================================================================
  // Destroy
  // ===========================================================================

  const destroy = (): void => {
    if (ctx.state.isDestroyed) return;

    ctx.state.isDestroyed = true;

    // Remove event listeners
    dom.items.removeEventListener("click", handleClick);
    dom.root.removeEventListener("keydown", handleKeydown);

    // Disconnect ResizeObserver
    resizeObserver.disconnect();

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

  // Observe viewport for resize
  resizeObserver.observe(dom.viewport);

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
