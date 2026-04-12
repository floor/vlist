// src/builder/a11y.ts
/**
 * vlist/builder -- Baseline ARIA keyboard navigation
 *
 * Extracted from core.ts to reduce the base bundle size.
 * Implements the WAI-ARIA listbox pattern: arrow keys move focus,
 * Space/Enter selects, click selects + focuses.
 */

import type { VListItem } from "../types";
import type { MRefs } from "./materialize";
import type { DOMStructure } from "./dom";
import { scrollToFocusSimple } from "../rendering/scroll";

/**
 * Wire up baseline single-select ARIA keyboard navigation.
 * Registers focus/blur listeners, keydown handler, click handler, and destroy cleanup.
 */
export const setupBaselineA11y = <T extends VListItem>(
  $: MRefs<T>,
  dom: DOMStructure,
  cp: string,
  ap: string,
  hz: boolean,
  ps: number,
  pe: number,
  wr: boolean,
  methods: Map<string, Function>,
  rendered: Map<number, HTMLElement>,
  keydownHandlers: Array<(event: KeyboardEvent) => void>,
  clickHandlers: Array<(event: MouseEvent) => void>,
  destroyHandlers: Array<() => void>,
): void => {
  const focusedClass = `${cp}-item--focused`;
  let fv = false; // focusVisible

  // 2D navigation hints (lazy-resolved from methods map)
  let ntFn: (() => number) | null = null;
  let ndFn: (() => { ud: number; lr: number; cols: number }) | null = null;
  let navFn: ((cur: number, key: string, total: number) => number) | null = null;
  let sivFn: ((index: number) => void) | null = null;
  let resolved = false;

  const resolve = (): void => {
    if (resolved) return;
    resolved = true;
    ntFn = (methods.get("_getNavTotal") as (() => number)) ?? null;
    ndFn = (methods.get("_getNavDelta") as (() => { ud: number; lr: number; cols: number })) ?? null;
    navFn = (methods.get("_navigate") as ((cur: number, key: string, total: number) => number)) ?? null;
    sivFn = (methods.get("_scrollItemIntoView") as ((index: number) => void)) ?? null;
  };

  const nTotal = (): number => { resolve(); return ntFn ? ntFn() : $.vtf(); };

  const nDelta = (): { ud: number; lr: number; cols: number } => {
    resolve();
    return ndFn ? ndFn() : { ud: 1, lr: 0, cols: 0 };
  };

  methods.set("_getFocusedIndex", (): number => fv ? $.fi : -1);

  const commit = (idx: number): void => {
    dom.root.setAttribute("aria-activedescendant", `${ap}-item-${idx}`);
    resolve();

    if (sivFn) {
      sivFn(idx);
    } else {
      const cs = hz ? $.cw : $.ch;
      const si = $.i2s(idx);
      const ns = scrollToFocusSimple(si, $.hc, $.ls, cs, ps, pe);
      if (ns !== $.ls) {
        $.sst(ns);
        $.ls = $.sgt();
      }
    }
    $.ffn();
  };

  const move = (next: number): void => {
    $.fi = next;
    fv = true;
    commit(next);
  };

  const select = (idx: number, kbd: boolean): void => {
    $.fi = idx;
    if (kbd) fv = true;
    const item = ($.dm ? $.dm.getItem(idx) : $.it[idx]) as T | undefined;
    if (item && $.ss.has(item.id)) {
      $.ss.clear();
    } else {
      $.ss.clear();
      if (item) $.ss.add(item.id);
    }
    commit(idx);
  };

  const skipHdr = (from: number, dir: 1 | -1, total: number): number => {
    let i = from;
    while (i >= 0 && i < total) {
      const item = $.dm ? $.dm.getItem(i) : $.it[i];
      if (!item || !(item as Record<string, unknown>).__groupHeader) return i;
      i += dir;
    }
    i = from - dir;
    while (i >= 0 && i < total) {
      const item = $.dm ? $.dm.getItem(i) : $.it[i];
      if (!item || !(item as Record<string, unknown>).__groupHeader) return i;
      i -= dir;
    }
    return from;
  };

  const onFocusIn = (): void => {
    if ($.id) return;
    if (!dom.root.matches(":focus-visible")) return;
    const t = nTotal();
    if (t === 0) return;
    let tgt = $.fi >= 0 ? Math.min($.fi, t - 1) : 0;
    tgt = skipHdr(tgt, 1, t);
    move(tgt);
  };
  dom.root.addEventListener("focusin", onFocusIn);

  const onFocusOut = (e: FocusEvent): void => {
    if ($.id) return;
    const rel = e.relatedTarget as Node | null;
    if (rel && dom.root.contains(rel)) return;
    fv = false;
    if ($.fi >= 0) {
      rendered.get($.fi)?.classList.remove(focusedClass);
    }
    dom.root.removeAttribute("aria-activedescendant");
  };
  dom.root.addEventListener("focusout", onFocusOut);

  keydownHandlers.push((event: KeyboardEvent): void => {
    if ($.id) return;
    const total = nTotal();
    if (total === 0) return;
    const p = $.fi;
    let n = p;

    if (event.key === " " || event.key === "Enter") {
      if (p >= 0) {
        const fi = ($.dm ? $.dm.getItem(p) : $.it[p]) as T | undefined;
        if (fi && !(fi as Record<string, unknown>).__groupHeader) {
          select(p, true);
        }
      }
      event.preventDefault();
      return;
    }

    resolve();

    if (navFn) {
      switch (event.key) {
        case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight":
        case "PageUp": case "PageDown": case "Home": case "End":
          n = navFn(p, event.key, total);
          break;
        default:
          return;
      }
    } else {
      const { ud, lr, cols } = nDelta();
      switch (event.key) {
        case "ArrowUp":    n = p - ud; break;
        case "ArrowDown":  n = p + ud; break;
        case "ArrowLeft":  if (!lr) return; n = p - lr; break;
        case "ArrowRight": if (!lr) return; n = p + lr; break;
        case "PageUp":
        case "PageDown": {
          const rh = $.hc.getSize($.i2s(Math.max(0, p)));
          const delta = Math.max(ud, Math.floor((hz ? $.cw : $.ch) / rh) * ud);
          n = event.key === "PageUp" ? p - delta : p + delta;
          break;
        }
        case "Home":
          if (event.ctrlKey || !cols) { n = 0; }
          else { n = p - (p % cols); }
          break;
        case "End":
          if (event.ctrlKey || !cols) { n = total - 1; }
          else { n = Math.min(p - (p % cols) + cols - 1, total - 1); }
          break;
        default: return;
      }
      if (n < 0) n = wr ? total - 1 : 0;
      else if (n >= total) n = wr ? 0 : total - 1;
    }

    event.preventDefault();
    n = skipHdr(n, n >= p ? 1 : -1, total);
    if (n !== p) move(n);
  });

  clickHandlers.push((event: MouseEvent): void => {
    if ($.id) return;
    const el = (event.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
    if (!el) return;
    const idx = parseInt(el.dataset.index ?? "-1", 10);
    if (idx < 0) return;
    const item = ($.dm?.getItem(idx) ?? $.it[idx]) as T | undefined;
    if (!item || (item as Record<string, unknown>).__groupHeader) return;
    fv = false;
    dom.root.focus();
    select(idx, false);
  });

  destroyHandlers.push(() => {
    dom.root.removeEventListener("focusin", onFocusIn);
    dom.root.removeEventListener("focusout", onFocusOut);
  });
};
