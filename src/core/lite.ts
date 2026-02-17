/**
 * vlist/core - Lightweight Virtual List
 *
 * A self-contained, minimal virtual list factory for the common case:
 * static or streaming lists that don't need selection, groups,
 * compression, custom scrollbar, or async data adapters.
 *
 * ~10 KB minified vs ~42 KB for the full bundle.
 *
 * Supports:
 * - Fixed and variable item heights
 * - scrollToIndex with smooth animation
 * - setItems / appendItems / prependItems / updateItem / removeItem
 * - Events (scroll, item:click, range:change, resize)
 * - Window (document) scrolling
 * - ResizeObserver for container resize
 * - DOM element pooling & DocumentFragment batching
 *
 * Does NOT include (use full `vlist` if needed):
 * - Selection / keyboard navigation
 * - Groups / sticky headers
 * - Compression (lists > ~100K items)
 * - Custom scrollbar
 * - Async data adapter / placeholders
 * - Velocity tracking / load cancellation
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

/** Options for scrollToIndex */
export interface ScrollToOptions {
  align?: "start" | "center" | "end";
  behavior?: "auto" | "smooth";
  duration?: number;
}

/** Scroll position snapshot for save/restore */
export interface CoreScrollSnapshot {
  /** First visible item index */
  index: number;
  /** Pixel offset within the first visible item (how far it's scrolled off) */
  offsetInItem: number;
}

/** Event handler / unsubscribe */
export type EventHandler<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/** Core event map */
export interface CoreEvents<T extends VListItem = VListItem> {
  "item:click": { item: T; index: number; event: MouseEvent };
  "item:dblclick": { item: T; index: number; event: MouseEvent };
  scroll: { scrollTop: number; direction: "up" | "down" };
  "range:change": { range: Range };
  resize: { height: number; width: number };
}

/** Item configuration */
export interface CoreItemConfig<T extends VListItem = VListItem> {
  height: number | ((index: number) => number);
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
  scrollElement?: Window;
}

/** Core VList instance */
export interface VListCore<T extends VListItem = VListItem> {
  readonly element: HTMLElement;
  readonly items: readonly T[];
  readonly total: number;

  setItems(items: T[]): void;
  appendItems(items: T[]): void;
  prependItems(items: T[]): void;
  updateItem(id: string | number, updates: Partial<T>): void;
  removeItem(id: string | number): void;

  scrollToIndex(
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ): void;
  scrollToItem(
    id: string | number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ): void;
  cancelScroll(): void;
  getScrollPosition(): number;

  /** Get a snapshot of the current scroll position for save/restore */
  getScrollSnapshot(): CoreScrollSnapshot;
  /** Restore scroll position from a snapshot */
  restoreScroll(snapshot: CoreScrollSnapshot): void;

  on<K extends keyof CoreEvents<T>>(
    event: K,
    handler: EventHandler<CoreEvents<T>[K]>,
  ): Unsubscribe;
  off<K extends keyof CoreEvents<T>>(
    event: K,
    handler: EventHandler<CoreEvents<T>[K]>,
  ): void;

  destroy(): void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OVERSCAN = 3;
const DEFAULT_CLASS_PREFIX = "vlist";
const DEFAULT_SMOOTH_DURATION = 300;
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
  height: number | ((index: number) => number),
  initialTotal: number,
): HeightCache => {
  if (typeof height === "number") {
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
  }

  // Variable heights — prefix sums
  let total = initialTotal;
  let prefixSums = new Float64Array(0);

  const build = (n: number): void => {
    total = n;
    prefixSums = new Float64Array(n + 1);
    prefixSums[0] = 0;
    for (let i = 0; i < n; i++) {
      prefixSums[i + 1] = prefixSums[i]! + height(i);
    }
  };

  build(initialTotal);

  return {
    getOffset: (index) => {
      if (index <= 0) return 0;
      if (index >= total) return prefixSums[total] as number;
      return prefixSums[index] as number;
    },
    getHeight: (index) => height(index),
    indexAtOffset: (offset) => {
      if (total === 0) return 0;
      if (offset <= 0) return 0;
      if (offset >= prefixSums[total]!) return total - 1;
      let lo = 0;
      let hi = total - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (prefixSums[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    getTotalHeight: () => (prefixSums[total] as number) ?? 0,
    getTotal: () => total,
    rebuild: (n) => build(n),
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
// Scroll-to-index position calculation
// =============================================================================

const calculateScrollToPosition = (
  index: number,
  heightCache: HeightCache,
  containerHeight: number,
  totalItems: number,
  align: "start" | "center" | "end",
): number => {
  if (totalItems === 0) return 0;
  const clamped = Math.max(0, Math.min(index, totalItems - 1));
  const offset = heightCache.getOffset(clamped);
  const itemHeight = heightCache.getHeight(clamped);
  const maxScroll = Math.max(0, heightCache.getTotalHeight() - containerHeight);

  let position: number;
  switch (align) {
    case "center":
      position = offset - (containerHeight - itemHeight) / 2;
      break;
    case "end":
      position = offset - containerHeight + itemHeight;
      break;
    default:
      position = offset;
  }
  return Math.max(0, Math.min(position, maxScroll));
};

// =============================================================================
// Smooth Scroll Animation
// =============================================================================

const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

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
  // Validation
  // ---------------------------------------------------------------------------

  if (!config.container) throw new Error("[vlist] container is required");
  if (!config.item) throw new Error("[vlist] item configuration is required");
  if (config.item.height == null)
    throw new Error("[vlist] item.height is required");
  if (typeof config.item.height === "number" && config.item.height <= 0)
    throw new Error("[vlist] item.height must be positive");
  if (
    typeof config.item.height !== "number" &&
    typeof config.item.height !== "function"
  )
    throw new Error(
      "[vlist] item.height must be a number or (index) => number",
    );
  if (!config.item.template)
    throw new Error("[vlist] item.template is required");

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const {
    item: itemConfig,
    items: initialItems,
    overscan = DEFAULT_OVERSCAN,
    classPrefix = DEFAULT_CLASS_PREFIX,
    scrollElement,
    ariaLabel,
  } = config;

  const { height: itemHeightConfig, template } = itemConfig;
  const isWindowMode = !!scrollElement;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let items: T[] = initialItems ? [...initialItems] : [];
  let isDestroyed = false;
  let animationFrameId: number | null = null;
  let lastScrollTop = 0;

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

  if (isWindowMode) {
    dom.root.style.overflow = "visible";
    dom.root.style.height = "auto";
    dom.viewport.style.overflow = "visible";
    dom.viewport.style.height = "auto";
  }

  let containerHeight = isWindowMode
    ? window.innerHeight
    : dom.viewport.clientHeight;

  // Ranges (reused objects to avoid allocation)
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };
  const lastRenderRange: Range = { start: -1, end: -1 };

  // Rendered item tracking
  const rendered = new Map<number, HTMLElement>();

  // Reusable item state (core has no selection / focus)
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

    const scrollTop = isWindowMode
      ? Math.max(
          0,
          (scrollElement as Window).scrollY -
            dom.viewport.getBoundingClientRect().top -
            (scrollElement as Window).scrollY +
            window.scrollY,
        )
      : dom.viewport.scrollTop;

    // Compute list-relative scroll position for window mode
    const effectiveScrollTop = isWindowMode
      ? Math.max(
          0,
          (scrollElement as Window).scrollY +
            dom.viewport.getBoundingClientRect().top * -1,
        )
      : scrollTop;

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

  const scrollTarget = isWindowMode ? (scrollElement as Window) : dom.viewport;
  scrollTarget.addEventListener("scroll", onScrollFrame, { passive: true });

  // ---------------------------------------------------------------------------
  // Click handling
  // ---------------------------------------------------------------------------

  const handleClick = (event: MouseEvent): void => {
    if (isDestroyed) return;
    const target = event.target as HTMLElement;
    const itemEl = target.closest("[data-index]") as HTMLElement | null;
    if (!itemEl) return;

    const index = parseInt(itemEl.dataset.index ?? "-1", 10);
    if (index < 0) return;
    const item = items[index];
    if (!item) return;

    emitter.emit("item:click", { item, index, event });
  };

  const handleDblClick = (event: MouseEvent): void => {
    if (isDestroyed) return;
    const target = event.target as HTMLElement;
    const itemEl = target.closest("[data-index]") as HTMLElement | null;
    if (!itemEl) return;

    const index = parseInt(itemEl.dataset.index ?? "-1", 10);
    if (index < 0) return;
    const item = items[index];
    if (!item) return;

    emitter.emit("item:dblclick", { item, index, event });
  };

  dom.items.addEventListener("click", handleClick);
  dom.items.addEventListener("dblclick", handleDblClick);

  // ---------------------------------------------------------------------------
  // ResizeObserver
  // ---------------------------------------------------------------------------

  const resizeObserver = new ResizeObserver((entries) => {
    if (isDestroyed || isWindowMode) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      if (Math.abs(newHeight - containerHeight) > 1) {
        containerHeight = newHeight;
        updateContentHeight();
        renderIfNeeded();
        emitter.emit("resize", {
          height: newHeight,
          width: entry.contentRect.width,
        });
      }
    }
  });

  resizeObserver.observe(dom.viewport);

  // Window resize handler (for window mode)
  let handleWindowResize: (() => void) | null = null;
  if (isWindowMode) {
    handleWindowResize = () => {
      if (isDestroyed) return;
      const newHeight = window.innerHeight;
      if (Math.abs(newHeight - containerHeight) > 1) {
        containerHeight = newHeight;
        updateContentHeight();
        renderIfNeeded();
        emitter.emit("resize", {
          height: newHeight,
          width: window.innerWidth,
        });
      }
    };
    window.addEventListener("resize", handleWindowResize);
  }

  // ---------------------------------------------------------------------------
  // Scroll methods
  // ---------------------------------------------------------------------------

  const cancelScroll = (): void => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const resolveScrollArgs = (
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ): {
    align: "start" | "center" | "end";
    behavior: "auto" | "smooth";
    duration: number;
  } => {
    if (typeof alignOrOptions === "string")
      return {
        align: alignOrOptions,
        behavior: "auto",
        duration: DEFAULT_SMOOTH_DURATION,
      };
    if (alignOrOptions && typeof alignOrOptions === "object")
      return {
        align: alignOrOptions.align ?? "start",
        behavior: alignOrOptions.behavior ?? "auto",
        duration: alignOrOptions.duration ?? DEFAULT_SMOOTH_DURATION,
      };
    return {
      align: "start",
      behavior: "auto",
      duration: DEFAULT_SMOOTH_DURATION,
    };
  };

  const doScrollTo = (position: number): void => {
    if (isWindowMode) {
      const rect = dom.viewport.getBoundingClientRect();
      const pageOffset = rect.top + window.scrollY;
      (scrollElement as Window).scrollTo(0, pageOffset + position);
    } else {
      dom.viewport.scrollTop = position;
    }
  };

  const animateScroll = (from: number, to: number, duration: number): void => {
    cancelScroll();
    if (Math.abs(to - from) < 1) {
      doScrollTo(to);
      lastScrollTop = to;
      renderIfNeeded();
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      doScrollTo(newPos);
      // Update lastScrollTop BEFORE rendering so range calculation uses correct value
      lastScrollTop = newPos;
      // Ensure rendering happens on each frame during smooth scroll
      renderIfNeeded();
      if (t < 1) animationFrameId = requestAnimationFrame(tick);
      else animationFrameId = null;
    };
    animationFrameId = requestAnimationFrame(tick);
  };

  const scrollToIndex = (
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ): void => {
    const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);
    const position = calculateScrollToPosition(
      index,
      heightCache,
      containerHeight,
      items.length,
      align,
    );
    if (behavior === "smooth") {
      animateScroll(lastScrollTop, position, duration);
    } else {
      cancelScroll();
      doScrollTo(position);
    }
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

  const updateItem = (id: string | number, updates: Partial<T>): void => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    items[index] = { ...items[index], ...updates } as T;

    // Re-render if item is in the current render range
    const el = rendered.get(index);
    if (el) {
      applyTemplate(el, template(items[index]!, index, itemState));
      el.dataset.id = String(items[index]!.id);
    }
  };

  const removeItem = (id: string | number): void => {
    items = items.filter((item) => item.id !== id);
    rebuildAndRender();
  };

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  const destroy = (): void => {
    if (isDestroyed) return;
    isDestroyed = true;

    cancelScroll();

    scrollTarget.removeEventListener("scroll", onScrollFrame);
    dom.items.removeEventListener("click", handleClick);
    resizeObserver.disconnect();
    if (handleWindowResize) {
      window.removeEventListener("resize", handleWindowResize);
    }
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
    updateItem,
    removeItem,

    scrollToIndex,
    scrollToItem: (
      id: string | number,
      alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
    ) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) scrollToIndex(index, alignOrOptions);
    },
    cancelScroll,
    getScrollPosition: () => lastScrollTop,

    getScrollSnapshot: (): CoreScrollSnapshot => {
      if (items.length === 0) {
        return { index: 0, offsetInItem: 0 };
      }
      const index = heightCache.indexAtOffset(lastScrollTop);
      const offsetInItem = Math.max(
        0,
        lastScrollTop - heightCache.getOffset(index),
      );
      return { index, offsetInItem };
    },

    restoreScroll: (snapshot: CoreScrollSnapshot): void => {
      if (items.length === 0) return;
      const safeIndex = Math.max(0, Math.min(snapshot.index, items.length - 1));
      const maxScroll = Math.max(
        0,
        heightCache.getTotalHeight() - containerHeight,
      );
      const position = Math.max(
        0,
        Math.min(
          heightCache.getOffset(safeIndex) + snapshot.offsetInItem,
          maxScroll,
        ),
      );

      if (isWindowMode) {
        const rect = dom.viewport.getBoundingClientRect();
        const listDocumentTop = rect.top + window.scrollY;
        window.scrollTo({ top: listDocumentTop + position, behavior: "auto" });
      } else {
        dom.viewport.scrollTo({ top: position, behavior: "auto" });
      }
      lastScrollTop = position;
      renderIfNeeded();
    },

    on: <K extends keyof CoreEvents<T>>(
      event: K,
      handler: EventHandler<CoreEvents<T>[K]>,
    ): Unsubscribe => emitter.on(event as string, handler),

    off: <K extends keyof CoreEvents<T>>(
      event: K,
      handler: EventHandler<CoreEvents<T>[K]>,
    ): void => emitter.off(event as string, handler),

    destroy,
  };
};
