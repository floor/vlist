/**
 * vlist v2 — A11y Plugin
 *
 * Baseline keyboard navigation, single-select, focus management, and ARIA.
 * Extracted from createVList() so it tree-shakes when selection() is used.
 *
 * Priority 55 — runs after selection (50). If selection already set
 * itemStateFn, this plugin becomes a no-op.
 */

import type { VListItem, ItemState } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";

export interface A11yPluginConfig {
  /**
   * Whether this plugin handles arrow/Home/End/PageUp-Down/Enter/Space
   * keyboard navigation. Default true. Set false to keep click-selection,
   * focus management, and ARIA while letting an outer system own keyboard
   * navigation (e.g. a global, focus-independent hotkey layer).
   */
  keyboard?: boolean;
}

export function a11y<T extends VListItem = VListItem>(
  config?: A11yPluginConfig,
): VListPlugin<T> {
  const keyboard = config?.keyboard ?? true;
  return {
    name: "a11y",
    priority: 55,

    setup(ctx: PluginContext<T>): void {
      if (ctx.getItemStateFn()) return;

      ctx.enableListboxRole();
      const dom = ctx.dom;
      const config = ctx.config;
      const sizeCache = ctx.sizeCache;
      const engineState = ctx.getState();
      const emitter = ctx.emitter;
      const classPrefix = config.classPrefix;
      const liveRegion = dom.liveRegion;

      let focusIdx = -1;
      let focusVis = false;
      let selId: string | number | undefined;
      let selIdx = -1;

      const getItem = (i: number): T | undefined => ctx.getItem(i);
      const getTotal = (): number => engineState.totalItems;

      const _focusEvt = { id: 0 as string | number, index: 0 };
      const _selEvt = { selected: [] as Array<string | number>, items: [] as T[] };

      ctx.setItemStateFn((_i: number, is: ItemState): void => {
        is.selected = selIdx === _i;
        is.focused = focusVis && focusIdx === _i;
      });

      function announce(message: string): void {
        liveRegion.textContent = "";
        liveRegion.textContent = message;
      }

      const skip = (from: number, dir: 1 | -1, total: number): number => {
        let i = from;
        while (i >= 0 && i < total) {
          const it = getItem(i);
          if (!it || !(it as Record<string, unknown>).__groupHeader) return i;
          i += dir;
        }
        i = from - dir;
        while (i >= 0 && i < total) {
          const it = getItem(i);
          if (!it || !(it as Record<string, unknown>).__groupHeader) return i;
          i -= dir;
        }
        return from;
      };

      const scrollIntoView = (idx: number): void => {
        const nav = ctx.getNavConfig();
        const ci = nav.scrollIndex ? nav.scrollIndex(idx) : idx;
        const off = sizeCache.getOffset(ci);
        const sz = sizeCache.getSize(ci);
        const sp = engineState.scrollPosition;
        const cs = engineState.containerSize;
        const sP = config.startPadding;
        const eP = config.endPadding;
        const adjTop = off + sP;
        const adjBot = adjTop + sz;

        let pos = sp;
        if (adjTop < sp) pos = Math.max(0, off);
        else if (adjBot > sp + cs) pos = adjBot + eP - cs;

        if (pos !== sp) {
          engineState.scrollPosition = pos;
          ctx.scrollTo(pos);
        }
      };

      const commit = (idx: number, scroll: boolean): void => {
        dom.content.setAttribute("aria-activedescendant", `${classPrefix}-item-${idx}`);
        if (scroll) scrollIntoView(idx);
        ctx.forceRender();
      };

      const move = (next: number): void => {
        focusIdx = next;
        focusVis = true;
        commit(next, true);
        const it = getItem(next);
        if (it) {
          _focusEvt.id = it.id;
          _focusEvt.index = next;
          emitter.emit("focus:change", _focusEvt);
          announce(`Item ${next + 1} of ${getTotal()}`);
        }
      };

      const select = (idx: number, kbd: boolean): void => {
        focusIdx = idx;
        if (kbd) focusVis = true;
        const it = getItem(idx);
        if (it && selId === it.id) {
          selId = undefined;
          selIdx = -1;
        } else {
          selId = it?.id;
          selIdx = it ? idx : -1;
        }
        commit(idx, kbd);
        if (selId !== undefined && it && selId === it.id) {
          _selEvt.selected[0] = selId;
          _selEvt.selected.length = 1;
          _selEvt.items[0] = it;
          _selEvt.items.length = 1;
          announce(`Selected, item ${idx + 1} of ${getTotal()}`);
        } else {
          _selEvt.selected.length = 0;
          _selEvt.items.length = 0;
          announce(`Deselected`);
        }
        emitter.emit("selection:change", _selEvt);
      };

      // ── Focus handlers ──────────────────────────────────────────

      const onFocusIn = (): void => {
        if (engineState.destroyed) return;
        if (!dom.content.matches(":focus-visible")) return;
        const t = getTotal();
        if (t === 0) return;
        let tgt = focusIdx >= 0 ? Math.min(focusIdx, t - 1) : 0;
        tgt = skip(tgt, 1, t);
        move(tgt);
      };

      const onFocusOut = (e: FocusEvent): void => {
        if (engineState.destroyed) return;
        const rel = e.relatedTarget as Node | null;
        if (rel && dom.root.contains(rel)) return;
        focusVis = false;
        dom.content.removeAttribute("aria-activedescendant");
        ctx.forceRender();
      };

      dom.content.addEventListener("focusin", onFocusIn);
      dom.content.addEventListener("focusout", onFocusOut);

      // ── Keyboard handler ────────────────────────────────────────
      // Skipped when keyboard:false — click-selection, focus, and ARIA stay
      // active, but keyboard navigation is left to an outer system.

      if (keyboard) ctx.registerKeydownHandler((e: KeyboardEvent): void => {
        if (engineState.destroyed) return;
        const total = getTotal();
        if (total === 0) return;
        const p = focusIdx;
        let n = p;

        if (e.key === " " || e.key === "Enter") {
          if (p >= 0) {
            const it = getItem(p);
            if (it && !(it as Record<string, unknown>).__groupHeader) {
              select(p, true);
            }
          }
          e.preventDefault();
          return;
        }

        const nav = ctx.getNavConfig();
        if (nav.navigate) {
          switch (e.key) {
            case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight":
            case "PageUp": case "PageDown": case "Home": case "End":
              n = nav.navigate(p, e.key, total);
              break;
            default: return;
          }
        } else {
          const ud = nav.ud || 1;
          const lr = nav.lr;
          const isX = config.axis.primary === "x";
          switch (e.key) {
            case "ArrowUp":    if (isX && !lr) return; n = p - (isX ? lr : ud); break;
            case "ArrowDown":  if (isX && !lr) return; n = p + (isX ? lr : ud); break;
            case "ArrowLeft":  if (!isX && !lr) return; n = p - (isX ? ud : lr); break;
            case "ArrowRight": if (!isX && !lr) return; n = p + (isX ? ud : lr); break;
            case "PageUp":
            case "PageDown": {
              const sz = sizeCache.getSize(Math.max(0, nav.scrollIndex ? nav.scrollIndex(p) : p));
              const visRows = Math.max(1, Math.floor(engineState.containerSize / sz));
              const delta = visRows * ud;
              n = e.key === "PageUp" ? p - delta : p + delta;
              break;
            }
            case "Home": n = 0; break;
            case "End": n = total - 1; break;
            default: return;
          }
        }

        if (n < 0) n = 0;
        else if (n >= total) n = total - 1;

        e.preventDefault();
        n = skip(n, n >= p ? 1 : -1, total);
        if (n !== p) move(n);
      });

      // ── Click handler ───────────────────────────────────────────

      ctx.registerClickHandler((e: MouseEvent): void => {
        if (engineState.destroyed) return;
        const el = (e.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
        if (!el) return;
        const idx = parseInt(el.dataset.index ?? "-1", 10);
        if (idx < 0) return;
        const it = getItem(idx);
        if (!it || (it as Record<string, unknown>).__groupHeader) return;
        focusVis = false;
        dom.content.focus({ preventScroll: true });
        select(idx, false);
      });

      // ── Cleanup ─────────────────────────────────────────────────

      ctx.registerDestroyHandler(() => {
        dom.content.removeEventListener("focusin", onFocusIn);
        dom.content.removeEventListener("focusout", onFocusOut);
      });
    },
  };
}
