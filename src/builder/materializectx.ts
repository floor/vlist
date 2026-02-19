// src/builder/materializectx.ts
/**
 * vlist/builder — Materialize Context Factory
 *
 * Extracts the BuilderContext object, default data-manager proxy, and default
 * scroll-controller proxy out of materialize() in core.ts.
 *
 * All shared mutable state lives in a single `$` (MRefs) object that both
 * core.ts and this module read/write through.  Immutable dependencies are
 * passed via a `deps` (MDeps) object.
 */

import type {
  VListItem,
  VListEvents,
  ItemTemplate,
  ItemState,
  Range,
} from "../types";

import type { HeightCache } from "../rendering/heights";
import { createHeightCache } from "../rendering/heights";
import type { Emitter } from "../events/emitter";

import type { DOMStructure } from "./dom";
import type { createElementPool } from "./pool";

import type {
  BuilderConfig,
  BuilderContext,
  BuilderState,
  ResolvedBuilderConfig,
} from "./types";

// =============================================================================
// MRefs — shared mutable state between materialize() and extracted factories
// =============================================================================

/** Mutable refs object shared between core.ts materialize() and context factories. */
export interface MRefs<T extends VListItem = VListItem> {
  items: T[];
  heightCache: HeightCache;
  containerHeight: number;
  containerWidth: number;
  isDestroyed: boolean;
  isInitialized: boolean;
  lastScrollTop: number;
  velocityTracker: { velocity: number; sampleCount: number };
  selectionSet: Set<string | number>;
  focusedIndex: number;
  lastAriaSetSize: string;
  dataManagerProxy: any;
  scrollControllerProxy: any;
  virtualTotalFn: () => number;
  scrollGetTop: () => number;
  scrollSetTop: (pos: number) => void;
  scrollIsAtBottom: (threshold?: number) => boolean;
  scrollIsCompressed: boolean;
  renderIfNeededFn: () => void;
  forceRenderFn: () => void;
  getVisibleRange: (
    scrollTop: number,
    cHeight: number,
    hc: HeightCache,
    total: number,
    out: Range,
  ) => void;
  getScrollToPos: (
    index: number,
    hc: HeightCache,
    cHeight: number,
    total: number,
    align: "start" | "center" | "end",
  ) => number;
  positionElementFn: (element: HTMLElement, index: number) => void;
  activeTemplate: ItemTemplate<T>;
  viewportResizeEnabled: boolean;
  scrollTarget: HTMLElement | Window;
  getContainerWidth: () => number;
  getContainerHeight: () => number;
}

// =============================================================================
// MDeps — immutable dependencies passed from materialize()
// =============================================================================

/** Immutable dependencies the context factory needs from materialize(). */
export interface MDeps<T extends VListItem = VListItem> {
  readonly dom: DOMStructure;
  readonly emitter: Emitter<VListEvents<T>>;
  readonly resolvedConfig: ResolvedBuilderConfig;
  readonly rawConfig: BuilderConfig<T>;
  readonly rendered: Map<number, HTMLElement>;
  readonly pool: ReturnType<typeof createElementPool>;
  readonly itemState: ItemState;
  readonly sharedState: BuilderState;
  readonly idToIndex: Map<string | number, number>;
  readonly renderRange: Range;
  readonly isHorizontal: boolean;
  readonly classPrefix: string;
  readonly contentSizeHandlers: Array<() => void>;
  readonly afterScroll: Array<(scrollTop: number, direction: string) => void>;
  readonly clickHandlers: Array<(event: MouseEvent) => void>;
  readonly keydownHandlers: Array<(event: KeyboardEvent) => void>;
  readonly resizeHandlers: Array<(width: number, height: number) => void>;
  readonly destroyHandlers: Array<() => void>;
  readonly methods: Map<string, Function>;
  readonly onScrollFrame: () => void;
  readonly resizeObserver: ResizeObserver;
  readonly rebuildIdIndex: () => void;
  readonly applyTemplate: (
    element: HTMLElement,
    result: string | HTMLElement,
  ) => void;
  readonly updateContentSize: () => void;
}

// =============================================================================
// createMaterializeCtx — BuilderContext factory
// =============================================================================

export const createMaterializeCtx = <T extends VListItem = VListItem>(
  $: MRefs<T>,
  deps: MDeps<T>,
): BuilderContext<T> => {
  const {
    dom,
    emitter,
    resolvedConfig,
    rawConfig,
    rendered,
    pool,
    sharedState,
    isHorizontal,
    classPrefix,
    contentSizeHandlers,
    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    destroyHandlers,
    methods,
    onScrollFrame,
    resizeObserver,
    renderRange,
  } = deps;

  return {
    get dom() {
      return dom as any;
    },
    get heightCache() {
      return $.heightCache as any;
    },
    get emitter() {
      return emitter as any;
    },
    get config() {
      return resolvedConfig;
    },
    get rawConfig() {
      return rawConfig;
    },

    // Mutable component slots (plugins can replace)
    // Expose a renderer proxy so plugins (e.g. withSelection) can call
    // ctx.renderer.render() and ctx.renderer.updateItemClasses() without
    // needing access to the inlined rendering internals.
    get renderer() {
      return {
        render: (
          _items: T[],
          _range: Range,
          selected: Set<string | number>,
          focusedIdx: number,
          _compressionCtx?: any,
        ): void => {
          // Inject selection state into the inlined renderer's closure
          $.selectionSet = selected;
          $.focusedIndex = focusedIdx;
          $.forceRenderFn();
        },
        updateItemClasses: (
          index: number,
          isSelected: boolean,
          isFocused: boolean,
        ): void => {
          const el = rendered.get(index);
          if (!el) return;
          el.classList.toggle(`${classPrefix}-item--selected`, isSelected);
          el.classList.toggle(`${classPrefix}-item--focused`, isFocused);
          el.ariaSelected = isSelected ? "true" : "false";
        },
        updatePositions: () => {},
        updateItem: () => {},
        getElement: (index: number) => rendered.get(index) ?? null,
        clear: () => {},
        destroy: () => {},
      } as any;
    },
    set renderer(_r: any) {
      // no-op — grid plugin overrides via methods below
    },

    get dataManager() {
      return $.dataManagerProxy as any;
    },
    set dataManager(dm: any) {
      $.dataManagerProxy = dm;
    },

    get scrollController() {
      return $.scrollControllerProxy as any;
    },
    set scrollController(sc: any) {
      $.scrollControllerProxy = sc;
    },

    state: sharedState,

    /** Get current container width (for grid plugin) */
    getContainerWidth(): number {
      return $.containerWidth;
    },

    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    contentSizeHandlers,
    destroyHandlers,
    methods,

    replaceTemplate(newTemplate: ItemTemplate<T>): void {
      // Replace the active template (used by inlined renderer)
      // This is the proper way to modify rendering in the materialize path
      $.activeTemplate = newTemplate;
    },
    replaceRenderer(_renderer: any): void {
      // No-op in materialize (renderer is inlined)
      // Grid plugin uses this, but manages its own renderer via methods
      // Groups plugin should use replaceTemplate instead
    },
    replaceDataManager(dm: any): void {
      $.dataManagerProxy = dm;
    },
    replaceScrollController(sc: any): void {
      $.scrollControllerProxy = sc;
    },

    getItemsForRange(range: Range): T[] {
      const result: T[] = [];
      for (let i = range.start; i <= range.end; i++) {
        const item = (
          $.dataManagerProxy
            ? $.dataManagerProxy.getItem(i)
            : $.items[i]
        ) as T | undefined;
        if (item) result.push(item);
      }
      return result;
    },
    getAllLoadedItems(): T[] {
      if ($.dataManagerProxy) {
        const total = $.dataManagerProxy.getTotal();
        const result: T[] = [];
        for (let i = 0; i < total; i++) {
          const item = $.dataManagerProxy.getItem(i) as T | undefined;
          if (item) result.push(item);
        }
        return result;
      }
      return [...$.items];
    },
    getVirtualTotal(): number {
      return $.virtualTotalFn();
    },
    getCachedCompression() {
      return {
        isCompressed: false,
        actualHeight: $.heightCache.getTotalHeight(),
        virtualHeight: $.heightCache.getTotalHeight(),
        ratio: 1,
      } as any;
    },
    getCompressionContext() {
      return {
        scrollTop: $.lastScrollTop,
        totalItems: $.virtualTotalFn(),
        containerHeight: $.containerHeight,
        rangeStart: renderRange.start,
      } as any;
    },
    renderIfNeeded(): void {
      $.renderIfNeededFn();
    },
    forceRender(): void {
      $.forceRenderFn();
    },
    invalidateRendered(): void {
      for (const [, element] of rendered) {
        element.remove();
        pool.release(element);
      }
      rendered.clear();
    },
    getRenderFns(): { renderIfNeeded: () => void; forceRender: () => void } {
      return {
        renderIfNeeded: $.renderIfNeededFn,
        forceRender: $.forceRenderFn,
      };
    },
    setRenderFns(renderFn: () => void, forceFn: () => void): void {
      $.renderIfNeededFn = renderFn;
      $.forceRenderFn = forceFn;
    },

    setVirtualTotalFn(fn: () => number): void {
      $.virtualTotalFn = fn;
    },
    rebuildHeightCache(total?: number): void {
      $.heightCache.rebuild(total ?? $.virtualTotalFn());
    },
    setHeightConfig(newConfig: number | ((index: number) => number)): void {
      $.heightCache = createHeightCache(newConfig, $.virtualTotalFn());
    },
    updateContentSize(totalSize: number): void {
      const size = `${totalSize}px`;
      if (isHorizontal) {
        dom.content.style.width = size;
      } else {
        dom.content.style.height = size;
      }
    },
    updateCompressionMode(): void {
      // No-op by default — withCompression plugin replaces this
    },

    setVisibleRangeFn(
      fn: (
        scrollTop: number,
        cHeight: number,
        hc: HeightCache,
        total: number,
        out: Range,
      ) => void,
    ): void {
      $.getVisibleRange = fn;
    },

    setScrollToPosFn(
      fn: (
        index: number,
        hc: HeightCache,
        cHeight: number,
        total: number,
        align: "start" | "center" | "end",
      ) => number,
    ): void {
      $.getScrollToPos = fn;
    },

    setPositionElementFn(
      fn: (element: HTMLElement, index: number) => void,
    ): void {
      $.positionElementFn = fn;
    },

    setScrollFns(getTop: () => number, setTop: (pos: number) => void): void {
      $.scrollGetTop = getTop;
      // Wrap the provided setTop so that after storing the position
      // the builder's scroll pipeline (render + events) fires immediately.
      // In compressed mode the native scroll event may not fire (or may
      // fire with a clamped value), so we must trigger explicitly.
      $.scrollSetTop = (pos: number): void => {
        setTop(pos);
        onScrollFrame();
      };
    },

    setScrollTarget(target: HTMLElement | Window): void {
      // Remove listener from old target
      $.scrollTarget.removeEventListener("scroll", onScrollFrame);
      // Update target and re-attach listener
      $.scrollTarget = target;
      $.scrollTarget.addEventListener("scroll", onScrollFrame, {
        passive: true,
      });
    },

    getScrollTarget(): HTMLElement | Window {
      return $.scrollTarget;
    },

    setContainerDimensions(getter: {
      width: () => number;
      height: () => number;
    }): void {
      $.getContainerWidth = getter.width;
      $.getContainerHeight = getter.height;
      // Update current dimensions immediately
      $.containerWidth = getter.width();
      $.containerHeight = getter.height();
      sharedState.viewportState.containerHeight = $.containerHeight;
    },

    disableViewportResize(): void {
      if ($.viewportResizeEnabled) {
        $.viewportResizeEnabled = false;
        resizeObserver.unobserve(dom.viewport);
      }
    },
  };
};

// =============================================================================
// createDefaultDataProxy — default data manager (thin items-array wrapper)
// =============================================================================

export const createDefaultDataProxy = <T extends VListItem = VListItem>(
  $: MRefs<T>,
  deps: Pick<
    MDeps<T>,
    | "idToIndex"
    | "rendered"
    | "itemState"
    | "contentSizeHandlers"
    | "rebuildIdIndex"
    | "applyTemplate"
    | "updateContentSize"
  >,
  ctx: BuilderContext<T>,
): any => {
  const {
    idToIndex,
    rendered,
    itemState,
    contentSizeHandlers,
    rebuildIdIndex,
    applyTemplate,
    updateContentSize,
  } = deps;

  return {
    getState: () => ({
      total: $.items.length,
      cached: $.items.length,
      isLoading: false,
      pendingRanges: [],
      error: undefined,
      hasMore: false,
      cursor: undefined,
    }),
    getTotal: () => $.items.length,
    getCached: () => $.items.length,
    getIsLoading: () => false,
    getHasMore: () => false,
    getStorage: () => null,
    getPlaceholders: () => null,
    getItem: (index: number) => $.items[index],
    getItemById: (id: string | number) => {
      const idx = idToIndex.get(id);
      return idx !== undefined ? $.items[idx] : undefined;
    },
    getIndexById: (id: string | number) => idToIndex.get(id) ?? -1,
    isItemLoaded: (index: number) =>
      index >= 0 &&
      index < $.items.length &&
      $.items[index] !== undefined,
    getItemsInRange: (start: number, end: number) => {
      const result: T[] = [];
      const s = Math.max(0, start);
      const e = Math.min(end, $.items.length - 1);
      for (let i = s; i <= e; i++) result.push($.items[i] as T);
      return result;
    },
    setTotal: (t: number) => {
      // no-op for simple manager
      void t;
    },
    setItems: (newItems: T[], offset = 0, newTotal?: number) => {
      if (
        offset === 0 &&
        (newTotal !== undefined || $.items.length === 0)
      ) {
        $.items = [...newItems];
      } else {
        // Ensure items array is large enough before assigning
        const requiredLength = offset + newItems.length;
        if ($.items.length < requiredLength) {
          $.items.length = requiredLength;
        }
        for (let i = 0; i < newItems.length; i++) {
          $.items[offset + i] = newItems[i]!;
        }
      }
      if (newTotal !== undefined) {
        // trim or leave
      }
      rebuildIdIndex();
      if ($.isInitialized) {
        $.heightCache.rebuild($.virtualTotalFn());
        updateContentSize();
        ctx.updateCompressionMode();
        for (let i = 0; i < contentSizeHandlers.length; i++) {
          contentSizeHandlers[i]!();
        }
        $.forceRenderFn();
      }
    },
    updateItem: (id: string | number, updates: Partial<T>) => {
      const index = idToIndex.get(id);
      if (index === undefined) return false;
      const item = $.items[index];
      if (!item) return false;
      $.items[index] = { ...item, ...updates } as T;
      if (updates.id !== undefined && updates.id !== id) {
        idToIndex.delete(id);
        idToIndex.set(updates.id, index);
      }
      // Re-render if visible
      const el = rendered.get(index);
      if (el) {
        applyTemplate(
          el,
          $.activeTemplate($.items[index]!, index, itemState),
        );
        el.dataset.id = String($.items[index]!.id);
      }
      return true;
    },
    removeItem: (id: string | number) => {
      const index = idToIndex.get(id);
      if (index === undefined) return false;
      $.items.splice(index, 1);
      rebuildIdIndex();
      if ($.isInitialized) {
        $.heightCache.rebuild($.virtualTotalFn());
        updateContentSize();
        ctx.updateCompressionMode();
        for (let i = 0; i < contentSizeHandlers.length; i++) {
          contentSizeHandlers[i]!();
        }
        $.forceRenderFn();
      }
      return true;
    },
    loadRange: async () => {},
    ensureRange: async () => {},
    loadInitial: async () => {},
    loadMore: async () => false,
    reload: async () => {},
    evictDistant: () => {},
    clear: () => {
      $.items = [] as unknown as T[];
      idToIndex.clear();
    },
    reset: () => {
      $.items = [] as unknown as T[];
      idToIndex.clear();
      if ($.isInitialized) {
        $.heightCache.rebuild(0);
        updateContentSize();
        $.forceRenderFn();
      }
    },
  };
};

// =============================================================================
// createDefaultScrollProxy — minimal scroll controller
// =============================================================================

export const createDefaultScrollProxy = <T extends VListItem = VListItem>(
  $: MRefs<T>,
  deps: Pick<MDeps<T>, "dom" | "classPrefix">,
): any => {
  const { dom, classPrefix } = deps;

  return {
    getScrollTop: () => $.scrollGetTop(),
    scrollTo: (pos: number) => {
      $.scrollSetTop(pos);
      $.lastScrollTop = pos;
      $.renderIfNeededFn();
    },
    scrollBy: (delta: number) => {
      const newPos = $.scrollGetTop() + delta;
      $.scrollSetTop(newPos);
      $.lastScrollTop = newPos;
      $.renderIfNeededFn();
    },
    isAtTop: () => $.lastScrollTop <= 2,
    isAtBottom: (threshold = 2) => $.scrollIsAtBottom(threshold),
    getScrollPercentage: () => {
      const total = $.heightCache.getTotalHeight();
      const maxScroll = Math.max(0, total - $.containerHeight);
      return maxScroll > 0 ? $.lastScrollTop / maxScroll : 0;
    },
    getVelocity: () => $.velocityTracker.velocity,
    isTracking: () => $.velocityTracker.sampleCount >= 2,
    isScrolling: () =>
      dom.root.classList.contains(`${classPrefix}--scrolling`),
    updateConfig: () => {},
    enableCompression: () => {
      $.scrollIsCompressed = true;
    },
    disableCompression: () => {
      $.scrollIsCompressed = false;
    },
    isCompressed: () => $.scrollIsCompressed,
    isWindowMode: () => false,
    updateContainerHeight: (h: number) => {
      $.containerHeight = h;
    },
    destroy: () => {},
  };
};
