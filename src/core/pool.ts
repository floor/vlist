/**
 * vlist v2 — Element Pool
 *
 * Same contract as v1: acquire() = pop or create, release() = reset + push.
 * Max pool size: 100.
 */

import type { ElementPool } from "./types";

const MAX_POOL_SIZE = 100;

export function createPool(classPrefix: string): ElementPool {
  const pool: HTMLElement[] = [];
  const itemClass = `${classPrefix}-item`;

  return {
    acquire(): HTMLElement {
      if (pool.length > 0) {
        return pool.pop()!;
      }
      const el = document.createElement("div");
      el.className = itemClass;
      el.setAttribute("role", "option");
      return el;
    },

    release(element: HTMLElement): void {
      element.className = itemClass;
      element.removeAttribute("style");
      element.removeAttribute("aria-selected");
      element.removeAttribute("data-index");
      element.removeAttribute("data-id");
      element.innerHTML = "";

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
