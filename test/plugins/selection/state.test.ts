/**
 * vlist - Selection State Tests
 *
 * Tests for the mutable hot-path helper functions exported by state.ts:
 * selectOne, toggleOne, selectAllItems, selectRangeMut, getSelectedItemsMut.
 *
 * The immutable/pure functions (createSelectionState, selectItems, etc.)
 * are fully tested in index.test.ts (61 tests, 100 assertions).
 */

import { describe, it, expect } from "bun:test";
import {
  createSelectionState,
  isSelectionEmpty,
  getSelectionCount,
  selectOne,
  toggleOne,
  selectAllItems,
  selectRangeMut,
  getSelectedItemsMut,
} from "../../../src/plugins/selection/state";

describe("selection/state.ts (see index.test.ts for full coverage)", () => {
  it("should be fully tested via index.test.ts — smoke check", () => {
    const state = createSelectionState();
    expect(isSelectionEmpty(state)).toBe(true);
    expect(getSelectionCount(state)).toBe(0);
  });
});

// =============================================================================
// selectOne
// =============================================================================

describe("selectOne", () => {
  it("adds item in multiple mode without clearing", () => {
    const set = new Set<string | number>([1, 2]);
    selectOne(set, 3, "multiple");
    expect(set.size).toBe(3);
    expect(set.has(3)).toBe(true);
  });

  it("clears then adds in single mode", () => {
    const set = new Set<string | number>([1, 2]);
    selectOne(set, 3, "single");
    expect(set.size).toBe(1);
    expect(set.has(3)).toBe(true);
  });

  it("does nothing in none mode", () => {
    const set = new Set<string | number>([1]);
    selectOne(set, 2, "none");
    expect(set.size).toBe(1);
    expect(set.has(2)).toBe(false);
  });
});

// =============================================================================
// toggleOne
// =============================================================================

describe("toggleOne", () => {
  it("returns early in none mode", () => {
    const set = new Set<string | number>([1]);
    toggleOne(set, 1, "none");
    expect(set.has(1)).toBe(true);
  });

  it("removes item if already selected", () => {
    const set = new Set<string | number>([1, 2]);
    toggleOne(set, 2, "multiple");
    expect(set.has(2)).toBe(false);
    expect(set.size).toBe(1);
  });

  it("adds item if not selected in multiple mode", () => {
    const set = new Set<string | number>([1]);
    toggleOne(set, 2, "multiple");
    expect(set.has(2)).toBe(true);
    expect(set.size).toBe(2);
  });

  it("clears then adds in single mode when not selected", () => {
    const set = new Set<string | number>([1]);
    toggleOne(set, 2, "single");
    expect(set.size).toBe(1);
    expect(set.has(2)).toBe(true);
    expect(set.has(1)).toBe(false);
  });
});

// =============================================================================
// selectAllItems
// =============================================================================

describe("selectAllItems", () => {
  it("adds all item ids to the set", () => {
    const set = new Set<string | number>();
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }] as any[];
    selectAllItems(set, items);
    expect(set.size).toBe(3);
    expect(set.has(1)).toBe(true);
    expect(set.has(3)).toBe(true);
  });

  it("handles empty items array", () => {
    const set = new Set<string | number>();
    selectAllItems(set, []);
    expect(set.size).toBe(0);
  });
});

// =============================================================================
// selectRangeMut
// =============================================================================

describe("selectRangeMut", () => {
  const items = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }, { id: 50 }] as any[];

  it("selects forward range", () => {
    const set = new Set<string | number>();
    selectRangeMut(set, items, 1, 3);
    expect(set.size).toBe(3);
    expect(set.has(20)).toBe(true);
    expect(set.has(30)).toBe(true);
    expect(set.has(40)).toBe(true);
  });

  it("selects reversed range", () => {
    const set = new Set<string | number>();
    selectRangeMut(set, items, 3, 1);
    expect(set.size).toBe(3);
    expect(set.has(20)).toBe(true);
    expect(set.has(40)).toBe(true);
  });

  it("skips undefined slots", () => {
    const sparse = [{ id: 1 }, undefined, { id: 3 }] as any[];
    const set = new Set<string | number>();
    selectRangeMut(set, sparse, 0, 2);
    expect(set.size).toBe(2);
    expect(set.has(1)).toBe(true);
    expect(set.has(3)).toBe(true);
  });
});

// =============================================================================
// getSelectedItemsMut
// =============================================================================

describe("getSelectedItemsMut", () => {
  it("returns items that are in the selected set", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }] as any[];
    const set = new Set<string | number>([1, 3]);
    const result = getSelectedItemsMut(set, items);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(3);
  });

  it("returns empty array when nothing is selected", () => {
    const items = [{ id: 1 }, { id: 2 }] as any[];
    const set = new Set<string | number>();
    expect(getSelectedItemsMut(set, items)).toEqual([]);
  });
});
