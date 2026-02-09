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
  createHeightCache,
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
  if (config.item.height == null) {
    throw new Error("[vlist] item.height is required");
  }
  if (typeof config.item.height === "number" && config.item.height <= 0) {
    throw new Error("[vlist] item.height must be a positive number");
  }
  if (
    typeof config.item.height !== "number" &&
    typeof config.item.height !== "function"
  ) {
    throw new Error(
      "[vlist] item.height must be a number or a function (index) => number",
    );
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
    idleTimeout: scrollIdleTimeout,
    classPrefix = DEFAULT_CLASS_PREFIX,
    scrollElement,
  } = config;

  const isWindowMode = !!scrollElement;

  const { height: itemHeightConfig, template } = itemConfig;

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

  // Create height cache (fixed or variable based on config)
  const heightCache = createHeightCache(
    itemHeightConfig,
    initialItems?.length ?? 0,
  );

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
        // Rebuild height cache when items change
        heightCache.rebuild(ctxRef.dataManager.getTotal());
        updateViewport();
      }
    },
    onItemsLoaded: (loadedItems, _offset, total) => {
      if (ctxRef?.state.isInitialized) {
        // Rebuild height cache when items are loaded
        heightCache.rebuild(ctxRef.dataManager.getTotal());
        // Always re-render when items load - the current range may have placeholders
        forceRender();
        emitter.emit("load:end", { items: loadedItems, total });
      }
    },
  });

  // In window mode, the list sits in the page flow — no inner scrollbar,
  // no clipping. Override the CSS defaults on both root and viewport so the
  // content div's height (totalHeight or virtualHeight) flows through to
  // the document, giving the browser scrollbar the correct page length.
  if (isWindowMode) {
    dom.root.style.overflow = "visible";
    dom.root.style.height = "auto";
    dom.viewport.style.overflow = "visible";
    dom.viewport.style.height = "auto";
  }

  // Get container dimensions (use window.innerHeight in window mode)
  const dimensions = isWindowMode
    ? { height: window.innerHeight, width: dom.viewport.clientWidth }
    : getContainerDimensions(dom.viewport);

  // Get initial compression state (must be before createViewportState which uses it)
  const initialCompression = getCompression(
    dataManager.getTotal(),
    heightCache,
  );

  // Create initial viewport state (pass compression to avoid redundant calculation)
  const initialViewportState = createViewportState(
    dimensions.height,
    heightCache,
    dataManager.getTotal(),
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
    ...(scrollIdleTimeout !== undefined
      ? { idleTimeout: scrollIdleTimeout }
      : {}),
    ...(isWindowMode ? { scrollElement } : {}),
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
    heightCache,
    classPrefix,
    () => dataManager.getTotal(),
  );

  // Create scrollbar (auto-enable when compressed, but never in window mode
  // where the browser's native scrollbar is used)
  const shouldEnableScrollbar =
    !isWindowMode &&
    (scrollbarConfig?.enabled ?? initialCompression.isCompressed);
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
      itemHeight: itemHeightConfig,
      overscan,
      classPrefix,
      selectionMode,
      hasAdapter: !!adapter,
      cancelLoadThreshold,
      preloadThreshold,
      preloadAhead,
    },
    dom,
    heightCache,
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
        totalItems: dataManager.getTotal(),
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
    const total = dataManager.getTotal();
    const compression = getCompression(total, heightCache);

    if (compression.isCompressed && !scrollController.isCompressed()) {
      scrollController.enableCompression(compression);

      // Create scrollbar if not exists and auto-enable is on
      // (never in window mode — the browser's native scrollbar is used)
      if (!isWindowMode && !scrollbar && scrollbarConfig?.enabled !== false) {
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

    // In window mode, always keep maxScroll in sync — even without compression,
    // the controller needs totalHeight to compute isAtBottom/getScrollPercentage.
    // (The compression state for non-compressed lists has virtualHeight = actualHeight.)
    if (isWindowMode && !compression.isCompressed) {
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

    // Update compression mode if needed
    updateCompressionMode();

    // Update viewport state with new item count
    // Pass cached compression to avoid allocating a new CompressionState
    ctx.state.viewportState = updateViewportItems(
      ctx.state.viewportState,
      heightCache,
      dataManager.getTotal(),
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

    // In window mode, the viewport has height:auto so its size reflects the
    // *content* height (e.g. 880,000 px for 10K items), NOT the visible area.
    // Using that value as containerHeight would make vlist think the entire
    // content is visible and render ALL items, destroying performance.
    // The window resize listener (below) handles containerHeight instead.
    if (isWindowMode) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      const currentHeight = ctx.state.viewportState.containerHeight;

      // Only update if height changed significantly (>1px to avoid float precision issues)
      if (Math.abs(newHeight - currentHeight) > 1) {
        ctx.state.viewportState = updateViewportSize(
          ctx.state.viewportState,
          newHeight,
          heightCache,
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

  // In window mode, listen for window resize to update containerHeight
  // (the ResizeObserver above watches the viewport element, which in window mode
  // reflects the content size, not the visible area — we need window.innerHeight)
  let handleWindowResize: (() => void) | null = null;
  if (isWindowMode) {
    handleWindowResize = () => {
      if (ctx.state.isDestroyed) return;

      const newHeight = window.innerHeight;
      const currentHeight = ctx.state.viewportState.containerHeight;

      if (Math.abs(newHeight - currentHeight) > 1) {
        // Update scroll controller's knowledge of container height
        scrollController.updateContainerHeight(newHeight);

        ctx.state.viewportState = updateViewportSize(
          ctx.state.viewportState,
          newHeight,
          heightCache,
          dataManager.getTotal(),
          overscan,
          ctx.getCachedCompression(),
        );

        updateContentHeight(dom.content, ctx.state.viewportState.totalHeight);
        renderIfNeeded();

        emitter.emit("resize", {
          height: newHeight,
          width: window.innerWidth,
        });
      }
    };
    window.addEventListener("resize", handleWindowResize);
  }

  // ===========================================================================
  // Destroy
  // ===========================================================================

  const destroy = (): void => {
    if (ctx.state.isDestroyed) return;

    ctx.state.isDestroyed = true;

    // Remove event listeners
    dom.items.removeEventListener("click", handleClick);
    dom.root.removeEventListener("keydown", handleKeydown);

    // Disconnect ResizeObserver and window resize listener
    resizeObserver.disconnect();
    if (handleWindowResize) {
      window.removeEventListener("resize", handleWindowResize);
    }

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
      return dataManager.getTotal();
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
