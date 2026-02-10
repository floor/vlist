/**
 * vlist - Element Pool
 * DOM element recycling for reduced garbage collection
 *
 * Reuses DOM elements instead of creating/destroying them on every scroll.
 * This is a pure DOM utility shared between the full vlist renderer and
 * the lightweight core. Zero dependencies on other vlist internals.
 */

// =============================================================================
// Types
// =============================================================================

/** Element pool for recycling DOM elements */
export interface ElementPool {
  /** Get an element from the pool (or create new) */
  acquire: () => HTMLElement;

  /** Return an element to the pool */
  release: (element: HTMLElement) => void;

  /** Clear the pool */
  clear: () => void;

  /** Get pool statistics */
  stats: () => { poolSize: number; created: number; reused: number };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an element pool for recycling DOM elements
 * Reduces garbage collection and improves performance
 *
 * @param tagName - HTML tag for created elements (default: "div")
 * @param maxSize - Maximum pool size before elements are discarded (default: 100)
 */
export const createElementPool = (
  tagName: string = "div",
  maxSize: number = 100,
): ElementPool => {
  const pool: HTMLElement[] = [];
  let created = 0;
  let reused = 0;

  const acquire = (): HTMLElement => {
    const element = pool.pop();

    if (element) {
      reused++;
      return element;
    }

    created++;
    const newElement = document.createElement(tagName);
    // Set static attributes once per element lifetime (never change)
    newElement.setAttribute("role", "option");
    return newElement;
  };

  const release = (element: HTMLElement): void => {
    if (pool.length < maxSize) {
      // Reset element state
      element.className = "";
      element.textContent = "";
      element.removeAttribute("style");
      element.removeAttribute("data-index");
      element.removeAttribute("data-id");

      pool.push(element);
    }
  };

  const clear = (): void => {
    pool.length = 0;
  };

  const stats = () => ({
    poolSize: pool.length,
    created,
    reused,
  });

  return { acquire, release, clear, stats };
};
