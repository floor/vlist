/**
 * vlist - Lightweight Virtual List
 * High-performance virtual scrolling with zero dependencies
 * Builder-only API for optimal tree-shaking
 *
 * @packageDocumentation
 */

// Main builder export
export { vlist } from "./builder";

// Feature plugins - tree-shakeable
export { withScale } from "./features/scale";
export { withAsync } from "./features/async";
export { withScrollbar } from "./features/scrollbar";
export { withPage } from "./features/page";
export { withSections } from "./features/sections";
export { withGrid } from "./features/grid";
export { withSelection } from "./features/selection";
export { withSnapshots } from "./features/snapshots";

// Core Types
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
  ScrollbarOptions,

  // Scroll
  ScrollConfig,
  ScrollToOptions,
  ScrollSnapshot,

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

// Builder types
export type {
  VListBuilder,
  BuiltVList,
  BuilderConfig,
  VListPlugin,
  BuilderContext,
} from "./builder";

// Sections domain (grouped lists with headers)
export {
  createGroupLayout as createSectionLayout,
  buildLayoutItems,
  createGroupedHeightFn as createSectionedHeightFn,
  createStickyHeader,
  isGroupHeader as isSectionHeader,
  type GroupsConfig as SectionsConfig,
  type GroupBoundary as SectionBoundary,
  type LayoutEntry,
  type GroupHeaderItem as SectionHeaderItem,
  type GroupLayout as SectionLayout,
  type StickyHeader,
} from "./features/sections";

// Grid domain (2D grid/card layout)
export {
  createGridLayout,
  createGridRenderer,
  type GridConfig,
  type GridLayout,
  type GridPosition,
  type GridRenderer,
  type ItemRange,
} from "./features/grid";

// Rendering domain (virtual scrolling, height cache, scaling)
export {
  // Height cache (variable item heights)
  createHeightCache,
  type HeightCache,
  // Virtual scrolling calculations
  simpleVisibleRange,
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
  // Scale utilities (for handling 1M+ items)
  MAX_VIRTUAL_HEIGHT,
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
} from "./features/selection";

// Events domain
export { createEmitter, type Emitter } from "./events";

// Async domain (for advanced usage)
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

// Scrollbar domain (for advanced usage)
export {
  createScrollController,
  createScrollbar,
  rafThrottle,
  type ScrollController,
  type Scrollbar,
} from "./features/scrollbar";
