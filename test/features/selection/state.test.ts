/**
 * vlist - Selection State Tests
 *
 * NOTE: All functions exported by state.ts (createSelectionState, selectItems,
 * deselectItems, toggleSelection, selectAll, clearSelection, setFocusedIndex,
 * moveFocusUp, moveFocusDown, moveFocusToFirst, moveFocusToLast,
 * moveFocusByPage, isSelected, getSelectedIds, getSelectedItems,
 * getSelectionCount, isSelectionEmpty, selectFocused, selectRange) are fully
 * tested in index.test.ts (61 tests, 100 assertions) via the barrel export.
 *
 * Coverage: 100% lines, 100% functions.
 *
 * This file exists to maintain the 1:1 source↔test mapping convention.
 * Add tests here only for state.ts internals not reachable through the
 * public barrel (currently there are none).
 */

import { describe, it, expect } from "bun:test";
import {
  createSelectionState,
  isSelectionEmpty,
  getSelectionCount,
} from "../../../src/features/selection/state";

describe("selection/state.ts (see index.test.ts for full coverage)", () => {
  it("should be fully tested via index.test.ts — smoke check", () => {
    const state = createSelectionState();
    expect(isSelectionEmpty(state)).toBe(true);
    expect(getSelectionCount(state)).toBe(0);
  });
});