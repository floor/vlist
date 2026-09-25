// src/utils/stats.ts
// Pure computation module for scroll statistics.
// Tracks velocity (current + running average), computes cumulative item count
// and progress from scroll position using geometric mapping.
//
// No DOM access, no RAF, no side effects — purely functional state tracker.

// =============================================================================
// Constants
// =============================================================================

const MAX_VELOCITY = 50;
const MIN_VELOCITY = 0.1;

// =============================================================================
// Types
// =============================================================================

export interface StatsConfig {
  /** Returns the unscaled logical position, normally list.getScrollPosition(). */
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
 * Position is an unscaled logical offset on both native and synthetic entries,
 * clamped to the declared content's real scroll range. Progress counts items up
 * to the viewport end (including partial rows), rather than just scroll distance.
 *
 * Native content beyond the browser limit still uses its full declared size:
 * a browser-clamped position is not expanded to the end, so progress may never
 * reach 100%. Handle the core's `content:size:overflow` error and use
 * `vlist/synthetic` when the full range must remain reachable.
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
   * Native and synthetic positions already use the content's logical pixels.
   * Clamp overscroll to [0, max(0, totalRows * itemSize - containerSize)], then count
   * through the viewport's trailing edge. For grids, multiply rows by columns
   * and cap the result at the actual item count (the last row may be partial).
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

    const maxScroll = Math.max(0, totalRows * itemSize - containerSize);
    const offset = Math.max(0, Math.min(scrollPosition, maxScroll));

    const lastVisibleRow = Math.ceil(
      (offset + containerSize) / itemSize
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