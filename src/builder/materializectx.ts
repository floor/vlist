// src/builder/materializectx.ts
/**
 * vlist/builder — Materialize Context Factory
 *
 * Extracts the BuilderContext object, default data-manager proxy, and default
 * scroll-controller proxy out of materialize() in core.ts.
 *
 * All shared mutable state lives in a single `$` (MRefs) object that both
 * core.ts and this module read/write through. Property names are kept short
 * (2–3 chars) so they survive minification without bloating the bundle.
 * Each factory destructures to readable locals on entry.
 *
 * Immutable dependencies are passed via a `deps` (MDeps) object — these are
 * destructured once and never re-read, so their names don't matter at runtime.
 */

import type {
  VListItem,
  VListEvents,
  ItemTemplate,
  ItemState,
  Range,
} from "../types";

import type { SizeCache } from "../rendering/sizes";
import { createSizeCache } from "../rendering/sizes";
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
// MRefs — shared mutable state (short keys for minification)
// =============================================================================

/**
 * Mutable refs object shared between core.ts materialize() and context factories.
 *
 * Key mapping (short → long):
 *
 * | Key  | Meaning                |
 * |------|------------------------|
 * | it   | items                  |
 * | hc   | sizeCache              |
 * | ch   | containerHeight        |
 * | cw   | containerWidth         |
 * | id   | isDestroyed            |
 * | ii   | isInitialized          |
 * | ls   | lastScrollTop          |
 * | vt   | velocityTracker        |
 * | ss   | selectionSet           |
 * | fi   | focusedIndex           |
 * | la   | lastAriaSetSize        |
 * | dm   | dataManagerProxy       |
 * | sc   | scrollControllerProxy  |
 * | vtf  | virtualTotalFn         |
 * | sgt  | scrollGetTop           |
 * | sst  | scrollSetTop           |
 * | sab  | scrollIsAtBottom       |
 * | sic  | scrollIsCompressed     |
 * | rfn  | renderIfNeededFn       |
 * | ffn  | forceRenderFn          |
 * | gvr  | getVisibleRange        |
 * | gsp  | getScrollToPos         |
 * | pef  | positionElementFn      |
 * | at   | activeTemplate         |
 * | vre  | viewportResizeEnabled  |
 * | st   | scrollTarget           |
 * | gcw  | getContainerWidth      |
 * | gch  | getContainerHeight     |
 */
export interface MRefs<T extends VListItem = VListItem> {
  /** items */
  it: T[];
  /** sizeCache */
  hc: SizeCache;
  /** containerHeight */
  ch: number;
  /** containerWidth */
  cw: number;
  /** isDestroyed */
  id: boolean;
  /** isInitialized */
  ii: boolean;
  /** lastScrollTop */
  ls: number;
  /** velocityTracker */
  vt: { velocity: number; sampleCount: number };
  /** selectionSet */
  ss: Set<string | number>;
  /** focusedIndex */
  fi: number;
  /** lastAriaSetSize */
  la: string;
  /** dataManagerProxy */
  dm: any;
  /** scrollControllerProxy */
  sc: any;
  /** virtualTotalFn */
  vtf: () => number;
  /** scrollGetTop */
  sgt: () => number;
  /** scrollSetTop */
  sst: (pos: number) => void;
  /** scrollIsAtBottom */
  sab: (threshold?: number) => boolean;
  /** scrollIsCompressed */
  sic: boolean;
  /** renderIfNeededFn */
  rfn: () => void;
  /** forceRenderFn */
  ffn: () => void;
  /** getVisibleRange */
  gvr: (
    scrollTop: number,
    cHeight: number,
    hc: SizeCache,
    total: number,
    out: Range,
  ) => void;
  /** getScrollToPos */
  gsp: (
    index: number,
    hc: SizeCache,
    cHeight: number,
    total: number,
    align: "start" | "center" | "end",
  ) => number;
  /** positionElementFn */
  pef: (element: HTMLElement, index: number) => void;
  /** activeTemplate */
  at: ItemTemplate<T>;
  /** viewportResizeEnabled */
  vre: boolean;
  /** scrollTarget */
  st: HTMLElement | Window;
  /** getContainerWidth */
  gcw: () => number;
  /** getContainerHeight */
  gch: () => number;
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
    get sizeCache() {
      return $.hc as any;
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
          $.ss = selected;
          $.fi = focusedIdx;
          $.ffn();
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
      return $.dm as any;
    },
    set dataManager(dm: any) {
      $.dm = dm;
    },

    get scrollController() {
      return $.sc as any;
    },
    set scrollController(sc: any) {
      $.sc = sc;
    },

    state: sharedState,

    /** Get current container width (for grid plugin) */
    getContainerWidth(): number {
      return $.cw;
    },

    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    contentSizeHandlers,
    destroyHandlers,
    methods,

    replaceTemplate(newTemplate: ItemTemplate<T>): void {
      $.at = newTemplate;
    },
    replaceRenderer(_renderer: any): void {
      // No-op in materialize (renderer is inlined)
    },
    replaceDataManager(dm: any): void {
      $.dm = dm;
    },
    replaceScrollController(sc: any): void {
      $.sc = sc;
    },

    getItemsForRange(range: Range): T[] {
      const dm = $.dm;
      const items = $.it;
      const result: T[] = [];
      for (let i = range.start; i <= range.end; i++) {
        const item = (dm ? dm.getItem(i) : items[i]) as T | undefined;
        if (item) result.push(item);
      }
      return result;
    },
    getAllLoadedItems(): T[] {
      const dm = $.dm;
      if (dm) {
        const total = dm.getTotal();
        const result: T[] = [];
        for (let i = 0; i < total; i++) {
          const item = dm.getItem(i) as T | undefined;
          if (item) result.push(item);
        }
        return result;
      }
      return [...$.it];
    },
    getVirtualTotal(): number {
      return $.vtf();
    },
    getCachedCompression() {
      const hc = $.hc;
      return {
        isCompressed: false,
        actualHeight: hc.getTotalSize(),
        virtualHeight: hc.getTotalSize(),
        ratio: 1,
      } as any;
    },
    getCompressionContext() {
      return {
        scrollTop: $.ls,
        totalItems: $.vtf(),
        containerHeight: $.ch,
        rangeStart: renderRange.start,
      } as any;
    },
    renderIfNeeded(): void {
      $.rfn();
    },
    forceRender(): void {
      $.ffn();
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
        renderIfNeeded: $.rfn,
        forceRender: $.ffn,
      };
    },
    setRenderFns(renderFn: () => void, forceFn: () => void): void {
      $.rfn = renderFn;
      $.ffn = forceFn;
    },

    setVirtualTotalFn(fn: () => number): void {
      $.vtf = fn;
    },
    rebuildSizeCache(total?: number): void {
      $.hc.rebuild(total ?? $.vtf());
    },
    setSizeConfig(newConfig: number | ((index: number) => number)): void {
      $.hc = createSizeCache(newConfig, $.vtf());
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
        hc: SizeCache,
        total: number,
        out: Range,
      ) => void,
    ): void {
      $.gvr = fn;
    },

    setScrollToPosFn(
      fn: (
        index: number,
        hc: SizeCache,
        cHeight: number,
        total: number,
        align: "start" | "center" | "end",
      ) => number,
    ): void {
      $.gsp = fn;
    },

    setPositionElementFn(
      fn: (element: HTMLElement, index: number) => void,
    ): void {
      $.pef = fn;
    },

    setScrollFns(getTop: () => number, setTop: (pos: number) => void): void {
      $.sgt = getTop;
      // Wrap the provided setTop so that after storing the position
      // the builder's scroll pipeline (render + events) fires immediately.
      // In compressed mode the native scroll event may not fire (or may
      // fire with a clamped value), so we must trigger explicitly.
      $.sst = (pos: number): void => {
        setTop(pos);
        onScrollFrame();
      };
    },

    setScrollTarget(target: HTMLElement | Window): void {
      // Remove listener from old target
      $.st.removeEventListener("scroll", onScrollFrame);
      // Update target and re-attach listener
      $.st = target;
      $.st.addEventListener("scroll", onScrollFrame, { passive: true });
    },

    getScrollTarget(): HTMLElement | Window {
      return $.st;
    },

    setContainerDimensions(getter: {
      width: () => number;
      height: () => number;
    }): void {
      $.gcw = getter.width;
      $.gch = getter.height;
      // Update current dimensions immediately
      $.cw = getter.width();
      $.ch = getter.height();
      sharedState.viewportState.containerHeight = $.ch;
    },

    disableViewportResize(): void {
      if ($.vre) {
        $.vre = false;
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
    | "rendered"
    | "itemState"
    | "contentSizeHandlers"
    | "applyTemplate"
    | "updateContentSize"
  >,
  ctx: BuilderContext<T>,
): any => {
  const {
    rendered,
    itemState,
    contentSizeHandlers,
    applyTemplate,
    updateContentSize,
  } = deps;

  /** Sync size cache, content size, compression, notify handlers, re-render. */
  const syncAfterChange = (): void => {
    $.hc.rebuild($.vtf());
    updateContentSize();
    ctx.updateCompressionMode();
    for (let i = 0; i < contentSizeHandlers.length; i++) {
      contentSizeHandlers[i]!();
    }
    $.ffn();
  };

  return {
    getState: () => ({
      total: $.it.length,
      cached: $.it.length,
      isLoading: false,
      pendingRanges: [],
      error: undefined,
      hasMore: false,
      cursor: undefined,
    }),
    getTotal: () => $.it.length,
    getCached: () => $.it.length,
    getIsLoading: () => false,
    getHasMore: () => false,
    getStorage: () => null,
    getPlaceholders: () => null,
    getItem: (index: number) => $.it[index],
    // getItemById and getIndexById removed for memory efficiency
    // Users can maintain their own id→index Map if needed
    isItemLoaded: (index: number) =>
      index >= 0 && index < $.it.length && $.it[index] !== undefined,
    getItemsInRange: (start: number, end: number) => {
      const items = $.it;
      const result: T[] = [];
      const s = Math.max(0, start);
      const e = Math.min(end, items.length - 1);
      for (let i = s; i <= e; i++) result.push(items[i] as T);
      return result;
    },
    setTotal: (t: number) => {
      // no-op for simple manager
      void t;
    },
    setItems: (newItems: T[], offset = 0, newTotal?: number) => {
      const items = $.it;
      if (offset === 0 && (newTotal !== undefined || items.length === 0)) {
        $.it = newItems;
      } else {
        // Ensure items array is large enough before assigning
        const requiredLength = offset + newItems.length;
        if (items.length < requiredLength) {
          items.length = requiredLength;
        }
        for (let i = 0; i < newItems.length; i++) {
          items[offset + i] = newItems[i]!;
        }
      }
      if (newTotal !== undefined) {
        // trim or leave
      }
      if ($.ii) syncAfterChange();
    },
    updateItem: (index: number, updates: Partial<T>) => {
      const items = $.it;
      if (index < 0 || index >= items.length) return false;
      const item = items[index];
      if (!item) return false;
      items[index] = { ...item, ...updates } as T;
      // Re-render if visible
      const el = rendered.get(index);
      if (el) {
        applyTemplate(el, $.at(items[index]!, index, itemState));
        el.dataset.id = String(items[index]!.id);
      }
      return true;
    },
    removeItem: (index: number) => {
      if (index < 0 || index >= $.it.length) return false;
      $.it.splice(index, 1);
      if ($.ii) syncAfterChange();
      return true;
    },
    loadRange: async () => {},
    ensureRange: async () => {},
    loadInitial: async () => {},
    loadMore: async () => false,
    reload: async () => {},
    evictDistant: () => {},
    clear: () => {
      $.it = [] as unknown as T[];
    },
    reset: () => {
      $.it = [] as unknown as T[];
      if ($.ii) {
        $.hc.rebuild(0);
        updateContentSize();
        $.ffn();
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
    getScrollTop: () => $.sgt(),
    scrollTo: (pos: number) => {
      $.sst(pos);
      $.ls = pos;
      $.rfn();
    },
    scrollBy: (delta: number) => {
      const newPos = $.sgt() + delta;
      $.sst(newPos);
      $.ls = newPos;
      $.rfn();
    },
    isAtTop: () => $.ls <= 2,
    isAtBottom: (threshold = 2) => $.sab(threshold),
    getScrollPercentage: () => {
      const total = $.hc.getTotalSize();
      const maxScroll = Math.max(0, total - $.ch);
      return maxScroll > 0 ? $.ls / maxScroll : 0;
    },
    getVelocity: () => $.vt.velocity,
    isTracking: () => $.vt.sampleCount >= 2,
    isScrolling: () => dom.root.classList.contains(`${classPrefix}--scrolling`),
    updateConfig: () => {},
    enableCompression: () => {
      $.sic = true;
    },
    disableCompression: () => {
      $.sic = false;
    },
    isCompressed: () => $.sic,
    isWindowMode: () => false,
    updateContainerHeight: (h: number) => {
      $.ch = h;
    },
    destroy: () => {},
  };
};
