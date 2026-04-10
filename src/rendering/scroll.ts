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
 *
 * @param index - Target item index
 * @param sizeCache - Size cache for offset/size lookups
 * @param scrollPosition - Current scroll position
 * @param containerSize - Viewport container size (height or width)
 * @param startPadding - Main-axis start padding (paddingTop / paddingLeft) that
 *   shifts items in scroll space. Pass 0 when there is no padding.
 * @param endPadding - Main-axis end padding (paddingBottom / paddingRight).
 *   Kept visible below the item when aligning to the bottom edge.
 * @param compression - Optional compression state from withScale
 * @param totalItems - Total item count (required when compressed)
 * @param visibleRange - Current visible range (required when compressed for hit-testing)
 * @returns The scroll position to set (unchanged if item already visible)
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
    // Items are offset by startPadding in scroll space due to CSS padding
    // on the content element. An item at sizeCache offset O appears at
    // O + startPadding in the scrollable area.
    const itemOffset = sizeCache.getOffset(index);
    const itemSize = sizeCache.getSize(index);
    const adjustedTop = itemOffset + startPadding;
    const adjustedBottom = adjustedTop + itemSize;
    const viewportBottom = scrollPosition + containerSize;

    // Item is above the viewport — align to top edge (with padding visible)
    if (adjustedTop < scrollPosition) {
      return Math.max(0, itemOffset);
    }

    // Item is below the viewport — align to bottom edge (keep endPadding visible)
    if (adjustedBottom > viewportBottom) {
      return adjustedBottom + endPadding - containerSize;
    }

    // Item is fully visible — no scroll needed
    return scrollPosition;
  }

  // ── Compressed: fractional index math ──
  // sizeCache offsets are in actual-pixel space but scrollPosition
  // is in virtual/compressed space — can't compare directly.
  // Use visible range for the hit-test, then compute the scroll
  // target via the compression mapping with fractional precision.
  //
  // NOTE: assumes roughly uniform item sizes — compressedItemSize
  // is virtualSize / totalItems. This is acceptable because
  // withScale is designed for massive lists with fixed row height.
  const total = totalItems!;
  const { virtualSize } = compression!;
  const itemSize = sizeCache.getSize(Math.max(0, index));
  // Effective container size excludes padding — only the usable area for items
  const effectiveSize = containerSize - startPadding - endPadding;
  const fullyVisible = Math.max(1, Math.floor(effectiveSize / itemSize));
  const compressedItemSize = virtualSize / total;

  if (visibleRange) {
    if (index > visibleRange.start + fullyVisible - 1) {
      // Item is below the fully-visible area.
      // Place item at the bottom edge using fractional top index:
      //   exactTop = index + 1 - (effectiveSize / itemSize)
      // so that exactly effectiveSize/itemSize items fill the viewport
      // with index as the last fully visible one.
      const exactTopIndex = index + 1 - effectiveSize / itemSize;
      return Math.max(0, exactTopIndex * compressedItemSize);
    }

    if (index < visibleRange.end - fullyVisible) {
      // Item is above the fully-visible area — place it at the top.
      return Math.max(0, index * compressedItemSize);
    }
  } else {
    // No visible range available — fall back to index-based positioning
    // This is less precise but still functional
    const currentIndex = (scrollPosition / virtualSize) * total;
    const currentEnd = currentIndex + fullyVisible;

    if (index > currentEnd - 1) {
      const exactTopIndex = index + 1 - effectiveSize / itemSize;
      return Math.max(0, exactTopIndex * compressedItemSize);
    }

    if (index < currentIndex) {
      return Math.max(0, index * compressedItemSize);
    }
  }

  // Item is fully visible — no scroll needed
  return scrollPosition;
};