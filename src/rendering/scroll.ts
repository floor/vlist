/**
 * vlist - Smart Edge Scroll
 * Shared scroll utility used by both core baseline and withSelection feature.
 * Only scrolls when the target item is outside the viewport; aligns to nearest edge.
 *
 * Handles both normal and compressed (withScale) modes:
 * - Normal: pixel-perfect offset comparison against scroll position
 * - Compressed: fractional index math because sizeCache offsets are in
 *   actual-pixel space but scrollPosition is in virtual/compressed space
 *
 * Padding-aware: CSS padding on the content element shifts items in scroll
 * space by `startPadding` (paddingTop for vertical, paddingLeft for horizontal).
 * The function accounts for this offset in both visibility checks and alignment.
 */

import type { SizeCache } from "./sizes";
import type { CompressionState } from "./scale";
import type { Range } from "../types";

/**
 * Calculate the scroll position needed to bring an item into view.
 * Returns the current scroll position unchanged if the item is already fully visible.
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
    // ── Normal: pixel-perfect positioning ──
    const itemOffset = sizeCache.getOffset(index);
    const itemSize = sizeCache.getSize(index);
    const adjustedTop = itemOffset + startPadding;
    const adjustedBottom = adjustedTop + itemSize;
    const viewportBottom = scrollPosition + containerSize;

    if (adjustedTop < scrollPosition) {
      return Math.max(0, itemOffset);
    }

    if (adjustedBottom > viewportBottom) {
      return adjustedBottom + endPadding - containerSize;
    }

    return scrollPosition;
  }

  // ── Compressed: linear index math ──
  // With bottom-padding on the content div, the linear formula
  // index * compressedItemSize is valid for ALL indices (no near-bottom
  // interpolation hack needed).
  const total = totalItems!;
  const { virtualSize } = compression!;
  const itemSize = sizeCache.getSize(Math.max(0, index));
  const effectiveSize = containerSize - startPadding - endPadding;
  const fullyVisible = Math.max(1, Math.floor(effectiveSize / itemSize));
  const compressedItemSize = virtualSize / total;

  if (visibleRange) {
    // Use >= / <= (inclusive) so items at the boundary get scrolled into view
    if (index >= visibleRange.start + fullyVisible) {
      // Item is below the fully-visible area — align to bottom edge
      const wantStart = index + 1 - fullyVisible;
      return Math.max(0, wantStart * compressedItemSize);
    }

    if (index <= visibleRange.end - fullyVisible) {
      // Item is above the fully-visible area — align to top edge
      return Math.max(0, index * compressedItemSize);
    }

    return scrollPosition;
  }

  // No visible range — fallback
  const currentIndex = (scrollPosition / virtualSize) * total;
  const currentEnd = currentIndex + fullyVisible;

  if (index >= currentEnd) {
    const wantStart = index + 1 - fullyVisible;
    return Math.max(0, wantStart * compressedItemSize);
  }

  if (index <= currentIndex) {
    return Math.max(0, index * compressedItemSize);
  }

  return scrollPosition;
};