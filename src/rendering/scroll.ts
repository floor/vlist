/**
 * vlist - Smart Edge Scroll
 * Shared scroll utility used by both core baseline and withSelection feature.
 * Only scrolls when the target item is outside the viewport; aligns to nearest edge.
 *
 * Split into two functions for tree-shaking:
 * - scrollToFocusSimple: normal mode only (used by base builder)
 * - scrollToFocus: handles both normal and compressed modes (used by features)
 */

import type { SizeCache } from "./sizes";
import type { CompressionState } from "./scale";
import type { Range } from "../types";

/**
 * Simple scroll-to-focus: normal (non-compressed) mode only.
 * Padding-aware: accounts for CSS padding on the content element.
 */
export const scrollToFocusSimple = (
  index: number,
  sizeCache: SizeCache,
  scrollPosition: number,
  containerSize: number,
  startPadding: number = 0,
  endPadding: number = 0,
): number => {
  const itemOffset = sizeCache.getOffset(index);
  const itemSize = sizeCache.getSize(index);
  const adjustedTop = itemOffset + startPadding;
  const adjustedBottom = adjustedTop + itemSize;
  const viewportBottom = scrollPosition + containerSize;

  if (adjustedTop < scrollPosition) return Math.max(0, itemOffset);
  if (adjustedBottom > viewportBottom) return adjustedBottom + endPadding - containerSize;
  return scrollPosition;
};

/**
 * Full scroll-to-focus: handles both normal and compressed (withScale) modes.
 * Used by withSelection feature which must work with compression.
 */
export const scrollToFocus = (
  index: number,
  sizeCache: SizeCache,
  scrollPosition: number,
  containerSize: number,
  startPadding: number = 0,
  endPadding: number = 0,
  compression?: CompressionState | null,
  totalItems?: number,
  visibleRange?: Range | null,
): number => {
  const isCompressed =
    compression != null &&
    compression.isCompressed &&
    compression.ratio !== 1;

  if (!isCompressed) {
    return scrollToFocusSimple(index, sizeCache, scrollPosition, containerSize, startPadding, endPadding);
  }

  // ── Compressed: prefix-sum positioning ──
  // Use actual offsets from the size cache instead of linear index math.
  // Linear math assumes uniform item sizes, but group headers are shorter
  // than data items, causing the focused item to land short of the edge.
  const { virtualSize } = compression!;
  const itemSize = sizeCache.getSize(Math.max(0, index));
  const effectiveSize = containerSize - startPadding - endPadding;
  const fullyVisible = Math.max(1, Math.floor(effectiveSize / itemSize));
  const totalActualSize = sizeCache.getTotalSize();

  if (visibleRange) {
    if (index >= visibleRange.start + fullyVisible) {
      const itemBottom = sizeCache.getOffset(index) + itemSize;
      const targetActualTop = itemBottom + endPadding - containerSize;
      return Math.max(0, (targetActualTop / totalActualSize) * virtualSize);
    }

    if (index <= visibleRange.start) {
      const targetActualTop = sizeCache.getOffset(index) - startPadding;
      return Math.max(0, (targetActualTop / totalActualSize) * virtualSize);
    }

    return scrollPosition;
  }

  // No visible range — fallback
  const currentIndex = (scrollPosition / virtualSize) * totalItems!;
  const currentEnd = currentIndex + fullyVisible;

  if (index >= currentEnd) {
    const itemBottom = sizeCache.getOffset(index) + itemSize;
    const targetActualTop = itemBottom + endPadding - containerSize;
    return Math.max(0, (targetActualTop / totalActualSize) * virtualSize);
  }

  if (index < currentIndex) {
    const targetActualTop = sizeCache.getOffset(index) - startPadding;
    return Math.max(0, (targetActualTop / totalActualSize) * virtualSize);
  }

  return scrollPosition;
};
