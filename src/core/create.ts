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
  CompiledHooks,
  Axis,
  AxisConfig,
} from "./types";
import { OVERSCAN, CLASS_PREFIX, SCROLL_IDLE_TIMEOUT, SCROLL_DURATION, MAX_VIRTUAL_SIZE } from "../constants";
import { resolvePadding, mainAxisPaddingFrom, crossAxisPaddingFrom } from "../utils/padding";
import { createEngineState } from "./state";
import type { EngineState } from "./state";
import { createSizeCache } from "./sizes";
import type { SizeCache } from "./sizes";
import { createPool } from "./pool";
import { createDOMStructure, resolveContainer } from "./dom";
import { createScrollHandler } from "./scroll";
import { compileHooks, runAfterScrollHooks, runIdleHooks, runResizeHooks } from "./hooks";
import { render, createRenderConfig } from "./pipeline";
import { createEmitter, type Emitter } from "../events";
import type { VListEvents } from "../types";
import { createVelocityTracker, updateVelocityTracker, MIN_RELIABLE_SAMPLES } from "./velocity";

// =============================================================================
// Config Validation
// =============================================================================

function validateConfig<T extends VListItem>(raw: CreateVListConfig<T>): void {
  const { item } = raw;

  // Validate item.height (only if explicitly provided and is a number)
  if (item.height !== undefined && typeof item.height === "number") {
    if (!Number.isFinite(item.height) || item.height <= 0) {
      throw new Error(`vlist: item.height must be a positive number, got ${item.height}`);
    }
  }

  // Validate item.width (only if explicitly provided and is a number)
  if (item.width !== undefined && typeof item.width === "number") {
    if (!Number.isFinite(item.width) || item.width <= 0) {
      throw new Error(`vlist: item.width must be a positive number, got ${item.width}`);
    }
  }

  // Validate item.estimatedHeight (only if explicitly provided)
  if (item.estimatedHeight !== undefined) {
    if (!Number.isFinite(item.estimatedHeight) || item.estimatedHeight <= 0) {
      throw new Error(`vlist: item.estimatedHeight must be a positive number, got ${item.estimatedHeight}`);
    }
  }

  // Validate item.estimatedWidth (only if explicitly provided)
  if (item.estimatedWidth !== undefined) {
    if (!Number.isFinite(item.estimatedWidth) || item.estimatedWidth <= 0) {
      throw new Error(`vlist: item.estimatedWidth must be a positive number, got ${item.estimatedWidth}`);
    }
  }

  // Validate item.gap (only if explicitly provided)
  if (item.gap !== undefined) {
    if (typeof item.gap !== "number" || !Number.isFinite(item.gap) || item.gap < 0) {
      throw new Error(`vlist: item.gap must be a non-negative number, got ${item.gap}`);
    }
  }

  // Validate overscan (only if explicitly provided)
  if (raw.overscan !== undefined) {
    if (typeof raw.overscan !== "number" || !Number.isFinite(raw.overscan) || raw.overscan < 0) {
      throw new Error(`vlist: overscan must be a non-negative number, got ${raw.overscan}`);
    }
  }
}

// =============================================================================
// Config Resolution
// =============================================================================

function resolveAxis<T extends VListItem>(
  orientation: "vertical" | "horizontal" | undefined,
  plugins: readonly VListPlugin<T>[],
): AxisConfig {
  const primary: Axis = orientation === "horizontal" ? "x" : "y";
  const hasGridPlugin = plugins.some((p) => p.name === "grid");
  if (hasGridPlugin) {
    const cross: Axis = primary === "x" ? "y" : "x";
    return { primary, cross };
  }
  return { primary };
}

function resolveConfig<T extends VListItem>(
  raw: CreateVListConfig<T>,
  plugins: readonly VListPlugin<T>[],
): ResolvedConfig {
  const axis = resolveAxis(raw.orientation, plugins);
  const isX = axis.primary === "x";
  const pad = resolvePadding(raw.padding);
  return {
    axis,
    hasCrossAxis: axis.cross !== undefined,
    overscan: raw.overscan ?? OVERSCAN,
    reverse: raw.reverse ?? false,
    classPrefix: raw.classPrefix ?? CLASS_PREFIX,
    mainAxisPadding: mainAxisPaddingFrom(pad, isX),
    crossAxisPadding: crossAxisPaddingFrom(pad, isX),
    startPadding: isX ? pad.left : pad.top,
    endPadding: isX ? pad.right : pad.bottom,
    crossPadStart: isX ? pad.top : pad.left,
    crossPadEnd: isX ? pad.bottom : pad.right,
    striped: raw.item.striped || false,
    gap: raw.item.gap ?? 0,
  };
}

function resolveSizeConfig<T extends VListItem>(
  raw: CreateVListConfig<T>,
  isX: boolean,
): number | ((index: number) => number) {
  if (isX) {
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
  // ── Validate config ─────────────────────────────────────────────

  validateConfig(rawConfig);

  // ── Resolve config ──────────────────────────────────────────────

  const config = resolveConfig(rawConfig, plugins);
  const isX = config.axis.primary === "x";
  const sizeSpec = resolveSizeConfig(rawConfig, isX);
  const gap = config.gap;
  const gappedSizeSpec: number | ((index: number) => number) = gap > 0
    ? typeof sizeSpec === "function"
      ? (index: number) => (sizeSpec as (index: number) => number)(index) + gap
      : (sizeSpec as number) + gap
    : sizeSpec;
  const minItemSize = typeof sizeSpec === "number" ? sizeSpec : 20;
  const totalItems = rawConfig.items?.length ?? 0;
  const oddClass = config.striped ? `${config.classPrefix}-item--odd` : "";
  const emitter: Emitter<VListEvents<T>> = createEmitter<VListEvents<T>>();
  const rc = createRenderConfig(
    config.classPrefix, isX,
    config.startPadding, config.crossPadStart, config.crossPadEnd,
    oddClass, gap, emitter as unknown as Emitter<VListEvents>,
  );

  // ── Sort and validate plugins ───────────────────────────────────

  const sorted = plugins.length > 0 ? sortPlugins(plugins) : plugins;
  if (plugins.length > 0) checkConflicts(sorted);

  // ── Create core components ──────────────────────────────────────

  const container = resolveContainer(rawConfig.container);
  const dom = createDOMStructure(container, config.classPrefix, isX, rawConfig.ariaLabel);

  // ── Scroll config: scrollbar & gutter CSS classes ──────────────

  const scrollbarMode = rawConfig.scroll?.scrollbar;
  if (scrollbarMode === "none") {
    dom.viewport.classList.add(`${config.classPrefix}-viewport--no-scrollbar`);
  }
  if (rawConfig.scroll?.gutter === "stable") {
    dom.viewport.classList.add(`${config.classPrefix}-viewport--gutter-stable`);
  }

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
  const _scrollEvt: { scrollPosition: number; direction: "down" | "up" | "left" | "right" } = { scrollPosition: 0, direction: "down" };
  const _idleEvt: { scrollPosition: number } = { scrollPosition: 0 };
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
  let getIndexByIdFn: ((id: string | number) => number) | null = null;
  let skipDefaultScroll = false;
  let skipDefaultResize = false;
  let scrollTarget: EventTarget | null = null;
  let navUd = 0;
  let navLr = 0;
  let navScrollIndexFn: ((itemIndex: number) => number) | null = null;
  let navNavigateFn: ((currentIndex: number, key: string, total: number) => number) | null = null;
  let smoothScrollFn: ((target: number | (() => number), duration: number, setFn?: (pos: number) => void, easing?: (t: number) => number, onComplete?: () => void) => void) | null = null;
  let scrollToPosFn: ((index: number, sizeCache: SizeCache, containerSize: number, totalItems: number, align: string) => number) | null = null;
  let scrollToIndexFn: ((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false) | null = null;

  // ── Pre-initialize container size so plugins can read it ────────

  state.containerSize = isX ? dom.viewport.clientWidth : dom.viewport.clientHeight;
  state.crossSize = isX ? dom.viewport.clientHeight : dom.viewport.clientWidth;

  // ── Run plugin setup (cold path) ────────────────────────────────

  if (plugins.length > 0) {
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
      enableListboxRole(): void {
        const currentRole = dom.content.getAttribute("role");
        if (!currentRole || currentRole === "list") {
          dom.content.setAttribute("role", "listbox");
          dom.content.setAttribute("tabindex", "0");
        }
        rc.itemRole = "option";
        rc.interactive = true;
      },
      setSizeConfig(sc: number | ((index: number) => number)): void {
        const newCache = createSizeCache(sc, state.totalItems);
        // Assign all new cache methods. Any plugin that hooked rebuild
        // (grid, groups) must re-install its hook after calling setSizeConfig
        // — see grid/plugin.ts installRebuildHook().
        Object.assign(sizeCache, newCache);
      },
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
        state.totalSize = size;
        dom.content.style[isX ? "width" : "height"] = (size + config.mainAxisPadding) + "px";
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
        else if (isX) dom.viewport.scrollLeft = position;
        else dom.viewport.scrollTop = position;
      },
      smoothScrollTo(target: number | (() => number), duration: number, easing?: (t: number) => number, onComplete?: () => void): void {
        if (smoothScrollFn) smoothScrollFn(target, duration, scrollSetFn ?? undefined, easing, onComplete);
        else ctx.scrollTo(typeof target === "function" ? target() : target);
      },
      disableDefaultScroll(): void { skipDefaultScroll = true; },
      disableDefaultResize(): void { skipDefaultResize = true; },
      setScrollTarget(target: EventTarget): void { scrollTarget = target; },
      setScrollToPosFn(fn: (index: number, sc: SizeCache, containerSize: number, totalItems: number, align: string) => number): void { scrollToPosFn = fn; },
      setScrollToIndexFn(fn: (index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false): void { scrollToIndexFn = fn; },
      onScrollFrame: doScrollFrame,
      onScrollIdle: doScrollIdle,
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
      setGetIndexByIdFn(fn: (id: string | number) => number): void { getIndexByIdFn = fn; },
      getRenderedElement(index: number): HTMLElement | null {
        const override = methods.get("_getRenderedElement") as ((i: number) => HTMLElement | null) | undefined;
        if (override) return override(index);
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

    for (const plugin of sorted) {
      if (plugin.setup) {
        try {
          plugin.setup(ctx);
        } catch (err) {
          emitter.emit("error", {
            error: err instanceof Error ? err : new Error(String(err)),
            context: `plugin:setup:${plugin.name}`,
          });
        }
      }
    }
  }

  // ── Scrolling class toggle ──────────────────────────────────────

  const scrollingClass = config.classPrefix + "--scrolling";
  let isScrolling = false;

  // ── Render function ─────────────────────────────────────────────

  const idleTimeout = rawConfig.scroll?.idleTimeout ?? SCROLL_IDLE_TIMEOUT;

  function emitScrollEvents(): void {
    _scrollEvt.scrollPosition = state.scrollPosition;
    if (isX) {
      _scrollEvt.direction = state.scrollDirection > 0 ? "right" : "left";
    } else {
      _scrollEvt.direction = state.scrollDirection > 0 ? "down" : "up";
    }
    emitter.emit("scroll", _scrollEvt);

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

  let sizeWarningEmitted = false;

  function syncContentSize(): void {
    if (customRenderIfNeeded) return;
    const totalSize = sizeCache.getTotalSize();
    dom.content.style[isX ? "width" : "height"] = (totalSize + config.mainAxisPadding) + "px";

    if (!sizeWarningEmitted && totalSize > MAX_VIRTUAL_SIZE) {
      sizeWarningEmitted = true;
      emitter.emit("error", {
        error: new Error(`Content size (${totalSize}px) exceeds browser limit (${MAX_VIRTUAL_SIZE}px). Use the scale() plugin for large datasets.`),
        context: "content:size:overflow",
      });
    }
  }

  function doRender(): void {
    if (customRenderIfNeeded) {
      customRenderIfNeeded();
    } else {
      render(state, sizeCache, config.overscan, pool, dom.content, rawConfig.item.template, getItems, rendered, rc, hooks, getItemFn, itemStateFn);
    }
  }

  function doScrollFrame(): void {
    if (!isScrolling) {
      isScrolling = true;
      dom.root.classList.add(scrollingClass);
    }
    doRender();
    runAfterScrollHooks(hooks.afterScroll, state.scrollPosition, state.scrollDirection);
    if (state.scrollPosition !== lastEventScrollPos) {
      lastEventScrollPos = state.scrollPosition;
      emitScrollEvents();
    }
  }

  function doScrollIdle(): void {
    if (isScrolling) {
      isScrolling = false;
      dom.root.classList.remove(scrollingClass);
    }
    state.scrollDirection = 0;
    runIdleHooks(hooks.idle);
    _velEvt.velocity = 0;
    _velEvt.reliable = false;
    emitter.emit("velocity:change", _velEvt);
    _idleEvt.scrollPosition = state.scrollPosition;
    emitter.emit("scroll:idle", _idleEvt);
  }

  function doForceRender(): void {
    state.renderPending = true;
    if (customForceRender) {
      customForceRender();
    } else {
      render(state, sizeCache, config.overscan, pool, dom.content, rawConfig.item.template, getItems, rendered, rc, hooks, getItemFn, itemStateFn);
    }
    runAfterScrollHooks(hooks.afterScroll, state.scrollPosition, state.scrollDirection);

    if (state.scrollPosition !== lastEventScrollPos) {
      lastEventScrollPos = state.scrollPosition;
      emitScrollEvents();

      if (forceIdleTimer !== null) clearTimeout(forceIdleTimer);
      forceIdleTimer = setTimeout(doScrollIdle, idleTimeout);
    }
  }

  // ── Scroll handler ──────────────────────────────────────────────

  const scrollHandler = createScrollHandler({
    state,
    viewport: dom.viewport,
    isX,
    wheelEnabled: skipDefaultScroll ? false : rawConfig.scroll?.wheel !== false,
    idleTimeout: rawConfig.scroll?.idleTimeout ?? SCROLL_IDLE_TIMEOUT,
    ...(scrollTarget ? { scrollTarget } : {}),
    onFrame: doScrollFrame,
    onIdle: doScrollIdle,
  });

  smoothScrollFn = scrollHandler.smoothScrollTo;

  // ── Event listeners ─────────────────────────────────────────────

  function resolveClickedItem(e: MouseEvent): { item: T; index: number } | null {
    const target = e.target as HTMLElement;
    const itemEl = target.closest("[data-index]") as HTMLElement | null;
    if (!itemEl) return null;
    const layoutIndex = parseInt(itemEl.getAttribute("data-index")!, 10);
    if (Number.isNaN(layoutIndex)) return null;

    // When groups plugin is active, data-index is a layout index (includes
    // group headers). Map it to the data index so we return the correct item.
    // Group headers map to -1 → ignore the click.
    // Use _getItem (data plugin, always takes data indices) when available
    // to avoid double-mapping — getItemFn may already be layout-aware
    // (groups plugin in table mode).
    const layoutToData = methods.get("_layoutToDataIndex") as ((i: number) => number) | undefined;
    let item: T | undefined;
    if (layoutToData) {
      const dataIndex = layoutToData(layoutIndex);
      if (dataIndex < 0) return null;
      const getDataItem = methods.get("_getItem") as ((i: number) => T | undefined) | undefined;
      item = getDataItem ? getDataItem(dataIndex) : (getItemFn ? getItemFn(dataIndex) : items[dataIndex]);
    } else {
      item = getItemFn ? getItemFn(layoutIndex) : items[layoutIndex];
    }
    if (item === undefined) return null;
    return { item, index: layoutIndex };
  }

  function onContentClick(e: MouseEvent): void {
    for (let i = 0; i < clickHandlers.length; i++) clickHandlers[i]!(e);

    const hit = resolveClickedItem(e);
    if (hit) emitter.emit("item:click", { item: hit.item, index: hit.index, event: e });
  }

  function onContentDblClick(e: MouseEvent): void {
    const hit = resolveClickedItem(e);
    if (hit) emitter.emit("item:dblclick", { item: hit.item, index: hit.index, event: e });
  }

  function onContentContextMenu(e: MouseEvent): void {
    const hit = resolveClickedItem(e);
    if (hit) emitter.emit("item:contextmenu", { item: hit.item, index: hit.index, event: e });
  }

  function onContentKeydown(e: KeyboardEvent): void {
    // Don't intercept keystrokes aimed at embedded form controls (e.g. the
    // search input). Those elements handle their own keyboard input; only
    // Ctrl/Cmd+F (open search) should pass through.
    const tag = (e.target as HTMLElement)?.tagName;
    if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") &&
        !((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F"))) {
      return;
    }
    for (let i = 0; i < keydownHandlers.length; i++) keydownHandlers[i]!(e);
  }

  dom.content.addEventListener("click", onContentClick);
  dom.content.addEventListener("dblclick", onContentDblClick);
  dom.content.addEventListener("contextmenu", onContentContextMenu);
  if (keydownHandlers.length > 0) dom.root.addEventListener("keydown", onContentKeydown);

  // ── ResizeObserver ──────────────────────────────────────────────

  let resizeObserver: ResizeObserver | null = null;
  if (!skipDefaultResize) {
    const initObserver = (): void => {
      if (state.destroyed) return;
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          const size = isX ? width : height;
          const cross = isX ? height : width;

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
    };
    setTimeout(initObserver, 0);
  }

  // ── Initialize ──────────────────────────────────────────────────

  state.resizeCapacity(state.containerSize, minItemSize, config.overscan);

  syncContentSize();
  state.initialized = true;
  let initialRafId: number | null = null;
  if (rawConfig.defer) {
    initialRafId = requestAnimationFrame(() => {
      initialRafId = null;
      if (!state.destroyed) doRender();
    });
  } else {
    doRender();
  }

  if (!skipDefaultScroll) scrollHandler.attach();

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
      return getItemFn ? getItemFn(index) : items[index];
    },

    getIndexById(id: string | number): number {
      if (getIndexByIdFn) return getIndexByIdFn(id);
      return items.findIndex((item) => item.id === id);
    },

    scrollToIndex(
      index: number,
      alignOrOptions: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number; easing?: (t: number) => number } = "start",
    ): void {
      const total = virtualTotalFn ? virtualTotalFn() : items.length;
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(index, total - 1));

      const align = typeof alignOrOptions === "string" ? alignOrOptions : (alignOrOptions.align ?? "start");
      const behavior = typeof alignOrOptions === "object" ? alignOrOptions.behavior : undefined;
      const duration = typeof alignOrOptions === "object" ? alignOrOptions.duration : undefined;
      const easing = typeof alignOrOptions === "object" ? alignOrOptions.easing : undefined;

      if (scrollToIndexFn && scrollToIndexFn(clamped, align, behavior, duration, easing) !== false) {
        return;
      }

      const offset = sizeCache.getOffset(clamped);
      const itemSize = sizeCache.getSize(clamped);
      const cs = state.containerSize;
      const totalSize = sizeCache.getTotalSize();
      const mp = config.mainAxisPadding;
      const maxScroll = Math.max(0, totalSize + mp - cs);

      let pos: number;
      if (scrollToPosFn) {
        pos = scrollToPosFn(clamped, sizeCache, cs, total, align);
      } else {
        const sp = config.startPadding;
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
      }

      if (behavior === "smooth") {
        scrollHandler.smoothScrollTo(pos, duration ?? SCROLL_DURATION, scrollSetFn ?? undefined, easing);
      } else if (scrollSetFn) {
        scrollSetFn(pos);
      } else {
        if (isX) dom.viewport.scrollLeft = pos;
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

      if (isScrolling) {
        isScrolling = false;
        dom.root.classList.remove(scrollingClass);
      }
      if (initialRafId !== null) { cancelAnimationFrame(initialRafId); initialRafId = null; }
      if (forceIdleTimer !== null) { clearTimeout(forceIdleTimer); forceIdleTimer = null; }
      scrollHandler.detach();
      resizeObserver?.disconnect();
      dom.content.removeEventListener("click", onContentClick);
      dom.content.removeEventListener("dblclick", onContentDblClick);
      dom.content.removeEventListener("contextmenu", onContentContextMenu);
      dom.root.removeEventListener("keydown", onContentKeydown);

      const destroyErrors: Error[] = [];
      for (const handler of destroyHandlers) {
        try {
          handler();
        } catch (err) {
          destroyErrors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }
      for (const plugin of sorted) {
        if (plugin.destroy) {
          try {
            plugin.destroy();
          } catch (err) {
            destroyErrors.push(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      for (const [, element] of rendered) {
        element.remove();
      }
      rendered.clear();
      pool.clear();

      dom.root.remove();
      emitter.emit("destroy", undefined as any);
      emitter.clear();

      if (destroyErrors.length > 0) {
        for (const err of destroyErrors) {
          console.error("vlist: error during destroy:", err);
        }
      }
    },
  };

  // ── Attach plugin-registered methods ────────────────────────────

  for (const [name, fn] of methods) {
    (api as Record<string, unknown>)[name] = fn;
  }

  return api;
}
