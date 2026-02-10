/**
 * vlist/core - Lightweight Virtual List
 *
 * A self-contained, minimal virtual list factory for the common case:
 * static or streaming lists that don't need selection, groups,
 * compression, custom scrollbar, or async data adapters.
 *
 * Shares building blocks with the full `vlist` (height cache, emitter,
 * DOM structure, element pool, animation) to eliminate duplication while
 * keeping a small bundle footprint via tree-shaking.
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

// Shared building blocks (also used by the full vlist)
import { createHeightCache, type HeightCache } from "./render/heights";
import { createEmitter } from "./events/emitter";
import {
  resolveContainer,
  createDOMStructure,
  updateContentHeight,
} from "./render/dom";
import { createElementPool } from "./render/pool";
import {
  easeInOutQuad,
  resolveScrollArgs,
  calculateScrollToPosition,
} from "./animation";

// Types — shared base types from the main types module.
// These are type-only imports and are fully erased at runtime,
// so they add zero bytes to the core bundle.
import type {
  VListItem,
  ItemState,
  ItemTemplate,
  Range,
  EventHandler,
  Unsubscribe,
  EventMap,
} from "./types";

// =============================================================================
// Core-Specific Types (not shared with full vlist)
// =============================================================================

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

/** Core event map */
export interface CoreEvents<T extends VListItem = VListItem> extends EventMap {
  "item:click": { item: T; index: number; event: MouseEvent };
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

// Re-export shared base types for consumers of `vlist/core`
export type {
  VListItem,
  ItemState,
  ItemTemplate,
  Range,
  EventHandler,
  Unsubscribe,
};

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OVERSCAN = 3;
const DEFAULT_CLASS_PREFIX = "vlist";
const SCROLL_IDLE_TIMEOUT = 150;

// =============================================================================
// Range Calculation (non-compressed, core-specific)
// =============================================================================

/**
 * Calculate the visible item range for a given scroll position.
 * Writes into `out` to avoid allocation on the scroll hot path.
 *
 * This is the simple, non-compressed version. The full vlist uses
 * compression-aware range calculation from `render/compression.ts`.
 */
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

/**
 * Apply overscan to a visible range, expanding it by `overscan` items
 * on each side (clamped to valid indices).
 */
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
  // Domain components (from shared modules)
  // ---------------------------------------------------------------------------

  const containerElement = resolveContainer(config.container);
  const dom = createDOMStructure(containerElement, classPrefix, ariaLabel);
  const emitter = createEmitter<CoreEvents<T>>();
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

    applyTemplate(element, template(item, index, itemState));
    positionElement(element, index);
    return element;
  };

  // ---------------------------------------------------------------------------
  // Render pipeline
  // ---------------------------------------------------------------------------

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

  dom.items.addEventListener("click", handleClick);

  // ---------------------------------------------------------------------------
  // ResizeObserver
  // ---------------------------------------------------------------------------

  const resizeObserver = new ResizeObserver((entries) => {
    if (isDestroyed || isWindowMode) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      if (Math.abs(newHeight - containerHeight) > 1) {
        containerHeight = newHeight;
        updateContentHeight(dom.content, heightCache.getTotalHeight());
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
        updateContentHeight(dom.content, heightCache.getTotalHeight());
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
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      doScrollTo(from + (to - from) * easeInOutQuad(t));
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
    updateContentHeight(dom.content, heightCache.getTotalHeight());
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

  updateContentHeight(dom.content, heightCache.getTotalHeight());
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
    ): Unsubscribe => emitter.on(event, handler),

    off: <K extends keyof CoreEvents<T>>(
      event: K,
      handler: EventHandler<CoreEvents<T>[K]>,
    ): void => emitter.off(event, handler),

    destroy,
  };
};
