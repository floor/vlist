/**
 * vlist - Virtual Scrolling Core
 * Pure functions for virtual scroll calculations
 *
 * Compression support is NOT imported here — it's injected via
 * CompressionState parameters. When compression is inactive
 * (the common case), all calculations use simple size-cache math
 * with zero dependency on the compression module.
 *
 * This keeps the builder core lightweight. The withCompression plugin
 * and the monolithic createVList entry point import compression
 * separately and pass the state in.
 */

import type { Range, ViewportState } from "../types";
import type { SizeCache } from "./sizes";

// =============================================================================
// Compression State (type only — no runtime import)
// =============================================================================

/** Compression calculation result */
export interface CompressionState {
  /** Whether compression is active */
  isCompressed: boolean;

  /** The actual total height */
  actualHeight: number;

  /** The virtual height (capped at MAX_VIRTUAL_HEIGHT) */
  virtualHeight: number;

  /** Compression ratio (1 = no compression, <1 = compressed) */
  ratio: number;
}

/**
 * A "no compression" state for lists that don't need it.
 * Used by the builder core when withCompression is not installed.
 */
export const NO_COMPRESSION: CompressionState = {
  isCompressed: false,
  actualHeight: 0,
  virtualHeight: 0,
  ratio: 1,
};

/**
 * Create a trivial compression state from a size cache.
 * No compression logic — just reads the total height.
 * For use when the full compression module is not loaded.
 */
export const getSimpleCompressionState = (
  _totalItems: number,
  sizeCache: SizeCache,
): CompressionState => {
  const h = sizeCache.getTotalSize();
  return {
    isCompressed: false,
    actualHeight: h,
    virtualHeight: h,
    ratio: 1,
  };
};

// =============================================================================
// Visible-range callbacks (injectable by compression module)
// =============================================================================

/**
 * Signature for the function that calculates the visible item range.
 * The compression module provides a version that handles compressed scroll;
 * virtual.ts provides a simple fallback for non-compressed lists.
 */
export type VisibleRangeFn = (
  scrollTop: number,
  containerHeight: number,
  sizeCache: SizeCache,
  totalItems: number,
  compression: CompressionState,
  out: Range,
) => Range;

/**
 * Signature for the scroll-to-index calculator.
 */
export type ScrollToIndexFn = (
  index: number,
  sizeCache: SizeCache,
  containerHeight: number,
  totalItems: number,
  compression: CompressionState,
  align: "start" | "center" | "end",
) => number;

// =============================================================================
// Simple (non-compressed) range calculation
// =============================================================================

/**
 * Calculate visible range using size cache lookups.
 * Fast path for lists that don't need compression (< ~350 000 items at 48px).
 * Mutates `out` to avoid allocation on the scroll hot path.
 */
export const simpleVisibleRange: VisibleRangeFn = (
  scrollTop,
  containerHeight,
  sizeCache,
  totalItems,
  _compression,
  out,
) => {
  if (totalItems === 0 || containerHeight === 0) {
    out.start = 0;
    out.end = -1;
    return out;
  }

  const start = sizeCache.indexAtOffset(scrollTop);
  let end = sizeCache.indexAtOffset(scrollTop + containerHeight);
  if (end < totalItems - 1) end++;

  out.start = Math.max(0, start);
  out.end = Math.min(totalItems - 1, Math.max(0, end));
  return out;
};

/**
 * Calculate render range (adds overscan around visible range).
 * This function is compression-agnostic — works for both paths.
 * Mutates `out` to avoid allocation on the scroll hot path.
 */
export const calculateRenderRange = (
  visibleRange: Range,
  overscan: number,
  totalItems: number,
  out: Range,
): Range => {
  if (totalItems === 0) {
    out.start = 0;
    out.end = -1;
    return out;
  }

  out.start = Math.max(0, visibleRange.start - overscan);
  out.end = Math.min(totalItems - 1, visibleRange.end + overscan);
  return out;
};

/**
 * Simple scroll-to-index calculation (non-compressed).
 * Uses size cache offsets directly.
 */
export const simpleScrollToIndex: ScrollToIndexFn = (
  index,
  sizeCache,
  containerHeight,
  totalItems,
  _compression,
  align,
) => {
  if (totalItems === 0) return 0;

  const safeIndex = Math.max(0, Math.min(index, totalItems - 1));
  const itemOffset = sizeCache.getOffset(safeIndex);
  const itemSize = sizeCache.getSize(safeIndex);
  const totalHeight = sizeCache.getTotalSize();
  const maxScroll = Math.max(0, totalHeight - containerHeight);

  let position: number;

  switch (align) {
    case "center":
      position = itemOffset - containerHeight / 2 + itemSize / 2;
      break;
    case "end":
      position = itemOffset - containerHeight + itemSize;
      break;
    case "start":
    default:
      position = itemOffset;
      break;
  }

  return Math.max(0, Math.min(position, maxScroll));
};

// =============================================================================
// Calculate total content height
// =============================================================================

/**
 * Calculate total content height.
 * Uses compression's virtualHeight when compressed, raw height otherwise.
 */
export const calculateTotalHeight = (
  _totalItems: number,
  sizeCache: SizeCache,
  compression?: CompressionState | null,
): number => {
  if (compression && compression.isCompressed) {
    return compression.virtualHeight;
  }
  return sizeCache.getTotalSize();
};

/**
 * Calculate actual total height (without compression cap)
 */
export const calculateActualHeight = (
  _totalItems: number,
  sizeCache: SizeCache,
): number => {
  return sizeCache.getTotalSize();
};

/**
 * Calculate the offset (translateY) for an item
 * For non-compressed lists only
 */
export const calculateItemOffset = (
  index: number,
  sizeCache: SizeCache,
): number => {
  return sizeCache.getOffset(index);
};

// =============================================================================
// Scroll helpers
// =============================================================================

/**
 * Clamp scroll position to valid range
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
 * Create initial viewport state.
 *
 * Accepts an optional `visibleRangeFn` so that compression-aware callers
 * can inject the compressed version. Defaults to `simpleVisibleRange`.
 */
export const createViewportState = (
  containerHeight: number,
  sizeCache: SizeCache,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
  visibleRangeFn: VisibleRangeFn = simpleVisibleRange,
): ViewportState => {
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };

  visibleRangeFn(
    0,
    containerHeight,
    sizeCache,
    totalItems,
    compression,
    visibleRange,
  );
  calculateRenderRange(visibleRange, overscan, totalItems, renderRange);

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
 * Update viewport state after scroll.
 * Mutates state in place for performance on the scroll hot path.
 */
export const updateViewportState = (
  state: ViewportState,
  scrollTop: number,
  sizeCache: SizeCache,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
  visibleRangeFn: VisibleRangeFn = simpleVisibleRange,
): ViewportState => {
  visibleRangeFn(
    scrollTop,
    state.containerHeight,
    sizeCache,
    totalItems,
    compression,
    state.visibleRange,
  );
  calculateRenderRange(
    state.visibleRange,
    overscan,
    totalItems,
    state.renderRange,
  );

  state.scrollTop = scrollTop;

  return state;
};

/**
 * Update viewport state when container resizes.
 * Mutates state in place for performance.
 */
export const updateViewportSize = (
  state: ViewportState,
  containerHeight: number,
  sizeCache: SizeCache,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
  visibleRangeFn: VisibleRangeFn = simpleVisibleRange,
): ViewportState => {
  visibleRangeFn(
    state.scrollTop,
    containerHeight,
    sizeCache,
    totalItems,
    compression,
    state.visibleRange,
  );
  calculateRenderRange(
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
 * Update viewport state when total items changes.
 * Mutates state in place for performance.
 */
export const updateViewportItems = (
  state: ViewportState,
  sizeCache: SizeCache,
  totalItems: number,
  overscan: number,
  compression: CompressionState,
  visibleRangeFn: VisibleRangeFn = simpleVisibleRange,
): ViewportState => {
  visibleRangeFn(
    state.scrollTop,
    state.containerHeight,
    sizeCache,
    totalItems,
    compression,
    state.visibleRange,
  );
  calculateRenderRange(
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
// calculateScrollToIndex (public API)
// =============================================================================

/**
 * Calculate scroll position to bring an index into view.
 *
 * Accepts an optional `scrollToIndexFn` so that compression-aware callers
 * can inject the compressed version. Defaults to `simpleScrollToIndex`.
 */
export const calculateScrollToIndex = (
  index: number,
  sizeCache: SizeCache,
  containerHeight: number,
  totalItems: number,
  align: "start" | "center" | "end" = "start",
  compression: CompressionState,
  scrollToIndexFn: ScrollToIndexFn = simpleScrollToIndex,
): number => {
  return scrollToIndexFn(
    index,
    sizeCache,
    containerHeight,
    totalItems,
    compression,
    align,
  );
};

// =============================================================================
// Range Utilities
// =============================================================================

/**
 * Check if two ranges are equal
 */
export const rangesEqual = (a: Range, b: Range): boolean => {
  return a.start === b.start && a.end === b.end;
};

/**
 * Check if an index is within a range
 */
export const isInRange = (index: number, range: Range): boolean => {
  return index >= range.start && index <= range.end;
};

/**
 * Get the count of items in a range
 */
export const getRangeCount = (range: Range): number => {
  if (range.end < range.start) return 0;
  return range.end - range.start + 1;
};

/**
 * Create an array of indices from a range
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
 */
export const diffRanges = (
  oldRange: Range,
  newRange: Range,
): { add: number[]; remove: number[] } => {
  const add: number[] = [];
  const remove: number[] = [];

  for (let i = oldRange.start; i <= oldRange.end; i++) {
    if (i < newRange.start || i > newRange.end) {
      remove.push(i);
    }
  }

  for (let i = newRange.start; i <= newRange.end; i++) {
    if (i < oldRange.start || i > oldRange.end) {
      add.push(i);
    }
  }

  return { add, remove };
};
