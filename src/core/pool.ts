/**
 * vlist — Element Pool
 *
 * acquire() = pop or create, release() = reset + push.
 *
 * No cap. The pool only ever holds elements it created — every caller that
 * releases also acquires here — and it creates one only when it is empty, so it
 * can never hold more than the most that were mounted at once. A cap of 100 cut
 * into that: a jump on a view of 300 cells released them all, kept 100, and the
 * next frame cloned 200 again. A cap that followed the peak would bound nothing
 * this does not already bound, and would cost every bundle the bytes to track it.
 */

import type { ElementPool } from "./types";

export function createPool(classPrefix: string): ElementPool {
  const pool: HTMLElement[] = [];
  const itemClass = `${classPrefix}-item`;
  const tpl = document.createElement("div");
  tpl.className = itemClass;

  return {
    acquire(): HTMLElement {
      if (pool.length > 0) {
        return pool.pop()!;
      }
      return tpl.cloneNode(false) as HTMLElement;
    },

    release(element: HTMLElement): void {
      element.className = itemClass;
      element.removeAttribute("style");
      element.removeAttribute("id");
      element.removeAttribute("role");
      element.removeAttribute("aria-selected");
      element.removeAttribute("aria-posinset");
      element.removeAttribute("aria-setsize");
      element.removeAttribute("data-index");
      element.removeAttribute("data-id");
      element.textContent = "";

      pool.push(element);
    },

    get size(): number {
      return pool.length;
    },

    clear(): void {
      pool.length = 0;
    },
  };
}
