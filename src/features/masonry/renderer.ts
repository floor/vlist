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
 *
 * Performance:
 * - Element pooling avoids createElement cost
 * - Template re-evaluation skipped when item data + state unchanged
 * - O(1) Set-based visibility diffing (not O(n) .some())
 * - Release grace period prevents boundary thrashing (hover blink, transition replay)
 * - Released elements removed from DOM immediately
 */

import type {
  VListItem,
  ItemTemplate,
  ItemState,
} from "../../types";

import type { ItemPlacement } from "./types";
import { sortRenderedDOM } from "../../rendering/sort";

// =============================================================================
// Types
// =============================================================================

/** Item lookup function — avoids sparse array allocation on every frame */
export type GetItemFn<T> = (index: number) => T | undefined;

/** Masonry renderer instance */
export interface MasonryRenderer<T extends VListItem = VListItem> {
  /** Render visible items using pre-calculated placements */
  render: (
    getItem: GetItemFn<T>,
    placements: ItemPlacement[],
    selectedIds: Set<string | number>,
    focusedIndex: number,
  ) => void;

  /** Get rendered item element by flat item index */
  getElement: (index: number) => HTMLElement | undefined;

  /**
   * Reorder DOM children to match logical item order (by data-index).
   * Called on scroll idle so screen readers encounter items in the correct
   * sequence. Items are position:absolute so visual layout is unaffected.
   */
  sortDOM: () => void;

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
    // Remove from DOM immediately — prevents blank divs in the container
    element.remove();

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
// Release grace period
// =============================================================================

/**
 * Number of render cycles to keep an item alive after it leaves the visible set.
 * Prevents boundary thrashing: items near the overscan edge aren't recycled
 * on small scroll deltas, preserving DOM element hover state and avoiding
 * CSS transition replays.
 */
const RELEASE_GRACE = 2;

// =============================================================================
// Tracked rendered item — change-tracking fields for skip-if-unchanged
// =============================================================================

interface TrackedItem {
  element: HTMLElement;
  /** Item id at last render (to detect data changes) */
  lastItemId: string | number;
  /** Selected state at last render */
  lastSelected: boolean;
  /** Focused state at last render */
  lastFocused: boolean;
  /** Placement Y at last render (to detect position changes) */
  lastY: number;
  /** Placement X at last render */
  lastX: number;
  /** Item size (main axis) at last render */
  lastSize: number;
  /** Cross-axis size at last render (to detect resize) */
  lastCrossSize: number;
  /** Render frame when this item was last in the visible set */
  lastSeenFrame: number;
}

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
  const rendered = new Map<number, TrackedItem>();

  // ── Reusable visibleSet — cleared and repopulated each frame (no allocation) ──
  const visibleSet = new Set<number>();

  // ── Frame counter for release grace period ──
  let frameCounter = 0;

  // Track aria-setsize to avoid redundant updates
  let lastAriaSetSize = "";
  let lastAriaTotal = -1;

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
    if (isHorizontal) {
      element.style.transform = `translate(${Math.round(placement.y)}px, ${Math.round(placement.x)}px)`;
    } else {
      element.style.transform = `translate(${Math.round(placement.x)}px, ${Math.round(placement.y)}px)`;
    }
  };

  /**
   * Apply size styles to an element.
   */
  const applySizeStyles = (
    element: HTMLElement,
    placement: ItemPlacement,
  ): void => {
    if (isHorizontal) {
      element.style.width = `${placement.size}px`;
      element.style.height = `${placement.crossSize}px`;
    } else {
      element.style.width = `${placement.crossSize}px`;
      element.style.height = `${placement.size}px`;
    }
  };

  /**
   * Render a single masonry item (new element from pool)
   */
  const renderItem = (
    itemIndex: number,
    item: T,
    placement: ItemPlacement,
    isSelected: boolean,
    isFocused: boolean,
  ): TrackedItem => {
    const element = pool.acquire();
    const state = getItemState(isSelected, isFocused);

    // Apply base class
    element.className = baseClass;

    // Set data attributes
    element.dataset.index = String(itemIndex);
    element.dataset.id = String(item.id);
    element.dataset.lane = String(placement.lane);
    element.ariaSelected = String(isSelected);

    // ARIA: positional context for screen readers
    if (ariaIdPrefix) {
      element.id = `${ariaIdPrefix}-item-${itemIndex}`;
    }
    if (totalItemsGetter) {
      const total = totalItemsGetter();
      // Cache stringified total — only recompute when count changes
      if (total !== lastAriaTotal) {
        lastAriaTotal = total;
        lastAriaSetSize = String(total);
      }
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

    return {
      element,
      lastItemId: item.id,
      lastSelected: isSelected,
      lastFocused: isFocused,
      lastY: placement.y,
      lastX: placement.x,
      lastSize: placement.size,
      lastCrossSize: placement.crossSize,
      lastSeenFrame: frameCounter,
    };
  };

  /**
   * Render visible items using pre-calculated placements.
   *
   * Performance characteristics:
   * - Uses Set for O(1) visibility check (not O(n) .some())
   * - Skips template re-evaluation when item id + state unchanged
   * - Only updates position when coordinates changed
   * - Release grace period prevents boundary thrashing
   * - Released elements removed from DOM immediately
   */
  const render = (
    getItem: GetItemFn<T>,
    placements: ItemPlacement[],
    selectedIds: Set<string | number>,
    focusedIndex: number,
  ): void => {
    frameCounter++;

    // Repopulate reusable visibleSet — O(k) clear + O(k) add, no allocation
    visibleSet.clear();
    for (let i = 0; i < placements.length; i++) {
      visibleSet.add(placements[i]!.index);
    }

    // Release items no longer visible, with grace period to prevent
    // boundary thrashing (hover blink, CSS transition replay).
    // Items that just left the visible set keep their DOM element for
    // RELEASE_GRACE extra render cycles — if they re-enter, the same
    // element is reused with :hover state intact.
    for (const [index, tracked] of rendered) {
      if (visibleSet.has(index)) {
        tracked.lastSeenFrame = frameCounter;
      } else if (frameCounter - tracked.lastSeenFrame > RELEASE_GRACE) {
        pool.release(tracked.element);
        rendered.delete(index);
      }
    }

    // DocumentFragment for batched DOM insertion of new elements
    // (matches core renderer and grid renderer patterns)
    let fragment: DocumentFragment | null = null;

    // Render new or update existing items
    for (let pi = 0; pi < placements.length; pi++) {
      const placement = placements[pi]!;
      const itemIndex = placement.index;
      const item = getItem(itemIndex);
      if (!item) continue;

      const isSelected = selectedIds.has(item.id);
      const isFocused = itemIndex === focusedIndex;

      const existing = rendered.get(itemIndex);

      if (existing) {
        // ── Fast path: skip work when nothing changed ──
        const idChanged = existing.lastItemId !== item.id;
        const selectedChanged = existing.lastSelected !== isSelected;
        const focusedChanged = existing.lastFocused !== isFocused;
        const posChanged =
          existing.lastY !== placement.y ||
          existing.lastX !== placement.x;
        const sizeChanged =
          existing.lastSize !== placement.size ||
          existing.lastCrossSize !== placement.crossSize;

        // Template re-evaluation only when item data or selection/focus changed
        if (idChanged || selectedChanged || focusedChanged) {
          const state = getItemState(isSelected, isFocused);
          const result = template(item, itemIndex, state);
          applyTemplate(existing.element, result);
          applyClasses(existing.element, isSelected, isFocused);

          // Update data attributes
          existing.element.dataset.id = String(item.id);
          existing.element.ariaSelected = String(isSelected);

          existing.lastItemId = item.id;
          existing.lastSelected = isSelected;
          existing.lastFocused = isFocused;
        }

        // Size update when cross-axis or main-axis size changed (e.g. container resize)
        if (sizeChanged) {
          applySizeStyles(existing.element, placement);
          existing.lastSize = placement.size;
          existing.lastCrossSize = placement.crossSize;
        }

        // Position update only when coordinates changed
        if (posChanged) {
          positionElement(existing.element, placement);
          existing.lastY = placement.y;
          existing.lastX = placement.x;
        }
      } else {
        // Render new item — collect in fragment for batched insertion
        const tracked = renderItem(
          itemIndex,
          item,
          placement,
          isSelected,
          isFocused,
        );
        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(tracked.element);
        rendered.set(itemIndex, tracked);
      }
    }

    // Single DOM insertion for all new elements — minimizes reflows
    if (fragment) {
      itemsContainer.appendChild(fragment);
    }
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

  /**
   * Reorder DOM children so they follow logical data-index order.
   * Called on scroll idle for accessibility — screen readers traverse
   * DOM order, not visual (transform) order. Since items are
   * position:absolute, this has zero visual impact.
   */
  const sortDOM = (): void => {
    sortRenderedDOM(
      itemsContainer,
      rendered.keys(),
      (key) => rendered.get(key)?.element,
    );
  };

  return {
    render,
    getElement: (index: number): HTMLElement | undefined => rendered.get(index)?.element,
    sortDOM,
    clear,
    destroy,
  };
};