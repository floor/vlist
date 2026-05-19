/**
 * vlist v2 — Selection Plugin
 *
 * Manages selection state, click/keyboard handlers, ARIA attributes.
 * Adapted from v1 withSelection feature to the v2 plugin interface.
 */

import type { VListItem, SelectionMode } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import {
  createSelectionState,
  selectOne,
  toggleOne,
  selectRangeMut as selectRange,
  selectAllItems,
  moveFocus,
  getSelectedArray,
  getSelectedItemsMut as getSelectedItems,
  type SelectionState,
} from "./state";

// =============================================================================
// Config
// =============================================================================

export interface SelectionPluginConfig {
  mode?: SelectionMode;
  initial?: Array<string | number>;
  followFocus?: boolean;
  focusOnClick?: boolean;
}

// =============================================================================
// Factory
// =============================================================================

export function selection<T extends VListItem = VListItem>(
  config?: SelectionPluginConfig,
): VListPlugin<T> {
  const mode: SelectionMode = config?.mode ?? "single";
  const followFocus = config?.followFocus ?? false;
  const focusOnClick = config?.focusOnClick ?? false;

  let state: SelectionState;
  let items: () => readonly T[];
  let forceRender: () => void;
  let emitter: PluginContext<T>["emitter"];
  let dom: PluginContext<T>["dom"];
  let resolvedConfig: PluginContext<T>["config"];
  let lastSelectedIndex = -1;

  function emitSelectionChange(): void {
    forceRender();
    emitter.emit("selection:change", {
      selected: getSelectedArray(state.selected),
      items: getSelectedItems(state.selected, items()),
    });
  }

  function findItemFromEvent(event: MouseEvent): { item: T; index: number } | null {
    const el = (event.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
    if (!el) return null;
    const index = parseInt(el.dataset.index ?? "-1", 10);
    if (index < 0) return null;
    const item = items()[index];
    if (!item) return null;
    return { item, index };
  }

  return {
    name: "selection",
    priority: 50,

    setup(ctx: PluginContext<T>): void {
      state = createSelectionState(config?.initial);
      items = ctx.getItems.bind(ctx);
      forceRender = ctx.forceRender.bind(ctx);
      emitter = ctx.emitter;
      dom = ctx.dom;
      resolvedConfig = ctx.config;

      if (mode === "none") {
        ctx.registerMethod("select", () => {});
        ctx.registerMethod("deselect", () => {});
        ctx.registerMethod("toggleSelect", () => {});
        ctx.registerMethod("selectAll", () => {});
        ctx.registerMethod("clearSelection", () => {});
        ctx.registerMethod("getSelected", () => []);
        ctx.registerMethod("getSelectedItems", () => []);
        ctx.registerMethod("selectNext", () => {});
        ctx.registerMethod("selectPrevious", () => {});
        return;
      }

      dom.root.classList.add(`${resolvedConfig.classPrefix}--selectable`);

      // ── Click handler ──────────────────────────────────────────

      ctx.registerClickHandler((event: MouseEvent): void => {
        const hit = findItemFromEvent(event);
        if (!hit) return;

        // Shift+click range select
        if (mode === "multiple" && event.shiftKey && state.focusedIndex >= 0) {
          const anchor = lastSelectedIndex >= 0 ? lastSelectedIndex : state.focusedIndex;
          selectRange(state.selected, items(), anchor, hit.index);
          state.focusedIndex = hit.index;
          state.focusVisible = focusOnClick;
          lastSelectedIndex = hit.index;
          emitSelectionChange();
          return;
        }

        state.focusedIndex = hit.index;
        state.focusVisible = focusOnClick;
        lastSelectedIndex = hit.index;
        toggleOne(state.selected, hit.item.id, mode);
        emitSelectionChange();
      });

      // ── Keyboard handler ───────────────────────────────────────

      if (resolvedConfig.interactive) {
        ctx.registerKeydownHandler((event: KeyboardEvent): void => {
          const allItems = items();
          const total = allItems.length;
          if (total === 0) return;

          const prevFocus = state.focusedIndex;
          let handled = false;
          let focusOnly = false;

          switch (event.key) {
            case "ArrowUp":
              moveFocus(state, -1, total, resolvedConfig.reverse);
              state.focusVisible = true;
              handled = true;
              focusOnly = true;
              break;

            case "ArrowDown":
              moveFocus(state, 1, total, resolvedConfig.reverse);
              state.focusVisible = true;
              handled = true;
              focusOnly = true;
              break;

            case "Home":
              if (total > 0) state.focusedIndex = 0;
              state.focusVisible = true;
              handled = true;
              focusOnly = true;
              break;

            case "End":
              if (total > 0) state.focusedIndex = total - 1;
              state.focusVisible = true;
              handled = true;
              focusOnly = true;
              break;

            case "PageUp":
            case "PageDown": {
              const pageSize = 10;
              moveFocus(state, event.key === "PageUp" ? -pageSize : pageSize, total);
              state.focusVisible = true;
              handled = true;
              focusOnly = true;
              break;
            }

            case " ":
            case "Enter":
              if (event.key === " " && event.shiftKey && mode === "multiple" && state.focusedIndex >= 0) {
                if (lastSelectedIndex >= 0) {
                  selectRange(state.selected, allItems, lastSelectedIndex, state.focusedIndex);
                }
                state.focusVisible = true;
                handled = true;
                break;
              }
              if (state.focusedIndex >= 0) {
                const item = allItems[state.focusedIndex];
                if (item) {
                  toggleOne(state.selected, item.id, mode);
                  lastSelectedIndex = state.focusedIndex;
                }
                state.focusVisible = true;
                handled = true;
              }
              break;

            case "a":
              if ((event.ctrlKey || event.metaKey) && mode === "multiple") {
                if (state.selected.size === total) {
                  state.selected.clear();
                } else {
                  selectAllItems(state.selected, allItems);
                }
                state.focusVisible = true;
                handled = true;
              }
              break;

            case "Delete":
            case "Backspace":
              if (state.selected.size > 0) {
                emitter.emit("delete", {
                  selected: getSelectedArray(state.selected),
                  items: getSelectedItems(state.selected, allItems),
                });
                handled = true;
              }
              break;
          }

          // Shift+Arrow: toggle destination item
          if (event.shiftKey && mode === "multiple" && focusOnly && state.focusedIndex >= 0) {
            const isArrow = event.key === "ArrowUp" || event.key === "ArrowDown";
            if (isArrow) {
              const destItem = allItems[state.focusedIndex];
              if (destItem) {
                toggleOne(state.selected, destItem.id, mode);
              }
              lastSelectedIndex = state.focusedIndex;
              focusOnly = false;
            }

            const isCtrlHomeEnd = (event.ctrlKey || event.metaKey)
              && (event.key === "Home" || event.key === "End");
            if (isCtrlHomeEnd) {
              selectRange(state.selected, allItems, prevFocus >= 0 ? prevFocus : state.focusedIndex, state.focusedIndex);
              lastSelectedIndex = state.focusedIndex;
              focusOnly = false;
            }
          }

          // Selection follows focus
          if (followFocus && mode === "single" && focusOnly && state.focusedIndex >= 0) {
            const item = allItems[state.focusedIndex];
            if (item) selectOne(state.selected, item.id, mode);
            focusOnly = false;
          }

          if (handled) {
            event.preventDefault();

            if (focusOnly) {
              forceRender();
              if (state.focusedIndex >= 0 && state.focusedIndex !== prevFocus) {
                const item = allItems[state.focusedIndex];
                if (item) {
                  emitter.emit("focus:change", { id: item.id, index: state.focusedIndex });
                }
              }
            } else {
              emitSelectionChange();
            }
          }
        });
      }

      // ── Public methods ─────────────────────────────────────────

      ctx.registerMethod("select", (...ids: Array<string | number>): void => {
        for (const id of ids) selectOne(state.selected, id, mode);
        emitSelectionChange();
      });

      ctx.registerMethod("deselect", (...ids: Array<string | number>): void => {
        for (const id of ids) state.selected.delete(id);
        emitSelectionChange();
      });

      ctx.registerMethod("toggleSelect", (id: string | number): void => {
        toggleOne(state.selected, id, mode);
        emitSelectionChange();
      });

      ctx.registerMethod("selectAll", (): void => {
        if (mode !== "multiple") return;
        selectAllItems(state.selected, items());
        emitSelectionChange();
      });

      ctx.registerMethod("clearSelection", (): void => {
        state.selected.clear();
        emitSelectionChange();
      });

      ctx.registerMethod("getSelected", (): Array<string | number> => {
        return getSelectedArray(state.selected);
      });

      ctx.registerMethod("getSelectedItems", (): T[] => {
        return getSelectedItems(state.selected, items());
      });

      ctx.registerMethod("selectNext", (): void => {
        const allItems = items();
        if (allItems.length === 0) return;
        moveFocus(state, 1, allItems.length, resolvedConfig.reverse);
        const item = allItems[state.focusedIndex];
        if (item) selectOne(state.selected, item.id, mode);
        emitSelectionChange();
      });

      ctx.registerMethod("selectPrevious", (): void => {
        const allItems = items();
        if (allItems.length === 0) return;
        moveFocus(state, -1, allItems.length, resolvedConfig.reverse);
        const item = allItems[state.focusedIndex];
        if (item) selectOne(state.selected, item.id, mode);
        emitSelectionChange();
      });
    },

    destroy(): void {
      // State is GC'd with the plugin
    },
  };
}
