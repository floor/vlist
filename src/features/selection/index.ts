/**
 * vlist - Selection Domain
 * Selection state management
 */

// Builder Feature
export { withSelection, type SelectionFeatureConfig } from "./feature";

// Selection State
export {
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
  selectFocused,
  selectRange,
  getSelectedIds,
  getSelectedItems,
  getSelectionCount,
  isSelected,
  isSelectionEmpty,
  type SelectionState,
} from "./state";
