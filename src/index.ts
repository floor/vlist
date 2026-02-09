/**
 * vlist - Lightweight Virtual List
 * High-performance virtual scrolling with zero dependencies
 * Supports compression for handling 1M+ items
 *
 * @packageDocumentation
 */

// Main factory
export { createVList } from "./vlist";

// Types
export type {
  // Core types
  VList,
  VListConfig,
  VListItem,
  VListEvents,

  // Template
  ItemTemplate,
  ItemState,

  // Selection
  SelectionMode,
  SelectionConfig,
  SelectionState,

  // Scrollbar
  ScrollbarConfig,

  // Scroll
  ScrollToOptions,

  // Data adapter
  VListAdapter,
  AdapterParams,
  AdapterResponse,

  // Viewport
  Range,
  ViewportState,

  // Events
  EventHandler,
  Unsubscribe,
} from "./types";

// Groups domain (sticky headers / grouped lists)
export {
  createGroupLayout,
  buildLayoutItems,
  createGroupedHeightFn,
  createStickyHeader,
  isGroupHeader,
  type GroupsConfig,
  type GroupBoundary,
  type LayoutEntry,
  type GroupHeaderItem,
  type GroupLayout,
  type StickyHeader,
} from "./groups";

// Grid domain (2D grid/card layout)
export {
  createGridLayout,
  createGridRenderer,
  type GridConfig,
  type GridLayout,
  type GridPosition,
  type GridRenderer,
  type ItemRange,
} from "./grid";

// Render domain (virtual scrolling, compression, height cache)
export {
  // Height cache (variable item heights)
  createHeightCache,
  type HeightCache,
  // Virtual scrolling calculations
  calculateVisibleRange,
  calculateRenderRange,
  calculateTotalHeight,
  calculateActualHeight,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  rangesEqual,
  isInRange,
  getRangeCount,
  diffRanges,
  // Compression utilities (for handling 1M+ items)
  MAX_VIRTUAL_HEIGHT,
  getCompressionState,
  getCompression,
  needsCompression,
  getMaxItemsWithoutCompression,
  getCompressionInfo,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  calculateIndexFromScrollPosition,
  type CompressionState,
} from "./render";

// Selection domain
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
} from "./selection";

// Events domain
export { createEmitter, type Emitter } from "./events";

// Data domain (for advanced usage)
export {
  createDataManager,
  createSparseStorage,
  createPlaceholderManager,
  isPlaceholderItem,
  filterPlaceholders,
  mergeRanges,
  calculateMissingRanges,
  type DataManager,
  type SparseStorage,
  type PlaceholderManager,
} from "./data";

// Scroll domain (for advanced usage)
export {
  createScrollController,
  createScrollbar,
  rafThrottle,
  type ScrollController,
  type Scrollbar,
} from "./scroll";
