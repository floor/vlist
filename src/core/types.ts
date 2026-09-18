/**
 * vlist — Core Type Definitions
 *
 * Zero-allocation pipeline types. All hot-path state lives in TypedArrays
 * on the EngineState singleton — no intermediate object allocation.
 */

import type { VListItem, ItemTemplate, ItemState, ItemConfig, ScrollConfig } from "../types";
import type { SizeCache } from "./sizes";
import type { ScrollAdapter } from "./adapter";
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

/**
 * DOM structure, plus the element and role helpers that act on it.
 */
export interface DomCapability extends DOMStructure {
  /** The rendered element for a layout index, honouring a plugin's override. */
  renderedElement(index: number): HTMLElement | null;
  /** Adopt the WAI-ARIA listbox roles. Selection and a11y call this; a list
   * with neither stays a display-only `role="list"`. */
  enableListbox(): void;
}

/**
 * Logical scroll model boundary (RFC-012): the adapter's reads, plus the
 * controls that write. Plugins go through this rather than touching
 * `getState().scrollPosition` or raw `scrollTop`/`scrollLeft`.
 */
export interface ScrollCapability extends ScrollAdapter {
  to(position: number): void;
  /** Preserve synthetic motion during a measurement/anchor correction. */
  shiftBy(delta: number): void;
  smoothTo(target: number | (() => number), duration: number, easing?: (t: number) => number, onComplete?: () => void): void;
  /** Cancel any in-flight smooth-scroll animation on the active handler. */
  cancel(): void;
  /** Commit an external position, render synchronously and schedule idle. */
  commit(px: number): void;
  /** Install an external writer and disable default scroll/wheel listeners. */
  setSource(source: { write(px: number): void; onContentSize?(px: number): void }): void;
  setTarget(target: EventTarget): void;
  /** Request the bounded scroll handler in infinite-loop (wrap) mode (carousel). */
  setBoundedWrap(
    config: import("./runway").WrapConfig,
    createHandler: (config: import("./runway").BoundedScrollConfig) => import("./runway").BoundedScrollHandler,
  ): void;
  setToPosFn(fn: (index: number, sizeCache: import("./sizes").SizeCache, containerSize: number, totalItems: number, align: string) => number): void;
  setToIndexFn(fn: (index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number) => void | false): void;
  onFrame(): void;
  onIdle(): void;
  disableResize(): void;
}

/**
 * The item space: reads, mutations, and the inversion hooks a plugin installs
 * to own them. One owner per hook — two plugins claiming the same one is how
 * tree with data rendered nothing.
 */
export interface ItemsCapability<T extends VListItem = VListItem> {
  all(): readonly T[];
  at(index: number): T | undefined;
  removeById(id: string | number): number;
  insertAt(item: T, index: number): void;
  setGetFn(fn: (index: number) => T | undefined): void;
  setRemoveFn(fn: (id: string | number) => number): void;
  setInsertFn(fn: (item: T, index: number) => void): void;
  setUpdateFn(fn: (id: string | number, updates: Partial<T>) => boolean): void;
  setIndexByIdFn(fn: (id: string | number) => number): void;
  /** The public total. Also feeds `aria-setsize`. */
  setTotalFn(fn: () => number): void;
  setIndexMapFn(fn: (renderIndex: number) => number): void;
}

/** The size cache and the spec behind it. */
export interface SizesCapability {
  readonly cache: SizeCache;
  readonly rawSpec: number | ((index: number, ...args: unknown[]) => number);
  /** Replace the size spec. `gap` is the spacing baked into the spec, so the
   * cache can keep excluding one trailing gap from the total; omit it when the
   * spec carries none (table's fixed row height, for instance). */
  setConfig(config: number | ((index: number) => number), gap?: number): void;
  rebuild(): void;
}

/** The render pipeline: run it, replace it, or describe item state to it. */
export interface RenderCapability {
  force(): void;
  ifNeeded(): void;
  contentSize(size: number): void;
  setFn(renderIfNeeded: () => void, forceRender: () => void): void;
  setStateFn(fn: (index: number, state: ItemState) => void): void;
  getStateFn(): ((index: number, state: ItemState) => void) | null;
}

/** The cross-plugin method bus and the shared event handlers. */
export interface HooksCapability {
  /** Register a public method on the list. Public names are a contract:
   * a second claimant throws. Underscore names are the internal protocol. */
  method(name: string, fn: Function): void;
  get(name: string): Function | undefined;
  onClick(handler: (event: MouseEvent) => void): void;
  onKeydown(handler: (event: KeyboardEvent) => void): void;
  onDestroy(handler: () => void): void;
}

/** Keyboard navigation geometry, shared between layout plugins and selection. */
export interface NavCapability {
  set(config: {
    total?: () => number;
    ud?: number;
    lr?: number;
    scrollIndex?: (itemIndex: number) => number;
    navigate?: (currentIndex: number, key: string, total: number) => number;
    /**
     * Bring this navigation / focus index into view, the layout plugin's way.
     * The index is the same space as `nav.total` (carousel: logical item
     * index; grid: item index) — not a size-cache index and not a layout
     * index that counts group headers or carousel laps.
     * `selectNext` / `selectPrevious` call this when present so a plugin that
     * owns motion (carousel snap, current virtual lap) reveals the item
     * without selection falling back to a raw size-cache offset.
     */
    reveal?: (index: number) => void;
  }): void;
  get(): {
    ud: number;
    lr: number;
    scrollIndex: ((itemIndex: number) => number) | null;
    navigate: ((currentIndex: number, key: string, total: number) => number) | null;
    total: (() => number) | null;
    /**
     * Always present on the returned object: the owner's reveal, or `null`
     * when no plugin published one. Plugin authors must read this property
     * rather than treating a missing key as "no owner".
     */
    reveal: ((index: number) => void) | null;
  };
}

/**
 * What a plugin receives in `setup()`. Grouped by capability rather than laid
 * out flat: the flat form had fifty members with no map from a member to the
 * part of the engine it reached.
 */
export interface PluginContext<T extends VListItem = VListItem> {
  readonly dom: DomCapability;
  readonly scroll: ScrollCapability;
  readonly items: ItemsCapability<T>;
  readonly sizes: SizesCapability;
  readonly render: RenderCapability;
  readonly hooks: HooksCapability;
  readonly nav: NavCapability;

  readonly pool: ElementPool;
  readonly config: ResolvedConfig;
  readonly emitter: Emitter<import("../types").VListEvents<T>>;
  readonly template: ItemTemplate<T>;
  getState(): EngineState;
}

// =============================================================================
// Plugin Interface
// =============================================================================

export interface VListPlugin<T extends VListItem = VListItem, M = {}> {
  readonly name: string;
  readonly priority?: number;
  readonly conflicts?: readonly string[];

  /**
   * Cold path: reject a list configuration this plugin cannot support.
   *
   * Runs before setup and outside its catch, so throwing here reaches the
   * caller. A throw from `setup()` cannot: it is reported as an `error` event
   * so that one plugin's failure does not stop the others, which is the right
   * behaviour for a fault and the wrong one for a configuration the plugin has
   * already decided it cannot serve.
   */
  validateConfig?(config: ResolvedConfig): void;

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

  /**
   * Phantom marker: the methods this plugin adds to the list instance.
   * Never set at runtime; `createVList` reads it to type the returned list.
   */
  readonly __methods?: M;
}

/** @internal Turns a union into an intersection. */
type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * @internal The method map a single plugin declares. The item type is matched
 * loosely: a plugin typed for a specific item is not assignable to
 * `VListPlugin<VListItem, ...>` under strict function types.
 */
type MethodsOf<P> = P extends VListPlugin<any, infer M> ? M : {};

/**
 * The methods a plugin array adds to the list instance. A plugin that declares
 * no methods contributes nothing, so `createVList(config)` stays exactly `VList<T>`.
 */
export type PluginMethods<P extends readonly unknown[]> = UnionToIntersection<MethodsOf<P[number]>>;

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
}

// =============================================================================
// CreateVList Configuration
// =============================================================================

export interface CreateVListConfig<T extends VListItem = VListItem> {
  container: HTMLElement | string;
  item: ItemConfig<T>;
  items?: T[];
  overscan?: number;
  classPrefix?: string;
  orientation?: "vertical" | "horizontal";
  padding?: number | [number, number] | [number, number, number, number];
  reverse?: boolean;
  ariaLabel?: string;
  scroll?: ScrollConfig;
  /** Defer initial render to the next animation frame. */
  defer?: boolean;
}
