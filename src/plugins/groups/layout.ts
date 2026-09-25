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
import type { VListItem } from "../../types";

/** Shared empty-group sentinel — returned when the layout has no groups. */
const EMPTY_GROUP: GroupBoundary = {
  key: "",
  groupIndex: 0,
  headerLayoutIndex: 0,
  firstDataIndex: 0,
  count: 0,
};

// =============================================================================
// Binary Search Helpers
// =============================================================================

/**
 * Find the last group whose headerLayoutIndex <= layoutIndex.
 * Returns the group's index in the groups array.
 */
export const findGroupByLayoutIndex = (
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
export const findGroupByDataIndex = (
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
const buildGroups = <T extends VListItem>(
  itemCount: number,
  getGroupForIndex: (index: number, item?: T) => string,
  getItem?: (index: number) => T | undefined,
): GroupBoundary[] => {
  if (itemCount === 0) return [];

  const groups: GroupBoundary[] = [];
  let currentKey: string | null = null;
  let groupStart = 0;
  let headerLayoutIndex = 0;

  for (let i = 0; i < itemCount; i++) {
    const item = getItem?.(i);
    // Skip unloaded items — they extend the current group without
    // creating boundaries. This avoids "Unknown" headers for placeholders.
    if (!item) continue;

    const key = getGroupForIndex(i, item);

    if (currentKey === null) {
      // First loaded item — start first group
      currentKey = key;
      groupStart = 0;
      // All items before this one (unloaded) belong to this group
    } else if (key !== currentKey) {
      const count = i - groupStart;
      groups.push({
        key: currentKey,
        groupIndex: groups.length,
        headerLayoutIndex,
        firstDataIndex: groupStart,
        count,
      });
      headerLayoutIndex = headerLayoutIndex + 1 + count;
      currentKey = key;
      groupStart = i;
    }
  }

  if (currentKey !== null) {
    // Close the last group — includes all remaining unloaded items
    groups.push({
      key: currentKey,
      groupIndex: groups.length,
      headerLayoutIndex,
      firstDataIndex: groupStart,
      count: itemCount - groupStart,
    });
  }

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
 * Create a size function for the layout (items + headers).
 *
 * Maps layout indices to sizes, accounting for both group headers and data items.
 *
 * @param layout - The group layout instance
 * @param itemSize - Original item size config (number or function)
 * @returns A size function (layoutIndex) => number suitable for SizeCache
 */
export const createGroupedSizeFn = <T extends VListItem = VListItem>(
  layout: GroupLayout<T>,
  itemSize: number | ((index: number) => number),
  sticky: boolean = false,
): ((layoutIndex: number) => number) => {
  const getItemSize =
    typeof itemSize === "number"
      ? (_dataIndex: number): number => itemSize
      : itemSize;

  return (layoutIndex: number): number => {
    const entry = layout.getEntry(layoutIndex);

    if (entry.type === "header") {
      // When sticky headers are active the first group's inline header
      // is redundant (the sticky header already shows it).  Collapse it
      // to 0 so it occupies no space in the layout.
      if (sticky && entry.group.groupIndex === 0) return 0;
      return layout.getHeaderHeight(entry.group.groupIndex);
    }

    return getItemSize(entry.dataIndex);
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
export const createGroupLayout = <T extends VListItem = VListItem>(
  itemCount: number,
  config: GroupsConfig<T>,
  getItem?: (index: number) => T | undefined,
): GroupLayout<T> => {
  let groups: GroupBoundary[] = buildGroups(itemCount, config.getGroupForIndex, getItem);
  let totalEntries = itemCount + groups.length;

  // Pre-compute header sizes — resolve from height, width, or legacy headerHeight
  const headerHeightConfig = config.header?.height ?? config.header?.width ?? config.headerHeight!;
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

  // Reused by getEntry — one object per entry kind, mutated in place.
  // Callers must read fields immediately; the next getEntry overwrites them.
  const reusableHeader: { type: "header"; group: GroupBoundary } = {
    type: "header",
    group: EMPTY_GROUP,
  };
  const reusableItem: { type: "item"; dataIndex: number; group: GroupBoundary } = {
    type: "item",
    dataIndex: 0,
    group: EMPTY_GROUP,
  };

  const getEntry = (layoutIndex: number): LayoutEntry => {
    if (groups.length === 0) {
      // Fallback: shouldn't happen if totalEntries > 0
      reusableItem.dataIndex = layoutIndex;
      reusableItem.group = EMPTY_GROUP;
      return reusableItem;
    }

    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    const group = groups[gi]!;

    if (layoutIndex === group.headerLayoutIndex) {
      reusableHeader.group = group;
      return reusableHeader;
    }

    // It's a data item within this group
    const offsetInGroup = layoutIndex - group.headerLayoutIndex - 1;
    reusableItem.dataIndex = group.firstDataIndex + offsetInGroup;
    reusableItem.group = group;
    return reusableItem;
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
    if (groups.length === 0) return EMPTY_GROUP;

    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    return groups[gi]!;
  };

  const getGroupAtDataIndex = (dataIndex: number): GroupBoundary => {
    if (groups.length === 0) return EMPTY_GROUP;

    const gi = findGroupByDataIndex(groups, dataIndex);
    return groups[gi]!;
  };

  const rebuild = (newItemCount: number, newGetItem?: (index: number) => T | undefined): void => {
    groups = buildGroups(newItemCount, config.getGroupForIndex, newGetItem ?? getItem);
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
