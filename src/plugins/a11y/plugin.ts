/**
 * vlist — A11y Plugin
 *
 * Baseline keyboard navigation, single-select, focus management, and ARIA.
 * Extracted from createVList() so it tree-shakes when selection() is used.
 *
 * Priority 55 — runs after selection (50). If selection already set
 * itemStateFn, this plugin becomes a no-op.
 */

import type { VListItem, ItemState } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import { clampPageTarget } from "../../utils/grid-nav";

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
      if (ctx.render.getStateFn()) return;

      ctx.dom.enableListbox();
      const dom = ctx.dom;
      const config = ctx.config;
      const sizeCache = ctx.sizes.cache;
      const engineState = ctx.getState();
      const emitter = ctx.emitter;
      const classPrefix = config.classPrefix;
      const liveRegion = dom.liveRegion;

      let focusIdx = -1;
      let focusVis = false;
      let selId: string | number | undefined;
      let selIdx = -1;

      const getItem = (i: number): T | undefined => ctx.items.at(i);
      const getTotal = (): number => engineState.totalItems;

      const _focusEvt = { id: 0 as string | number, index: 0 };
      const _selEvt = { selected: [] as Array<string | number>, items: [] as T[] };

      ctx.render.setStateFn((_i: number, is: ItemState): void => {
        is.selected = selIdx === _i;
        is.focused = focusVis && focusIdx === _i;
      });

      // tree() treats a state function as an external focus owner and then
      // reads these. Without them ArrowLeft, ArrowRight, "*" and type-ahead
      // see no focused row and return.
      ctx.hooks.method("_getFocusedIndex", (): number => (focusVis ? focusIdx : -1));
      ctx.hooks.method("_getFocusedId", (): string | number | undefined => {
        if (focusIdx < 0) return undefined;
        return getItem(focusIdx)?.id;
      });
      ctx.hooks.method("_focusById", (id: string | number, keyboard?: boolean | "preserve"): void => {
        const total = getTotal();
        for (let i = 0; i < total; i++) {
          const it = getItem(i);
          if (!it || it.id !== id) continue;
          focusIdx = i;
          if (keyboard !== "preserve") focusVis = keyboard === true;
          if (focusVis) dom.content.setAttribute("aria-activedescendant", `${classPrefix}-item-${i}`);
          else dom.content.removeAttribute("aria-activedescendant");
          _focusEvt.id = id;
          _focusEvt.index = i;
          emitter.emit("focus:change", _focusEvt);
          ctx.render.force();
          return;
        }
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
        const nav = ctx.nav.get();
        // The layout that owns the scroll tells us where the item really is.
        // Masonry lanes and a sticky group header are not a prefix sum, and
        // carousel reveals inside the current lap. A prefix sum leaves the
        // focused cell below the fold and the active descendant unmounted.
        if (nav.reveal) {
          nav.reveal(idx);
          return;
        }
        const reveal = ctx.hooks.get("_scrollItemIntoView") as ((index: number) => void) | undefined;
        if (reveal) {
          ctx.scroll.cancel();
          reveal(idx);
          return;
        }
        const ci = nav.scrollIndex ? nav.scrollIndex(idx) : idx;
        const off = sizeCache.getOffset(ci);
        const sz = sizeCache.getSize(ci);
        const sp = ctx.scroll.getPixelEquivalent();
        const cs = engineState.containerSize;
        const sP = config.startPadding;
        const eP = config.endPadding;
        const adjTop = off + sP;
        const adjBot = adjTop + sz;

        let pos = sp;
        if (adjTop < sp) pos = Math.max(0, off);
        else if (adjBot > sp + cs) pos = adjBot + eP - cs;

        if (pos !== sp) {
          ctx.scroll.setPixelEquivalent(pos);
        }
      };

      const commit = (idx: number, scroll: boolean): void => {
        dom.content.setAttribute("aria-activedescendant", `${classPrefix}-item-${idx}`);
        if (scroll) scrollIntoView(idx);
        ctx.render.force();
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
        ctx.render.force();
      };

      dom.content.addEventListener("focusin", onFocusIn);
      dom.content.addEventListener("focusout", onFocusOut);

      // ── Keyboard handler ────────────────────────────────────────
      // Skipped when keyboard:false — click-selection, focus, and ARIA stay
      // active, but keyboard navigation is left to an outer system.

      if (keyboard) ctx.hooks.onKeydown((e: KeyboardEvent): void => {
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

        const nav = ctx.nav.get();
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
          const lane = (d: number): number => (Math.abs(d) > 1 && p >= 0 ? clampPageTarget(p + d, p, Math.abs(d), total) : p + d);
          switch (e.key) {
            // A step of more than one item is a row (or, sideways in a
            // horizontal grid, a column): it keeps its lane at the edges
            // instead of clamping to the corner, as the page keys do (#60).
            case "ArrowUp":    if (isX && !lr) return; n = lane(-(isX ? lr : ud)); break;
            case "ArrowDown":  if (isX && !lr) return; n = lane(isX ? lr : ud); break;
            case "ArrowLeft":  if (!isX && !lr) return; n = lane(-(isX ? ud : lr)); break;
            case "ArrowRight": if (!isX && !lr) return; n = lane(isX ? ud : lr); break;
            case "PageUp":
            case "PageDown": {
              const sz = sizeCache.getSize(Math.max(0, nav.scrollIndex ? nav.scrollIndex(p) : p));
              const visRows = Math.max(1, Math.floor(engineState.containerSize / sz));
              const delta = visRows * ud;
              // Column-preserving clamp so a page move at the top/bottom row
              // stays in the same column rather than jumping to the corner
              // (Home/End). #60
              n = clampPageTarget(e.key === "PageUp" ? p - delta : p + delta, p, ud, total);
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

      ctx.hooks.onClick((e: MouseEvent): void => {
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

      ctx.hooks.onDestroy(() => {
        dom.content.removeEventListener("focusin", onFocusIn);
        dom.content.removeEventListener("focusout", onFocusOut);
      });
    },
  };
}
