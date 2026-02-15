/**
 * vlist - Grid Types
 * Types for grid/card layout mode
 *
 * Grid layout transforms a flat list of items into a 2D grid where:
 * - Virtualization operates on ROWS (not individual items)
 * - Each row contains `columns` items side by side
 * - Items are positioned using row/column coordinates
 * - Compression applies to row count, not item count
 */

import type { GridConfig } from "../types";

// Re-export GridConfig from main types
export type { GridConfig };

// =============================================================================
// Grid Layout
// =============================================================================

/** Row/column position of an item */
export interface GridPosition {
  /** Row index (0-based) */
  row: number;

  /** Column index (0-based) */
  col: number;
}

/** Flat item range corresponding to a row range */
export interface ItemRange {
  /** First item index (inclusive) */
  start: number;

  /** Last item index (inclusive) */
  end: number;
}

/**
 * GridLayout — maps between flat item indices and row/column positions.
 *
 * The virtualizer sees "rows" as its unit of work. Each row contains
 * up to `columns` items. The last row may be partially filled.
 *
 * All operations are O(1) — just integer division and modulo.
 */
export interface GridLayout {
  /** Number of columns */
  readonly columns: number;

  /** Gap between items in pixels */
  readonly gap: number;

  /** Update grid configuration without recreating the layout */
  update: (config: Partial<GridConfig>) => void;

  /** Get total number of rows for a given item count */
  getTotalRows: (totalItems: number) => number;

  /** Get the row/col position for a flat item index */
  getPosition: (itemIndex: number) => GridPosition;

  /** Get the row index for a flat item index */
  getRow: (itemIndex: number) => number;

  /** Get the column index for a flat item index */
  getCol: (itemIndex: number) => number;

  /**
   * Get the flat item range for a range of rows.
   * The last row may be partially filled (end is clamped to totalItems - 1).
   */
  getItemRange: (
    rowStart: number,
    rowEnd: number,
    totalItems: number,
  ) => ItemRange;

  /**
   * Get the flat item index from a row and column.
   * Returns -1 if out of bounds.
   */
  getItemIndex: (row: number, col: number, totalItems: number) => number;

  /**
   * Calculate column width given container width.
   * Accounts for gaps: width = (containerWidth - (columns - 1) * gap) / columns
   */
  getColumnWidth: (containerWidth: number) => number;

  /**
   * Calculate the X offset for a column index.
   * offset = col * (columnWidth + gap)
   */
  getColumnOffset: (col: number, containerWidth: number) => number;
}
