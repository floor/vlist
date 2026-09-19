/**
 * vlist — Selection Plugin
 *
 * Manages selection state, click/keyboard handlers, ARIA attributes.
 * Adapted from v1 withSelection feature + a11y.ts to the v2 plugin interface.
 */

import type { VListItem, SelectionMode } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { SizeCache } from "../../core/sizes";
import type { EngineState } from "../../core/state";
import {
  createSelectionState,
  moveFocus,
  getSelectedArray,
  claimPlaceholderSelection,
  type SelectionState,
} from "./state";
import { PLACEHOLDER_ID_PREFIX } from "../../constants";
import { clampPageTarget } from "../../utils/grid-nav";

// =============================================================================
// Config
// =============================================================================

export interface SelectionPluginConfig {
  mode?: SelectionMode;
  initial?: Array<string | number>;
  followFocus?: boolean;
  focusOnClick?: boolean;
  /**
   * Whether this plugin handles arrow/Home/End/PageUp-Down/Enter/Space
   * keyboard navigation. Default true. Set false to keep click-selection and
   * the selection model while letting an outer system own keyboard navigation
   * (e.g. a global, focus-independent hotkey layer).
   */
  keyboard?: boolean;
}

// =============================================================================
// Factory
// =============================================================================

const focusPreventScroll = { preventScroll: true };

/** Methods the selection plugin adds to the list instance. */
export interface SelectionMethods<T extends VListItem = VListItem> {
  /** Select one or more items by id. Does not move the viewport. */
  select(...ids: Array<string | number>): void;
  /** Deselect one or more items by id. */
  deselect(...ids: Array<string | number>): void;
  /** Toggle one item by id. */
  toggleSelect(id: string | number): void;
  /** Select every item (multiple mode only). */
  selectAll(): void;
  /** Clear the selection. */
  clearSelection(): void;
  /** Ids of the selected items. */
  getSelected(): Array<string | number>;
  /** The selected items. */
  getSelectedItems(): T[];
  /** Select the next item and scroll it into view. `select(id)` selects without moving the viewport. */
  selectNext(): void;
  /** Select the previous item and scroll it into view. `select(id)` selects without moving the viewport. */
  selectPrevious(): void;
}

export function selection<T extends VListItem = VListItem>(
  config?: SelectionPluginConfig,
): VListPlugin<T, SelectionMethods<T>> {
  const mode: SelectionMode = config?.mode ?? "single";
  const followFocus = config?.followFocus ?? false;
  const focusOnClick = config?.focusOnClick ?? false;
  const keyboard = config?.keyboard ?? true;

  let state: SelectionState;
  let getItems: () => readonly T[];
  let forceRender: () => void;
  let emitter: PluginContext<T>["emitter"];
  let dom: PluginContext<T>["dom"];
  let sizeCache: SizeCache;
  let engineState: EngineState;
  let scrollTo: (pos: number) => void;
  let lastSelectedIndex = -1;

  const selectedItemCache = new Map<string | number, T>();

  let l2dFn: ((i: number) => number) | null = null;
  let d2lFn: ((i: number) => number) | null = null;
  let isGHFn: ((i: number) => boolean) | null = null;
  let sivFn: ((i: number) => void) | null = null;
  let getTotalFn: () => number;
  // getTotalFn is a layout-space bound: it walks focus across entries, so with
  // groups it counts headers too. Questions of the form "how many items are
  // there" need the data total instead — the engine's count is render-space,
  // and carousel inflates it to three laps. Plugins that know better publish
  // _getTotal; with none, the two spaces coincide.
  let getDataTotalFn: () => number;
  let resolved = false;

  function resolveOnce(ctx: PluginContext<T>): void {
    if (resolved) return;
    resolved = true;
    l2dFn = (ctx.hooks.get("_layoutToDataIndex") as typeof l2dFn) ?? null;
    d2lFn = (ctx.hooks.get("_dataToLayoutIndex") as typeof d2lFn) ?? null;
    isGHFn = (ctx.hooks.get("_isGroupHeader") as typeof isGHFn) ?? null;
    sivFn = (ctx.hooks.get("_scrollItemIntoView") as typeof sivFn) ?? null;
    loadedItemFn = (ctx.hooks.get("_getLoadedItem") as typeof loadedItemFn) ?? null;
    const dataTotal = ctx.hooks.get("_getTotal") as (() => number) | undefined;
    if (dataTotal) getDataTotalFn = dataTotal;
    const gl = ctx.hooks.get("getGroupLayout") as (() => { totalEntries: number }) | undefined;
    if (gl) {
      const layout = gl();
      getTotalFn = () => layout.totalEntries;
    }
  }

  const toDataIndex = (layoutIdx: number): number =>
    l2dFn ? l2dFn(layoutIdx) : layoutIdx;

  let loadedItemFn: ((i: number) => T | undefined) | null = null;
  const getItemByDataIndex = (dataIndex: number): T | undefined => {
    if (loadedItemFn) return loadedItemFn(dataIndex);
    return getItems()[dataIndex];
  };

  const getDataItemAtLayout = (layoutIdx: number): T | undefined => {
    const di = toDataIndex(layoutIdx);
    return di >= 0 ? getItemByDataIndex(di) : undefined;
  };

  const skipHeaders = (from: number, dir: 1 | -1, total: number): number => {
    if (!isGHFn) return from;
    let i = from;
    while (i >= 0 && i < total) {
      if (!isGHFn(i)) return i;
      i += dir;
    }
    i = from - dir;
    while (i >= 0 && i < total) {
      if (!isGHFn(i)) return i;
      i -= dir;
    }
    return from;
  };

  // ── Selection mutations (keep Set + item cache in sync) ────────

  function doSelect(id: string | number, item?: T): void {
    if (mode === "single") {
      state.selected.clear();
      selectedItemCache.clear();
    }
    state.selected.add(id);
    if (item) selectedItemCache.set(id, item);
  }

  function doToggle(id: string | number, item?: T): void {
    if (state.selected.has(id)) {
      state.selected.delete(id);
      selectedItemCache.delete(id);
    } else {
      doSelect(id, item);
    }
  }

  function doClear(): void {
    state.selected.clear();
    selectedItemCache.clear();
  }

  function doDeselect(id: string | number): void {
    state.selected.delete(id);
    selectedItemCache.delete(id);
  }

  function doSelectRange(fromLayout: number, toLayout: number): void {
    const start = Math.min(fromLayout, toLayout);
    const end = Math.max(fromLayout, toLayout);
    for (let i = start; i <= end; i++) {
      if (isGHFn?.(i)) continue;
      const item = getDataItemAtLayout(i);
      if (item) {
        state.selected.add(item.id);
        selectedItemCache.set(item.id, item);
      } else if (loadedItemFn) {
        const di = toDataIndex(i);
        if (di >= 0) state.selected.add(PLACEHOLDER_ID_PREFIX + di);
      }
    }
  }

  function doSelectAll(): void {
    // Layout space: this walks entries and skips headers, so it needs the
    // layout count. The engine's total is not it under groups — with ten items
    // in two groups this looped to ten and stopped two entries short, quietly
    // selecting eight.
    const total = getTotalFn();
    for (let i = 0; i < total; i++) {
      if (isGHFn?.(i)) continue;
      const item = getDataItemAtLayout(i);
      if (item) {
        state.selected.add(item.id);
        selectedItemCache.set(item.id, item);
      } else if (loadedItemFn) {
        const di = toDataIndex(i);
        if (di >= 0) state.selected.add(PLACEHOLDER_ID_PREFIX + di);
      }
    }
  }

  function collectSelectedItems(): T[] {
    if (state.selected.size === 0) return [];

    if (selectedItemCache.size >= state.selected.size) {
      const result: T[] = [];
      for (const id of state.selected) {
        const item = selectedItemCache.get(id);
        if (item) result.push(item);
      }
      if (result.length === state.selected.size) return result;
    }

    const result: T[] = [];
    const remaining = new Set(state.selected);
    // Layout space, as in doSelectAll.
    const total = getTotalFn();
    for (let i = 0; i < total && remaining.size > 0; i++) {
      if (isGHFn?.(i)) continue;
      const item = getDataItemAtLayout(i);
      if (item && remaining.has(item.id)) {
        result.push(item);
        selectedItemCache.set(item.id, item);
        remaining.delete(item.id);
      }
    }
    return result;
  }

  function emitSelectionChange(): void {
    forceRender();
    emitter.emit("selection:change", {
      selected: getSelectedArray(state.selected),
      items: collectSelectedItems(),
    });
  }

  let hitItem: T | null = null;
  let hitIndex = -1;

  return {
    name: "selection",
    priority: 50,

    setup(ctx: PluginContext<T>): void {
      state = createSelectionState(config?.initial);
      getItems = ctx.items.all.bind(ctx);
      forceRender = ctx.render.force.bind(ctx);
      emitter = ctx.emitter;
      dom = ctx.dom;
      const resolvedConfig = ctx.config;
      sizeCache = ctx.sizes.cache;
      engineState = ctx.getState();
      scrollTo = ctx.scroll.to.bind(ctx);
      getTotalFn = () => engineState.totalItems;
      getDataTotalFn = () => engineState.totalItems;

      if (mode === "none") {
        ctx.hooks.method("select", () => {});
        ctx.hooks.method("deselect", () => {});
        ctx.hooks.method("toggleSelect", () => {});
        ctx.hooks.method("selectAll", () => {});
        ctx.hooks.method("clearSelection", () => {});
        ctx.hooks.method("getSelected", () => []);
        ctx.hooks.method("getSelectedItems", () => []);
        ctx.hooks.method("selectNext", () => {});
        ctx.hooks.method("selectPrevious", () => {});
        ctx.hooks.method("_seedSelection", () => {});
        ctx.hooks.method("_getFocusedId", () => undefined);
        ctx.hooks.method("_focusById", () => {});
        return;
      }

      // Past the "none" early return: a list with no selection semantics is not
      // a listbox. Claiming the role there put the list in the tab order and
      // announced every item as an option, with no keyboard handler behind it.
      ctx.dom.enableListbox();

      const classPrefix = resolvedConfig.classPrefix;

      ctx.render.setStateFn((index: number, is: { selected: boolean; focused: boolean }): void => {
        resolveOnce(ctx);
        if (state.selected.size > 0) {
          const di = toDataIndex(index);
          const item = di >= 0 ? getDataItemAtLayout(index) : undefined;
          const id = item?.id;
          if (id !== undefined) {
            if (state.selected.has(id)) {
              is.selected = true;
            } else if (claimPlaceholderSelection(state.selected, di, id)) {
              is.selected = true;
              selectedItemCache.delete(PLACEHOLDER_ID_PREFIX + di);
              selectedItemCache.set(id, item as T);
            } else {
              is.selected = false;
            }
          } else {
            is.selected = loadedItemFn !== null && di >= 0 && state.selected.has(PLACEHOLDER_ID_PREFIX + di);
          }
        } else {
          is.selected = false;
        }
        is.focused = state.focusVisible && state.focusedIndex === index;
      });

      ctx.hooks.method("_getSelectedIds", (): Set<string | number> => state.selected);
      ctx.hooks.method("_getFocusedIndex", (): number => state.focusVisible ? state.focusedIndex : -1);

      dom.root.classList.add(`${classPrefix}--selectable`);

      // ── Helpers ────────────────────────────────────────────────

      const findItemFromEvent = (event: MouseEvent): boolean => {
        hitItem = null;
        hitIndex = -1;
        const el = (event.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
        if (!el) return false;
        const layoutIdx = parseInt(el.dataset.index ?? "-1", 10);
        if (layoutIdx < 0) return false;
        if (isGHFn?.(layoutIdx)) return false;
        const di = toDataIndex(layoutIdx);
        if (di < 0) return false;
        const item = getDataItemAtLayout(layoutIdx);
        if (!item) return false;
        hitItem = item;
        hitIndex = layoutIdx;
        return true;
      };

      let selGridGap = 0;
      const scrollFocusIntoView = (index: number): void => {
        if (index < 0) return;
        // writeScroll() commits the position; it does not stop an animation
        // already in flight. Cancel through the scroll owner even when this
        // item is already visible — otherwise the scheduled frames keep
        // running and carry the selection off-screen.
        ctx.scroll.cancel();
        if (sivFn) { sivFn(index); return; }
        if (!selGridGap) {
          const gapFn = ctx.hooks.get("_getRowGap") as (() => number) | undefined;
          selGridGap = gapFn ? gapFn() : 0;
        }
        const nav = ctx.nav.get();
        const ci = nav.scrollIndex ? nav.scrollIndex(index) : index;
        const offset = sizeCache.getOffset(ci);
        const size = sizeCache.getSize(ci) - selGridGap;
        const cs = engineState.containerSize;
        const sp = ctx.scroll.getPixelEquivalent();
        const sp0 = resolvedConfig.startPadding;
        const sp1 = resolvedConfig.endPadding;

        if (offset < sp) {
          scrollTo(offset);
        } else if (sp0 + offset + size + sp1 > sp + cs) {
          scrollTo(sp0 + offset + size + sp1 - cs);
        }
      };

      // ── Focus In/Out ──────────────────────────────────────────

      const setActiveDescendant = (index: number): void => {
        const all = dom.content.querySelectorAll(`[data-index="${index}"]`);
        let el: HTMLElement | null = null;
        for (let i = 0; i < all.length; i++) {
          const candidate = all[i] as HTMLElement;
          if (candidate.style.display !== "none") { el = candidate; break; }
        }
        if (!el && all.length > 0) el = all[0] as HTMLElement;
        dom.content.setAttribute("aria-activedescendant", el?.id ?? `${classPrefix}-item-${index}`);
      };

      const onFocusIn = (): void => {
        if (engineState.destroyed) return;
        resolveOnce(ctx);
        if (!dom.content.matches(":focus-visible") && !dom.root.matches(":focus-visible")) return;
        const t = getTotalFn();
        if (t === 0) return;
        let tgt = state.focusedIndex >= 0 ? Math.min(state.focusedIndex, t - 1) : 0;
        tgt = skipHeaders(tgt, 1, t);
        state.focusedIndex = tgt;
        state.focusVisible = true;
        setActiveDescendant(tgt);
        scrollFocusIntoView(tgt);
        forceRender();
      };
      dom.root.addEventListener("focusin", onFocusIn);

      const onFocusOut = (e: FocusEvent): void => {
        if (engineState.destroyed) return;
        const rel = e.relatedTarget as Node | null;
        if (rel && dom.root.contains(rel)) return;
        state.focusVisible = false;
        forceRender();
        dom.content.removeAttribute("aria-activedescendant");
      };
      dom.root.addEventListener("focusout", onFocusOut);

      ctx.hooks.onDestroy(() => {
        dom.root.removeEventListener("focusin", onFocusIn);
        dom.root.removeEventListener("focusout", onFocusOut);
      });

      // ── Click handler ─────────────────────────────────────────

      ctx.hooks.onClick((event: MouseEvent): void => {
        resolveOnce(ctx);
        if (!findItemFromEvent(event)) return;

        if (mode === "multiple" && event.shiftKey && state.focusedIndex >= 0) {
          const anchor = lastSelectedIndex >= 0 ? lastSelectedIndex : state.focusedIndex;
          const anchorData = toDataIndex(anchor);
          const hitData = toDataIndex(hitIndex);
          if (anchorData >= 0 && hitData >= 0) {
            doSelectRange(anchor, hitIndex);
          }
          state.focusedIndex = hitIndex;
          state.focusVisible = focusOnClick;
          lastSelectedIndex = hitIndex;
          emitSelectionChange();
          return;
        }

        state.focusedIndex = hitIndex;
        state.focusVisible = focusOnClick;
        lastSelectedIndex = hitIndex;
        const focusTarget = dom.content.getAttribute("tabindex") !== null ? dom.content : dom.root;
        focusTarget.focus(focusPreventScroll);
        if (mode === "single") {
          doSelect(hitItem!.id, hitItem!);
        } else {
          doToggle(hitItem!.id, hitItem!);
        }
        emitSelectionChange();
      });

      // ── Keyboard handler ──────────────────────────────────────
      // Skipped when keyboard:false — click-selection and the selection
      // model stay active, but arrow/Home/End/PageUp-Down/Enter/Space
      // navigation is left to an outer system (e.g. a global hotkey layer).

      if (keyboard) ctx.hooks.onKeydown((event: KeyboardEvent): void => {
          resolveOnce(ctx);
          const total = getTotalFn();
          if (total === 0) return;

          const nav = ctx.nav.get();
          const prevFocus = state.focusedIndex;
          let handled = false;
          let selectionChanged = false;

          if (nav.navigate && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End")) {
            const navTotal = nav.total ? nav.total() : total;
            const next = nav.navigate(state.focusedIndex, event.key, navTotal);
            if (next !== state.focusedIndex) {
              state.focusedIndex = Math.max(0, Math.min(next, navTotal - 1));
            }
            state.focusVisible = true;
            handled = true;
          } else switch (event.key) {
            case "ArrowUp": {
              const ud = nav.ud || 1;
              const lr = nav.lr;
              const isX = resolvedConfig.axis.primary === "x";
              if (isX && !lr) break;
              moveFocus(state, -(isX ? lr : ud), total, resolvedConfig.reverse);
              state.focusVisible = true;
              handled = true;
              break;
            }

            case "ArrowDown": {
              const ud = nav.ud || 1;
              const lr = nav.lr;
              const isX = resolvedConfig.axis.primary === "x";
              if (isX && !lr) break;
              moveFocus(state, isX ? lr : ud, total, resolvedConfig.reverse);
              state.focusVisible = true;
              handled = true;
              break;
            }

            case "ArrowLeft": {
              const ud = nav.ud || 1;
              const lr = nav.lr;
              const isX = resolvedConfig.axis.primary === "x";
              if (!isX && !lr) break;
              moveFocus(state, -(isX ? ud : lr), total, resolvedConfig.reverse);
              state.focusVisible = true;
              handled = true;
              break;
            }

            case "ArrowRight": {
              const ud = nav.ud || 1;
              const lr = nav.lr;
              const isX = resolvedConfig.axis.primary === "x";
              if (!isX && !lr) break;
              moveFocus(state, isX ? ud : lr, total, resolvedConfig.reverse);
              state.focusVisible = true;
              handled = true;
              break;
            }

            case "Home":
              if (total > 0) state.focusedIndex = 0;
              state.focusVisible = true;
              handled = true;
              break;

            case "End":
              if (total > 0) state.focusedIndex = total - 1;
              state.focusVisible = true;
              handled = true;
              break;

            case "PageUp":
            case "PageDown": {
              const ud = nav.ud || 1;
              const idx = Math.max(0, state.focusedIndex);
              const si = nav.scrollIndex ? nav.scrollIndex(idx) : idx;
              const rowH = sizeCache.getSize(si);
              const cs = engineState.containerSize;
              const visRows = rowH > 0 ? Math.max(1, Math.floor(cs / rowH)) : 10;
              const pageSize = visRows * ud;

              if (l2dFn && d2lFn) {
                const curData = l2dFn(state.focusedIndex);
                const step = event.key === "PageUp" ? -pageSize : pageSize;
                const maxData = getDataTotalFn() - 1;
                // Column-preserving clamp so PageUp/Down at the top/bottom row
                // stays in the same column rather than jumping to the corner
                // (Home/End). #60
                state.focusedIndex = d2lFn(
                  clampPageTarget(curData + step, curData, ud, maxData + 1),
                );
              } else {
                const target =
                  event.key === "PageUp"
                    ? state.focusedIndex - pageSize
                    : state.focusedIndex + pageSize;
                state.focusedIndex = clampPageTarget(target, state.focusedIndex, ud, total);
              }
              state.focusVisible = true;
              handled = true;
              break;
            }

            case " ":
            case "Enter":
              if (event.key === " " && event.shiftKey && mode === "multiple" && state.focusedIndex >= 0) {
                if (lastSelectedIndex >= 0) {
                  const fromData = toDataIndex(lastSelectedIndex);
                  const toData = toDataIndex(state.focusedIndex);
                  if (fromData >= 0 && toData >= 0) {
                    doSelectRange(lastSelectedIndex, state.focusedIndex);
                  }
                }
                state.focusVisible = true;
                selectionChanged = true;
                handled = true;
                break;
              }
              if (state.focusedIndex >= 0) {
                const item = getDataItemAtLayout(state.focusedIndex);
                if (item) {
                  doToggle(item.id, item);
                  lastSelectedIndex = state.focusedIndex;
                }
                state.focusVisible = true;
                selectionChanged = true;
                handled = true;
              }
              break;

            case "a":
              if ((event.ctrlKey || event.metaKey) && mode === "multiple") {
                if (state.selected.size === getDataTotalFn()) {
                  doClear();
                } else {
                  doSelectAll();
                }
                state.focusVisible = true;
                selectionChanged = true;
                handled = true;
              }
              break;

            case "Delete":
            case "Backspace":
              if (state.selected.size > 0) {
                emitter.emit("delete", {
                  selected: getSelectedArray(state.selected),
                  items: collectSelectedItems(),
                });
                handled = true;
              }
              break;
          }

          // Skip group headers before shift-selection uses focusedIndex
          if (state.focusedIndex !== prevFocus && isGHFn) {
            const dir: 1 | -1 = state.focusedIndex > prevFocus ? 1 : -1;
            state.focusedIndex = skipHeaders(state.focusedIndex, dir, total);
          }

          const focusMoved = state.focusedIndex !== prevFocus;

          // Shift+movement: extend selection
          if (event.shiftKey && mode === "multiple" && !selectionChanged && focusMoved) {
            const isArrow = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight";
            if (isArrow) {
              const destItem = getDataItemAtLayout(state.focusedIndex);
              if (destItem) doToggle(destItem.id, destItem);
              lastSelectedIndex = state.focusedIndex;
              selectionChanged = true;
            }

            const isCtrlHomeEnd = (event.ctrlKey || event.metaKey)
              && (event.key === "Home" || event.key === "End");
            if (isCtrlHomeEnd) {
              const fromLayout = prevFocus >= 0 ? prevFocus : state.focusedIndex;
              const fromData = toDataIndex(fromLayout);
              const toData = toDataIndex(state.focusedIndex);
              if (fromData >= 0 && toData >= 0) {
                doSelectRange(fromLayout, state.focusedIndex);
              }
              lastSelectedIndex = state.focusedIndex;
              selectionChanged = true;
            }
          }

          // Follow focus: auto-select on movement
          if (followFocus && mode === "single" && !selectionChanged && focusMoved && state.focusedIndex >= 0) {
            const item = getDataItemAtLayout(state.focusedIndex);
            if (item) doSelect(item.id, item);
            selectionChanged = true;
          }

          if (handled) {
            event.preventDefault();

            if (focusMoved && state.focusedIndex >= 0) {
              if (sivFn || !nav.navigate) scrollFocusIntoView(state.focusedIndex);
              setActiveDescendant(state.focusedIndex);
            }

            if (selectionChanged) {
              emitSelectionChange();
            } else if (focusMoved) {
              forceRender();
              if (state.focusedIndex >= 0) {
                const item = getDataItemAtLayout(state.focusedIndex);
                if (item) {
                  emitter.emit("focus:change", { id: item.id, index: state.focusedIndex });
                }
              }
            }
          }
      });

      // ── Public methods ────────────────────────────────────────

      ctx.hooks.method("select", (...ids: Array<string | number>): void => {
        for (const id of ids) doSelect(id);
        emitSelectionChange();
      });

      ctx.hooks.method("deselect", (...ids: Array<string | number>): void => {
        for (const id of ids) doDeselect(id);
        emitSelectionChange();
      });

      ctx.hooks.method("toggleSelect", (id: string | number): void => {
        doToggle(id);
        emitSelectionChange();
      });

      ctx.hooks.method("selectAll", (): void => {
        if (mode !== "multiple") return;
        resolveOnce(ctx);
        doSelectAll();
        emitSelectionChange();
      });

      ctx.hooks.method("clearSelection", (): void => {
        doClear();
        emitSelectionChange();
      });

      ctx.hooks.method("getSelected", (): Array<string | number> => {
        return getSelectedArray(state.selected);
      });

      ctx.hooks.method("getSelectedItems", (): T[] => {
        return collectSelectedItems();
      });

      const selectAdjacent = (delta: 1 | -1): void => {
        resolveOnce(ctx);
        const nav = ctx.nav.get();
        // Layout plugins that own the item space (carousel's real total,
        // grid's item count) publish nav.total. Without it this is layout
        // space — groups counts headers, then skipHeaders walks off them.
        // Using the engine total under carousel walked every lap and wrapped.
        const total = nav.total ? nav.total() : getTotalFn();
        if (total === 0) return;
        moveFocus(state, delta, total, resolvedConfig.reverse);
        if (isGHFn) state.focusedIndex = skipHeaders(state.focusedIndex, delta, total);
        const item = getDataItemAtLayout(state.focusedIndex);
        if (item) doSelect(item.id, item);
        // Selection first so a synchronous reveal render already has the
        // new selected state. Reveal is a layout-aware operation with one
        // owner: nav.reveal (carousel, current virtual lap, no wrap), else
        // _scrollItemIntoView (groups sticky header, masonry lanes), else
        // nearest-edge scrollFocusIntoView. Never nothing — and never skip
        // because nav.navigate exists; that helper is the keyboard path,
        // which these methods do not call.
        if (state.focusedIndex >= 0) {
          if (nav.reveal) nav.reveal(state.focusedIndex);
          else scrollFocusIntoView(state.focusedIndex);
          setActiveDescendant(state.focusedIndex);
        }
        emitSelectionChange();
      };

      ctx.hooks.method("selectNext", (): void => {
        selectAdjacent(1);
      });

      ctx.hooks.method("selectPrevious", (): void => {
        selectAdjacent(-1);
      });

      // ── Internal methods (used by snapshots, sortable) ────────

      ctx.hooks.method("_seedSelection", (ids: Array<string | number>): void => {
        if (mode === "single") {
          if (ids.length === 1) state.selected.add(ids[0]!);
        } else {
          for (const id of ids) state.selected.add(id);
        }
      });

      ctx.hooks.method("_isFollowFocus", (): boolean => followFocus);

      ctx.hooks.method("_getFocusedId", (): string | number | undefined => {
        if (state.focusedIndex < 0) return undefined;
        return getDataItemAtLayout(state.focusedIndex)?.id;
      });

      // `keyboard`: the caller moved focus because of a key press (tree's arrows,
      // Home, End, type-ahead). The ring then stays visible and the active
      // descendant follows, exactly as for this plugin's own key moves. Without
      // it the move was treated like a click: with the default `focusOnClick`
      // the ring vanished, `_getFocusedIndex` answered -1, and the tree ignored
      // every further Left/Right until an up/down key revived the focus.
      ctx.hooks.method("_focusById", (id: string | number, keyboard?: boolean): void => {
        // Layout space: it scans entries for the one holding this id.
        const total = getTotalFn();
        for (let i = 0; i < total; i++) {
          if (isGHFn?.(i)) continue;
          const item = getDataItemAtLayout(i);
          if (item && item.id === id) {
            state.focusedIndex = i;
            state.focusVisible = keyboard || focusOnClick;
            if (keyboard) setActiveDescendant(i);
            emitter.emit("focus:change", { id, index: i });
            return;
          }
        }
      });
    },

    destroy(): void {
      selectedItemCache.clear();
    },
  };
}
