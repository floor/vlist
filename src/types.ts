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

/** Item-specific configuration */
export interface ItemConfig<T extends VListItem = VListItem> {
  /**
   * Item height in pixels (required for virtual scrolling)
   *
   * - `number` — Fixed height for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable height per item (prefix-sum based lookups)
   */
  height: number | ((index: number) => number);

  /** Template function to render each item */
  template: ItemTemplate<T>;
}

/** Main configuration for createVList */
export interface VListConfig<T extends VListItem = VListItem> {
  /** Container element or selector */
  container: HTMLElement | string;

  /** Item configuration (height and template) */
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
   * External scroll element for document/window scrolling.
   * @deprecated Use `scroll.element` instead.
   */
  scrollElement?: Window;

  /** Scroll behavior configuration */
  scroll?: ScrollConfig;

  /**
   * Custom scrollbar configuration.
   * @deprecated Use `scroll.scrollbar` instead.
   */
  scrollbar?: ScrollbarConfig;

  /** Loading behavior configuration */
  loading?: LoadingConfig;

  /**
   * Scroll idle detection timeout in ms (default: 150).
   * @deprecated Use `scroll.idleTimeout` instead.
   */
  idleTimeout?: number;

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

  /**
   * Reverse mode for chat-style UIs.
   * When enabled:
   * - The list starts scrolled to the bottom (newest items visible)
   * - `appendItems()` auto-scrolls to bottom if the user was already at bottom
   * - `prependItems()` preserves scroll position (older messages load above without jumping)
   * - With an adapter, "load more" triggers near the TOP (loading older content)
   *
   * Items stay in chronological order (oldest = index 0, newest = last).
   * Cannot be combined with `groups` or `grid` layout.
   *
   * ```ts
   * const chat = createVList({
   *   container: '#messages',
   *   reverse: true,
   *   item: { height: 60, template: messageTemplate },
   *   items: messages,
   * });
   *
   * chat.appendItems([newMessage]);   // auto-scrolls to bottom
   * chat.prependItems(olderMessages); // scroll position preserved
   * ```
   */
  reverse?: boolean;
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

/** Scroll position snapshot for save/restore */
export interface ScrollSnapshot {
  /** First visible item index */
  index: number;

  /** Pixel offset within the first visible item (how far it's scrolled off) */
  offsetInItem: number;

  /** Selected item IDs (optional, included for convenience) */
  selectedIds?: Array<string | number>;
}

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
// Scroll
// =============================================================================

/** Scroll behavior configuration */
export interface ScrollConfig {
  /** Enable mouse wheel scrolling (default: true) */
  wheel?: boolean;

  /**
   * Scrollbar mode (default: custom scrollbar).
   *
   * - *omitted* — Custom scrollbar (default), native scrollbar hidden via CSS
   * - `'native'` — Browser native scrollbar (falls back to custom in compressed mode)
   * - `'none'` — No scrollbar at all (native hidden, custom not created)
   * - `ScrollbarOptions` — Custom scrollbar with fine-tuning options
   */
  scrollbar?: "native" | "none" | ScrollbarOptions;

  /** External scroll element for window scrolling */
  element?: Window;

  /** Scroll idle detection timeout in ms (default: 150) */
  idleTimeout?: number;
}

/** Custom scrollbar fine-tuning options */
export interface ScrollbarOptions {
  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;

  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;
}

// =============================================================================
// Scrollbar (legacy — use ScrollConfig.scrollbar instead)
// =============================================================================

/**
 * Scrollbar configuration.
 * @deprecated Use `scroll.scrollbar` in `ScrollConfig` instead.
 */
export interface ScrollbarConfig {
  /** Enable scrollbar (default: true) */
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
  /** Current scroll position */
  scrollTop: number;

  /** Container height */
  containerHeight: number;

  /** Total content height (may be capped for compression) */
  totalHeight: number;

  /** Actual total height without compression (totalItems × itemHeight) */
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
  scroll: { scrollTop: number; direction: "up" | "down" };

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

  /** Get a snapshot of the current scroll position for save/restore */
  getScrollSnapshot: () => ScrollSnapshot;

  /** Restore scroll position (and optionally selection) from a snapshot */
  restoreScroll: (snapshot: ScrollSnapshot) => void;

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
