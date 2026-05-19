/**
 * vlist - Async Group Bridge
 * Virtual group layer that bridges withAsync's sparse data manager with
 * withGroups' layout system.
 *
 * Instead of physically inserting header pseudo-items into the data array
 * (which is impossible with sparse storage), this bridge:
 * - Observes items as they load via onItemsLoaded callbacks
 * - Discovers group boundaries incrementally from loaded data
 * - Maps between "data indices" (what the async manager knows) and
 *   "layout indices" (what the renderer sees, including header slots)
 * - Provides header/item resolution at render time
 *
 * Group boundaries are only computed for contiguous loaded ranges.
 * Unloaded gaps have no headers — placeholders render as regular items.
 * When gaps fill in, boundaries are recomputed.
 */

import type { VListItem } from "../../types";
import type { GroupBoundary, GroupHeaderItem } from "./types";
import { findGroupByDataIndex, findGroupByLayoutIndex } from "./layout";

// =============================================================================
// Types
// =============================================================================

/** Configuration for the async group bridge */
export interface AsyncBridgeConfig {
  /** Determine group key for an item */
  getGroupForIndex: (index: number, item?: any) => string;

  /** Header height in pixels (resolved for current orientation) */
  headerHeight: number;
}

/** Async group bridge instance */
export interface AsyncGroupBridge {
  /** Process newly loaded items — updates group boundaries */
  onItemsLoaded(items: VListItem[], offset: number, total: number): void;

  /** Total layout entries (data items + discovered headers) */
  readonly totalEntries: number;

  /** Number of discovered groups */
  readonly groupCount: number;

  /** All discovered group boundaries */
  readonly groups: readonly GroupBoundary[];

  /** Check if a layout index is a group header */
  isHeader(layoutIndex: number): boolean;

  /** Get the group header item at a layout index (undefined if not a header) */
  getHeaderItem(layoutIndex: number): GroupHeaderItem | undefined;

  /** Map layout index → data index (-1 if it's a header) */
  layoutToDataIndex(layoutIndex: number): number;

  /** Map data index → layout index */
  dataToLayoutIndex(dataIndex: number): number;

  /** Get header height for a group */
  getHeaderHeight(groupIndex: number): number;

  /** Get the group boundary at a layout index */
  getGroupAtLayoutIndex(layoutIndex: number): GroupBoundary;

  /** Get the group boundary at a data index */
  getGroupAtDataIndex(dataIndex: number): GroupBoundary;

  /** Insert item at data index — shifts group keys up and rebuilds */
  insertAt(dataIndex: number, item: VListItem): void;

  /** Remove item at data index — shifts group keys and rebuilds */
  removeAt(dataIndex: number): void;

  /** Reset all state (e.g. on reload) */
  reset(): void;
}

// =============================================================================
// Factory
// =============================================================================

const EMPTY_GROUP: GroupBoundary = {
  key: "",
  groupIndex: 0,
  headerLayoutIndex: 0,
  firstDataIndex: 0,
  count: 0,
};

/**
 * Create an async group bridge.
 *
 * The bridge discovers group boundaries incrementally as items load from
 * the async adapter. It maintains a mapping between data indices (sparse
 * storage) and layout indices (data items + group headers).
 *
 * @param config - Bridge configuration
 * @param getItem - Item accessor from the async data manager
 * @param isItemLoaded - Check if an item at index is loaded (not placeholder)
 */
export const createAsyncGroupBridge = (
  config: AsyncBridgeConfig,
  _getItem?: (index: number) => VListItem | undefined,
  _isItemLoaded?: (index: number) => boolean,
): AsyncGroupBridge => {
  let groups: GroupBoundary[] = [];
  let dataTotal = 0;
  let totalEntries = 0;

  // Track group key for each loaded data index.
  // This survives across onItemsLoaded calls so we can detect
  // cross-page group boundaries.
  const groupKeyByIndex = new Map<number, string>();

  /**
   * Rebuild group boundaries from all known group keys.
   *
   * Scans from index 0 to dataTotal-1. For loaded items, uses the cached
   * group key. For unloaded items, skips them — no header is inserted at
   * load/unload boundaries.
   *
   * This runs on each onItemsLoaded. It's O(dataTotal) in theory but
   * only does map lookups per index — fast in practice.
   */
  const rebuildGroups = (): void => {
    groups = [];

    if (dataTotal === 0 || groupKeyByIndex.size === 0) {
      totalEntries = dataTotal;
      return;
    }

    let currentKey: string | null = null;
    let groupStart = -1;
    // Running header count — each discovered group adds 1 header
    let headerCount = 0;

    for (let i = 0; i < dataTotal; i++) {
      const key = groupKeyByIndex.get(i);

      if (key === undefined) {
        // Unloaded item — close any open group
        if (currentKey !== null && groupStart >= 0) {
          const count = i - groupStart;
          groups.push({
            key: currentKey,
            groupIndex: groups.length,
            headerLayoutIndex: groupStart + headerCount,
            firstDataIndex: groupStart,
            count,
          });
          headerCount++;
          currentKey = null;
          groupStart = -1;
        }
        continue;
      }

      if (key !== currentKey) {
        // Close previous group if any
        if (currentKey !== null && groupStart >= 0) {
          const count = i - groupStart;
          groups.push({
            key: currentKey,
            groupIndex: groups.length,
            headerLayoutIndex: groupStart + headerCount,
            firstDataIndex: groupStart,
            count,
          });
          headerCount++;
        }

        // Start new group
        currentKey = key;
        groupStart = i;
      }
    }

    // Close last open group
    if (currentKey !== null && groupStart >= 0) {
      const count = dataTotal - groupStart;
      groups.push({
        key: currentKey,
        groupIndex: groups.length,
        headerLayoutIndex: groupStart + headerCount,
        firstDataIndex: groupStart,
        count,
      });
      headerCount++;
    }

    totalEntries = dataTotal + headerCount;
  };

  // ── Public API ──

  const onItemsLoaded = (items: VListItem[], offset: number, total: number): void => {
    dataTotal = total;

    // Cache group keys for loaded items
    for (let i = 0; i < items.length; i++) {
      const dataIndex = offset + i;
      const item = items[i];
      if (item !== undefined) {
        const key = config.getGroupForIndex(dataIndex, item);
        groupKeyByIndex.set(dataIndex, key);
      }
    }

    rebuildGroups();
  };

  const isHeader = (layoutIndex: number): boolean => {
    if (groups.length === 0) return false;
    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    const group = groups[gi]!;
    return layoutIndex === group.headerLayoutIndex;
  };

  const getHeaderItem = (layoutIndex: number): GroupHeaderItem | undefined => {
    if (groups.length === 0) return undefined;
    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    const group = groups[gi]!;
    if (layoutIndex !== group.headerLayoutIndex) return undefined;
    return {
      id: `__group_header_${group.groupIndex}`,
      __groupHeader: true,
      groupKey: group.key,
      groupIndex: group.groupIndex,
    } as GroupHeaderItem;
  };

  const layoutToDataIndex = (layoutIndex: number): number => {
    if (groups.length === 0) return layoutIndex;

    const gi = findGroupByLayoutIndex(groups, layoutIndex);
    const group = groups[gi]!;

    if (layoutIndex === group.headerLayoutIndex) {
      return -1;
    }

    const offsetInGroup = layoutIndex - group.headerLayoutIndex - 1;
    return group.firstDataIndex + offsetInGroup;
  };

  const dataToLayoutIndex = (dataIndex: number): number => {
    if (groups.length === 0) return dataIndex;

    const gi = findGroupByDataIndex(groups, dataIndex);
    const group = groups[gi]!;

    const offsetInGroup = dataIndex - group.firstDataIndex;
    return group.headerLayoutIndex + 1 + offsetInGroup;
  };

  const getHeaderHeight = (_groupIndex: number): number => config.headerHeight;

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

  const insertAt = (dataIndex: number, item: VListItem): void => {
    const newMap = new Map<number, string>();
    for (const [idx, key] of groupKeyByIndex) {
      if (idx < dataIndex) newMap.set(idx, key);
      else newMap.set(idx + 1, key);
    }
    groupKeyByIndex.clear();
    for (const [idx, key] of newMap) groupKeyByIndex.set(idx, key);

    const key = config.getGroupForIndex(dataIndex, item);
    groupKeyByIndex.set(dataIndex, key);

    dataTotal++;
    rebuildGroups();
  };

  const removeAt = (dataIndex: number): void => {
    // Remove the key at dataIndex and shift all subsequent keys down by 1
    const newMap = new Map<number, string>();
    for (const [idx, key] of groupKeyByIndex) {
      if (idx < dataIndex) newMap.set(idx, key);
      else if (idx > dataIndex) newMap.set(idx - 1, key);
      // idx === dataIndex is dropped
    }
    groupKeyByIndex.clear();
    for (const [idx, key] of newMap) groupKeyByIndex.set(idx, key);

    dataTotal--;
    rebuildGroups();
  };

  const reset = (): void => {
    groups = [];
    dataTotal = 0;
    totalEntries = 0;
    groupKeyByIndex.clear();
  };

  return {
    onItemsLoaded,

    get totalEntries() {
      return totalEntries;
    },
    get groupCount() {
      return groups.length;
    },
    get groups() {
      return groups;
    },

    isHeader,
    getHeaderItem,
    layoutToDataIndex,
    dataToLayoutIndex,
    getHeaderHeight,
    getGroupAtLayoutIndex,
    getGroupAtDataIndex,
    insertAt,
    removeAt,
    reset,
  };
};
