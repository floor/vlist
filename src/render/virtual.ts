/**
 * vlist - Virtual Scrolling Core
 * Pure functions for virtual scroll calculations with compression support
 *
 * Compression is automatically applied when the total list height exceeds
 * browser limits (~16M pixels). This allows handling millions of items.
 */

import type { Range, ViewportState } from "../types";
import {
  getCompressionState,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedScrollToIndex,
  type CompressionState,
} from "./compression";

// =============================================================================
// Re-export compression utilities
// =============================================================================

export {
  MAX_VIRTUAL_HEIGHT,
  getCompressionState,
  needsCompression,
} from "./compression";
export type { CompressionState } from "./compression";

// =============================================================================
// Range Calculations
// =============================================================================

/**
 * Calculate the visible range of items based on scroll position
 * Automatically handles compression for large lists
 * Pure function - no side effects
 */
export const calculateVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  compression: CompressionState,
  out: Range,
): Range => {
  return calculateCompressedVisibleRange(
    scrollTop,
    containerHeight,
    itemHeight,
    totalItems,
    compression,
    out,
  );
};

/**
 * Calculate the render range (visible + overscan buffer)
 * Pure function - no side effects
 */
export const calculateRenderRange = (
  visibleRange: Range,
  overscan: number,
  totalItems: number,
  out: Range,
): Range => {
  return calculateCompressedRenderRange(
    visibleRange,
    overscan,
    totalItems,
    out,
  );
};

/**
 * Calculate total content height (capped for compression)
 * Pure function - no side effects
 */
export const calculateTotalHeight = (
  totalItems: number,
  itemHeight: number,
): number => {
  const compression = getCompressionState(totalItems, itemHeight);
  return compression.virtualHeight;
};

/**
 * Calculate actual total height (without compression cap)
 * Pure function - no side effects
 */
export const calculateActualHeight = (
  totalItems: number,
  itemHeight: number,
): number => {
  return totalItems * itemHeight;
};

/**
 * Calculate the offset (translateY) for an item
 * For non-compressed lists only - use calculateCompressedItemPosition for compressed
 * Pure function - no side effects
 */
export const calculateItemOffset = (
  index: number,
  itemHeight: number,
): number => {
  return index * itemHeight;
};

// =============================================================================
// Scroll Position Calculations
// =============================================================================

/**
 * Calculate scroll position to bring an index into view
 * Automatically handles compression for large lists
 * Pure function - no side effects
 */
export const calculateScrollToIndex = (
  index: number,
  itemHeight: number,
  containerHeight: number,
  totalItems: number,
  align: "start" | "center" | "end" = "start",
  compression: CompressionState,
): number => {
  return calculateCompressedScrollToIndex(
    index,
    itemHeight,
    containerHeight,
    totalItems,
    compression,
    align,
  );
};

/**
 * Clamp scroll position to valid range
 * Pure function - no side effects
 */
export const clampScrollPosition = (
  scrollTop: number,
  totalHeight: number,
  containerHeight: number,
): number => {
  const maxScroll = Math.max(0, totalHeight - containerHeight);
  return Math.max(0, Math.min(scrollTop, maxScroll));
};

/**
 * Determine scroll direction
 * Pure function - no side effects
 */
export const getScrollDirection = (
  currentScrollTop: number,
  previousScrollTop: number,
): "up" | "down" => {
  return currentScrollTop >= previousScrollTop ? "down" : "up";
};

// =============================================================================
// Viewport State
// =============================================================================

/**
 * Create initial viewport state with compression support
 * Pure function - no side effects
 */
export const createViewportState = (
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
): ViewportState => {
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };

  calculateCompressedVisibleRange(
    0,
    containerHeight,
    itemHeight,
    totalItems,
    compression,
    visibleRange,
  );
  calculateCompressedRenderRange(
    visibleRange,
    overscan,
    totalItems,
    renderRange,
  );

  return {
    scrollTop: 0,
    containerHeight,
    totalHeight: compression.virtualHeight,
    actualHeight: compression.actualHeight,
    isCompressed: compression.isCompressed,
    compressionRatio: compression.ratio,
    visibleRange,
    renderRange,
  };
};

/**
 * Update viewport state after scroll
 * Mutates state in place for performance on scroll hot path
 */
export const updateViewportState = (
  state: ViewportState,
  scrollTop: number,
  itemHeight: number,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
): ViewportState => {
  calculateCompressedVisibleRange(
    scrollTop,
    state.containerHeight,
    itemHeight,
    totalItems,
    compression,
    state.visibleRange,
  );
  calculateCompressedRenderRange(
    state.visibleRange,
    overscan,
    totalItems,
    state.renderRange,
  );

  state.scrollTop = scrollTop;

  return state;
};

/**
 * Update viewport state when container resizes
 * Mutates state in place for performance
 */
export const updateViewportSize = (
  state: ViewportState,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
): ViewportState => {
  calculateCompressedVisibleRange(
    state.scrollTop,
    containerHeight,
    itemHeight,
    totalItems,
    compression,
    state.visibleRange,
  );
  calculateCompressedRenderRange(
    state.visibleRange,
    overscan,
    totalItems,
    state.renderRange,
  );

  state.containerHeight = containerHeight;
  state.totalHeight = compression.virtualHeight;
  state.actualHeight = compression.actualHeight;
  state.isCompressed = compression.isCompressed;
  state.compressionRatio = compression.ratio;

  return state;
};

/**
 * Update viewport state when total items changes
 * Mutates state in place for performance
 */
export const updateViewportItems = (
  state: ViewportState,
  itemHeight: number,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
): ViewportState => {
  calculateCompressedVisibleRange(
    state.scrollTop,
    state.containerHeight,
    itemHeight,
    totalItems,
    compression,
    state.visibleRange,
  );
  calculateCompressedRenderRange(
    state.visibleRange,
    overscan,
    totalItems,
    state.renderRange,
  );

  state.totalHeight = compression.virtualHeight;
  state.actualHeight = compression.actualHeight;
  state.isCompressed = compression.isCompressed;
  state.compressionRatio = compression.ratio;

  return state;
};

// =============================================================================
// Range Utilities
// =============================================================================

/**
 * Check if two ranges are equal
 * Pure function - no side effects
 */
export const rangesEqual = (a: Range, b: Range): boolean => {
  return a.start === b.start && a.end === b.end;
};

/**
 * Check if an index is within a range
 * Pure function - no side effects
 */
export const isInRange = (index: number, range: Range): boolean => {
  return index >= range.start && index <= range.end;
};

/**
 * Get the count of items in a range
 * Pure function - no side effects
 */
export const getRangeCount = (range: Range): number => {
  if (range.end < range.start) return 0;
  return range.end - range.start + 1;
};

/**
 * Create an array of indices from a range
 * Pure function - no side effects
 */
export const rangeToIndices = (range: Range): number[] => {
  const indices: number[] = [];
  for (let i = range.start; i <= range.end; i++) {
    indices.push(i);
  }
  return indices;
};

/**
 * Calculate which indices need to be added/removed when range changes
 * Pure function - no side effects
 */
export const diffRanges = (
  oldRange: Range,
  newRange: Range,
): { add: number[]; remove: number[] } => {
  const add: number[] = [];
  const remove: number[] = [];

  // Find indices to remove (in old but not in new)
  for (let i = oldRange.start; i <= oldRange.end; i++) {
    if (i < newRange.start || i > newRange.end) {
      remove.push(i);
    }
  }

  // Find indices to add (in new but not in old)
  for (let i = newRange.start; i <= newRange.end; i++) {
    if (i < oldRange.start || i > oldRange.end) {
      add.push(i);
    }
  }

  return { add, remove };
};
