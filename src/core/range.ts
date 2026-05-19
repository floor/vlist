// src/builder/range.ts
/**
 * vlist/builder — Range Calculations
 * Visible range detection, overscan application, and scroll-to-index positioning.
 */

import type { Range } from "../types";
import type { SizeCache } from "../rendering/sizes";

// =============================================================================
// Visible Range
// =============================================================================

export const calcVisibleRange = (
  scrollPosition: number,
  containerHeight: number,
  hc: SizeCache,
  totalItems: number,
  out: Range,
): void => {
  if (totalItems === 0 || containerHeight === 0) {
    out.start = 0;
    out.end = -1;
    return;
  }

  const start = hc.indexAtOffset(scrollPosition);
  let end = hc.indexAtOffset(scrollPosition + containerHeight);
  if (end < totalItems - 1) end++;

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
  // No special case needed for totalItems===0: calcVisibleRange already
  // sets visible.end=-1, so Math.min(-1, -1+overscan) = -1 and
  // Math.max(0, 0-overscan) = 0 — the empty sentinel {start:0,end:-1}
  // propagates correctly through the cleanup loop in coreRenderIfNeeded.
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
  mainAxisPadding: number = 0,
): number => {
  if (totalItems === 0) return 0;
  const clamped = Math.max(0, Math.min(index, totalItems - 1));
  const offset = hc.getOffset(clamped);
  const itemH = hc.getSize(clamped);
  const totalSize = hc.getTotalSize();
  const maxScroll = Math.max(0, totalSize + mainAxisPadding - containerHeight);
  let pos: number;
  switch (align) {
    case "center":
      pos = offset - (containerHeight - itemH) / 2;
      break;
    case "end":
      // When padding is active and this is the last item, snap to maxScroll
      // so the end padding is fully visible.
      pos = (mainAxisPadding > 0 && offset + itemH >= totalSize)
        ? maxScroll
        : offset - containerHeight + itemH;
      break;
    default:
      pos = offset;
  }
  return Math.max(0, Math.min(pos, maxScroll));
};
