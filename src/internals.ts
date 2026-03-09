/**
 * vlist/internals - Low-Level Exports
 *
 * Advanced utilities for feature authors, custom renderers, and power users.
 * These are implementation details — use at your own risk.
 *
 * For the stable public API, import from '@floor/vlist' instead.
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
} from "./features/groups";

// =============================================================================
// Grid domain
// =============================================================================

export {
  createGridLayout,
  createGridRenderer,
  type GridConfig,
  type GridLayout,
  type GridPosition,
  type GridRenderer,
  type ItemRange,
} from "./features/grid";

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
} from "./features/table";

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
} from "./features/masonry";

// =============================================================================
// Rendering domain (virtual scrolling, size cache, scaling)
// =============================================================================

export {
  // Size cache (variable item sizes - works for both vertical and horizontal)
  createSizeCache,
  type SizeCache,
  // Measured size cache (auto-measurement for Mode B)
  createMeasuredSizeCache,
  type MeasuredSizeCache,
  // Virtual scrolling calculations
  simpleVisibleRange,
  calculateRenderRange,
  calculateTotalSize,
  calculateActualSize,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  rangesEqual,
  isInRange,
  getRangeCount,
  diffRanges,
  // Scale utilities (for handling 1M+ items)
  MAX_VIRTUAL_SIZE,
  getCompressionState as getScaleState,
  getCompression as getScale,
  needsCompression as needsScaling,
  getMaxItemsWithoutCompression as getMaxItemsWithoutScaling,
  getCompressionInfo as getScaleInfo,
  calculateCompressedVisibleRange as calculateScaledVisibleRange,
  calculateCompressedRenderRange as calculateScaledRenderRange,
  calculateCompressedItemPosition as calculateScaledItemPosition,
  calculateCompressedScrollToIndex as calculateScaledScrollToIndex,
  calculateIndexFromScrollPosition,
  type CompressionState as ScaleState,
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
  getSelectedItems,
} from "./features/selection";

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
} from "./features/async";

// =============================================================================
// Scrollbar domain
// =============================================================================

export {
  createScrollController,
  createScrollbar,
  rafThrottle,
  type ScrollController,
  type Scrollbar,
} from "./features/scrollbar";

// =============================================================================
// Stats utility
// =============================================================================

export {
  createStats,
  type StatsConfig,
  type StatsState,
  type Stats,
} from "./utils/stats";