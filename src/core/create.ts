/**
 * vlist v2 — createVList()
 *
 * Factory function. Resolves config, creates DOM, compiles hooks from
 * plugins, wires the 2-phase pipeline, returns the public VList API.
 */

import type { VListItem } from "../types";
import type {
  CreateVListConfig,
  VListPlugin,
  VList,
  PluginContext,
  ResolvedConfig,
  VisibleRangeFn,
  CompiledHooks,
} from "./types";
import { OVERSCAN, CLASS_PREFIX, SCROLL_IDLE_TIMEOUT } from "../constants";
import { resolvePadding, mainAxisPaddingFrom, crossAxisPaddingFrom } from "../utils/padding";
import { createEngineState } from "./state";
import type { EngineState } from "./state";
import { createSizeCache } from "./sizes";
import type { SizeCache } from "./sizes";
import { createPool } from "./pool";
import { createDOMStructure, resolveContainer } from "./dom";
import { createScrollHandler } from "./scroll";
import { compileHooks, runAfterScrollHooks, runIdleHooks, runResizeHooks } from "./hooks";
import { render } from "./pipeline";
import { createEmitter, type Emitter } from "../events";
import type { VListEvents } from "../types";
import { createVelocityTracker, updateVelocityTracker, MIN_RELIABLE_SAMPLES } from "./velocity";

// =============================================================================
// Config Resolution
// =============================================================================

function resolveConfig<T extends VListItem>(raw: CreateVListConfig<T>): ResolvedConfig {
  const horizontal = raw.orientation === "horizontal";
  const pad = resolvePadding(raw.padding);
  return {
    overscan: raw.overscan ?? OVERSCAN,
    horizontal,
    reverse: raw.reverse ?? false,
    classPrefix: raw.classPrefix ?? CLASS_PREFIX,
    interactive: raw.interactive ?? true,
    mainAxisPadding: mainAxisPaddingFrom(pad, horizontal),
    crossAxisPadding: crossAxisPaddingFrom(pad, horizontal),
    startPadding: horizontal ? pad.left : pad.top,
    endPadding: horizontal ? pad.right : pad.bottom,
    crossPadStart: horizontal ? pad.top : pad.left,
    crossPadEnd: horizontal ? pad.bottom : pad.right,
    striped: raw.item.striped || false,
    gap: raw.item.gap ?? 0,
  };
}

function resolveSizeConfig<T extends VListItem>(
  raw: CreateVListConfig<T>,
  horizontal: boolean,
): number | ((index: number) => number) {
  if (horizontal) {
    return raw.item.width ?? raw.item.estimatedWidth ?? 100;
  }
  return raw.item.height ?? raw.item.estimatedHeight ?? 40;
}

// =============================================================================
// Plugin Sorting
// =============================================================================

function sortPlugins<T extends VListItem>(plugins: readonly VListPlugin<T>[]): VListPlugin<T>[] {
  const sorted = [...plugins];
  sorted.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  return sorted;
}

function checkConflicts<T extends VListItem>(plugins: readonly VListPlugin<T>[]): void {
  const names = new Set<string>();
  for (const p of plugins) {
    if (names.has(p.name)) {
      throw new Error(`[vlist] Duplicate plugin: ${p.name}`);
    }
    names.add(p.name);
  }
  for (const p of plugins) {
    if (p.conflicts) {
      for (const c of p.conflicts) {
        if (names.has(c)) {
          throw new Error(`[vlist] Plugin "${p.name}" conflicts with "${c}"`);
        }
      }
    }
  }
}

// =============================================================================
// createVList()
// =============================================================================

export function createVList<T extends VListItem = VListItem>(
  rawConfig: CreateVListConfig<T>,
  plugins: VListPlugin<T>[] = [],
): VList<T> {
  // ── Resolve config ──────────────────────────────────────────────

  const config = resolveConfig(rawConfig);
  const sizeSpec = resolveSizeConfig(rawConfig, config.horizontal);
  const gap = config.gap;
  const gappedSizeSpec: number | ((index: number) => number) = gap > 0
    ? typeof sizeSpec === "function"
      ? (index: number) => (sizeSpec as (index: number) => number)(index) + gap
      : (sizeSpec as number) + gap
    : sizeSpec;
  const minItemSize = typeof sizeSpec === "number" ? sizeSpec : 20;
  const totalItems = rawConfig.items?.length ?? 0;
  const oddClass = config.striped ? `${config.classPrefix}-item--odd` : "";

  // ── Sort and validate plugins ───────────────────────────────────

  const sorted = sortPlugins(plugins);
  checkConflicts(sorted);

  // ── Create core components ──────────────────────────────────────

  const container = resolveContainer(rawConfig.container);
  const dom = createDOMStructure(container, config.classPrefix, config.horizontal, config.interactive, rawConfig.ariaLabel);

  // Padding is handled via transform offsets (main axis) and inline
  // left/right or top/bottom (cross axis) in the pipeline, since items
  // are position:absolute and CSS padding on the container has no effect.
  const sizeCache: SizeCache = createSizeCache(gappedSizeSpec, totalItems);
  if (gap > 0) {
    const origGetTotalSize = sizeCache.getTotalSize;
    sizeCache.getTotalSize = (): number => {
      const total = origGetTotalSize();
      return total > 0 ? total - gap : 0;
    };
  }
  const pool = createPool(config.classPrefix);
  const emitter: Emitter<VListEvents<T>> = createEmitter<VListEvents<T>>();

  // ── Initialize engine state ─────────────────────────────────────

  const initialCapacity = Math.ceil(4096 / minItemSize) + config.overscan * 2 + 8;
  const state = createEngineState(initialCapacity);
  state.totalItems = totalItems;

  // ── Items storage ───────────────────────────────────────────────

  let items: T[] = rawConfig.items ?? [];
  const getItems = (): readonly T[] => items;

  // ── Rendered elements tracking ──────────────────────────────────

  const rendered = new Map<number, HTMLElement>();

  // ── Velocity tracking & range:change state ─────────────────────

  const velocityTracker = createVelocityTracker();
  const _velEvt = { velocity: 0, reliable: false };
  const _rangeEvt = { range: { start: 0, end: -1 } };
  let prevEmittedStart = -1;
  let prevEmittedEnd = -1;
  let lastEventScrollPos = -1;
  let forceIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Compile hooks from plugins ──────────────────────────────────

  const hooks: CompiledHooks = compileHooks(sorted);

  // ── Plugin context (cold path) ──────────────────────────────────

  const methods = new Map<string, Function>();
  const clickHandlers: Array<(e: MouseEvent) => void> = [];
  const keydownHandlers: Array<(e: KeyboardEvent) => void> = [];
  const destroyHandlers: Array<() => void> = [];
  let virtualTotalFn: (() => number) | null = null;
  let scrollGetFn: (() => number) | null = null;
  let scrollSetFn: ((pos: number) => void) | null = null;
  let customRenderIfNeeded: (() => void) | null = null;
  let customForceRender: (() => void) | null = null;
  let getItemFn: ((index: number) => T | undefined) | null = null;
  let itemStateFn: ((index: number, state: import("../types").ItemState) => void) | null = null;
  let removeItemByIdFn: ((id: string | number) => number) | null = null;
  let insertItemAtFn: ((item: T, index: number) => void) | null = null;
  let updateItemByIdFn: ((id: string | number, updates: Partial<T>) => boolean) | null = null;
  let skipDefaultScroll = false;
  let skipDefaultResize = false;
  let scrollTarget: EventTarget | null = null;
  let navUd = 0;
  let navLr = 0;
  let navScrollIndexFn: ((itemIndex: number) => number) | null = null;
  let navNavigateFn: ((currentIndex: number, key: string, total: number) => number) | null = null;
  let smoothScrollFn: ((target: number, duration: number) => void) | null = null;

  const ctx: PluginContext<T> = {
    dom,
    sizeCache,
    pool,
    config,
    emitter,
    template: rawConfig.item.template,
    registerMethod(name: string, fn: Function): void { methods.set(name, fn); },
    getMethod(name: string): Function | undefined { return methods.get(name); },
    registerClickHandler(handler: (e: MouseEvent) => void): void { clickHandlers.push(handler); },
    registerKeydownHandler(handler: (e: KeyboardEvent) => void): void { keydownHandlers.push(handler); },
    registerDestroyHandler(handler: () => void): void { destroyHandlers.push(handler); },
    setSizeConfig(sc: number | ((index: number) => number)): void {
      const newCache = createSizeCache(sc, state.totalItems);
      Object.assign(sizeCache, newCache);
    },
    setVisibleRangeFn(_fn: VisibleRangeFn): void { /* wired in Phase B when scale plugin consumes it */ },
    setScrollFns(get: () => number, set: (pos: number) => void): void {
      scrollGetFn = get;
      scrollSetFn = set;
    },
    setVirtualTotalFn(fn: () => number): void { virtualTotalFn = fn; },
    getItems,
    getItem(index: number): T | undefined {
      return getItemFn ? getItemFn(index) : items[index];
    },
    getState(): EngineState { return state; },
    rebuildSizeCache(): void {
      sizeCache.rebuild(state.totalItems);
    },
    updateContentSize(size: number): void {
      dom.content.style[config.horizontal ? "width" : "height"] = (size + config.mainAxisPadding) + "px";
    },
    setRenderFn(renderFn: () => void, forceFn: () => void): void {
      customRenderIfNeeded = renderFn;
      customForceRender = forceFn;
    },
    renderIfNeeded(): void { doRender(); },
    forceRender(): void {
      doForceRender();
    },
    setGetItemFn(fn: (index: number) => T | undefined): void { getItemFn = fn; },
    setItemStateFn(fn: (index: number, st: import("../types").ItemState) => void): void { itemStateFn = fn; },
    getItemStateFn(): ((index: number, st: import("../types").ItemState) => void) | null { return itemStateFn; },
    get rawSizeSpec() { return sizeSpec; },
    scrollTo(position: number): void {
      if (scrollSetFn) scrollSetFn(position);
      else if (config.horizontal) dom.viewport.scrollLeft = position;
      else dom.viewport.scrollTop = position;
    },
    smoothScrollTo(position: number, duration: number): void {
      if (smoothScrollFn) smoothScrollFn(position, duration);
      else ctx.scrollTo(position);
    },
    disableDefaultScroll(): void { skipDefaultScroll = true; },
    disableDefaultResize(): void { skipDefaultResize = true; },
    setScrollTarget(target: EventTarget): void { scrollTarget = target; },
    removeItemById(id: string | number): number {
      if (removeItemByIdFn) return removeItemByIdFn(id);
      const idx = items.findIndex((item) => item.id === id);
      if (idx === -1) return -1;
      items.splice(idx, 1);
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
      return idx;
    },
    insertItemAt(item: T, index: number): void {
      if (insertItemAtFn) { insertItemAtFn(item, index); return; }
      items.splice(index, 0, item);
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
    },
    setRemoveItemFn(fn: (id: string | number) => number): void { removeItemByIdFn = fn; },
    setInsertItemFn(fn: (item: T, index: number) => void): void { insertItemAtFn = fn; },
    setUpdateItemFn(fn: (id: string | number, updates: Partial<T>) => boolean): void { updateItemByIdFn = fn; },
    getRenderedElement(index: number): HTMLElement | null {
      return rendered.get(index) ?? null;
    },
    setNavConfig(cfg: { total?: () => number; ud?: number; lr?: number; scrollIndex?: (itemIndex: number) => number; navigate?: (currentIndex: number, key: string, total: number) => number }): void {
      if (cfg.ud !== undefined) navUd = cfg.ud;
      if (cfg.lr !== undefined) navLr = cfg.lr;
      if (cfg.scrollIndex) navScrollIndexFn = cfg.scrollIndex;
      if (cfg.navigate) navNavigateFn = cfg.navigate;
    },
    getNavConfig: (() => {
      const _nav = { ud: 0, lr: 0, scrollIndex: null as ((itemIndex: number) => number) | null, navigate: null as ((currentIndex: number, key: string, total: number) => number) | null };
      return (): typeof _nav => {
        _nav.ud = navUd;
        _nav.lr = navLr;
        _nav.scrollIndex = navScrollIndexFn;
        _nav.navigate = navNavigateFn;
        return _nav;
      };
    })(),
  };

  // ── Pre-initialize container size so plugins can read it ────────

  state.containerSize = config.horizontal ? dom.viewport.clientWidth : dom.viewport.clientHeight;
  state.crossSize = config.horizontal ? dom.viewport.clientHeight : dom.viewport.clientWidth;

  // ── Run plugin setup (cold path) ────────────────────────────────

  for (const plugin of sorted) {
    if (plugin.setup) {
      plugin.setup(ctx);
    }
  }

  // ── Render function ─────────────────────────────────────────────

  const idleTimeout = rawConfig.scroll?.idleTimeout ?? SCROLL_IDLE_TIMEOUT;

  function emitScrollEvents(): void {
    emitter.emit("scroll", { scrollPosition: state.scrollPosition, direction: state.scrollDirection > 0 ? "down" : "up" });

    updateVelocityTracker(velocityTracker, state.scrollPosition);
    _velEvt.velocity = velocityTracker.velocity;
    _velEvt.reliable = velocityTracker.sampleCount >= MIN_RELIABLE_SAMPLES;
    emitter.emit("velocity:change", _velEvt);

    if (state.startIndex !== prevEmittedStart || state.prevRangeEnd !== prevEmittedEnd) {
      prevEmittedStart = state.startIndex;
      prevEmittedEnd = state.prevRangeEnd;
      _rangeEvt.range.start = state.startIndex;
      _rangeEvt.range.end = state.prevRangeEnd;
      emitter.emit("range:change", _rangeEvt);
    }
  }

  function syncContentSize(): void {
    if (customRenderIfNeeded) return;
    dom.content.style[config.horizontal ? "width" : "height"] = (sizeCache.getTotalSize() + config.mainAxisPadding) + "px";
  }

  function doRender(): void {
    if (customRenderIfNeeded) {
      customRenderIfNeeded();
    } else {
      render(state, sizeCache, config.overscan, pool, dom.content, rawConfig.item.template, getItems, rendered, config.horizontal, hooks, getItemFn, itemStateFn, config.classPrefix, config.interactive, config.startPadding, config.crossPadStart, config.crossPadEnd, oddClass, gap);
    }
  }

  function doForceRender(): void {
    state.renderPending = true;
    if (customForceRender) {
      customForceRender();
    } else {
      render(state, sizeCache, config.overscan, pool, dom.content, rawConfig.item.template, getItems, rendered, config.horizontal, hooks, getItemFn, itemStateFn, config.classPrefix, config.interactive, config.startPadding, config.crossPadStart, config.crossPadEnd, oddClass, gap);
    }
    runAfterScrollHooks(hooks.afterScroll, state.scrollPosition, state.scrollDirection);

    if (state.scrollPosition !== lastEventScrollPos) {
      lastEventScrollPos = state.scrollPosition;
      emitScrollEvents();

      if (forceIdleTimer !== null) clearTimeout(forceIdleTimer);
      forceIdleTimer = setTimeout(() => {
        forceIdleTimer = null;
        state.scrollDirection = 0;
        runIdleHooks(hooks.idle);
        _velEvt.velocity = 0;
        _velEvt.reliable = false;
        emitter.emit("velocity:change", _velEvt);
        emitter.emit("scroll:idle", { scrollPosition: state.scrollPosition });
      }, idleTimeout);
    }
  }

  // ── Scroll handler ──────────────────────────────────────────────

  const scrollHandler = createScrollHandler({
    state,
    viewport: dom.viewport,
    horizontal: config.horizontal,
    wheelEnabled: skipDefaultScroll ? false : rawConfig.scroll?.wheel !== false,
    idleTimeout: rawConfig.scroll?.idleTimeout ?? SCROLL_IDLE_TIMEOUT,
    ...(scrollTarget ? { scrollTarget } : {}),
    onFrame(): void {
      doRender();
      runAfterScrollHooks(hooks.afterScroll, state.scrollPosition, state.scrollDirection);
      lastEventScrollPos = state.scrollPosition;
      emitScrollEvents();
    },
    onIdle(): void {
      runIdleHooks(hooks.idle);
      _velEvt.velocity = 0;
      _velEvt.reliable = false;
      emitter.emit("velocity:change", _velEvt);
      emitter.emit("scroll:idle", { scrollPosition: state.scrollPosition });
    },
  });

  smoothScrollFn = scrollHandler.smoothScrollTo;

  // ── Event listeners ─────────────────────────────────────────────

  function resolveClickedItem(e: MouseEvent): { item: T; index: number } | null {
    const target = e.target as HTMLElement;
    const itemEl = target.closest("[data-index]") as HTMLElement | null;
    if (!itemEl) return null;
    const index = parseInt(itemEl.getAttribute("data-index")!, 10);
    if (Number.isNaN(index)) return null;
    const item = items[index];
    if (item === undefined) return null;
    return { item, index };
  }

  function onContentClick(e: MouseEvent): void {
    for (let i = 0; i < clickHandlers.length; i++) clickHandlers[i]!(e);

    const hit = resolveClickedItem(e);
    if (hit) emitter.emit("item:click", { item: hit.item, index: hit.index, event: e });
  }

  function onContentKeydown(e: KeyboardEvent): void {
    for (let i = 0; i < keydownHandlers.length; i++) keydownHandlers[i]!(e);
  }

  dom.content.addEventListener("click", onContentClick);
  if (keydownHandlers.length > 0) dom.content.addEventListener("keydown", onContentKeydown);

  // ── ResizeObserver ──────────────────────────────────────────────

  let resizeObserver: ResizeObserver | null = null;
  if (!skipDefaultResize) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const size = config.horizontal ? width : height;
        const cross = config.horizontal ? height : width;

        if (Math.abs(size - state.containerSize) < 1 && Math.abs(cross - state.crossSize) < 1) continue;

        state.containerSize = size;
        state.crossSize = cross;
        state.resizeCapacity(size, minItemSize, config.overscan);
        doForceRender();
        runResizeHooks(hooks.resize, width, height);
        emitter.emit("resize", { width, height });
      }
    });
    resizeObserver.observe(dom.viewport);
  }

  // ── Initialize ──────────────────────────────────────────────────

  if (!skipDefaultScroll) scrollHandler.attach();
  if (!skipDefaultResize) {
    state.containerSize = config.horizontal ? dom.viewport.clientWidth : dom.viewport.clientHeight;
    state.crossSize = config.horizontal ? dom.viewport.clientHeight : dom.viewport.clientWidth;
  }
  state.resizeCapacity(state.containerSize, minItemSize, config.overscan);

  // Set content height for scrollbar
  syncContentSize();

  state.initialized = true;
  doRender();

  // ── Public API ──────────────────────────────────────────────────

  const api: VList<T> = {
    get element(): HTMLElement { return dom.root; },
    get items(): readonly T[] { return items; },
    get total(): number { return virtualTotalFn ? virtualTotalFn() : items.length; },

    setItems(newItems: T[]): void {
      items = [...newItems];
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
      doForceRender();
    },

    appendItems(newItems: T[]): void {
      items.push(...newItems);
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
      doForceRender();
    },

    prependItems(newItems: T[]): void {
      items.unshift(...newItems);
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
      doForceRender();
    },

    updateItem(id: string | number, updates: Partial<T>): void {
      if (updateItemByIdFn) {
        if (!updateItemByIdFn(id, updates)) return;
      } else {
        const idx = items.findIndex((item) => item.id === id);
        if (idx === -1) return;
        items[idx] = { ...items[idx]!, ...updates };
      }
      doForceRender();
    },

    insertItem(item: T, index?: number): void {
      if (insertItemAtFn) {
        insertItemAtFn(item, index ?? state.totalItems);
      } else {
        if (index === undefined) {
          items.push(item);
        } else {
          items.splice(index, 0, item);
        }
        state.totalItems = items.length;
        sizeCache.rebuild(state.totalItems);
        syncContentSize();
      }
      doForceRender();
    },

    removeItem(id: string | number): void {
      if (removeItemByIdFn) {
        if (removeItemByIdFn(id) < 0) return;
      } else {
        const idx = items.findIndex((item) => item.id === id);
        if (idx === -1) return;
        items.splice(idx, 1);
        state.totalItems = items.length;
        sizeCache.rebuild(state.totalItems);
        syncContentSize();
      }
      doForceRender();
    },

    removeItems(ids: ReadonlyArray<string | number>): number {
      if (removeItemByIdFn) {
        let removed = 0;
        for (const id of ids) {
          if (removeItemByIdFn(id) >= 0) removed++;
        }
        if (removed > 0) doForceRender();
        return removed;
      }
      const idSet = new Set(ids);
      const before = items.length;
      items = items.filter((item) => !idSet.has(item.id));
      const removed = before - items.length;
      if (removed > 0) {
        state.totalItems = items.length;
        sizeCache.rebuild(state.totalItems);
        syncContentSize();
        state.renderPending = true;
        doRender();
      }
      return removed;
    },

    getItemAt(index: number): T | undefined {
      return items[index];
    },

    getIndexById(id: string | number): number {
      return items.findIndex((item) => item.id === id);
    },

    scrollToIndex(
      index: number,
      alignOrOptions: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number } = "start",
    ): void {
      const total = virtualTotalFn ? virtualTotalFn() : items.length;
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(index, total - 1));
      const offset = sizeCache.getOffset(clamped);
      const itemSize = sizeCache.getSize(clamped);
      const cs = state.containerSize;
      const totalSize = sizeCache.getTotalSize();
      const mp = config.mainAxisPadding;
      const maxScroll = Math.max(0, totalSize + mp - cs);

      const align = typeof alignOrOptions === "string" ? alignOrOptions : (alignOrOptions.align ?? "start");
      const behavior = typeof alignOrOptions === "object" ? alignOrOptions.behavior : undefined;
      const duration = typeof alignOrOptions === "object" ? alignOrOptions.duration : undefined;

      const sp = config.startPadding;
      let pos: number;
      switch (align) {
        case "center":
          pos = sp + offset - (cs - itemSize) / 2;
          break;
        case "end":
          pos = offset + itemSize + mp - cs;
          break;
        default:
          pos = offset;
      }
      pos = Math.max(0, Math.min(pos, maxScroll));

      if (scrollSetFn) {
        scrollSetFn(pos);
      } else if (behavior === "smooth" && duration && duration > 0) {
        scrollHandler.smoothScrollTo(pos, duration);
      } else {
        if (config.horizontal) dom.viewport.scrollLeft = pos;
        else dom.viewport.scrollTop = pos;
      }
    },

    getScrollPosition(): number {
      return scrollGetFn ? scrollGetFn() : state.scrollPosition;
    },

    on: emitter.on.bind(emitter) as VList<T>["on"],
    off: emitter.off.bind(emitter) as VList<T>["off"],

    destroy(): void {
      if (state.destroyed) return;
      state.destroyed = true;

      if (forceIdleTimer !== null) { clearTimeout(forceIdleTimer); forceIdleTimer = null; }
      scrollHandler.detach();
      resizeObserver?.disconnect();
      dom.content.removeEventListener("click", onContentClick);
      dom.content.removeEventListener("keydown", onContentKeydown);

      for (const handler of destroyHandlers) handler();
      for (const plugin of sorted) {
        if (plugin.destroy) plugin.destroy();
      }

      for (const [, element] of rendered) {
        element.remove();
      }
      rendered.clear();
      pool.clear();

      dom.root.remove();
      emitter.emit("destroy", undefined as any);
      emitter.clear();
    },
  };

  // ── Attach plugin-registered methods ────────────────────────────

  for (const [name, fn] of methods) {
    (api as Record<string, unknown>)[name] = fn;
  }

  return api;
}
