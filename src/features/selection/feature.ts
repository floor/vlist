/**
 * vlist/selection - Builder Feature
 * Wraps the selection domain into a VListFeature for the composable builder.
 *
 * Priority: 50 (runs after renderer and data are ready)
 *
 * Follows the WAI-ARIA APG "Recommended" multi-select listbox model:
 *
 * What it wires:
 * - Click handler on items container — toggles selection on item click
 *   - Shift+click in multiple mode selects a contiguous range from last-selected item
 * - Keyboard handler on root — ArrowUp/Down/PageUp/PageDown/Home/End for focus, Space/Enter for toggle
 *   - In single mode with followFocus: true, selection follows focus on arrow keys
 *   - In multiple mode, arrow keys move focus only; Space/Enter toggles selection
 *   - Shift+Arrow toggles the destination item (additive, one at a time)
 *   - Shift+Space selects a contiguous range from last-selected item to focused item
 *   - Ctrl+Shift+Home/End selects from focused item to first/last item
 *   - Ctrl+A / Cmd+A selects all (or deselects all if all are selected)
 * - ARIA attributes — aria-selected on items, aria-activedescendant on root
 * - Live region — announces selection changes to screen readers
 * - Render integration — registers internal getters (_getSelectedIds,
 *   _getFocusedIndex) so renderers read real selection state directly,
 *   eliminating the previous querySelectorAll-based DOM bypass.
 *
 * Added methods: select, deselect, toggleSelect, selectAll, clearSelection,
 *                getSelected, getSelectedItems, selectNext, selectPrevious
 *
 * Internal methods (for renderer integration, not public API):
 *   _getSelectedIds  — returns the live Set<string|number> of selected IDs
 *   _getFocusedIndex  — returns the current focused index
 *
 * Added events: item:click, selection:change
 */

import type { VListItem, SelectionMode } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";
import { resolvePadding } from "../../utils/padding";

import {
  createSelectionState,
  selectItems,
  deselectItems,
  toggleSelection,
  selectAll,
  clearSelection,
  selectRange,
  setFocusedIndex,
  moveFocusUp,
  moveFocusDown,
  moveFocusToFirst,
  moveFocusToLast,
  moveFocusByPage,
  getSelectedIds,
  getSelectedItems,
} from "./state";

import { scrollToFocus as sharedScrollToFocus } from "../../rendering/scroll";

// =============================================================================
// Feature Config
// =============================================================================

/** Selection feature configuration */
export interface SelectionFeatureConfig {
  /** Selection mode (default: 'single') */
  mode?: SelectionMode;

  /** Initially selected item IDs */
  initial?: Array<string | number>;

  /**
   * When true, arrow keys select the focused item in single mode
   * (WAI-ARIA "selection follows focus" pattern). Default: false.
   * Ignored in multiple mode (focus and selection are always independent).
   */
  followFocus?: boolean;

  /**
   * Which item Shift+Arrow toggles in multiple mode.
   * - `'origin'` (default) — toggles the item you're moving FROM (macOS-style).
   * - `'destination'` — toggles the item you're moving TO
   *   (WAI-ARIA APG recommended model).
   *
   * Only affects Shift+Arrow keys; has no effect on Shift+Space,
   * Shift+Click, or Ctrl+Shift+Home/End.
   */
  shiftArrowToggle?: "origin" | "destination";
}

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a selection feature for the builder.
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
  config?: SelectionFeatureConfig,
): VListFeature<T> => {
  const mode: SelectionMode = config?.mode ?? "single";
  const followFocus = config?.followFocus ?? false;
  const initial = config?.initial;
  const shiftArrowToggle = config?.shiftArrowToggle ?? "origin";

  // Selection state — lives for the lifetime of the list
  let selectionState = createSelectionState(initial);
  let liveRegion: HTMLDivElement | null = null;

  // Last-selected index — tracks the index of the most recently selected item.
  // Used as the anchor for Shift+Space range selection and Shift+click range.
  // Updated when: Space toggles an item, Shift+Arrow toggles an item, or a
  // click selects an item.
  let lastSelectedIndex = -1;

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
      "selectNext",
      "selectPrevious",
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
        ctx.methods.set("selectNext", () => {});
        ctx.methods.set("selectPrevious", () => {});
        return;
      }

      // ── Add selectable CSS class ──
      dom.root.classList.add(`${classPrefix}--selectable`);

      // ── Group header awareness ──
      // When withGroups is active (priority 10, runs before us at 50),
      // it registers _isGroupHeader. Resolve once at setup time.
      const isGroupHeaderFn = ctx.methods.get("_isGroupHeader") as
        | ((index: number) => boolean)
        | undefined;

      /** Check whether a layout index is a group header */
      const isHeader = (index: number): boolean =>
        isGroupHeaderFn ? isGroupHeaderFn(index) : false;

      /**
       * Starting from `from`, scan in `dir` (+1 or -1) to find the first
       * non-header index. Returns `from` unchanged when groups aren't active.
       * Falls back to the opposite direction if all items in `dir` are headers.
       */
      const skipHeaders = (from: number, dir: 1 | -1, total: number): number => {
        if (!isGroupHeaderFn) return from;
        let i = from;
        while (i >= 0 && i < total) {
          if (!isHeader(i)) return i;
          i += dir;
        }
        // Went out of bounds — try opposite direction
        i = from - dir;
        while (i >= 0 && i < total) {
          if (!isHeader(i)) return i;
          i -= dir;
        }
        return from; // all headers (shouldn't happen)
      };

      // ── ID → index map for O(1) lookups (selection feature only) ──
      // Incrementally indexed: items are added as they load via the load:end
      // event, avoiding a full 0..total scan that would generate millions of
      // placeholders when using sparse/async data.
      const idToIndexMap = new Map<string | number, number>();

      const rebuildIdIndex = (): void => {
        idToIndexMap.clear();
        const total = ctx.dataManager.getTotal();
        const cached = ctx.dataManager.getCached();

        // Nothing cached — skip entirely (common for async data at setup)
        if (cached === 0) return;

        // Fast path: all items are in memory (SimpleDataManager or fully cached).
        // Safe to iterate 0..total without placeholder overhead.
        if (cached >= total) {
          for (let i = 0; i < total; i++) {
            const item = ctx.dataManager.getItem(i);
            if (item) idToIndexMap.set(item.id, i);
          }
          return;
        }

        // Sparse path: only a fraction of items are loaded. Iterate via
        // storage loaded ranges to avoid an O(total) scan that would touch
        // millions of unloaded indices and generate placeholder objects.
        const storage = ctx.dataManager.getStorage();
        if (storage && typeof (storage as any).getLoadedRanges === "function") {
          const ranges = (storage as any).getLoadedRanges() as Array<{ start: number; end: number }>;
          for (const range of ranges) {
            for (let i = range.start; i <= range.end; i++) {
              const item = ctx.dataManager.getItem(i);
              if (item && !(item as any)._isPlaceholder) {
                idToIndexMap.set(item.id, i);
              }
            }
          }
        }
      };

      // Rebuild index and clean selection after data mutations (removeItem).
      // Without this, idToIndexMap holds stale indices after items shift,
      // causing getSelectedItems() to return wrong items.
      emitter.on("data:change", ({ type, id }) => {
        if (type === "remove") {
          // Remove the deleted id from selection state
          selectionState.selected.delete(id);

          // Rebuild index — all indices after the removed item shifted
          rebuildIdIndex();
        }
      });

      // Incrementally index newly loaded items via load:end event.
      // Items arrive in small batches (25-50) with a known offset, so
      // indexing is O(batch_size) — no scanning required.
      emitter.on(
        "load:end",
        ({ items: loadedItems, offset }: { items: T[]; offset?: number }) => {
          if (!loadedItems || loadedItems.length === 0) return;

          if (offset !== undefined) {
            // Fast path: offset known — direct index assignment
            for (let i = 0; i < loadedItems.length; i++) {
              const item = loadedItems[i];
              if (item && item.id !== undefined) {
                idToIndexMap.set(item.id, offset + i);
              }
            }
          } else {
            // Fallback: no offset (e.g. SimpleDataManager) — full rebuild
            rebuildIdIndex();
          }
        },
      );

      // Build initial index (no-op when nothing is cached yet, e.g. async)
      rebuildIdIndex();

      // ── Register internal getters for renderer integration ──
      // These allow the core/grid/masonry renderers to read real selection
      // state directly, instead of receiving EMPTY_ID_SET and having this
      // feature overwrite classes via querySelectorAll after every frame.
      //
      // The getters return live references — no allocation per frame.
      // Renderers resolve these once (lazily, on first render) and cache
      // the function reference.
      ctx.methods.set("_getSelectedIds", (): Set<string | number> => {
        return selectionState.selected;
      });

      ctx.methods.set("_getFocusedIndex", (): number => {
        return selectionState.focusVisible ? selectionState.focusedIndex : -1;
      });

      // ── Capture force render for triggering re-renders on selection change ──
      // We do NOT wrap renderIfNeeded — the renderers now read our state
      // directly via the getters above. We only need forceRender to trigger
      // a full re-render when selection state changes (click, API call).
      const { forceRender: capturedForceRender } = ctx.getRenderFns();

      // ── Helper: force render + emit selection change ──
      const forceRenderAndEmit = (): void => {
        // Force render — renderers will pick up the new selection state
        // via _getSelectedIds / _getFocusedIndex getters
        capturedForceRender();

        // O(1) lookup using ID → index map
        const getItemByIdFn = (id: string | number): T | undefined => {
          const index = idToIndexMap.get(id);
          if (index === undefined) return undefined;
          return ctx.dataManager.getItem(index);
        };

        emitter.emit("selection:change", {
          selected: getSelectedIds(selectionState),
          items: getSelectedItems(selectionState, getItemByIdFn),
        });
      };

      // ── Helper: scroll just enough to reveal the focused item ──
      // Resolve padding once (start/end along main axis).
      const resolvedPad = resolvePadding(ctx.rawConfig.padding);
      const startPadding = resolvedConfig.horizontal ? resolvedPad.left : resolvedPad.top;
      const endPadding = resolvedConfig.horizontal ? resolvedPad.right : resolvedPad.bottom;

      // Resolve item-to-scroll-index mapping once (identity for lists,
      // floor(index/columns) for grids where sizeCache is in row-space).
      const itemToScrollIndex = ctx.getItemToScrollIndexFn();

      // ── 2D navigation hints (set by withGrid/withMasonry via ctx.methods) ──
      // Resolved lazily so the layout feature (priority 10) has time to register.
      // cols = column count for row-aware Home/End (0 = flat list)
      // _navigate = custom navigation fn (masonry) — overrides _getNavDelta
      // _scrollItemIntoView = placement-based scroll (masonry)
      let navDeltaFn: (() => { ud: number; lr: number; cols: number }) | null = null;
      let navigateFn: ((currentIndex: number, key: string, total: number) => number) | null = null;
      let scrollItemIntoViewFn: ((index: number) => void) | null = null;
      let navHintsResolved = false;

      const resolveNavHints = (): void => {
        if (navHintsResolved) return;
        navHintsResolved = true;
        navDeltaFn = (ctx.methods.get("_getNavDelta") as (() => { ud: number; lr: number; cols: number })) ?? null;
        navigateFn = (ctx.methods.get("_navigate") as ((currentIndex: number, key: string, total: number) => number)) ?? null;
        scrollItemIntoViewFn = (ctx.methods.get("_scrollItemIntoView") as ((index: number) => void)) ?? null;
      };

      const navDelta = (): { ud: number; lr: number; cols: number } => {
        resolveNavHints();
        return navDeltaFn ? navDeltaFn() : { ud: 1, lr: 0, cols: 0 };
      };

      const scrollToFocus = (idx: number): void => {
        if (idx < 0) return;
        resolveNavHints();

        if (scrollItemIntoViewFn) {
          // Placement-based scroll (masonry) — the feature owns its own
          // coordinate system; the core size cache has no meaningful offsets.
          scrollItemIntoViewFn(idx);
        } else {
          // Size-cache-based scroll (flat list / grid).
          const containerSize = ctx.state.viewportState.containerSize;
          const scrollPos = ctx.state.viewportState.scrollPosition;
          const totalItems = ctx.dataManager.getTotal();
          const compression = ctx.getCachedCompression();
          const { visibleRange } = ctx.state.viewportState;

          // Convert flat item index → size-cache index (row index for grids)
          const scrollIdx = itemToScrollIndex(idx);

          const newScroll = sharedScrollToFocus(
            scrollIdx,
            ctx.sizeCache,
            scrollPos,
            containerSize,
            startPadding,
            endPadding,
            compression,
            totalItems,
            visibleRange,
          );

          if (newScroll !== scrollPos) {
            ctx.scrollController.scrollTo(ctx.adjustScrollPosition(newScroll));
          }
        }
      };

      // ── Helper: page size in items for PageUp/Down ──
      // In grid mode the size cache is indexed by row, so convert via
      // itemToScrollIndex before lookup, then scale by ud (columns) so
      // the jump covers a full page of rows.
      const getPageSize = (): number => {
        const scrollIdx = itemToScrollIndex(Math.max(0, selectionState.focusedIndex));
        const h = ctx.sizeCache.getSize(scrollIdx);
        const { ud } = navDelta();
        return Math.max(ud, Math.floor(ctx.state.viewportState.containerSize / h) * ud);
      };


      // ── ARIA live region ──
      liveRegion = document.createElement("div");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("aria-atomic", "true");
      liveRegion.className = `${classPrefix}-live-region`;
      liveRegion.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";

      // When inside a grid (withTable), the live region must sit outside the
      // grid root — role="grid" only allows row/rowgroup children.
      // Append to the user's container element instead.
      const liveParent = dom.root.getAttribute("role") === "grid"
        ? dom.root.parentElement ?? dom.root
        : dom.root;
      liveParent.appendChild(liveRegion);

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

      // ── Focus & keyboard handlers (skipped when interactive: false) ──
      // Uses :focus-visible to detect keyboard focus — no extra listeners needed.
      const onFocusIn = (): void => {
        if (ctx.state.isDestroyed) return;
        if (!dom.root.matches(":focus-visible")) return;

        const totalItems = ctx.dataManager.getTotal();
        if (totalItems === 0) return;

        // Restore previous focus position, or start at 0
        let idx =
          selectionState.focusedIndex >= 0
            ? Math.min(selectionState.focusedIndex, totalItems - 1)
            : 0;

        // Skip group headers
        idx = skipHeaders(idx, 1, totalItems);

        selectionState = setFocusedIndex(selectionState, idx);
        selectionState.focusVisible = true;

        dom.root.setAttribute(
          "aria-activedescendant",
          `${ariaIdPrefix}-item-${idx}`,
        );

        scrollToFocus(idx);

        const item = ctx.dataManager.getItem(idx);
        if (item) {
          ctx.renderer.updateItemClasses(
            idx,
            selectionState.selected.has(item.id),
            true,
          );
        }
      };

      if (resolvedConfig.interactive) dom.root.addEventListener("focusin", onFocusIn);

      // ── Blur handler — clear focus ring when focus leaves the list ──
      const onFocusOut = (e: FocusEvent): void => {
        if (ctx.state.isDestroyed) return;

        // If the new focus target is still inside the root, ignore
        const related = e.relatedTarget as Node | null;
        if (related && dom.root.contains(related)) return;

        // Clear the visual focus ring
        const prevIdx = selectionState.focusedIndex;
        selectionState.focusVisible = false;

        dom.root.removeAttribute("aria-activedescendant");

        // Remove the focused class from the previously focused item
        if (prevIdx >= 0) {
          const prevItem = ctx.dataManager.getItem(prevIdx);
          if (prevItem) {
            ctx.renderer.updateItemClasses(
              prevIdx,
              selectionState.selected.has(prevItem.id),
              false,
            );
          }
        }
      };

      if (resolvedConfig.interactive) dom.root.addEventListener("focusout", onFocusOut);

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

        // Ignore clicks on group headers
        if (isHeader(index)) return;

        // Emit click event
        emitter.emit("item:click", { item, index, event });

        // Shift+click range selection (multiple mode only)
        if (mode === "multiple" && event.shiftKey && selectionState.focusedIndex >= 0) {
          // Use lastSelectedIndex as anchor, fall back to current focus
          const anchor = lastSelectedIndex >= 0 ? lastSelectedIndex : selectionState.focusedIndex;
          const items = ctx.getAllLoadedItems();
          selectionState = selectRange(selectionState, items, anchor, index, mode);
          selectionState = setFocusedIndex(selectionState, index);
          selectionState.focusVisible = false;
          lastSelectedIndex = index;
          dom.root.setAttribute(
            "aria-activedescendant",
            `${ariaIdPrefix}-item-${index}`,
          );
          forceRenderAndEmit();
          return;
        }

        // Update lastSelectedIndex on non-shift click
        lastSelectedIndex = index;

        // Update focused index (mouse — no focus ring)
        selectionState = setFocusedIndex(selectionState, index);
        selectionState.focusVisible = false;

        // ARIA: update aria-activedescendant
        dom.root.setAttribute(
          "aria-activedescendant",
          `${ariaIdPrefix}-item-${index}`,
        );

        // Toggle selection
        selectionState = toggleSelection(selectionState, item.id, mode);

        // Re-render with new selection state + emit
        forceRenderAndEmit();
      });

      // ── Keyboard handler (skipped when interactive: false) ──
      if (resolvedConfig.interactive) ctx.keydownHandlers.push((event: KeyboardEvent): void => {
        if (ctx.state.isDestroyed) return;

        const totalItems = ctx.dataManager.getTotal();
        const previousFocusIndex = selectionState.focusedIndex;

        let handled = false;
        let focusOnly = false;
        let newState = selectionState;

        // Check for custom navigation function (masonry)
        resolveNavHints();

        if (navigateFn) {
          // ── Custom navigation (masonry): the feature handles all directional keys ──
          switch (event.key) {
            case "ArrowUp":
            case "ArrowDown":
            case "ArrowLeft":
            case "ArrowRight":
            case "PageUp":
            case "PageDown":
            case "Home":
            case "End": {
              const newIndex = navigateFn(selectionState.focusedIndex, event.key, totalItems);
              if (newIndex !== selectionState.focusedIndex) {
                newState = setFocusedIndex(selectionState, newIndex);
                newState.focusVisible = true;
                handled = true;
                focusOnly = true;
              } else {
                // No movement — still prevent default but skip render
                event.preventDefault();
                return;
              }
              break;
            }
          }
        }

        // ── Delta-based navigation (grid / flat list) — skip if _navigate handled it ──
        if (!handled) switch (event.key) {
          case "ArrowUp":
            newState = moveFocusUp(selectionState, totalItems, resolvedConfig.wrap, navDelta().ud);
            newState.focusVisible = true;
            handled = true;
            focusOnly = true;
            break;

          case "ArrowDown":
            newState = moveFocusDown(selectionState, totalItems, resolvedConfig.wrap, navDelta().ud);
            newState.focusVisible = true;
            handled = true;
            focusOnly = true;
            break;

          case "ArrowLeft": {
            const { lr } = navDelta();
            if (lr) {
              newState = moveFocusUp(selectionState, totalItems, resolvedConfig.wrap, lr);
              newState.focusVisible = true;
              handled = true;
              focusOnly = true;
            }
            break;
          }

          case "ArrowRight": {
            const { lr } = navDelta();
            if (lr) {
              newState = moveFocusDown(selectionState, totalItems, resolvedConfig.wrap, lr);
              newState.focusVisible = true;
              handled = true;
              focusOnly = true;
            }
            break;
          }

          case "PageUp":
            newState = moveFocusByPage(selectionState, totalItems, getPageSize(), "up");
            newState.focusVisible = true;
            handled = true;
            focusOnly = true;
            break;

          case "PageDown":
            newState = moveFocusByPage(selectionState, totalItems, getPageSize(), "down");
            newState.focusVisible = true;
            handled = true;
            focusOnly = true;
            break;

          case "Home": {
            newState = moveFocusToFirst(selectionState, totalItems);
            newState.focusVisible = true;
            handled = true;
            focusOnly = true;
            break;
          }

          case "End": {
            newState = moveFocusToLast(selectionState, totalItems);
            newState.focusVisible = true;
            handled = true;
            focusOnly = true;
            break;
          }
        }

        switch (event.key) {
          case " ":
          case "Enter":
            // Shift+Space: range select from lastSelectedIndex to focused (ARIA model)
            if (event.key === " " && event.shiftKey && mode === "multiple" && selectionState.focusedIndex >= 0) {
              if (lastSelectedIndex >= 0) {
                const items = ctx.getAllLoadedItems();
                newState = selectRange(newState, items, lastSelectedIndex, selectionState.focusedIndex, mode);
              }
              newState.focusVisible = true;
              handled = true;
              break;
            }
            // Regular Space/Enter: toggle selection of focused item
            if (selectionState.focusedIndex >= 0 && !isHeader(selectionState.focusedIndex)) {
              const focusedItem = ctx.dataManager.getItem(
                selectionState.focusedIndex,
              );
              if (focusedItem) {
                newState = toggleSelection(
                  selectionState,
                  focusedItem.id,
                  mode,
                );
                newState.focusVisible = true;
              }
              lastSelectedIndex = selectionState.focusedIndex;
              handled = true;
            }
            break;

          case "a":
            if ((event.ctrlKey || event.metaKey) && mode === "multiple") {
              const allItems = ctx.getAllLoadedItems();
              // If all selected, deselect all; otherwise select all
              if (selectionState.selected.size === allItems.length) {
                newState = clearSelection(newState);
              } else {
                newState = selectAll(newState, allItems, mode);
              }
              newState.focusVisible = true;
              handled = true;
              focusOnly = false;
            }
            break;
        }

        // Skip group headers after directional movement
        if (focusOnly && isGroupHeaderFn) {
          const dir: 1 | -1 = newState.focusedIndex > previousFocusIndex ? 1 : -1;
          newState.focusedIndex = skipHeaders(newState.focusedIndex, dir, totalItems);
        }

        // ── Shift+Arrow: toggle destination item (ARIA recommended model) ──
        // ── Ctrl+Shift+Home/End: select range to first/last ──
        if (event.shiftKey && mode === "multiple" && focusOnly && newState.focusedIndex >= 0) {
          const isArrow = event.key === "ArrowUp" || event.key === "ArrowDown"
            || event.key === "ArrowLeft" || event.key === "ArrowRight";
          const isCtrlHomeEnd = (event.ctrlKey || event.metaKey)
            && (event.key === "Home" || event.key === "End");

          if (isArrow) {
            if (shiftArrowToggle === "origin") {
              // Toggle the item being left (macOS-style)
              if (previousFocusIndex >= 0) {
                const originItem = ctx.dataManager.getItem(previousFocusIndex);
                if (originItem) {
                  newState = toggleSelection(newState, originItem.id, mode);
                }
              }
            } else {
              // Toggle the item being moved to (ARIA recommended model)
              const destItem = ctx.dataManager.getItem(newState.focusedIndex);
              if (destItem) {
                newState = toggleSelection(newState, destItem.id, mode);
              }
            }
            lastSelectedIndex = newState.focusedIndex;
            focusOnly = false; // trigger full re-render + selection:change event
          } else if (isCtrlHomeEnd) {
            // Ctrl+Shift+Home/End: select from previous focus to first/last item
            const items = ctx.getAllLoadedItems();
            const anchor = previousFocusIndex >= 0 ? previousFocusIndex : newState.focusedIndex;
            newState = selectRange(newState, items, anchor, newState.focusedIndex, mode);
            lastSelectedIndex = newState.focusedIndex;
            focusOnly = false; // trigger full re-render + selection:change event
          }
          // Shift+Page/Home/End (without Ctrl): just move focus, no selection change
        }

        // Optional: selection follows focus on arrow/page/home/end keys
        if (followFocus && mode === "single" && focusOnly && newState.focusedIndex >= 0) {
          const focusedItem = ctx.dataManager.getItem(newState.focusedIndex);
          if (focusedItem) {
            newState = selectItems(newState, [focusedItem.id], mode);
          }
          focusOnly = false; // trigger full re-render with selection change event
        }

        if (handled) {
          event.preventDefault();
          selectionState = newState;

          const newFocusIndex = selectionState.focusedIndex;

          // Scroll focused item into view (smart scroll) + ARIA
          if (newFocusIndex >= 0) {
            scrollToFocus(newFocusIndex);

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
            forceRenderAndEmit();
          }
        }
      });

      // ── Register public methods ──
      ctx.methods.set("select", (...ids: Array<string | number>): void => {
        selectionState = selectItems(selectionState, ids, mode);
        forceRenderAndEmit();
      });

      ctx.methods.set("deselect", (...ids: Array<string | number>): void => {
        selectionState = deselectItems(selectionState, ids);
        forceRenderAndEmit();
      });

      ctx.methods.set("toggleSelect", (id: string | number): void => {
        selectionState = toggleSelection(selectionState, id, mode);
        forceRenderAndEmit();
      });

      ctx.methods.set("selectAll", (): void => {
        if (mode !== "multiple") return;
        const allItems = ctx.getAllLoadedItems();
        selectionState = selectAll(selectionState, allItems, mode);
        rebuildIdIndex(); // Ensure index is current
        forceRenderAndEmit();
      });

      ctx.methods.set("clearSelection", (): void => {
        selectionState = clearSelection(selectionState);
        forceRenderAndEmit();
      });

      ctx.methods.set("getSelected", (): Array<string | number> => {
        return getSelectedIds(selectionState);
      });

      ctx.methods.set("getSelectedItems", (): T[] => {
        // O(1) lookup using ID → index map
        const getItemByIdFn = (id: string | number): T | undefined => {
          const index = idToIndexMap.get(id);
          return index === undefined ? undefined : ctx.dataManager.getItem(index);
        };
        return getSelectedItems(selectionState, getItemByIdFn);
      });

      // ── Shared helper: move focus + select + scroll-if-needed + emit ──
      const moveFocusAndSelect = (direction: "next" | "previous"): void => {
        const totalItems = ctx.dataManager.getTotal();
        if (totalItems === 0) return;

        resolveNavHints();
        if (navigateFn) {
          const key = direction === "next" ? "ArrowDown" : "ArrowUp";
          const newIndex = navigateFn(selectionState.focusedIndex, key, totalItems);
          selectionState = setFocusedIndex(selectionState, newIndex);
        } else {
          const { ud } = navDelta();
          selectionState = direction === "next"
            ? moveFocusDown(selectionState, totalItems, resolvedConfig.wrap, ud)
            : moveFocusUp(selectionState, totalItems, resolvedConfig.wrap, ud);
        }

        // Skip group headers
        const dir: 1 | -1 = direction === "next" ? 1 : -1;
        selectionState.focusedIndex = skipHeaders(selectionState.focusedIndex, dir, totalItems);

        const idx = selectionState.focusedIndex;
        const item = ctx.dataManager.getItem(idx);
        if (!item) return;

        selectionState = selectItems(selectionState, [item.id], mode);

        scrollToFocus(idx);

        forceRenderAndEmit();
      };

      ctx.methods.set("selectNext", (): void => {
        moveFocusAndSelect("next");
      });

      ctx.methods.set("selectPrevious", (): void => {
        moveFocusAndSelect("previous");
      });

      // ── Cleanup handler ──
      ctx.destroyHandlers.push(() => {
        if (liveRef && liveRef.parentNode) {
          liveRef.remove();
        }
        dom.root.removeEventListener("focusin", onFocusIn);
        dom.root.removeEventListener("focusout", onFocusOut);
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
