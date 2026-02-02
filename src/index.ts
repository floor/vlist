/**
 * vlist - Lightweight Virtual List
 * High-performance virtual scrolling with zero dependencies
 *
 * @packageDocumentation
 */

// Main factory
export { createVList } from './vlist';

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
} from './types';

// Core utilities (for advanced usage)
export {
  // Virtual scrolling calculations
  calculateVisibleRange,
  calculateRenderRange,
  calculateTotalHeight,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  rangesEqual,
  isInRange,
  getRangeCount,
  diffRanges,
} from './core/virtual';

export {
  // Selection state management
  createSelectionState,
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  isSelected,
  getSelectedIds,
  getSelectedItems,
} from './core/selection';

export {
  // Event emitter
  createEmitter,
  type Emitter,
} from './core/events';
