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
} from "../types";

import type { CompressionState } from "./viewport";
import type { SizeCache } from "./sizes";

import { PLACEHOLDER_ID_PREFIX } from "../constants";
import { sortRenderedDOM } from "./sort";

/**
 * Optional compression position calculator.
 * Injected by the monolithic factory or the withCompression feature.
 * When not provided, the renderer uses simple sizeCache offsets.
 */
export type CompressedPositionFn = (
  index: number,
  scrollTop: number,
  sizeCache: SizeCache,
  totalItems: number,
  containerHeight: number,
  compression: CompressionState,
  rangeStart?: number,
) => number;

/**
 * Optional compression state getter.
 * Injected by the monolithic factory or the withCompression feature.
 * When not provided, the renderer assumes no compression.
 */
export type CompressionStateFn = (
  totalItems: number,
  sizeCache: SizeCache,
) => CompressionState;

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
  scrollPosition: number;
  totalItems: number;
  containerSize: number;
  rangeStart: number;
  /** Pre-computed compression state (includes force flag) */
  compression?: CompressionState;
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
// Release grace period
// =============================================================================

/**
 * Number of render cycles to keep an item alive after it leaves the visible range.
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
  /** Item id at last render (to detect data changes / placeholder replacement) */
  lastItemId: string | number;
  /** Selected state at last render */
  lastSelected: boolean;
  /** Focused state at last render */
  lastFocused: boolean;
  /** Computed offset at last render (to detect position changes) */
  lastOffset: number;
  /** Render frame when this item was last in the visible range */
  lastSeenFrame: number;
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
  sizeCache: SizeCache,
  classPrefix: string,
  totalItemsGetter?: () => number,
  ariaIdPrefix?: string,
  horizontal?: boolean,
  crossAxisSize?: number,
  compressionFns?: {
    getState: CompressionStateFn;
    getPosition: CompressedPositionFn;
  },
  striped?: boolean | "data" | "even" | "odd",
  stripeIndexFn?: () => (index: number) => number,
): Renderer<T> => {
  const pool = createElementPool("div");
  const rendered = new Map<number, TrackedItem>();

  // Cache compression state to avoid recalculating
  let cachedCompression: CompressionState | null = null;
  let cachedTotalItems = 0;

  // Frame counter for release grace period
  let frameCounter = 0;

  // Cached stripe index function — resolved once per render frame, not per item
  let cachedStripeFn: ((index: number) => number) | null = null;

  // Track aria-setsize to avoid redundant updates on existing items
  let lastAriaSetSize = "";
  let lastAriaTotal = -1;

  /**
   * Get or update compression state.
   * When compression functions are not injected, returns a trivial
   * "not compressed" state — no compression module imported.
   */
  const getCompression = (totalItems: number): CompressionState => {
    if (cachedCompression && cachedTotalItems === totalItems) {
      return cachedCompression;
    }
    if (compressionFns) {
      cachedCompression = compressionFns.getState(totalItems, sizeCache);
    } else {
      const h = sizeCache.getTotalSize();
      cachedCompression = {
        isCompressed: false,
        actualSize: h,
        virtualSize: h,
        ratio: 1,
      };
    }
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
    if (horizontal) {
      element.style.width = `${sizeCache.getSize(index)}px`;
      if (crossAxisSize != null) {
        element.style.height = `${crossAxisSize}px`;
      }
    } else {
      element.style.height = `${sizeCache.getSize(index)}px`;
    }
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

      if (compression.isCompressed && compressionFns) {
        // Use compression-aware positioning (injected)
        return compressionFns.getPosition(
          index,
          compressionCtx.scrollPosition,
          sizeCache,
          compressionCtx.totalItems,
          compressionCtx.containerSize,
          compression,
          compressionCtx.rangeStart,
        );
      }
    }
    // Normal positioning (non-compressed or no context)
    return sizeCache.getOffset(index);
  };

  // Pre-computed class names for toggle operations
  const baseClass = `${classPrefix}-item`;
  const selectedClass = `${classPrefix}-item--selected`;
  const focusedClass = `${classPrefix}-item--focused`;
  const placeholderClass = `${classPrefix}-item--placeholder`;
  const replacedClass = `${classPrefix}-item--replaced`;
  const oddClass = `${classPrefix}-item--odd`;

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
   * Render a single item — returns a TrackedItem for change tracking.
   */
  const renderItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
    compressionCtx?: CompressionContext,
  ): TrackedItem => {
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

    // ARIA: positional context for screen readers ("item 5 of 10,000")
    if (ariaIdPrefix) {
      element.id = `${ariaIdPrefix}-item-${index}`;
    }
    if (totalItemsGetter) {
      const total = totalItemsGetter();
      if (total !== lastAriaTotal) {
        lastAriaTotal = total;
        lastAriaSetSize = String(total);
      }
      element.setAttribute("aria-setsize", lastAriaSetSize);
      element.setAttribute("aria-posinset", String(index + 1));
    }

    // Apply template
    const result = template(item, index, state);
    applyTemplate(element, result);

    // Apply state-dependent classes (selected, focused)
    applyClasses(element, isSelected, isFocused);

    // Placeholder class — detected via ID prefix
    if (String(item.id).startsWith(PLACEHOLDER_ID_PREFIX)) {
      element.classList.add(placeholderClass);
    }

    // Striped: toggle odd class based on logical index (not DOM order)
    // String modes ("data"/"even"/"odd"): use cachedStripeFn to map layout index → stripe index
    if (striped) {
      if (cachedStripeFn) {
        const si = cachedStripeFn(index);
        if (si < 0) element.classList.remove(oddClass);
        else element.classList.toggle(oddClass, (si & 1) === 1);
      } else {
        element.classList.toggle(oddClass, (index & 1) === 1);
      }
    }

    const offset = calculateOffset(index, compressionCtx);
    element.style.transform = horizontal
      ? `translateX(${Math.round(offset)}px)`
      : `translateY(${Math.round(offset)}px)`;

    return {
      element,
      lastItemId: item.id,
      lastSelected: isSelected,
      lastFocused: isFocused,
      lastOffset: offset,
      lastSeenFrame: frameCounter,
    };
  };

  /**
   * Render items for a range.
   *
   * Optimizations vs. naive approach:
   * - Release grace period: items outside the range keep their DOM element for
   *   RELEASE_GRACE extra render cycles, preventing hover blink and CSS
   *   transition replay on boundary items.
   * - Change tracking: template re-evaluation, class toggles, position updates,
   *   and aria writes are all skipped when the tracked state hasn't changed.
   * - Lazy DocumentFragment: only allocated when new items actually enter the
   *   viewport — zero allocation on scroll-only frames.
   */
  const render = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    compressionCtx?: CompressionContext,
  ): void => {
    frameCounter++;

    // Release items outside the new range, with grace period to prevent
    // boundary thrashing (hover blink, CSS transition replay).
    // Items that just left the visible range keep their DOM element for
    // RELEASE_GRACE extra render cycles — if they re-enter, the same
    // element is reused with :hover state intact.
    for (const [index, tracked] of rendered) {
      if (index >= range.start && index <= range.end) {
        tracked.lastSeenFrame = frameCounter;
      } else if (frameCounter - tracked.lastSeenFrame > RELEASE_GRACE) {
        tracked.element.remove();
        pool.release(tracked.element);
        rendered.delete(index);
      }
    }

    // Check if aria-setsize changed (total items mutated) — update existing items only when needed
    let setSizeChanged = false;
    if (totalItemsGetter) {
      const total = totalItemsGetter();
      if (total !== lastAriaTotal) {
        lastAriaTotal = total;
        lastAriaSetSize = String(total);
        setSizeChanged = true;
      }
    }

    // Resolve stripe function once per frame (not per item)
    cachedStripeFn = (typeof striped === "string" && stripeIndexFn) ? stripeIndexFn() : null;

    // DocumentFragment for batched DOM insertion — only allocated when needed
    let fragment: DocumentFragment | null = null;

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
        // ── Fast path: skip work when nothing changed ──
        const idChanged = existing.lastItemId !== item.id;
        const selectedChanged = existing.lastSelected !== isSelected;
        const focusedChanged = existing.lastFocused !== isFocused;

        if (idChanged) {
          const existingId = String(existing.lastItemId);
          const newId = String(item.id);
          const wasPlaceholder = existingId.startsWith(PLACEHOLDER_ID_PREFIX);
          const isPlaceholder = newId.startsWith(PLACEHOLDER_ID_PREFIX);

          // Re-apply template when item data changes (placeholder -> real data)
          const state = getItemState(isSelected, isFocused);
          const result = template(item, i, state);
          applyTemplate(existing.element, result);
          existing.element.dataset.id = newId;
          // Update height in case variable heights differ for the new item
          applyStaticStyles(existing.element, i);

          // Toggle placeholder class
          existing.element.classList.toggle(placeholderClass, isPlaceholder);

          // Fade-in animation when placeholder is replaced with real data
          if (wasPlaceholder && !isPlaceholder) {
            existing.element.classList.add(replacedClass);
            setTimeout(() => {
              existing.element.classList.remove(replacedClass);
            }, 300);
          }

          existing.lastItemId = item.id;
        }

        // Class + aria updates only when selection/focus changed
        if (idChanged || selectedChanged || focusedChanged) {
          applyClasses(existing.element, isSelected, isFocused);
          existing.element.ariaSelected = String(isSelected);
          existing.lastSelected = isSelected;
          existing.lastFocused = isFocused;
        }

        // Position update only when offset changed
        const offset = calculateOffset(i, compressionCtx);
        if (existing.lastOffset !== offset) {
          existing.element.style.transform = horizontal
            ? `translateX(${Math.round(offset)}px)`
            : `translateY(${Math.round(offset)}px)`;
          existing.lastOffset = offset;
        }

        // Update aria-setsize on existing items only when total changed (rare)
        if (setSizeChanged) {
          existing.element.setAttribute("aria-setsize", lastAriaSetSize);
        }
      } else {
        // Render new item — collect in fragment for batched insertion
        const tracked = renderItem(
          i,
          item,
          isSelected,
          isFocused,
          compressionCtx,
        );
        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(tracked.element);
        rendered.set(i, tracked);
      }
    }

    // Single DOM insertion for all new elements — minimizes reflows
    if (fragment) {
      itemsContainer.appendChild(fragment);
    }
  };

  /**
   * Update positions of all rendered items (for compressed scrolling).
   * Leverages change tracking — skips items whose offset hasn't changed.
   */
  const updatePositions = (compressionCtx: CompressionContext): void => {
    for (const [index, tracked] of rendered) {
      const offset = calculateOffset(index, compressionCtx);
      if (tracked.lastOffset !== offset) {
        tracked.element.style.transform = horizontal
          ? `translateX(${Math.round(offset)}px)`
          : `translateY(${Math.round(offset)}px)`;
        tracked.lastOffset = offset;
      }
    }
  };

  /**
   * Update a single item (explicit API call).
   * Always re-applies the template because the caller signals that the item
   * data has changed — even when the id stays the same (e.g. name update).
   * Updates TrackedItem fields so subsequent scroll frames skip redundant work.
   */
  const updateItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing) return;

    const state = getItemState(isSelected, isFocused);
    const result = template(item, index, state);

    applyTemplate(existing.element, result);
    applyClasses(existing.element, isSelected, isFocused);
    existing.element.dataset.id = String(item.id);
    existing.element.ariaSelected = String(isSelected);

    existing.lastItemId = item.id;
    existing.lastSelected = isSelected;
    existing.lastFocused = isFocused;
  };

  /**
   * Update only CSS classes on a rendered item (no template re-evaluation).
   * Leverages change tracking — skips work when state is already current.
   */
  const updateItemClasses = (
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing) return;

    const selectedChanged = existing.lastSelected !== isSelected;
    const focusedChanged = existing.lastFocused !== isFocused;

    if (selectedChanged || focusedChanged) {
      applyClasses(existing.element, isSelected, isFocused);
      existing.lastSelected = isSelected;
      existing.lastFocused = isFocused;
    }
  };

  /**
   * Get element by index
   */
  const getElement = (index: number): HTMLElement | undefined => {
    return rendered.get(index)?.element;
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

  /**
   * Clear all rendered items
   */
  const clear = (): void => {
    for (const [, tracked] of rendered) {
      tracked.element.remove();
      pool.release(tracked.element);
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
    sortDOM,
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
  ariaLabel?: string,
  horizontal?: boolean,
  interactive?: boolean,
): DOMStructure => {
  // Root element
  const root = document.createElement("div");
  root.className = `${classPrefix}`;
  if (interactive !== false) root.setAttribute("tabindex", "0");

  if (horizontal) {
    root.classList.add(`${classPrefix}--horizontal`);
  }

  // Viewport (scrollable container)
  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  viewport.setAttribute("tabindex", "-1");
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  if (horizontal) {
    viewport.style.overflowX = "auto";
    viewport.style.overflowY = "hidden";
  } else {
    viewport.style.overflow = "auto";
  }

  // Content (sets the total scrollable size)
  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";

  if (horizontal) {
    content.style.height = "100%";
    // Width will be set by updateContentWidth
  } else {
    content.style.width = "100%";
    // Height will be set by updateContentHeight
  }

  // Items container (holds rendered items)
  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.setAttribute("role", "listbox");
  if (ariaLabel) items.setAttribute("aria-label", ariaLabel);
  if (horizontal) items.setAttribute("aria-orientation", "horizontal");
  items.style.position = "relative";

  if (horizontal) {
    items.style.height = "100%";
  } else {
    items.style.width = "100%";
  }

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
 * Update content width for horizontal virtual scrolling
 */
export const updateContentWidth = (
  content: HTMLElement,
  totalWidth: number,
): void => {
  content.style.width = `${totalWidth}px`;
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
