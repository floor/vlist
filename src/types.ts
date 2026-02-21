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
// Feature Configuration Types
// =============================================================================

/** Groups configuration for createVList */
export interface GroupsConfig {
  /**
   * Determine which group an item belongs to.
   * Called with the DATA index (index into the original items array).
   * Items with the same group key are grouped together.
   *
   * Items MUST be pre-sorted by group — the function is called in order
   * and a new header is inserted whenever the return value changes.
   */
  getGroupForIndex: (index: number) => string;

  /**
   * Height of group header elements in pixels.
   * - `number` — Fixed height for all headers
   * - `(group: string, groupIndex: number) => number` — Variable height per group
   */
  headerHeight: number | ((group: string, groupIndex: number) => number);

  /**
   * Template function to render a group header.
   * Receives the group key and the group's sequential index (0-based).
   */
  headerTemplate: (group: string, groupIndex: number) => string | HTMLElement;

  /**
   * Enable sticky headers (default: true).
   * When true, the current group's header "sticks" to the top of the
   * viewport and is pushed out by the next group's header approaching.
   */
  sticky?: boolean;
}

/** Grid configuration for createVList */
export interface GridConfig {
  /**
   * Number of columns in the grid.
   * Item width = containerWidth / columns (minus gaps).
   *
   * Must be a positive integer ≥ 1.
   */
  columns: number;

  /**
   * Gap between grid items in pixels (default: 0).
   * Applied both horizontally (between columns) and vertically (between rows).
   */
  gap?: number;
}

// =============================================================================
// Configuration
// =============================================================================

/** Item-specific configuration */
/** Context provided to height function in grid mode */
export interface GridHeightContext {
  /** Current container width */
  containerWidth: number;
  /** Number of columns */
  columns: number;
  /** Gap between items in pixels */
  gap: number;
  /** Calculated column width */
  columnWidth: number;
}

export interface ItemConfig<T extends VListItem = VListItem> {
  /**
   * Item height in pixels (required for vertical scrolling, cross-axis size for horizontal)
   *
   * - `number` — Fixed height for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable height per item (prefix-sum based lookups)
   * - `(index: number, context?: GridHeightContext) => number` — Dynamic height based on grid state
   *
   * In grid mode, the height function receives grid context as a second parameter,
   * allowing you to calculate height based on column width to maintain aspect ratios:
   *
   * ```ts
   * height: (index, context) => {
   *   if (context) {
   *     return context.columnWidth * 0.75; // 4:3 aspect ratio
   *   }
   *   return 200; // fallback for non-grid
   * }
   * ```
   *
   * Required when `orientation` is `'vertical'` (default).
   * Optional when `orientation` is `'horizontal'` (used as cross-axis size).
   */
  height?: number | ((index: number, context?: GridHeightContext) => number);

  /**
   * Item width in pixels (required for horizontal scrolling)
   *
   * - `number` — Fixed width for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable width per item (prefix-sum based lookups)
   *
   * Required when `orientation` is `'horizontal'`.
   * Ignored when `orientation` is `'vertical'` (default).
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
   * Layout orientation (default: 'vertical').
   *
   * - `'vertical'` — Standard top-to-bottom scrolling (default)
   * - `'horizontal'` — Left-to-right scrolling (carousel, timeline, etc.)
   *
   * When `'horizontal'`:
   * - `item.width` is required (main-axis size for virtualization)
   * - `item.height` is optional (cross-axis size, can be set via CSS)
   * - Items are positioned with `translateX` instead of `translateY`
   * - The viewport scrolls on the X axis
   *
   * Cannot be combined with `groups`, `grid`, or `reverse`.
   */
  orientation?: "vertical" | "horizontal";

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
// Update Configuration
// =============================================================================

/**
 * Configuration options that can be updated dynamically without recreating the instance.
 * Used by the update() method.
 */
export interface VListUpdateConfig {
  /**
   * Grid configuration (columns and gap).
   * Only applicable when layout is 'grid'.
   */
  grid?: {
    columns?: number;
    gap?: number;
  };

  /**
   * Item height (for variable height updates).
   * Can be a number or a function.
   */
  itemHeight?: number | ((index: number) => number);

  /**
   * Selection mode.
   * Changes selection behavior without recreating the list.
   */
  selectionMode?: SelectionMode;

  /**
   * Overscan value (number of items to render outside viewport).
   */
  overscan?: number;
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
   * Wrap around when scrolling past boundaries (default: false).
   *
   * When `true`, `scrollToIndex` wraps around:
   * - Index past the last item → wraps to the beginning
   * - Negative index → wraps from the end
   *
   * Useful for carousels, wizards, and circular navigation.
   */
  wrap?: boolean;

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

  /**
   * Show scrollbar when hovering near the scrollbar edge (default: true).
   * When true, an invisible hover zone is placed along the scrollbar edge.
   * Moving the mouse into this zone reveals the scrollbar; it stays visible
   * as long as the cursor remains over the zone or the track.
   */
  showOnHover?: boolean;

  /**
   * Width of the invisible hover zone in pixels (default: 16).
   * Only used when `showOnHover` is true.
   * A wider zone makes the scrollbar easier to discover;
   * a narrower zone avoids interference with content near the edge.
   */
  hoverZoneWidth?: number;

  /**
   * Show scrollbar when the mouse enters the list viewport (default: true).
   * When false, the scrollbar only appears on scroll or when hovering
   * near the scrollbar edge (if `showOnHover` is true).
   */
  showOnViewportEnter?: boolean;
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
  /** Current scroll position along main axis (scrollTop for vertical, scrollLeft for horizontal) */
  scrollPosition: number;

  /** Container size along main axis (height for vertical, width for horizontal) */
  containerSize: number;

  /** Total content size (may be capped for compression) */
  totalSize: number;

  /** Actual total size without compression */
  actualSize: number;

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

  /** Item double-clicked */
  "item:dblclick": { item: T; index: number; event: MouseEvent };

  /** Selection changed */
  "selection:change": { selected: Array<string | number>; items: T[] };

  /** Scroll position changed */
  scroll: { scrollPosition: number; direction: "up" | "down" };

  /** Scroll velocity changed */
  "velocity:change": { velocity: number; reliable: boolean };

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

  // Configuration methods
  /** Update configuration without recreating the instance */
  update: (config: Partial<VListUpdateConfig>) => void;

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
