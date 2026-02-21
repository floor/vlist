/**
 * vlist - Grid Layout Tests
 * Tests for the grid layout module: row/col calculations, item range mapping, column sizing
 */

import { describe, it, expect } from "bun:test";
import { createGridLayout } from "../../../src/features/grid/layout";
import type { GridLayout } from "../../../src/features/grid/types";

// =============================================================================
// Factory
// =============================================================================

describe("createGridLayout", () => {
  it("should create a grid layout with the given columns", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.columns).toBe(4);
    expect(layout.gap).toBe(0);
  });

  it("should default gap to 0", () => {
    const layout = createGridLayout({ columns: 3 });
    expect(layout.gap).toBe(0);
  });

  it("should use the provided gap", () => {
    const layout = createGridLayout({ columns: 4, gap: 8 });
    expect(layout.gap).toBe(8);
  });

  it("should clamp columns to at least 1", () => {
    const layout = createGridLayout({ columns: 0 });
    expect(layout.columns).toBe(1);
  });

  it("should floor fractional columns", () => {
    const layout = createGridLayout({ columns: 3.7 });
    expect(layout.columns).toBe(3);
  });

  it("should handle negative columns by clamping to 1", () => {
    const layout = createGridLayout({ columns: -5 });
    expect(layout.columns).toBe(1);
  });
});

// =============================================================================
// getTotalRows
// =============================================================================

describe("getTotalRows", () => {
  it("should return 0 for 0 items", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getTotalRows(0)).toBe(0);
  });

  it("should return 1 for fewer items than columns", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getTotalRows(1)).toBe(1);
    expect(layout.getTotalRows(2)).toBe(1);
    expect(layout.getTotalRows(3)).toBe(1);
    expect(layout.getTotalRows(4)).toBe(1);
  });

  it("should return correct rows for exact multiples", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getTotalRows(4)).toBe(1);
    expect(layout.getTotalRows(8)).toBe(2);
    expect(layout.getTotalRows(12)).toBe(3);
    expect(layout.getTotalRows(100)).toBe(25);
  });

  it("should ceil for non-exact multiples", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getTotalRows(5)).toBe(2);
    expect(layout.getTotalRows(9)).toBe(3);
    expect(layout.getTotalRows(13)).toBe(4);
    expect(layout.getTotalRows(101)).toBe(26);
  });

  it("should handle 1 column (degenerates to list)", () => {
    const layout = createGridLayout({ columns: 1 });
    expect(layout.getTotalRows(0)).toBe(0);
    expect(layout.getTotalRows(1)).toBe(1);
    expect(layout.getTotalRows(10)).toBe(10);
    expect(layout.getTotalRows(1000)).toBe(1000);
  });

  it("should handle large numbers", () => {
    const layout = createGridLayout({ columns: 5 });
    expect(layout.getTotalRows(1_000_000)).toBe(200_000);
    expect(layout.getTotalRows(1_000_001)).toBe(200_001);
  });

  it("should return 0 for negative items", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getTotalRows(-1)).toBe(0);
  });
});

// =============================================================================
// getRow / getCol
// =============================================================================

describe("getRow", () => {
  const layout = createGridLayout({ columns: 4 });

  it("should return row 0 for first row items", () => {
    expect(layout.getRow(0)).toBe(0);
    expect(layout.getRow(1)).toBe(0);
    expect(layout.getRow(2)).toBe(0);
    expect(layout.getRow(3)).toBe(0);
  });

  it("should return row 1 for second row items", () => {
    expect(layout.getRow(4)).toBe(1);
    expect(layout.getRow(5)).toBe(1);
    expect(layout.getRow(6)).toBe(1);
    expect(layout.getRow(7)).toBe(1);
  });

  it("should return correct row for arbitrary index", () => {
    expect(layout.getRow(15)).toBe(3);
    expect(layout.getRow(99)).toBe(24);
    expect(layout.getRow(100)).toBe(25);
  });
});

describe("getCol", () => {
  const layout = createGridLayout({ columns: 4 });

  it("should return correct column for first row", () => {
    expect(layout.getCol(0)).toBe(0);
    expect(layout.getCol(1)).toBe(1);
    expect(layout.getCol(2)).toBe(2);
    expect(layout.getCol(3)).toBe(3);
  });

  it("should wrap columns for subsequent rows", () => {
    expect(layout.getCol(4)).toBe(0);
    expect(layout.getCol(5)).toBe(1);
    expect(layout.getCol(6)).toBe(2);
    expect(layout.getCol(7)).toBe(3);
  });

  it("should handle partially filled last row", () => {
    // 10 items, 4 columns → last row has items at col 0 and col 1
    expect(layout.getCol(8)).toBe(0);
    expect(layout.getCol(9)).toBe(1);
  });
});

// =============================================================================
// getPosition
// =============================================================================

describe("getPosition", () => {
  const layout = createGridLayout({ columns: 3 });

  it("should return correct position for item 0", () => {
    const pos = layout.getPosition(0);
    expect(pos.row).toBe(0);
    expect(pos.col).toBe(0);
  });

  it("should return correct position for end of first row", () => {
    const pos = layout.getPosition(2);
    expect(pos.row).toBe(0);
    expect(pos.col).toBe(2);
  });

  it("should return correct position for start of second row", () => {
    const pos = layout.getPosition(3);
    expect(pos.row).toBe(1);
    expect(pos.col).toBe(0);
  });

  it("should return correct position for arbitrary index", () => {
    // Index 7 with 3 columns: row = floor(7/3) = 2, col = 7 % 3 = 1
    const pos = layout.getPosition(7);
    expect(pos.row).toBe(2);
    expect(pos.col).toBe(1);
  });

  it("should handle 1 column", () => {
    const singleCol = createGridLayout({ columns: 1 });
    expect(singleCol.getPosition(0)).toEqual(
      expect.objectContaining({ row: 0, col: 0 }),
    );
    expect(singleCol.getPosition(5)).toEqual(
      expect.objectContaining({ row: 5, col: 0 }),
    );
  });
});

// =============================================================================
// getItemRange
// =============================================================================

describe("getItemRange", () => {
  const layout = createGridLayout({ columns: 4 });

  it("should return full first row range", () => {
    const range = layout.getItemRange(0, 0, 100);
    expect(range.start).toBe(0);
    expect(range.end).toBe(3);
  });

  it("should return multi-row range", () => {
    const range = layout.getItemRange(0, 2, 100);
    expect(range.start).toBe(0);
    expect(range.end).toBe(11); // 3 rows × 4 columns - 1
  });

  it("should return single row in the middle", () => {
    const range = layout.getItemRange(5, 5, 100);
    expect(range.start).toBe(20);
    expect(range.end).toBe(23);
  });

  it("should clamp end to totalItems - 1", () => {
    // 10 items, rows 0-2 → items 0-9 (last row is partial)
    const range = layout.getItemRange(0, 2, 10);
    expect(range.start).toBe(0);
    expect(range.end).toBe(9);
  });

  it("should clamp end when row extends past total items", () => {
    // 6 items, 4 columns = 2 rows. Row 1 has only items 4,5
    const range = layout.getItemRange(1, 1, 6);
    expect(range.start).toBe(4);
    expect(range.end).toBe(5);
  });

  it("should handle 0 total items", () => {
    const range = layout.getItemRange(0, 0, 0);
    expect(range.start).toBe(0);
    expect(range.end).toBe(-1);
  });

  it("should clamp start to 0 for negative row", () => {
    const range = layout.getItemRange(-1, 2, 100);
    expect(range.start).toBe(0);
  });

  it("should handle large row ranges", () => {
    // 1000 items, 4 columns = 250 rows
    const range = layout.getItemRange(0, 249, 1000);
    expect(range.start).toBe(0);
    expect(range.end).toBe(999);
  });

  it("should handle 1 column (acts like a list)", () => {
    const singleCol = createGridLayout({ columns: 1 });
    const range = singleCol.getItemRange(3, 7, 100);
    expect(range.start).toBe(3);
    expect(range.end).toBe(7);
  });
});

// =============================================================================
// getItemIndex
// =============================================================================

describe("getItemIndex", () => {
  const layout = createGridLayout({ columns: 4 });

  it("should return flat index for valid row/col", () => {
    expect(layout.getItemIndex(0, 0, 100)).toBe(0);
    expect(layout.getItemIndex(0, 3, 100)).toBe(3);
    expect(layout.getItemIndex(1, 0, 100)).toBe(4);
    expect(layout.getItemIndex(2, 2, 100)).toBe(10);
  });

  it("should return -1 for out-of-bounds column", () => {
    expect(layout.getItemIndex(0, 4, 100)).toBe(-1);
    expect(layout.getItemIndex(0, -1, 100)).toBe(-1);
  });

  it("should return -1 for index beyond totalItems", () => {
    expect(layout.getItemIndex(25, 0, 100)).toBe(-1);
    // Index 10 with totalItems=10 → out of bounds (>= totalItems)
    expect(layout.getItemIndex(2, 2, 10)).toBe(-1);
  });

  it("should return valid index for partially filled last row", () => {
    // 6 items, 4 columns: row 1 has cols 0,1 only
    expect(layout.getItemIndex(1, 0, 6)).toBe(4);
    expect(layout.getItemIndex(1, 1, 6)).toBe(5);
    expect(layout.getItemIndex(1, 2, 6)).toBe(-1); // col 2 in row 1 is beyond total
  });
});

// =============================================================================
// getColumnWidth
// =============================================================================

describe("getColumnWidth", () => {
  it("should divide container evenly with no gap", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getColumnWidth(800)).toBe(200);
  });

  it("should account for gaps", () => {
    const layout = createGridLayout({ columns: 4, gap: 8 });
    // totalGap = 3 * 8 = 24
    // columnWidth = (800 - 24) / 4 = 194
    expect(layout.getColumnWidth(800)).toBe(194);
  });

  it("should handle 1 column with gap (no gap applied)", () => {
    const layout = createGridLayout({ columns: 1, gap: 8 });
    // totalGap = 0 * 8 = 0
    // columnWidth = 800 / 1 = 800
    expect(layout.getColumnWidth(800)).toBe(800);
  });

  it("should handle 2 columns with gap", () => {
    const layout = createGridLayout({ columns: 2, gap: 10 });
    // totalGap = 1 * 10 = 10
    // columnWidth = (800 - 10) / 2 = 395
    expect(layout.getColumnWidth(800)).toBe(395);
  });

  it("should return 0 for 0 container width", () => {
    const layout = createGridLayout({ columns: 4, gap: 8 });
    expect(layout.getColumnWidth(0)).toBe(0);
  });

  it("should clamp to 0 if gap exceeds container width", () => {
    const layout = createGridLayout({ columns: 4, gap: 100 });
    // totalGap = 3 * 100 = 300
    // columnWidth = (200 - 300) / 4 = -25 → clamped to 0
    expect(layout.getColumnWidth(200)).toBe(0);
  });
});

// =============================================================================
// getColumnOffset
// =============================================================================

describe("getColumnOffset", () => {
  it("should return 0 for column 0 (no gap)", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getColumnOffset(0, 800)).toBe(0);
  });

  it("should return correct offsets for columns (no gap)", () => {
    const layout = createGridLayout({ columns: 4 });
    // columnWidth = 200, gap = 0
    expect(layout.getColumnOffset(0, 800)).toBe(0);
    expect(layout.getColumnOffset(1, 800)).toBe(200);
    expect(layout.getColumnOffset(2, 800)).toBe(400);
    expect(layout.getColumnOffset(3, 800)).toBe(600);
  });

  it("should return correct offsets with gap", () => {
    const layout = createGridLayout({ columns: 4, gap: 8 });
    // columnWidth = (800 - 24) / 4 = 194
    // offset = col * (194 + 8) = col * 202
    expect(layout.getColumnOffset(0, 800)).toBe(0);
    expect(layout.getColumnOffset(1, 800)).toBe(202);
    expect(layout.getColumnOffset(2, 800)).toBe(404);
    expect(layout.getColumnOffset(3, 800)).toBe(606);
  });

  it("should handle 2 columns with gap", () => {
    const layout = createGridLayout({ columns: 2, gap: 16 });
    // columnWidth = (1000 - 16) / 2 = 492
    // offset = col * (492 + 16) = col * 508
    expect(layout.getColumnOffset(0, 1000)).toBe(0);
    expect(layout.getColumnOffset(1, 1000)).toBe(508);
  });
});

// =============================================================================
// Consistency: row/col ↔ flat index round-trip
// =============================================================================

describe("round-trip: flat index → row/col → flat index", () => {
  const layout = createGridLayout({ columns: 5 });
  const totalItems = 23; // 5 rows, last row has 3 items

  it("should round-trip every item index", () => {
    for (let i = 0; i < totalItems; i++) {
      const row = layout.getRow(i);
      const col = layout.getCol(i);
      const backToIndex = layout.getItemIndex(row, col, totalItems);
      expect(backToIndex).toBe(i);
    }
  });
});

describe("round-trip: row range → item range → covers all items in rows", () => {
  const layout = createGridLayout({ columns: 3 });

  it("should cover all items for full row range", () => {
    const totalItems = 10; // 4 rows: [0,1,2], [3,4,5], [6,7,8], [9]
    const range = layout.getItemRange(0, 3, totalItems);

    expect(range.start).toBe(0);
    expect(range.end).toBe(9);

    // Every item should be in the range
    for (let i = 0; i < totalItems; i++) {
      expect(i >= range.start && i <= range.end).toBe(true);
    }
  });

  it("should cover middle rows correctly", () => {
    const totalItems = 15; // 5 rows exactly
    const range = layout.getItemRange(1, 3, totalItems);

    expect(range.start).toBe(3);
    expect(range.end).toBe(11);

    // Items 3-11 should be in rows 1-3
    for (let i = range.start; i <= range.end; i++) {
      const row = layout.getRow(i);
      expect(row >= 1 && row <= 3).toBe(true);
    }
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
  it("should handle very large column count with few items", () => {
    const layout = createGridLayout({ columns: 100 });
    expect(layout.getTotalRows(5)).toBe(1);
    expect(layout.getRow(4)).toBe(0);
    expect(layout.getCol(4)).toBe(4);
    expect(layout.getColumnWidth(1000)).toBe(10); // (1000 - 99*0) / 100
  });

  it("should handle single item", () => {
    const layout = createGridLayout({ columns: 4 });
    expect(layout.getTotalRows(1)).toBe(1);
    expect(layout.getRow(0)).toBe(0);
    expect(layout.getCol(0)).toBe(0);

    const range = layout.getItemRange(0, 0, 1);
    expect(range.start).toBe(0);
    expect(range.end).toBe(0);
  });

  it("should handle items exactly filling the grid", () => {
    const layout = createGridLayout({ columns: 5 });
    expect(layout.getTotalRows(25)).toBe(5);

    const range = layout.getItemRange(0, 4, 25);
    expect(range.start).toBe(0);
    expect(range.end).toBe(24);
  });

  it("should handle getColumnWidth with fractional results", () => {
    const layout = createGridLayout({ columns: 3 });
    // 1000 / 3 = 333.333...
    const width = layout.getColumnWidth(1000);
    expect(Math.abs(width - 333.333) < 0.1).toBe(true);
  });

  it("should handle large gap relative to container", () => {
    const layout = createGridLayout({ columns: 2, gap: 50 });
    // totalGap = 50
    // columnWidth = (100 - 50) / 2 = 25
    expect(layout.getColumnWidth(100)).toBe(25);

    // offsets: col 0 = 0, col 1 = 25 + 50 = 75
    expect(layout.getColumnOffset(0, 100)).toBe(0);
    expect(layout.getColumnOffset(1, 100)).toBe(75);
  });
});

// =============================================================================
// Groups-aware layout (with isHeaderFn)
// =============================================================================

describe("groups-aware layout with isHeaderFn", () => {
  // Helper: items 0, 3, 7 are headers
  const isHeader = (index: number) => index === 0 || index === 3 || index === 7;

  describe("getTotalRows with headers", () => {
    it("should count headers as separate rows", () => {
      const layout = createGridLayout({ columns: 3, isHeaderFn: isHeader });
      // Items: [H0] [1,2] [H3] [4,5,6] [H7] [8,9]
      // Rows:   0    1     2     3      4    5
      expect(layout.getTotalRows(10)).toBe(6);
    });

    it("should handle header at start", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0,
      });
      // Items: [H0] [1,2,3] [4,5,6]
      // Rows:   0     1       2
      expect(layout.getTotalRows(7)).toBe(3);
    });

    it("should handle header in middle forcing new row", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 4,
      });
      // Items: [0,1,2] [3] [H4] [5,6,7]
      // Rows:    0      1    2     3
      // Item 3 is alone in row 1, then header at row 2
      expect(layout.getTotalRows(8)).toBe(4);
    });

    it("should handle consecutive headers", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0 || i === 1,
      });
      // Items: [H0] [H1] [2,3,4]
      // Rows:   0    1     2
      expect(layout.getTotalRows(5)).toBe(3);
    });

    it("should handle header at end", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 9,
      });
      // Items: [0,1,2] [3,4,5] [6,7,8] [H9]
      // Rows:    0       1       2       3
      expect(layout.getTotalRows(10)).toBe(4);
    });

    it("should handle all items as headers", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: () => true,
      });
      // Every item is a header, each gets own row
      expect(layout.getTotalRows(5)).toBe(5);
    });

    it("should handle no headers (same as regular grid)", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: () => false,
      });
      expect(layout.getTotalRows(10)).toBe(4); // ceil(10/3)
    });

    it("should handle empty list with headers", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0,
      });
      expect(layout.getTotalRows(0)).toBe(0);
    });
  });

  describe("getRow with headers", () => {
    const layout = createGridLayout({ columns: 3, isHeaderFn: isHeader });

    it("should return row 0 for first header", () => {
      expect(layout.getRow(0)).toBe(0); // H0 at row 0
    });

    it("should return row 1 for items after first header", () => {
      expect(layout.getRow(1)).toBe(1); // Item 1 at row 1
      expect(layout.getRow(2)).toBe(1); // Item 2 at row 1
    });

    it("should return row 2 for second header", () => {
      expect(layout.getRow(3)).toBe(2); // H3 forces new row
    });

    it("should return row 3 for items after second header", () => {
      expect(layout.getRow(4)).toBe(3);
      expect(layout.getRow(5)).toBe(3);
      expect(layout.getRow(6)).toBe(3);
    });

    it("should return row 4 for third header", () => {
      expect(layout.getRow(7)).toBe(4); // H7 at row 4
    });

    it("should return row 5 for items after third header", () => {
      expect(layout.getRow(8)).toBe(5);
      expect(layout.getRow(9)).toBe(5);
    });
  });

  describe("getCol with headers", () => {
    const layout = createGridLayout({ columns: 3, isHeaderFn: isHeader });

    it("should return col 0 for headers", () => {
      expect(layout.getCol(0)).toBe(0); // H0
      expect(layout.getCol(3)).toBe(0); // H3
      expect(layout.getCol(7)).toBe(0); // H7
    });

    it("should return correct cols for items after first header", () => {
      expect(layout.getCol(1)).toBe(0); // First item in row
      expect(layout.getCol(2)).toBe(1); // Second item in row
    });

    it("should return correct cols for items after second header", () => {
      expect(layout.getCol(4)).toBe(0);
      expect(layout.getCol(5)).toBe(1);
      expect(layout.getCol(6)).toBe(2);
    });

    it("should return correct cols for items after third header", () => {
      expect(layout.getCol(8)).toBe(0);
      expect(layout.getCol(9)).toBe(1);
    });

    it("should wrap columns correctly within a group", () => {
      const layout2 = createGridLayout({
        columns: 2,
        isHeaderFn: (i) => i === 0,
      });
      // Items: [H0] [1,2] [3,4] [5,6]
      expect(layout2.getCol(1)).toBe(0);
      expect(layout2.getCol(2)).toBe(1);
      expect(layout2.getCol(3)).toBe(0); // Wraps to new row
      expect(layout2.getCol(4)).toBe(1);
    });
  });

  describe("getItemRange with headers", () => {
    const layout = createGridLayout({ columns: 3, isHeaderFn: isHeader });

    it("should return header in first row", () => {
      const range = layout.getItemRange(0, 0, 10);
      expect(range.start).toBe(0);
      expect(range.end).toBe(0); // Only H0
    });

    it("should return items in row 1", () => {
      const range = layout.getItemRange(1, 1, 10);
      expect(range.start).toBe(1);
      expect(range.end).toBe(2); // Items 1,2
    });

    it("should return header in row 2", () => {
      const range = layout.getItemRange(2, 2, 10);
      expect(range.start).toBe(3);
      expect(range.end).toBe(3); // Only H3
    });

    it("should return items in row 3", () => {
      const range = layout.getItemRange(3, 3, 10);
      expect(range.start).toBe(4);
      expect(range.end).toBe(6); // Items 4,5,6
    });

    it("should return range spanning multiple rows including headers", () => {
      const range = layout.getItemRange(0, 3, 10);
      expect(range.start).toBe(0);
      expect(range.end).toBe(6); // H0, items 1-2, H3, items 4-6
    });

    it("should return range spanning all rows", () => {
      const range = layout.getItemRange(0, 5, 10);
      expect(range.start).toBe(0);
      expect(range.end).toBe(9); // All items
    });

    it("should handle empty range before first item", () => {
      const range = layout.getItemRange(6, 10, 10);
      // Rows 6-10 don't exist (only 6 rows total)
      expect(range.start).toBe(0);
      expect(range.end).toBe(-1);
    });

    it("should handle range beyond total items", () => {
      const range = layout.getItemRange(0, 10, 10);
      expect(range.start).toBe(0);
      expect(range.end).toBe(9); // Clamped to totalItems-1
    });
  });

  describe("getPosition with headers", () => {
    const layout = createGridLayout({ columns: 3, isHeaderFn: isHeader });

    it("should return correct position for headers", () => {
      expect(layout.getPosition(0)).toEqual(
        expect.objectContaining({ row: 0, col: 0 }),
      );
      expect(layout.getPosition(3)).toEqual(
        expect.objectContaining({ row: 2, col: 0 }),
      );
      expect(layout.getPosition(7)).toEqual(
        expect.objectContaining({ row: 4, col: 0 }),
      );
    });

    it("should return correct position for regular items", () => {
      expect(layout.getPosition(1)).toEqual(
        expect.objectContaining({ row: 1, col: 0 }),
      );
      expect(layout.getPosition(2)).toEqual(
        expect.objectContaining({ row: 1, col: 1 }),
      );
      expect(layout.getPosition(4)).toEqual(
        expect.objectContaining({ row: 3, col: 0 }),
      );
      expect(layout.getPosition(5)).toEqual(
        expect.objectContaining({ row: 3, col: 1 }),
      );
    });
  });

  describe("update config with headers", () => {
    it("should update columns and affect groups layout", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0,
      });
      expect(layout.columns).toBe(3);
      expect(layout.getTotalRows(10)).toBe(4); // [H0] [1,2,3] [4,5,6] [7,8,9]

      layout.update({ columns: 2 });
      expect(layout.columns).toBe(2);
      expect(layout.getTotalRows(10)).toBe(6); // [H0] [1,2] [3,4] [5,6] [7,8] [9]
    });

    it("should update gap", () => {
      const layout = createGridLayout({
        columns: 3,
        gap: 8,
        isHeaderFn: (i) => i === 0,
      });
      expect(layout.gap).toBe(8);

      layout.update({ gap: 16 });
      expect(layout.gap).toBe(16);
      expect(layout.getColumnWidth(800)).toBe(256); // (800 - 2*16) / 3 = 256
    });

    it("should update isHeaderFn", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0,
      });
      expect(layout.getTotalRows(10)).toBe(4);

      // Update to no headers
      layout.update({ isHeaderFn: undefined } as any);
      expect(layout.getTotalRows(10)).toBe(4); // ceil(10/3)
    });

    it("should update isHeaderFn to different headers", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0,
      });
      expect(layout.getTotalRows(10)).toBe(4);

      // Update to different headers
      layout.update({ isHeaderFn: (i: number) => i === 0 || i === 5 } as any);
      expect(layout.getTotalRows(10)).toBe(6); // [H0] [1,2,3] [4] [H5] [6,7,8] [9]
    });
  });

  describe("complex groups scenarios", () => {
    it("should handle header interrupting partial row", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 2,
      });
      // Items: [0,1] [H2] [3,4,5]
      // Rows:   0     1     2
      expect(layout.getTotalRows(6)).toBe(3);
      expect(layout.getRow(0)).toBe(0);
      expect(layout.getRow(1)).toBe(0);
      expect(layout.getRow(2)).toBe(1); // Header forces new row
      expect(layout.getRow(3)).toBe(2);
    });

    it("should handle multiple headers in sequence", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i >= 2 && i <= 4,
      });
      // Items: [0,1] [H2] [H3] [H4] [5,6,7]
      // Rows:   0     1    2    3     4
      expect(layout.getTotalRows(8)).toBe(5);
    });

    it("should handle header as last item", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 5,
      });
      // Items: [0,1,2] [3,4] [H5]
      // Rows:    0       1     2
      expect(layout.getTotalRows(6)).toBe(3);
      expect(layout.getRow(5)).toBe(2);
      expect(layout.getCol(5)).toBe(0);
    });

    it("should handle single column with headers", () => {
      const layout = createGridLayout({
        columns: 1,
        isHeaderFn: (i) => i === 0 || i === 3,
      });
      // Every item gets own row anyway with 1 column
      // Items: [H0] [1] [2] [H3] [4]
      // Rows:   0    1   2    3    4
      expect(layout.getTotalRows(5)).toBe(5);
    });

    it("should handle empty list with isHeaderFn", () => {
      const layout = createGridLayout({
        columns: 3,
        isHeaderFn: (i) => i === 0,
      });
      expect(layout.getTotalRows(0)).toBe(0);
      const range = layout.getItemRange(0, 0, 0);
      expect(range.start).toBe(0);
      expect(range.end).toBe(-1);
    });

    it("should handle large item count with sparse headers", () => {
      const layout = createGridLayout({
        columns: 5,
        isHeaderFn: (i) => i % 20 === 0, // Headers every 20 items
      });
      // 100 items = 5 headers (0, 20, 40, 60, 80)
      // Each section has 19 regular items after header
      // 19 items / 5 cols = 4 rows per section
      // Total: 5 sections * 5 rows = 25 rows
      expect(layout.getTotalRows(100)).toBe(25);
    });
  });
});
