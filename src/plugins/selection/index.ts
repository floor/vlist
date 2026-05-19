/**
 * vlist v2 — Selection Plugin
 */

export { selection, type SelectionPluginConfig } from "./plugin";
export {
  createSelectionState,
  selectOne,
  toggleOne,
  selectRangeMut as selectRange,
  selectAllItems,
  moveFocus,
  getSelectedArray,
  getSelectedItemsMut as getSelectedItems,
  type SelectionState,
  // v1 immutable API (re-exported for backwards compat)
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  isSelected,
  getSelectedIds,
} from "./state";
