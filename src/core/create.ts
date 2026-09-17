/**
 * vlist — createVList()
 *
 * Factory function. Resolves config, creates DOM, compiles hooks from
 * plugins, wires the 2-phase pipeline, returns the public VList API.
 */

import { createScrollHandler } from "./scroll";
import type { VListItem } from "../types";
import type {
  CreateVListConfig,
  PluginMethods,
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
import { createScrollSource } from "./scroll-source";
import type { BoundedScrollHandler, BoundedScrollConfig, WrapConfig } from "./runway";
import type { ScrollHandler, ScrollHandlerConfig } from "./scroll";
import { createScrollAdapter, type ScrollAdapter } from "./adapter";
import { compileHooks, runAfterScrollHooks, runCommitHooks, runIdleHooks, runResizeHooks } from "./hooks";
import { render, createRenderConfig } from "./pipeline";
import { createEmitter, type Emitter } from "../events";
import type { VListEvents } from "../types";
import { createVelocityTracker, updateVelocityTracker, MIN_RELIABLE_SAMPLES } from "./velocity";

// =============================================================================
// Config Validation
// =============================================================================

function validateRawConfig<T extends VListItem>(raw: CreateVListConfig<T>): void {
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

  const legacyScroll = raw.scroll as { mode?: unknown; runway?: unknown } | undefined;
  if (legacyScroll?.mode !== undefined || legacyScroll?.runway !== undefined) {
    throw new Error('vlist 3.0: scroll.mode and scroll.runway were removed; bounded mode is gone. Use "vlist/synthetic" for huge lists or "vlist" for native scrolling.');
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

/**
 * A plugin that cannot work with this list's configuration is the same kind of
 * failure as a declared conflict: a programming error the caller has to see,
 * not a runtime fault to absorb. So it is checked here, next to the conflicts
 * and outside the setup catch, and it throws.
 *
 * `table()` rejecting reverse mode used to throw. Making setup errors
 * observable turned every setup throw into an event that fires before
 * createVList returns — which no caller can hear — so the list came back
 * half wired and rendering plain rows instead.
 */
function checkConfigCompatibility<T extends VListItem>(
  plugins: readonly VListPlugin<T>[],
  config: ResolvedConfig,
): void {
  for (const p of plugins) p.validateConfig?.(config);
}

// =============================================================================
// createVList()
// =============================================================================

/**
 * Create a list with native scrolling. Opt into synthetic input via vlist/synthetic.
 *
 * Let the item type be inferred from the config — its `items`, or the
 * `template` parameter — rather than passing it as a type argument. The list's
 * type carries exactly the methods its plugins add, and that inference needs
 * the plugins tuple as the second type parameter; TypeScript allows no partial
 * type-argument list, so `createVList<Row>(config, [selection()])` fills the
 * tuple with its default and returns a bare `VList<Row>`, with every plugin
 * method gone. It compiles, which is why it looks like the fix for a
 * `VListItem` constraint error on `Row`. The fix is the constraint: give `Row`
 * an `id`, and keep the argument list empty.
 *
 * @example
 * // inferred: list has select(), getSelected() …
 * const list = createVList({ container, items, item: { height: 40, template } }, [selection()]);
 * // explicit: compiles, and list.select does not exist
 * const bare = createVList<Row>({ container, items, item: { height: 40, template } }, [selection()]);
 */
export function createVList<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(
  config: CreateVListConfig<T>, plugins: P = [] as unknown as P,
): VList<T> & PluginMethods<P> {
  let warned = false;
  return createCore(config, plugins as unknown as VListPlugin<T>[], undefined, {
    native: createScrollHandler,
    onContentSize(size, emitter) {
      if (!warned && size > MAX_VIRTUAL_SIZE) {
        warned = true;
        emitter.emit("error", {
          error: new Error(`Content size (${size}px) exceeds browser limit (${MAX_VIRTUAL_SIZE}px). Use "vlist/synthetic" for large datasets.`),
          context: "content:size:overflow",
        });
      }
    },
  }) as VList<T> & PluginMethods<P>;
}

/** @internal Shared factory; entries select the input handler. */
export function createCore<T extends VListItem = VListItem>(
  rawConfig: CreateVListConfig<T>,
  plugins: VListPlugin<T>[] = [],
  /** @internal Omitted by the native entry. */
  logicalHandlerFactory?: (config: BoundedScrollConfig & { sizeCache: SizeCache }) => BoundedScrollHandler,
  nativeOptions?: {
    native: (config: ScrollHandlerConfig) => ScrollHandler & { commitScroll(pos?: number): void };
    onContentSize: (size: number, emitter: Emitter<VListEvents<T>>) => void;
  },
): VList<T> {
  // ── Validate config ─────────────────────────────────────────────

  validateRawConfig(rawConfig);
  if (logicalHandlerFactory && typeof rawConfig.scroll?.scrollbar === "string") {
    throw new Error('vlist 3.0: scroll.scrollbar strings require "vlist"; use the scrollbar() plugin with "vlist/synthetic".');
  }
  // Both entries reject it. Native used to accept the combination and then sit
  // on the first page: RTL makes scrollLeft negative, the wheel clamp pins it
  // at 0, and items translate the wrong way. Supporting it means signing every
  // DOM boundary and every renderer that writes its own transform, so 3.0 says
  // no out loud instead. Saying yes later is additive, not breaking.
  if (rawConfig.orientation === "horizontal" && getComputedStyle(resolveContainer(rawConfig.container)).direction === "rtl") {
    throw new Error('vlist: horizontal RTL lists are not supported; use a vertical list, or an LTR container');
  }

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
  if (plugins.length > 0) {
    checkConflicts(sorted);
    checkConfigCompatibility(sorted, config);
  }

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
  const sizeCache: SizeCache = createSizeCache(gappedSizeSpec, totalItems, gap);
  const pool = createPool(config.classPrefix);

  // ── Initialize engine state ─────────────────────────────────────

  const initialCapacity = Math.ceil(4096 / minItemSize) + config.overscan * 2 + 8;
  const state = createEngineState(initialCapacity);
  state.totalItems = totalItems;

  // ── Items storage ───────────────────────────────────────────────

  // Copied, not aliased. `setItems` already copies, while `insertItem`,
  // `removeItem` and `removeItems` splice this array in place: sharing the
  // caller's array meant the list quietly rewrote it from under them.
  let items: T[] = rawConfig.items ? [...rawConfig.items] : [];
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
  let scrollSetFn: ((pos: number) => void) | null = null;
  let onContentSize: ((px: number) => void) | undefined;
  let commitScroll: ((pos?: number) => void) | undefined;
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
  let navTotalFn: (() => number) | null = null;
  let smoothScrollFn: ((target: number | (() => number), duration: number, setFn?: (pos: number) => void, easing?: (t: number) => number, onComplete?: () => void) => void) | null = null;
  let scrollToPosFn: ((index: number, sizeCache: SizeCache, containerSize: number, totalItems: number, align: string) => number) | null = null;
  let scrollToIndexFn: ((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false) | null = null;
  /**
   * A scrollToIndex asked for before the list knew how long it was.
   *
   * With an async adapter the total arrives after the list is created, so
   * "open this list on row 2960" is given before there is a row 2960 to scroll
   * to. It used to be dropped in silence, which no caller could detect; it is
   * held here instead and honoured on the first render that has a total.
   */
  let pendingScrollToIndex: { index: number; alignOrOptions: Parameters<VList<T>["scrollToIndex"]>[1] } | null = null;
  let boundedHandler: BoundedScrollHandler | null = null;
  // A plugin (carousel) can request the bounded handler in wrap mode during
  // setup, before the handler is built below. Wrap implies bounded.
  let boundedWrap: WrapConfig | null = null;
  let wrapHandlerFactory: ((config: BoundedScrollConfig) => BoundedScrollHandler) | null = null;

  // ── Pre-initialize container size so plugins can read it ────────

  state.containerSize = isX ? dom.viewport.clientWidth : dom.viewport.clientHeight;
  state.crossSize = isX ? dom.viewport.clientHeight : dom.viewport.clientWidth;

  // ── Scroll adapter (RFC-012) ────────────────────────────────────
  // Scroll sources commit their position to engine state. Reads stay cached so
  // rendering and event payloads never invoke a source's DOM geometry getter.
  // The setter override installed during plugin setup is resolved lazily.
  function writeScroll(position: number): void {
    if (scrollSetFn) scrollSetFn(position);
    else {
      if (isX) dom.viewport.scrollLeft = position;
      else dom.viewport.scrollTop = position;
      // Reuse native read-back, rendering, event dedupe and the idle timer.
      commitScroll?.();
    }
  }

  const scrollAdapter: ScrollAdapter = createScrollAdapter({
    sizeCache,
    getPixel: () => state.scrollPosition,
    setPixel: writeScroll,
    getRenderOrigin: () => state.baseOffset,
    getContainerSize: () => state.containerSize,
    padding: config.mainAxisPadding,
  });

  // ── Run plugin setup (cold path) ────────────────────────────────

  if (plugins.length > 0) {
    const ctx: PluginContext<T> = {
      pool,
      config,
      emitter,
      template: rawConfig.item.template,
      getState(): EngineState { return state; },

      dom: {
        ...dom,
        renderedElement(index: number): HTMLElement | null {
          const override = methods.get("_getRenderedElement") as ((i: number) => HTMLElement | null) | undefined;
          if (override) return override(index);
          return rendered.get(index) ?? null;
        },
        enableListbox(): void {
          const currentRole = dom.content.getAttribute("role");
          if (!currentRole || currentRole === "list") {
            dom.content.setAttribute("role", "listbox");
            dom.content.setAttribute("tabindex", "0");
          }
          rc.itemRole = "option";
          rc.interactive = true;
        },
      },

      scroll: {
        ...scrollAdapter,
        to: writeScroll,
        shiftBy(delta: number): void {
          if (boundedHandler?.shiftBy) boundedHandler.shiftBy(delta);
          else ctx.scroll.to(state.scrollPosition + delta);
        },
        smoothTo(target: number | (() => number), duration: number, easing?: (t: number) => number, onComplete?: () => void): void {
          if (smoothScrollFn) smoothScrollFn(target, duration, scrollSetFn ?? undefined, easing, onComplete);
          else ctx.scroll.to(typeof target === "function" ? target() : target);
        },
        cancel(): void { scrollHandler?.cancelScroll(); },
        commit(pos: number): void { commitScroll!(pos); },
        setSource(source): void {
          scrollSetFn = source.write;
          onContentSize = source.onContentSize;
          skipDefaultScroll = true;
        },
        setTarget(target: EventTarget): void { scrollTarget = target; },
        setBoundedWrap(cfg, createHandler): void { boundedWrap = cfg; wrapHandlerFactory = createHandler; },
        setToPosFn(fn: (index: number, sc: SizeCache, containerSize: number, totalItems: number, align: string) => number): void { scrollToPosFn = fn; },
        setToIndexFn(fn: (index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false): void { scrollToIndexFn = fn; },
        onFrame: doScrollFrame,
        onIdle: doScrollIdle,
        disableResize(): void { skipDefaultResize = true; },
      },

      items: {
        all: getItems,
        at(index: number): T | undefined {
          return getItemFn ? getItemFn(index) : items[index];
        },
        removeById(id: string | number): number {
          if (removeItemByIdFn) return removeItemByIdFn(id);
          const idx = items.findIndex((item) => item.id === id);
          if (idx === -1) return -1;
          items.splice(idx, 1);
          state.totalItems = items.length;
          sizeCache.rebuild(state.totalItems);
          syncContentSize();
          return idx;
        },
        insertAt(item: T, index: number): void {
          if (insertItemAtFn) { insertItemAtFn(item, index); return; }
          items.splice(index, 0, item);
          state.totalItems = items.length;
          sizeCache.rebuild(state.totalItems);
          syncContentSize();
        },
        setGetFn(fn: (index: number) => T | undefined): void { getItemFn = fn; },
        setRemoveFn(fn: (id: string | number) => number): void { removeItemByIdFn = fn; },
        setInsertFn(fn: (item: T, index: number) => void): void { insertItemAtFn = fn; },
        setUpdateFn(fn: (id: string | number, updates: Partial<T>) => boolean): void { updateItemByIdFn = fn; },
        setIndexByIdFn(fn: (id: string | number) => number): void { getIndexByIdFn = fn; },
        setTotalFn(fn: () => number): void { virtualTotalFn = fn; rc.ariaTotalFn = fn; },
        setIndexMapFn(fn: (renderIndex: number) => number): void { rc.indexMap = fn; },
      },

      sizes: {
        cache: sizeCache,
        get rawSpec() { return sizeSpec; },
        setConfig(sc: number | ((index: number) => number), specGap = 0): void {
          const newCache = createSizeCache(sc, state.totalItems, specGap);
          const setBase = methods.get("_setSizeCacheBase") as ((fn: (n: number) => void) => void) | undefined;
          if (setBase) {
            // A plugin (grid, groups) hooked sizeCache.rebuild. Preserve the
            // hook and update its delegate to the new cache's internal rebuild.
            const hooked = sizeCache.rebuild;
            Object.assign(sizeCache, newCache);
            sizeCache.rebuild = hooked;
            setBase(newCache.rebuild);
          } else {
            Object.assign(sizeCache, newCache);
          }
        },
        rebuild(): void { sizeCache.rebuild(state.totalItems); },
      },

      render: {
        force(): void { doForceRender(); },
        ifNeeded(): void { doRender(); },
        contentSize: updateContentSize,
        setFn(renderFn: () => void, forceFn: () => void): void {
          // Layout plugins (groups, grid, table, …) replace the core pipeline.
          // phase2Commit is the only caller of onCommit, so without this wrap
          // those hooks never run — search highlighting is the visible case.
          // Skip when the custom renderer early-returned (range unchanged);
          // force always commits, including a same-range rebuild of innerHTML.
          customRenderIfNeeded = (): void => {
            const start = state.prevRangeStart;
            const end = state.prevRangeEnd;
            renderFn();
            if (state.prevRangeStart !== start || state.prevRangeEnd !== end) {
              runCommitHooks(hooks.commit, state);
            }
          };
          customForceRender = (): void => {
            forceFn();
            runCommitHooks(hooks.commit, state);
          };
        },
        setStateFn(fn: (index: number, st: import("../types").ItemState) => void): void { itemStateFn = fn; },
        getStateFn(): ((index: number, st: import("../types").ItemState) => void) | null { return itemStateFn; },
      },

      hooks: {
        method(name: string, fn: Function): void {
          // Public names are a contract: two plugins claiming one used to be
          // last-writer-wins, silently. Underscore names are the internal
          // cross-plugin protocol, where overriding is deliberate (groups,
          // masonry and page each provide _scrollItemIntoView, for example).
          if (!name.startsWith("_") && methods.has(name)) {
            throw new Error(`[vlist] duplicate method "${name}"; rename it or use a set*Fn hook`);
          }
          methods.set(name, fn);
        },
        get(name: string): Function | undefined { return methods.get(name); },
        onClick(handler: (e: MouseEvent) => void): void { clickHandlers.push(handler); },
        onKeydown(handler: (e: KeyboardEvent) => void): void { keydownHandlers.push(handler); },
        onDestroy(handler: () => void): void { destroyHandlers.push(handler); },
      },

      nav: {
        set(cfg: { total?: () => number; ud?: number; lr?: number; scrollIndex?: (itemIndex: number) => number; navigate?: (currentIndex: number, key: string, total: number) => number }): void {
          if (cfg.ud !== undefined) navUd = cfg.ud;
          if (cfg.lr !== undefined) navLr = cfg.lr;
          if (cfg.scrollIndex) navScrollIndexFn = cfg.scrollIndex;
          if (cfg.navigate) navNavigateFn = cfg.navigate;
          if (cfg.total) navTotalFn = cfg.total;
        },
        get: (() => {
          const _nav = { ud: 0, lr: 0, scrollIndex: null as ((itemIndex: number) => number) | null, navigate: null as ((currentIndex: number, key: string, total: number) => number) | null, total: null as (() => number) | null };
          return (): typeof _nav => {
            _nav.ud = navUd;
            _nav.lr = navLr;
            _nav.scrollIndex = navScrollIndexFn;
            _nav.navigate = navNavigateFn;
            _nav.total = navTotalFn;
            return _nav;
          };
        })(),
      },
    };

    for (const plugin of sorted) {
      if (plugin.setup) {
        try {
          plugin.setup(ctx);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          // The event fires before createVList returns, so a listener attached
          // afterwards cannot hear it: without this the list comes back half
          // wired, with no throw and nothing logged.
          //
          // `process.env.NODE_ENV` (no `typeof process`, no optional chaining)
          // is what the dist define replaces. Treating a missing `process` as
          // development made every browser bundle log in production.
          if (process.env.NODE_ENV !== "production") {
            console.error(`[vlist] plugin "${plugin.name}" setup failed`, error);
          }
          emitter.emit("error", { error, context: `plugin:setup:${plugin.name}` });
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

  function updateContentSize(size: number, write = true): void {
    if (boundedHandler) {
      if (write) boundedHandler.refresh(size);
      return;
    }
    state.totalSize = size;
    const pixels = size + config.mainAxisPadding;
    onContentSize?.(pixels);
    if (write) dom.content.style[isX ? "width" : "height"] = pixels + "px";
  }

  function syncContentSize(): void {
    const totalSize = customRenderIfNeeded ? state.totalSize : sizeCache.getTotalSize();
    updateContentSize(totalSize, !customRenderIfNeeded);
    if (boundedHandler || customRenderIfNeeded) return;

    nativeOptions?.onContentSize(totalSize, emitter);
  }

  /** A scroll asked for before the list had a length, once it has one. */
  function flushPendingScroll(): void {
    if (!pendingScrollToIndex) return;
    const total = virtualTotalFn ? virtualTotalFn() : items.length;
    if (total === 0) return;
    const wanted = pendingScrollToIndex;
    pendingScrollToIndex = null;
    api.scrollToIndex(wanted.index, wanted.alignOrOptions);
  }

  function doRender(): void {
    if (customRenderIfNeeded) {
      customRenderIfNeeded();
    } else {
      render(state, sizeCache, config.overscan, pool, dom.content, rawConfig.item.template, getItems, rendered, rc, hooks, getItemFn, itemStateFn);
    }
    // After the render: layout plugins rebuild their own state during it (grid
    // rows, masonry placements, group entries), and a scroll held from before
    // the list had a total must land on that rebuilt layout, not the stale one.
    flushPendingScroll();
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
    // Same ordering as doRender: the held scroll lands on the layout the
    // plugins just rebuilt for the new items, not on the previous one.
    flushPendingScroll();
    runAfterScrollHooks(hooks.afterScroll, state.scrollPosition, state.scrollDirection);

    if (state.scrollPosition !== lastEventScrollPos) {
      lastEventScrollPos = state.scrollPosition;
      emitScrollEvents();

      if (forceIdleTimer !== null) clearTimeout(forceIdleTimer);
      forceIdleTimer = setTimeout(doScrollIdle, idleTimeout);
    }
  }

  // ── Scroll handler ──────────────────────────────────────────────

  const wheelEnabled = skipDefaultScroll ? false : rawConfig.scroll?.wheel !== false;
  let scrollHandler: ScrollHandler;
  if (skipDefaultScroll && boundedWrap) {
    throw new Error("vlist: page() is not compatible with the carousel plugin — bounded page-mode scrolling is not implemented yet.");
  }
  // Wrap mode (carousel) implies bounded — a plugin requested it during setup.
  if (!skipDefaultScroll && (logicalHandlerFactory || boundedWrap)) {
    boundedHandler = (logicalHandlerFactory ?? wrapHandlerFactory!)({
      state, sizeCache,
      viewport: dom.viewport,
      content: dom.content,
      isX,
      wheelEnabled,
      idleTimeout,
      ...(scrollTarget ? { scrollTarget } : {}),
      mainAxisPadding: config.mainAxisPadding,
      ...(boundedWrap ? { wrap: boundedWrap, onFold(shift: number) {
        const tracker = velocityTracker as { _lp?: number };
        if (tracker._lp !== undefined) tracker._lp -= shift;
        lastEventScrollPos -= shift;
      } } : {}),
      onFrame: doScrollFrame,
      onIdle: doScrollIdle,
    });
    scrollHandler = boundedHandler;
    // Route every scroll write (ctx.scroll.to, scrollToIndex, adapter.setPixel)
    // through the logical setter so the runway split stays consistent. The
    // pixel-equivalent (read) is the logical position, matching native mode (G4).
    scrollSetFn = (px: number) => boundedHandler!.setLogical(px);
  } else {
    const nativeHandler = (skipDefaultScroll ? createScrollSource : nativeOptions!.native)({
      state,
      viewport: dom.viewport,
      isX,
      wheelEnabled,
      idleTimeout,
      ...(scrollTarget ? { scrollTarget } : {}),
      onFrame: doScrollFrame,
      onIdle: doScrollIdle,
    });
    scrollHandler = nativeHandler;
    commitScroll = nativeHandler.commitScroll;
  }

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
    // The index reported is the data index — the space `getItemAt`,
    // `scrollToIndex` and `removeItem` take. Reporting the layout index made a
    // grouped list announce data row 3 as row 5, one off per header above it.
    let index = layoutIndex;
    if (layoutToData) {
      const dataIndex = layoutToData(layoutIndex);
      if (dataIndex < 0) return null;
      // groups in table mode replaces getItemFn with a layout-aware accessor, so
      // getItemFn(dataIndex) would double-map. It publishes _getItemAtLayout for
      // exactly this; the reported index stays the data index either way.
      const getAtLayout = methods.get("_getItemAtLayout") as ((i: number) => T | undefined) | undefined;
      const getDataItem = methods.get("_getItem") as ((i: number) => T | undefined) | undefined;
      item = getAtLayout
        ? getAtLayout(layoutIndex)
        : getDataItem
          ? getDataItem(dataIndex)
          : (getItemFn ? getItemFn(dataIndex) : items[dataIndex]);
      index = dataIndex;
    } else {
      item = getItemFn ? getItemFn(layoutIndex) : items[layoutIndex];
    }
    if (item === undefined) return null;
    return { item, index };
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
          // Bounded runway geometry (maxScrollTop/maxLogical/content size) is
          // derived from containerSize — recompute it before rendering, or the
          // runway stays sized to the old viewport.
          if (boundedHandler) boundedHandler.refresh(sizeCache.getTotalSize());
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
      // Reverse mode is documented for chat UIs: a view sitting at the end
      // stays there as messages arrive. Core never read `reverse`, so the view
      // held its pixel position while content grew past it. Only a list
      // already at the end follows — scrolled back through history, it stays.
      const endOf = (): number =>
        Math.max(0, sizeCache.getTotalSize() + config.mainAxisPadding - state.containerSize);
      const wasAtEnd = config.reverse && state.scrollPosition >= endOf() - 1;
      items.push(...newItems);
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
      doForceRender();
      if (wasAtEnd) writeScroll(endOf());
    },

    prependItems(newItems: T[]): void {
      // The reverse-mode counterpart of appendItems: this is the chat "load
      // older messages" path, so the rows being read must not move when
      // history lands above them. Content grows at the start, so holding the
      // scroll position pushes those rows down by the inserted size instead.
      //
      // The growth is measured from the size cache rather than summed per
      // item: a variable spec, or an autosize() measurement, has no per-item
      // size to add up here. One trailing gap is excluded from both readings,
      // so it cancels.
      const hadItems = state.totalItems > 0;
      const sizeBefore = sizeCache.getTotalSize();
      items.unshift(...newItems);
      state.totalItems = items.length;
      sizeCache.rebuild(state.totalItems);
      syncContentSize();
      doForceRender();
      // A list that was empty has no visible row to hold: compensating there
      // would scroll away from the items just supplied.
      if (!config.reverse || !hadItems) return;
      const grew = sizeCache.getTotalSize() - sizeBefore;
      if (grew <= 0) return;
      const maxScroll = Math.max(
        0,
        sizeCache.getTotalSize() + config.mainAxisPadding - state.containerSize,
      );
      writeScroll(Math.min(state.scrollPosition + grew, maxScroll));
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
      if (rc.indexMap) {
        // A data index, as documented. Under an adapter the raw array is empty
        // and the loaded item lives in data()'s storage.
        const loaded = methods.get("_getLoadedItem") as ((i: number) => T | undefined) | undefined;
        return loaded ? loaded(index) : items[index];
      }
      // groups() in table mode replaces getItemFn with a layout-aware accessor,
      // which would make this public method take layout indices in that one
      // combination and data indices everywhere else. It publishes both halves
      // of the mapping, so ask in the documented space.
      const atLayout = methods.get("_getItemAtLayout") as ((i: number) => T | undefined) | undefined;
      if (atLayout) {
        const toLayout = methods.get("_dataToLayoutIndex") as ((i: number) => number) | undefined;
        return atLayout(toLayout ? toLayout(index) : index);
      }
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
      if (total === 0) {
        // not "nowhere to scroll" but "not yet": held until a total arrives
        pendingScrollToIndex = { index, alignOrOptions };
        return;
      }
      const align = typeof alignOrOptions === "string" ? alignOrOptions : (alignOrOptions.align ?? "start");
      const behavior = typeof alignOrOptions === "object" ? alignOrOptions.behavior : undefined;
      const duration = typeof alignOrOptions === "object" ? alignOrOptions.duration : undefined;
      const easing = typeof alignOrOptions === "object" ? alignOrOptions.easing : undefined;

      // The hook owns its own index space: grid counts rows, groups counts
      // layout entries including headers, masonry counts placements. `total`
      // here is whatever that plugin reported through setVirtualTotalFn, so
      // clamping against it before the call would translate an item index into
      // the wrong space. Each hook clamps in its own units; core clamps only
      // for its own fallback below.
      if (scrollToIndexFn && scrollToIndexFn(index, align, behavior, duration, easing) !== false) {
        return;
      }

      const clamped = Math.max(0, Math.min(index, total - 1));

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
      } else {
        writeScroll(pos);
      }
    },

    getScrollPosition(): number {
      return scrollAdapter.getPixelEquivalent();
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
    // Underscore names are the internal cross-plugin protocol, reached through
    // ctx.hooks.get(); they stay off the public instance.
    if (name.startsWith("_")) continue;
    (api as unknown as Record<string, unknown>)[name] = fn;
  }

  return api;
}
