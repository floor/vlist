/**
 * vlist - Group Layout Tests
 * Tests for group boundary computation and index mapping
 */

import { describe, it, expect } from "bun:test";
import {
  createGroupLayout,
  buildLayoutItems,
  createGroupedHeightFn,
} from "../../../src/plugins/groups/layout";
import { isGroupHeader } from "../../../src/plugins/groups/types";
import type { VListItem } from "../../../src/types";
import type { GroupsConfig } from "../../../src/plugins/groups/types";

// =============================================================================
// Test Data Helpers
// =============================================================================

interface TestContact extends VListItem {
  id: string;
  name: string;
  lastName: string;
}

const makeContacts = (entries: Array<[string, string]>): TestContact[] =>
  entries.map(([first, last], i) => ({
    id: `contact-${i}`,
    name: `${first} ${last}`,
    lastName: last,
  }));

/**
 * Contacts sorted by first letter of last name:
 *   A: Adams, Allen (2 items)
 *   B: Baker, Brown, Burns (3 items)
 *   C: Clark (1 item)
 */
const CONTACTS = makeContacts([
  ["John", "Adams"],
  ["Kate", "Allen"],
  ["Bob", "Baker"],
  ["Eve", "Brown"],
  ["Dan", "Burns"],
  ["Amy", "Clark"],
]);

const getGroup = (index: number): string => CONTACTS[index]!.lastName[0]!;

const makeConfig = (overrides: Partial<GroupsConfig> = {}): GroupsConfig => ({
  getGroupForIndex: getGroup,
  headerHeight: 32,
  headerTemplate: (group) => `<div>${group}</div>`,
  sticky: true,
  ...overrides,
});

// =============================================================================
// createGroupLayout — Basic Construction
// =============================================================================

describe("createGroupLayout", () => {
  describe("basic construction", () => {
    it("should compute correct number of groups", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());
      expect(layout.groupCount).toBe(3); // A, B, C
    });

    it("should compute correct total entries (items + headers)", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());
      // 6 items + 3 headers = 9
      expect(layout.totalEntries).toBe(9);
    });

    it("should produce correct group boundaries", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());
      const groups = layout.groups;

      expect(groups).toHaveLength(3);

      // Group A: header at layout 0, data items 0–1, count 2
      expect(groups[0]!.key).toBe("A");
      expect(groups[0]!.groupIndex).toBe(0);
      expect(groups[0]!.headerLayoutIndex).toBe(0);
      expect(groups[0]!.firstDataIndex).toBe(0);
      expect(groups[0]!.count).toBe(2);

      // Group B: header at layout 3, data items 2–4, count 3
      expect(groups[1]!.key).toBe("B");
      expect(groups[1]!.groupIndex).toBe(1);
      expect(groups[1]!.headerLayoutIndex).toBe(3);
      expect(groups[1]!.firstDataIndex).toBe(2);
      expect(groups[1]!.count).toBe(3);

      // Group C: header at layout 7, data item 5, count 1
      expect(groups[2]!.key).toBe("C");
      expect(groups[2]!.groupIndex).toBe(2);
      expect(groups[2]!.headerLayoutIndex).toBe(7);
      expect(groups[2]!.firstDataIndex).toBe(5);
      expect(groups[2]!.count).toBe(1);
    });

    it("should handle empty items", () => {
      const layout = createGroupLayout(0, makeConfig());
      expect(layout.groupCount).toBe(0);
      expect(layout.totalEntries).toBe(0);
      expect(layout.groups).toHaveLength(0);
    });

    it("should handle single item", () => {
      const singleContact = makeContacts([["Alice", "Adams"]]);
      const layout = createGroupLayout(
        1,
        makeConfig({
          getGroupForIndex: () => "A",
        }),
      );
      expect(layout.groupCount).toBe(1);
      expect(layout.totalEntries).toBe(2); // 1 header + 1 item
      expect(layout.groups[0]!.key).toBe("A");
      expect(layout.groups[0]!.count).toBe(1);
    });

    it("should handle all items in one group", () => {
      const layout = createGroupLayout(
        5,
        makeConfig({
          getGroupForIndex: () => "ALL",
        }),
      );
      expect(layout.groupCount).toBe(1);
      expect(layout.totalEntries).toBe(6); // 1 header + 5 items
      expect(layout.groups[0]!.key).toBe("ALL");
      expect(layout.groups[0]!.count).toBe(5);
    });

    it("should handle each item in its own group", () => {
      const layout = createGroupLayout(
        4,
        makeConfig({
          getGroupForIndex: (i) => String(i),
        }),
      );
      expect(layout.groupCount).toBe(4);
      expect(layout.totalEntries).toBe(8); // 4 headers + 4 items
      for (let i = 0; i < 4; i++) {
        expect(layout.groups[i]!.key).toBe(String(i));
        expect(layout.groups[i]!.count).toBe(1);
      }
    });
  });

  // ===========================================================================
  // getEntry
  // ===========================================================================

  describe("getEntry", () => {
    it("should return header entry at header layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      // Layout index 0 → header A
      const entry0 = layout.getEntry(0);
      expect(entry0.type).toBe("header");
      if (entry0.type === "header") {
        expect(entry0.group.key).toBe("A");
        expect(entry0.group.groupIndex).toBe(0);
      }

      // Layout index 3 → header B
      const entry3 = layout.getEntry(3);
      expect(entry3.type).toBe("header");
      if (entry3.type === "header") {
        expect(entry3.group.key).toBe("B");
      }

      // Layout index 7 → header C
      const entry7 = layout.getEntry(7);
      expect(entry7.type).toBe("header");
      if (entry7.type === "header") {
        expect(entry7.group.key).toBe("C");
      }
    });

    it("should return item entry at item layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      // Layout:  [hdrA, item0, item1, hdrB, item2, item3, item4, hdrC, item5]
      // Index:   [  0,    1,     2,     3,    4,     5,     6,     7,    8  ]

      // Layout 1 → data index 0 (Adams)
      const entry1 = layout.getEntry(1);
      expect(entry1.type).toBe("item");
      if (entry1.type === "item") {
        expect(entry1.dataIndex).toBe(0);
        expect(entry1.group.key).toBe("A");
      }

      // Layout 2 → data index 1 (Allen)
      const entry2 = layout.getEntry(2);
      expect(entry2.type).toBe("item");
      if (entry2.type === "item") {
        expect(entry2.dataIndex).toBe(1);
        expect(entry2.group.key).toBe("A");
      }

      // Layout 4 → data index 2 (Baker)
      const entry4 = layout.getEntry(4);
      expect(entry4.type).toBe("item");
      if (entry4.type === "item") {
        expect(entry4.dataIndex).toBe(2);
        expect(entry4.group.key).toBe("B");
      }

      // Layout 6 → data index 4 (Burns)
      const entry6 = layout.getEntry(6);
      expect(entry6.type).toBe("item");
      if (entry6.type === "item") {
        expect(entry6.dataIndex).toBe(4);
        expect(entry6.group.key).toBe("B");
      }

      // Layout 8 → data index 5 (Clark)
      const entry8 = layout.getEntry(8);
      expect(entry8.type).toBe("item");
      if (entry8.type === "item") {
        expect(entry8.dataIndex).toBe(5);
        expect(entry8.group.key).toBe("C");
      }
    });
  });

  // ===========================================================================
  // layoutToDataIndex
  // ===========================================================================

  describe("layoutToDataIndex", () => {
    it("should return -1 for header layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());
      expect(layout.layoutToDataIndex(0)).toBe(-1); // header A
      expect(layout.layoutToDataIndex(3)).toBe(-1); // header B
      expect(layout.layoutToDataIndex(7)).toBe(-1); // header C
    });

    it("should return correct data index for item layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      // Layout:  [hdrA, item0, item1, hdrB, item2, item3, item4, hdrC, item5]
      expect(layout.layoutToDataIndex(1)).toBe(0);
      expect(layout.layoutToDataIndex(2)).toBe(1);
      expect(layout.layoutToDataIndex(4)).toBe(2);
      expect(layout.layoutToDataIndex(5)).toBe(3);
      expect(layout.layoutToDataIndex(6)).toBe(4);
      expect(layout.layoutToDataIndex(8)).toBe(5);
    });

    it("should be consistent across all layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      // Every data index from 0..5 should appear exactly once
      const dataIndices: number[] = [];
      for (let li = 0; li < layout.totalEntries; li++) {
        const di = layout.layoutToDataIndex(li);
        if (di !== -1) {
          dataIndices.push(di);
        }
      }
      expect(dataIndices).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });

  // ===========================================================================
  // dataToLayoutIndex
  // ===========================================================================

  describe("dataToLayoutIndex", () => {
    it("should map data indices to correct layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      // Layout:  [hdrA, item0, item1, hdrB, item2, item3, item4, hdrC, item5]
      expect(layout.dataToLayoutIndex(0)).toBe(1); // Adams
      expect(layout.dataToLayoutIndex(1)).toBe(2); // Allen
      expect(layout.dataToLayoutIndex(2)).toBe(4); // Baker
      expect(layout.dataToLayoutIndex(3)).toBe(5); // Brown
      expect(layout.dataToLayoutIndex(4)).toBe(6); // Burns
      expect(layout.dataToLayoutIndex(5)).toBe(8); // Clark
    });

    it("should be inverse of layoutToDataIndex for item indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      for (let di = 0; di < CONTACTS.length; di++) {
        const li = layout.dataToLayoutIndex(di);
        expect(layout.layoutToDataIndex(li)).toBe(di);
      }
    });
  });

  // ===========================================================================
  // getGroupAtLayoutIndex
  // ===========================================================================

  describe("getGroupAtLayoutIndex", () => {
    it("should return the correct group for header layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      expect(layout.getGroupAtLayoutIndex(0).key).toBe("A");
      expect(layout.getGroupAtLayoutIndex(3).key).toBe("B");
      expect(layout.getGroupAtLayoutIndex(7).key).toBe("C");
    });

    it("should return the correct group for item layout indices", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      // Items in group A (layout 1, 2)
      expect(layout.getGroupAtLayoutIndex(1).key).toBe("A");
      expect(layout.getGroupAtLayoutIndex(2).key).toBe("A");

      // Items in group B (layout 4, 5, 6)
      expect(layout.getGroupAtLayoutIndex(4).key).toBe("B");
      expect(layout.getGroupAtLayoutIndex(5).key).toBe("B");
      expect(layout.getGroupAtLayoutIndex(6).key).toBe("B");

      // Items in group C (layout 8)
      expect(layout.getGroupAtLayoutIndex(8).key).toBe("C");
    });
  });

  // ===========================================================================
  // getGroupAtDataIndex
  // ===========================================================================

  describe("getGroupAtDataIndex", () => {
    it("should return the correct group for each data index", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());

      expect(layout.getGroupAtDataIndex(0).key).toBe("A"); // Adams
      expect(layout.getGroupAtDataIndex(1).key).toBe("A"); // Allen
      expect(layout.getGroupAtDataIndex(2).key).toBe("B"); // Baker
      expect(layout.getGroupAtDataIndex(3).key).toBe("B"); // Brown
      expect(layout.getGroupAtDataIndex(4).key).toBe("B"); // Burns
      expect(layout.getGroupAtDataIndex(5).key).toBe("C"); // Clark
    });
  });

  // ===========================================================================
  // getHeaderHeight
  // ===========================================================================

  describe("getHeaderHeight", () => {
    it("should return fixed header height", () => {
      const layout = createGroupLayout(
        CONTACTS.length,
        makeConfig({
          headerHeight: 40,
        }),
      );

      expect(layout.getHeaderHeight(0)).toBe(40);
      expect(layout.getHeaderHeight(1)).toBe(40);
      expect(layout.getHeaderHeight(2)).toBe(40);
    });

    it("should return variable header height from function", () => {
      const layout = createGroupLayout(
        CONTACTS.length,
        makeConfig({
          headerHeight: (_group, groupIndex) => 30 + groupIndex * 10,
        }),
      );

      expect(layout.getHeaderHeight(0)).toBe(30);
      expect(layout.getHeaderHeight(1)).toBe(40);
      expect(layout.getHeaderHeight(2)).toBe(50);
    });
  });

  // ===========================================================================
  // rebuild
  // ===========================================================================

  describe("rebuild", () => {
    it("should update layout when item count changes", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());
      expect(layout.groupCount).toBe(3);
      expect(layout.totalEntries).toBe(9);

      // Simulate removing items so only A group remains (2 items)
      // We need a getGroupForIndex that works for the new count
      const layout2 = createGroupLayout(
        2,
        makeConfig({
          getGroupForIndex: (i) => "A",
        }),
      );

      // Rebuild with fewer items
      layout2.rebuild(2);
      expect(layout2.groupCount).toBe(1);
      expect(layout2.totalEntries).toBe(3); // 1 header + 2 items
    });

    it("should handle rebuild to empty", () => {
      const layout = createGroupLayout(CONTACTS.length, makeConfig());
      expect(layout.groupCount).toBe(3);

      layout.rebuild(0);
      expect(layout.groupCount).toBe(0);
      expect(layout.totalEntries).toBe(0);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle groups with varying sizes", () => {
      // 1 in A, 5 in B, 1 in C
      const config = makeConfig({
        getGroupForIndex: (i) => {
          if (i === 0) return "A";
          if (i < 6) return "B";
          return "C";
        },
      });
      const layout = createGroupLayout(7, config);

      expect(layout.groupCount).toBe(3);
      expect(layout.groups[0]!.count).toBe(1);
      expect(layout.groups[1]!.count).toBe(5);
      expect(layout.groups[2]!.count).toBe(1);
      expect(layout.totalEntries).toBe(10); // 7 items + 3 headers
    });

    it("should handle many groups correctly", () => {
      // 26 groups, one item each (A–Z)
      const config = makeConfig({
        getGroupForIndex: (i) => String.fromCharCode(65 + i),
      });
      const layout = createGroupLayout(26, config);

      expect(layout.groupCount).toBe(26);
      expect(layout.totalEntries).toBe(52); // 26 items + 26 headers

      // First group
      expect(layout.groups[0]!.key).toBe("A");
      expect(layout.groups[0]!.headerLayoutIndex).toBe(0);
      expect(layout.groups[0]!.firstDataIndex).toBe(0);

      // Last group
      expect(layout.groups[25]!.key).toBe("Z");
      expect(layout.groups[25]!.headerLayoutIndex).toBe(50);
      expect(layout.groups[25]!.firstDataIndex).toBe(25);

      // Verify layout → data round-trip for every item
      for (let di = 0; di < 26; di++) {
        const li = layout.dataToLayoutIndex(di);
        expect(layout.layoutToDataIndex(li)).toBe(di);
      }
    });

    it("should handle large item counts efficiently", () => {
      // 10,000 items, 100 groups of 100
      const config = makeConfig({
        getGroupForIndex: (i) => `group-${Math.floor(i / 100)}`,
      });

      const start = performance.now();
      const layout = createGroupLayout(10_000, config);
      const elapsed = performance.now() - start;

      expect(layout.groupCount).toBe(100);
      expect(layout.totalEntries).toBe(10_100); // 10K items + 100 headers
      expect(elapsed).toBeLessThan(100); // Should be fast (< 100ms)

      // Spot-check some mappings
      expect(layout.layoutToDataIndex(0)).toBe(-1); // first header
      expect(layout.layoutToDataIndex(1)).toBe(0); // first item
      expect(layout.dataToLayoutIndex(99)).toBe(100); // last item in first group
      expect(layout.layoutToDataIndex(101)).toBe(-1); // second header
      expect(layout.dataToLayoutIndex(100)).toBe(102); // first item of second group
    });

    it("should return fallback group boundary for empty layout", () => {
      const layout = createGroupLayout(0, makeConfig());

      const group = layout.getGroupAtLayoutIndex(0);
      expect(group.key).toBe("");
      expect(group.count).toBe(0);

      const group2 = layout.getGroupAtDataIndex(0);
      expect(group2.key).toBe("");
    });

    it("should return fallback item entry from getEntry when groups are empty", () => {
      const layout = createGroupLayout(0, makeConfig());

      const entry = layout.getEntry(0);
      expect(entry.type).toBe("item");
      if (entry.type === "item") {
        expect(entry.dataIndex).toBe(0);
        expect(entry.group.key).toBe("");
        expect(entry.group.groupIndex).toBe(0);
        expect(entry.group.headerLayoutIndex).toBe(0);
        expect(entry.group.firstDataIndex).toBe(0);
        expect(entry.group.count).toBe(0);
      }
    });

    it("should return fallback item entry from getEntry for any index when groups are empty", () => {
      const layout = createGroupLayout(0, makeConfig());

      const entry = layout.getEntry(5);
      expect(entry.type).toBe("item");
      if (entry.type === "item") {
        expect(entry.dataIndex).toBe(5);
        expect(entry.group.key).toBe("");
      }
    });
  });
});

// =============================================================================
// buildLayoutItems
// =============================================================================

describe("buildLayoutItems", () => {
  it("should insert header pseudo-items at group boundaries", () => {
    const layout = createGroupLayout(CONTACTS.length, makeConfig());
    const items = buildLayoutItems(CONTACTS, layout.groups);

    // Total = 6 items + 3 headers = 9
    expect(items).toHaveLength(9);

    // Layout: [hdrA, Adams, Allen, hdrB, Baker, Brown, Burns, hdrC, Clark]
    expect(isGroupHeader(items[0])).toBe(true);
    expect(isGroupHeader(items[1])).toBe(false);
    expect(isGroupHeader(items[2])).toBe(false);
    expect(isGroupHeader(items[3])).toBe(true);
    expect(isGroupHeader(items[4])).toBe(false);
    expect(isGroupHeader(items[5])).toBe(false);
    expect(isGroupHeader(items[6])).toBe(false);
    expect(isGroupHeader(items[7])).toBe(true);
    expect(isGroupHeader(items[8])).toBe(false);
  });

  it("should set correct group keys on headers", () => {
    const layout = createGroupLayout(CONTACTS.length, makeConfig());
    const items = buildLayoutItems(CONTACTS, layout.groups);

    const headers = items.filter(isGroupHeader);
    expect(headers).toHaveLength(3);
    expect(headers[0]!.groupKey).toBe("A");
    expect(headers[1]!.groupKey).toBe("B");
    expect(headers[2]!.groupKey).toBe("C");
  });

  it("should set correct group indices on headers", () => {
    const layout = createGroupLayout(CONTACTS.length, makeConfig());
    const items = buildLayoutItems(CONTACTS, layout.groups);

    const headers = items.filter(isGroupHeader);
    expect(headers[0]!.groupIndex).toBe(0);
    expect(headers[1]!.groupIndex).toBe(1);
    expect(headers[2]!.groupIndex).toBe(2);
  });

  it("should set unique IDs on headers", () => {
    const layout = createGroupLayout(CONTACTS.length, makeConfig());
    const items = buildLayoutItems(CONTACTS, layout.groups);

    const headers = items.filter(isGroupHeader);
    const ids = headers.map((h) => h.id);
    expect(ids).toEqual([
      "__group_header_0",
      "__group_header_1",
      "__group_header_2",
    ]);

    // All unique
    expect(new Set(ids).size).toBe(3);
  });

  it("should preserve original data items in order", () => {
    const layout = createGroupLayout(CONTACTS.length, makeConfig());
    const items = buildLayoutItems(CONTACTS, layout.groups);

    const dataItems = items.filter(
      (item) => !isGroupHeader(item),
    ) as TestContact[];
    expect(dataItems).toHaveLength(6);
    expect(dataItems[0]!.id).toBe("contact-0"); // Adams
    expect(dataItems[1]!.id).toBe("contact-1"); // Allen
    expect(dataItems[2]!.id).toBe("contact-2"); // Baker
    expect(dataItems[3]!.id).toBe("contact-3"); // Brown
    expect(dataItems[4]!.id).toBe("contact-4"); // Burns
    expect(dataItems[5]!.id).toBe("contact-5"); // Clark
  });

  it("should return empty array for empty items", () => {
    const layout = createGroupLayout(0, makeConfig());
    const items = buildLayoutItems([], layout.groups);
    expect(items).toHaveLength(0);
  });

  it("should handle single item", () => {
    const single = makeContacts([["Alice", "Adams"]]);
    const layout = createGroupLayout(
      1,
      makeConfig({
        getGroupForIndex: () => "A",
      }),
    );
    const items = buildLayoutItems(single, layout.groups);

    expect(items).toHaveLength(2);
    expect(isGroupHeader(items[0])).toBe(true);
    expect(isGroupHeader(items[1])).toBe(false);
    expect((items[1] as TestContact).name).toBe("Alice Adams");
  });
});

// =============================================================================
// createGroupedHeightFn
// =============================================================================

describe("createGroupedHeightFn", () => {
  it("should return header height for header layout indices", () => {
    const layout = createGroupLayout(
      CONTACTS.length,
      makeConfig({
        headerHeight: 32,
      }),
    );
    const heightFn = createGroupedHeightFn(layout, 48);

    // Headers at layout indices 0, 3, 7
    expect(heightFn(0)).toBe(32);
    expect(heightFn(3)).toBe(32);
    expect(heightFn(7)).toBe(32);
  });

  it("should return item height for item layout indices (fixed)", () => {
    const layout = createGroupLayout(
      CONTACTS.length,
      makeConfig({
        headerHeight: 32,
      }),
    );
    const heightFn = createGroupedHeightFn(layout, 48);

    // Items at layout indices 1, 2, 4, 5, 6, 8
    expect(heightFn(1)).toBe(48);
    expect(heightFn(2)).toBe(48);
    expect(heightFn(4)).toBe(48);
    expect(heightFn(5)).toBe(48);
    expect(heightFn(6)).toBe(48);
    expect(heightFn(8)).toBe(48);
  });

  it("should return item height for item layout indices (variable)", () => {
    const layout = createGroupLayout(
      CONTACTS.length,
      makeConfig({
        headerHeight: 32,
      }),
    );
    // Variable height: each item has height 40 + dataIndex * 5
    const itemHeightFn = (dataIndex: number) => 40 + dataIndex * 5;
    const heightFn = createGroupedHeightFn(layout, itemHeightFn);

    // Layout 1 → data 0 → height 40
    expect(heightFn(1)).toBe(40);

    // Layout 2 → data 1 → height 45
    expect(heightFn(2)).toBe(45);

    // Layout 4 → data 2 → height 50
    expect(heightFn(4)).toBe(50);

    // Layout 8 → data 5 → height 65
    expect(heightFn(8)).toBe(65);
  });

  it("should return variable header height from function", () => {
    const layout = createGroupLayout(
      CONTACTS.length,
      makeConfig({
        headerHeight: (_group, groupIndex) => 20 + groupIndex * 10,
      }),
    );
    const heightFn = createGroupedHeightFn(layout, 48);

    expect(heightFn(0)).toBe(20); // group 0 header
    expect(heightFn(3)).toBe(30); // group 1 header
    expect(heightFn(7)).toBe(40); // group 2 header
  });
});

// =============================================================================
// isGroupHeader type guard
// =============================================================================

describe("isGroupHeader", () => {
  it("should return true for group header items", () => {
    const header = {
      id: "__group_header_0",
      __groupHeader: true as const,
      groupKey: "A",
      groupIndex: 0,
    };
    expect(isGroupHeader(header)).toBe(true);
  });

  it("should return false for regular items", () => {
    expect(isGroupHeader(CONTACTS[0])).toBe(false);
  });

  it("should return false for null/undefined", () => {
    expect(isGroupHeader(null)).toBe(false);
    expect(isGroupHeader(undefined)).toBe(false);
  });

  it("should return false for non-objects", () => {
    expect(isGroupHeader("string")).toBe(false);
    expect(isGroupHeader(42)).toBe(false);
    expect(isGroupHeader(true)).toBe(false);
  });

  it("should return false for objects without __groupHeader flag", () => {
    expect(isGroupHeader({ id: "test", __groupHeader: false })).toBe(false);
    expect(isGroupHeader({ id: "test" })).toBe(false);
  });
});

// =============================================================================
// Consistency: full round-trip mapping for various configurations
// =============================================================================

describe("round-trip consistency", () => {
  const testConfigs: Array<{
    name: string;
    count: number;
    groupFn: (i: number) => string;
  }> = [
    {
      name: "3 equal groups of 2",
      count: 6,
      groupFn: (i) => String.fromCharCode(65 + Math.floor(i / 2)),
    },
    {
      name: "5 groups of 1",
      count: 5,
      groupFn: (i) => String(i),
    },
    {
      name: "1 group of 10",
      count: 10,
      groupFn: () => "ALL",
    },
    {
      name: "uneven groups (1, 4, 2, 3)",
      count: 10,
      groupFn: (i) => {
        if (i < 1) return "A";
        if (i < 5) return "B";
        if (i < 7) return "C";
        return "D";
      },
    },
  ];

  for (const { name, count, groupFn } of testConfigs) {
    it(`layout ↔ data index round-trip: ${name}`, () => {
      const layout = createGroupLayout(
        count,
        makeConfig({
          getGroupForIndex: groupFn,
        }),
      );

      // Every data index should round-trip through layout
      for (let di = 0; di < count; di++) {
        const li = layout.dataToLayoutIndex(di);
        expect(layout.layoutToDataIndex(li)).toBe(di);
      }

      // Every layout entry should be either a header or map to a valid data index
      let dataCount = 0;
      let headerCount = 0;
      for (let li = 0; li < layout.totalEntries; li++) {
        const entry = layout.getEntry(li);
        if (entry.type === "header") {
          headerCount++;
        } else {
          dataCount++;
          expect(entry.dataIndex).toBeGreaterThanOrEqual(0);
          expect(entry.dataIndex).toBeLessThan(count);
        }
      }
      expect(dataCount).toBe(count);
      expect(headerCount).toBe(layout.groupCount);
    });
  }
});
