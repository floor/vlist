/**
 * vlist v2 — Core Type Definitions
 *
 * Zero-allocation pipeline types. All hot-path state lives in TypedArrays
 * on the EngineState singleton — no intermediate object allocation.
 */

import type { VListItem, ItemTemplate, ItemState } from "../types";
import type { SizeCache } from "./sizes";
import type { EngineState } from "./state";
import type { Emitter } from "../events";

// =============================================================================
// Hook Types — Build-time compiled, linear iteration
// =============================================================================

/** Phase 1 hook — mutates EngineState in place, zero allocation */
export type CalculateHook = (state: EngineState) => void;

/** Phase 2 hook — runs after DOM commit */
export type CommitHook = (state: EngineState) => void;

/** After-scroll hook — runs after both phases complete */
export type AfterScrollHook = (scrollPosition: number, direction: number) => void;

/** Idle hook — runs when scrolling stops */
export type IdleHook = () => void;

/** Resize hook — runs on container resize (cold path) */
export type ResizeHook = (width: number, height: number) => void;

// =============================================================================
// Compiled Hooks Registry — frozen after createVList()
// =============================================================================

export interface CompiledHooks {
  readonly calculate: readonly CalculateHook[];
  readonly commit: readonly CommitHook[];
  readonly afterScroll: readonly AfterScrollHook[];
  readonly idle: readonly IdleHook[];
  readonly resize: readonly ResizeHook[];
}

// =============================================================================
// Axis Configuration
// =============================================================================

export type Axis = "x" | "y";

export interface AxisConfig {
  readonly primary: Axis;
  readonly cross?: Axis;
}

// =============================================================================
// Resolved Configuration
// =============================================================================

export interface ResolvedConfig {
  readonly axis: AxisConfig;
  readonly hasCrossAxis: boolean;
  readonly overscan: number;
  readonly reverse: boolean;
  readonly classPrefix: string;
  readonly mainAxisPadding: number;
  readonly crossAxisPadding: number;
  readonly startPadding: number;
  readonly endPadding: number;
  readonly crossPadStart: number;
  readonly crossPadEnd: number;
  readonly striped: boolean | "data" | "even" | "odd";
  readonly gap: number;
}

// =============================================================================
// DOM Structure
// =============================================================================

export interface DOMStructure {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly content: HTMLElement;
  readonly liveRegion: HTMLElement;
}

// =============================================================================
// Element Pool
// =============================================================================

export interface ElementPool {
  acquire(): HTMLElement;
  release(element: HTMLElement): void;
  readonly size: number;
  clear(): void;
}

// =============================================================================
// Plugin Context — cold path only, scoped access for setup()
// =============================================================================

export interface PluginContext<T extends VListItem = VListItem> {
  readonly dom: DOMStructure;
  readonly sizeCache: SizeCache;
  readonly pool: ElementPool;
  readonly config: ResolvedConfig;
  readonly emitter: Emitter<import("../types").VListEvents<T>>;
  readonly template: ItemTemplate<T>;

  registerMethod(name: string, fn: Function): void;
  getMethod(name: string): Function | undefined;
  registerClickHandler(handler: (event: MouseEvent) => void): void;
  registerKeydownHandler(handler: (event: KeyboardEvent) => void): void;
  registerDestroyHandler(handler: () => void): void;
  enableListboxRole(): void;

  setSizeConfig(config: number | ((index: number) => number)): void;
  setScrollFns(get: () => number, set: (pos: number) => void): void;
  setVirtualTotalFn(fn: () => number): void;

  getItems(): readonly T[];
  getItem(index: number): T | undefined;
  getState(): EngineState;
  rebuildSizeCache(): void;
  updateContentSize(size: number): void;
  setRenderFn(renderIfNeeded: () => void, forceRender: () => void): void;
  renderIfNeeded(): void;
  forceRender(): void;

  setGetItemFn(fn: (index: number) => T | undefined): void;
  setItemStateFn(fn: (index: number, state: ItemState) => void): void;
  getItemStateFn(): ((index: number, state: ItemState) => void) | null;
  readonly rawSizeSpec: number | ((index: number, ...args: unknown[]) => number);

  scrollTo(position: number): void;
  smoothScrollTo(target: number | (() => number), duration: number, easing?: (t: number) => number, onComplete?: () => void): void;
  disableDefaultScroll(): void;
  disableDefaultResize(): void;
  setScrollTarget(target: EventTarget): void;
  setScrollToPosFn(fn: (index: number, sizeCache: import("./sizes").SizeCache, containerSize: number, totalItems: number, align: string) => number): void;
  setScrollToIndexFn(fn: (index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false): void;
  onScrollFrame(): void;
  onScrollIdle(): void;

  removeItemById(id: string | number): number;
  insertItemAt(item: T, index: number): void;
  setRemoveItemFn(fn: (id: string | number) => number): void;
  setInsertItemFn(fn: (item: T, index: number) => void): void;
  setUpdateItemFn(fn: (id: string | number, updates: Partial<T>) => boolean): void;
  getRenderedElement(index: number): HTMLElement | null;

  setNavConfig(config: {
    total?: () => number;
    ud?: number;
    lr?: number;
    scrollIndex?: (itemIndex: number) => number;
    navigate?: (currentIndex: number, key: string, total: number) => number;
  }): void;
  getNavConfig(): {
    ud: number;
    lr: number;
    scrollIndex: ((itemIndex: number) => number) | null;
    navigate: ((currentIndex: number, key: string, total: number) => number) | null;
  };
}

// =============================================================================
// Plugin Interface
// =============================================================================

export interface VListPlugin<T extends VListItem = VListItem> {
  readonly name: string;
  readonly priority?: number;
  readonly conflicts?: readonly string[];

  /** Cold path: one-time wiring during createVList(). */
  setup?(ctx: PluginContext<T>): void;

  /** Hot path: compiled into linear arrays, iterated per frame. */
  hooks?: {
    onCalculate?(state: EngineState): void;
    onCommit?(state: EngineState): void;
    onAfterScroll?(scrollPosition: number, direction: number): void;
    onIdle?(): void;
    onResize?(width: number, height: number): void;
  };

  /** Cleanup on destroy. */
  destroy?(): void;
}

// =============================================================================
// VList Instance — returned by createVList()
// =============================================================================

export interface VList<T extends VListItem = VListItem> {
  readonly element: HTMLElement;
  readonly items: readonly T[];
  readonly total: number;

  setItems(items: T[]): void;
  appendItems(items: T[]): void;
  prependItems(items: T[]): void;
  updateItem(id: string | number, updates: Partial<T>): void;
  insertItem(item: T, index?: number): void;
  removeItem(id: string | number): void;
  removeItems(ids: ReadonlyArray<string | number>): number;
  getItemAt(index: number): T | undefined;
  getIndexById(id: string | number): number;

  scrollToIndex(index: number, align?: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number; easing?: (t: number) => number }): void;
  getScrollPosition(): number;

  on<K extends keyof import("../types").VListEvents<T>>(
    event: K,
    handler: import("../types").EventHandler<import("../types").VListEvents<T>[K]>,
  ): import("../types").Unsubscribe;

  off<K extends keyof import("../types").VListEvents<T>>(
    event: K,
    handler: import("../types").EventHandler<import("../types").VListEvents<T>[K]>,
  ): void;

  destroy(): void;

  [key: string]: unknown;
}

// =============================================================================
// CreateVList Configuration
// =============================================================================

export interface CreateVListConfig<T extends VListItem = VListItem> {
  container: HTMLElement | string;
  item: {
    height?: number | ((index: number) => number);
    width?: number | ((index: number) => number);
    estimatedHeight?: number;
    estimatedWidth?: number;
    template: ItemTemplate<T>;
    gap?: number;
    striped?: boolean | "data" | "even" | "odd";
  };
  items?: T[];
  overscan?: number;
  classPrefix?: string;
  orientation?: "vertical" | "horizontal";
  padding?: number | [number, number] | [number, number, number, number];
  reverse?: boolean;
  ariaLabel?: string;
  scroll?: {
    wheel?: boolean;
    scrollbar?: "none";
    gutter?: "auto" | "stable";
    idleTimeout?: number;
  };
  /** Defer initial render to the next animation frame. */
  defer?: boolean;
}
