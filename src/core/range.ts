/**
 * vlist v2 — Range Calculations
 *
 * Visible range detection and overscan application.
 * Same algorithms as v1 (builder/range.ts), adapted for EngineState.
 */

import type { SizeCache } from "./sizes";

/**
 * Calculate visible range from scroll position and fill start/end.
 * Writes into pre-existing mutable holders — zero allocation.
 */
export function calcVisibleRange(
  scrollPosition: number,
  containerSize: number,
  sizeCache: SizeCache,
  totalItems: number,
  outStart: { value: number },
  outEnd: { value: number },
): void {
  if (totalItems === 0 || containerSize === 0) {
    outStart.value = 0;
    outEnd.value = -1;
    return;
  }

  const start = sizeCache.indexAtOffset(scrollPosition);
  let end = sizeCache.indexAtOffset(scrollPosition + containerSize);
  if (end < totalItems - 1) end++;

  outStart.value = Math.max(0, start);
  outEnd.value = Math.min(totalItems - 1, Math.max(0, end));
}

/**
 * Apply overscan to a visible range.
 */
export function applyOverscan(
  visStart: number,
  visEnd: number,
  overscan: number,
  totalItems: number,
): { start: number; end: number } {
  return {
    start: Math.max(0, visStart - overscan),
    end: Math.min(totalItems - 1, visEnd + overscan),
  };
}
