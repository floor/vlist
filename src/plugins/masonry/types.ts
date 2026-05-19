/**
 * vlist - Masonry Types
 * Types for masonry/Pinterest-style layout mode
 *
 * Masonry layout arranges items in columns (vertical) or rows (horizontal)
 * where items flow into the shortest column/row, creating a packed layout
 * with no alignment across the cross-axis.
 */

import type { MasonryConfig } from "../../types";

// Re-export MasonryConfig from main types
export type { MasonryConfig };

// =============================================================================
// Masonry Layout
// =============================================================================

/** Cached item placement — flat structure for minimal allocation and fast access */
export interface ItemPlacement {
  /** Item index */
  index: number;

  /** X coordinate in pixels (cross-axis offset) */
  x: number;

  /** Y coordinate in pixels (main-axis offset) */
  y: number;

  /** Cross-axis division index (column in vertical, row in horizontal) */
  lane: number;

  /** Item size in main axis (height in vertical, width in horizontal) */
  size: number;

  /** Item size in cross axis (width in vertical, height in horizontal) */
  crossSize: number;
}

/**
 * MasonryLayout — places items in the shortest column/row.
 *
 * Unlike grid (O(1) calculations), masonry requires O(n) layout calculation
 * because each item's position depends on the accumulated sizes of items
 * before it in the same column/row.
 *
 * The layout algorithm:
 * 1. Track size of each column/row (cross-axis divisions)
 * 2. For each item, find the shortest column/row
 * 3. Place item at the end of that column/row
 * 4. Update that column/row's size
 * 5. Cache the item's position for rendering
 */
export interface MasonryLayout {
  /** Number of cross-axis divisions (columns in vertical, rows in horizontal) */
  readonly columns: number;

  /** Gap between items in pixels */
  readonly gap: number;

  /** Container width (for vertical) or height (for horizontal) */
  readonly containerSize: number;

  /** Update masonry configuration */
  update: (config: Partial<MasonryConfig & { containerSize: number }>) => void;

  /**
   * Calculate layout for all items.
   * Returns array of item placements with positions.
   * This is O(n) where n = totalItems.
   */
  calculateLayout: (
    totalItems: number,
    getSizeForItem: (index: number) => number,
  ) => ItemPlacement[];

  /**
   * Get the total size in the main axis (total height in vertical, total width in horizontal).
   * This is the size of the tallest/widest column/row.
   */
  getTotalSize: (placements: ItemPlacement[]) => number;

  /**
   * Get items visible in the viewport.
   * mainAxisStart/End = scroll position range (scrollTop/scrollLeft + viewport size)
   */
  getVisibleItems: (
    placements: ItemPlacement[],
    mainAxisStart: number,
    mainAxisEnd: number,
  ) => ItemPlacement[];
}