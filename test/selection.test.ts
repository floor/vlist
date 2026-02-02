/**
 * vlist - Selection State Tests
 * Tests for selection state management functions
 */

import { describe, it, expect } from "bun:test";
import {
  createSelectionState,
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  setFocusedIndex,
  moveFocusUp,
  moveFocusDown,
  moveFocusToFirst,
  moveFocusToLast,
  moveFocusByPage,
  isSelected,
  getSelectedIds,
  getSelectedItems,
  getSelectionCount,
  isSelectionEmpty,
  selectFocused,
  selectRange,
} from "../src/core/selection";

import type { VListItem } from "../src/types";

// Test data
const createTestItems = (count: number): VListItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));
};

describe("createSelectionState", () => {
  it("should create empty selection state", () => {
    const state = createSelectionState();

    expect(state.selected.size).toBe(0);
    expect(state.focusedIndex).toBe(-1);
  });

  it("should create state with initial selection", () => {
    const state = createSelectionState([1, 2, 3]);

    expect(state.selected.size).toBe(3);
    expect(state.selected.has(1)).toBe(true);
    expect(state.selected.has(2)).toBe(true);
    expect(state.selected.has(3)).toBe(true);
  });

  it("should handle empty initial array", () => {
    const state = createSelectionState([]);

    expect(state.selected.size).toBe(0);
  });
});

describe("selectItems", () => {
  it("should select items in single mode", () => {
    const state = createSelectionState();
    const newState = selectItems(state, [1, 2, 3], "single");

    // Single mode only keeps the first item
    expect(newState.selected.size).toBe(1);
    expect(newState.selected.has(1)).toBe(true);
  });

  it("should select items in multiple mode", () => {
    const state = createSelectionState();
    const newState = selectItems(state, [1, 2, 3], "multiple");

    expect(newState.selected.size).toBe(3);
    expect(newState.selected.has(1)).toBe(true);
    expect(newState.selected.has(2)).toBe(true);
    expect(newState.selected.has(3)).toBe(true);
  });

  it("should not select in none mode", () => {
    const state = createSelectionState();
    const newState = selectItems(state, [1, 2, 3], "none");

    expect(newState.selected.size).toBe(0);
  });

  it("should replace selection in single mode", () => {
    const state = createSelectionState([1]);
    const newState = selectItems(state, [2], "single");

    expect(newState.selected.size).toBe(1);
    expect(newState.selected.has(1)).toBe(false);
    expect(newState.selected.has(2)).toBe(true);
  });

  it("should add to selection in multiple mode", () => {
    const state = createSelectionState([1]);
    const newState = selectItems(state, [2, 3], "multiple");

    expect(newState.selected.size).toBe(3);
    expect(newState.selected.has(1)).toBe(true);
    expect(newState.selected.has(2)).toBe(true);
    expect(newState.selected.has(3)).toBe(true);
  });

  it("should handle empty ids array", () => {
    const state = createSelectionState([1]);
    const newState = selectItems(state, [], "single");

    // Single mode with empty array clears selection
    expect(newState.selected.size).toBe(0);
  });
});

describe("deselectItems", () => {
  it("should deselect specified items", () => {
    const state = createSelectionState([1, 2, 3]);
    const newState = deselectItems(state, [2]);

    expect(newState.selected.size).toBe(2);
    expect(newState.selected.has(1)).toBe(true);
    expect(newState.selected.has(2)).toBe(false);
    expect(newState.selected.has(3)).toBe(true);
  });

  it("should handle deselecting non-selected items", () => {
    const state = createSelectionState([1, 2]);
    const newState = deselectItems(state, [5]);

    expect(newState.selected.size).toBe(2);
  });

  it("should deselect multiple items", () => {
    const state = createSelectionState([1, 2, 3, 4, 5]);
    const newState = deselectItems(state, [2, 4]);

    expect(newState.selected.size).toBe(3);
    expect(newState.selected.has(2)).toBe(false);
    expect(newState.selected.has(4)).toBe(false);
  });
});

describe("toggleSelection", () => {
  it("should select unselected item", () => {
    const state = createSelectionState();
    const newState = toggleSelection(state, 1, "single");

    expect(newState.selected.has(1)).toBe(true);
  });

  it("should deselect selected item", () => {
    const state = createSelectionState([1]);
    const newState = toggleSelection(state, 1, "single");

    expect(newState.selected.has(1)).toBe(false);
  });

  it("should replace selection in single mode", () => {
    const state = createSelectionState([1]);
    const newState = toggleSelection(state, 2, "single");

    expect(newState.selected.size).toBe(1);
    expect(newState.selected.has(1)).toBe(false);
    expect(newState.selected.has(2)).toBe(true);
  });

  it("should add to selection in multiple mode", () => {
    const state = createSelectionState([1]);
    const newState = toggleSelection(state, 2, "multiple");

    expect(newState.selected.size).toBe(2);
    expect(newState.selected.has(1)).toBe(true);
    expect(newState.selected.has(2)).toBe(true);
  });

  it("should not toggle in none mode", () => {
    const state = createSelectionState();
    const newState = toggleSelection(state, 1, "none");

    expect(newState.selected.size).toBe(0);
  });
});

describe("selectAll", () => {
  it("should select all items in multiple mode", () => {
    const state = createSelectionState();
    const items = createTestItems(5);
    const newState = selectAll(state, items, "multiple");

    expect(newState.selected.size).toBe(5);
    items.forEach((item) => {
      expect(newState.selected.has(item.id)).toBe(true);
    });
  });

  it("should not select all in single mode", () => {
    const state = createSelectionState();
    const items = createTestItems(5);
    const newState = selectAll(state, items, "single");

    expect(newState.selected.size).toBe(0);
  });

  it("should not select all in none mode", () => {
    const state = createSelectionState();
    const items = createTestItems(5);
    const newState = selectAll(state, items, "none");

    expect(newState.selected.size).toBe(0);
  });

  it("should handle empty items array", () => {
    const state = createSelectionState();
    const newState = selectAll(state, [], "multiple");

    expect(newState.selected.size).toBe(0);
  });
});

describe("clearSelection", () => {
  it("should clear all selections", () => {
    const state = createSelectionState([1, 2, 3]);
    const newState = clearSelection(state);

    expect(newState.selected.size).toBe(0);
  });

  it("should preserve focusedIndex", () => {
    const state = { ...createSelectionState([1, 2, 3]), focusedIndex: 5 };
    const newState = clearSelection(state);

    expect(newState.focusedIndex).toBe(5);
  });
});

describe("setFocusedIndex", () => {
  it("should set focused index", () => {
    const state = createSelectionState();
    const newState = setFocusedIndex(state, 5);

    expect(newState.focusedIndex).toBe(5);
  });

  it("should allow negative index", () => {
    const state = createSelectionState();
    const newState = setFocusedIndex(state, -1);

    expect(newState.focusedIndex).toBe(-1);
  });
});

describe("moveFocusUp", () => {
  it("should move focus up", () => {
    const state = { ...createSelectionState(), focusedIndex: 5 };
    const newState = moveFocusUp(state, 10);

    expect(newState.focusedIndex).toBe(4);
  });

  it("should wrap to last item when at top", () => {
    const state = { ...createSelectionState(), focusedIndex: 0 };
    const newState = moveFocusUp(state, 10, true);

    expect(newState.focusedIndex).toBe(9);
  });

  it("should stay at top when wrap is false", () => {
    const state = { ...createSelectionState(), focusedIndex: 0 };
    const newState = moveFocusUp(state, 10, false);

    expect(newState.focusedIndex).toBe(0);
  });

  it("should handle empty list", () => {
    const state = { ...createSelectionState(), focusedIndex: 0 };
    const newState = moveFocusUp(state, 0);

    expect(newState.focusedIndex).toBe(0);
  });
});

describe("moveFocusDown", () => {
  it("should move focus down", () => {
    const state = { ...createSelectionState(), focusedIndex: 5 };
    const newState = moveFocusDown(state, 10);

    expect(newState.focusedIndex).toBe(6);
  });

  it("should wrap to first item when at bottom", () => {
    const state = { ...createSelectionState(), focusedIndex: 9 };
    const newState = moveFocusDown(state, 10, true);

    expect(newState.focusedIndex).toBe(0);
  });

  it("should stay at bottom when wrap is false", () => {
    const state = { ...createSelectionState(), focusedIndex: 9 };
    const newState = moveFocusDown(state, 10, false);

    expect(newState.focusedIndex).toBe(9);
  });

  it("should handle empty list", () => {
    const state = { ...createSelectionState(), focusedIndex: 0 };
    const newState = moveFocusDown(state, 0);

    expect(newState.focusedIndex).toBe(0);
  });
});

describe("moveFocusToFirst", () => {
  it("should move focus to first item", () => {
    const state = { ...createSelectionState(), focusedIndex: 5 };
    const newState = moveFocusToFirst(state, 10);

    expect(newState.focusedIndex).toBe(0);
  });

  it("should handle empty list", () => {
    const state = { ...createSelectionState(), focusedIndex: -1 };
    const newState = moveFocusToFirst(state, 0);

    expect(newState.focusedIndex).toBe(-1);
  });
});

describe("moveFocusToLast", () => {
  it("should move focus to last item", () => {
    const state = { ...createSelectionState(), focusedIndex: 5 };
    const newState = moveFocusToLast(state, 10);

    expect(newState.focusedIndex).toBe(9);
  });

  it("should handle empty list", () => {
    const state = { ...createSelectionState(), focusedIndex: -1 };
    const newState = moveFocusToLast(state, 0);

    expect(newState.focusedIndex).toBe(-1);
  });
});

describe("moveFocusByPage", () => {
  it("should move focus up by page size", () => {
    const state = { ...createSelectionState(), focusedIndex: 50 };
    const newState = moveFocusByPage(state, 100, 10, "up");

    expect(newState.focusedIndex).toBe(40);
  });

  it("should move focus down by page size", () => {
    const state = { ...createSelectionState(), focusedIndex: 50 };
    const newState = moveFocusByPage(state, 100, 10, "down");

    expect(newState.focusedIndex).toBe(60);
  });

  it("should clamp to start", () => {
    const state = { ...createSelectionState(), focusedIndex: 5 };
    const newState = moveFocusByPage(state, 100, 10, "up");

    expect(newState.focusedIndex).toBe(0);
  });

  it("should clamp to end", () => {
    const state = { ...createSelectionState(), focusedIndex: 95 };
    const newState = moveFocusByPage(state, 100, 10, "down");

    expect(newState.focusedIndex).toBe(99);
  });
});

describe("isSelected", () => {
  it("should return true for selected item", () => {
    const state = createSelectionState([1, 2, 3]);

    expect(isSelected(state, 2)).toBe(true);
  });

  it("should return false for non-selected item", () => {
    const state = createSelectionState([1, 2, 3]);

    expect(isSelected(state, 5)).toBe(false);
  });
});

describe("getSelectedIds", () => {
  it("should return array of selected ids", () => {
    const state = createSelectionState([1, 2, 3]);
    const ids = getSelectedIds(state);

    expect(ids).toHaveLength(3);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  it("should return empty array when nothing selected", () => {
    const state = createSelectionState();
    const ids = getSelectedIds(state);

    expect(ids).toHaveLength(0);
  });
});

describe("getSelectedItems", () => {
  it("should return selected items", () => {
    const state = createSelectionState([2, 4]);
    const items = createTestItems(5);
    const selected = getSelectedItems(state, items);

    expect(selected).toHaveLength(2);
    expect(selected.find((i) => i.id === 2)).toBeDefined();
    expect(selected.find((i) => i.id === 4)).toBeDefined();
  });

  it("should return empty array when nothing selected", () => {
    const state = createSelectionState();
    const items = createTestItems(5);
    const selected = getSelectedItems(state, items);

    expect(selected).toHaveLength(0);
  });

  it("should handle missing items gracefully", () => {
    const state = createSelectionState([1, 100]); // 100 doesn't exist
    const items = createTestItems(5);
    const selected = getSelectedItems(state, items);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe(1);
  });
});

describe("getSelectionCount", () => {
  it("should return selection count", () => {
    const state = createSelectionState([1, 2, 3]);

    expect(getSelectionCount(state)).toBe(3);
  });

  it("should return 0 for empty selection", () => {
    const state = createSelectionState();

    expect(getSelectionCount(state)).toBe(0);
  });
});

describe("isSelectionEmpty", () => {
  it("should return true for empty selection", () => {
    const state = createSelectionState();

    expect(isSelectionEmpty(state)).toBe(true);
  });

  it("should return false for non-empty selection", () => {
    const state = createSelectionState([1]);

    expect(isSelectionEmpty(state)).toBe(false);
  });
});

describe("selectFocused", () => {
  it("should toggle selection on focused item", () => {
    const state = { ...createSelectionState(), focusedIndex: 2 };
    const items = createTestItems(5);
    const newState = selectFocused(state, items, "single");

    expect(newState.selected.has(3)).toBe(true); // id is index + 1
  });

  it("should not select if no item is focused", () => {
    const state = { ...createSelectionState(), focusedIndex: -1 };
    const items = createTestItems(5);
    const newState = selectFocused(state, items, "single");

    expect(newState.selected.size).toBe(0);
  });

  it("should not select if focused index is out of bounds", () => {
    const state = { ...createSelectionState(), focusedIndex: 100 };
    const items = createTestItems(5);
    const newState = selectFocused(state, items, "single");

    expect(newState.selected.size).toBe(0);
  });

  it("should not select in none mode", () => {
    const state = { ...createSelectionState(), focusedIndex: 2 };
    const items = createTestItems(5);
    const newState = selectFocused(state, items, "none");

    expect(newState.selected.size).toBe(0);
  });
});

describe("selectRange", () => {
  it("should select range of items", () => {
    const state = createSelectionState();
    const items = createTestItems(10);
    const newState = selectRange(state, items, 2, 5, "multiple");

    expect(newState.selected.size).toBe(4);
    expect(newState.selected.has(3)).toBe(true);
    expect(newState.selected.has(4)).toBe(true);
    expect(newState.selected.has(5)).toBe(true);
    expect(newState.selected.has(6)).toBe(true);
  });

  it("should handle reversed range", () => {
    const state = createSelectionState();
    const items = createTestItems(10);
    const newState = selectRange(state, items, 5, 2, "multiple");

    expect(newState.selected.size).toBe(4);
  });

  it("should not select range in single mode", () => {
    const state = createSelectionState();
    const items = createTestItems(10);
    const newState = selectRange(state, items, 2, 5, "single");

    expect(newState.selected.size).toBe(0);
  });

  it("should add to existing selection", () => {
    const state = createSelectionState([1]);
    const items = createTestItems(10);
    const newState = selectRange(state, items, 5, 7, "multiple");

    expect(newState.selected.size).toBe(4); // 1 + 3 new items
    expect(newState.selected.has(1)).toBe(true);
  });
});
