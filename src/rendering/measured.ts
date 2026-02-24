// src/rendering/measured.ts
/**
 * vlist - Measured Size Cache
 * Auto-measurement support for items with unknown sizes (Mode B)
 *
 * Wraps the existing variable SizeCache with measurement tracking.
 * Once an item is measured, it behaves identically to Mode A (known size).
 * Unmeasured items use the estimated size as a fallback.
 *
 * Fully axis-neutral: works identically for vertical (estimatedHeight)
 * and horizontal (estimatedWidth) orientations. This cache stores plain
 * numbers representing the main-axis dimension — it never knows whether
 * those numbers are heights or widths. The axis-specific translation
 * happens in builder/core.ts at the DOM boundary.
 *
 * Implements the SizeCache interface so all downstream code
 * (viewport, scale, features) works unchanged.
 */

import type { SizeCache } from "./sizes";
import { createSizeCache } from "./sizes";

// =============================================================================
// Types
// =============================================================================

/** Extended SizeCache with measurement tracking */
export interface MeasuredSizeCache extends SizeCache {
  /** Record actual measured size for an item */
  setMeasuredSize(index: number, size: number): void;

  /** Check if an item has been measured */
  isMeasured(index: number): boolean;

  /** Get the estimated size (used for unmeasured items) */
  getEstimatedSize(): number;

  /** Number of items that have been measured */
  measuredCount(): number;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a measured size cache for auto-measurement (Mode B)
 *
 * Works for both orientations:
 *   - Vertical:   estimatedSize = estimatedHeight, measures block size
 *   - Horizontal: estimatedSize = estimatedWidth, measures inline size
 *
 * The cache itself is axis-neutral — it only stores numbers. The caller
 * (builder/core.ts) is responsible for reading the correct axis from
 * the config and from ResizeObserver entries (blockSize vs inlineSize).
 *
 * Internally maintains a Map of measured sizes keyed by item index.
 * Unmeasured items fall back to the estimated size. The underlying
 * prefix-sum array is rebuilt when measurements change.
 *
 * The size function fed into the variable SizeCache becomes:
 *   (index) => measuredSizes.has(index) ? measuredSizes.get(index) : estimatedSize
 *
 * This means all existing viewport, compression, and range calculations
 * work unchanged — they only see a SizeCache with variable sizes.
 */
export const createMeasuredSizeCache = (
  estimatedSize: number,
  initialTotal: number,
): MeasuredSizeCache => {
  const measuredSizes = new Map<number, number>();

  // Size function: return measured size if available, else estimated
  const sizeFn = (index: number): number => {
    const measured = measuredSizes.get(index);
    return measured !== undefined ? measured : estimatedSize;
  };

  // Create the underlying variable SizeCache with our size function
  let inner = createSizeCache(sizeFn, initialTotal);

  return {
    // ── SizeCache interface ──────────────────────────────────────

    getOffset(index: number): number {
      return inner.getOffset(index);
    },

    getSize(index: number): number {
      return sizeFn(index);
    },

    indexAtOffset(offset: number): number {
      return inner.indexAtOffset(offset);
    },

    getTotalSize(): number {
      return inner.getTotalSize();
    },

    getTotal(): number {
      return inner.getTotal();
    },

    rebuild(totalItems: number): void {
      // Discard measured sizes for indices that no longer exist
      if (totalItems < inner.getTotal()) {
        for (const index of measuredSizes.keys()) {
          if (index >= totalItems) {
            measuredSizes.delete(index);
          }
        }
      }

      // Rebuild the underlying variable cache with current size function
      // We must recreate because createSizeCache captures sizeFn at creation,
      // but our sizeFn closes over measuredSizes which is mutable — so a
      // rebuild of the inner cache re-evaluates all prefix sums.
      inner = createSizeCache(sizeFn, totalItems);
    },

    isVariable(): boolean {
      return true;
    },

    // ── MeasuredSizeCache extensions ─────────────────────────────

    setMeasuredSize(index: number, size: number): void {
      measuredSizes.set(index, size);
    },

    isMeasured(index: number): boolean {
      return measuredSizes.has(index);
    },

    getEstimatedSize(): number {
      return estimatedSize;
    },

    measuredCount(): number {
      return measuredSizes.size;
    },
  };
};