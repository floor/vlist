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
export interface GroupHeaderConfig {
  /** 
   * Header size in pixels along the main axis (vertical scrolling).
   * - `number` — Fixed size for all headers
   * - `(group: string, groupIndex: number) => number` — Variable size per group
   *
   * Required when `orientation` is `'vertical'` (default).
   * Ignored when `orientation` is `'horizontal'`.
   */
  height?: number | ((group: string, groupIndex: number) => number);

  /**
   * Header size in pixels along the main axis (horizontal scrolling).
   * - `number` — Fixed size for all headers
   * - `(group: string, groupIndex: number) => number` — Variable size per group
   *
   * Required when `orientation` is `'horizontal'`.
   * Ignored when `orientation` is `'vertical'` (default).
   */
  width?: number | ((group: string, groupIndex: number) => number);

  /**
   * Template function to render a group header.
   * Receives the group key and the group's sequential index (0-based).
   */
  template: (group: string, groupIndex: number) => string | HTMLElement;
}

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
   * Group header configuration — mirrors the `item` config shape.
   */
  header?: GroupHeaderConfig;

  /**
   * @deprecated Use `header.height` instead.
   */
  headerHeight?: number | ((group: string, groupIndex: number) => number);

  /**
   * @deprecated Use `header.template` instead.
   */
  headerTemplate?: (group: string, groupIndex: number) => string | HTMLElement;

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

/** Masonry configuration for createVList */
export interface MasonryConfig {
  /**
   * Number of cross-axis divisions (columns in vertical, rows in horizontal).
   * Items flow into the shortest column/row.
   *
   * Must be a positive integer ≥ 1.
   */
  columns: number;

  /**
   * Gap between masonry items in pixels (default: 0).
   * Applied both horizontally and vertically.
   */
  gap?: number;
}

// =============================================================================
// Configuration
// =============================================================================

/** Item-specific configuration */
/** Context provided to size function in grid mode */
export interface GridSizeContext {
  /** Current container width */
  containerWidth: number;
  /** Number of columns */
  columns: number;
  /** Gap between items in pixels */
  gap: number;
  /** Calculated column width */
  columnWidth: number;
}

/** @deprecated Use GridSizeContext instead */
export type GridHeightContext = GridSizeContext;

export interface ItemConfig<T extends VListItem = VListItem> {
  /**
   * Item size in pixels along the main axis (required for vertical scrolling, cross-axis size for horizontal)
   *
   * - `number` — Fixed size for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable size per item (prefix-sum based lookups)
   * - `(index: number, context?: GridSizeContext) => number` — Dynamic size based on grid state
   *
   * In grid mode, the size function receives grid context as a second parameter,
   * allowing you to calculate size based on column width to maintain aspect ratios:
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
  height?: number | ((index: number, context?: GridSizeContext) => number);

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

  /**
   * Estimated item height for auto-measurement (Mode B — vertical scrolling)
   *
   * When set, vlist renders items using this estimated size, measures their
   * actual DOM height after render via ResizeObserver, caches the result,
   * and adjusts scroll position to prevent visual jumps.
   *
   * Use this for content with unknown heights: variable-length text,
   * images with unknown aspect ratios, mixed-media feeds, etc.
   *
   * Takes precedence only when `height` is not set — if both are provided,
   * `height` wins (Mode A) and `estimatedHeight` is ignored.
   *
   * Ignored when `orientation` is `'horizontal'`.
   */
  estimatedHeight?: number;

  /**
   * Estimated item width for auto-measurement (Mode B — horizontal scrolling)
   *
   * Horizontal equivalent of `estimatedHeight`. When set, vlist renders items
   * using this estimated width, measures actual DOM width after render,
   * caches the result, and adjusts scroll position to prevent visual jumps.
   *
   * Takes precedence only when `width` is not set — if both are provided,
   * `width` wins (Mode A) and `estimatedWidth` is ignored.
   *
   * Only used when `orientation` is `'horizontal'`.
   */
  estimatedWidth?: number;

  /**
   * Add a `.vlist-item--odd` class on odd-indexed items for zebra-stripe styling.
   *
   * Virtual lists recycle DOM elements out of document order, so CSS
   * `:nth-child(even/odd)` does not match the logical item index.
   * When enabled, vlist toggles the class based on the real item index,
   * giving you a reliable CSS hook:
   *
   * ```css
   * .vlist-item--odd { background: #fafafb; }
   * ```
   *
   * - `true` — all items (including group headers) count for even/odd.
   * - `"data"` — only data items count; group headers are excluded from
   *   the stripe index so they don't shift the alternating pattern.
   * - `"even"` — counter resets after each group header; first data row
   *   in every group is even (non-striped). macOS Finder behavior.
   * - `"odd"` — counter resets after each group header; first data row
   *   in every group is odd (striped).
   *
   * Default: `false` (no extra work on the render hot path).
   */
  striped?: boolean | "data" | "even" | "odd";

  /**
   * Gap between items in pixels along the main axis (default: 0).
   *
   * Adds consistent spacing between items without requiring CSS margin
   * or padding hacks on `.vlist-item`. The gap is baked into the size
   * cache (each slot = itemSize + gap) and subtracted from the DOM
   * element height, so items are positioned with precise spacing.
   *
   * Works identically to the `gap` option in grid and masonry modes.
   *
   * ```ts
   * item: {
   *   height: 60,
   *   gap: 10,        // 10px between each item
   *   template: …,
   * }
   * ```
   */
  gap?: number;

  /** Template function to render each item */
  template: ItemTemplate<T>;
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

  /** Total item count at snapshot time (used by restore to set sizeCache) */
  total?: number;

  /** Selected item IDs (optional, included for convenience) */
  selectedIds?: Array<string | number>;

  /** Focused item ID (optional, restores keyboard navigation position) */
  focusedId?: string | number;
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
   * Scrollbar gutter behavior for the native scrollbar (default: 'auto').
   *
   * - `'auto'` — Default browser behavior. On macOS with overlay scrollbars,
   *   no space is reserved. On Windows/Linux, the classic scrollbar takes
   *   ~15-17px from the content area when it appears.
   * - `'stable'` — Always reserves space for the scrollbar via
   *   `scrollbar-gutter: stable`. Prevents layout shift when content
   *   grows past the container. Recommended for Windows/Linux targets.
   *
   * Has no effect when `withScrollbar()` is active (the native scrollbar
   * is hidden and replaced by an absolute-positioned custom scrollbar).
   */
  gutter?: "auto" | "stable";

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

/**
 * Per-side padding for the scrollbar track.
 * Each side defaults to the global `PADDING` constant when omitted.
 * A plain number is shorthand for all four sides.
 */
export type ScrollbarPadding = number | {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

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

  /** Whether the focus ring should be visible (true for keyboard, false for mouse) */
  focusVisible: boolean;
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

  /**
   * Abort signal tied to this chunk's lifecycle.
   * Aborted when the chunk is no longer needed — reload, reset, or item
   * removal invalidating the offset map.  Pass directly to fetch() or any
   * other cancellable async operation in the adapter.
   */
  signal: AbortSignal;
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

/** Viewport state snapshot attached to error events for debugging */
export interface ErrorViewportSnapshot {
  scrollPosition: number;
  containerSize: number;
  visibleRange: { start: number; end: number };
  renderRange: { start: number; end: number };
  totalItems: number;
  isCompressed: boolean;
}

/** Event types and their payloads */
export interface VListEvents<T extends VListItem = VListItem> extends EventMap {
  /** Item clicked */
  "item:click": { item: T; index: number; event: MouseEvent };

  /** Item double-clicked */
  "item:dblclick": { item: T; index: number; event: MouseEvent };

  /** Selection changed */
  "selection:change": { selected: Array<string | number>; items: T[] };

  /** Focused item changed (keyboard navigation) */
  "focus:change": { id: string | number; index: number };

  /** Scroll position changed */
  scroll: { scrollPosition: number; direction: "up" | "down" };

  /** Scroll velocity changed */
  "velocity:change": { velocity: number; reliable: boolean };

  /** Visible range changed */
  "range:change": { range: Range };

  /** Data loading started */
  "load:start": { offset: number; limit: number };

  /** Data loading completed */
  "load:end": { items: T[]; total?: number; offset?: number };

  /** Error occurred (includes viewport state when available) */
  error: { error: Error; context: string; viewport?: ErrorViewportSnapshot };

  /** Container resized */
  resize: { height: number; width: number };

  /** Scroll idle — fired after scrolling stops and idle timeout elapses */
  "scroll:idle": { scrollPosition: number };

  /** Data changed — fired after item removal or other data mutations */
  "data:change": { type: "remove"; id: string | number } | { type: "update"; id: string | number };

  /** Sort started — fired when a drag begins */
  "sort:start": { index: number };

  /** Sort ended — fired on drop with reorder intent */
  "sort:end": { fromIndex: number; toIndex: number };

  /** Destroy — fired just before the instance is torn down */
  destroy: undefined;
}

/** Event handler type */
export type EventHandler<T> = (payload: T) => void;

/** Unsubscribe function */
export type Unsubscribe = () => void;

