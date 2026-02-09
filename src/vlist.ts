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

// Groups domain
import {
  createGroupLayout,
  buildLayoutItems,
  createGroupedHeightFn,
  createStickyHeader,
  isGroupHeader,
  type GroupLayout,
  type StickyHeader as StickyHeaderInstance,
  type GroupHeaderItem,
} from "./groups";

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
    ariaLabel,
    groups: groupsConfig,
  } = config;

  const isWindowMode = !!scrollElement;
  const hasGroups = !!groupsConfig;

  const { height: itemHeightConfig, template: userTemplate } = itemConfig;

  const selectionMode: SelectionMode = selectionConfig?.mode ?? "none";

  // Loading thresholds (with defaults from constants)
  const cancelLoadThreshold =
    loadingConfig?.cancelThreshold ?? CANCEL_LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold =
    loadingConfig?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = loadingConfig?.preloadAhead ?? PRELOAD_ITEMS_AHEAD;

  // ===========================================================================
  // Groups Setup (when config.groups is present)
  // ===========================================================================

  // Group layout maps between data indices and layout indices.
  // When groups are active, the data manager sees "layout items" (items + headers)
  // and the height cache uses a grouped height function.
  let groupLayout: GroupLayout | null = null;
  let stickyHeader: StickyHeaderInstance | null = null;

  // Original items are stored separately so public API can return them
  let originalItems: T[] = initialItems ? [...initialItems] : [];

  // Transform items and height function when groups are active
  let layoutItems: T[] | Array<T | GroupHeaderItem> = initialItems ?? [];
  let effectiveHeightConfig: number | ((index: number) => number) =
    itemHeightConfig;

  // Unified template: dispatches to headerTemplate or user template
  let template = userTemplate;

  if (hasGroups && groupsConfig) {
    groupLayout = createGroupLayout(originalItems.length, groupsConfig);

    // Build layout items with headers inserted at group boundaries
    layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

    // Create a grouped height function
    effectiveHeightConfig = createGroupedHeightFn(
      groupLayout,
      itemHeightConfig,
    );

    // Create a unified template that renders headers or items
    const headerTemplate = groupsConfig.headerTemplate;
    template = ((item: T | GroupHeaderItem, index: number, state: any) => {
      if (isGroupHeader(item)) {
        return headerTemplate(
          (item as GroupHeaderItem).groupKey,
          (item as GroupHeaderItem).groupIndex,
        );
      }
      return userTemplate(item as T, index, state);
    }) as typeof userTemplate;
  }

  // ===========================================================================
  // Create Domain Components
  // ===========================================================================

  // Resolve container and create DOM structure
  const containerElement = resolveContainer(config.container);
  const dom = createDOMStructure(containerElement, classPrefix, ariaLabel);

  // Create event emitter
  const emitter = createEmitter<VListEvents<T>>();

  // Create height cache (uses grouped height function when groups are active)
  const heightCache = createHeightCache(
    effectiveHeightConfig,
    hasGroups ? (layoutItems?.length ?? 0) : (initialItems?.length ?? 0),
  );

  // Mutable reference to context (needed for callbacks that run after ctx is created)
  let ctxRef: VListContext<T> | null = null;

  /**
   * Rebuild group layout and re-transform items.
   * Called when the underlying data changes (setItems, append, etc.)
   */
  const rebuildGroups = (): void => {
    if (!groupLayout || !groupsConfig) return;

    // Rebuild group boundaries from current original items
    groupLayout.rebuild(originalItems.length);

    // Rebuild layout items
    layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

    // Rebuild height function (the closure captures the updated groupLayout)
    effectiveHeightConfig = createGroupedHeightFn(
      groupLayout,
      itemHeightConfig,
    );

    // Refresh sticky header content
    if (stickyHeader) {
      stickyHeader.refresh();
    }
  };

  // Create data manager (uses layout items when groups are active)
  const effectiveItems = hasGroups ? layoutItems : initialItems;
  const dataManager = createDataManager<T>({
    ...(adapter ? { adapter } : {}),
    ...(effectiveItems && effectiveItems.length > 0
      ? { initialItems: effectiveItems as T[] }
      : {}),
    ...(effectiveItems && effectiveItems.length > 0
      ? { initialTotal: effectiveItems.length }
      : {}),
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
  // Add group-header CSS class to root when groups are active
  if (hasGroups) {
    dom.root.classList.add(`${classPrefix}--grouped`);
  }

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

  // ===========================================================================
  // Create Sticky Header (when groups.sticky is enabled)
  // ===========================================================================

  if (
    hasGroups &&
    groupsConfig &&
    groupLayout &&
    groupsConfig.sticky !== false
  ) {
    stickyHeader = createStickyHeader(
      dom.root,
      groupLayout,
      heightCache,
      groupsConfig,
      classPrefix,
    );
  }

  // ===========================================================================
  // Create Context
  // ===========================================================================

  const ctx: VListContext<T> = (ctxRef = createContext(
    {
      itemHeight: effectiveHeightConfig,
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

  // Wrap the scroll handler to also update the sticky header
  if (stickyHeader) {
    const originalHandleScroll = handleScroll;
    const stickyRef = stickyHeader;
    const wrappedHandleScroll = (
      scrollTop: number,
      direction: "up" | "down",
    ): void => {
      originalHandleScroll(scrollTop, direction);
      stickyRef.update(scrollTop);
    };
    wrappedHandleScroll.loadPendingRange = handleScroll.loadPendingRange;
    handleScrollRef = wrappedHandleScroll as typeof handleScroll;
  }

  const handleClick = createClickHandler(ctx, forceRender);

  // Create scroll methods first (needed by keyboard handler)
  const scrollMethods = createScrollMethods(ctx);
  const handleKeydown = createKeyboardHandler(ctx, scrollMethods.scrollToIndex);

  // ===========================================================================
  // Create API Methods
  // ===========================================================================

  const rawDataMethods = createDataMethods(ctx);

  // Wrap data methods when groups are active to maintain group layout
  const dataMethods = hasGroups
    ? {
        setItems: (items: T[]): void => {
          originalItems = [...items];
          rebuildGroups();
          // Set the layout items (with headers) into the data manager
          rawDataMethods.setItems(layoutItems as T[]);
        },
        appendItems: (items: T[]): void => {
          originalItems = [...originalItems, ...items];
          rebuildGroups();
          rawDataMethods.setItems(layoutItems as T[]);
        },
        prependItems: (items: T[]): void => {
          originalItems = [...items, ...originalItems];
          rebuildGroups();
          rawDataMethods.setItems(layoutItems as T[]);
        },
        updateItem: rawDataMethods.updateItem,
        removeItem: (id: string | number): void => {
          // Remove from original items
          originalItems = originalItems.filter((item) => item.id !== id);
          rebuildGroups();
          rawDataMethods.setItems(layoutItems as T[]);
        },
        reload: rawDataMethods.reload,
      }
    : rawDataMethods;
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
    if (stickyHeader) {
      stickyHeader.destroy();
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

  // Initialize sticky header with current scroll position
  if (stickyHeader) {
    stickyHeader.update(ctx.scrollController.getScrollTop());
  }

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
      // When groups are active, return the original items (without headers)
      if (hasGroups) {
        return originalItems as readonly T[];
      }
      return ctx.getAllLoadedItems() as readonly T[];
    },

    get total() {
      // When groups are active, return the original item count (without headers)
      if (hasGroups) {
        return originalItems.length;
      }
      return dataManager.getTotal();
    },

    // Data methods
    ...dataMethods,

    // Scroll methods (wrapped for groups: data index → layout index)
    ...(hasGroups && groupLayout
      ? {
          ...scrollMethods,
          scrollToIndex: (
            index: number,
            alignOrOptions?:
              | "start"
              | "center"
              | "end"
              | import("./types").ScrollToOptions,
          ): void => {
            // Convert data index to layout index
            const layoutIndex = groupLayout!.dataToLayoutIndex(index);
            scrollMethods.scrollToIndex(layoutIndex, alignOrOptions);
          },
        }
      : scrollMethods),

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
