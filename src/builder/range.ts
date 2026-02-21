// src/builder/range.ts
/**
 * vlist/builder — Range Calculations
 * Visible range detection, overscan application, and scroll-to-index positioning.
 */

import type { Range } from "../types";
import type { SizeCache } from "../rendering/sizes";
import { countVisibleItems } from "../rendering/sizes";

// =============================================================================
// Visible Range
// =============================================================================

export const calcVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  hc: SizeCache,
  totalItems: number,
  out: Range,
): void => {
  if (totalItems === 0 || containerHeight === 0) {
    out.start = 0;
    out.end = 0;
    return;
  }

  const start = hc.indexAtOffset(scrollTop);

  // Use accurate visible item counting (same logic as compressed mode)
  // This ensures we render enough items during fast scrolling
  const visibleCount = countVisibleItems(
    hc,
    start,
    containerHeight,
    totalItems,
  );
  const end = start + visibleCount;

  out.start = Math.max(0, start);
  out.end = Math.min(totalItems - 1, Math.max(0, end));
};

// =============================================================================
// Overscan
// =============================================================================

export const applyOverscan = (
  visible: Range,
  overscan: number,
  totalItems: number,
  out: Range,
): void => {
  if (totalItems === 0) {
    out.start = 0;
    out.end = 0;
    return;
  }
  out.start = Math.max(0, visible.start - overscan);
  out.end = Math.min(totalItems - 1, visible.end + overscan);
};

// =============================================================================
// Scroll-to-Index Position
// =============================================================================

export const calcScrollToPosition = (
  index: number,
  hc: SizeCache,
  containerHeight: number,
  totalItems: number,
  align: "start" | "center" | "end",
): number => {
  if (totalItems === 0) return 0;
  const clamped = Math.max(0, Math.min(index, totalItems - 1));
  const offset = hc.getOffset(clamped);
  const itemH = hc.getSize(clamped);
  const maxScroll = Math.max(0, hc.getTotalSize() - containerHeight);
  let pos: number;
  switch (align) {
    case "center":
      pos = offset - (containerHeight - itemH) / 2;
      break;
    case "end":
      pos = offset - containerHeight + itemH;
      break;
    default:
      pos = offset;
  }
  return Math.max(0, Math.min(pos, maxScroll));
};
