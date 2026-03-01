/**
 * vlist/table - Layout
 * Manages column widths, offsets, and resize operations.
 *
 * Column width resolution strategy:
 * 1. Columns with explicit `width` get their requested width (clamped to min/max)
 * 2. Remaining container space is distributed equally among columns without `width`
 * 3. If all columns have explicit widths and total < container, no stretching occurs
 * 4. If total column width > container, the table scrolls horizontally
 *
 * All offset calculations are O(n) where n = number of columns (typically small).
 * Resize operations recalculate offsets for columns after the resized one.
 */

import type { VListItem } from "../../types";
import type { TableColumn, ResolvedColumn, TableLayout } from "./types";

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_MIN_COLUMN_WIDTH = 50;
const DEFAULT_MAX_COLUMN_WIDTH = Infinity;

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a TableLayout instance.
 *
 * @param columnDefs - Column definitions from config
 * @param globalMinWidth - Default min column width (from TableConfig.minColumnWidth)
 * @param globalMaxWidth - Default max column width (from TableConfig.maxColumnWidth)
 * @param globalResizable - Default resizable flag (from TableConfig.resizable)
 * @returns TableLayout with column resolution and resize capabilities
 */
export const createTableLayout = <T extends VListItem = VListItem>(
  columnDefs: TableColumn<T>[],
  globalMinWidth: number = DEFAULT_MIN_COLUMN_WIDTH,
  globalMaxWidth: number = DEFAULT_MAX_COLUMN_WIDTH,
  globalResizable: boolean = true,
): TableLayout<T> => {
  let defs = columnDefs;
  let resolved: ResolvedColumn<T>[] = [];
  let totalWidth = 0;

  // =========================================================================
  // Column Resolution
  // =========================================================================

  /**
   * Build resolved columns from definitions.
   * Does NOT compute widths yet — call resolve(containerWidth) for that.
   */
  const buildResolved = (): void => {
    resolved = defs.map((def, index) => ({
      def,
      index,
      width: 0,
      minWidth: clampPositive(def.minWidth ?? globalMinWidth, 1),
      maxWidth: def.maxWidth ?? globalMaxWidth,
      resizable: def.resizable ?? globalResizable,
      offset: 0,
    }));
  };

  /**
   * Resolve column widths given the available container width.
   *
   * Strategy:
   * - Columns with explicit `width` are assigned that width (clamped)
   * - Remaining space goes to columns without explicit `width`
   * - If no columns lack a width, total is just the sum of assigned widths
   * - Widths are always clamped to [minWidth, maxWidth]
   */
  const resolve = (containerWidth: number): void => {
    if (resolved.length === 0) {
      totalWidth = 0;
      return;
    }

    let usedWidth = 0;
    let flexCount = 0;

    // First pass: assign explicit widths, count flex columns
    for (let i = 0; i < resolved.length; i++) {
      const col = resolved[i]!;
      const def = col.def;

      if (def.width !== undefined) {
        col.width = clamp(def.width, col.minWidth, col.maxWidth);
        usedWidth += col.width;
      } else {
        flexCount++;
      }
    }

    // Second pass: distribute remaining space to flex columns
    if (flexCount > 0) {
      const remaining = Math.max(0, containerWidth - usedWidth);
      const flexWidth = remaining / flexCount;

      for (let i = 0; i < resolved.length; i++) {
        const col = resolved[i]!;
        if (col.def.width === undefined) {
          col.width = clamp(flexWidth, col.minWidth, col.maxWidth);
        }
      }
    }

    // Third pass: compute cumulative offsets and total width
    recalculateOffsets();
  };

  /**
   * Recalculate offsets from column widths.
   * Called after resolve() and after any resize operation.
   */
  const recalculateOffsets = (): void => {
    let offset = 0;
    for (let i = 0; i < resolved.length; i++) {
      const col = resolved[i]!;
      col.offset = offset;
      offset += col.width;
    }
    totalWidth = offset;
  };

  // =========================================================================
  // Resize
  // =========================================================================

  /**
   * Resize a column to a new width.
   * Clamps to the column's min/max bounds.
   * Recalculates offsets for all subsequent columns.
   *
   * @returns The actual new width after clamping
   */
  const resizeColumn = (columnIndex: number, newWidth: number): number => {
    if (columnIndex < 0 || columnIndex >= resolved.length) return 0;

    const col = resolved[columnIndex]!;
    if (!col.resizable) return col.width;

    const clamped = clamp(newWidth, col.minWidth, col.maxWidth);
    col.width = clamped;

    // Recalculate offsets from this column onward
    recalculateOffsets();

    return clamped;
  };

  // =========================================================================
  // Accessors
  // =========================================================================

  const getColumn = (index: number): ResolvedColumn<T> | undefined => {
    return resolved[index];
  };

  const getColumnAtX = (x: number): ResolvedColumn<T> | undefined => {
    // Binary search for the column containing x
    if (resolved.length === 0) return undefined;
    if (x < 0) return resolved[0];
    if (x >= totalWidth) return resolved[resolved.length - 1];

    let lo = 0;
    let hi = resolved.length - 1;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const col = resolved[mid]!;
      if (x < col.offset) {
        hi = mid - 1;
      } else if (x >= col.offset + col.width) {
        lo = mid + 1;
      } else {
        return col;
      }
    }

    return resolved[lo];
  };

  const getColumnOffset = (columnIndex: number): number => {
    if (columnIndex < 0 || columnIndex >= resolved.length) return 0;
    return resolved[columnIndex]!.offset;
  };

  const getColumnWidth = (columnIndex: number): number => {
    if (columnIndex < 0 || columnIndex >= resolved.length) return 0;
    return resolved[columnIndex]!.width;
  };

  // =========================================================================
  // Update
  // =========================================================================

  /**
   * Replace column definitions and rebuild.
   * The caller must call resolve(containerWidth) after this to compute widths.
   */
  const updateColumns = (columns: TableColumn<T>[]): void => {
    defs = columns;
    buildResolved();
  };

  // =========================================================================
  // Initialize
  // =========================================================================

  buildResolved();

  // =========================================================================
  // Return
  // =========================================================================

  return {
    get columns() {
      return resolved;
    },
    get totalWidth() {
      return totalWidth;
    },
    resolve,
    updateColumns,
    resizeColumn,
    getColumn,
    getColumnAtX,
    getColumnOffset,
    getColumnWidth,
  };
};

// =============================================================================
// Helpers
// =============================================================================

/** Clamp a value to [min, max] */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Ensure a positive value (at least `floor`) */
const clampPositive = (value: number, floor: number): number =>
  Math.max(floor, value);