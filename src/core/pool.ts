// src/builder/pool.ts
/**
 * vlist/builder — Element Pool
 * Recycling pool for DOM elements to reduce allocation during scrolling.
 */

export const createElementPool = (maxSize = 100) => {
  const pool: HTMLElement[] = [];

  return {
    acquire: (): HTMLElement => {
      const el = pool.pop();
      if (el) return el;
      const newEl = document.createElement("div");
      newEl.setAttribute("role", "option");
      return newEl;
    },
    release: (el: HTMLElement): void => {
      if (pool.length < maxSize) {
        el.className = "";
        el.textContent = "";
        el.removeAttribute("style");
        el.removeAttribute("data-index");
        el.removeAttribute("data-id");
        pool.push(el);
      }
    },
    clear: (): void => {
      pool.length = 0;
    },
  };
};
