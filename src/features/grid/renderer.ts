/**
 * vlist - Grid Renderer
 * Renders items in a 2D grid layout within the virtual scroll container.
 *
 * Extends the base renderer pattern but positions items using both
 * row offsets (translateY from the size cache) and column offsets
 * (translateX calculated from column index and container width).
 *
 * Key differences from the list renderer:
 * - Items are positioned with translate(x, y) instead of just translateY(y)
 * - Item width is set to columnWidth (containerWidth / columns - gaps)
 * - The "index" in the rendered map is the FLAT ITEM INDEX (not row index)
 * - Row offsets come from the size cache (which operates on row indices)
 * - Column offsets are calculated from itemIndex % columns
 */

import type {
  VListItem,
  ItemTemplate,
  ItemState,
  Range,
  RenderedItem,
} from "../../types";

import {
  getCompressionState,
  calculateCompressedItemPosition,
  type CompressionState,
} from "../../rendering/scale";
import type { SizeCache } from "../../rendering/sizes";
import type { CompressionContext } from "../../rendering/renderer";
import type { GridLayout } from "./types";
import { isGroupHeader } from "../sections/types";

// =============================================================================
// Types
// =============================================================================

/** Grid renderer instance */
export interface GridRenderer<T extends VListItem = VListItem> {
  /** Render items for a flat item range, positioned in a 2D grid */
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

  /** Get rendered item element by flat item index */
  getElement: (index: number) => HTMLElement | undefined;

  /** Update container width (call on resize) */
  updateContainerWidth: (width: number) => void;

  /** Clear all rendered items */
  clear: () => void;

  /** Destroy renderer and cleanup */
  destroy: () => void;
}

// =============================================================================
// Element Pool (grid-specific: no left/right reset needed)
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
      element.removeAttribute("data-row");
      element.removeAttribute("data-col");

      pool.push(element);
    }
  };

  const clear = (): void => {
    pool.length = 0;
  };

  return { acquire, release, clear };
};

// =============================================================================
// Grid Renderer Factory
// =============================================================================

/**
 * Create a grid renderer for managing DOM elements in a 2D layout.
 *
 * The grid renderer receives flat item ranges (not row ranges) and
 * positions each item at the correct (row, col) coordinate.
 *
 * @param itemsContainer - The DOM element that holds rendered items
 * @param template - Item template function
 * @param sizeCache - Size cache operating on ROW indices
 * @param gridLayout - Grid layout for row/col calculations
 * @param classPrefix - CSS class prefix
 * @param initialContainerWidth - Initial container width for column sizing
 * @param totalItemsGetter - Optional getter for total item count (for aria-setsize)
 * @param ariaIdPrefix - Optional unique prefix for element IDs (for aria-activedescendant)
 */
export const createGridRenderer = <T extends VListItem = VListItem>(
  itemsContainer: HTMLElement,
  template: ItemTemplate<T>,
  sizeCache: SizeCache,
  gridLayout: GridLayout,
  classPrefix: string,
  initialContainerWidth: number,
  totalItemsGetter?: () => number,
  ariaIdPrefix?: string,
): GridRenderer<T> => {
  const pool = createElementPool();
  const rendered = new Map<number, RenderedItem>();

  let containerWidth = initialContainerWidth;

  // Track if groups are active (affects size cache indexing)
  let groupsActive = false;

  // Cache compression state
  let cachedCompression: CompressionState | null = null;
  let cachedTotalRows = 0;

  // Track aria-setsize to avoid redundant updates on existing items
  let lastAriaSetSize = "";

  const getCompression = (totalRows: number): CompressionState => {
    if (cachedCompression && cachedTotalRows === totalRows) {
      return cachedCompression;
    }
    cachedCompression = getCompressionState(totalRows, sizeCache);
    cachedTotalRows = totalRows;
    return cachedCompression;
  };

  // Reusable item state to avoid allocation per render
  const reusableItemState: ItemState = { selected: false, focused: false };

  const getItemState = (isSelected: boolean, isFocused: boolean): ItemState => {
    reusableItemState.selected = isSelected;
    reusableItemState.focused = isFocused;
    return reusableItemState;
  };

  // Pre-computed class names
  const baseClass = `${classPrefix}-item ${classPrefix}-grid-item`;
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
   * Calculate the Y offset for an item (based on its row).
   * Uses compression-aware positioning for large grids.
   */
  const calculateRowOffset = (
    itemIndex: number,
    compressionCtx?: CompressionContext,
  ): number => {
    const row = gridLayout.getRow(itemIndex);

    if (compressionCtx) {
      const totalRows = compressionCtx.totalItems; // In grid mode, totalItems = totalRows
      const compression = getCompression(totalRows);

      if (compression.isCompressed) {
        return calculateCompressedItemPosition(
          row,
          compressionCtx.scrollPosition,
          sizeCache,
          totalRows,
          compressionCtx.containerSize,
          compression,
          compressionCtx.rangeStart,
        );
      }
    }

    // Normal positioning: row offset from size cache
    return sizeCache.getOffset(row);
  };

  /**
   * Position an element at the correct (col, row) offset.
   * Uses translate(x, y) for efficient GPU-accelerated positioning.
   * Group headers are positioned at x=0 to span full width.
   */
  const positionElement = (
    element: HTMLElement,
    itemIndex: number,
    compressionCtx?: CompressionContext,
  ): void => {
    // Check if this is a group header - position at full width
    const isHeader = element.dataset.id?.startsWith("__group_header");

    const col = isHeader ? 0 : gridLayout.getCol(itemIndex);
    const x = isHeader ? 0 : gridLayout.getColumnOffset(col, containerWidth);

    // Y position: when groups are active, calculate by summing each row's height once
    let y: number;
    if (groupsActive) {
      // Grouped grid: sum the height of each row before this item's row
      // Each row height should only be counted once, not per-item
      const itemRow = gridLayout.getRow(itemIndex);
      let offset = 0;
      const rowsSeen = new Set<number>();

      // For each item before this one, add its row's height only once
      for (let i = 0; i < itemIndex; i++) {
        const prevItemRow = gridLayout.getRow(i);
        if (prevItemRow < itemRow && !rowsSeen.has(prevItemRow)) {
          const height = sizeCache.getSize(i);
          offset += height;
          rowsSeen.add(prevItemRow);
        }
      }

      y = offset;
    } else {
      // Regular grid: size cache is row-based
      y = calculateRowOffset(itemIndex, compressionCtx);
    }

    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  /**
   * Apply size styles to an element (width from column, height from row height).
   * Group headers get full container width instead of column width.
   */
  const applySizeStyles = (element: HTMLElement, itemIndex: number): void => {
    // Check if this is a group header - use full width
    const isHeader = element.dataset.id?.startsWith("__group_header");

    const colWidth = isHeader
      ? containerWidth
      : gridLayout.getColumnWidth(containerWidth);

    // Height lookup depends on whether groups are active
    // Grouped grids: size cache uses ITEM indices
    // Regular grids: size cache uses ROW indices
    let itemHeight: number;
    if (groupsActive || isHeader) {
      // Grouped grid: size cache is item-based
      itemHeight = sizeCache.getSize(itemIndex) - gridLayout.gap;
    } else {
      // Regular grid: size cache is row-based
      const row = gridLayout.getRow(itemIndex);
      itemHeight = sizeCache.getSize(row) - gridLayout.gap;
    }

    element.style.width = `${colWidth}px`;
    element.style.height = `${itemHeight}px`;
  };

  /**
   * Render a single grid item
   */
  const renderItem = (
    itemIndex: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
    compressionCtx?: CompressionContext,
  ): HTMLElement => {
    const element = pool.acquire();
    const state = getItemState(isSelected, isFocused);

    // Apply base class
    element.className = baseClass;

    // Set data attributes
    element.dataset.index = String(itemIndex);
    element.dataset.id = String(item.id);
    element.dataset.row = String(gridLayout.getRow(itemIndex));
    element.dataset.col = String(gridLayout.getCol(itemIndex));
    element.ariaSelected = String(isSelected);

    // ARIA: positional context for screen readers ("item 5 of 10,000")
    if (ariaIdPrefix) {
      element.id = `${ariaIdPrefix}-item-${itemIndex}`;
    }
    if (totalItemsGetter) {
      lastAriaSetSize = String(totalItemsGetter());
      element.setAttribute("aria-setsize", lastAriaSetSize);
      element.setAttribute("aria-posinset", String(itemIndex + 1));
    }

    // Apply sizing
    applySizeStyles(element, itemIndex);

    // Apply template
    const result = template(item, itemIndex, state);
    applyTemplate(element, result);

    // Apply state classes and position
    applyClasses(element, isSelected, isFocused);
    positionElement(element, itemIndex, compressionCtx);

    return element;
  };

  /**
   * Render items for a flat item range, positioned in a 2D grid.
   *
   * The range is in flat item indices (not row indices).
   * Items are positioned using translate(colOffset, rowOffset).
   */
  const render = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    compressionCtx?: CompressionContext,
  ): void => {
    // Detect if groups are active by checking if ANY item in the dataset is a header
    // Don't check items[0] because it's relative to the render range, not the full dataset
    // Instead, check if the first item in the full range is a header
    if (range.start === 0 && items.length > 0) {
      groupsActive = isGroupHeader(items[0]);
    }
    // Once groupsActive is true, it stays true (groups don't disappear mid-scroll)

    // Remove items outside the new range
    for (const [index, renderedItem] of rendered) {
      if (index < range.start || index > range.end) {
        renderedItem.element.remove();
        pool.release(renderedItem.element);
        rendered.delete(index);
      }
    }

    // Check if aria-setsize changed (total items mutated) — update existing items only when needed
    let setSizeChanged = false;
    if (totalItemsGetter) {
      const currentSetSize = String(totalItemsGetter());
      setSizeChanged = currentSetSize !== lastAriaSetSize;
      lastAriaSetSize = currentSetSize;
    }

    // Collect new elements for batched DOM insertion
    const fragment = document.createDocumentFragment();
    const newElements: Array<{ index: number; element: HTMLElement }> = [];

    // Add/update items in range
    for (let i = range.start; i <= range.end; i++) {
      // Items array is 0-indexed relative to range.start
      const itemIndex = i - range.start;
      const item = items[itemIndex];
      if (!item) {
        console.warn(
          `⚠️ RENDER: Missing item at index ${i} (range: ${range.start}-${range.end}, items.length: ${items.length})`,
        );
        continue;
      }

      const isSelected = selectedIds.has(item.id);
      const isFocused = i === focusedIndex;
      const existing = rendered.get(i);

      if (existing) {
        // Check if the item data changed
        const existingId = existing.element.dataset.id;
        const newId = String(item.id);
        const itemChanged = existingId !== newId;

        if (itemChanged) {
          const state = getItemState(isSelected, isFocused);
          const result = template(item, i, state);
          applyTemplate(existing.element, result);
          existing.element.dataset.id = newId;
          existing.element.dataset.row = String(gridLayout.getRow(i));
          existing.element.dataset.col = String(gridLayout.getCol(i));
          applySizeStyles(existing.element, i);
        }

        // Always update classes, selection, and position
        applyClasses(existing.element, isSelected, isFocused);
        existing.element.ariaSelected = String(isSelected);
        positionElement(existing.element, i, compressionCtx);

        // Update aria-setsize on existing items only when total changed (rare)
        if (setSizeChanged) {
          existing.element.setAttribute("aria-setsize", lastAriaSetSize);
        }
      } else {
        // Render new element and add to fragment
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

    // Batch append all new elements
    if (newElements.length > 0) {
      itemsContainer.appendChild(fragment);
      for (const { index, element } of newElements) {
        rendered.set(index, { index, element });
      }
    }
  };

  /**
   * Update positions of all rendered items (for compressed scrolling)
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
      applySizeStyles(existing.element, index);
    }
  };

  /**
   * Update only CSS classes on a rendered item
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
   * Get element by flat item index
   */
  const getElement = (index: number): HTMLElement | undefined => {
    return rendered.get(index)?.element;
  };

  /**
   * Update container width (call on resize).
   * Re-sizes and repositions all rendered items.
   */
  const updateContainerWidth = (width: number): void => {
    if (Math.abs(width - containerWidth) < 1) return;
    containerWidth = width;

    // Update size and position of all rendered elements
    for (const [index, renderedItem] of rendered) {
      applySizeStyles(renderedItem.element, index);
      positionElement(renderedItem.element, index);
    }
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
    updateContainerWidth,
    clear,
    destroy,
  };
};
