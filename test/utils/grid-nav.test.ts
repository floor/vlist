/**
 * vlist - Grid navigation helper tests
 * Regression coverage for floor/vlist#60 — PageUp/PageDown in a grid must
 * preserve the column at the top/bottom row instead of jumping to the corner.
 */

import { describe, it, expect } from "bun:test";
import { clampPageTarget } from "../../src/utils/grid-nav";

describe("clampPageTarget — linear list (columns = 1)", () => {
  it("clamps below range to 0", () => {
    expect(clampPageTarget(-5, 3, 1, 100)).toBe(0);
  });
  it("clamps above range to last", () => {
    expect(clampPageTarget(120, 95, 1, 100)).toBe(99);
  });
  it("passes an in-range target through", () => {
    expect(clampPageTarget(42, 90, 1, 100)).toBe(42);
  });
  it("handles empty list", () => {
    expect(clampPageTarget(-1, 0, 1, 0)).toBe(0);
  });
});

describe("clampPageTarget — grid (#60)", () => {
  // 100 items, 4 columns → rows 0..24, last row = items 96..99.
  const cols = 4;
  const total = 100;

  it("PageUp above the first row lands on the same column in row 0, not item 0", () => {
    // focus item 6 (row 1, col 2), page up overshoots to -14
    expect(clampPageTarget(6 - 20, 6, cols, total)).toBe(2); // col 2, row 0
  });

  it("PageUp from an item already in the first row is a no-op (stays put)", () => {
    // item 3 (row 0, col 3): target negative → returns col 3 = same item
    expect(clampPageTarget(3 - 20, 3, cols, total)).toBe(3);
  });

  it("PageDown past the last row lands on the same column in the last row, not the last item", () => {
    // focus item 90 (row 22, col 2), page down overshoots past 99
    // last row starts at 96 → col 2 → 98
    expect(clampPageTarget(90 + 20, 90, cols, total)).toBe(98);
  });

  it("PageDown from an item already in the last row is a no-op (stays put)", () => {
    // item 97 (last row, col 1): overshoot → last row start 96 + col 1 = 97
    expect(clampPageTarget(97 + 20, 97, cols, total)).toBe(97);
  });

  it("passes an in-range page target through unchanged", () => {
    // item 50 (row 12, col 2), page up by 8 rows → 18, in range
    expect(clampPageTarget(50 - 32, 50, cols, total)).toBe(18);
  });

  it("clamps to the last item when the column doesn't exist in a partial last row", () => {
    // 10 items, 4 cols → last row = items 8,9 (cols 0,1). Item 7 (row1,col3)
    // page down → last row col 3 = 11 > 9 → clamp to 9.
    expect(clampPageTarget(7 + 8, 7, 4, 10)).toBe(9);
  });
});
