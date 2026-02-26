/**
 * vlist - Masonry Renderer
 * Renders items in a masonry/Pinterest-style layout with absolute positioning.
 *
 * Unlike grid renderer (which uses row-based positioning), masonry renderer
 * positions each item using its pre-calculated coordinates from the layout phase.
 *
 * Key differences from grid:
 * - Items positioned using cached x/y coordinates (not row/col calculations)
 * - Each item can have different height/width
 * - No row alignment - items flow into shortest column/row
 * - Visibility determined by checking each item's absolute position
 */

import type {
  VListItem,
  ItemTemplate,
  ItemState,
  RenderedItem,
} from "../../types";

import type { ItemPlacement } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Masonry renderer instance */
export interface MasonryRenderer<T extends VListItem = VListItem> {
  /** Render visible items using pre-calculated placements */
  render: (
    items: T[],
    placements: ItemPlacement[],
    selectedIds: Set<string | number>,
    focusedIndex: number,
  ) => void;

  /** Update a single item */
  updateItem: (
    index: number,
    item: T,
    placement: ItemPlacement,
    isSelected: boolean,
    isFocused: boolean,
  ) => void;

  /** Update only CSS classes on a rendered item (no template re-evaluation) */
  updateItemClasses: (
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ) => void;

  /** Get rendered item element by flat item index */
  getElement: (index: number) => HTMLElement | undefined;

  /** Clear all rendered items */
  clear: () => void;

  /** Destroy renderer and cleanup */
  destroy: () => void;
}

// =============================================================================
// Element Pool
// =============================================================================

interface ElementPool {
  acquire: () => HTMLElement;
  release: (element: HTMLElement) => void;
  clear: () => void;
}

const createElementPool = (maxSize: number = 200): ElementPool => {
  const pool: HTMLElement[] = [];

  const acquire = (): HTMLElement => {
    const element = pool.pop();

    if (element) {
      return element;
    }

    const newElement = document.createElement("div");
    newElement.setAttribute("role", "option");
    return newElement;
  };

  const release = (element: HTMLElement): void => {
    if (pool.length < maxSize) {
      element.className = "";
      element.textContent = "";
      element.removeAttribute("style");
      element.removeAttribute("data-index");
      element.removeAttribute("data-id");
      element.removeAttribute("data-lane");

      pool.push(element);
    }
  };

  const clear = (): void => {
    pool.length = 0;
  };

  return { acquire, release, clear };
};

// =============================================================================
// Masonry Renderer Factory
// =============================================================================

/**
 * Create a masonry renderer for managing DOM elements with absolute positioning.
 *
 * @param itemsContainer - The DOM element that holds rendered items
 * @param template - Item template function
 * @param classPrefix - CSS class prefix
 * @param isHorizontal - Whether layout is horizontal (scrolls right)
 * @param totalItemsGetter - Optional getter for total item count (for aria-setsize)
 * @param ariaIdPrefix - Optional unique prefix for element IDs (for aria-activedescendant)
 */
export const createMasonryRenderer = <T extends VListItem = VListItem>(
  itemsContainer: HTMLElement,
  template: ItemTemplate<T>,
  classPrefix: string,
  isHorizontal: boolean = false,
  totalItemsGetter?: () => number,
  ariaIdPrefix?: string,
): MasonryRenderer<T> => {
  const pool = createElementPool();
  const rendered = new Map<number, RenderedItem>();

  // Track aria-setsize to avoid redundant updates
  let lastAriaSetSize = "";

  // Reusable item state to avoid allocation per render
  const reusableItemState: ItemState = { selected: false, focused: false };

  const getItemState = (isSelected: boolean, isFocused: boolean): ItemState => {
    reusableItemState.selected = isSelected;
    reusableItemState.focused = isFocused;
    return reusableItemState;
  };

  // Pre-computed class names
  const baseClass = `${classPrefix}-item ${classPrefix}-masonry-item`;
  const selectedClass = `${classPrefix}-item--selected`;
  const focusedClass = `${classPrefix}-item--focused`;

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
      element.replaceChildren(result);
    }
  };

  /**
   * Apply state-dependent classes
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
   * Position an element using its placement coordinates.
   * Uses translate(x, y) for efficient GPU-accelerated positioning.
   */
  const positionElement = (
    element: HTMLElement,
    placement: ItemPlacement,
  ): void => {
    const { x, y } = placement.position;

    // Swap axes for horizontal orientation
    if (isHorizontal) {
      element.style.transform = `translate(${Math.round(y)}px, ${Math.round(x)}px)`;
    } else {
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  };

  /**
   * Apply size styles to an element.
   */
  const applySizeStyles = (
    element: HTMLElement,
    placement: ItemPlacement,
  ): void => {
    const { size, crossSize } = placement;

    if (isHorizontal) {
      // Horizontal: main axis = width, cross axis = height
      element.style.width = `${size}px`;
      element.style.height = `${crossSize}px`;
    } else {
      // Vertical: main axis = height, cross axis = width
      element.style.width = `${crossSize}px`;
      element.style.height = `${size}px`;
    }
  };

  /**
   * Render a single masonry item
   */
  const renderItem = (
    itemIndex: number,
    item: T,
    placement: ItemPlacement,
    isSelected: boolean,
    isFocused: boolean,
  ): HTMLElement => {
    const element = pool.acquire();
    const state = getItemState(isSelected, isFocused);

    // Apply base class
    element.className = baseClass;

    // Set data attributes
    element.dataset.index = String(itemIndex);
    element.dataset.id = String(item.id);
    element.dataset.lane = String(placement.position.lane);
    element.ariaSelected = String(isSelected);

    // ARIA: positional context for screen readers
    if (ariaIdPrefix) {
      element.id = `${ariaIdPrefix}-item-${itemIndex}`;
    }
    if (totalItemsGetter) {
      lastAriaSetSize = String(totalItemsGetter());
      element.setAttribute("aria-setsize", lastAriaSetSize);
      element.setAttribute("aria-posinset", String(itemIndex + 1));
    }

    // Apply sizing
    applySizeStyles(element, placement);

    // Apply template
    const result = template(item, itemIndex, state);
    applyTemplate(element, result);

    // Apply state classes and position
    applyClasses(element, isSelected, isFocused);
    positionElement(element, placement);

    return element;
  };

  /**
   * Render visible items using pre-calculated placements.
   */
  const render = (
    items: T[],
    placements: ItemPlacement[],
    selectedIds: Set<string | number>,
    focusedIndex: number,
  ): void => {
    // Release items no longer visible
    for (const [index, { element }] of rendered) {
      const isStillVisible = placements.some((p) => p.index === index);
      if (!isStillVisible) {
        pool.release(element);
        rendered.delete(index);
      }
    }

    // Render new or update existing items
    for (const placement of placements) {
      const itemIndex = placement.index;
      const item = items[itemIndex];
      if (!item) continue;

      const isSelected = selectedIds.has(item.id);
      const isFocused = itemIndex === focusedIndex;

      const existing = rendered.get(itemIndex);

      if (existing) {
        // Update existing item (state might have changed)
        const state = getItemState(isSelected, isFocused);
        const result = template(item, itemIndex, state);
        applyTemplate(existing.element, result);
        applyClasses(existing.element, isSelected, isFocused);
        positionElement(existing.element, placement);

        // Update data attributes
        existing.element.dataset.id = String(item.id);
        existing.element.ariaSelected = String(isSelected);
      } else {
        // Render new item
        const element = renderItem(
          itemIndex,
          item,
          placement,
          isSelected,
          isFocused,
        );
        itemsContainer.appendChild(element);
        rendered.set(itemIndex, { element, index: itemIndex });
      }
    }
  };

  /**
   * Update a single item (when data changes).
   */
  const updateItem = (
    index: number,
    item: T,
    placement: ItemPlacement,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing) return;

    const state = getItemState(isSelected, isFocused);
    const result = template(item, index, state);
    applyTemplate(existing.element, result);
    applyClasses(existing.element, isSelected, isFocused);
    positionElement(existing.element, placement);

    // Update data attributes
    existing.element.dataset.id = String(item.id);
    existing.element.ariaSelected = String(isSelected);
  };

  /**
   * Update only CSS classes (for selection/focus changes).
   */
  const updateItemClasses = (
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing) return;

    applyClasses(existing.element, isSelected, isFocused);
    existing.element.ariaSelected = String(isSelected);
  };

  /**
   * Get rendered element by index.
   */
  const getElement = (index: number): HTMLElement | undefined => {
    return rendered.get(index)?.element;
  };

  /**
   * Clear all rendered items.
   */
  const clear = (): void => {
    for (const { element } of rendered.values()) {
      pool.release(element);
    }
    rendered.clear();
    itemsContainer.innerHTML = "";
  };

  /**
   * Destroy renderer and cleanup.
   */
  const destroy = (): void => {
    clear();
    pool.clear();
  };

  return {
    render,
    updateItem,
    updateItemClasses,
    getElement,
    clear,
    destroy,
  };
};