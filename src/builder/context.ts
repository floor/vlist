/**
 * vlist/builder - BuilderContext Factory
 * Central state container that plugins receive during setup.
 *
 * The BuilderContext provides access to all core components plus
 * registration points for handlers, methods, and cleanup callbacks.
 */

import type { VListItem, VListEvents, Range, ItemTemplate } from "../types";

// Direct file imports — NOT barrel indexes — so Bun tree-shakes correctly.
import type { HeightCache } from "../rendering/heights";
import type {
  Renderer,
  DOMStructure,
  CompressionContext,
} from "../rendering/renderer";
import { createRenderer } from "../rendering/renderer";
import {
  type CompressionState,
  getSimpleCompressionState,
} from "../rendering/viewport";

import { createHeightCache } from "../rendering/heights";
import { updateContentHeight, updateContentWidth } from "../rendering/renderer";

import type { SimpleDataManager } from "./data";
import type { ScrollController } from "../features/scrollbar/controller";
import type { Emitter } from "../events/emitter";

import type {
  BuilderConfig,
  BuilderContext,
  BuilderState,
  ResolvedBuilderConfig,
} from "./types";

// =============================================================================
// Factory
// =============================================================================

/** Options for creating a BuilderContext */
export interface CreateBuilderContextOptions<T extends VListItem = VListItem> {
  rawConfig: BuilderConfig<T>;
  resolvedConfig: ResolvedBuilderConfig;
  dom: DOMStructure;
  heightCache: HeightCache;
  dataManager: SimpleDataManager<T>;
  scrollController: ScrollController;
  renderer: Renderer<T>;
  emitter: Emitter<VListEvents<T>>;
  initialState: BuilderState;
  initialHeightConfig: number | ((index: number) => number);
}

/**
 * Create a BuilderContext from individual components.
 *
 * The context acts as the central hub that plugins wire into.
 * Unlike VListContext (used by the monolithic factory), BuilderContext
 * exposes registration arrays and replacement methods for plugins.
 */
export const createBuilderContext = <T extends VListItem = VListItem>(
  options: CreateBuilderContextOptions<T>,
): BuilderContext<T> => {
  const { rawConfig, resolvedConfig, dom, emitter, initialState } = options;

  let { heightCache, dataManager, scrollController, renderer } = options;

  // State is mutable and will be updated by the core and plugins
  const state = initialState;

  // Virtual total function — plugins can replace this
  // (e.g. grid uses row count instead of item count)
  let virtualTotalFn: () => number = () => dataManager.getTotal();

  // Reusable compression context object (avoids allocation on every frame)
  const reusableCompressionCtx: CompressionContext = {
    scrollTop: 0,
    totalItems: 0,
    containerHeight: 0,
    rangeStart: 0,
  };

  // ── Handler registration arrays ───────────────────────────────
  const afterScroll: Array<(scrollTop: number, direction: string) => void> = [];
  const clickHandlers: Array<(event: MouseEvent) => void> = [];
  const keydownHandlers: Array<(event: KeyboardEvent) => void> = [];
  const resizeHandlers: Array<(width: number, height: number) => void> = [];
  const destroyHandlers: Array<() => void> = [];

  // ── Public method registration ────────────────────────────────
  const methods: Map<string, Function> = new Map();

  // ── Helpers ───────────────────────────────────────────────────

  const getVirtualTotal = (): number => virtualTotalFn();

  /**
   * Get cached compression state.
   * Only recalculates when totalItems changes.
   */
  const getCachedCompression = (): CompressionState => {
    const totalItems = getVirtualTotal();

    if (
      state.cachedCompression &&
      state.cachedCompression.totalItems === totalItems
    ) {
      return state.cachedCompression.state;
    }

    const compression = getSimpleCompressionState(totalItems, heightCache);
    state.cachedCompression = { state: compression, totalItems };
    return compression;
  };

  /**
   * Get compression context for rendering.
   * Reuses a single object to avoid allocation on every scroll frame.
   */
  const getCompressionContext = (): CompressionContext => {
    reusableCompressionCtx.scrollTop = state.viewportState.scrollTop;
    reusableCompressionCtx.totalItems = getVirtualTotal();
    reusableCompressionCtx.containerHeight =
      state.viewportState.containerHeight;
    reusableCompressionCtx.rangeStart = state.viewportState.renderRange.start;
    return reusableCompressionCtx;
  };

  /**
   * Get items for a render range.
   */
  const getItemsForRange = (range: Range): T[] => {
    return dataManager.getItemsInRange(range.start, range.end);
  };

  /**
   * Get all loaded items (for selection operations etc.).
   */
  const getAllLoadedItems = (): T[] => {
    const total = dataManager.getTotal();
    return dataManager.getItemsInRange(0, total - 1);
  };

  /**
   * Render if the range has changed.
   * This is the standard render-check used after scroll updates.
   */
  const renderIfNeeded = (): void => {
    if (state.isDestroyed) return;

    const { renderRange, isCompressed } = state.viewportState;
    const lastRange = state.lastRenderRange;

    // Check if render range changed (inlined for hot path performance)
    if (
      renderRange.start === lastRange.start &&
      renderRange.end === lastRange.end
    ) {
      // Range unchanged, but still update positions in compressed mode
      if (isCompressed) {
        renderer.updatePositions(getCompressionContext());
      }
      return;
    }

    const items = getItemsForRange(renderRange);
    const compressionCtx = isCompressed ? getCompressionContext() : undefined;

    renderer.render(
      items,
      renderRange,
      new Set(), // selection state — overridden by selection plugin if present
      -1, // focused index — overridden by selection plugin if present
      compressionCtx,
    );

    state.lastRenderRange = { ...renderRange };

    // Emit range change
    emitter.emit("range:change", { range: renderRange });
  };

  /**
   * Force re-render current range.
   */
  const forceRender = (): void => {
    if (state.isDestroyed) return;

    const { renderRange, isCompressed } = state.viewportState;
    const items = getItemsForRange(renderRange);
    const compressionCtx = isCompressed ? getCompressionContext() : undefined;

    renderer.render(items, renderRange, new Set(), -1, compressionCtx);
  };

  /**
   * Update content size on the correct axis.
   */
  const updateContentSize = (totalSize: number): void => {
    if (resolvedConfig.horizontal) {
      updateContentWidth(dom.content, totalSize);
    } else {
      updateContentHeight(dom.content, totalSize);
    }
  };

  /**
   * Update compression mode when total items changes.
   */
  const updateCompressionMode = (): void => {
    const total = getVirtualTotal();
    const compression = getSimpleCompressionState(total, heightCache);

    if (compression.isCompressed && !scrollController.isCompressed()) {
      scrollController.enableCompression(compression);
    } else if (!compression.isCompressed && scrollController.isCompressed()) {
      scrollController.disableCompression();
    } else if (compression.isCompressed) {
      scrollController.updateConfig({ compression });
    }

    // Invalidate cached compression
    state.cachedCompression = { state: compression, totalItems: total };
  };

  // ── Component replacement ─────────────────────────────────────

  const replaceRenderer = (newRenderer: Renderer<T>): void => {
    renderer = newRenderer;
  };

  const replaceTemplate = (newTemplate: ItemTemplate<T>): void => {
    // For context-based builds, create a new renderer with the new template
    // This is less efficient than the materialize path (which can swap templates directly)
    // but maintains the abstraction of external components
    const newRenderer = createRenderer<T>(
      dom.items,
      newTemplate,
      heightCache,
      resolvedConfig.classPrefix,
      () => dataManager.getTotal(),
      resolvedConfig.ariaIdPrefix,
      resolvedConfig.horizontal,
      undefined,
    );
    renderer = newRenderer;
  };

  const replaceDataManager = (newDataManager: SimpleDataManager<T>): void => {
    dataManager = newDataManager;
  };

  const replaceScrollController = (
    newScrollController: ScrollController,
  ): void => {
    scrollController = newScrollController;
  };

  const setVirtualTotalFn = (fn: () => number): void => {
    virtualTotalFn = fn;
  };

  const rebuildHeightCache = (total?: number): void => {
    const t = total ?? getVirtualTotal();
    heightCache.rebuild(t);
  };

  const setHeightConfig = (
    config: number | ((index: number) => number),
  ): void => {
    // Recreate height cache with new config
    // The height cache is referenced by all components, so we rebuild in-place
    // by using the rebuild method which re-computes prefix sums
    // But if the height *function* changed, we need a new cache instance.
    // Since heightCache is a local let, we can replace it and update the
    // context proxy. Components that captured the old reference will still
    // work until the next rebuild.
    const newCache = createHeightCache(config, getVirtualTotal());
    heightCache = newCache;
  };

  // ── Build the context object ──────────────────────────────────
  // We use a proxy-like approach with getters so that when plugins
  // replace components, the context always reflects the latest reference.

  const ctx: BuilderContext<T> = {
    get dom() {
      return dom;
    },
    get heightCache() {
      return heightCache;
    },
    get emitter() {
      return emitter;
    },
    get config() {
      return resolvedConfig;
    },
    get rawConfig() {
      return rawConfig;
    },

    get renderer() {
      return renderer;
    },
    set renderer(r: Renderer<T>) {
      renderer = r;
    },

    get dataManager() {
      return dataManager;
    },
    set dataManager(dm: SimpleDataManager<T>) {
      dataManager = dm;
    },

    get scrollController() {
      return scrollController;
    },
    set scrollController(sc: ScrollController) {
      scrollController = sc;
    },

    state,

    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    contentSizeHandlers: [],
    destroyHandlers,
    methods,

    replaceRenderer,
    replaceTemplate,
    replaceDataManager,
    replaceScrollController,

    getItemsForRange,
    getAllLoadedItems,
    getVirtualTotal,
    getCachedCompression,
    getCompressionContext,
    renderIfNeeded,
    forceRender,

    setVirtualTotalFn,
    rebuildHeightCache,
    setHeightConfig,
    updateContentSize,
    updateCompressionMode,

    // Additional helpers required by BuilderContext interface
    getRenderFns: () => ({ renderIfNeeded, forceRender }),
    setRenderFns: () => {
      // Stub - render functions are not replaceable in simplified context
    },
    getContainerWidth: () => dom.viewport.clientWidth,
    setVisibleRangeFn: () => {
      // Stub - not used in simplified context
    },
    setScrollToPosFn: () => {
      // Stub - not used in simplified context
    },
    setPositionElementFn: () => {
      // Stub - not used in simplified context
    },
    setScrollFns: () => {
      // Stub - not used in simplified context
    },

    // Window mode plugin hooks (stubs for this simplified context)
    setScrollTarget: () => {
      // Stub - not used in simplified context
    },
    getScrollTarget: () => dom.viewport,
    setContainerDimensions: () => {
      // Stub - not used in simplified context
    },
    disableViewportResize: () => {
      // Stub - not used in simplified context
    },
    invalidateRendered: () => {
      // Stub - not used in simplified context
    },
  };

  return ctx;
};
