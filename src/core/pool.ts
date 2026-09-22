/**
 * vlist — Element Pool
 *
 * acquire() = pop or create, release() = reset + push.
 *
 * No fixed cap. A cap of 100 dropped a window of 300 cells on a jump, and the
 * next frame cloned 200 of them again. The pool still grows to the most rows
 * that were on screen at once, and that peak does not fall on its own:
 * release() only pushes, so a list that shrinks keeps every spare node until
 * trim() drops them back to the number currently mounted. Core trims when
 * scrolling has gone idle, and after a data change that is not mid-scroll, so
 * a jump during a gesture still reuses the previous window.
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

    trim(keep: number): void {
      const limit = keep > 0 ? keep : 0;
      if (pool.length > limit) pool.length = limit;
    },

    clear(): void {
      pool.length = 0;
    },
  };
}
