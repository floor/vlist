/**
 * vlist/internals - Low-Level Exports
 *
 * Advanced utilities for feature authors, custom renderers, and power users.
 * These are implementation details — use at your own risk.
 *
 * For the stable public API, import from 'vlist' instead.
 *
 * @packageDocumentation
 */

// =============================================================================
// Groups domain
// =============================================================================

export {
  createGroupLayout,
  buildLayoutItems,
  createGroupedSizeFn,
  createStickyHeader,
  isGroupHeader,
  type GroupsConfig,
  type GroupBoundary,
  type LayoutEntry,
  type GroupHeaderItem,
  type GroupLayout,
  type StickyHeader,
} from "./plugins/groups";

// =============================================================================
// Grid domain
// =============================================================================

export {
  createGridLayout,
  type GridLayout,
  type GridPosition,
  type ItemRange,
} from "./plugins/grid";
export {
  createGridRenderer,
  type GridRenderer,
} from "./plugins/grid/renderer";
export type { GridConfig } from "./plugins/grid/types";

// =============================================================================
// Table domain
// =============================================================================

export {
  createTableLayout,
  createTableHeader,
  createTableRenderer,
  type TableConfig,
  type TableColumn,
  type TableLayout,
  type TableHeader,
  type TableRenderer,
  type TableRendererInstance,
  type ResolvedColumn,
  type ColumnResizeEvent,
  type ColumnSortEvent,
  type ColumnClickEvent,
} from "./plugins/table";

// =============================================================================
// Masonry domain
// =============================================================================

export {
  createMasonryLayout,
  createMasonryRenderer,
  type MasonryConfig,
  type MasonryLayout,
  type MasonryRenderer,
  type GetItemFn,
  type ItemPlacement,
} from "./plugins/masonry";

// =============================================================================
// Rendering domain (virtual scrolling, size cache, scaling)
// =============================================================================

export {
  // Size cache (variable item sizes - works for both vertical and horizontal)
  createSizeCache,
  type SizeCache,
} from "./rendering";

// =============================================================================
// Selection domain
// =============================================================================

export {
  createSelectionState,
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  isSelected,
  getSelectedIds,
} from "./plugins/selection";
export { getSelectedItemsImmutable as getSelectedItems } from "./plugins/selection/state";

// =============================================================================
// Events domain
// =============================================================================

export { createEmitter, type Emitter } from "./events";

// =============================================================================
// Async domain
// =============================================================================

export {
  createDataManager as createAsyncManager,
  createSparseStorage,
  createPlaceholderManager,
  isPlaceholderItem,
  filterPlaceholders,
  mergeRanges,
  calculateMissingRanges,
  type DataManager as AsyncManager,
  type SparseStorage,
  type PlaceholderManager,
} from "./plugins/data";

// =============================================================================
// Scrollbar domain
// =============================================================================

export {
  createScrollbar,
  type Scrollbar,
} from "./plugins/scrollbar";
export type { ScrollbarConfig } from "./plugins/scrollbar/scrollbar";

// =============================================================================
// Stats utility
// =============================================================================

export {
  createStats,
  type StatsConfig,
  type StatsState,
  type Stats,
} from "./utils/stats";