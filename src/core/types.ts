/**
 * vlist v2 — Core Type Definitions
 *
 * Zero-allocation pipeline types. All hot-path state lives in TypedArrays
 * on the EngineState singleton — no intermediate object allocation.
 */

import type { VListItem, ItemTemplate } from "../types";
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
// Resolved Configuration
// =============================================================================

export interface ResolvedConfig {
  readonly overscan: number;
  readonly horizontal: boolean;
  readonly reverse: boolean;
  readonly classPrefix: string;
  readonly interactive: boolean;
}

// =============================================================================
// DOM Structure
// =============================================================================

export interface DOMStructure {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly content: HTMLElement;
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
// Visible Range Function (replaceable by plugins)
// =============================================================================

export type VisibleRangeFn = (
  scrollPosition: number,
  containerSize: number,
  sizeCache: SizeCache,
  totalItems: number,
  outStart: { value: number },
  outEnd: { value: number },
) => void;

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

  setSizeConfig(config: number | ((index: number) => number)): void;
  setVisibleRangeFn(fn: VisibleRangeFn): void;
  setScrollFns(get: () => number, set: (pos: number) => void): void;
  setVirtualTotalFn(fn: () => number): void;

  getItems(): readonly T[];
  getState(): EngineState;
  rebuildSizeCache(): void;
  updateContentSize(size: number): void;
  setRenderFn(renderIfNeeded: () => void, forceRender: () => void): void;
  renderIfNeeded(): void;
  forceRender(): void;

  scrollTo(position: number): void;
  disableDefaultScroll(): void;
  disableDefaultResize(): void;
  setScrollTarget(target: EventTarget): void;

  removeItemById(id: string | number): number;
  insertItemAt(item: T, index: number): void;
  getRenderedElement(index: number): HTMLElement | null;
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

  scrollToIndex(index: number, align?: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number }): void;
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
  interactive?: boolean;
  reverse?: boolean;
  ariaLabel?: string;
  scroll?: {
    wheel?: boolean;
    gutter?: "auto" | "stable";
    idleTimeout?: number;
  };
}
