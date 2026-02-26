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
 * - Visibility check: O(n) but typically small n (only checking visible range)
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

  /**
   * Calculate cross-axis size (column width in vertical, row height in horizontal).
   * Formula: (containerSize - (columns - 1) * gap) / columns
   */
  const getCrossAxisSize = (): number => {
    const totalGap = (columns - 1) * gap;
    return Math.max(0, (containerSize - totalGap) / columns);
  };

  /**
   * Calculate the cross-axis offset for a given lane.
   * Formula: lane * (crossAxisSize + gap)
   */
  const getCrossAxisOffset = (lane: number): number => {
    const crossSize = getCrossAxisSize();
    return lane * (crossSize + gap);
  };

  /**
   * Find the index of the shortest lane.
   * Returns the lane with minimum accumulated size.
   */
  const findShortestLane = (laneSizes: number[]): number => {
    if (laneSizes.length === 0) return 0;
    
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
   */
  const calculateLayout = (
    totalItems: number,
    getSizeForItem: (index: number) => number,
  ): ItemPlacement[] => {
    if (totalItems <= 0) return [];

    // Initialize lane sizes (accumulated height/width for each column/row)
    const laneSizes: number[] = new Array(columns).fill(0);

    // Calculate cross-axis size once
    const crossSize = getCrossAxisSize();

    // Array to store all item placements
    const placements: ItemPlacement[] = new Array(totalItems);

    // Place each item in the shortest lane
    for (let i = 0; i < totalItems; i++) {
      // Find shortest lane
      const lane = findShortestLane(laneSizes);

      // Get item size in main axis
      const itemSize = getSizeForItem(i);

      // Calculate position
      const crossOffset = getCrossAxisOffset(lane);
      const mainOffset = laneSizes[lane]!;

      // Create placement
      placements[i] = {
        index: i,
        position: {
          x: crossOffset,
          y: mainOffset,
          lane,
        },
        size: itemSize,
        crossSize: crossSize,
      };

      // Update lane size (add item size + gap)
      laneSizes[lane]! += itemSize + gap;
    }

    return placements;
  };

  /**
   * Get total size in main axis (tallest column height or widest row width).
   * This determines the total scroll size.
   */
  const getTotalSize = (placements: ItemPlacement[]): number => {
    if (placements.length === 0) return 0;

    // Track maximum extent in each lane
    const laneSizes: number[] = new Array(columns).fill(0);

    for (const placement of placements) {
      const lane = placement.position.lane;
      const extent = placement.position.y + placement.size;
      const currentSize = laneSizes[lane];
      if (currentSize !== undefined) {
        laneSizes[lane] = Math.max(currentSize, extent);
      }
    }

    // Return the maximum lane size
    return laneSizes.length > 0 ? Math.max(...laneSizes) : 0;
  };

  /**
   * Get items visible within the given main-axis range.
   * mainAxisStart/End represent scroll position (scrollTop/scrollLeft + viewport size).
   */
  const getVisibleItems = (
    placements: ItemPlacement[],
    mainAxisStart: number,
    mainAxisEnd: number,
  ): ItemPlacement[] => {
    const visible: ItemPlacement[] = [];

    for (const placement of placements) {
      const itemStart = placement.position.y;
      const itemEnd = itemStart + placement.size;

      // Check if item overlaps with visible range
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
    if (newConfig.columns !== undefined) {
      columns = Math.max(1, Math.floor(newConfig.columns));
    }
    if (newConfig.gap !== undefined) {
      gap = newConfig.gap;
    }
    if (newConfig.containerSize !== undefined) {
      containerSize = newConfig.containerSize;
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