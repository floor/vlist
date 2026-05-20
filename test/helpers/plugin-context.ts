/**
 * vlist v2 — Test Mock for PluginContext
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
  cleanup: () => void;
}

export function createPluginMockContext<T extends VListItem>(
  items: T[],
  options?: {
    horizontal?: boolean;
    reverse?: boolean;
    classPrefix?: string;
    overscan?: number;
    interactive?: boolean;
    itemSize?: number | ((index: number) => number);
    containerWidth?: number;
    containerHeight?: number;
    template?: ItemTemplate<T>;
  },
): PluginTestContext<T> {
  const hz = options?.horizontal ?? false;
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

  const dom: DOMStructure = { root, viewport, content };

  // ── Engine State ────────────────────────────────────────────────
  const engineState = createEngineState(200);
  engineState.containerSize = hz ? containerWidth : containerHeight;
  engineState.crossSize = hz ? containerHeight : containerWidth;
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
  const config: ResolvedConfig = {
    overscan: options?.overscan ?? 2,
    horizontal: hz,
    reverse: options?.reverse ?? false,
    classPrefix,
    interactive: options?.interactive ?? true,
    mainAxisPadding: 0,
    crossAxisPadding: 0,
    startPadding: 0,
    endPadding: 0,
    crossPadStart: 0,
    crossPadEnd: 0,
    striped: false,
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

  let customRenderIfNeeded: (() => void) | null = null;
  let customForceRender: (() => void) | null = null;
  let _renderFnReplaced = false;
  let getItemFn: ((index: number) => T | undefined) | null = null;
  let itemStateFn: ((index: number, state: ItemState) => void) | null = null;
  let removeItemByIdFn: ((id: string | number) => number) | null = null;
  let insertItemAtFn: ((item: T, index: number) => void) | null = null;

  // ── Context ─────────────────────────────────────────────────────
  const ctx: PluginContext<T> = {
    dom,
    sizeCache,
    pool,
    config,
    emitter,
    template,

    registerMethod: (name: string, fn: Function) => {
      methods.set(name, fn);
    },
    getMethod: (name: string) => methods.get(name),
    registerClickHandler: (handler) => {
      clickHandlers.push(handler);
    },
    registerKeydownHandler: (handler) => {
      keydownHandlers.push(handler);
    },
    registerDestroyHandler: (handler) => {
      destroyHandlers.push(handler);
    },

    setSizeConfig: () => {},
    setVisibleRangeFn: () => {},
    setScrollFns: () => {},
    setVirtualTotalFn: () => {},

    getItems: () => items,
    getItem: (index: number) => getItemFn ? getItemFn(index) : items[index],
    getState: () => engineState,
    rebuildSizeCache: () => {},
    updateContentSize: (size: number) => {
      if (hz) {
        content.style.width = `${size}px`;
      } else {
        content.style.height = `${size}px`;
      }
    },
    setRenderFn: (renderFn, forceFn) => {
      customRenderIfNeeded = renderFn;
      customForceRender = forceFn;
      _renderFnReplaced = true;
    },
    renderIfNeeded: () => {
      if (customRenderIfNeeded) customRenderIfNeeded();
    },
    forceRender: () => {
      if (customForceRender) customForceRender();
    },

    setGetItemFn: (fn: (index: number) => T | undefined) => { getItemFn = fn; },
    setItemStateFn: (fn: (index: number, state: ItemState) => void) => { itemStateFn = fn; },
    getItemStateFn: () => itemStateFn,
    get rawSizeSpec() { return itemSizeConfig; },

    scrollTo: (pos: number) => {
      scrollCalls.push(pos);
    },
    smoothScrollTo: (pos: number, _duration: number) => {
      scrollCalls.push(pos);
    },
    disableDefaultScroll: () => {},
    disableDefaultResize: () => {},
    setScrollTarget: () => {},

    removeItemById: (id: string | number) => {
      if (removeItemByIdFn) return removeItemByIdFn(id);
      const idx = items.findIndex((item) => item.id === id);
      if (idx === -1) return -1;
      items.splice(idx, 1);
      engineState.totalItems = items.length;
      return idx;
    },
    insertItemAt: (item: T, index: number) => {
      if (insertItemAtFn) { insertItemAtFn(item, index); return; }
      items.splice(index, 0, item);
      engineState.totalItems = items.length;
    },
    setRemoveItemFn: (fn: (id: string | number) => number) => { removeItemByIdFn = fn; },
    setInsertItemFn: (fn: (item: T, index: number) => void) => { insertItemAtFn = fn; },
    getRenderedElement: (index: number) => {
      const children = content.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        if (el.dataset.index === String(index)) return el;
      }
      return null;
    },

    setNavConfig: () => {},
    getNavConfig: () => ({ ud: 0, lr: 0, scrollIndex: null, navigate: null }),
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
    cleanup,
  };
}
