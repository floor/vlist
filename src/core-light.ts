/**
 * vlist/core-light - Ultra-Lightweight Virtual List (Fixed Heights Only)
 *
 * An even lighter variant of vlist/core that only supports fixed-height items.
 * Use this when all items have the same height and you need the absolute smallest bundle.
 *
 * ~3-4 KB minified vs ~10 KB for vlist/core vs ~42 KB for the full bundle.
 *
 * Supports:
 * - Fixed item heights only
 * - Container scrolling only
 * - Single item selection
 * - Instant scrollToIndex (no animation)
 * - setItems / appendItems / prependItems
 * - Events (scroll, range:change, selection:change)
 * - DOM element pooling & DocumentFragment batching
 *
 * Does NOT include (use vlist/core or full `vlist` if needed):
 * - Variable item heights
 * - Window scrolling
 * - Smooth scroll animation
 * - Single item mutations (updateItem/removeItem)
 * - Click event handling
 * - ResizeObserver / auto-resize
 * - Validation
 * - Selection / keyboard navigation
 * - Groups / sticky headers
 * - Compression (lists > ~100K items)
 * - Custom scrollbar
 * - Async data adapter / placeholders
 */

// =============================================================================
// Types
// =============================================================================

/** Base item interface — must have an id */
export interface VListItem {
  id: string | number;
  [key: string]: unknown;
}

/** State passed to template */
export interface ItemState {
  selected: boolean;
  focused: boolean;
}

/** Item template function */
export type ItemTemplate<T extends VListItem = VListItem> = (
  item: T,
  index: number,
  state: ItemState,
) => string | HTMLElement;

/** Visible range */
export interface Range {
  start: number;
  end: number;
}

/** Event handler / unsubscribe */
export type EventHandler<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/** Core event map */
export interface CoreEvents {
  scroll: { scrollTop: number; direction: "up" | "down" };
  "range:change": { range: Range };
  "selection:change": { selectedId: string | number | null };
}

/** Item configuration */
export interface CoreItemConfig<T extends VListItem = VListItem> {
  height: number;
  template: ItemTemplate<T>;
}

/** Core configuration */
export interface CoreConfig<T extends VListItem = VListItem> {
  container: HTMLElement | string;
  item: CoreItemConfig<T>;
  items?: T[];
  overscan?: number;
  classPrefix?: string;
  ariaLabel?: string;
}

/** Core VList instance */
export interface VListCore<T extends VListItem = VListItem> {
  readonly element: HTMLElement;
  readonly items: readonly T[];
  readonly total: number;

  setItems(items: T[]): void;
  appendItems(items: T[]): void;
  prependItems(items: T[]): void;

  scrollToIndex(index: number, align?: "start" | "center" | "end"): void;
  getScrollPosition(): number;

  selectItem(id: string | number): void;
  deselectItem(): void;
  getSelectedId(): string | number | null;

  on<K extends keyof CoreEvents>(
    event: K,
    handler: EventHandler<CoreEvents[K]>,
  ): Unsubscribe;
  off<K extends keyof CoreEvents>(
    event: K,
    handler: EventHandler<CoreEvents[K]>,
  ): void;

  destroy(): void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OVERSCAN = 3;
const DEFAULT_CLASS_PREFIX = "vlist";
const SCROLL_IDLE_TIMEOUT = 150;

// =============================================================================
// Height Cache (inlined — no compression dependency)
// =============================================================================

interface HeightCache {
  getOffset(index: number): number;
  getHeight(index: number): number;
  indexAtOffset(offset: number): number;
  getTotalHeight(): number;
  getTotal(): number;
  rebuild(totalItems: number): void;
}

const createHeightCache = (
  height: number,
  initialTotal: number,
): HeightCache => {
  let total = initialTotal;
  return {
    getOffset: (i) => i * height,
    getHeight: () => height,
    indexAtOffset: (offset) => {
      if (total === 0 || height === 0) return 0;
      return Math.max(0, Math.min(Math.floor(offset / height), total - 1));
    },
    getTotalHeight: () => total * height,
    getTotal: () => total,
    rebuild: (n) => {
      total = n;
    },
  };
};

// =============================================================================
// Event Emitter (inlined — tiny)
// =============================================================================

type Listeners = Record<string, Set<EventHandler<any>> | undefined>;

const createEmitter = () => {
  const listeners: Listeners = {};

  const on = (event: string, handler: EventHandler<any>): Unsubscribe => {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event]!.add(handler);
    return () => off(event, handler);
  };

  const off = (event: string, handler: EventHandler<any>): void => {
    listeners[event]?.delete(handler);
  };

  const emit = (event: string, payload: unknown): void => {
    listeners[event]?.forEach((h) => {
      try {
        h(payload);
      } catch (e) {
        console.error(`[vlist] Error in "${event}" handler:`, e);
      }
    });
  };

  const clear = (): void => {
    for (const key in listeners) delete listeners[key];
  };

  return { on, off, emit, clear };
};

// =============================================================================
// DOM Structure
// =============================================================================

interface DOMStructure {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
}

const resolveContainer = (container: HTMLElement | string): HTMLElement => {
  if (typeof container === "string") {
    const el = document.querySelector<HTMLElement>(container);
    if (!el) throw new Error(`[vlist] Container not found: ${container}`);
    return el;
  }
  return container;
};

const createDOMStructure = (
  container: HTMLElement,
  classPrefix: string,
  ariaLabel?: string,
): DOMStructure => {
  const root = document.createElement("div");
  root.className = classPrefix;
  root.setAttribute("role", "listbox");
  root.setAttribute("tabindex", "0");
  if (ariaLabel) root.setAttribute("aria-label", ariaLabel);

  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  viewport.style.overflow = "auto";
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";
  content.style.width = "100%";

  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.style.position = "relative";
  items.style.width = "100%";

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items };
};

// =============================================================================
// Element Pool
// =============================================================================

const createElementPool = (maxSize = 100) => {
  const pool: HTMLElement[] = [];

  const acquire = (): HTMLElement => {
    const el = pool.pop();
    if (el) return el;
    const newEl = document.createElement("div");
    newEl.setAttribute("role", "option");
    return newEl;
  };

  const release = (el: HTMLElement): void => {
    if (pool.length < maxSize) {
      el.className = "";
      el.textContent = "";
      el.removeAttribute("style");
      el.removeAttribute("data-index");
      el.removeAttribute("data-id");
      pool.push(el);
    }
  };

  const clear = (): void => {
    pool.length = 0;
  };

  return { acquire, release, clear };
};

// =============================================================================
// Range Calculation (no compression)
// =============================================================================

const calculateVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  heightCache: HeightCache,
  totalItems: number,
  out: Range,
): void => {
  if (totalItems === 0) {
    out.start = 0;
    out.end = 0;
    return;
  }
  const start = heightCache.indexAtOffset(scrollTop);
  let end = start;
  let accumulated = heightCache.getOffset(start) - scrollTop;
  while (end < totalItems - 1 && accumulated < containerHeight) {
    accumulated += heightCache.getHeight(end);
    end++;
  }
  out.start = start;
  out.end = Math.min(end, totalItems - 1);
};

const applyOverscan = (
  visible: Range,
  overscan: number,
  totalItems: number,
  out: Range,
): void => {
  out.start = Math.max(0, visible.start - overscan);
  out.end = Math.min(totalItems - 1, visible.end + overscan);
};

// =============================================================================
// Main Factory
// =============================================================================

/** Module-level instance counter for unique ARIA element IDs */
let coreInstanceId = 0;

/**
 * Create a lightweight virtual list (core).
 *
 * This is the minimal-footprint alternative to `createVList` from `vlist`.
 * Same essential behaviour, but without selection, groups, compression,
 * custom scrollbar, or async data adapter support.
 */
export const createVList = <T extends VListItem = VListItem>(
  config: CoreConfig<T>,
): VListCore<T> => {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const {
    item: itemConfig,
    items: initialItems,
    overscan = DEFAULT_OVERSCAN,
    classPrefix = DEFAULT_CLASS_PREFIX,
    ariaLabel,
  } = config;

  const { height: itemHeightConfig, template } = itemConfig;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let items: T[] = initialItems ? [...initialItems] : [];
  let isDestroyed = false;
  let lastScrollTop = 0;
  let selectedId: string | number | null = null;

  // ---------------------------------------------------------------------------
  // Domain components
  // ---------------------------------------------------------------------------

  // Unique ARIA ID prefix for this instance (avoids collisions with multiple lists)
  const ariaIdPrefix = `${classPrefix}-${coreInstanceId++}`;

  const containerElement = resolveContainer(config.container);
  const dom = createDOMStructure(containerElement, classPrefix, ariaLabel);
  const emitter = createEmitter();
  const heightCache = createHeightCache(itemHeightConfig, items.length);
  const pool = createElementPool();

  let containerHeight = dom.viewport.clientHeight;

  // Ranges (reused objects to avoid allocation)
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };
  const lastRenderRange: Range = { start: -1, end: -1 };

  // Rendered item tracking
  const rendered = new Map<number, HTMLElement>();

  // Reusable item state
  const itemState: ItemState = { selected: false, focused: false };

  // Pre-computed class names
  const baseClass = `${classPrefix}-item`;

  // Track aria-setsize to avoid redundant updates on existing items
  let lastAriaSetSize = "";

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  const applyTemplate = (
    element: HTMLElement,
    result: string | HTMLElement,
  ): void => {
    if (typeof result === "string") element.innerHTML = result;
    else element.replaceChildren(result);
  };

  const positionElement = (element: HTMLElement, index: number): void => {
    element.style.transform = `translateY(${Math.round(heightCache.getOffset(index))}px)`;
  };

  const renderItem = (index: number, item: T): HTMLElement => {
    const element = pool.acquire();
    element.className = baseClass;
    element.style.height = `${heightCache.getHeight(index)}px`;
    element.dataset.index = String(index);
    element.dataset.id = String(item.id);
    element.ariaSelected = "false";

    // ARIA: positional context for screen readers ("item 5 of 10,000")
    element.id = `${ariaIdPrefix}-item-${index}`;
    lastAriaSetSize = String(items.length);
    element.setAttribute("aria-setsize", lastAriaSetSize);
    element.setAttribute("aria-posinset", String(index + 1));

    // Update selection state
    const isSelected = item.id === selectedId;
    itemState.selected = isSelected;
    if (isSelected) {
      element.classList.add(`${classPrefix}-item--selected`);
    } else {
      element.classList.remove(`${classPrefix}-item--selected`);
    }

    applyTemplate(element, template(item, index, itemState));
    positionElement(element, index);
    return element;
  };

  // ---------------------------------------------------------------------------
  // Render pipeline
  // ---------------------------------------------------------------------------

  const updateContentHeight = (): void => {
    dom.content.style.height = `${heightCache.getTotalHeight()}px`;
  };

  const renderIfNeeded = (): void => {
    if (isDestroyed) return;

    calculateVisibleRange(
      lastScrollTop,
      containerHeight,
      heightCache,
      items.length,
      visibleRange,
    );
    applyOverscan(visibleRange, overscan, items.length, renderRange);

    // Bail if range unchanged
    if (
      renderRange.start === lastRenderRange.start &&
      renderRange.end === lastRenderRange.end
    ) {
      return;
    }

    // Check if aria-setsize changed (total items mutated) — update existing items only when needed
    const currentSetSize = String(items.length);
    const setSizeChanged = currentSetSize !== lastAriaSetSize;
    lastAriaSetSize = currentSetSize;

    // Remove items outside new range
    for (const [index, element] of rendered) {
      if (index < renderRange.start || index > renderRange.end) {
        element.remove();
        pool.release(element);
        rendered.delete(index);
      }
    }

    // Add / update items in range
    const fragment = document.createDocumentFragment();
    const newElements: Array<{ index: number; element: HTMLElement }> = [];

    for (let i = renderRange.start; i <= renderRange.end; i++) {
      const item = items[i];
      if (!item) continue;

      const existing = rendered.get(i);
      if (existing) {
        // Check if item identity changed
        const existingId = existing.dataset.id;
        const newId = String(item.id);
        if (existingId !== newId) {
          applyTemplate(existing, template(item, i, itemState));
          existing.dataset.id = newId;
          existing.style.height = `${heightCache.getHeight(i)}px`;
        }

        // Update selection state
        const isSelected = item.id === selectedId;
        itemState.selected = isSelected;
        if (isSelected) {
          existing.classList.add(`${classPrefix}-item--selected`);
        } else {
          existing.classList.remove(`${classPrefix}-item--selected`);
        }

        positionElement(existing, i);

        // Update aria-setsize on existing items only when total changed (rare)
        if (setSizeChanged) {
          existing.setAttribute("aria-setsize", lastAriaSetSize);
        }
      } else {
        const element = renderItem(i, item);
        fragment.appendChild(element);
        newElements.push({ index: i, element });
      }
    }

    if (newElements.length > 0) {
      dom.items.appendChild(fragment);
      for (const { index, element } of newElements) {
        rendered.set(index, element);
      }
    }

    lastRenderRange.start = renderRange.start;
    lastRenderRange.end = renderRange.end;

    emitter.emit("range:change", {
      range: { start: renderRange.start, end: renderRange.end },
    });
  };

  const forceRender = (): void => {
    lastRenderRange.start = -1;
    lastRenderRange.end = -1;
    renderIfNeeded();
  };

  // ---------------------------------------------------------------------------
  // Scroll handling
  // ---------------------------------------------------------------------------

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const onScrollFrame = (): void => {
    if (isDestroyed) return;

    const scrollTop = dom.viewport.scrollTop;
    const effectiveScrollTop = Math.max(0, scrollTop);

    const direction = effectiveScrollTop >= lastScrollTop ? "down" : "up";

    // Add scrolling class
    if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
      dom.root.classList.add(`${classPrefix}--scrolling`);
    }

    lastScrollTop = effectiveScrollTop;
    renderIfNeeded();

    emitter.emit("scroll", { scrollTop: effectiveScrollTop, direction });

    // Idle detection
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      dom.root.classList.remove(`${classPrefix}--scrolling`);
    }, SCROLL_IDLE_TIMEOUT);
  };

  dom.viewport.addEventListener("scroll", onScrollFrame, { passive: true });

  // ---------------------------------------------------------------------------
  // Selection methods
  // ---------------------------------------------------------------------------

  const selectItem = (id: string | number): void => {
    if (selectedId === id) return;
    selectedId = id;
    forceRender();
    emitter.emit("selection:change", { selectedId });
  };

  const deselectItem = (): void => {
    if (selectedId === null) return;
    selectedId = null;
    forceRender();
    emitter.emit("selection:change", { selectedId: null });
  };

  const getSelectedId = (): string | number | null => selectedId;

  // ---------------------------------------------------------------------------
  // Scroll methods
  // ---------------------------------------------------------------------------

  const scrollToIndex = (
    index: number,
    align: "start" | "center" | "end" = "start",
  ): void => {
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    const offset = heightCache.getOffset(clamped);
    const itemHeight = heightCache.getHeight(clamped);
    const maxScroll = Math.max(
      0,
      heightCache.getTotalHeight() - containerHeight,
    );

    let position = offset;
    if (align === "center")
      position = offset - containerHeight / 2 + itemHeight / 2;
    else if (align === "end") position = offset - containerHeight + itemHeight;

    position = Math.max(0, Math.min(position, maxScroll));
    dom.viewport.scrollTop = position;
  };

  // ---------------------------------------------------------------------------
  // Data methods
  // ---------------------------------------------------------------------------

  const rebuildAndRender = (): void => {
    heightCache.rebuild(items.length);
    updateContentHeight();
    forceRender();
  };

  const setItems = (newItems: T[]): void => {
    items = [...newItems];
    rebuildAndRender();
  };

  const appendItems = (newItems: T[]): void => {
    items = [...items, ...newItems];
    rebuildAndRender();
  };

  const prependItems = (newItems: T[]): void => {
    items = [...newItems, ...items];
    rebuildAndRender();
  };

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  const destroy = (): void => {
    if (isDestroyed) return;
    isDestroyed = true;

    // Remove event listeners
    dom.viewport.removeEventListener("scroll", onScrollFrame);
    if (idleTimer) clearTimeout(idleTimer);

    // Release pooled elements
    for (const [, element] of rendered) {
      element.remove();
      pool.release(element);
    }
    rendered.clear();
    pool.clear();
    emitter.clear();

    dom.root.remove();
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  updateContentHeight();
  renderIfNeeded();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    get element() {
      return dom.root;
    },

    get items() {
      return items as readonly T[];
    },

    get total() {
      return items.length;
    },

    setItems,
    appendItems,
    prependItems,

    scrollToIndex,
    getScrollPosition: () => lastScrollTop,

    selectItem,
    deselectItem,
    getSelectedId,

    on: <K extends keyof CoreEvents>(
      event: K,
      handler: EventHandler<CoreEvents[K]>,
    ): Unsubscribe => emitter.on(event as string, handler),

    off: <K extends keyof CoreEvents>(
      event: K,
      handler: EventHandler<CoreEvents[K]>,
    ): void => emitter.off(event as string, handler),

    destroy,
  };
};
