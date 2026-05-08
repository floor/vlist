/**
 * vlist - Async Group Bridge Tests
 * Tests for incremental group discovery and index mapping with async data.
 */

import { describe, it, expect } from "bun:test";
import { createAsyncGroupBridge } from "../../../src/features/groups/async-bridge";
import type { VListItem } from "../../../src/types";

// =============================================================================
// Test Helpers
// =============================================================================

interface TestTrack extends VListItem {
  id: string;
  title: string;
  day: string;
}

const makeTracks = (entries: Array<[string, string]>): TestTrack[] =>
  entries.map(([title, day], i) => ({
    id: `track-${i}`,
    title,
    day,
  }));

/**
 * Tracks sorted by upload day (descending — most recent first):
 *   May 7: tracks 0-2 (3 items)
 *   May 6: tracks 3-5 (3 items)
 *   May 5: tracks 6-8 (3 items)
 */
const ALL_TRACKS = makeTracks([
  ["Track A", "May 7"],
  ["Track B", "May 7"],
  ["Track C", "May 7"],
  ["Track D", "May 6"],
  ["Track E", "May 6"],
  ["Track F", "May 6"],
  ["Track G", "May 5"],
  ["Track H", "May 5"],
  ["Track I", "May 5"],
]);

const getGroup = (_index: number, item?: any): string => item?.day ?? "Unknown";

const createBridge = () => {
  const loaded = new Map<number, TestTrack>();

  const getItem = (index: number): TestTrack | undefined => loaded.get(index);
  const isItemLoaded = (index: number): boolean => loaded.has(index);

  const bridge = createAsyncGroupBridge(
    { getGroupForIndex: getGroup, headerHeight: 36 },
    getItem,
    isItemLoaded,
  );

  const loadItems = (items: TestTrack[], offset: number, total: number): void => {
    for (let i = 0; i < items.length; i++) {
      loaded.set(offset + i, items[i]!);
    }
    bridge.onItemsLoaded(items, offset, total);
  };

  return { bridge, loadItems, loaded };
};

// =============================================================================
// Basic Construction
// =============================================================================

describe("createAsyncGroupBridge", () => {
  describe("initial state", () => {
    it("should start with zero entries and groups", () => {
      const { bridge } = createBridge();
      expect(bridge.totalEntries).toBe(0);
      expect(bridge.groupCount).toBe(0);
      expect(bridge.groups).toEqual([]);
    });
  });

  // ===========================================================================
  // Single Page Load
  // ===========================================================================

  describe("single page load", () => {
    it("should discover groups from first page", () => {
      const { bridge, loadItems } = createBridge();

      // Load all 9 tracks in one page
      loadItems(ALL_TRACKS, 0, 9);

      expect(bridge.groupCount).toBe(3);
      expect(bridge.groups[0]!.key).toBe("May 7");
      expect(bridge.groups[1]!.key).toBe("May 6");
      expect(bridge.groups[2]!.key).toBe("May 5");
    });

    it("should compute correct totalEntries (items + headers)", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      // 9 items + 3 headers = 12
      expect(bridge.totalEntries).toBe(12);
    });

    it("should compute correct group boundaries", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      // Group 0 (May 7): header at layout 0, data starts at 0, count 3
      expect(bridge.groups[0]).toEqual({
        key: "May 7",
        groupIndex: 0,
        headerLayoutIndex: 0,
        firstDataIndex: 0,
        count: 3,
      });

      // Group 1 (May 6): header at layout 4, data starts at 3, count 3
      expect(bridge.groups[1]).toEqual({
        key: "May 6",
        groupIndex: 1,
        headerLayoutIndex: 4,
        firstDataIndex: 3,
        count: 3,
      });

      // Group 2 (May 5): header at layout 8, data starts at 6, count 3
      expect(bridge.groups[2]).toEqual({
        key: "May 5",
        groupIndex: 2,
        headerLayoutIndex: 8,
        firstDataIndex: 6,
        count: 3,
      });
    });
  });

  // ===========================================================================
  // Index Mapping
  // ===========================================================================

  describe("index mapping", () => {
    it("should map layout indices to data indices", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      // Layout: [H0, T0, T1, T2, H1, T3, T4, T5, H2, T6, T7, T8]
      expect(bridge.layoutToDataIndex(0)).toBe(-1);  // header
      expect(bridge.layoutToDataIndex(1)).toBe(0);   // track 0
      expect(bridge.layoutToDataIndex(2)).toBe(1);   // track 1
      expect(bridge.layoutToDataIndex(3)).toBe(2);   // track 2
      expect(bridge.layoutToDataIndex(4)).toBe(-1);  // header
      expect(bridge.layoutToDataIndex(5)).toBe(3);   // track 3
      expect(bridge.layoutToDataIndex(8)).toBe(-1);  // header
      expect(bridge.layoutToDataIndex(11)).toBe(8);  // track 8
    });

    it("should map data indices to layout indices", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      expect(bridge.dataToLayoutIndex(0)).toBe(1);   // track 0 → layout 1
      expect(bridge.dataToLayoutIndex(2)).toBe(3);   // track 2 → layout 3
      expect(bridge.dataToLayoutIndex(3)).toBe(5);   // track 3 → layout 5
      expect(bridge.dataToLayoutIndex(6)).toBe(9);   // track 6 → layout 9
      expect(bridge.dataToLayoutIndex(8)).toBe(11);  // track 8 → layout 11
    });

    it("should detect headers correctly", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      expect(bridge.isHeader(0)).toBe(true);   // header May 7
      expect(bridge.isHeader(1)).toBe(false);  // track
      expect(bridge.isHeader(4)).toBe(true);   // header May 6
      expect(bridge.isHeader(8)).toBe(true);   // header May 5
    });

    it("should return header items with correct keys", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      const h0 = bridge.getHeaderItem(0);
      expect(h0).not.toBeUndefined();
      expect(h0!.groupKey).toBe("May 7");
      expect(h0!.groupIndex).toBe(0);
      expect(h0!.__groupHeader).toBe(true);

      const h1 = bridge.getHeaderItem(4);
      expect(h1!.groupKey).toBe("May 6");

      // Non-header returns undefined
      expect(bridge.getHeaderItem(1)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Incremental Loading (Paginated)
  // ===========================================================================

  describe("incremental loading", () => {
    it("should discover new groups as pages load", () => {
      const { bridge, loadItems } = createBridge();

      // Page 1: tracks 0-4 (May 7 x3 + May 6 x2)
      loadItems(ALL_TRACKS.slice(0, 5), 0, 9);
      expect(bridge.groupCount).toBe(2);
      expect(bridge.groups[0]!.key).toBe("May 7");
      expect(bridge.groups[1]!.key).toBe("May 6");
      // May 6 has only 2 items so far
      expect(bridge.groups[1]!.count).toBe(2);

      // Page 2: tracks 5-8 (May 6 x1 + May 5 x3)
      loadItems(ALL_TRACKS.slice(5), 5, 9);
      expect(bridge.groupCount).toBe(3);
      expect(bridge.groups[2]!.key).toBe("May 5");
      // May 6 now has 3 items (cross-page merge)
      expect(bridge.groups[1]!.count).toBe(3);
    });

    it("should handle cross-page group boundaries", () => {
      const { bridge, loadItems } = createBridge();

      // Page 1: first 3 tracks (all May 7)
      loadItems(ALL_TRACKS.slice(0, 3), 0, 9);
      expect(bridge.groupCount).toBe(1);
      expect(bridge.totalEntries).toBe(10); // 9 total data items + 1 discovered header

      // Page 2: tracks 3-5 (all May 6) — new group
      loadItems(ALL_TRACKS.slice(3, 6), 3, 9);
      expect(bridge.groupCount).toBe(2);
      expect(bridge.totalEntries).toBe(11); // 9 total data items + 2 discovered headers
    });

    it("should handle cross-page merge when same group spans pages", () => {
      const { bridge, loadItems } = createBridge();

      // Custom tracks: split a group across pages
      const tracks = makeTracks([
        ["A1", "Day 1"],
        ["A2", "Day 1"],
        ["A3", "Day 1"],  // page boundary here
        ["A4", "Day 1"],  // same group continues
        ["B1", "Day 2"],
      ]);

      loadItems(tracks.slice(0, 3), 0, 5);
      expect(bridge.groupCount).toBe(1);
      expect(bridge.groups[0]!.count).toBe(3);

      loadItems(tracks.slice(3), 3, 5);
      expect(bridge.groupCount).toBe(2);
      // Day 1 group should have merged: 4 items total
      expect(bridge.groups[0]!.count).toBe(4);
      expect(bridge.groups[1]!.key).toBe("Day 2");
      expect(bridge.groups[1]!.count).toBe(1);
    });
  });

  // ===========================================================================
  // Sparse Loading (Non-Sequential)
  // ===========================================================================

  describe("sparse loading", () => {
    it("should handle gaps in loaded data", () => {
      const { bridge, loadItems } = createBridge();

      // Load page 1 (0-2) and page 3 (6-8) but NOT page 2 (3-5)
      loadItems(ALL_TRACKS.slice(0, 3), 0, 9);
      loadItems(ALL_TRACKS.slice(6), 6, 9);

      // Should see 2 groups (May 7 and May 5), NOT May 6 (gap)
      expect(bridge.groupCount).toBe(2);
      expect(bridge.groups[0]!.key).toBe("May 7");
      expect(bridge.groups[1]!.key).toBe("May 5");

      // Unloaded items (3-5) have no headers
      // Total: 6 loaded items + 3 unloaded + 2 headers = 11
      expect(bridge.totalEntries).toBe(11);
    });

    it("should add groups when gap fills in", () => {
      const { bridge, loadItems } = createBridge();

      // Load page 1 and 3, skip page 2
      loadItems(ALL_TRACKS.slice(0, 3), 0, 9);
      loadItems(ALL_TRACKS.slice(6), 6, 9);
      expect(bridge.groupCount).toBe(2);

      // Now fill the gap (page 2)
      loadItems(ALL_TRACKS.slice(3, 6), 3, 9);
      expect(bridge.groupCount).toBe(3);
      expect(bridge.groups[1]!.key).toBe("May 6");
    });
  });

  // ===========================================================================
  // Group Lookup by Index
  // ===========================================================================

  describe("group lookups", () => {
    it("should get group at layout index", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      expect(bridge.getGroupAtLayoutIndex(0).key).toBe("May 7");
      expect(bridge.getGroupAtLayoutIndex(1).key).toBe("May 7");
      expect(bridge.getGroupAtLayoutIndex(4).key).toBe("May 6");
      expect(bridge.getGroupAtLayoutIndex(5).key).toBe("May 6");
      expect(bridge.getGroupAtLayoutIndex(8).key).toBe("May 5");
    });

    it("should get group at data index", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      expect(bridge.getGroupAtDataIndex(0).key).toBe("May 7");
      expect(bridge.getGroupAtDataIndex(2).key).toBe("May 7");
      expect(bridge.getGroupAtDataIndex(3).key).toBe("May 6");
      expect(bridge.getGroupAtDataIndex(6).key).toBe("May 5");
    });
  });

  // ===========================================================================
  // removeAt
  // ===========================================================================

  describe("removeAt", () => {
    it("removes a middle item — group count stays, group item count decrements", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      // Remove Track B (dataIndex 1), which is in the middle of May 7
      bridge.removeAt(1);

      expect(bridge.groupCount).toBe(3);
      expect(bridge.groups[0]!.key).toBe("May 7");
      expect(bridge.groups[0]!.count).toBe(2);
      expect(bridge.totalEntries).toBe(11); // 8 items + 3 headers
    });

    it("removes the last item in a group — group disappears entirely", () => {
      const { bridge, loadItems } = createBridge();
      // 3 in May 7, then 1 solo in May 6, then 3 in May 5
      const tracks = makeTracks([
        ["A", "May 7"], ["B", "May 7"], ["C", "May 7"],
        ["D", "May 6"],
        ["E", "May 5"], ["F", "May 5"], ["G", "May 5"],
      ]);
      loadItems(tracks, 0, 7);
      // 7 items + 3 headers = 10
      expect(bridge.groupCount).toBe(3);

      // Remove the single May 6 item (dataIndex 3)
      bridge.removeAt(3);

      expect(bridge.groupCount).toBe(2);
      expect(bridge.groups[0]!.key).toBe("May 7");
      expect(bridge.groups[1]!.key).toBe("May 5");
      expect(bridge.totalEntries).toBe(8); // 6 items + 2 headers
    });

    it("removes first item — groups shift correctly and layout mapping is valid", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      // Remove Track A (dataIndex 0) — first item in May 7
      bridge.removeAt(0);

      expect(bridge.groupCount).toBe(3);
      expect(bridge.groups[0]!.count).toBe(2);
      // New layout: [H(May7)=0, T1=1, T2=2, H(May6)=3, T3=4, ...]
      expect(bridge.groups[0]!.headerLayoutIndex).toBe(0);
      expect(bridge.groups[1]!.headerLayoutIndex).toBe(3);
      expect(bridge.groups[2]!.headerLayoutIndex).toBe(7);
      expect(bridge.totalEntries).toBe(11); // 8 items + 3 headers
    });

    it("subsequent data keys shift down by 1 after removal", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      // Before: dataIndex 3 (Track D / May 6) → layout 5
      expect(bridge.dataToLayoutIndex(3)).toBe(5);

      // Remove dataIndex 0 (Track A): everything after shifts down by 1
      bridge.removeAt(0);

      // Old dataIndex 3 (Track D) is now dataIndex 2 → layout 4 (May 6 header at 3)
      expect(bridge.dataToLayoutIndex(2)).toBe(4);
      // Old dataIndex 6 (Track G / May 5) is now dataIndex 5 → layout 8
      expect(bridge.dataToLayoutIndex(5)).toBe(8);
    });

    it("totalEntries decrements correctly after each removal", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);
      expect(bridge.totalEntries).toBe(12); // 9 items + 3 headers

      bridge.removeAt(0);
      expect(bridge.totalEntries).toBe(11); // 8 items + 3 headers

      bridge.removeAt(0);
      expect(bridge.totalEntries).toBe(10); // 7 items + 3 headers

      // Remove all remaining May 7 items (now at dataIndex 0, only 1 left)
      bridge.removeAt(0);
      // May 7 group gone: 6 items + 2 headers = 8
      expect(bridge.totalEntries).toBe(8);
      expect(bridge.groupCount).toBe(2);
    });
  });

  // ===========================================================================
  // Reset
  // ===========================================================================

  describe("reset", () => {
    it("should clear all state on reset", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);
      expect(bridge.groupCount).toBe(3);

      bridge.reset();
      expect(bridge.totalEntries).toBe(0);
      expect(bridge.groupCount).toBe(0);
      expect(bridge.groups).toEqual([]);
    });

    it("should rebuild correctly after reset and reload", () => {
      const { bridge, loadItems } = createBridge();

      loadItems(ALL_TRACKS, 0, 9);
      expect(bridge.groupCount).toBe(3);

      bridge.reset();
      expect(bridge.groupCount).toBe(0);

      // Reload same data
      loadItems(ALL_TRACKS, 0, 9);
      expect(bridge.groupCount).toBe(3);
      expect(bridge.totalEntries).toBe(12);
    });
  });

  // ===========================================================================
  // Header Height
  // ===========================================================================

  describe("header height", () => {
    it("should return configured header height", () => {
      const { bridge, loadItems } = createBridge();
      loadItems(ALL_TRACKS, 0, 9);

      expect(bridge.getHeaderHeight(0)).toBe(36);
      expect(bridge.getHeaderHeight(1)).toBe(36);
      expect(bridge.getHeaderHeight(2)).toBe(36);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle single item", () => {
      const { bridge, loadItems } = createBridge();
      loadItems([ALL_TRACKS[0]!], 0, 1);

      expect(bridge.groupCount).toBe(1);
      expect(bridge.totalEntries).toBe(2); // 1 item + 1 header
    });

    it("should handle all items in same group", () => {
      const { bridge, loadItems } = createBridge();
      const sameGroup = makeTracks([
        ["A", "Day 1"], ["B", "Day 1"], ["C", "Day 1"],
      ]);
      loadItems(sameGroup, 0, 3);

      expect(bridge.groupCount).toBe(1);
      expect(bridge.totalEntries).toBe(4); // 3 items + 1 header
    });

    it("should handle each item in its own group", () => {
      const { bridge, loadItems } = createBridge();
      const uniqueGroups = makeTracks([
        ["A", "Day 1"], ["B", "Day 2"], ["C", "Day 3"],
      ]);
      loadItems(uniqueGroups, 0, 3);

      expect(bridge.groupCount).toBe(3);
      expect(bridge.totalEntries).toBe(6); // 3 items + 3 headers
    });

    it("should handle empty items loaded", () => {
      const { bridge, loadItems } = createBridge();
      loadItems([], 0, 0);

      expect(bridge.groupCount).toBe(0);
      expect(bridge.totalEntries).toBe(0);
    });

    it("should return identity mapping when no groups exist", () => {
      const { bridge } = createBridge();

      expect(bridge.layoutToDataIndex(5)).toBe(5);
      expect(bridge.dataToLayoutIndex(5)).toBe(5);
      expect(bridge.isHeader(0)).toBe(false);
    });
  });
});
