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

/** Position of an item in absolute coordinates */
export interface MasonryPosition {
  /** X coordinate in pixels */
  x: number;

  /** Y coordinate in pixels */
  y: number;

  /** Cross-axis division index (column in vertical, row in horizontal) */
  lane: number;
}

/** Cached item placement information */
export interface ItemPlacement {
  /** Item index */
  index: number;

  /** Absolute position */
  position: MasonryPosition;

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

  /**
   * Calculate cross-axis size (column width in vertical, row height in horizontal).
   * crossAxisSize = (containerSize - (columns - 1) * gap) / columns
   */
  getCrossAxisSize: () => number;

  /**
   * Calculate the offset for a given lane (column/row) in the cross axis.
   * offset = lane * (crossAxisSize + gap)
   */
  getCrossAxisOffset: (lane: number) => number;
}