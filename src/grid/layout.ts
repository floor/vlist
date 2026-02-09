/**
 * vlist - Grid Layout
 * Pure O(1) calculations for mapping between flat item indices and grid positions.
 *
 * The grid transforms a flat list into rows:
 *   Items:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
 *   Grid (columns=4):
 *     Row 0: [0, 1, 2, 3]
 *     Row 1: [4, 5, 6, 7]
 *     Row 2: [8, 9]          ← partially filled last row
 *
 * All operations are O(1) — integer division and modulo only.
 */

import type { GridConfig, GridLayout, GridPosition, ItemRange } from "./types";

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a GridLayout instance.
 *
 * @param config - Grid configuration (columns, gap)
 * @returns GridLayout with O(1) mapping functions
 */
export const createGridLayout = (config: GridConfig): GridLayout => {
  const columns = Math.max(1, Math.floor(config.columns));
  const gap = config.gap ?? 0;

  // Reusable position object to avoid allocation on hot paths
  const reusablePosition: GridPosition = { row: 0, col: 0 };

  /**
   * Total rows for a given item count.
   * ceil(totalItems / columns)
   */
  const getTotalRows = (totalItems: number): number => {
    if (totalItems <= 0) return 0;
    return Math.ceil(totalItems / columns);
  };

  /**
   * Get row/col position for a flat item index.
   * Reuses a single object to reduce GC pressure on scroll hot path.
   */
  const getPosition = (itemIndex: number): GridPosition => {
    reusablePosition.row = Math.floor(itemIndex / columns);
    reusablePosition.col = itemIndex % columns;
    return reusablePosition;
  };

  /**
   * Get row index for a flat item index — O(1)
   */
  const getRow = (itemIndex: number): number => {
    return Math.floor(itemIndex / columns);
  };

  /**
   * Get column index for a flat item index — O(1)
   */
  const getCol = (itemIndex: number): number => {
    return itemIndex % columns;
  };

  /**
   * Get the flat item range [start, end] for a range of rows.
   *
   * rowStart and rowEnd are inclusive row indices.
   * The returned end is clamped to totalItems - 1.
   */
  const getItemRange = (
    rowStart: number,
    rowEnd: number,
    totalItems: number,
  ): ItemRange => {
    if (totalItems <= 0) return { start: 0, end: -1 };

    const start = Math.max(0, rowStart * columns);
    const end = Math.min(totalItems - 1, (rowEnd + 1) * columns - 1);

    return { start, end };
  };

  /**
   * Get the flat item index from a row and column.
   * Returns -1 if the position is out of bounds.
   */
  const getItemIndex = (
    row: number,
    col: number,
    totalItems: number,
  ): number => {
    if (col < 0 || col >= columns) return -1;

    const index = row * columns + col;
    if (index < 0 || index >= totalItems) return -1;

    return index;
  };

  /**
   * Calculate column width given the container's inner width.
   * Distributes gaps evenly: totalGapWidth = (columns - 1) * gap
   * columnWidth = (containerWidth - totalGapWidth) / columns
   */
  const getColumnWidth = (containerWidth: number): number => {
    const totalGap = (columns - 1) * gap;
    return Math.max(0, (containerWidth - totalGap) / columns);
  };

  /**
   * Calculate the X pixel offset for a given column index.
   * offset = col * (columnWidth + gap)
   */
  const getColumnOffset = (col: number, containerWidth: number): number => {
    const colWidth = getColumnWidth(containerWidth);
    return col * (colWidth + gap);
  };

  return {
    columns,
    gap,
    getTotalRows,
    getPosition,
    getRow,
    getCol,
    getItemRange,
    getItemIndex,
    getColumnWidth,
    getColumnOffset,
  };
};
