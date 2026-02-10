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
  createSnapshotMethods,
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

// Grid domain
import {
  createGridLayout,
  createGridRenderer,
  type GridLayout,
  type GridRenderer,
} from "./grid";

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

  // Grid-specific validation
  if (config.layout === "grid") {
    if (!config.grid) {
      throw new Error(
        "[vlist] grid configuration is required when layout is 'grid'",
      );
    }
    if (!config.grid.columns || config.grid.columns < 1) {
      throw new Error("[vlist] grid.columns must be a positive integer >= 1");
    }
    if (config.groups) {
      throw new Error("[vlist] grid layout cannot be combined with groups");
    }
  }

  // Reverse mode validation
  if (config.reverse) {
    if (config.groups) {
      throw new Error("[vlist] reverse mode cannot be combined with groups");
    }
    if (config.layout === "grid") {
      throw new Error(
        "[vlist] reverse mode cannot be combined with grid layout",
      );
    }
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
    layout: layoutMode = "list",
    grid: gridConfig,
    reverse: reverseMode = false,
  } = config;

  const isWindowMode = !!scrollElement;
  const hasGroups = !!groupsConfig;
  const isGrid = layoutMode === "grid" && !!gridConfig;
  const isReverse = reverseMode;

  const { height: itemHeightConfig, template: userTemplate } = itemConfig;

  const selectionMode: SelectionMode = selectionConfig?.mode ?? "none";

  // Loading thresholds (with defaults from constants)
  const cancelLoadThreshold =
    loadingConfig?.cancelThreshold ?? CANCEL_LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold =
    loadingConfig?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = loadingConfig?.preloadAhead ?? PRELOAD_ITEMS_AHEAD;

  // ===========================================================================
  // Grid Setup (when layout: 'grid')
  // ===========================================================================

  let gridLayout: GridLayout | null = null;
  let gridRenderer: GridRenderer<T> | null = null;

  if (isGrid && gridConfig) {
    gridLayout = createGridLayout(gridConfig);
  }

  /**
   * Get the "virtual total" used for all viewport/height calculations.
   * In grid mode, this is the total number of ROWS (not items).
   * In list/groups mode, this is the total from the data manager.
   */
  const getVirtualTotal = (): number => {
    const rawTotal = dataManager?.getTotal() ?? 0;
    if (isGrid && gridLayout) {
      return gridLayout.getTotalRows(rawTotal);
    }
    return rawTotal;
  };

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

  // Create height cache
  // - Grid mode: height cache operates on ROWS, not items.
  //   Row height = itemHeight + gap so that rows are spaced apart vertically.
  //   The grid renderer subtracts the gap when sizing the DOM element.
  // - Groups mode: uses grouped height function
  // - Normal mode: uses item height directly
  const initialTotal = hasGroups
    ? (layoutItems?.length ?? 0)
    : (initialItems?.length ?? 0);
  const heightCacheTotal =
    isGrid && gridLayout ? gridLayout.getTotalRows(initialTotal) : initialTotal;

  // In grid mode, inflate each row's height by the gap so the height cache
  // naturally spaces rows apart (the renderer will set element height to the
  // real item height, i.e. heightCache.getHeight(row) - gap).
  const gridGap = isGrid && gridLayout ? gridLayout.gap : 0;
  if (isGrid && gridGap > 0) {
    if (typeof effectiveHeightConfig === "number") {
      effectiveHeightConfig = effectiveHeightConfig + gridGap;
    } else {
      const baseFn = effectiveHeightConfig;
      effectiveHeightConfig = (index: number) => baseFn(index) + gridGap;
    }
  }

  const heightCache = createHeightCache(
    effectiveHeightConfig,
    heightCacheTotal,
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
        // In grid mode, rebuild with row count instead of item count
        heightCache.rebuild(getVirtualTotal());
        updateViewport();
      }
    },
    onItemsLoaded: (loadedItems, _offset, total) => {
      if (ctxRef?.state.isInitialized) {
        // Rebuild height cache when items are loaded
        heightCache.rebuild(getVirtualTotal());
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
  // In grid mode, use row count for compression (rows are what the virtualizer sees)
  const initialVirtualTotal = getVirtualTotal();
  const initialCompression = getCompression(initialVirtualTotal, heightCache);

  // Create initial viewport state (pass compression to avoid redundant calculation)
  const initialViewportState = createViewportState(
    dimensions.height,
    heightCache,
    initialVirtualTotal,
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

  // Create renderer (grid mode uses a specialised 2D renderer)
  let renderer: ReturnType<typeof createRenderer<T>>;

  if (isGrid && gridLayout) {
    // Add grid CSS class to root
    dom.root.classList.add(`${classPrefix}--grid`);

    gridRenderer = createGridRenderer<T>(
      dom.items,
      template,
      heightCache,
      gridLayout,
      classPrefix,
      dimensions.width,
    );

    // The grid renderer satisfies the same interface as the list renderer
    // (render, updatePositions, updateItem, updateItemClasses, getElement, clear, destroy)
    renderer = gridRenderer as unknown as ReturnType<typeof createRenderer<T>>;
  } else {
    renderer = createRenderer<T>(
      dom.items,
      template,
      heightCache,
      classPrefix,
      () => dataManager.getTotal(),
    );
  }

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
      reverse: isReverse,
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
    // In grid mode, the virtual total is the row count (not item count)
    isGrid ? getVirtualTotal : undefined,
  ));

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Update compression mode when total items changes
   */
  const updateCompressionMode = (): void => {
    const total = getVirtualTotal();
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
    // In grid mode, use virtual total (row count)
    ctx.state.viewportState = updateViewportItems(
      ctx.state.viewportState,
      heightCache,
      getVirtualTotal(),
      overscan,
      ctx.getCachedCompression(),
    );

    // Update content height
    updateContentHeight(dom.content, ctx.state.viewportState.totalHeight);

    // Re-render
    renderIfNeeded();
  };

  /**
   * Get items for rendering.
   * In grid mode, the renderRange is in ROW indices, so we convert to flat item indices.
   * In list mode, the renderRange IS the flat item range.
   */
  const getItemsForRendering = (renderRange: {
    start: number;
    end: number;
  }): {
    items: T[];
    itemRange: { start: number; end: number };
  } => {
    if (isGrid && gridLayout) {
      // Convert row range to flat item range
      const totalItems = dataManager.getTotal();
      const itemRange = gridLayout.getItemRange(
        renderRange.start,
        renderRange.end,
        totalItems,
      );
      const items = dataManager.getItemsInRange(
        itemRange.start,
        itemRange.end,
      ) as T[];
      return { items, itemRange };
    }

    // Normal list/groups mode: range is already flat item indices
    const items = ctx.getItemsForRange(renderRange);
    return { items, itemRange: renderRange };
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

    // Get items for rendering (grid converts row range → item range)
    const { items, itemRange } = getItemsForRendering(renderRange);
    const compressionCtx = isCompressed
      ? ctx.getCompressionContext()
      : undefined;

    // In grid mode, pass the ITEM range to the renderer (it positions by item index)
    // In list mode, pass the row/render range as-is
    const rendererRange = isGrid ? itemRange : renderRange;

    renderer.render(
      items,
      rendererRange,
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
    const { items, itemRange } = getItemsForRendering(renderRange);
    const compressionCtx = isCompressed
      ? ctx.getCompressionContext()
      : undefined;

    const rendererRange = isGrid ? itemRange : renderRange;

    renderer.render(
      items,
      rendererRange,
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

  // Wrap data methods when groups are active to maintain group layout,
  // or when reverse mode needs scroll-position-preserving prepend / auto-scroll append.
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
    : isReverse
      ? {
          ...rawDataMethods,
          appendItems: (items: T[]): void => {
            // In reverse mode, auto-scroll to bottom if user was already at bottom
            const wasAtBottom = scrollController.isAtBottom(2);
            rawDataMethods.appendItems(items);
            if (wasAtBottom) {
              // After items are appended and viewport updated, scroll to the very end
              const total = dataManager.getTotal();
              if (total > 0) {
                scrollMethods.scrollToIndex(total - 1, "end");
              }
            }
          },
          prependItems: (items: T[]): void => {
            // In reverse mode, preserve scroll position when prepending (older messages above)
            const scrollTop = scrollController.getScrollTop();
            const heightBefore = heightCache.getTotalHeight();
            rawDataMethods.prependItems(items);
            // After prepend, the total height increased — adjust scrollTop so the
            // same content stays visible (the prepended items are above the viewport).
            const heightAfter = heightCache.getTotalHeight();
            const heightDelta = heightAfter - heightBefore;
            if (heightDelta > 0) {
              scrollController.scrollTo(scrollTop + heightDelta);
            }
          },
        }
      : rawDataMethods;
  const selectionMethods = createSelectionMethods(ctx);
  const rawSnapshotMethods = createSnapshotMethods(ctx);

  // Wrap snapshot methods when groups or grid are active to convert indices
  const snapshotMethods =
    hasGroups && groupLayout
      ? {
          getScrollSnapshot: () => {
            const snapshot = rawSnapshotMethods.getScrollSnapshot();
            // Convert layout index → data index for groups mode
            const dataIndex = groupLayout!.layoutToDataIndex(snapshot.index);
            return {
              ...snapshot,
              index: dataIndex >= 0 ? dataIndex : snapshot.index,
            };
          },
          restoreScroll: (snapshot: import("./types").ScrollSnapshot) => {
            // Convert data index → layout index for groups mode
            const layoutIndex = groupLayout!.dataToLayoutIndex(snapshot.index);
            rawSnapshotMethods.restoreScroll({
              ...snapshot,
              index: layoutIndex,
            });
          },
        }
      : isGrid && gridLayout
        ? {
            getScrollSnapshot: () => {
              const snapshot = rawSnapshotMethods.getScrollSnapshot();
              // Convert row index → first item index in that row
              const columns = gridLayout!.columns;
              return { ...snapshot, index: snapshot.index * columns };
            },
            restoreScroll: (snapshot: import("./types").ScrollSnapshot) => {
              // Convert item index → row index
              const columns = gridLayout!.columns;
              const rowIndex = Math.floor(snapshot.index / columns);
              rawSnapshotMethods.restoreScroll({
                ...snapshot,
                index: rowIndex,
              });
            },
          }
        : rawSnapshotMethods;

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
      const newWidth = entry.contentRect.width;
      const currentHeight = ctx.state.viewportState.containerHeight;

      // Only update if height changed significantly (>1px to avoid float precision issues)
      if (Math.abs(newHeight - currentHeight) > 1) {
        ctx.state.viewportState = updateViewportSize(
          ctx.state.viewportState,
          newHeight,
          heightCache,
          getVirtualTotal(),
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
          width: newWidth,
        });
      }

      // In grid mode, update column widths when container width changes
      if (isGrid && gridRenderer) {
        gridRenderer.updateContainerWidth(newWidth);
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
          getVirtualTotal(),
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
    if (gridRenderer) {
      gridRenderer.destroy();
    } else {
      renderer.destroy();
    }
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

  // Reverse mode: scroll to the bottom after initial render / load
  if (isReverse) {
    const initialTotal = dataManager.getTotal();
    if (initialTotal > 0) {
      // Items provided statically — scroll immediately
      scrollMethods.scrollToIndex(initialTotal - 1, "end");
    } else if (adapter) {
      // Adapter mode — scroll after initial data loads
      const unsub = emitter.on("load:end", () => {
        unsub();
        const total = dataManager.getTotal();
        if (total > 0) {
          scrollMethods.scrollToIndex(total - 1, "end");
        }
      });
    }
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
      // In grid mode, return the flat item count (not row count)
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

    // Snapshot methods (scroll save/restore)
    getScrollSnapshot: snapshotMethods.getScrollSnapshot,
    restoreScroll: snapshotMethods.restoreScroll,

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
