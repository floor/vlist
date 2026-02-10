/**
 * vlist - Core Types
 * Minimal, clean interfaces for the virtual list
 */

import type { GroupsConfig } from "./groups/types";
import type { GridConfig } from "./grid/types";

// =============================================================================
// Event Map Base Type
// =============================================================================

/** Base event map with index signature */
export type EventMap = Record<string, unknown>;

// =============================================================================
// Item Types
// =============================================================================

/** Base item interface - must have an id */
export interface VListItem {
  id: string | number;
  [key: string]: unknown;
}

// =============================================================================
// Configuration
// =============================================================================

/** Scroll direction */
export type ScrollAxis = "vertical" | "horizontal";

/** Item-specific configuration */
export interface ItemConfig<T extends VListItem = VListItem> {
  /**
   * Item height in pixels (required for vertical scrolling)
   *
   * - `number` — Fixed height for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable height per item (prefix-sum based lookups)
   *
   * Required when `direction` is `'vertical'` (default). Ignored in horizontal mode.
   */
  height?: number | ((index: number) => number);

  /**
   * Item width in pixels (required for horizontal scrolling)
   *
   * - `number` — Fixed width for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable width per item (prefix-sum based lookups)
   *
   * Required when `direction` is `'horizontal'`. Ignored in vertical mode.
   */
  width?: number | ((index: number) => number);

  /** Template function to render each item */
  template: ItemTemplate<T>;
}

/** Main configuration for createVList */
export interface VListConfig<T extends VListItem = VListItem> {
  /** Container element or selector */
  container: HTMLElement | string;

  /**
   * Scroll direction (default: 'vertical').
   * - `'vertical'` — Standard vertical list (scrolls top-to-bottom)
   * - `'horizontal'` — Horizontal list (scrolls left-to-right, e.g. carousels, timelines)
   *
   * In horizontal mode:
   * - Use `item.width` instead of `item.height`
   * - `scrollTop` ↔ `scrollLeft`, `height` ↔ `width`, `translateY` ↔ `translateX`
   * - Cannot be combined with grid layout, groups, or window scrolling
   */
  direction?: ScrollAxis;

  /** Item configuration (height/width and template) */
  item: ItemConfig<T>;

  /** Static items array (optional if using adapter) */
  items?: T[];

  /** Async data adapter for infinite scroll */
  adapter?: VListAdapter<T>;

  /** Number of extra items to render outside viewport (default: 3) */
  overscan?: number;

  /** Selection configuration */
  selection?: SelectionConfig;

  /**
   * Scroll behavior configuration.
   *
   * Groups all scroll-related settings: wheel behavior, scrollbar mode,
   * external scroll element (window scrolling), and idle detection.
   *
   * ```ts
   * createVList({
   *   container: '#app',
   *   item: { height: 48, template: (item) => item.name },
   *   scroll: {
   *     wheel: false,
   *     scrollbar: 'none',
   *   },
   * });
   * ```
   */
  scroll?: ScrollConfig;

  /** Loading behavior configuration */
  loading?: LoadingConfig;

  /** Custom CSS class prefix (default: 'vlist') */
  classPrefix?: string;

  /** Accessible label for the listbox (sets aria-label on the root element) */
  ariaLabel?: string;

  /**
   * Groups configuration for sticky headers / grouped lists.
   * When set, items are automatically grouped and section headers
   * are inserted at group boundaries.
   *
   * Items MUST be pre-sorted by group — a new header is inserted
   * whenever `getGroupForIndex` returns a different value.
   */
  groups?: GroupsConfig;

  /**
   * Layout mode (default: 'list').
   * - `'list'` — Standard vertical list (one item per row)
   * - `'grid'` — 2D grid layout (multiple items per row, requires `grid` config)
   *
   * In grid mode:
   * - Virtualization operates on ROWS, not individual items
   * - Each row contains `grid.columns` items side by side
   * - Item width is automatically calculated: (containerWidth - gaps) / columns
   * - Compression applies to row count, not item count
   */
  layout?: "list" | "grid";

  /**
   * Grid configuration (required when `layout: 'grid'`).
   *
   * ```ts
   * createVList({
   *   container: '#gallery',
   *   layout: 'grid',
   *   grid: { columns: 4, gap: 8 },
   *   item: {
   *     height: 200,
   *     template: (item) => `<img src="${item.thumbnail}" />`,
   *   },
   *   items: photos,
   * });
   * ```
   */
  grid?: GridConfig;
}

// =============================================================================
// Loading Configuration
// =============================================================================

/** Loading behavior configuration */
export interface LoadingConfig {
  /**
   * Velocity threshold above which data loading is skipped (px/ms)
   * When scrolling faster than this, loading is deferred until scroll stops.
   * Default: 25 px/ms
   */
  cancelThreshold?: number;

  /**
   * Velocity threshold for preloading (px/ms)
   * When scrolling faster than this but slower than cancelThreshold,
   * extra items are preloaded in the scroll direction.
   * Default: 2 px/ms
   */
  preloadThreshold?: number;

  /**
   * Number of extra items to preload ahead of scroll direction
   * Only applies when velocity is between preloadThreshold and cancelThreshold.
   * Default: 50 items
   */
  preloadAhead?: number;
}

// =============================================================================
// Scroll Options
// =============================================================================

/** Options for scrollToIndex / scrollToItem */
export interface ScrollToOptions {
  /** Alignment within the viewport (default: 'start') */
  align?: "start" | "center" | "end";

  /** Scroll behavior (default: 'auto' = instant) */
  behavior?: "auto" | "smooth";

  /** Animation duration in ms (default: 300, only used with behavior: 'smooth') */
  duration?: number;
}

// =============================================================================
// Scroll Configuration
// =============================================================================

/** Scrollbar display mode */
export type ScrollbarMode = "custom" | "native" | "none";

/** Custom scrollbar options (fine-tune the custom scrollbar behavior) */
export interface ScrollbarOptions {
  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;

  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;
}

/** Scroll behavior configuration */
export interface ScrollConfig {
  /**
   * Enable mouse wheel scrolling (default: true).
   *
   * - **Horizontal mode**: vertical wheel events (deltaY) are translated to
   *   horizontal scroll, so users can scroll with a standard mouse wheel.
   * - **Vertical mode**: the browser's native wheel scrolling is active.
   *
   * Set to `false` to disable wheel scrolling entirely in either direction.
   * Useful when the list is embedded inside another scrollable container,
   * or when you want to restrict scrolling to a custom scrollbar or drag gesture.
   */
  wheel?: boolean;

  /**
   * Scrollbar mode (default: custom scrollbar).
   *
   * - *omitted / object* — Custom scrollbar with consistent cross-browser styling
   *   (hides native). Pass an object to fine-tune: `{ autoHide: false }`.
   * - `'native'` — Browser's native scrollbar (in compressed mode, falls back to
   *   custom since `overflow: hidden` has no native scrollbar)
   * - `'none'` — No scrollbar at all (hides native, no custom)
   *
   * ```ts
   * scroll: { scrollbar: 'none' }                   // no scrollbar
   * scroll: { scrollbar: 'native' }                 // browser native
   * scroll: { scrollbar: { autoHide: false } }      // custom, always visible
   * ```
   */
  scrollbar?: "native" | "none" | ScrollbarOptions;

  /**
   * External scroll element for document/window scrolling.
   * When set, the list scrolls with this element instead of its own container.
   * Pass `window` for document scrolling (most common use case).
   *
   * In window mode:
   * - The list participates in the normal page flow (no inner scrollbar)
   * - The browser's native scrollbar controls scrolling
   * - Compression still works (content height is capped, scroll math is remapped)
   * - Custom scrollbar is disabled (the browser scrollbar is used)
   */
  element?: Window;

  /** Scroll idle detection timeout in ms (default: 150) */
  idleTimeout?: number;
}

/**
 * @deprecated Use `ScrollbarOptions` instead. Kept for internal scrollbar module compatibility.
 * @internal
 */
export interface ScrollbarConfig {
  /** @deprecated Use `scroll.scrollbar` mode instead */
  enabled?: boolean;

  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;

  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;
}

/** Item template function */
export type ItemTemplate<T = VListItem> = (
  item: T,
  index: number,
  state: ItemState,
) => string | HTMLElement;

/** State passed to template */
export interface ItemState {
  selected: boolean;
  focused: boolean;
}

// =============================================================================
// Selection
// =============================================================================

/** Selection mode */
export type SelectionMode = "none" | "single" | "multiple";

/** Selection configuration */
export interface SelectionConfig {
  /** Selection mode (default: 'none') */
  mode?: SelectionMode;

  /** Initially selected item IDs */
  initial?: Array<string | number>;
}

/** Selection state */
export interface SelectionState {
  /** Currently selected item IDs */
  selected: Set<string | number>;

  /** Currently focused item index (-1 if none) */
  focusedIndex: number;
}

// =============================================================================
// Data Adapter (Async/Infinite Scroll)
// =============================================================================

/** Adapter for async data loading */
export interface VListAdapter<T extends VListItem = VListItem> {
  /** Fetch items for a range */
  read: (params: AdapterParams) => Promise<AdapterResponse<T>>;
}

/** Parameters passed to adapter.read */
export interface AdapterParams {
  /** Starting offset */
  offset: number;

  /** Number of items to fetch */
  limit: number;

  /** Optional cursor for cursor-based pagination */
  cursor: string | undefined;
}

/** Response from adapter.read */
export interface AdapterResponse<T extends VListItem = VListItem> {
  /** Fetched items */
  items: T[];

  /** Total count (if known) */
  total?: number;

  /** Next cursor (for cursor-based pagination) */
  cursor?: string;

  /** Whether more items exist */
  hasMore?: boolean;
}

// =============================================================================
// Virtual Scrolling
// =============================================================================

/** Visible range of items */
export interface Range {
  start: number;
  end: number;
}

/** Viewport state */
export interface ViewportState {
  /** Current scroll position (scrollTop for vertical, scrollLeft for horizontal) */
  scrollTop: number;

  /** Container size in the scroll axis (height for vertical, width for horizontal) */
  containerHeight: number;

  /** Total content size in the scroll axis (may be capped for compression) */
  totalHeight: number;

  /** Actual total size without compression */
  actualHeight: number;

  /** Whether compression is active */
  isCompressed: boolean;

  /** Compression ratio (1 = no compression, <1 = compressed) */
  compressionRatio: number;

  /** Visible item range */
  visibleRange: Range;

  /** Render range (includes overscan) */
  renderRange: Range;
}

// =============================================================================
// Events
// =============================================================================

/** Event types and their payloads */
export interface VListEvents<T extends VListItem = VListItem> extends EventMap {
  /** Item clicked */
  "item:click": { item: T; index: number; event: MouseEvent };

  /** Selection changed */
  "selection:change": { selected: Array<string | number>; items: T[] };

  /** Scroll position changed */
  scroll: { scrollTop: number; direction: "up" | "down" | "left" | "right" };

  /** Visible range changed */
  "range:change": { range: Range };

  /** Data loading started */
  "load:start": { offset: number; limit: number };

  /** Data loading completed */
  "load:end": { items: T[]; total?: number };

  /** Error occurred */
  error: { error: Error; context: string };

  /** Container resized */
  resize: { height: number; width: number };
}

/** Event handler type */
export type EventHandler<T> = (payload: T) => void;

/** Unsubscribe function */
export type Unsubscribe = () => void;

// =============================================================================
// Public API
// =============================================================================

/** VList instance API */
export interface VList<T extends VListItem = VListItem> {
  /** The root DOM element */
  readonly element: HTMLElement;

  /** Current items */
  readonly items: readonly T[];

  /** Total item count */
  readonly total: number;

  // Data methods
  /** Set items (replaces all) */
  setItems: (items: T[]) => void;

  /** Append items */
  appendItems: (items: T[]) => void;

  /** Prepend items */
  prependItems: (items: T[]) => void;

  /** Update a single item by ID */
  updateItem: (id: string | number, updates: Partial<T>) => void;

  /** Remove item by ID */
  removeItem: (id: string | number) => void;

  /** Reload data (clears and re-fetches if using adapter) */
  reload: () => Promise<void>;

  // Scroll methods
  /** Scroll to specific index */
  scrollToIndex: (
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ) => void;

  /** Scroll to specific item by ID */
  scrollToItem: (
    id: string | number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ) => void;

  /** Cancel any in-progress smooth scroll animation */
  cancelScroll: () => void;

  /** Get current scroll position */
  getScrollPosition: () => number;

  // Selection methods
  /** Select item(s) by ID */
  select: (...ids: Array<string | number>) => void;

  /** Deselect item(s) by ID */
  deselect: (...ids: Array<string | number>) => void;

  /** Toggle selection */
  toggleSelect: (id: string | number) => void;

  /** Select all items */
  selectAll: () => void;

  /** Clear selection */
  clearSelection: () => void;

  /** Get selected item IDs */
  getSelected: () => Array<string | number>;

  /** Get selected items */
  getSelectedItems: () => T[];

  // Events
  /** Subscribe to an event */
  on: <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ) => Unsubscribe;

  /** Unsubscribe from an event */
  off: <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ) => void;

  // Lifecycle
  /** Destroy the instance and cleanup */
  destroy: () => void;
}

// =============================================================================
// Internal Types
// =============================================================================

/** Internal state */
export interface InternalState<T extends VListItem = VListItem> {
  items: T[];
  total: number;
  viewport: ViewportState;
  selection: SelectionState;
  isLoading: boolean;
  cursor?: string;
  hasMore: boolean;
}

/** Rendered item tracking */
export interface RenderedItem {
  index: number;
  element: HTMLElement;
}
