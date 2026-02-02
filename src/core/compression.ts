/**
 * vlist - Compression Module
 * Pure functions for handling large lists that exceed browser height limits
 *
 * When a list's total height (totalItems × itemHeight) exceeds the browser's
 * maximum element height (~16.7M pixels), we "compress" the virtual scroll space.
 *
 * Key concepts:
 * - actualHeight: The true height if all items were rendered (totalItems × itemHeight)
 * - virtualHeight: The capped height used for the scroll container (≤ MAX_VIRTUAL_HEIGHT)
 * - compressionRatio: virtualHeight / actualHeight (1 = no compression, <1 = compressed)
 *
 * When compressed:
 * - Scroll position maps to item index via ratio, not pixel math
 * - Item positions are calculated relative to a "virtual index" at current scroll
 * - Near-bottom interpolation ensures the last items are reachable
 */

import type { Range } from "../types";

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum virtual height in pixels
 * Most browsers support ~16.7M pixels, we use 16M for safety margin
 */
export const MAX_VIRTUAL_HEIGHT = 16_000_000;

// =============================================================================
// Compression State
// =============================================================================

/** Compression calculation result */
export interface CompressionState {
  /** Whether compression is active */
  isCompressed: boolean;

  /** The actual total height (totalItems × itemHeight) */
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
  totalItems: number,
  itemHeight: number,
): CompressionState => {
  const actualHeight = totalItems * itemHeight;
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
 * @param itemHeight - Height of each item
 * @param totalItems - Total number of items
 * @param compression - Compression state
 */
export const calculateCompressedVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  compression: CompressionState,
): Range => {
  if (totalItems === 0 || itemHeight === 0) {
    return { start: 0, end: 0 };
  }

  const visibleCount = Math.ceil(containerHeight / itemHeight);

  if (!compression.isCompressed) {
    // Normal calculation
    const start = Math.floor(scrollTop / itemHeight);
    const end = Math.min(start + visibleCount, totalItems - 1);
    return {
      start: Math.max(0, start),
      end: Math.max(0, end),
    };
  }

  // Compressed calculation
  const { virtualHeight } = compression;
  const scrollRatio = scrollTop / virtualHeight;
  const exactIndex = scrollRatio * totalItems;

  let start = Math.floor(exactIndex);
  let end = Math.ceil(exactIndex) + visibleCount;

  // Near-bottom interpolation
  // This ensures we can reach the actual last items
  const maxScroll = virtualHeight - containerHeight;
  const distanceFromBottom = maxScroll - scrollTop;

  if (distanceFromBottom <= containerHeight && distanceFromBottom >= -1) {
    const itemsAtBottom = Math.floor(containerHeight / itemHeight);
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

  return {
    start: Math.max(0, start),
    end: Math.min(totalItems - 1, Math.max(0, end)),
  };
};

/**
 * Calculate render range with compression support (adds overscan)
 * Pure function - no side effects
 */
export const calculateCompressedRenderRange = (
  visibleRange: Range,
  overscan: number,
  totalItems: number,
): Range => {
  if (totalItems === 0) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.max(0, visibleRange.start - overscan),
    end: Math.min(totalItems - 1, visibleRange.end + overscan),
  };
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
 * - Items are positioned relative to this virtual index
 * - Each item keeps its full itemHeight for proper rendering
 * - Position = (index - virtualScrollIndex) * itemHeight
 *
 * @param index - Item index
 * @param scrollTop - Current (virtual) scroll position
 * @param itemHeight - Height of each item
 * @param totalItems - Total number of items
 * @param containerHeight - Viewport container height
 * @param compression - Compression state
 * @param rangeStart - (unused, kept for API compatibility)
 */
export const calculateCompressedItemPosition = (
  index: number,
  scrollTop: number,
  itemHeight: number,
  totalItems: number,
  containerHeight: number,
  compression: CompressionState,
  rangeStart?: number,
): number => {
  if (!compression.isCompressed || totalItems === 0) {
    // Normal: absolute position in content space (scroll handled by container)
    return index * itemHeight;
  }

  const { virtualHeight } = compression;
  const maxScroll = virtualHeight - containerHeight;
  const distanceFromBottom = maxScroll - scrollTop;

  // Near-bottom interpolation: ensures we can smoothly reach the last items
  if (distanceFromBottom <= containerHeight && distanceFromBottom >= -1) {
    const itemsAtBottom = Math.floor(containerHeight / itemHeight);
    const firstVisibleAtBottom = Math.max(0, totalItems - itemsAtBottom);
    const scrollRatio = scrollTop / virtualHeight;
    const exactScrollIndex = scrollRatio * totalItems;

    // Interpolation factor: 0 at threshold, 1 at bottom
    const interpolation = Math.max(
      0,
      Math.min(1, 1 - distanceFromBottom / containerHeight),
    );

    // Blend between compressed position and actual bottom position
    const bottomPosition = (index - firstVisibleAtBottom) * itemHeight;
    const normalPosition = (index - exactScrollIndex) * itemHeight;

    return normalPosition + (bottomPosition - normalPosition) * interpolation;
  }

  // Normal compressed positioning: relative to virtual scroll index
  // This formula positions items relative to the viewport (not content)
  const scrollRatio = scrollTop / virtualHeight;
  const virtualScrollIndex = scrollRatio * totalItems;
  return (index - virtualScrollIndex) * itemHeight;
};

// =============================================================================
// Scroll Position Calculations (Compressed)
// =============================================================================

/**
 * Calculate scroll position to bring an index into view (with compression)
 * Pure function - no side effects
 *
 * @param index - Target item index
 * @param itemHeight - Height of each item
 * @param containerHeight - Viewport container height
 * @param totalItems - Total number of items
 * @param compression - Compression state
 * @param align - Alignment within viewport
 */
export const calculateCompressedScrollToIndex = (
  index: number,
  itemHeight: number,
  containerHeight: number,
  totalItems: number,
  compression: CompressionState,
  align: "start" | "center" | "end" = "start",
): number => {
  if (totalItems === 0) return 0;

  let targetPosition: number;

  if (compression.isCompressed) {
    // Map index to compressed scroll position
    const ratio = index / totalItems;
    targetPosition = ratio * compression.virtualHeight;
  } else {
    // Direct calculation
    targetPosition = index * itemHeight;
  }

  // Adjust for alignment
  switch (align) {
    case "center":
      targetPosition -= (containerHeight - itemHeight) / 2;
      break;
    case "end":
      targetPosition -= containerHeight - itemHeight;
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
  itemHeight: number,
  totalItems: number,
  compression: CompressionState,
): number => {
  if (totalItems === 0 || itemHeight === 0) return 0;

  if (compression.isCompressed) {
    const scrollRatio = scrollTop / compression.virtualHeight;
    return Math.floor(scrollRatio * totalItems);
  }

  return Math.floor(scrollTop / itemHeight);
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if compression is needed for a list configuration
 * Pure function - no side effects
 */
export const needsCompression = (
  totalItems: number,
  itemHeight: number,
): boolean => {
  return totalItems * itemHeight > MAX_VIRTUAL_HEIGHT;
};

/**
 * Calculate maximum items supported without compression
 * Pure function - no side effects
 */
export const getMaxItemsWithoutCompression = (itemHeight: number): number => {
  if (itemHeight <= 0) return 0;
  return Math.floor(MAX_VIRTUAL_HEIGHT / itemHeight);
};

/**
 * Get human-readable compression info for debugging
 * Pure function - no side effects
 */
export const getCompressionInfo = (
  totalItems: number,
  itemHeight: number,
): string => {
  const compression = getCompressionState(totalItems, itemHeight);

  if (!compression.isCompressed) {
    return `No compression needed (${totalItems} items × ${itemHeight}px = ${(compression.actualHeight / 1_000_000).toFixed(2)}M px)`;
  }

  const ratioPercent = (compression.ratio * 100).toFixed(1);
  return `Compressed to ${ratioPercent}% (${totalItems} items × ${itemHeight}px = ${(compression.actualHeight / 1_000_000).toFixed(1)}M px → ${(compression.virtualHeight / 1_000_000).toFixed(1)}M px virtual)`;
};
