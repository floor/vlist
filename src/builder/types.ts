/**
 * vlist/builder - Types
 * Feature interface, builder config, builder context, and return types
 */

import type {
  VListItem,
  VListEvents,
  ItemConfig,
  ItemTemplate,
  Range,
  ViewportState,
  EventHandler,
  Unsubscribe,
  ScrollToOptions,
  ScrollSnapshot,
} from "../types";

// Direct file imports — NOT barrel indexes — so Bun tree-shakes correctly.
import type {
  DOMStructure,
  Renderer,
  SizeCache,
  CompressionContext,
} from "../rendering";
import type { CompressionState } from "../rendering/viewport";
import type { SimpleDataManager } from "./data";
import type { ScrollController } from "../features/scrollbar/controller";
import type { Emitter } from "../events";

// =============================================================================
// Builder Configuration (subset of VListConfig without feature-specific options)
// =============================================================================

/** Configuration accepted by the builder's vlist() factory */
export interface BuilderConfig<T extends VListItem = VListItem> {
  /** Container element or selector */
  container: HTMLElement | string;

  /** Item configuration (height/width and template) */
  item: ItemConfig<T>;

  /** Static items array (optional if using adapter via feature) */
  items?: T[];

  /** Number of extra items to render outside viewport (default: 3) */
  overscan?: number;

  /** Custom CSS class prefix (default: 'vlist') */
  classPrefix?: string;

  /** Accessible label for the listbox */
  ariaLabel?: string;

  /**
   * Layout orientation (default: 'vertical')
   * - 'vertical' — Standard top-to-bottom scrolling
   * - 'horizontal' — Left-to-right scrolling
   */
  orientation?: "vertical" | "horizontal";

  /** Reverse mode for chat UIs */
  reverse?: boolean;

  /** Scroll behavior configuration (non-scrollbar options) */
  scroll?: {
    /** Enable mouse wheel scrolling (default: true) */
    wheel?: boolean;

    /** Wrap around when scrolling past boundaries (default: false) */
    wrap?: boolean;

    /** Scroll idle detection timeout in ms (default: 150) */
    idleTimeout?: number;

    /** External scroll element for window scrolling */
    element?: Window;
  };
}

// =============================================================================
// Resolved internal config (after defaults are applied)
// =============================================================================

/** Resolved configuration stored inside BuilderContext */
export interface ResolvedBuilderConfig {
  readonly overscan: number;
  readonly classPrefix: string;
  readonly reverse: boolean;
  readonly wrap: boolean;
  readonly horizontal: boolean;
  readonly ariaIdPrefix: string;
}

// =============================================================================
// BuilderContext — the interface features receive during setup
// =============================================================================

/** Cached compression state */
export interface CachedCompression {
  state: CompressionState;
  totalItems: number;
}

/** Builder state */
export interface BuilderState {
  viewportState: ViewportState;
  lastRenderRange: Range;
  isInitialized: boolean;
  isDestroyed: boolean;
  cachedCompression: CachedCompression | null;
}

/**
 * BuilderContext — the internal interface that features receive during setup.
 *
 * Provides access to all core components plus registration points for
 * handlers, methods, and cleanup callbacks.
 */
export interface BuilderContext<T extends VListItem = VListItem> {
  // ── Core components (always present) ──────────────────────────
  readonly dom: DOMStructure;
  readonly sizeCache: SizeCache;
  readonly emitter: Emitter<VListEvents<T>>;
  readonly config: ResolvedBuilderConfig;

  /** The raw user-provided builder config (for features that need original values) */
  readonly rawConfig: BuilderConfig<T>;

  // ── Mutable components (replaceable by features) ───────────────
  renderer: Renderer<T>;
  dataManager: SimpleDataManager<T>;
  scrollController: ScrollController;

  // ── State ─────────────────────────────────────────────────────
  state: BuilderState;

  // ── Post-scroll actions ───────────────────────────────────────
  /**
   * Features register lightweight callbacks that run after each
   * scroll-triggered render. These are NOT on the hot path —
   * they run after DOM updates are complete.
   */
  afterScroll: Array<(scrollPosition: number, direction: string) => void>;

  // ── Event handler slots ───────────────────────────────────────
  /**
   * Features register handlers for user interaction events.
   * These are attached as DOM event listeners during .build().
   */
  clickHandlers: Array<(event: MouseEvent) => void>;
  keydownHandlers: Array<(event: KeyboardEvent) => void>;
  resizeHandlers: Array<(width: number, height: number) => void>;
  contentSizeHandlers: Array<() => void>;
  destroyHandlers: Array<() => void>;

  // ── Public method registration ────────────────────────────────
  /** Features register public methods by name. Exposed on the returned API. */
  methods: Map<string, Function>;

  // ── Component replacement ─────────────────────────────────────
  replaceTemplate(template: ItemTemplate<T>): void;
  replaceRenderer(renderer: Renderer<T>): void; // For grid feature compatibility
  replaceDataManager(dataManager: SimpleDataManager<T>): void;
  replaceScrollController(scrollController: ScrollController): void;

  // ── Helpers ───────────────────────────────────────────────────
  getItemsForRange(range: Range): T[];
  getAllLoadedItems(): T[];
  getVirtualTotal(): number;
  getCachedCompression(): CompressionState;
  getCompressionContext(): CompressionContext;
  renderIfNeeded(): void;
  forceRender(): void;

  /**
   * Remove all rendered DOM elements and return them to the pool.
   * Used by reload to force a full re-render from scratch, bypassing
   * the ID-based optimization that skips template updates for same-ID items.
   */
  invalidateRendered(): void;

  /**
   * Get current render functions (for wrapping by selection/other features).
   * Call this BEFORE setRenderFns to capture the current functions.
   */
  getRenderFns(): { renderIfNeeded: () => void; forceRender: () => void };

  /**
   * Get current container width (for grid feature).
   * This returns the width detected by ResizeObserver, which is more reliable
   * than viewport.clientWidth in test environments.
   */
  getContainerWidth(): number;

  /**
   * Replace the virtual-total function.
   * Used by grid/groups features that change what "total" means
   * (e.g. row count instead of item count).
   */
  setVirtualTotalFn(fn: () => number): void;

  /**
   * Used by groups feature to inject grouped size function and by grid to add gap.
   */
  rebuildSizeCache(total?: number): void;

  /**
   * Set a new effective size config function/value.
   * Features that change sizes (groups, grid) call this before rebuildSizeCache.
   */
  setSizeConfig(config: number | ((index: number) => number)): void;

  /**
   * Update content size on the main axis (height for vertical, width for horizontal).
   */
  updateContentSize(totalSize: number): void;

  /**
   * Update compression mode when total items changes.
   * Called by the core after data changes and by features that alter totals.
   */
  updateCompressionMode(): void;

  /**
   * Replace the visible-range calculation function.
   * Used by withCompression to inject compressed range calculation.
   */
  setVisibleRangeFn(
    fn: (
      scrollTop: number,
      containerHeight: number,
      sc: SizeCache,
      totalItems: number,
      out: Range,
    ) => void,
  ): void;

  /**
   * Replace the scroll-to-index position calculator.
   * Used by withCompression to inject compressed position calculation.
   */
  setScrollToPosFn(
    fn: (
      index: number,
      sc: SizeCache,
      containerHeight: number,
      totalItems: number,
      align: "start" | "center" | "end",
    ) => number,
  ): void;

  /**
   * Replace the item positioning function.
   * Used by withCompression to inject compressed item positioning.
   */
  setPositionElementFn(fn: (element: HTMLElement, index: number) => void): void;

  /**
   * Replace the render functions.
   * Used by grid/groups features that need to completely replace the render logic
   * (e.g., to convert row ranges to item ranges for grid rendering).
   */
  setRenderFns(renderIfNeeded: () => void, forceRender: () => void): void;

  /**
   * Replace the scroll get/set functions.
   * Used by withCompression to manage a virtual scroll position that bypasses
   * native DOM scrollTop (which can't represent compressed scroll space).
   */
  setScrollFns(getTop: () => number, setTop: (pos: number) => void): void;

  /**
   * Set the scroll target element (default: viewport).
   * Used by window mode feature to use window instead of viewport for scroll events.
   */
  setScrollTarget(target: HTMLElement | Window): void;

  /**
   * Get the current scroll target element.
   * Returns the element/window that scroll events are bound to.
   */
  getScrollTarget(): HTMLElement | Window;

  /**
   * Override container dimension getters.
   * Used by window mode feature to use window.innerWidth/innerHeight instead
   * of viewport.clientWidth/clientHeight.
   */
  setContainerDimensions(getter: {
    width: () => number;
    height: () => number;
  }): void;

  /**
   * Disable the ResizeObserver on the viewport element.
   * Used by window mode feature where the viewport doesn't need observation
   * (window resize is used instead).
   */
  disableViewportResize(): void;
}

// =============================================================================
// VListFeature — the feature interface
// =============================================================================

/**
 * VListFeature — the interface for builder features.
 *
 * Each feature:
 * - Has a unique name (used for deduplication and error messages)
 * - Optionally declares a priority (lower runs first, default: 50)
 * - Implements setup() which receives BuilderContext and wires in handlers/methods
 * - Optionally implements destroy() for cleanup
 * - Optionally declares methods it adds and features it conflicts with
 */
export interface VListFeature<T extends VListItem = VListItem> {
  /** Unique feature name (used for deduplication and error messages) */
  readonly name: string;

  /** Execution priority — lower runs first (default: 50) */
  readonly priority?: number;

  /** Setup function — receives BuilderContext, wires handlers and methods */
  setup(ctx: BuilderContext<T>): void;

  /** Cleanup function — called on destroy */
  destroy?(): void;

  /** Methods this feature adds to the public API */
  readonly methods?: readonly string[];

  /** Features this feature conflicts with (cannot be combined) */
  readonly conflicts?: readonly string[];
}

/** Factory function that returns a feature */
export type FeatureFactory<T extends VListItem = VListItem> = VListFeature<T>;

// =============================================================================
// VListBuilder — the chainable builder
// =============================================================================

/** Chainable builder interface */
export interface VListBuilder<T extends VListItem = VListItem> {
  /** Register a feature. Chainable. */
  use(feature: VListFeature<T>): VListBuilder<T>;

  /** Materialize the virtual list. Creates DOM, initializes features, returns API. */
  build(): BuiltVList<T>;
}

// =============================================================================
// BuiltVList — the return type from .build()
// =============================================================================

/** Base API always available from builder (data methods, scroll methods, events, lifecycle) */
export interface BuiltVList<T extends VListItem = VListItem> {
  /** The root DOM element */
  readonly element: HTMLElement;

  /** Current items */
  readonly items: readonly T[];

  /** Total item count */
  readonly total: number;

  // ── Data methods (always available) ───────────────────────────
  setItems: (items: T[]) => void;
  appendItems: (items: T[]) => void;
  prependItems: (items: T[]) => void;
  updateItem: (id: string | number, updates: Partial<T>) => void;
  removeItem: (id: string | number) => void;
  reload: () => Promise<void>;

  // ── Scroll methods (always available) ─────────────────────────
  scrollToIndex: (
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ) => void;
  cancelScroll: () => void;
  getScrollPosition: () => number;

  // ── Events (always available) ─────────────────────────────────
  on: <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ) => Unsubscribe;
  off: <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ) => void;

  // ── Lifecycle ─────────────────────────────────────────────────
  destroy: () => void;

  // ── Feature methods (dynamically added) ────────────────────────
  // Selection (added by withSelection)
  select?: (...ids: Array<string | number>) => void;
  deselect?: (...ids: Array<string | number>) => void;
  toggleSelect?: (id: string | number) => void;
  selectAll?: () => void;
  clearSelection?: () => void;
  getSelected?: () => Array<string | number>;
  getSelectedItems?: () => T[];

  // Snapshots (added by withSnapshots)
  getScrollSnapshot?: () => ScrollSnapshot;
  restoreScroll?: (snapshot: ScrollSnapshot) => void;

  // Data (added by withData — override reload)
  // reload is always present but withData makes it functional

  // Allow arbitrary feature methods
  [key: string]: unknown;
}
