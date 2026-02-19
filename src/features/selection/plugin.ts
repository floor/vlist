/**
 * vlist/selection - Builder Plugin
 * Wraps the selection domain into a VListPlugin for the composable builder.
 *
 * Priority: 50 (runs after renderer and data are ready)
 *
 * What it wires:
 * - Click handler on items container — toggles selection on item click
 * - Keyboard handler on root — ArrowUp/Down for focus, Space/Enter for toggle
 * - ARIA attributes — aria-selected on items, aria-activedescendant on root
 * - Live region — announces selection changes to screen readers
 * - Render integration — passes selection state to render pipeline
 *
 * Added methods: select, deselect, toggleSelect, selectAll, clearSelection,
 *                getSelected, getSelectedItems
 *
 * Added events: item:click, selection:change
 */

import type { VListItem, SelectionMode } from "../../types";
import type { VListPlugin, BuilderContext } from "../../builder/types";

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
  getSelectedIds,
  getSelectedItems,
} from "./state";

import { calculateScrollToIndex } from "../../rendering";

// =============================================================================
// Plugin Config
// =============================================================================

/** Selection plugin configuration */
export interface SelectionPluginConfig {
  /** Selection mode (default: 'single') */
  mode?: SelectionMode;

  /** Initially selected item IDs */
  initial?: Array<string | number>;
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create a selection plugin for the builder.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withSelection } from 'vlist/selection'
 *
 * const list = vlist({ ... })
 *   .use(withSelection({ mode: 'multiple', initial: ['id-1'] }))
 *   .build()
 *
 * list.select('id-2')
 * list.getSelected() // ['id-1', 'id-2']
 * ```
 */
export const withSelection = <T extends VListItem = VListItem>(
  config?: SelectionPluginConfig,
): VListPlugin<T> => {
  const mode: SelectionMode = config?.mode ?? "single";
  const initial = config?.initial;

  // Selection state — lives for the lifetime of the list
  let selectionState = createSelectionState(initial);
  let liveRegion: HTMLDivElement | null = null;

  return {
    name: "withSelection",
    priority: 50,

    methods: [
      "select",
      "deselect",
      "toggleSelect",
      "selectAll",
      "clearSelection",
      "getSelected",
      "getSelectedItems",
    ] as const,

    setup(ctx: BuilderContext<T>): void {
      const { dom, emitter, config: resolvedConfig } = ctx;
      const { classPrefix, ariaIdPrefix } = resolvedConfig;

      // If mode is 'none', register stub methods for backwards compatibility
      if (mode === "none") {
        ctx.methods.set("select", () => {});
        ctx.methods.set("deselect", () => {});
        ctx.methods.set("toggleSelect", () => {});
        ctx.methods.set("selectAll", () => {});
        ctx.methods.set("clearSelection", () => {});
        ctx.methods.set("getSelected", () => []);
        ctx.methods.set("getSelectedItems", () => []);
        ctx.methods.set("setSelectionMode", () => {});
        return;
      }

      // ── Wrap existing render functions to inject selection state ──
      // We capture the current renderIfNeeded (which may have been set by
      // grid/groups plugins) and wrap it. After rendering, we update
      // selection classes on the rendered elements.

      // Capture the current render functions BEFORE we replace them
      // This avoids infinite recursion since we get the actual function refs
      const {
        renderIfNeeded: previousRenderIfNeeded,
        forceRender: previousForceRender,
      } = ctx.getRenderFns();

      // Helper to apply selection classes to rendered items
      const applySelectionClasses = (): void => {
        const rendered = ctx.dom.items.querySelectorAll("[data-index]");
        rendered.forEach((el) => {
          const element = el as HTMLElement;
          const id = element.dataset.id;
          if (id !== undefined) {
            // Try to parse as number first, fall back to string
            const itemId = /^\d+$/.test(id) ? parseInt(id, 10) : id;
            const isSelected = selectionState.selected.has(itemId);
            const index = parseInt(element.dataset.index ?? "-1", 10);
            const isFocused = index === selectionState.focusedIndex;

            element.classList.toggle(
              `${classPrefix}-item--selected`,
              isSelected,
            );
            element.classList.toggle(`${classPrefix}-item--focused`, isFocused);
            element.ariaSelected = isSelected ? "true" : "false";
          }
        });
      };

      const renderWithSelection = (): void => {
        if (ctx.state.isDestroyed) return;

        // Call the previous render function (grid's or core's)
        previousRenderIfNeeded();

        // Apply selection classes to whatever was rendered
        applySelectionClasses();
      };

      const forceRenderWithSelection = (): void => {
        if (ctx.state.isDestroyed) return;

        // Call the previous force render
        previousForceRender();

        // Apply selection classes to whatever was rendered
        applySelectionClasses();
      };

      // Replace the render functions via setRenderFns
      ctx.setRenderFns(renderWithSelection, forceRenderWithSelection);

      // ── Helper: apply selection and emit selection change ──
      const renderAndEmit = (): void => {
        applySelectionClasses();

        // Linear search for items by ID (no Map for memory efficiency)
        const getItemByIdFn = (id: string | number): T | undefined => {
          const items = ctx.dataManager.getItemsInRange(
            0,
            ctx.dataManager.getTotal() - 1,
          );
          return items.find((item) => item && item.id === id);
        };

        emitter.emit("selection:change", {
          selected: getSelectedIds(selectionState),
          items: getSelectedItems(selectionState, getItemByIdFn),
        });
      };

      // ── ARIA live region ──
      liveRegion = document.createElement("div");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("aria-atomic", "true");
      liveRegion.className = `${classPrefix}-live-region`;
      liveRegion.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
      dom.root.appendChild(liveRegion);

      // Announce selection changes
      const liveRef = liveRegion;
      emitter.on("selection:change", ({ selected }) => {
        const count = selected.length;
        if (count === 0) {
          liveRef.textContent = "";
        } else if (count === 1) {
          liveRef.textContent = "1 item selected";
        } else {
          liveRef.textContent = `${count} items selected`;
        }
      });

      // ── Click handler ──
      ctx.clickHandlers.push((event: MouseEvent): void => {
        if (ctx.state.isDestroyed) return;

        const target = event.target as HTMLElement;
        const itemElement = target.closest(
          "[data-index]",
        ) as HTMLElement | null;
        if (!itemElement) return;

        const index = parseInt(itemElement.dataset.index ?? "-1", 10);
        if (index < 0) return;

        const item = ctx.dataManager.getItem(index);
        if (!item) return;

        // Emit click event
        emitter.emit("item:click", { item, index, event });

        // Update focused index
        selectionState = setFocusedIndex(selectionState, index);

        // ARIA: update aria-activedescendant
        dom.root.setAttribute(
          "aria-activedescendant",
          `${ariaIdPrefix}-item-${index}`,
        );

        // Toggle selection
        selectionState = toggleSelection(selectionState, item.id, mode);

        // Re-render with selection
        renderAndEmit();
      });

      // ── Keyboard handler ──
      ctx.keydownHandlers.push((event: KeyboardEvent): void => {
        if (ctx.state.isDestroyed) return;

        const totalItems = ctx.dataManager.getTotal();
        const previousFocusIndex = selectionState.focusedIndex;

        let handled = false;
        let focusOnly = false;
        let newState = selectionState;

        switch (event.key) {
          case "ArrowUp":
            newState = moveFocusUp(selectionState, totalItems);
            handled = true;
            focusOnly = true;
            break;

          case "ArrowDown":
            newState = moveFocusDown(selectionState, totalItems);
            handled = true;
            focusOnly = true;
            break;

          case "Home":
            newState = moveFocusToFirst(selectionState, totalItems);
            handled = true;
            focusOnly = true;
            break;

          case "End":
            newState = moveFocusToLast(selectionState, totalItems);
            handled = true;
            focusOnly = true;
            break;

          case " ":
          case "Enter":
            if (selectionState.focusedIndex >= 0) {
              const focusedItem = ctx.dataManager.getItem(
                selectionState.focusedIndex,
              );
              if (focusedItem) {
                newState = toggleSelection(
                  selectionState,
                  focusedItem.id,
                  mode,
                );
              }
              handled = true;
            }
            break;
        }

        if (handled) {
          event.preventDefault();
          selectionState = newState;

          const newFocusIndex = selectionState.focusedIndex;

          // Scroll focused item into view + ARIA
          if (newFocusIndex >= 0) {
            const dataState = ctx.dataManager.getState();
            const position = calculateScrollToIndex(
              newFocusIndex,
              ctx.heightCache,
              ctx.state.viewportState.containerHeight,
              dataState.total,
              "center",
              ctx.getCachedCompression(),
            );
            ctx.scrollController.scrollTo(position);

            dom.root.setAttribute(
              "aria-activedescendant",
              `${ariaIdPrefix}-item-${newFocusIndex}`,
            );
          } else {
            dom.root.removeAttribute("aria-activedescendant");
          }

          if (focusOnly) {
            // Targeted update — only touch two affected items
            const { selected } = selectionState;

            if (
              previousFocusIndex >= 0 &&
              previousFocusIndex !== newFocusIndex
            ) {
              const prevItem = ctx.dataManager.getItem(previousFocusIndex);
              if (prevItem) {
                ctx.renderer.updateItemClasses(
                  previousFocusIndex,
                  selected.has(prevItem.id),
                  false,
                );
              }
            }

            if (newFocusIndex >= 0) {
              const newItem = ctx.dataManager.getItem(newFocusIndex);
              if (newItem) {
                ctx.renderer.updateItemClasses(
                  newFocusIndex,
                  selected.has(newItem.id),
                  true,
                );
              }
            }
          } else {
            // Full re-render for selection changes (Space/Enter)
            forceRenderWithSelection();

            // Linear search for items by ID (no Map for memory efficiency)
            const getItemByIdFn = (id: string | number): T | undefined => {
              const items = ctx.dataManager.getItemsInRange(
                0,
                ctx.dataManager.getTotal() - 1,
              );
              return items.find((item) => item && item.id === id);
            };

            emitter.emit("selection:change", {
              selected: getSelectedIds(selectionState),
              items: getSelectedItems(selectionState, getItemByIdFn),
            });
          }
        }
      });

      // ── Register public methods ──
      ctx.methods.set("select", (...ids: Array<string | number>): void => {
        selectionState = selectItems(selectionState, ids, mode);
        renderAndEmit();
      });

      ctx.methods.set("deselect", (...ids: Array<string | number>): void => {
        selectionState = deselectItems(selectionState, ids);
        renderAndEmit();
      });

      ctx.methods.set("toggleSelect", (id: string | number): void => {
        selectionState = toggleSelection(selectionState, id, mode);
        renderAndEmit();
      });

      ctx.methods.set("selectAll", (): void => {
        if (mode !== "multiple") return;
        const allItems = ctx.getAllLoadedItems();
        selectionState = selectAll(selectionState, allItems, mode);
        renderAndEmit();
      });

      ctx.methods.set("clearSelection", (): void => {
        selectionState = clearSelection(selectionState);

        const { renderRange, isCompressed } = ctx.state.viewportState;
        const items = ctx.getItemsForRange(renderRange);
        const compressionCtx = isCompressed
          ? ctx.getCompressionContext()
          : undefined;

        ctx.renderer.render(
          items,
          renderRange,
          selectionState.selected,
          selectionState.focusedIndex,
          compressionCtx,
        );

        emitter.emit("selection:change", {
          selected: [],
          items: [],
        });
      });

      ctx.methods.set("getSelected", (): Array<string | number> => {
        return getSelectedIds(selectionState);
      });

      ctx.methods.set("getSelectedItems", (): T[] => {
        // Linear search for items by ID (no Map for memory efficiency)
        const getItemByIdFn = (id: string | number): T | undefined => {
          const items = ctx.dataManager.getItemsInRange(
            0,
            ctx.dataManager.getTotal() - 1,
          );
          return items.find((item) => item && item.id === id);
        };
        return getSelectedItems(selectionState, getItemByIdFn);
      });

      // ── Cleanup handler ──
      ctx.destroyHandlers.push(() => {
        if (liveRef && liveRef.parentNode) {
          liveRef.remove();
        }
      });
    },

    destroy(): void {
      if (liveRegion && liveRegion.parentNode) {
        liveRegion.remove();
      }
      liveRegion = null;
    },
  };
};
