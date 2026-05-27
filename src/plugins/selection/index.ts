/**
 * vlist v2 — Selection Plugin
 */

export { selection, type SelectionPluginConfig } from "./plugin";
export {
  createSelectionState,
  selectOne,
  toggleOne,
  selectRange,
  selectRangeMut,
  selectAllItems,
  moveFocus,
  getSelectedArray,
  getSelectedItems,
  getSelectedItemsMut,
  type SelectionState,
  // v1 immutable API (re-exported for backwards compat)
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  isSelected,
  getSelectedIds,
  getSelectionCount,
  isSelectionEmpty,
  selectFocused,
  moveFocusUp,
  moveFocusDown,
  moveFocusToFirst,
  moveFocusToLast,
  moveFocusByPage,
  claimPlaceholderSelection,
  setFocusedIndex,
} from "./state";
