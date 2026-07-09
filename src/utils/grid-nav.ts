// grid-nav — shared keyboard-navigation helpers
/**
 * Clamp a PageUp/PageDown target index so it preserves the column in grid mode.
 *
 * For a linear list (`columns <= 1`) this is a plain `[0, total-1]` clamp. In a
 * grid, overshooting the top/bottom should land on the **same column** of the
 * first/last row — not the absolute first/last item, which would duplicate the
 * Home/End behavior (and, on a boundary row, wrongly jump to the corner instead
 * of staying put). See floor/vlist#60.
 *
 * @param target  The raw target index (`current ± pageSize`), may be out of range.
 * @param current The current focused index.
 * @param columns Grid column count (`nav.ud`); 1 for a linear list.
 * @param total   Total item count.
 */
export function clampPageTarget(
  target: number,
  current: number,
  columns: number,
  total: number,
): number {
  if (total <= 0) return 0;
  const last = total - 1;

  if (columns <= 1) {
    return target < 0 ? 0 : target > last ? last : target;
  }

  const col = ((current % columns) + columns) % columns;

  if (target < 0) {
    // Above the first row → same column in row 0.
    return col;
  }
  if (target > last) {
    // Past the last row → same column in the last row (or the last item when
    // that column doesn't exist in a partial final row).
    const lastRowStart = Math.floor(last / columns) * columns;
    return Math.min(lastRowStart + col, last);
  }
  return target;
}
