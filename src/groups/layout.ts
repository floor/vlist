/**
 * vlist - Group Layout
 * Computes group boundaries and maps between data indices and layout indices.
 *
 * The layout transforms a flat items array into a "layout" that includes
 * group header pseudo-items interspersed at group boundaries:
 *
 *   Data:   [item0, item1, item2, item3, item4, item5]
 *   Groups: [  A,     A,     A,     B,     B,     C  ]
 *   Layout: [headerA, item0, item1, item2, headerB, item3, item4, headerC, item5]
 *   Index:  [  0,       1,     2,     3,      4,      5,     6,      7,      8  ]
 *
 * All lookups are O(log g) where g = number of groups, using binary search
 * on the sorted group boundaries array.
 */

import type {
  GroupsConfig,
  GroupBoundary,
  GroupLayout,
  LayoutEntry,
  GroupHeaderItem,
} from "./types";
import type { VListItem } from "../types";

// =============================================================================
// Binary Search Helpers
// =============================================================================

/**
 * Find the last group whose headerLayoutIndex <= layoutIndex.
 * Returns the group's index in the groups array.
 */
const findGroupByLayoutIndex = (
  groups: readonly GroupBoundary[],
  layoutIndex: number,
): number => {
  let lo = 0;
  let hi = groups.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (groups[mid]!.headerLayoutIndex <= layoutIndex) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
};

/**
 * Find the last group whose firstDataIndex <= dataIndex.
 * Returns the group's index in the groups array.
 */
const findGroupByDataIndex = (
  groups: readonly GroupBoundary[],
  dataIndex: number,
): number => {
  let lo = 0;
  let hi = groups.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (groups[mid]!.firstDataIndex <= dataIndex) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
};

// =============================================================================
// Layout Builder
// =============================================================================

/**
 * Build the groups array from the items using getGroupForIndex.
 *
 * Items MUST be pre-sorted by group — a new group boundary is created
 * whenever getGroupForIndex returns a different value than the previous call.
 */
const buildGroups = (
  itemCount: number,
  getGroupForIndex: (index: number) => string,
): GroupBoundary[] => {
  if (itemCount === 0) return [];

  const groups: GroupBoundary[] = [];
  let currentKey = getGroupForIndex(0);
  let groupStart = 0;
  let headerLayoutIndex = 0; // first group's header is at layout index 0

  for (let i = 1; i < itemCount; i++) {
    const key = getGroupForIndex(i);

    if (key !== currentKey) {
      // Close the current group
      const count = i - groupStart;
      groups.push({
        key: currentKey,
        groupIndex: groups.length,
        headerLayoutIndex,
        firstDataIndex: groupStart,
        count,
      });

      // Start a new group
      // The new header's layout index = previous header's layout index + 1 (header) + count (items)
      headerLayoutIndex = headerLayoutIndex + 1 + count;
      currentKey = key;
      groupStart = i;
    }
  }

  // Close the last group
  groups.push({
    key: currentKey,
    groupIndex: groups.length,
    headerLayoutIndex,
    firstDataIndex: groupStart,
    count: itemCount - groupStart,
  });

  return groups;
};

// =============================================================================
// Layout Items Builder
// =============================================================================

/**
 * Build the transformed layout items array with header pseudo-items inserted
 * at group boundaries.
 *
 * @param items - Original data items
 * @param groups - Computed group boundaries
 * @returns Array of items and header pseudo-items in layout order
 */
export const buildLayoutItems = <T extends VListItem>(
  items: T[],
  groups: readonly GroupBoundary[],
): Array<T | GroupHeaderItem> => {
  if (items.length === 0 || groups.length === 0) return [];

  const totalEntries = items.length + groups.length;
  const result: Array<T | GroupHeaderItem> = new Array(totalEntries);

  let layoutIdx = 0;

  for (const group of groups) {
    // Insert header pseudo-item
    result[layoutIdx] = {
      id: `__group_header_${group.groupIndex}`,
      __groupHeader: true,
      groupKey: group.key,
      groupIndex: group.groupIndex,
    } as GroupHeaderItem;
    layoutIdx++;

    // Insert data items for this group
    for (let i = 0; i < group.count; i++) {
      result[layoutIdx] = items[group.firstDataIndex + i]!;
      layoutIdx++;
    }
  }

  return result;
};

// =============================================================================
// Height Function Builder
// =============================================================================

/**
 * Create a height function for the layout that returns the correct height
 * for both group headers and data items.
 *
 * @param layout - The group layout instance
 * @param itemHeight - Original item height config (number or function)
 * @returns A height function (layoutIndex) => number suitable for HeightCache
 */
export const createGroupedHeightFn = (
  layout: GroupLayout,
  itemHeight: number | ((index: number) => number),
): ((layoutIndex: number) => number) => {
  const getItemHeight =
    typeof itemHeight === "number"
      ? (_dataIndex: number): number => itemHeight
      : itemHeight;

  return (layoutIndex: number): number => {
    const entry = layout.getEntry(layoutIndex);

    if (entry.type === "header") {
      return layout.getHeaderHeight(entry.group.groupIndex);
    }

    return getItemHeight(entry.dataIndex);
  };
};

// =============================================================================
// GroupLayout Factory
// =============================================================================

/**
 * Create a GroupLayout instance.
 *
 * The layout computes group boundaries from items and provides efficient
 * O(log g) mappings between data indices and layout indices.
 *
 * @param itemCount - Number of data items
 * @param config - Groups configuration
 */
export const createGroupLayout = (
  itemCount: number,
  config: GroupsConfig,
): GroupLayout => {
  let groups: GroupBoundary[] = buildGroups(itemCount, config.getGroupForIndex);
  let totalEntries = itemCount + groups.length;

  // Pre-compute header heights if using fixed height
  const headerHeightConfig = config.headerHeight;
  const getHeaderHeight =
    typeof headerHeightConfig === "number"
      ? (_groupIndex: number): number => headerHeightConfig
      : (groupIndex: number): number => {
          const group = groups[groupIndex];
          if (!group) return 0;
          return headerHeightConfig(group.key, groupIndex);
        };

  // =========================================================================
  // Public API
  // =========================================================================

  const getEntry = (layoutIndex: number): LayoutEntry => {
    if (groups.length === 0) {
      // Fallback: shouldn't happen if totalEntries > 0
      return {
        type: "item",
        dataIndex: layoutIndex,
        group: {
          key: "",
          groupIndex: 0,
          headerLayoutIndex: 0,
          firstDataIndex: 0,
          count: 0,
        },
      };
    }

    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    const group = groups[gi]!;

    if (layoutIndex === group.headerLayoutIndex) {
      return { type: "header", group };
    }

    // It's a data item within this group
    const offsetInGroup = layoutIndex - group.headerLayoutIndex - 1;
    const dataIndex = group.firstDataIndex + offsetInGroup;

    return { type: "item", dataIndex, group };
  };

  const layoutToDataIndex = (layoutIndex: number): number => {
    if (groups.length === 0) return layoutIndex;

    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    const group = groups[gi]!;

    if (layoutIndex === group.headerLayoutIndex) {
      return -1; // It's a header
    }

    const offsetInGroup = layoutIndex - group.headerLayoutIndex - 1;
    return group.firstDataIndex + offsetInGroup;
  };

  const dataToLayoutIndex = (dataIndex: number): number => {
    if (groups.length === 0) return dataIndex;

    const gi = findGroupByDataIndex(groups, dataIndex);
    const group = groups[gi]!;

    // Layout index = header layout index + 1 (skip header) + offset within group
    const offsetInGroup = dataIndex - group.firstDataIndex;
    return group.headerLayoutIndex + 1 + offsetInGroup;
  };

  const getGroupAtLayoutIndex = (layoutIndex: number): GroupBoundary => {
    if (groups.length === 0) {
      return {
        key: "",
        groupIndex: 0,
        headerLayoutIndex: 0,
        firstDataIndex: 0,
        count: 0,
      };
    }

    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    return groups[gi]!;
  };

  const getGroupAtDataIndex = (dataIndex: number): GroupBoundary => {
    if (groups.length === 0) {
      return {
        key: "",
        groupIndex: 0,
        headerLayoutIndex: 0,
        firstDataIndex: 0,
        count: 0,
      };
    }

    const gi = findGroupByDataIndex(groups, dataIndex);
    return groups[gi]!;
  };

  const rebuild = (newItemCount: number): void => {
    groups = buildGroups(newItemCount, config.getGroupForIndex);
    totalEntries = newItemCount + groups.length;
  };

  return {
    get totalEntries() {
      return totalEntries;
    },

    get groupCount() {
      return groups.length;
    },

    get groups() {
      return groups;
    },

    getEntry,
    layoutToDataIndex,
    dataToLayoutIndex,
    getGroupAtLayoutIndex,
    getGroupAtDataIndex,
    getHeaderHeight,
    rebuild,
  };
};
