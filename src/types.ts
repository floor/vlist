/**
 * vlist - Core Types
 * Minimal, clean interfaces for the virtual list
 */

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

/** Main configuration for createVList */
export interface VListConfig<T extends VListItem = VListItem> {
  /** Container element or selector */
  container: HTMLElement | string;

  /** Fixed item height in pixels (required for virtual scrolling) */
  itemHeight: number;

  /** Template function to render each item */
  template: ItemTemplate<T>;

  /** Static items array (optional if using adapter) */
  items?: T[];

  /** Async data adapter for infinite scroll */
  adapter?: VListAdapter<T>;

  /** Number of extra items to render outside viewport (default: 3) */
  overscan?: number;

  /** Selection configuration */
  selection?: SelectionConfig;

  /** Custom scrollbar configuration (for compressed mode) */
  scrollbar?: ScrollbarConfig;

  /** Loading behavior configuration */
  loading?: LoadingConfig;

  /** Custom CSS class prefix (default: 'vlist') */
  classPrefix?: string;
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
// Scrollbar
// =============================================================================

/** Scrollbar configuration */
export interface ScrollbarConfig {
  /** Enable scrollbar (default: auto - enabled when compressed) */
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
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;

  /** Scroll to specific item by ID */
  scrollToItem: (
    id: string | number,
    align?: "start" | "center" | "end",
  ) => void;

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
