/**
 * vlist - DOM Rendering
 * Efficient DOM rendering with element pooling
 */

import type {
  VListItem,
  ItemTemplate,
  ItemState,
  Range,
  RenderedItem,
} from "../types";

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

/** Renderer instance */
export interface Renderer<T extends VListItem = VListItem> {
  /** Render items for a range */
  render: (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
  ) => void;

  /** Update a single item */
  updateItem: (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ) => void;

  /** Get rendered item element by index */
  getElement: (index: number) => HTMLElement | undefined;

  /** Clear all rendered items */
  clear: () => void;

  /** Destroy renderer and cleanup */
  destroy: () => void;
}

// =============================================================================
// Element Pool
// =============================================================================

/**
 * Create an element pool for recycling DOM elements
 * Reduces garbage collection and improves performance
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
    return document.createElement(tagName);
  };

  const release = (element: HTMLElement): void => {
    if (pool.length < maxSize) {
      // Reset element state
      element.className = "";
      element.innerHTML = "";
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

// =============================================================================
// Renderer
// =============================================================================

/**
 * Create a renderer for managing DOM elements
 */
export const createRenderer = <T extends VListItem = VListItem>(
  itemsContainer: HTMLElement,
  template: ItemTemplate<T>,
  itemHeight: number,
  classPrefix: string,
): Renderer<T> => {
  const pool = createElementPool("div");
  const rendered = new Map<number, RenderedItem>();

  /**
   * Create item state for template
   */
  const createItemState = (
    isSelected: boolean,
    isFocused: boolean,
  ): ItemState => ({
    selected: isSelected,
    focused: isFocused,
  });

  /**
   * Apply template result to element
   */
  const applyTemplate = (
    element: HTMLElement,
    result: string | HTMLElement,
  ): void => {
    if (typeof result === "string") {
      element.innerHTML = result;
    } else {
      element.innerHTML = "";
      element.appendChild(result);
    }
  };

  /**
   * Position an element at the correct offset
   */
  const positionElement = (element: HTMLElement, index: number): void => {
    const offset = index * itemHeight;
    element.style.position = "absolute";
    element.style.top = "0";
    element.style.left = "0";
    element.style.right = "0";
    element.style.height = `${itemHeight}px`;
    element.style.transform = `translateY(${offset}px)`;
  };

  /**
   * Apply classes to element based on state
   */
  const applyClasses = (
    element: HTMLElement,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const classes = [`${classPrefix}-item`];

    if (isSelected) {
      classes.push(`${classPrefix}-item--selected`);
    }

    if (isFocused) {
      classes.push(`${classPrefix}-item--focused`);
    }

    element.className = classes.join(" ");
  };

  /**
   * Render a single item
   */
  const renderItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ): HTMLElement => {
    const element = pool.acquire();
    const state = createItemState(isSelected, isFocused);

    // Set data attributes
    element.setAttribute("data-index", String(index));
    element.setAttribute("data-id", String(item.id));
    element.setAttribute("role", "option");
    element.setAttribute("aria-selected", String(isSelected));

    // Apply template
    const result = template(item, index, state);
    applyTemplate(element, result);

    // Apply styling
    applyClasses(element, isSelected, isFocused);
    positionElement(element, index);

    return element;
  };

  /**
   * Render items for a range
   */
  const render = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
  ): void => {
    const indicesToKeep = new Set<number>();

    // Determine which indices are in the new range
    for (let i = range.start; i <= range.end; i++) {
      indicesToKeep.add(i);
    }

    // Remove items outside the new range
    for (const [index, renderedItem] of rendered) {
      if (!indicesToKeep.has(index)) {
        renderedItem.element.remove();
        pool.release(renderedItem.element);
        rendered.delete(index);
      }
    }

    // Add/update items in range
    for (let i = range.start; i <= range.end; i++) {
      // Items array is 0-indexed relative to range.start
      const itemIndex = i - range.start;
      const item = items[itemIndex];
      if (!item) continue;

      const isSelected = selectedIds.has(item.id);
      const isFocused = i === focusedIndex;
      const existing = rendered.get(i);

      if (existing) {
        // Update existing element
        applyClasses(existing.element, isSelected, isFocused);
        existing.element.setAttribute("aria-selected", String(isSelected));
      } else {
        // Render new element
        const element = renderItem(i, item, isSelected, isFocused);
        itemsContainer.appendChild(element);
        rendered.set(i, { index: i, element });
      }
    }
  };

  /**
   * Update a single item
   */
  const updateItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);

    if (existing) {
      const state = createItemState(isSelected, isFocused);
      const result = template(item, index, state);

      applyTemplate(existing.element, result);
      applyClasses(existing.element, isSelected, isFocused);
      existing.element.setAttribute("data-id", String(item.id));
      existing.element.setAttribute("aria-selected", String(isSelected));
    }
  };

  /**
   * Get element by index
   */
  const getElement = (index: number): HTMLElement | undefined => {
    return rendered.get(index)?.element;
  };

  /**
   * Clear all rendered items
   */
  const clear = (): void => {
    for (const [, renderedItem] of rendered) {
      renderedItem.element.remove();
      pool.release(renderedItem.element);
    }
    rendered.clear();
  };

  /**
   * Destroy renderer
   */
  const destroy = (): void => {
    clear();
    pool.clear();
  };

  return {
    render,
    updateItem,
    getElement,
    clear,
    destroy,
  };
};

// =============================================================================
// DOM Helpers
// =============================================================================

/**
 * Create the vlist DOM structure
 */
export const createDOMStructure = (
  container: HTMLElement,
  classPrefix: string,
): {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
} => {
  // Root element
  const root = document.createElement("div");
  root.className = `${classPrefix}`;
  root.setAttribute("role", "listbox");
  root.setAttribute("tabindex", "0");

  // Viewport (scrollable container)
  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  viewport.style.overflow = "auto";
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  // Content (sets the total scrollable height)
  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";
  content.style.width = "100%";

  // Items container (holds rendered items)
  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.style.position = "relative";
  items.style.width = "100%";

  // Assemble structure
  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items };
};

/**
 * Update content height for virtual scrolling
 */
export const updateContentHeight = (
  content: HTMLElement,
  totalHeight: number,
): void => {
  content.style.height = `${totalHeight}px`;
};

/**
 * Get container dimensions
 */
export const getContainerDimensions = (
  viewport: HTMLElement,
): { width: number; height: number } => ({
  width: viewport.clientWidth,
  height: viewport.clientHeight,
});

/**
 * Resolve container from selector or element
 */
export const resolveContainer = (
  container: HTMLElement | string,
): HTMLElement => {
  if (typeof container === "string") {
    const element = document.querySelector<HTMLElement>(container);
    if (!element) {
      throw new Error(`[vlist] Container not found: ${container}`);
    }
    return element;
  }
  return container;
};
