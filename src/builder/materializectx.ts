// src/builder/materializectx.ts
/**
 * vlist/builder — Materialize Context Factory (Option B: Getter-Setter Deps)
 *
 * Extracts the BuilderContext object, default data-manager proxy, and default
 * scroll-controller proxy out of materialize() in core.ts.
 *
 * Hot-path variables remain as bare `let` in materialize() for optimal minification.
 * Extracted factories receive **accessor closures** that capture those locals.
 * Reads go through getter functions. Writes go through setter functions.
 * The function names are local parameters inside the factory — they minify to single letters.
 */

import type { VListItem, ItemTemplate, ItemState, Range } from "../types";

// VelocityTracker types (inlined in core.ts)
interface VelocitySample {
  position: number;
  time: number;
}

interface VelocityTracker {
  velocity: number;
  lastPosition: number;
  lastTime: number;
  samples: VelocitySample[];
  sampleIndex: number;
  sampleCount: number;
}

import type { HeightCache } from "../rendering/heights";
import { createHeightCache } from "../rendering/heights";

// DOMStructure and pool types are defined inline in core.ts (not separate modules)
interface DOMStructure {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
}

interface ElementPool {
  acquire: () => HTMLElement;
  release: (el: HTMLElement) => void;
  clear: () => void;
}

import type {
  BuilderConfig,
  BuilderContext,
  BuilderState,
  ResolvedBuilderConfig,
} from "./types";

// =============================================================================
// MAccessors — Getter/Setter closures over materialize() locals
// =============================================================================

/**
 * Accessor object that provides read/write access to materialize()'s local `let` variables.
 * Each getter/setter pair is a closure that captures the variable from materialize()'s scope.
 *
 * Property names survive minification but there are fewer total accessor call sites
 * than Option A's property lookups in hot-path code.
 */
export interface MAccessors<T extends VListItem = VListItem> {
  // ── Getters (return current value of closure variable) ────────────────────

  /** Get items array */
  it: () => T[];
  /** Get heightCache */
  hc: () => HeightCache;
  /** Get containerHeight */
  ch: () => number;
  /** Get containerWidth */
  cw: () => number;
  /** Get isDestroyed */
  id: () => boolean;
  /** Get isInitialized */
  ii: () => boolean;
  /** Get lastScrollTop */
  ls: () => number;
  /** Get velocityTracker */
  vt: () => VelocityTracker;
  /** Get selectionSet */
  ss: () => Set<string | number>;
  /** Get focusedIndex */
  fi: () => number;
  /** Get lastAriaSetSize */
  la: () => string;
  /** Get dataManagerProxy */
  dm: () => any;
  /** Get scrollControllerProxy */
  sc: () => any;
  /** Get virtualTotalFn (DOUBLE-CALL: vtf()() to get total) */
  vtf: () => () => number;
  /** Get scrollGetTop (DOUBLE-CALL: sgt()() to get scroll position) */
  sgt: () => () => number;
  /** Get scrollSetTop (DOUBLE-CALL: sst()(pos) to set scroll) */
  sst: () => (pos: number) => void;
  /** Get scrollIsAtBottom (DOUBLE-CALL: sab()(threshold) to check) */
  sab: () => (threshold?: number) => boolean;
  /** Get scrollIsCompressed */
  sic: () => boolean;
  /** Get renderIfNeededFn (DOUBLE-CALL: rfn()() to render) */
  rfn: () => () => void;
  /** Get forceRenderFn (DOUBLE-CALL: ffn()() to force render) */
  ffn: () => () => void;
  /** Get getVisibleRange */
  gvr: () => (
    scrollTop: number,
    cHeight: number,
    hc: HeightCache,
    total: number,
    out: Range,
  ) => void;
  /** Get getScrollToPos */
  gsp: () => (
    index: number,
    hc: HeightCache,
    cHeight: number,
    total: number,
    align: "start" | "center" | "end",
  ) => number;
  /** Get positionElementFn */
  pef: () => (element: HTMLElement, index: number) => void;
  /** Get activeTemplate */
  at: () => ItemTemplate<T>;
  /** Get viewportResizeEnabled */
  vre: () => boolean;
  /** Get scrollTarget */
  st: () => HTMLElement | Window;
  /** Get getContainerWidth */
  gcw: () => () => number;
  /** Get getContainerHeight */
  gch: () => () => number;

  // ── Setters (update closure variable) ─────────────────────────────────────

  /** Set items array */
  setIT: (v: T[]) => void;
  /** Set heightCache */
  setHC: (v: HeightCache) => void;
  /** Set containerHeight */
  setCH: (v: number) => void;
  /** Set containerWidth */
  setCW: (v: number) => void;
  /** Set isDestroyed */
  setID: (v: boolean) => void;
  /** Set isInitialized */
  setII: (v: boolean) => void;
  /** Set lastScrollTop */
  setLS: (v: number) => void;
  /** Set velocityTracker */
  setVT: (v: VelocityTracker) => void;
  /** Set selectionSet */
  setSS: (v: Set<string | number>) => void;
  /** Set focusedIndex */
  setFI: (v: number) => void;
  /** Set lastAriaSetSize */
  setLA: (v: string) => void;
  /** Set dataManagerProxy */
  setDM: (v: any) => void;
  /** Set scrollControllerProxy */
  setSC: (v: any) => void;
  /** Set virtualTotalFn */
  setVTF: (v: () => number) => void;
  /** Set scrollGetTop */
  setSGT: (v: () => number) => void;
  /** Set scrollSetTop */
  setSST: (v: (pos: number) => void) => void;
  /** Set scrollIsAtBottom */
  setSAB: (v: (threshold?: number) => boolean) => void;
  /** Set scrollIsCompressed */
  setSIC: (v: boolean) => void;
  /** Set renderIfNeededFn */
  setRFN: (v: () => void) => void;
  /** Set forceRenderFn */
  setFFN: (v: () => void) => void;
  /** Set getVisibleRange */
  setGVR: (
    v: (
      scrollTop: number,
      cHeight: number,
      hc: HeightCache,
      total: number,
      out: Range,
    ) => void,
  ) => void;
  /** Set getScrollToPos */
  setGSP: (
    v: (
      index: number,
      hc: HeightCache,
      cHeight: number,
      total: number,
      align: "start" | "center" | "end",
    ) => number,
  ) => void;
  /** Set positionElementFn */
  setPEF: (v: (element: HTMLElement, index: number) => void) => void;
  /** Set activeTemplate */
  setAT: (v: ItemTemplate<T>) => void;
  /** Set viewportResizeEnabled */
  setVRE: (v: boolean) => void;
  /** Set scrollTarget */
  setST: (v: HTMLElement | Window) => void;
  /** Set getContainerWidth */
  setGCW: (v: () => number) => void;
  /** Set getContainerHeight */
  setGCH: (v: () => number) => void;
}

// =============================================================================
// MDeps — immutable dependencies passed from materialize()
// =============================================================================

/** Immutable dependencies the context factory needs from materialize(). */
export interface MDeps<T extends VListItem = VListItem> {
  readonly dom: DOMStructure;
  readonly emitter: any; // Inlined emitter in core.ts doesn't match full Emitter type
  readonly resolvedConfig: ResolvedBuilderConfig;
  readonly rawConfig: BuilderConfig<T>;
  readonly rendered: Map<number, HTMLElement>;
  readonly pool: ElementPool;
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
  acc: MAccessors<T>,
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
    renderRange,
  } = deps;

  return {
    get dom() {
      return dom as any;
    },
    get heightCache() {
      return acc.hc() as any;
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
          acc.setSS(selected);
          acc.setFI(focusedIdx);
          acc.ffn()(); // DOUBLE-CALL: get the function, then call it
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
      return acc.dm() as any;
    },
    set dataManager(dm: any) {
      acc.setDM(dm);
    },

    get scrollController() {
      return acc.sc() as any;
    },
    set scrollController(sc: any) {
      acc.setSC(sc);
    },

    state: sharedState,

    /** Get current container width (for grid plugin) */
    getContainerWidth(): number {
      return acc.cw();
    },

    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    contentSizeHandlers,
    destroyHandlers,
    methods,

    replaceTemplate(newTemplate: ItemTemplate<T>): void {
      acc.setAT(newTemplate);
    },
    replaceRenderer(_renderer: any): void {
      // No-op in materialize (renderer is inlined)
    },
    replaceDataManager(dm: any): void {
      acc.setDM(dm);
    },
    replaceScrollController(sc: any): void {
      acc.setSC(sc);
    },

    getItemsForRange(range: Range): T[] {
      const dm = acc.dm();
      const items = acc.it();
      const result: T[] = [];
      for (let i = range.start; i <= range.end; i++) {
        const item = (dm ? dm.getItem(i) : items[i]) as T | undefined;
        if (item) result.push(item);
      }
      return result;
    },
    getAllLoadedItems(): T[] {
      const dm = acc.dm();
      if (dm) {
        const total = dm.getTotal();
        const result: T[] = [];
        for (let i = 0; i < total; i++) {
          const item = dm.getItem(i) as T | undefined;
          if (item) result.push(item);
        }
        return result;
      }
      return [...acc.it()];
    },
    getVirtualTotal(): number {
      return acc.vtf()(); // DOUBLE-CALL: get function, then call it
    },
    getCachedCompression() {
      const hc = acc.hc();
      return {
        isCompressed: false,
        actualHeight: hc.getTotalHeight(),
        virtualHeight: hc.getTotalHeight(),
        ratio: 1,
      } as any;
    },
    getCompressionContext() {
      return {
        scrollTop: acc.ls(),
        totalItems: acc.vtf()(),
        containerHeight: acc.ch(),
        rangeStart: renderRange.start,
      } as any;
    },
    renderIfNeeded(): void {
      acc.rfn()(); // DOUBLE-CALL
    },
    forceRender(): void {
      acc.ffn()(); // DOUBLE-CALL
    },
    invalidateRendered(): void {
      for (const [, element] of rendered) {
        element.remove();
        pool.release(element);
      }
      rendered.clear();
    },
    getRenderFns(): { renderIfNeeded: () => void; forceRender: () => void } {
      const renderIfNeeded = acc.rfn();
      const forceRender = acc.ffn();
      return {
        renderIfNeeded,
        forceRender,
      };
    },
    setRenderFns(renderFn: () => void, forceFn: () => void): void {
      acc.setRFN(renderFn);
      acc.setFFN(forceFn);
    },

    setVirtualTotalFn(fn: () => number): void {
      acc.setVTF(fn);
    },
    rebuildHeightCache(total?: number): void {
      const hc = acc.hc();
      hc.rebuild(total ?? acc.vtf()());
    },
    setHeightConfig(newConfig: number | ((index: number) => number)): void {
      acc.setHC(createHeightCache(newConfig, acc.vtf()()));
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

    setScrollTarget(target: HTMLElement | Window): void {
      acc.setST(target);
    },
  } as any; // Cast to any - some methods are added in core.ts after factory creation
};

// =============================================================================
// createDefaultDataProxy — default data manager (thin items-array wrapper)
// =============================================================================

export const createDefaultDataProxy = <T extends VListItem = VListItem>(
  acc: MAccessors<T>,
  deps: Pick<
    MDeps<T>,
    | "idToIndex"
    | "rendered"
    | "itemState"
    | "contentSizeHandlers"
    | "rebuildIdIndex"
    | "applyTemplate"
    | "isHorizontal"
    | "dom"
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
    isHorizontal,
    dom,
  } = deps;

  /** Sync height cache, content size, compression, notify handlers, re-render. */
  const syncAfterChange = (): void => {
    const hc = acc.hc();
    hc.rebuild(acc.vtf()());
    const totalHeight = hc.getTotalHeight();
    const size = `${totalHeight}px`;
    if (isHorizontal) {
      dom.content.style.width = size;
    } else {
      dom.content.style.height = size;
    }
    ctx.updateCompressionMode();
    for (let i = 0; i < contentSizeHandlers.length; i++) {
      contentSizeHandlers[i]!();
    }
    acc.ffn()(); // DOUBLE-CALL
  };

  return {
    getState: () => {
      const items = acc.it();
      return {
        total: items.length,
        cached: items.length,
        isLoading: false,
        pendingRanges: [],
        error: undefined,
        hasMore: false,
        cursor: undefined,
      };
    },
    getTotal: () => acc.it().length,
    getCached: () => acc.it().length,
    getIsLoading: () => false,
    getHasMore: () => false,
    getStorage: () => null,
    getPlaceholders: () => null,
    getItem: (index: number) => acc.it()[index],
    getItemById: (id: string | number) => {
      const idx = idToIndex.get(id);
      return idx !== undefined ? acc.it()[idx] : undefined;
    },
    getIndexById: (id: string | number) => idToIndex.get(id) ?? -1,
    isItemLoaded: (index: number) => {
      const items = acc.it();
      return index >= 0 && index < items.length && items[index] !== undefined;
    },
    getItemsInRange: (start: number, end: number) => {
      const items = acc.it();
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
      const items = acc.it();
      if (offset === 0 && (newTotal !== undefined || items.length === 0)) {
        acc.setIT([...newItems]);
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
      rebuildIdIndex();
      if (acc.ii()) syncAfterChange();
    },
    updateItem: (id: string | number, updates: Partial<T>) => {
      const items = acc.it();
      const index = idToIndex.get(id);
      if (index === undefined) return false;
      const item = items[index];
      if (!item) return false;
      items[index] = { ...item, ...updates } as T;
      if (updates.id !== undefined && updates.id !== id) {
        idToIndex.delete(id);
        idToIndex.set(updates.id, index);
      }
      rebuildIdIndex();
      const element = rendered.get(index);
      if (element && acc.ii()) {
        const result = acc.at()(items[index]!, index, itemState);
        applyTemplate(element, result);
      }
      return true;
    },
    insertItem: (item: T, index?: number) => {
      const items = acc.it();
      const idx = index ?? items.length;
      items.splice(idx, 0, item);
      rebuildIdIndex();
      if (acc.ii()) syncAfterChange();
    },
    removeItem: (id: string | number) => {
      const items = acc.it();
      const index = idToIndex.get(id);
      if (index === undefined) return false;
      items.splice(index, 1);
      if (acc.ii()) syncAfterChange();
      return true;
    },
    clear: () => {
      acc.setIT([]);
      if (acc.ii()) syncAfterChange();
    },
    fetchRange: () => Promise.resolve(),
    prefetch: () => {},
    retry: () => {},
    invalidate: () => {
      if (acc.ii()) syncAfterChange();
    },
    getLoadedRanges: () => {
      const items = acc.it();
      return items.length > 0 ? [{ start: 0, end: items.length - 1 }] : [];
    },
    on: () => () => {},
  };
};

// =============================================================================
// createDefaultScrollProxy — default scroll controller
// =============================================================================

export const createDefaultScrollProxy = <T extends VListItem = VListItem>(
  acc: MAccessors<T>,
  deps: Pick<MDeps<T>, "dom" | "classPrefix">,
): any => {
  const { dom, classPrefix } = deps;

  return {
    getScrollTop: () => acc.sgt()(), // DOUBLE-CALL
    setScrollTop: (pos: number) => {
      acc.sst()(pos);
      acc.setLS(pos);
      acc.rfn()(); // DOUBLE-CALL: renderIfNeeded
    },
    scrollTo: (pos: number) => {
      acc.sst()(pos);
      acc.setLS(pos);
      acc.rfn()(); // DOUBLE-CALL: renderIfNeeded
    },
    scrollBy: (delta: number) => {
      const newPos = acc.sgt()() + delta;
      acc.sst()(newPos);
      acc.setLS(newPos);
      acc.rfn()(); // DOUBLE-CALL: renderIfNeeded
    },
    isAtTop: (threshold = 2) => acc.ls() <= threshold,
    isAtBottom: (threshold = 2) => acc.sab()(threshold), // DOUBLE-CALL
    getScrollPercentage: () => {
      const total = acc.hc().getTotalHeight();
      const maxScroll = Math.max(0, total - acc.ch());
      return maxScroll > 0 ? acc.ls() / maxScroll : 0;
    },
    getVelocity: () => acc.vt().velocity,
    isTracking: () => {
      const MIN_RELIABLE_SAMPLES = 3;
      return acc.vt().sampleCount >= MIN_RELIABLE_SAMPLES;
    },
    isScrolling: () => dom.root.classList.contains(`${classPrefix}--scrolling`),
    updateConfig: () => {},
    enableCompression: () => {
      acc.setSIC(true);
    },
    disableCompression: () => {
      acc.setSIC(false);
    },
    isCompressed: () => acc.sic(),
    isWindowMode: () => false,
    updateContainerHeight: (h: number) => {
      acc.setCH(h);
    },
    destroy: () => {},
  };
};
