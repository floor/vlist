/**
 * vlist - Selection Domain
 * Selection state management
 */

// Builder Plugin
export { withSelection, type SelectionPluginConfig } from "./plugin";

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
