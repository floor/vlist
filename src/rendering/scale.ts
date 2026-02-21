/**
 * vlist - Compression Module
 * Pure functions for handling large lists that exceed browser height limits
 *
 * When a list's total height (totalItems × itemHeight) exceeds the browser's
 * maximum element height (~16.7M pixels), we "compress" the virtual scroll space.
 *
 * Key concepts:
 * - actualHeight: The true height if all items were rendered
 * - virtualHeight: The capped height used for the scroll container (≤ MAX_VIRTUAL_HEIGHT)
 * - compressionRatio: virtualHeight / actualHeight (1 = no compression, <1 = compressed)
 *
 * When compressed:
 * - Scroll position maps to item index via ratio, not pixel math
 * - Item positions are calculated relative to a "virtual index" at current scroll
 * - Near-bottom interpolation ensures the last items are reachable
 */

import type { Range } from "../types";
import { MAX_VIRTUAL_HEIGHT } from "../constants";
import type { SizeCache } from "./sizes";
import {
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
} from "./sizes";

// Re-export for convenience
export { MAX_VIRTUAL_HEIGHT };

// =============================================================================
// Compression State
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
 * Calculate compression state for a list
 * Pure function - no side effects
 */
export const getCompressionState = (
  _totalItems: number,
  sizeCache: SizeCache,
): CompressionState => {
  const actualHeight = sizeCache.getTotalSize();
  const isCompressed = actualHeight > MAX_VIRTUAL_HEIGHT;
  const virtualHeight = isCompressed ? MAX_VIRTUAL_HEIGHT : actualHeight;
  const ratio = actualHeight > 0 ? virtualHeight / actualHeight : 1;

  return {
    isCompressed,
    actualHeight,
    virtualHeight,
    ratio,
  };
};

// =============================================================================
// Range Calculations (Compressed)
// =============================================================================

/**
 * Calculate visible range with compression support
 * Pure function - no side effects
 *
 * @param scrollTop - Current scroll position
 * @param containerHeight - Viewport container height
 * @param sizeCache - Size cache for item sizes/offsets
 * @param totalItems - Total number of items
 * @param compression - Compression state
 * @param out - Output range to mutate (avoids allocation on hot path)
 */
export const calculateCompressedVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  sizeCache: SizeCache,
  totalItems: number,
  compression: CompressionState,
  out: Range,
): Range => {
  if (totalItems === 0 || containerHeight === 0) {
    out.start = 0;
    out.end = -1;
    return out;
  }

  if (!compression.isCompressed) {
    // Normal calculation using size cache
    const start = sizeCache.indexAtOffset(scrollTop);
    // Find the last item that is at least partially visible
    // Add 1 to match the fixed-height ceil() behavior (safe overshoot)
    let end = sizeCache.indexAtOffset(scrollTop + containerHeight);
    if (end < totalItems - 1) end++;
    out.start = Math.max(0, start);
    out.end = Math.min(totalItems - 1, Math.max(0, end));
    return out;
  }

  // Compressed calculation
  const { virtualHeight } = compression;
  const scrollRatio = scrollTop / virtualHeight;
  const exactIndex = scrollRatio * totalItems;

  let start = Math.floor(exactIndex);

  // Count visible items from start using actual heights
  const visibleCount = countVisibleItems(
    sizeCache,
    Math.max(0, start),
    containerHeight,
    totalItems,
  );
  let end = Math.ceil(exactIndex) + visibleCount;

  // Near-bottom interpolation
  // This ensures we can reach the actual last items
  const maxScroll = virtualHeight - containerHeight;
  const distanceFromBottom = maxScroll - scrollTop;

  if (distanceFromBottom <= containerHeight && distanceFromBottom >= -1) {
    const itemsAtBottom = countItemsFittingFromBottom(
      sizeCache,
      containerHeight,
      totalItems,
    );
    const firstVisibleAtBottom = Math.max(0, totalItems - itemsAtBottom);

    // Interpolation factor: 0 at threshold, 1 at bottom
    const interpolation = Math.max(
      0,
      Math.min(1, 1 - distanceFromBottom / containerHeight),
    );

    // Blend between normal compressed position and actual bottom position
    start = Math.floor(start + (firstVisibleAtBottom - start) * interpolation);

    // At the very bottom, ensure we show the last item
    end =
      distanceFromBottom <= 1
        ? totalItems - 1
        : Math.min(totalItems - 1, start + visibleCount);
  }

  out.start = Math.max(0, start);
  out.end = Math.min(totalItems - 1, Math.max(0, end));
  return out;
};

/**
 * Calculate render range with compression support (adds overscan)
 * Pure function - no side effects
 *
 * @param out - Output range to mutate (avoids allocation on hot path)
 */
export const calculateCompressedRenderRange = (
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

// =============================================================================
// Item Positioning (Compressed)
// =============================================================================

/**
 * Calculate item position (translateY) with compression support
 * Pure function - no side effects
 *
 * In compressed mode (manual wheel scrolling, overflow: hidden), items are
 * positioned RELATIVE TO THE VIEWPORT. The scroll container doesn't actually
 * scroll - we intercept wheel events and manually position items.
 *
 * Key insight:
 * - Calculate a "virtual scroll index" from the scroll ratio
 * - Items are positioned relative to this virtual index using actual heights
 * - Each item keeps its full height for proper rendering
 *
 * @param index - Item index
 * @param scrollTop - Current (virtual) scroll position
 * @param sizeCache - Size cache for item sizes/offsets
 * @param totalItems - Total number of items
 * @param containerHeight - Viewport container height
 * @param compression - Compression state
 */
export const calculateCompressedItemPosition = (
  index: number,
  scrollTop: number,
  sizeCache: SizeCache,
  totalItems: number,
  containerHeight: number,
  compression: CompressionState,
  _rangeStart?: number,
): number => {
  if (!compression.isCompressed || totalItems === 0) {
    // Normal: absolute position in content space (scroll handled by container)
    return sizeCache.getOffset(index);
  }

  const { virtualHeight } = compression;
  const maxScroll = virtualHeight - containerHeight;
  const distanceFromBottom = maxScroll - scrollTop;

  // Near-bottom interpolation: ensures we can smoothly reach the last items
  if (distanceFromBottom <= containerHeight && distanceFromBottom >= -1) {
    // Special case: at exact max scroll, position items from bottom up
    if (scrollTop >= maxScroll - 1) {
      // Calculate position from the bottom of the viewport
      const totalHeightFromBottom =
        sizeCache.getTotalSize() - sizeCache.getOffset(index);
      return containerHeight - totalHeightFromBottom;
    }

    const itemsAtBottom = countItemsFittingFromBottom(
      sizeCache,
      containerHeight,
      totalItems,
    );
    const firstVisibleAtBottom = Math.max(0, totalItems - itemsAtBottom);
    const scrollRatio = scrollTop / virtualHeight;
    const exactScrollIndex = scrollRatio * totalItems;

    // Interpolation factor: 0 at threshold, 1 at bottom
    const interpolation = Math.max(
      0,
      Math.min(1, 1 - distanceFromBottom / containerHeight),
    );

    // Bottom position: offset relative to first visible item at bottom
    const bottomPosition =
      sizeCache.getOffset(index) - sizeCache.getOffset(firstVisibleAtBottom);

    // Normal compressed position: offset relative to virtual scroll index
    const normalPosition =
      sizeCache.getOffset(index) -
      getOffsetForVirtualIndex(sizeCache, exactScrollIndex, totalItems);

    // Blend between compressed position and actual bottom position
    return normalPosition + (bottomPosition - normalPosition) * interpolation;
  }

  // Normal compressed positioning
  //
  // Map scrollTop to an actual-space offset via the compression ratio,
  // then position the item relative to that offset.
  const scrollRatio = scrollTop / virtualHeight;
  const actualHeight = sizeCache.getTotalSize();
  const virtualScrollOffset = scrollRatio * actualHeight;

  return sizeCache.getOffset(index) - virtualScrollOffset;
};

// =============================================================================
// Scroll Position Calculations (Compressed)
// =============================================================================

/**
 * Calculate scroll position to bring an index into view (with compression)
 * Pure function - no side effects
 *
 * @param index - Target item index
 * @param sizeCache - Size cache for item sizes/offsets
 * @param containerHeight - Viewport container height
 * @param totalItems - Total number of items
 * @param compression - Compression state
 * @param align - Alignment within viewport
 */
export const calculateCompressedScrollToIndex = (
  index: number,
  sizeCache: SizeCache,
  containerHeight: number,
  totalItems: number,
  compression: CompressionState,
  align: "start" | "center" | "end" = "start",
): number => {
  if (totalItems === 0) return 0;

  let targetPosition: number;

  if (compression.isCompressed) {
    // Special case: last item with "end" alignment should go to max scroll
    // to avoid gap at bottom due to compression ratio precision
    if (align === "end" && index === totalItems - 1) {
      return Math.max(0, compression.virtualHeight - containerHeight);
    }

    // Map index to compressed scroll position
    const ratio = index / totalItems;
    targetPosition = ratio * compression.virtualHeight;
  } else {
    // Direct calculation using actual offset
    targetPosition = sizeCache.getOffset(index);
  }

  // Adjust for alignment using the specific item's size
  const itemSize = sizeCache.getSize(index);

  switch (align) {
    case "center":
      targetPosition -= (containerHeight - itemSize) / 2;
      break;
    case "end":
      targetPosition -= containerHeight - itemSize;
      break;
  }

  // Clamp to valid range
  const maxScroll = compression.virtualHeight - containerHeight;
  return Math.max(0, Math.min(targetPosition, maxScroll));
};

/**
 * Calculate the approximate item index at a given scroll position
 * Useful for debugging and scroll position restoration
 * Pure function - no side effects
 */
export const calculateIndexFromScrollPosition = (
  scrollTop: number,
  sizeCache: SizeCache,
  totalItems: number,
  compression: CompressionState,
): number => {
  if (totalItems === 0) return 0;

  if (compression.isCompressed) {
    const scrollRatio = scrollTop / compression.virtualHeight;
    return Math.floor(scrollRatio * totalItems);
  }

  return sizeCache.indexAtOffset(scrollTop);
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if compression is needed for a list configuration
 * Pure function - no side effects
 *
 * Note: This overload accepts a HeightCache for variable heights.
 * For simple fixed-height checks, use needsCompressionFixed().
 */
export const needsCompression = (
  totalItems: number,
  heightOrCache: number | SizeCache,
): boolean => {
  if (typeof heightOrCache === "number") {
    return totalItems * heightOrCache > MAX_VIRTUAL_HEIGHT;
  }
  return heightOrCache.getTotalSize() > MAX_VIRTUAL_HEIGHT;
};

/**
 * Calculate maximum items supported without compression
 * Only meaningful for fixed-height items
 * Pure function - no side effects
 */
export const getMaxItemsWithoutCompression = (itemSize: number): number => {
  if (itemSize <= 0) return 0;
  return Math.floor(MAX_VIRTUAL_HEIGHT / itemSize);
};

/**
 * Get human-readable compression info for debugging
 * Pure function - no side effects
 */
export const getCompressionInfo = (
  totalItems: number,
  sizeCache: SizeCache,
): string => {
  const compression = getCompressionState(totalItems, sizeCache);

  if (!compression.isCompressed) {
    return `No compression needed (${totalItems} items, ${(compression.actualHeight / 1_000_000).toFixed(2)}M px)`;
  }

  const ratioPercent = (compression.ratio * 100).toFixed(1);
  return `Compressed to ${ratioPercent}% (${totalItems} items, ${(compression.actualHeight / 1_000_000).toFixed(1)}M px → ${(compression.virtualHeight / 1_000_000).toFixed(1)}M px virtual)`;
};
