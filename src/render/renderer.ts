/**
 * vlist - DOM Rendering
 * Efficient DOM rendering with element pooling
 * Supports compression for large lists (1M+ items)
 */

import type {
  VListItem,
  ItemTemplate,
  ItemState,
  Range,
  RenderedItem,
} from "../types";

import {
  getCompressionState,
  calculateCompressedItemPosition,
  type CompressionState,
} from "./compression";
import type { HeightCache } from "./heights";

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

/** Compression context for positioning */
export interface CompressionContext {
  scrollTop: number;
  totalItems: number;
  containerHeight: number;
  rangeStart: number;
}

/** DOM structure created by createDOMStructure */
export interface DOMStructure {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
}

/** Renderer instance */
export interface Renderer<T extends VListItem = VListItem> {
  /** Render items for a range */
  render: (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    compressionCtx?: CompressionContext,
  ) => void;

  /** Update item positions (for compressed scrolling) */
  updatePositions: (compressionCtx: CompressionContext) => void;

  /** Update a single item */
  updateItem: (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ) => void;

  /** Update only CSS classes on a rendered item (no template re-evaluation) */
  updateItemClasses: (
    index: number,
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

// =============================================================================
// Renderer
// =============================================================================

/**
 * Create a renderer for managing DOM elements
 * Supports compression for large lists
 */
export const createRenderer = <T extends VListItem = VListItem>(
  itemsContainer: HTMLElement,
  template: ItemTemplate<T>,
  heightCache: HeightCache,
  classPrefix: string,
  _totalItemsGetter?: () => number,
): Renderer<T> => {
  const pool = createElementPool("div");
  const rendered = new Map<number, RenderedItem>();

  // Cache compression state to avoid recalculating
  let cachedCompression: CompressionState | null = null;
  let cachedTotalItems = 0;

  /**
   * Get or update compression state
   */
  const getCompression = (totalItems: number): CompressionState => {
    if (cachedCompression && cachedTotalItems === totalItems) {
      return cachedCompression;
    }
    cachedCompression = getCompressionState(totalItems, heightCache);
    cachedTotalItems = totalItems;
    return cachedCompression;
  };

  /**
   * Reusable item state object to avoid allocation per render
   * Note: Templates should not store or mutate this object reference
   */
  const reusableItemState: ItemState = { selected: false, focused: false };

  /**
   * Get item state for template (reuses single object to reduce GC pressure)
   */
  const getItemState = (isSelected: boolean, isFocused: boolean): ItemState => {
    reusableItemState.selected = isSelected;
    reusableItemState.focused = isFocused;
    return reusableItemState;
  };

  /**
   * Apply template result to element
   * Uses replaceChildren() for efficient HTMLElement replacement
   */
  const applyTemplate = (
    element: HTMLElement,
    result: string | HTMLElement,
  ): void => {
    if (typeof result === "string") {
      element.innerHTML = result;
    } else {
      // replaceChildren() is more efficient than innerHTML="" + appendChild()
      // It's a single DOM operation instead of two
      element.replaceChildren(result);
    }
  };

  /**
   * Apply static styles to an element (called once when element is created/recycled)
   * Only sets height — position/top/left/right are already in .vlist-item CSS
   * For variable heights, the height depends on the item index.
   */
  const applyStaticStyles = (element: HTMLElement, index: number): void => {
    element.style.height = `${heightCache.getHeight(index)}px`;
  };

  /**
   * Calculate the offset for an element
   * Uses compression-aware positioning for large lists
   */
  const calculateOffset = (
    index: number,
    compressionCtx?: CompressionContext,
  ): number => {
    if (compressionCtx) {
      const compression = getCompression(compressionCtx.totalItems);

      if (compression.isCompressed) {
        // Use compression-aware positioning
        return calculateCompressedItemPosition(
          index,
          compressionCtx.scrollTop,
          heightCache,
          compressionCtx.totalItems,
          compressionCtx.containerHeight,
          compression,
          compressionCtx.rangeStart,
        );
      }
    }
    // Normal positioning (non-compressed or no context)
    return heightCache.getOffset(index);
  };

  /**
   * Position an element at the correct offset (transform only)
   * Static styles should already be applied via applyStaticStyles
   */
  const positionElement = (
    element: HTMLElement,
    index: number,
    compressionCtx?: CompressionContext,
  ): void => {
    const offset = calculateOffset(index, compressionCtx);
    element.style.transform = `translateY(${Math.round(offset)}px)`;
  };

  // Pre-computed class names for toggle operations
  const baseClass = `${classPrefix}-item`;
  const selectedClass = `${classPrefix}-item--selected`;
  const focusedClass = `${classPrefix}-item--focused`;

  /**
   * Apply base class to element (called once when element is created)
   */
  const applyBaseClass = (element: HTMLElement): void => {
    element.className = baseClass;
  };

  /**
   * Apply classes to element based on state
   * Uses classList.toggle() for efficient incremental updates
   */
  const applyClasses = (
    element: HTMLElement,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    element.classList.toggle(selectedClass, isSelected);
    element.classList.toggle(focusedClass, isFocused);
  };

  /**
   * Render a single item
   */
  const renderItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
    compressionCtx?: CompressionContext,
  ): HTMLElement => {
    const element = pool.acquire();
    const state = getItemState(isSelected, isFocused);

    // Apply static styles once (position, dimensions)
    applyStaticStyles(element, index);

    // Apply base class once
    applyBaseClass(element);

    // Set data attributes using dataset (faster than setAttribute)
    // Note: role="option" is set once in pool.acquire()
    element.dataset.index = String(index);
    element.dataset.id = String(item.id);
    element.ariaSelected = String(isSelected);

    // Apply template
    const result = template(item, index, state);
    applyTemplate(element, result);

    // Apply state-dependent classes (selected, focused)
    applyClasses(element, isSelected, isFocused);
    positionElement(element, index, compressionCtx);

    return element;
  };

  /**
   * Render items for a range
   * Supports compression context for large lists
   *
   * Uses DocumentFragment batching to minimize DOM operations:
   * - Collects all new elements in a fragment
   * - Appends them in a single DOM operation
   * - Reduces layout thrashing during fast scrolling
   */
  const render = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    compressionCtx?: CompressionContext,
  ): void => {
    // Remove items outside the new range
    for (const [index, renderedItem] of rendered) {
      if (index < range.start || index > range.end) {
        renderedItem.element.remove();
        pool.release(renderedItem.element);
        rendered.delete(index);
      }
    }

    // Collect new elements for batched DOM insertion
    // Using DocumentFragment reduces layout thrashing when adding multiple elements
    const fragment = document.createDocumentFragment();
    const newElements: Array<{ index: number; element: HTMLElement }> = [];

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
        // Check if the item ID changed (e.g., placeholder replaced with real data)
        const existingId = existing.element.dataset.id;
        const newId = String(item.id);
        const itemChanged = existingId !== newId;

        if (itemChanged) {
          // Re-apply template when item data changes (placeholder -> real data)
          const state = getItemState(isSelected, isFocused);
          const result = template(item, i, state);
          applyTemplate(existing.element, result);
          existing.element.dataset.id = newId;
          // Update height in case variable heights differ for the new item
          applyStaticStyles(existing.element, i);
        }

        // Always update classes, selection state, and position
        applyClasses(existing.element, isSelected, isFocused);
        existing.element.ariaSelected = String(isSelected);
        positionElement(existing.element, i, compressionCtx);
      } else {
        // Render new element and add to fragment (not directly to DOM)
        const element = renderItem(
          i,
          item,
          isSelected,
          isFocused,
          compressionCtx,
        );
        fragment.appendChild(element);
        newElements.push({ index: i, element });
      }
    }

    // Batch append all new elements in a single DOM operation
    if (newElements.length > 0) {
      itemsContainer.appendChild(fragment);
      // Register elements in rendered map after DOM insertion
      for (const { index, element } of newElements) {
        rendered.set(index, { index, element });
      }
    }
  };

  /**
   * Update positions of all rendered items (for compressed scrolling)
   * Call this on scroll when using compression
   */
  const updatePositions = (compressionCtx: CompressionContext): void => {
    for (const [index, renderedItem] of rendered) {
      positionElement(renderedItem.element, index, compressionCtx);
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
      const state = getItemState(isSelected, isFocused);
      const result = template(item, index, state);

      applyTemplate(existing.element, result);
      applyClasses(existing.element, isSelected, isFocused);
      existing.element.dataset.id = String(item.id);
      existing.element.ariaSelected = String(isSelected);
    }
  };

  /**
   * Update only CSS classes on a rendered item (no template re-evaluation)
   * Used for focus-only changes where template content hasn't changed
   */
  const updateItemClasses = (
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (existing) {
      applyClasses(existing.element, isSelected, isFocused);
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
    updatePositions,
    updateItem,
    updateItemClasses,
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
): DOMStructure => {
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
