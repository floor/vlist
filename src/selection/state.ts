/**
 * vlist - Selection State Management
 * Pure functions for managing selection state
 */

import type { VListItem, SelectionMode, SelectionState } from "../types";

// Re-export SelectionState for convenience
export type { SelectionState } from "../types";

// =============================================================================
// State Creation
// =============================================================================

/**
 * Create initial selection state
 * Pure function - no side effects
 */
export const createSelectionState = (
  initial?: Array<string | number>,
): SelectionState => ({
  selected: new Set(initial ?? []),
  focusedIndex: -1,
});

// =============================================================================
// Selection Operations
// =============================================================================

/**
 * Select items by ID
 * Pure function - returns new state
 */
export const selectItems = (
  state: SelectionState,
  ids: Array<string | number>,
  mode: SelectionMode,
): SelectionState => {
  if (mode === "none") return state;

  const newSelected = new Set(state.selected);

  if (mode === "single") {
    // Single mode: replace selection
    newSelected.clear();
    if (ids.length > 0) {
      newSelected.add(ids[0]!);
    }
  } else {
    // Multiple mode: add to selection
    for (const id of ids) {
      newSelected.add(id);
    }
  }

  return {
    ...state,
    selected: newSelected,
  };
};

/**
 * Deselect items by ID
 * Pure function - returns new state
 */
export const deselectItems = (
  state: SelectionState,
  ids: Array<string | number>,
): SelectionState => {
  const newSelected = new Set(state.selected);

  for (const id of ids) {
    newSelected.delete(id);
  }

  return {
    ...state,
    selected: newSelected,
  };
};

/**
 * Toggle item selection
 * Pure function - returns new state
 */
export const toggleSelection = (
  state: SelectionState,
  id: string | number,
  mode: SelectionMode,
): SelectionState => {
  if (mode === "none") return state;

  if (state.selected.has(id)) {
    return deselectItems(state, [id]);
  } else {
    return selectItems(state, [id], mode);
  }
};

/**
 * Select all items
 * Pure function - returns new state
 */
export const selectAll = <T extends VListItem>(
  state: SelectionState,
  items: T[],
  mode: SelectionMode,
): SelectionState => {
  if (mode !== "multiple") return state;

  return {
    ...state,
    selected: new Set(items.map((item) => item.id)),
  };
};

/**
 * Clear all selection
 * Pure function - returns new state
 */
export const clearSelection = (state: SelectionState): SelectionState => ({
  ...state,
  selected: new Set(),
});

// =============================================================================
// Focus Management
// =============================================================================

/**
 * Set focused index
 * Mutates state in-place to avoid allocation on hot path
 */
export const setFocusedIndex = (
  state: SelectionState,
  index: number,
): SelectionState => {
  state.focusedIndex = index;
  return state;
};

/**
 * Move focus up
 * Mutates state in-place to avoid allocation on hot path
 */
export const moveFocusUp = (
  state: SelectionState,
  totalItems: number,
  wrap: boolean = true,
): SelectionState => {
  if (totalItems === 0) return state;

  let newIndex = state.focusedIndex - 1;

  if (newIndex < 0) {
    newIndex = wrap ? totalItems - 1 : 0;
  }

  state.focusedIndex = newIndex;
  return state;
};

/**
 * Move focus down
 * Mutates state in-place to avoid allocation on hot path
 */
export const moveFocusDown = (
  state: SelectionState,
  totalItems: number,
  wrap: boolean = true,
): SelectionState => {
  if (totalItems === 0) return state;

  let newIndex = state.focusedIndex + 1;

  if (newIndex >= totalItems) {
    newIndex = wrap ? 0 : totalItems - 1;
  }

  state.focusedIndex = newIndex;
  return state;
};

/**
 * Move focus to first item
 * Mutates state in-place to avoid allocation on hot path
 */
export const moveFocusToFirst = (
  state: SelectionState,
  totalItems: number,
): SelectionState => {
  if (totalItems === 0) return state;

  state.focusedIndex = 0;
  return state;
};

/**
 * Move focus to last item
 * Mutates state in-place to avoid allocation on hot path
 */
export const moveFocusToLast = (
  state: SelectionState,
  totalItems: number,
): SelectionState => {
  if (totalItems === 0) return state;

  state.focusedIndex = totalItems - 1;
  return state;
};

/**
 * Move focus by page (for Page Up/Down)
 * Mutates state in-place to avoid allocation on hot path
 */
export const moveFocusByPage = (
  state: SelectionState,
  totalItems: number,
  pageSize: number,
  direction: "up" | "down",
): SelectionState => {
  if (totalItems === 0) return state;

  let newIndex =
    direction === "up"
      ? state.focusedIndex - pageSize
      : state.focusedIndex + pageSize;

  // Clamp to valid range
  newIndex = Math.max(0, Math.min(totalItems - 1, newIndex));

  state.focusedIndex = newIndex;
  return state;
};

// =============================================================================
// Queries
// =============================================================================

/**
 * Check if an item is selected
 * Pure function - no side effects
 */
export const isSelected = (
  state: SelectionState,
  id: string | number,
): boolean => {
  return state.selected.has(id);
};

/**
 * Get selected IDs as array
 * Pure function - no side effects
 */
export const getSelectedIds = (
  state: SelectionState,
): Array<string | number> => {
  return Array.from(state.selected);
};

/**
 * Get selected items using ID lookup (O(k) where k = selected count)
 * Pure function - no side effects
 */
export const getSelectedItems = <T extends VListItem>(
  state: SelectionState,
  getItemById: (id: string | number) => T | undefined,
): T[] => {
  const items: T[] = [];
  for (const id of state.selected) {
    const item = getItemById(id);
    if (item) {
      items.push(item);
    }
  }
  return items;
};

/**
 * Get selection count
 * Pure function - no side effects
 */
export const getSelectionCount = (state: SelectionState): number => {
  return state.selected.size;
};

/**
 * Check if selection is empty
 * Pure function - no side effects
 */
export const isSelectionEmpty = (state: SelectionState): boolean => {
  return state.selected.size === 0;
};

// =============================================================================
// Keyboard Selection Helpers
// =============================================================================

/**
 * Handle keyboard selection (Space/Enter on focused item)
 * Pure function - returns new state
 */
export const selectFocused = <T extends VListItem>(
  state: SelectionState,
  items: T[],
  mode: SelectionMode,
): SelectionState => {
  if (
    mode === "none" ||
    state.focusedIndex < 0 ||
    state.focusedIndex >= items.length
  ) {
    return state;
  }

  const item = items[state.focusedIndex];
  if (!item) return state;

  return toggleSelection(state, item.id, mode);
};

/**
 * Handle shift+click range selection
 * Pure function - returns new state
 */
export const selectRange = <T extends VListItem>(
  state: SelectionState,
  items: T[],
  fromIndex: number,
  toIndex: number,
  mode: SelectionMode,
): SelectionState => {
  if (mode !== "multiple") return state;

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);

  const idsToSelect: Array<string | number> = [];
  for (let i = start; i <= end; i++) {
    const item = items[i];
    if (item) {
      idsToSelect.push(item.id);
    }
  }

  return selectItems(state, idsToSelect, mode);
};
