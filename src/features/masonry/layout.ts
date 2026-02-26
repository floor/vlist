/**
 * vlist - Masonry Layout
 * Shortest-lane placement algorithm for masonry/Pinterest-style layouts.
 *
 * Algorithm:
 * 1. Track the size (height/width) of each lane (column/row)
 * 2. For each item:
 *    - Find the shortest lane
 *    - Place item at the end of that lane
 *    - Update lane size
 * 3. Cache all item positions for O(1) lookup during rendering
 *
 * Complexity:
 * - Layout calculation: O(n) where n = total items
 * - Position lookup: O(1) using cached placements
 * - Visibility check: O(k * log(n/k)) using per-lane binary search
 *   where k = columns, n = total items
 */

import type {
  MasonryConfig,
  MasonryLayout,
  ItemPlacement,
} from "./types";

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a MasonryLayout instance.
 *
 * @param config - Masonry configuration (columns, gap, containerSize)
 * @returns MasonryLayout with placement algorithm
 */
export const createMasonryLayout = (
  config: MasonryConfig & { containerSize: number },
): MasonryLayout => {
  let columns = Math.max(1, Math.floor(config.columns));
  let gap = config.gap ?? 0;
  let containerSize = config.containerSize;

  // ── Cached derived values ──
  // Recomputed when columns, gap, or containerSize change.
  let crossAxisSize = 0;
  let laneOffsets: number[] = [];

  const recomputeDerived = (): void => {
    const totalGap = (columns - 1) * gap;
    crossAxisSize = Math.max(0, (containerSize - totalGap) / columns);

    laneOffsets = new Array(columns);
    const stride = crossAxisSize + gap;
    for (let i = 0; i < columns; i++) {
      laneOffsets[i] = i * stride;
    }
  };

  // Initial computation
  recomputeDerived();

  // ── Per-lane placement indices (for binary search in getVisibleItems) ──
  // Built by calculateLayout, consumed by getVisibleItems.
  let lanePlacements: number[][] = [];

  // ── Cached total size from last calculateLayout ──
  let cachedTotalSize = 0;

  // ── Pooled visible-items array ──
  // Reused by getVisibleItems to avoid allocation per scroll frame.
  // Single-consumer contract: caller must finish reading before the next call.
  let visiblePool: ItemPlacement[] = [];

  /**
   * Calculate cross-axis size (column width in vertical, row height in horizontal).
   */
  const getCrossAxisSize = (): number => crossAxisSize;

  /**
   * Calculate the cross-axis offset for a given lane.
   */
  const getCrossAxisOffset = (lane: number): number => laneOffsets[lane] ?? 0;

  /**
   * Find the index of the shortest lane.
   * Returns the lane with minimum accumulated size.
   */
  const findShortestLane = (laneSizes: number[]): number => {
    let shortestIndex = 0;
    let shortestSize = laneSizes[0]!;

    for (let i = 1; i < laneSizes.length; i++) {
      const currentSize = laneSizes[i]!;
      if (currentSize < shortestSize) {
        shortestSize = currentSize;
        shortestIndex = i;
      }
    }

    return shortestIndex;
  };

  /**
   * Calculate layout for all items using shortest-lane algorithm.
   * Returns array of item placements with cached positions.
   *
   * Also caches:
   * - Total size (tallest lane) — retrievable via getTotalSize([])
   * - Per-lane placement index lists — used by getVisibleItems for binary search
   */
  const calculateLayout = (
    totalItems: number,
    getSizeForItem: (index: number) => number,
  ): ItemPlacement[] => {
    if (totalItems <= 0) {
      cachedTotalSize = 0;
      lanePlacements = [];
      return [];
    }

    // Initialize lane sizes (accumulated height/width for each column/row)
    const laneSizes: number[] = new Array(columns).fill(0);

    // Per-lane placement indices (for binary search later)
    const lanes: number[][] = new Array(columns);
    for (let c = 0; c < columns; c++) {
      lanes[c] = [];
    }

    // Array to store all item placements
    const placements: ItemPlacement[] = new Array(totalItems);

    // Place each item in the shortest lane
    for (let i = 0; i < totalItems; i++) {
      // Find shortest lane
      const lane = findShortestLane(laneSizes);

      // Get item size in main axis
      const itemSize = getSizeForItem(i);

      // Position: use precomputed lane offset, current lane accumulator
      const mainOffset = laneSizes[lane]!;

      // Create placement
      placements[i] = {
        index: i,
        position: {
          x: laneOffsets[lane]!,
          y: mainOffset,
          lane,
        },
        size: itemSize,
        crossSize: crossAxisSize,
      };

      // Track placement index per lane
      lanes[lane]!.push(i);

      // Update lane size (add item size + gap)
      laneSizes[lane] = mainOffset + itemSize + gap;
    }

    // Cache per-lane placements for binary search
    lanePlacements = lanes;

    // Cache total size (max lane extent, minus trailing gap)
    let maxExtent = 0;
    for (let c = 0; c < columns; c++) {
      const laneSize = laneSizes[c]!;
      // laneSizes includes a trailing gap after the last item — subtract it
      // unless the lane is empty (size === 0)
      const extent = laneSize > 0 ? laneSize - gap : 0;
      if (extent > maxExtent) maxExtent = extent;
    }
    cachedTotalSize = maxExtent;

    return placements;
  };

  /**
   * Get total size in main axis (tallest column height or widest row width).
   * This determines the total scroll size.
   *
   * When called with the result of calculateLayout, returns the cached value
   * computed during layout (O(1)). Falls back to recomputation for external
   * placement arrays.
   */
  const getTotalSize = (placements: ItemPlacement[]): number => {
    // Fast path: return cached value when called with the layout result
    // (the common case — feature.ts always passes cachedPlacements)
    if (placements.length === 0) return cachedTotalSize > 0 ? cachedTotalSize : 0;

    // If the first placement matches our cached data, use cached total
    // This avoids the O(n) scan in the normal flow
    if (cachedTotalSize > 0) return cachedTotalSize;

    // Fallback: recompute (only for externally-constructed placements)
    const laneSizes: number[] = new Array(columns).fill(0);

    for (const placement of placements) {
      const lane = placement.position.lane;
      const extent = placement.position.y + placement.size;
      const currentSize = laneSizes[lane]!;
      if (extent > currentSize) {
        laneSizes[lane] = extent;
      }
    }

    let max = 0;
    for (let c = 0; c < columns; c++) {
      if (laneSizes[c]! > max) max = laneSizes[c]!;
    }
    return max;
  };

  /**
   * Get items visible within the given main-axis range.
   * Uses per-lane binary search for O(k * log(n/k)) performance
   * where k = columns and n = total items.
   *
   * Within each lane, items are sorted by Y position (guaranteed by the
   * shortest-lane algorithm). We binary search each lane to find the first
   * item whose bottom edge enters the viewport and the last item whose
   * top edge is before the viewport end.
   */
  const getVisibleItems = (
    placements: ItemPlacement[],
    mainAxisStart: number,
    mainAxisEnd: number,
  ): ItemPlacement[] => {
    if (placements.length === 0 || mainAxisEnd <= mainAxisStart) return visiblePool.length = 0, visiblePool;

    // If per-lane data isn't available (external placements), fall back to linear scan
    if (lanePlacements.length === 0 || lanePlacements.length !== columns) {
      return getVisibleItemsLinear(placements, mainAxisStart, mainAxisEnd);
    }

    // Reuse pooled array — reset length to 0 (no allocation)
    visiblePool.length = 0;

    for (let c = 0; c < columns; c++) {
      const laneIndices = lanePlacements[c]!;
      const laneLen = laneIndices.length;
      if (laneLen === 0) continue;

      // Binary search: find first item in this lane where itemEnd > mainAxisStart
      // i.e., the item's bottom edge is past the viewport top
      let lo = 0;
      let hi = laneLen;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const p = placements[laneIndices[mid]!]!;
        if (p.position.y + p.size <= mainAxisStart) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }

      // Collect visible items from this lane starting at `lo`
      for (let j = lo; j < laneLen; j++) {
        const p = placements[laneIndices[j]!]!;
        // Once the item's top edge is past the viewport bottom, stop
        if (p.position.y >= mainAxisEnd) break;
        visiblePool.push(p);
      }
    }

    return visiblePool;
  };

  /**
   * Linear fallback for getVisibleItems when per-lane data is unavailable.
   * Used only for externally-constructed placement arrays.
   */
  const getVisibleItemsLinear = (
    placements: ItemPlacement[],
    mainAxisStart: number,
    mainAxisEnd: number,
  ): ItemPlacement[] => {
    const visible: ItemPlacement[] = [];

    for (const placement of placements) {
      const itemStart = placement.position.y;
      const itemEnd = itemStart + placement.size;

      if (itemEnd > mainAxisStart && itemStart < mainAxisEnd) {
        visible.push(placement);
      }
    }

    return visible;
  };

  /**
   * Update masonry configuration without recreating the layout.
   */
  const updateConfig = (
    newConfig: Partial<MasonryConfig & { containerSize: number }>,
  ): void => {
    let changed = false;

    if (newConfig.columns !== undefined) {
      const newCols = Math.max(1, Math.floor(newConfig.columns));
      if (newCols !== columns) {
        columns = newCols;
        changed = true;
      }
    }
    if (newConfig.gap !== undefined && newConfig.gap !== gap) {
      gap = newConfig.gap;
      changed = true;
    }
    if (newConfig.containerSize !== undefined && newConfig.containerSize !== containerSize) {
      containerSize = newConfig.containerSize;
      changed = true;
    }

    if (changed) {
      recomputeDerived();
    }
  };

  return {
    get columns() {
      return columns;
    },
    get gap() {
      return gap;
    },
    get containerSize() {
      return containerSize;
    },
    update: updateConfig,
    calculateLayout,
    getTotalSize,
    getVisibleItems,
    getCrossAxisSize,
    getCrossAxisOffset,
  };
};