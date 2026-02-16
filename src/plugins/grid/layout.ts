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

/**
 * Extended grid config with optional groups support
 */
export interface GridConfigWithGroups extends GridConfig {
  /** Optional: check if an item index is a group header (for groups-aware layout) */
  isHeaderFn?: (index: number) => boolean;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a GridLayout instance.
 *
 * @param config - Grid configuration (columns, gap, optional isHeaderFn)
 * @returns GridLayout with O(1) mapping functions (or groups-aware if isHeaderFn provided)
 */
export const createGridLayout = (config: GridConfigWithGroups): GridLayout => {
  let columns = Math.max(1, Math.floor(config.columns));
  let gap = config.gap ?? 0;
  let isHeaderFn = config.isHeaderFn;

  // Reusable position object to avoid allocation on hot paths
  const reusablePosition: GridPosition = { row: 0, col: 0 };

  /**
   * Total rows for a given item count.
   * When isHeaderFn is provided, headers force new rows.
   */
  const getTotalRows = (totalItems: number): number => {
    if (totalItems <= 0) return 0;

    if (!isHeaderFn) {
      return Math.ceil(totalItems / columns);
    }

    // Groups-aware calculation
    let row = 0;
    let colInRow = 0;
    let headerCount = 0;

    for (let i = 0; i < totalItems; i++) {
      if (isHeaderFn(i)) {
        headerCount++;
        // Header: start new row if not at beginning
        if (colInRow > 0) {
          row++;
          colInRow = 0;
        }
        // Header occupies its own row
        row++;
        colInRow = 0;
      } else {
        // Regular item
        colInRow++;
        if (colInRow >= columns) {
          row++;
          colInRow = 0;
        }
      }
    }

    // Add final row if there are items in it
    if (colInRow > 0) {
      row++;
    }

    console.log(
      `🔍 GROUPS-GRID: ${totalItems} total items (${headerCount} headers, ${totalItems - headerCount} data items) → ${row} rows`,
    );
    return row;
  };

  /**
   * Get row/col position for a flat item index.
   * Reuses a single object to reduce GC pressure on scroll hot path.
   */
  const getPosition = (itemIndex: number): GridPosition => {
    reusablePosition.row = getRow(itemIndex);
    reusablePosition.col = getCol(itemIndex);
    return reusablePosition;
  };

  /**
   * Get row index for a flat item index — O(1)
   * When isHeaderFn is provided, headers force new rows and span all columns.
   */
  const getRow = (itemIndex: number): number => {
    if (!isHeaderFn) {
      return Math.floor(itemIndex / columns);
    }

    // Groups-aware calculation
    let row = 0;
    let colInRow = 0;

    for (let i = 0; i <= itemIndex; i++) {
      const isHeader = isHeaderFn(i);

      if (isHeader) {
        // Header: start new row if not at beginning
        if (colInRow > 0) {
          row++;
          colInRow = 0;
        }
        // Header occupies its own row
        if (i === itemIndex) {
          return row;
        }
        row++;
        colInRow = 0;
      } else {
        // Regular item
        if (i === itemIndex) {
          return row;
        }
        colInRow++;
        if (colInRow >= columns) {
          row++;
          colInRow = 0;
        }
      }
    }

    console.warn(`⚠️ getRow(${itemIndex}) fell through - returning ${row}`);
    return row;
  };

  /**
   * Get column index for a flat item index — O(1)
   * Headers always return col 0 when isHeaderFn is provided.
   */
  const getCol = (itemIndex: number): number => {
    if (!isHeaderFn) {
      return itemIndex % columns;
    }

    // Headers always at column 0
    if (isHeaderFn(itemIndex)) {
      return 0;
    }

    // Calculate column for regular items
    let colInRow = 0;

    for (let i = 0; i <= itemIndex; i++) {
      const isHeader = isHeaderFn(i);

      if (isHeader) {
        // Header: reset column counter
        colInRow = 0;
      } else {
        if (i === itemIndex) {
          return colInRow;
        }
        colInRow++;
        if (colInRow >= columns) {
          colInRow = 0;
        }
      }
    }

    return colInRow;
  };

  /**
   * Get the flat item range [start, end] for a range of rows.
   *
   * rowStart and rowEnd are inclusive row indices.
   * The returned end is clamped to totalItems - 1.
   * When isHeaderFn is provided, this accounts for headers disrupting the grid flow.
   */
  const getItemRange = (
    rowStart: number,
    rowEnd: number,
    totalItems: number,
  ): ItemRange => {
    if (totalItems <= 0) return { start: 0, end: -1 };

    if (!isHeaderFn) {
      // Simple O(1) calculation for regular grids
      const start = Math.max(0, rowStart * columns);
      const end = Math.min(totalItems - 1, (rowEnd + 1) * columns - 1);
      return { start, end };
    }

    // Groups-aware calculation - find items that fall in the row range
    let start = -1;
    let end = -1;
    let currentRow = 0;
    let colInRow = 0;

    for (let i = 0; i < totalItems; i++) {
      const isHeader = isHeaderFn(i);

      if (isHeader) {
        // Header: start new row if not at beginning
        if (colInRow > 0) {
          currentRow++;
          colInRow = 0;
        }
        // Check if this header's row is in range
        if (currentRow >= rowStart && currentRow <= rowEnd) {
          if (start === -1) start = i;
          end = i;
        }
        currentRow++;
        colInRow = 0;
      } else {
        // Regular item
        if (currentRow >= rowStart && currentRow <= rowEnd) {
          if (start === -1) start = i;
          end = i;
        }
        colInRow++;
        if (colInRow >= columns) {
          currentRow++;
          colInRow = 0;
        }
      }

      // Early exit if we're past the end row
      if (currentRow > rowEnd && colInRow === 0) {
        break;
      }
    }

    // If no items found in range, return empty range
    if (start === -1) {
      console.log(
        `⚠️ getItemRange EMPTY: rows ${rowStart}-${rowEnd} (totalItems: ${totalItems}, endedAtRow: ${currentRow})`,
      );
      return { start: 0, end: -1 };
    }

    console.log(
      `🔍 getItemRange: rows ${rowStart}-${rowEnd} → items ${start}-${end} (of ${totalItems})`,
    );
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

  /**
   * Update grid configuration without recreating the layout.
   * This is more efficient than destroying and recreating.
   */
  const updateConfig = (newConfig: Partial<GridConfigWithGroups>): void => {
    if (newConfig.columns !== undefined) {
      columns = Math.max(1, Math.floor(newConfig.columns));
    }
    if (newConfig.gap !== undefined) {
      gap = newConfig.gap;
    }
    if (newConfig.isHeaderFn !== undefined) {
      isHeaderFn = newConfig.isHeaderFn;
    }
  };

  return {
    get columns() {
      return columns;
    },
    get gap() {
      return gap;
    },
    update: updateConfig,
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
