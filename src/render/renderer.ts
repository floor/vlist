/**
 * vlist - DOM Rendering
 * Efficient DOM rendering with element pooling
 * Supports compression for large lists (1M+ items)
 * Axis-aware: supports both vertical and horizontal scrolling
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
import { createElementPool } from "./pool";

// Re-export shared utilities so existing imports from "./renderer" still work
export {
  createDOMStructure,
  updateContentHeight,
  updateContentSize,
  resolveContainer,
  getContainerDimensions,
} from "./dom";
export type { DOMStructure } from "./dom";
export { createElementPool } from "./pool";
export type { ElementPool } from "./pool";

// =============================================================================
// Types
// =============================================================================

/** Compression context for positioning */
export interface CompressionContext {
  scrollTop: number;
  totalItems: number;
  containerHeight: number;
  rangeStart: number;
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
  horizontal?: boolean,
): Renderer<T> => {
  const pool = createElementPool("div");

  // Pre-compute axis-dependent names once (avoids branching on every render)
  const sizeProp = horizontal ? "width" : "height";
  const translatePrefix = horizontal ? "translateX(" : "translateY(";
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
   * Sets the scroll-axis dimension: height for vertical, width for horizontal.
   * Position/top/left/right are already in .vlist-item CSS.
   * For variable sizes, the dimension depends on the item index.
   */
  const applyStaticStyles = (element: HTMLElement, index: number): void => {
    element.style[sizeProp] = `${heightCache.getHeight(index)}px`;
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
   * Uses translateX for horizontal mode, translateY for vertical mode.
   * Static styles should already be applied via applyStaticStyles
   */
  const positionElement = (
    element: HTMLElement,
    index: number,
    compressionCtx?: CompressionContext,
  ): void => {
    const offset = calculateOffset(index, compressionCtx);
    element.style.transform = `${translatePrefix}${Math.round(offset)}px)`;
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
