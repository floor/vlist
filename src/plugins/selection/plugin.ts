/**
 * vlist v2 — Selection Plugin
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

export function selection<T extends VListItem = VListItem>(
  config?: SelectionPluginConfig,
): VListPlugin<T> {
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
  let resolved = false;

  function resolveOnce(ctx: PluginContext<T>): void {
    if (resolved) return;
    resolved = true;
    l2dFn = (ctx.getMethod("_layoutToDataIndex") as typeof l2dFn) ?? null;
    d2lFn = (ctx.getMethod("_dataToLayoutIndex") as typeof d2lFn) ?? null;
    isGHFn = (ctx.getMethod("_isGroupHeader") as typeof isGHFn) ?? null;
    sivFn = (ctx.getMethod("_scrollItemIntoView") as typeof sivFn) ?? null;
    loadedItemFn = (ctx.getMethod("_getLoadedItem") as typeof loadedItemFn) ?? null;
    const gl = ctx.getMethod("getGroupLayout") as (() => { totalEntries: number }) | undefined;
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
    const total = engineState.totalItems;
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
    const total = engineState.totalItems;
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
      ctx.enableListboxRole();
      state = createSelectionState(config?.initial);
      getItems = ctx.getItems.bind(ctx);
      forceRender = ctx.forceRender.bind(ctx);
      emitter = ctx.emitter;
      dom = ctx.dom;
      const resolvedConfig = ctx.config;
      sizeCache = ctx.sizeCache;
      engineState = ctx.getState();
      scrollTo = ctx.scrollTo.bind(ctx);
      getTotalFn = () => engineState.totalItems;

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
        ctx.registerMethod("_seedSelection", () => {});
        ctx.registerMethod("_getFocusedId", () => undefined);
        ctx.registerMethod("_focusById", () => {});
        return;
      }

      const classPrefix = resolvedConfig.classPrefix;

      ctx.setItemStateFn((index: number, is: { selected: boolean; focused: boolean }): void => {
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

      ctx.registerMethod("_getSelectedIds", (): Set<string | number> => state.selected);
      ctx.registerMethod("_getFocusedIndex", (): number => state.focusVisible ? state.focusedIndex : -1);

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
        if (sivFn) { sivFn(index); return; }
        if (!selGridGap) {
          const gapFn = ctx.getMethod("_getRowGap") as (() => number) | undefined;
          selGridGap = gapFn ? gapFn() : 0;
        }
        const nav = ctx.getNavConfig();
        const ci = nav.scrollIndex ? nav.scrollIndex(index) : index;
        const offset = sizeCache.getOffset(ci);
        const size = sizeCache.getSize(ci) - selGridGap;
        const cs = engineState.containerSize;
        const sp = engineState.scrollPosition;
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

      ctx.registerDestroyHandler(() => {
        dom.root.removeEventListener("focusin", onFocusIn);
        dom.root.removeEventListener("focusout", onFocusOut);
      });

      // ── Click handler ─────────────────────────────────────────

      ctx.registerClickHandler((event: MouseEvent): void => {
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

      if (keyboard) ctx.registerKeydownHandler((event: KeyboardEvent): void => {
          resolveOnce(ctx);
          const total = getTotalFn();
          if (total === 0) return;

          const nav = ctx.getNavConfig();
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
                const maxData = engineState.totalItems - 1;
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
                if (state.selected.size === engineState.totalItems) {
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

      ctx.registerMethod("select", (...ids: Array<string | number>): void => {
        for (const id of ids) doSelect(id);
        emitSelectionChange();
      });

      ctx.registerMethod("deselect", (...ids: Array<string | number>): void => {
        for (const id of ids) doDeselect(id);
        emitSelectionChange();
      });

      ctx.registerMethod("toggleSelect", (id: string | number): void => {
        doToggle(id);
        emitSelectionChange();
      });

      ctx.registerMethod("selectAll", (): void => {
        if (mode !== "multiple") return;
        resolveOnce(ctx);
        doSelectAll();
        emitSelectionChange();
      });

      ctx.registerMethod("clearSelection", (): void => {
        doClear();
        emitSelectionChange();
      });

      ctx.registerMethod("getSelected", (): Array<string | number> => {
        return getSelectedArray(state.selected);
      });

      ctx.registerMethod("getSelectedItems", (): T[] => {
        return collectSelectedItems();
      });

      ctx.registerMethod("selectNext", (): void => {
        resolveOnce(ctx);
        const total = getTotalFn();
        if (total === 0) return;
        moveFocus(state, 1, total, resolvedConfig.reverse);
        if (isGHFn) state.focusedIndex = skipHeaders(state.focusedIndex, 1, total);
        const item = getDataItemAtLayout(state.focusedIndex);
        if (item) doSelect(item.id, item);
        emitSelectionChange();
      });

      ctx.registerMethod("selectPrevious", (): void => {
        resolveOnce(ctx);
        const total = getTotalFn();
        if (total === 0) return;
        moveFocus(state, -1, total, resolvedConfig.reverse);
        if (isGHFn) state.focusedIndex = skipHeaders(state.focusedIndex, -1, total);
        const item = getDataItemAtLayout(state.focusedIndex);
        if (item) doSelect(item.id, item);
        emitSelectionChange();
      });

      // ── Internal methods (used by snapshots, sortable) ────────

      ctx.registerMethod("_seedSelection", (ids: Array<string | number>): void => {
        if (mode === "single") {
          if (ids.length === 1) state.selected.add(ids[0]!);
        } else {
          for (const id of ids) state.selected.add(id);
        }
      });

      ctx.registerMethod("_isFollowFocus", (): boolean => followFocus);

      ctx.registerMethod("_getFocusedId", (): string | number | undefined => {
        if (state.focusedIndex < 0) return undefined;
        return getDataItemAtLayout(state.focusedIndex)?.id;
      });

      ctx.registerMethod("_focusById", (id: string | number): void => {
        const total = engineState.totalItems;
        for (let i = 0; i < total; i++) {
          if (isGHFn?.(i)) continue;
          const item = getDataItemAtLayout(i);
          if (item && item.id === id) {
            state.focusedIndex = i;
            state.focusVisible = focusOnClick;
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
