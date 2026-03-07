// src/utils/stats.ts
// Pure computation module for scroll statistics.
// Tracks velocity (current + running average), computes cumulative item count
// and progress from scroll position using geometric mapping.
//
// No DOM access, no RAF, no side effects — purely functional state tracker.

import { MAX_VIRTUAL_SIZE } from "../constants";

// =============================================================================
// Constants
// =============================================================================

const MAX_VELOCITY = 50;
const MIN_VELOCITY = 0.1;

// =============================================================================
// Types
// =============================================================================

export interface StatsConfig {
  /** Returns the current scroll position (scrollTop or scrollLeft) */
  getScrollPosition: () => number;

  /** Returns the total number of items */
  getTotal: () => number;

  /** Returns the item size along the scroll axis (height for vertical, width for horizontal) */
  getItemSize: () => number;

  /** Returns the viewport size in px (clientHeight for vertical, clientWidth for horizontal) */
  getContainerSize: () => number;

  /** Returns the column count for grid/masonry layouts (defaults to 1) */
  getColumns?: () => number;
}

export interface StatsState {
  /** Progress through the list as 0–100 */
  progress: number;

  /** Current instantaneous velocity in px/ms */
  velocity: number;

  /** Running average velocity in px/ms (filtered samples only) */
  velocityAvg: number;

  /** Number of items visible up to the current scroll position */
  itemCount: number;

  /** Total number of items */
  total: number;
}

export interface Stats {
  /** Return the current computed state. Pure read — no side effects. */
  getState: () => StatsState;

  /** Feed a velocity sample. Call from the `velocity:change` event. */
  onVelocity: (velocity: number) => void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a stats tracker.
 *
 * All inputs are provided via callbacks so the tracker always reflects
 * the latest values without needing to be recreated when the list changes.
 *
 * ```ts
 * const stats = createStats({
 *   getScrollPosition: () => list.getScrollPosition(),
 *   getTotal: () => items.length,
 *   getItemSize: () => ITEM_HEIGHT,
 *   getContainerSize: () => containerEl.clientHeight,
 * })
 *
 * const { progress, itemCount, total } = stats.getState()
 * ```
 */
export function createStats(config: StatsConfig): Stats {
  // ───────────────────────────────────────────────────────────────────────────
  // Velocity state
  // ───────────────────────────────────────────────────────────────────────────

  let currentVelocity = 0;
  let velocitySum = 0;
  let velocityCount = 0;

  function getVelocityAverage(): number {
    return velocityCount > 0 ? velocitySum / velocityCount : 0;
  }

  function onVelocity(velocity: number): void {
    currentVelocity = velocity;
    if (velocity > MIN_VELOCITY && velocity < MAX_VELOCITY) {
      velocitySum += velocity;
      velocityCount++;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Geometric item count
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Compute cumulative item count from scroll position geometrically.
   *
   * scrollPosition is the DOM scrollTop/scrollLeft — in compressed/scaled
   * mode this is the virtual (compressed) scroll position. We map it back
   * to real item indices using the same linear mapping vlist uses internally:
   *
   *   columns         = getColumns() ?? 1
   *   totalRows       = ceil(total / columns)
   *   totalActualSize = totalRows × itemSize
   *   totalVirtualSize = min(totalActualSize, MAX_VIRTUAL_SIZE)
   *   maxVirtualScroll = totalVirtualSize − containerSize
   *   maxActualScroll  = totalActualSize − containerSize
   *   ratio            = maxActualScroll / maxVirtualScroll
   *   actualOffset     = scrollPosition × ratio
   *   visibleRows      = ceil((actualOffset + containerSize) / itemSize)
   *   itemCount        = min(visibleRows × columns, total)
   *
   * containerSize is provided by the caller (clientHeight for vertical,
   * clientWidth for horizontal).
   *
   * Using scroll-range ratio (not size ratio) ensures that at max scroll
   * the end of the viewport aligns exactly with the last row/column.
   * For grid/masonry, rows are converted to items via the column multiplier.
   */
  function getItemCount(): number {
    const total = config.getTotal();
    if (total === 0) return 0;

    const itemSize = config.getItemSize();
    if (itemSize <= 0) return 0;

    const containerSize = config.getContainerSize();
    if (containerSize <= 0) return 0;

    const scrollPosition = config.getScrollPosition();

    // For grid/masonry layouts, vlist virtualizes rows — each row holds
    // `columns` items. Convert total items → total rows for the geometric
    // mapping, then convert visible rows back to items at the end.
    const columns =
      typeof config.getColumns === "function" ? config.getColumns() : 1;
    const totalRows = Math.ceil(total / columns);

    // Map virtual scroll position back to actual content offset.
    // Use scroll-range ratio so maxScroll maps exactly to the last row.
    const totalActualSize = totalRows * itemSize;
    const totalVirtualSize = Math.min(totalActualSize, MAX_VIRTUAL_SIZE);
    const maxVirtualScroll = totalVirtualSize - containerSize;
    const maxActualScroll = totalActualSize - containerSize;
    const ratio = maxVirtualScroll > 0 ? maxActualScroll / maxVirtualScroll : 1;
    const actualOffset = scrollPosition * ratio;

    const lastVisibleRow = Math.ceil(
      (actualOffset + containerSize) / itemSize
    );
    return Math.min(lastVisibleRow * columns, total);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  function getState(): StatsState {
    const total = config.getTotal();
    const itemCount = getItemCount();
    const progress =
      total > 0 ? Math.min(100, Math.max(0, (itemCount / total) * 100)) : 0;

    return {
      progress,
      velocity: currentVelocity,
      velocityAvg: getVelocityAverage(),
      itemCount,
      total,
    };
  }

  return {
    getState,
    onVelocity,
  };
}