/**
 * vlist v2 — Element Pool
 *
 * acquire() = pop or create, release() = reset + push.
 * Max pool size: 100.
 */

import type { ElementPool } from "./types";

const MAX_POOL_SIZE = 100;

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

      if (pool.length < MAX_POOL_SIZE) {
        pool.push(element);
      }
    },

    get size(): number {
      return pool.length;
    },

    clear(): void {
      pool.length = 0;
    },
  };
}
