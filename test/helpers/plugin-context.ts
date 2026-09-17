/**
 * vlist — Test Mock for PluginContext
 *
 * Creates a fully functional mock PluginContext for testing v2 plugins
 * without going through createVList(). Tracks method registrations,
 * handler registrations, scroll calls, and render function replacements
 * so tests can assert on plugin behavior.
 */

import type { VListItem, ItemTemplate, ItemState } from "../../src/types";
import type {
  PluginContext,
  DOMStructure,
  ElementPool,
  ResolvedConfig,
} from "../../src/core/types";
import type { SizeCache } from "../../src/core/sizes";
import { createEngineState } from "../../src/core/state";
import type { EngineState } from "../../src/core/state";
import { createScrollAdapter } from "../../src/core/adapter";

export interface PluginTestContext<T extends VListItem> {
  ctx: PluginContext<T>;
  engineState: EngineState;
  dom: DOMStructure;
  methods: Map<string, Function>;
  destroyHandlers: (() => void)[];
  clickHandlers: ((event: MouseEvent) => void)[];
  keydownHandlers: ((event: KeyboardEvent) => void)[];
  items: T[];
  scrollCalls: number[];
  renderFnReplaced: boolean;
  navConfig: any;
  scrollToPosFn: any;
  /** The scroll-to-index hook a layout plugin installed via setScrollToIndexFn. */
  scrollToIndexFn: ((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false) | null;
  cleanup: () => void;
}

export function createPluginMockContext<T extends VListItem>(
  items: T[],
  options?: {
    isX?: boolean;
    reverse?: boolean;
    classPrefix?: string;
    overscan?: number;
    itemSize?: number | ((index: number) => number);
    containerWidth?: number;
    containerHeight?: number;
    template?: ItemTemplate<T>;
    padding?: { top?: number; bottom?: number; left?: number; right?: number };
  },
): PluginTestContext<T> {
  const isX = options?.isX ?? false;
  const classPrefix = options?.classPrefix ?? "vlist";
  const containerWidth = options?.containerWidth ?? 800;
  const containerHeight = options?.containerHeight ?? 600;
  const itemSizeConfig = options?.itemSize ?? 100;
  const sizeFn =
    typeof itemSizeConfig === "function" ? itemSizeConfig : () => itemSizeConfig;

  // ── DOM ──────────────────────────────────────────────────────────
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const content = document.createElement("div");

  root.className = classPrefix;
  viewport.className = `${classPrefix}-viewport`;
  content.className = `${classPrefix}-content`;

  viewport.appendChild(content);
  root.appendChild(viewport);
  document.body.appendChild(root);

  Object.defineProperty(viewport, "clientWidth", {
    value: containerWidth,
    configurable: true,
  });
  Object.defineProperty(viewport, "clientHeight", {
    value: containerHeight,
    configurable: true,
  });

  const liveRegion = document.createElement("div");
  liveRegion.className = `${classPrefix}-live`;
  liveRegion.setAttribute("aria-live", "polite");
  root.appendChild(liveRegion);

  const dom: DOMStructure = { root, viewport, content, liveRegion };

  // ── Engine State ────────────────────────────────────────────────
  const engineState = createEngineState(200);
  engineState.containerSize = isX ? containerWidth : containerHeight;
  engineState.crossSize = isX ? containerHeight : containerWidth;
  engineState.totalItems = items.length;
  engineState.scrollPosition = 0;

  // ── Size Cache ──────────────────────────────────────────────────
  const sizeCache: SizeCache = {
    getOffset: (index: number) => {
      let offset = 0;
      for (let i = 0; i < index; i++) offset += sizeFn(i);
      return offset;
    },
    getSize: (index: number) => sizeFn(index),
    indexAtOffset: (offset: number) => {
      let pos = 0;
      const total = items.length;
      for (let i = 0; i < total; i++) {
        if (pos + sizeFn(i) > offset) return i;
        pos += sizeFn(i);
      }
      return Math.max(0, total - 1);
    },
    getTotalSize: () => {
      let total = 0;
      for (let i = 0; i < items.length; i++) total += sizeFn(i);
      return total;
    },
    getTotal: () => items.length,
    rebuild: () => {},
    // This mock reads sizes live, so nothing can go stale.
    invalidate: () => {},
    isVariable: () => typeof itemSizeConfig === "function",
  };

  // ── Element Pool (masonry creates its own; this satisfies the interface) ──
  const pool: ElementPool = {
    acquire: () => document.createElement("div"),
    release: (el: HTMLElement) => el.remove(),
    get size() {
      return 0;
    },
    clear: () => {},
  };

  // ── Config ──────────────────────────────────────────────────────
  const pad = options?.padding ?? {};
  const padTop = pad.top ?? 0;
  const padBottom = pad.bottom ?? 0;
  const padLeft = pad.left ?? 0;
  const padRight = pad.right ?? 0;
  const config: ResolvedConfig = {
    axis: { primary: isX ? "x" : "y" },
    hasCrossAxis: false,
    overscan: options?.overscan ?? 2,
    reverse: options?.reverse ?? false,
    classPrefix,
    mainAxisPadding: isX ? padLeft + padRight : padTop + padBottom,
    crossAxisPadding: isX ? padTop + padBottom : padLeft + padRight,
    startPadding: isX ? padLeft : padTop,
    endPadding: isX ? padRight : padBottom,
    crossPadStart: isX ? padTop : padLeft,
    crossPadEnd: isX ? padBottom : padRight,
    striped: false,
    gap: 0,
  };

  // ── Emitter ─────────────────────────────────────────────────────
  const emitter = {
    on: () => () => {},
    off: () => {},
    emit: () => {},
    clear: () => {},
  } as any;

  // ── Template ────────────────────────────────────────────────────
  const template: ItemTemplate<T> =
    options?.template ??
    ((item: T) => `<div>${(item as any).name ?? item.id}</div>`);

  // ── Tracking ────────────────────────────────────────────────────
  const methods = new Map<string, Function>();
  const destroyHandlers: (() => void)[] = [];
  const clickHandlers: ((event: MouseEvent) => void)[] = [];
  const keydownHandlers: ((event: KeyboardEvent) => void)[] = [];
  const scrollCalls: number[] = [];

  // Functional scroll adapter over the mock's sizeCache + engineState, so
  // plugins exercising ctx.scroll behave as they would in createVList().
  const scroll = createScrollAdapter({
    sizeCache,
    getPixel: () => engineState.scrollPosition,
    setPixel: (px) => {
      engineState.scrollPosition = px;
      scrollCalls.push(px);
    },
    getRenderOrigin: () => engineState.baseOffset,
    getContainerSize: () => engineState.containerSize,
    padding: config.mainAxisPadding,
  });

  let customRenderIfNeeded: (() => void) | null = null;
  let customForceRender: (() => void) | null = null;
  let _renderFnReplaced = false;
  let _navConfig: any = null;
  let _scrollToPosFn: any = null;
  let _scrollToIndexFn: ((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false) | null = null;
  let getItemFn: ((index: number) => T | undefined) | null = null;
  let itemStateFn: ((index: number, state: ItemState) => void) | null = null;
  let removeItemByIdFn: ((id: string | number) => number) | null = null;
  let insertItemAtFn: ((item: T, index: number) => void) | null = null;

  // ── Context ─────────────────────────────────────────────────────
  const ctx: PluginContext<T> = {
    pool,
    config,
    emitter,
    template,
    getState: () => engineState,

    dom: {
      ...dom,
      renderedElement: (index: number) => {
        const children = content.children;
        for (let i = 0; i < children.length; i++) {
          const el = children[i] as HTMLElement;
          if (el.dataset.index === String(index)) return el;
        }
        return null;
      },
      enableListbox: () => {},
    },

    scroll: {
      ...scroll,
      to: (pos: number) => {
        // Mirror the real adapter: a scroll write moves the logical position.
        engineState.scrollPosition = pos;
        scrollCalls.push(pos);
      },
      // The real context self-references through `ctx`; `this` would not
      // survive being nested inside a capability object.
      shiftBy: (delta: number) => { ctx.scroll.to(engineState.scrollPosition + delta); },
      smoothTo: (target: number | (() => number), _duration: number, _easing?: (t: number) => number, onComplete?: () => void) => {
        const dest = typeof target === "function" ? target() : target;
        engineState.scrollPosition = dest;
        scrollCalls.push(dest);
        onComplete?.();
      },
      cancel: () => {},
      commit: (pos: number) => {
        engineState.prevScrollPosition = engineState.scrollPosition;
        engineState.scrollPosition = pos;
        engineState.scrollDirection = pos > engineState.prevScrollPosition ? 1 : pos < engineState.prevScrollPosition ? -1 : 0;
        ctx.scroll.onFrame();
      },
      setSource: () => {},
      setTarget: () => {},
      setBoundedWrap: () => {},
      setToPosFn: (fn: any) => { _scrollToPosFn = fn; },
      setToIndexFn: (fn: any) => { _scrollToIndexFn = fn; },
      onFrame: () => {},
      onIdle: () => {},
      disableResize: () => {},
    },

    items: {
      all: () => items,
      at: (index: number) => getItemFn ? getItemFn(index) : items[index],
      removeById: (id: string | number) => {
        if (removeItemByIdFn) return removeItemByIdFn(id);
        const idx = items.findIndex((item) => item.id === id);
        if (idx === -1) return -1;
        items.splice(idx, 1);
        engineState.totalItems = items.length;
        return idx;
      },
      insertAt: (item: T, index: number) => {
        if (insertItemAtFn) { insertItemAtFn(item, index); return; }
        items.splice(index, 0, item);
        engineState.totalItems = items.length;
      },
      setGetFn: (fn: (index: number) => T | undefined) => { getItemFn = fn; },
      setRemoveFn: (fn: (id: string | number) => number) => { removeItemByIdFn = fn; },
      setInsertFn: (fn: (item: T, index: number) => void) => { insertItemAtFn = fn; },
      setUpdateFn: (_fn: (id: string | number, updates: Partial<T>) => boolean) => {},
      setIndexByIdFn: (_fn: (id: string | number) => number) => {},
      setTotalFn: () => {},
      setIndexMapFn: () => {},
    },

    sizes: {
      cache: sizeCache,
      get rawSpec() { return itemSizeConfig; },
      setConfig: (sc: number | ((index: number) => number), gap = 0) => {
        // Mimic core: build fresh implementations and assign them over the cache
        // object. Core replaces the cache wholesale, so a reference captured
        // before the swap keeps the OLD spec — groups captures sizeCache.getSize
        // and feeds it data indices, which recurses if the swap mutates shared
        // state instead. This was a no-op until now, so no plugin's replacement
        // of the size config was ever exercised here.
        const spec: (index: number) => number =
          typeof sc === "function" ? sc : () => sc;
        Object.assign(sizeCache, {
          getOffset: (index: number) => {
            let offset = 0;
            for (let i = 0; i < index; i++) offset += spec(i);
            return offset;
          },
          getSize: (index: number) => spec(index),
          indexAtOffset: (offset: number) => {
            let pos = 0;
            const count = items.length;
            for (let i = 0; i < count; i++) {
              if (pos + spec(i) > offset) return i;
              pos += spec(i);
            }
            return Math.max(0, count - 1);
          },
          getTotalSize: () => {
            let total = 0;
            for (let i = 0; i < items.length; i++) total += spec(i);
            return total > 0 ? total - gap : 0;
          },
          isVariable: () => typeof sc === "function",
        });
      },
      rebuild: () => {},
    },

    render: {
      force: () => {
        if (customForceRender) customForceRender();
      },
      ifNeeded: () => {
        if (customRenderIfNeeded) customRenderIfNeeded();
      },
      contentSize: (size: number) => {
        engineState.totalSize = size;
        if (isX) {
          content.style.width = `${size}px`;
        } else {
          content.style.height = `${size}px`;
        }
      },
      setFn: (renderFn, forceFn) => {
        customRenderIfNeeded = renderFn;
        customForceRender = forceFn;
        _renderFnReplaced = true;
      },
      setStateFn: (fn: (index: number, state: ItemState) => void) => { itemStateFn = fn; },
      getStateFn: () => itemStateFn,
    },

    hooks: {
      method: (name: string, fn: Function) => {
        methods.set(name, fn);
      },
      get: (name: string) => methods.get(name),
      onClick: (handler) => {
        clickHandlers.push(handler);
      },
      onKeydown: (handler) => {
        keydownHandlers.push(handler);
      },
      onDestroy: (handler) => {
        destroyHandlers.push(handler);
      },
    },

    nav: {
      set: (cfg: any) => { _navConfig = cfg; },
      get: () => _navConfig
        ? { ud: 0, lr: 0, scrollIndex: null, navigate: _navConfig.navigate, total: _navConfig.total ?? null }
        : ({ ud: 0, lr: 0, scrollIndex: null, navigate: null, total: null }),
    },
  };

  const cleanup = () => {
    root.remove();
  };

  return {
    ctx,
    engineState,
    dom,
    methods,
    destroyHandlers,
    clickHandlers,
    keydownHandlers,
    items,
    scrollCalls,
    get renderFnReplaced() {
      return _renderFnReplaced;
    },
    get navConfig() {
      return _navConfig;
    },
    get scrollToPosFn() {
      return _scrollToPosFn;
    },
    /** The scroll-to-index hook a layout plugin installed, if any. */
    get scrollToIndexFn() {
      return _scrollToIndexFn;
    },
    cleanup,
  };
}
