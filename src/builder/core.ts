/**
 * vlist/builder — Self-contained composable virtual list builder
 *
 * Everything inlined — height cache, emitter, DOM, element pool, renderer,
 * range calculations, scroll handling. Zero module imports means the builder
 * core is ~12 KB minified instead of ~25 KB.
 *
 * Plugins compose features *around* the hot path via extension points:
 * afterScroll, clickHandlers, keydownHandlers, resizeHandlers, destroyHandlers,
 * and the methods Map for public API extension.
 */

import type {
  VListItem,
  VListEvents,
  ItemTemplate,
  ItemState,
  EventHandler,
  Unsubscribe,
  Range,
} from "../types";

import type {
  BuilderConfig,
  BuilderContext,
  BuilderState,
  ResolvedBuilderConfig,
  VListPlugin,
  VListBuilder,
  BuiltVList,
} from "./types";

// Re-export CompressionState type from viewport for plugins that need it
export type { CompressionState } from "../rendering/viewport";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OVERSCAN = 3;
const DEFAULT_CLASS_PREFIX = "vlist";
const DEFAULT_SMOOTH_DURATION = 300;
const SCROLL_IDLE_TIMEOUT = 150;

// =============================================================================
// Module-level instance counter for unique ARIA element IDs
// =============================================================================

let builderInstanceId = 0;

// =============================================================================
// Velocity Tracking (inlined for builder)
// =============================================================================

const VELOCITY_SAMPLE_COUNT = 5;
const STALE_GAP_MS = 100;
const MIN_RELIABLE_SAMPLES = 2;

interface VelocitySample {
  position: number;
  time: number;
}

interface VelocityTracker {
  velocity: number;
  lastPosition: number;
  lastTime: number;
  samples: VelocitySample[];
  sampleIndex: number;
  sampleCount: number;
}

const createVelocityTracker = (initialPosition = 0): VelocityTracker => {
  const samples: VelocitySample[] = new Array(VELOCITY_SAMPLE_COUNT);
  for (let i = 0; i < VELOCITY_SAMPLE_COUNT; i++) {
    samples[i] = { position: 0, time: 0 };
  }

  return {
    velocity: 0,
    lastPosition: initialPosition,
    lastTime: performance.now(),
    samples,
    sampleIndex: 0,
    sampleCount: 0,
  };
};

const updateVelocityTracker = (
  tracker: VelocityTracker,
  newPosition: number,
): VelocityTracker => {
  const now = performance.now();
  const timeDelta = now - tracker.lastTime;

  if (timeDelta === 0) return tracker;

  // Stale gap detection - reset if too much time passed
  if (timeDelta > STALE_GAP_MS) {
    tracker.sampleCount = 0;
    tracker.sampleIndex = 0;
    tracker.velocity = 0;
    const baseline = tracker.samples[0]!;
    baseline.position = newPosition;
    baseline.time = now;
    tracker.sampleIndex = 1;
    tracker.sampleCount = 1;
    tracker.lastPosition = newPosition;
    tracker.lastTime = now;
    return tracker;
  }

  // Write to current slot in circular buffer
  const currentSample = tracker.samples[tracker.sampleIndex]!;
  currentSample.position = newPosition;
  currentSample.time = now;

  // Advance index (wrap around)
  tracker.sampleIndex = (tracker.sampleIndex + 1) % VELOCITY_SAMPLE_COUNT;
  tracker.sampleCount = Math.min(
    tracker.sampleCount + 1,
    VELOCITY_SAMPLE_COUNT,
  );

  // Calculate average velocity from samples
  if (tracker.sampleCount >= MIN_RELIABLE_SAMPLES) {
    const oldestIndex =
      (tracker.sampleIndex - tracker.sampleCount + VELOCITY_SAMPLE_COUNT) %
      VELOCITY_SAMPLE_COUNT;
    const oldest = tracker.samples[oldestIndex]!;
    const totalDistance = newPosition - oldest.position;
    const totalTime = now - oldest.time;
    tracker.velocity = totalTime > 0 ? Math.abs(totalDistance) / totalTime : 0;
  }

  tracker.lastPosition = newPosition;
  tracker.lastTime = now;

  return tracker;
};

// =============================================================================
// Inlined: Height Cache
// =============================================================================

interface HeightCache {
  getOffset(index: number): number;
  getHeight(index: number): number;
  indexAtOffset(offset: number): number;
  getTotalHeight(): number;
  getTotal(): number;
  rebuild(totalItems: number): void;
  isVariable(): boolean;
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
      isVariable: () => false,
    };
  }

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
    isVariable: () => true,
  };
};

// =============================================================================
// Inlined: Event Emitter
// =============================================================================

type Listeners = Record<string, Set<EventHandler<any>> | undefined>;

interface Emitter {
  on(event: string, handler: EventHandler<any>): Unsubscribe;
  off(event: string, handler: EventHandler<any>): void;
  emit(event: string, payload: unknown): void;
  clear(): void;
}

const createEmitter = (): Emitter => {
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
// Inlined: DOM Structure
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
    if (!el)
      throw new Error(`[vlist/builder] Container not found: ${container}`);
    return el;
  }
  return container;
};

const createDOMStructure = (
  container: HTMLElement,
  classPrefix: string,
  ariaLabel?: string,
  horizontal?: boolean,
): DOMStructure => {
  const root = document.createElement("div");
  root.className = classPrefix;
  if (horizontal) root.classList.add(`${classPrefix}--horizontal`);
  root.setAttribute("role", "listbox");
  root.setAttribute("tabindex", "0");
  if (ariaLabel) root.setAttribute("aria-label", ariaLabel);
  if (horizontal) root.setAttribute("aria-orientation", "horizontal");

  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  if (horizontal) {
    viewport.style.overflowX = "auto";
    viewport.style.overflowY = "hidden";
  } else {
    viewport.style.overflow = "auto";
  }
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";
  if (horizontal) {
    content.style.height = "100%";
    // Width will be set dynamically based on total items * width
  } else {
    content.style.width = "100%";
  }

  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.style.position = "relative";
  if (horizontal) {
    items.style.height = "100%";
  } else {
    items.style.width = "100%";
  }

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items };
};

// =============================================================================
// Inlined: Element Pool
// =============================================================================

const createElementPool = (maxSize = 100) => {
  const pool: HTMLElement[] = [];

  return {
    acquire: (): HTMLElement => {
      const el = pool.pop();
      if (el) return el;
      const newEl = document.createElement("div");
      newEl.setAttribute("role", "option");
      return newEl;
    },
    release: (el: HTMLElement): void => {
      if (pool.length < maxSize) {
        el.className = "";
        el.textContent = "";
        el.removeAttribute("style");
        el.removeAttribute("data-index");
        el.removeAttribute("data-id");
        pool.push(el);
      }
    },
    clear: (): void => {
      pool.length = 0;
    },
  };
};

// =============================================================================
// Inlined: Range Calculation (no compression)
// =============================================================================

const calcVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  hc: HeightCache,
  totalItems: number,
  out: Range,
): void => {
  if (totalItems === 0 || containerHeight === 0) {
    out.start = 0;
    out.end = 0;
    return;
  }
  const start = hc.indexAtOffset(scrollTop);
  let end = hc.indexAtOffset(scrollTop + containerHeight);
  if (end < totalItems - 1) end++;
  out.start = Math.max(0, start);
  out.end = Math.min(totalItems - 1, Math.max(0, end));
};

const applyOverscan = (
  visible: Range,
  overscan: number,
  totalItems: number,
  out: Range,
): void => {
  if (totalItems === 0) {
    out.start = 0;
    out.end = 0;
    return;
  }
  out.start = Math.max(0, visible.start - overscan);
  out.end = Math.min(totalItems - 1, visible.end + overscan);
};

// =============================================================================
// Inlined: Scroll-to-index
// =============================================================================

const calcScrollToPosition = (
  index: number,
  hc: HeightCache,
  containerHeight: number,
  totalItems: number,
  align: "start" | "center" | "end",
): number => {
  if (totalItems === 0) return 0;
  const clamped = Math.max(0, Math.min(index, totalItems - 1));
  const offset = hc.getOffset(clamped);
  const itemH = hc.getHeight(clamped);
  const maxScroll = Math.max(0, hc.getTotalHeight() - containerHeight);
  let pos: number;
  switch (align) {
    case "center":
      pos = offset - (containerHeight - itemH) / 2;
      break;
    case "end":
      pos = offset - containerHeight + itemH;
      break;
    default:
      pos = offset;
  }
  return Math.max(0, Math.min(pos, maxScroll));
};

const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

const resolveScrollArgs = (
  alignOrOptions?:
    | "start"
    | "center"
    | "end"
    | import("../types").ScrollToOptions,
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

// =============================================================================
// vlist() — Builder Factory
// =============================================================================

export const vlist = <T extends VListItem = VListItem>(
  config: BuilderConfig<T>,
): VListBuilder<T> => {
  // ── Validate ────────────────────────────────────────────────────
  if (!config.container) {
    throw new Error("[vlist/builder] Container is required");
  }
  if (!config.item) {
    throw new Error("[vlist/builder] item configuration is required");
  }

  const isHorizontal = config.direction === "horizontal";
  const mainAxisProp = isHorizontal ? "width" : "height";
  const mainAxisValue = isHorizontal ? config.item.width : config.item.height;

  if (mainAxisValue == null) {
    throw new Error(
      `[vlist/builder] item.${mainAxisProp} is required${isHorizontal ? " when direction is 'horizontal'" : ""}`,
    );
  }
  if (typeof mainAxisValue === "number" && mainAxisValue <= 0) {
    throw new Error(
      `[vlist/builder] item.${mainAxisProp} must be a positive number`,
    );
  }
  if (
    typeof mainAxisValue !== "number" &&
    typeof mainAxisValue !== "function"
  ) {
    throw new Error(
      `[vlist/builder] item.${mainAxisProp} must be a number or a function (index) => number`,
    );
  }
  if (!config.item.template) {
    throw new Error("[vlist/builder] item.template is required");
  }
  if (isHorizontal && config.reverse) {
    throw new Error(
      "[vlist/builder] horizontal direction cannot be combined with reverse mode",
    );
  }

  // ── Store plugins ───────────────────────────────────────────────
  const plugins: Map<string, VListPlugin<T>> = new Map();
  let built = false;

  const builder: VListBuilder<T> = {
    use(plugin: VListPlugin<T>): VListBuilder<T> {
      if (built) {
        throw new Error("[vlist/builder] Cannot call .use() after .build()");
      }
      plugins.set(plugin.name, plugin);
      return builder;
    },

    build(): BuiltVList<T> {
      if (built) {
        throw new Error("[vlist/builder] .build() can only be called once");
      }
      built = true;
      return materialize(
        config,
        plugins,
        isHorizontal,
        mainAxisValue as number | ((index: number) => number),
      );
    },
  };

  return builder;
};

// =============================================================================
// materialize() — the actual build logic
// =============================================================================

function materialize<T extends VListItem = VListItem>(
  config: BuilderConfig<T>,
  plugins: Map<string, VListPlugin<T>>,
  isHorizontal: boolean,
  mainAxisValue: number | ((index: number) => number),
): BuiltVList<T> {
  // ── Resolve config ──────────────────────────────────────────────
  const {
    item: itemConfig,
    items: initialItems,
    overscan = DEFAULT_OVERSCAN,
    classPrefix = DEFAULT_CLASS_PREFIX,
    ariaLabel,
    reverse: reverseMode = false,
    scroll: scrollConfig,
  } = config;

  const wheelEnabled = scrollConfig?.wheel ?? true;
  const wrapEnabled = scrollConfig?.wrap ?? false;
  const isReverse = reverseMode;
  const ariaIdPrefix = `${classPrefix}-${builderInstanceId++}`;
  const mainAxisSizeConfig = mainAxisValue;
  const crossAxisSize: number | undefined = isHorizontal
    ? typeof itemConfig.height === "number"
      ? itemConfig.height
      : undefined
    : typeof itemConfig.width === "number"
      ? itemConfig.width
      : undefined;

  // Mutable template reference - plugins can replace this (e.g., withGroups wraps it)
  let activeTemplate = itemConfig.template as ItemTemplate<T>;

  const resolvedConfig: ResolvedBuilderConfig = {
    overscan,
    classPrefix,
    reverse: isReverse,
    wrap: wrapEnabled,
    horizontal: isHorizontal,
    ariaIdPrefix,
  };

  // ── Sort and validate plugins ───────────────────────────────────
  const sortedPlugins = Array.from(plugins.values()).sort(
    (a, b) => (a.priority ?? 50) - (b.priority ?? 50),
  );

  const pluginNames = new Set(sortedPlugins.map((p) => p.name));
  for (const plugin of sortedPlugins) {
    if (plugin.conflicts) {
      for (const conflict of plugin.conflicts) {
        if (pluginNames.has(conflict)) {
          throw new Error(
            `[vlist/builder] ${plugin.name} and ${conflict} cannot be combined`,
          );
        }
      }
    }
  }

  if (isHorizontal) {
    if (pluginNames.has("withGrid")) {
      throw new Error(
        "[vlist/builder] withGrid cannot be used with direction: 'horizontal'",
      );
    }
    if (pluginNames.has("withGroups")) {
      throw new Error(
        "[vlist/builder] withGroups cannot be used with direction: 'horizontal'",
      );
    }
  }
  if (isReverse) {
    if (pluginNames.has("withGrid")) {
      throw new Error(
        "[vlist/builder] withGrid cannot be used with reverse: true",
      );
    }
    // Note: withGroups validation moved to plugin itself
    // (allows sticky: false with reverse mode for chat UIs)
  }

  // ── Create DOM ──────────────────────────────────────────────────
  const containerElement = resolveContainer(config.container);
  const dom = createDOMStructure(
    containerElement,
    classPrefix,
    ariaLabel,
    isHorizontal,
  );

  // ── Create core components (inlined) ────────────────────────────
  const emitter = createEmitter();
  let items: T[] = initialItems ? [...initialItems] : [];
  let heightCache = createHeightCache(mainAxisSizeConfig, items.length);
  const pool = createElementPool();

  let containerHeight = dom.viewport.clientHeight;
  let containerWidth = dom.viewport.clientWidth;

  // ── State ───────────────────────────────────────────────────────
  let isDestroyed = false;
  let isInitialized = false;
  let lastScrollTop = 0;
  let animationFrameId: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Velocity tracker
  let velocityTracker = createVelocityTracker(0);

  // Reusable range objects (no allocation on scroll)
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };
  const lastRenderRange: Range = { start: -1, end: -1 };

  // Shared state object for plugins (defined early so core render can reference it)
  const sharedState: BuilderState = {
    viewportState: {
      scrollTop: 0,
      containerHeight,
      totalHeight: heightCache.getTotalHeight(),
      actualHeight: heightCache.getTotalHeight(),
      isCompressed: false,
      compressionRatio: 1,
      visibleRange: { start: 0, end: 0 },
      renderRange: { start: 0, end: 0 },
    },
    lastRenderRange: { start: -1, end: -1 },
    isInitialized: false,
    isDestroyed: false,
    cachedCompression: null,
  };

  // Rendered item tracking
  const rendered = new Map<number, HTMLElement>();
  const itemState: ItemState = { selected: false, focused: false };
  const baseClass = `${classPrefix}-item`;
  let lastAriaSetSize = "";

  // ID → index map for fast lookups
  const idToIndex = new Map<string | number, number>();

  const rebuildIdIndex = (): void => {
    idToIndex.clear();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item) idToIndex.set(item.id, i);
    }
  };

  rebuildIdIndex();

  // Forward-declare so closures above the full initialisation can reference it.
  // Before assignment it is null, so every access must null-guard.
  let dataManagerProxy: any = null;

  // Virtual total — plugins (grid/groups) can override this
  // Delegates to the data manager proxy so withData's total propagates correctly.
  // Falls back to items.length before dataManagerProxy is initialised.
  let virtualTotalFn = (): number =>
    dataManagerProxy ? dataManagerProxy.getTotal() : items.length;

  // ── Plugin extension points ─────────────────────────────────────
  const afterScroll: Array<(scrollTop: number, direction: string) => void> = [];
  const clickHandlers: Array<(event: MouseEvent) => void> = [];
  const keydownHandlers: Array<(event: KeyboardEvent) => void> = [];
  const resizeHandlers: Array<(width: number, height: number) => void> = [];
  const contentSizeHandlers: Array<() => void> = [];
  const destroyHandlers: Array<() => void> = [];
  const methods: Map<string, Function> = new Map();

  // Pluggable scroll functions — compression plugin replaces these
  let scrollGetTop = (): number => {
    return isHorizontal ? dom.viewport.scrollLeft : dom.viewport.scrollTop;
  };
  let scrollSetTop = (pos: number): void => {
    if (isHorizontal) {
      dom.viewport.scrollLeft = pos;
    } else {
      dom.viewport.scrollTop = pos;
    }
  };
  let scrollIsAtBottom = (threshold = 2): boolean => {
    const total = heightCache.getTotalHeight();
    return lastScrollTop + containerHeight >= total - threshold;
  };
  let scrollIsCompressed = false;

  // Pluggable render functions — grid/groups plugins replace these
  let renderIfNeededFn: () => void;
  let forceRenderFn: () => void;

  // Pluggable visible range function — compression plugin replaces this
  let getVisibleRange = (
    scrollTop: number,
    cHeight: number,
    hc: HeightCache,
    total: number,
    out: Range,
  ): void => {
    calcVisibleRange(scrollTop, cHeight, hc, total, out);
  };

  // Pluggable scrollToIndex position calculator — compression plugin replaces
  let getScrollToPos = (
    index: number,
    hc: HeightCache,
    cHeight: number,
    total: number,
    align: "start" | "center" | "end",
  ): number => {
    return calcScrollToPosition(index, hc, cHeight, total, align);
  };

  // ── Rendering ───────────────────────────────────────────────────

  const applyTemplate = (
    element: HTMLElement,
    result: string | HTMLElement,
  ): void => {
    if (typeof result === "string") element.innerHTML = result;
    else element.replaceChildren(result);
  };

  const positionElement = (element: HTMLElement, index: number): void => {
    const offset = Math.round(heightCache.getOffset(index));
    if (isHorizontal) {
      element.style.transform = `translateX(${offset}px)`;
    } else {
      element.style.transform = `translateY(${offset}px)`;
    }
  };

  // Pluggable position function — compression plugin can replace
  let positionElementFn = positionElement;

  const renderItem = (index: number, item: T): HTMLElement => {
    const element = pool.acquire();
    element.className = baseClass;

    if (isHorizontal) {
      element.style.width = `${heightCache.getHeight(index)}px`;
      if (crossAxisSize != null) {
        element.style.height = `${crossAxisSize}px`;
      }
    } else {
      element.style.height = `${heightCache.getHeight(index)}px`;
    }

    element.dataset.index = String(index);
    element.dataset.id = String(item.id);
    element.ariaSelected = "false";
    element.id = `${ariaIdPrefix}-item-${index}`;
    lastAriaSetSize = String(virtualTotalFn());
    element.setAttribute("aria-setsize", lastAriaSetSize);
    element.setAttribute("aria-posinset", String(index + 1));

    // Add placeholder class if this is a placeholder item
    const isPlaceholder = String(item.id).startsWith("__placeholder_");
    if (isPlaceholder) {
      element.classList.add(`${classPrefix}-item--placeholder`);
    }

    applyTemplate(element, activeTemplate(item, index, itemState));
    positionElementFn(element, index);
    return element;
  };

  const updateContentSize = (): void => {
    const size = `${heightCache.getTotalHeight()}px`;
    if (isHorizontal) {
      dom.content.style.width = size;
    } else {
      dom.content.style.height = size;
    }
  };

  // ── Main render function ────────────────────────────────────────
  // This is the hot path — called on every scroll-triggered range change.

  // Selection state — plugins (withSelection) inject these
  let selectionSet: Set<string | number> = new Set();
  let focusedIndex = -1;

  const coreRenderIfNeeded = (): void => {
    if (isDestroyed) return;

    const total = virtualTotalFn();
    getVisibleRange(
      lastScrollTop,
      containerHeight,
      heightCache,
      total,
      visibleRange,
    );
    applyOverscan(visibleRange, overscan, total, renderRange);

    if (
      renderRange.start === lastRenderRange.start &&
      renderRange.end === lastRenderRange.end
    ) {
      return;
    }

    const currentSetSize = String(total);
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
      const item = (
        dataManagerProxy ? dataManagerProxy.getItem(i) : items[i]
      ) as T | undefined;
      if (!item) continue;

      const existing = rendered.get(i);
      if (existing) {
        const existingId = existing.dataset.id;
        const newId = String(item.id);
        if (existingId !== newId) {
          // Check if we're replacing a placeholder (ID starts with __placeholder_)
          const wasPlaceholder = existingId?.startsWith("__placeholder_");
          const isPlaceholder = newId.startsWith("__placeholder_");

          applyTemplate(existing, activeTemplate(item, i, itemState));
          existing.dataset.id = newId;
          if (isHorizontal) {
            existing.style.width = `${heightCache.getHeight(i)}px`;
          } else {
            existing.style.height = `${heightCache.getHeight(i)}px`;
          }

          // Update placeholder class
          if (isPlaceholder) {
            existing.classList.add(`${classPrefix}-item--placeholder`);
          } else {
            existing.classList.remove(`${classPrefix}-item--placeholder`);
          }
          // Add --replaced class for fade-in animation when placeholder is replaced
          if (wasPlaceholder && !isPlaceholder) {
            existing.classList.add(`${classPrefix}-item--replaced`);
            // Remove class after animation completes to allow reuse
            setTimeout(() => {
              existing.classList.remove(`${classPrefix}-item--replaced`);
            }, 300);
          }
        }
        positionElementFn(existing, i);

        // Selection class updates
        const isSelected = selectionSet.has(item.id);
        const isFocused = i === focusedIndex;
        existing.classList.toggle(`${classPrefix}-item--selected`, isSelected);
        existing.classList.toggle(`${classPrefix}-item--focused`, isFocused);
        existing.ariaSelected = isSelected ? "true" : "false";

        if (setSizeChanged) {
          existing.setAttribute("aria-setsize", lastAriaSetSize);
        }
      } else {
        const element = renderItem(i, item);

        // Selection state for new elements
        const isSelected = selectionSet.has(item.id);
        const isFocused = i === focusedIndex;
        if (isSelected) {
          element.classList.add(`${classPrefix}-item--selected`);
          element.ariaSelected = "true";
        }
        if (isFocused) {
          element.classList.add(`${classPrefix}-item--focused`);
        }

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

    // Sync shared state for plugins that use it
    sharedState.lastRenderRange.start = renderRange.start;
    sharedState.lastRenderRange.end = renderRange.end;

    // Update viewport state with current scroll position and calculated ranges
    // This is critical for plugins (especially compression + scrollbar) that rely
    // on viewport state being up-to-date
    sharedState.viewportState.scrollTop = lastScrollTop;
    sharedState.viewportState.visibleRange.start = visibleRange.start;
    sharedState.viewportState.visibleRange.end = visibleRange.end;
    sharedState.viewportState.renderRange.start = renderRange.start;
    sharedState.viewportState.renderRange.end = renderRange.end;

    emitter.emit("range:change", {
      range: { start: renderRange.start, end: renderRange.end },
    });
  };

  const coreForceRender = (): void => {
    lastRenderRange.start = -1;
    lastRenderRange.end = -1;
    renderIfNeededFn();
  };

  // Initialize replaceable render function references
  renderIfNeededFn = coreRenderIfNeeded;
  forceRenderFn = coreForceRender;

  // ── Scroll handling ─────────────────────────────────────────────

  const onScrollFrame = (): void => {
    if (isDestroyed) return;

    const scrollTop = scrollGetTop();
    const direction: "up" | "down" = scrollTop >= lastScrollTop ? "down" : "up";

    // Update velocity tracker
    velocityTracker = updateVelocityTracker(velocityTracker, scrollTop);

    if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
      dom.root.classList.add(`${classPrefix}--scrolling`);
    }

    lastScrollTop = scrollTop;
    renderIfNeededFn();

    emitter.emit("scroll", { scrollTop, direction });

    // Emit velocity change
    emitter.emit("velocity:change", {
      velocity: velocityTracker.velocity,
      reliable: velocityTracker.sampleCount >= MIN_RELIABLE_SAMPLES,
    });

    // Plugin post-scroll actions
    for (let i = 0; i < afterScroll.length; i++) {
      afterScroll[i]!(scrollTop, direction);
    }

    // Idle detection
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      dom.root.classList.remove(`${classPrefix}--scrolling`);
      // Reset velocity to 0 when idle
      velocityTracker.velocity = 0;
      velocityTracker.sampleCount = 0;
      emitter.emit("velocity:change", {
        velocity: 0,
        reliable: false,
      });
    }, scrollConfig?.idleTimeout ?? SCROLL_IDLE_TIMEOUT);
  };

  // Wheel handler (can be disabled via config)
  let wheelHandler: ((e: WheelEvent) => void) | null = null;

  // Pluggable scroll target (window mode plugin can replace this)
  let scrollTarget: HTMLElement | Window = dom.viewport;
  scrollTarget.addEventListener("scroll", onScrollFrame, { passive: true });

  // Setup horizontal wheel handling (convert vertical wheel to horizontal scroll)
  if (isHorizontal && wheelEnabled) {
    wheelHandler = (event: WheelEvent): void => {
      if (event.deltaX) return; // native horizontal scroll handles it
      event.preventDefault();
      dom.viewport.scrollLeft += event.deltaY;
    };
    dom.viewport.addEventListener("wheel", wheelHandler);
  }

  // Note: The custom-scrollbar class is added by withScrollbar plugin when used
  // Native scrollbars are visible by default

  // ── Click & keydown handlers (delegate to plugins) ──────────────

  const handleClick = (event: MouseEvent): void => {
    // Core: emit item:click
    const target = event.target as HTMLElement;
    const itemEl = target.closest("[data-index]") as HTMLElement | null;
    if (itemEl) {
      const layoutIndex = parseInt(itemEl.dataset.index ?? "-1", 10);
      if (layoutIndex >= 0) {
        const item =
          dataManagerProxy?.getItem(layoutIndex) ?? items[layoutIndex];
        if (item) {
          // Skip group headers
          if ((item as any).__groupHeader) {
            return;
          }
          emitter.emit("item:click", { item, index: layoutIndex, event });
        }
      }
    }

    for (let i = 0; i < clickHandlers.length; i++) {
      clickHandlers[i]!(event);
    }
  };

  const handleDblClick = (event: MouseEvent): void => {
    // Core: emit item:dblclick
    const target = event.target as HTMLElement;
    const itemEl = target.closest("[data-index]") as HTMLElement | null;
    if (itemEl) {
      const layoutIndex = parseInt(itemEl.dataset.index ?? "-1", 10);
      if (layoutIndex >= 0) {
        const item =
          dataManagerProxy?.getItem(layoutIndex) ?? items[layoutIndex];
        if (item) {
          // Skip group headers
          if ((item as any).__groupHeader) {
            return;
          }
          emitter.emit("item:dblclick", { item, index: layoutIndex, event });
        }
      }
    }
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    for (let i = 0; i < keydownHandlers.length; i++) {
      keydownHandlers[i]!(event);
    }
  };

  dom.items.addEventListener("click", handleClick);
  dom.items.addEventListener("dblclick", handleDblClick);
  dom.root.addEventListener("keydown", handleKeydown);

  // ── ResizeObserver ──────────────────────────────────────────────

  // Pluggable viewport resize behavior (window mode plugin can disable)
  let viewportResizeEnabled = true;

  // Pluggable container dimension getters (window mode plugin can replace)
  // @ts-ignore - used by window plugin via setContainerDimensions
  let getContainerWidth = (): number => containerWidth;
  // @ts-ignore - used by window plugin via setContainerDimensions
  let getContainerHeight = (): number => containerHeight;

  const resizeObserver = new ResizeObserver((entries) => {
    if (isDestroyed) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      const newWidth = entry.contentRect.width;
      const newMainAxis = isHorizontal ? newWidth : newHeight;

      // Always update dimensions (even before initialization)
      containerWidth = newWidth;

      if (Math.abs(newMainAxis - containerHeight) > 1) {
        containerHeight = newMainAxis;
        sharedState.viewportState.containerHeight = newMainAxis;

        // Only render if already initialized (plugins have run)
        if (isInitialized) {
          updateContentSize();
          renderIfNeededFn();
          emitter.emit("resize", { height: newHeight, width: newWidth });
        }
      }

      // Only call resize handlers if initialized
      if (isInitialized) {
        for (let i = 0; i < resizeHandlers.length; i++) {
          resizeHandlers[i]!(newWidth, newHeight);
        }
      }
    }
  });

  // Plugins can disable viewport resize observation
  if (viewportResizeEnabled) {
    resizeObserver.observe(dom.viewport);
  }

  // ── Compression mode ────────────────────────────────────────────

  // ── BuilderContext ──────────────────────────────────────────────
  // The context plugins receive. Provides extension points without
  // exposing implementation details. We build it as a plain object
  // with getters so plugins always see the latest state.

  const ctx: BuilderContext<T> = {
    get dom() {
      return dom as any;
    },
    get heightCache() {
      return heightCache as any;
    },
    get emitter() {
      return emitter as any;
    },
    get config() {
      return resolvedConfig;
    },
    get rawConfig() {
      return config;
    },

    // Mutable component slots (plugins can replace)
    // Expose a renderer proxy so plugins (e.g. withSelection) can call
    // ctx.renderer.render() and ctx.renderer.updateItemClasses() without
    // needing access to the inlined rendering internals.
    get renderer() {
      return {
        render: (
          _items: T[],
          _range: Range,
          selected: Set<string | number>,
          focusedIdx: number,
          _compressionCtx?: any,
        ): void => {
          // Inject selection state into the inlined renderer's closure
          selectionSet = selected;
          focusedIndex = focusedIdx;
          forceRenderFn();
        },
        updateItemClasses: (
          index: number,
          isSelected: boolean,
          isFocused: boolean,
        ): void => {
          const el = rendered.get(index);
          if (!el) return;
          el.classList.toggle(`${classPrefix}-item--selected`, isSelected);
          el.classList.toggle(`${classPrefix}-item--focused`, isFocused);
          el.ariaSelected = isSelected ? "true" : "false";
        },
        updatePositions: () => {},
        updateItem: () => {},
        getElement: (index: number) => rendered.get(index) ?? null,
        clear: () => {},
        destroy: () => {},
      } as any;
    },
    set renderer(_r: any) {
      // no-op — grid plugin overrides via methods below
    },

    get dataManager() {
      return dataManagerProxy as any;
    },
    set dataManager(dm: any) {
      dataManagerProxy = dm;
    },

    get scrollController() {
      return scrollControllerProxy as any;
    },
    set scrollController(sc: any) {
      scrollControllerProxy = sc;
    },

    state: sharedState,

    /** Get current container width (for grid plugin) */
    getContainerWidth(): number {
      return containerWidth;
    },

    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    contentSizeHandlers,
    destroyHandlers,
    methods,

    replaceTemplate(newTemplate: ItemTemplate<T>): void {
      // Replace the active template (used by inlined renderer)
      // This is the proper way to modify rendering in the materialize path
      activeTemplate = newTemplate;
    },
    replaceRenderer(_renderer: any): void {
      // No-op in materialize (renderer is inlined)
      // Grid plugin uses this, but manages its own renderer via methods
      // Groups plugin should use replaceTemplate instead
    },
    replaceDataManager(dm: any): void {
      dataManagerProxy = dm;
    },
    replaceScrollController(sc: any): void {
      scrollControllerProxy = sc;
    },

    getItemsForRange(range: Range): T[] {
      const result: T[] = [];
      for (let i = range.start; i <= range.end; i++) {
        const item = (
          dataManagerProxy ? dataManagerProxy.getItem(i) : items[i]
        ) as T | undefined;
        if (item) result.push(item);
      }
      return result;
    },
    getAllLoadedItems(): T[] {
      if (dataManagerProxy) {
        const total = dataManagerProxy.getTotal();
        const result: T[] = [];
        for (let i = 0; i < total; i++) {
          const item = dataManagerProxy.getItem(i) as T | undefined;
          if (item) result.push(item);
        }
        return result;
      }
      return [...items];
    },
    getVirtualTotal(): number {
      return virtualTotalFn();
    },
    getCachedCompression() {
      return {
        isCompressed: false,
        actualHeight: heightCache.getTotalHeight(),
        virtualHeight: heightCache.getTotalHeight(),
        ratio: 1,
      } as any;
    },
    getCompressionContext() {
      return {
        scrollTop: lastScrollTop,
        totalItems: virtualTotalFn(),
        containerHeight,
        rangeStart: renderRange.start,
      } as any;
    },
    renderIfNeeded(): void {
      renderIfNeededFn();
    },
    forceRender(): void {
      forceRenderFn();
    },
    getRenderFns(): { renderIfNeeded: () => void; forceRender: () => void } {
      return {
        renderIfNeeded: renderIfNeededFn,
        forceRender: forceRenderFn,
      };
    },
    setRenderFns(renderFn: () => void, forceFn: () => void): void {
      renderIfNeededFn = renderFn;
      forceRenderFn = forceFn;
    },

    setVirtualTotalFn(fn: () => number): void {
      virtualTotalFn = fn;
    },
    rebuildHeightCache(total?: number): void {
      heightCache.rebuild(total ?? virtualTotalFn());
    },
    setHeightConfig(newConfig: number | ((index: number) => number)): void {
      heightCache = createHeightCache(newConfig, virtualTotalFn());
    },
    updateContentSize(totalSize: number): void {
      const size = `${totalSize}px`;
      if (isHorizontal) {
        dom.content.style.width = size;
      } else {
        dom.content.style.height = size;
      }
    },
    updateCompressionMode(): void {
      // No-op by default — withCompression plugin replaces this
    },

    setVisibleRangeFn(
      fn: (
        scrollTop: number,
        cHeight: number,
        hc: HeightCache,
        total: number,
        out: Range,
      ) => void,
    ): void {
      getVisibleRange = fn;
    },

    setScrollToPosFn(
      fn: (
        index: number,
        hc: HeightCache,
        cHeight: number,
        total: number,
        align: "start" | "center" | "end",
      ) => number,
    ): void {
      getScrollToPos = fn;
    },

    setPositionElementFn(
      fn: (element: HTMLElement, index: number) => void,
    ): void {
      positionElementFn = fn;
    },

    setScrollFns(getTop: () => number, setTop: (pos: number) => void): void {
      scrollGetTop = getTop;
      // Wrap the provided setTop so that after storing the position
      // the builder's scroll pipeline (render + events) fires immediately.
      // In compressed mode the native scroll event may not fire (or may
      // fire with a clamped value), so we must trigger explicitly.
      scrollSetTop = (pos: number): void => {
        setTop(pos);
        onScrollFrame();
      };
    },

    setScrollTarget(target: HTMLElement | Window): void {
      // Remove listener from old target
      scrollTarget.removeEventListener("scroll", onScrollFrame);
      // Update target and re-attach listener
      scrollTarget = target;
      scrollTarget.addEventListener("scroll", onScrollFrame, { passive: true });
    },

    getScrollTarget(): HTMLElement | Window {
      return scrollTarget;
    },

    setContainerDimensions(getter: {
      width: () => number;
      height: () => number;
    }): void {
      getContainerWidth = getter.width;
      getContainerHeight = getter.height;
      // Update current dimensions immediately
      containerWidth = getter.width();
      containerHeight = getter.height();
      sharedState.viewportState.containerHeight = containerHeight;
    },

    disableViewportResize(): void {
      if (viewportResizeEnabled) {
        viewportResizeEnabled = false;
        resizeObserver.unobserve(dom.viewport);
      }
    },
  };

  // ── Data manager proxy (plugins can replace) ────────────────────
  // The default is a thin wrapper around the items array.
  // withData plugin replaces this with the full adapter-backed manager.
  // (variable is forward-declared above virtualTotalFn to avoid TDZ)

  dataManagerProxy = {
    getState: () => ({
      total: items.length,
      cached: items.length,
      isLoading: false,
      pendingRanges: [],
      error: undefined,
      hasMore: false,
      cursor: undefined,
    }),
    getTotal: () => items.length,
    getCached: () => items.length,
    getIsLoading: () => false,
    getHasMore: () => false,
    getStorage: () => null,
    getPlaceholders: () => null,
    getItem: (index: number) => items[index],
    getItemById: (id: string | number) => {
      const idx = idToIndex.get(id);
      return idx !== undefined ? items[idx] : undefined;
    },
    getIndexById: (id: string | number) => idToIndex.get(id) ?? -1,
    isItemLoaded: (index: number) =>
      index >= 0 && index < items.length && items[index] !== undefined,
    getItemsInRange: (start: number, end: number) => {
      const result: T[] = [];
      const s = Math.max(0, start);
      const e = Math.min(end, items.length - 1);
      for (let i = s; i <= e; i++) result.push(items[i] as T);
      return result;
    },
    setTotal: (t: number) => {
      // no-op for simple manager
      void t;
    },
    setItems: (newItems: T[], offset = 0, newTotal?: number) => {
      if (offset === 0 && (newTotal !== undefined || items.length === 0)) {
        items = [...newItems];
      } else {
        // Ensure items array is large enough before assigning
        const requiredLength = offset + newItems.length;
        if (items.length < requiredLength) {
          items.length = requiredLength;
        }
        for (let i = 0; i < newItems.length; i++) {
          items[offset + i] = newItems[i]!;
        }
      }
      if (newTotal !== undefined) {
        // trim or leave
      }
      rebuildIdIndex();
      if (isInitialized) {
        heightCache.rebuild(virtualTotalFn());
        updateContentSize();
        ctx.updateCompressionMode();
        for (let i = 0; i < contentSizeHandlers.length; i++) {
          contentSizeHandlers[i]!();
        }
        forceRenderFn();
      }
    },
    updateItem: (id: string | number, updates: Partial<T>) => {
      const index = idToIndex.get(id);
      if (index === undefined) return false;
      const item = items[index];
      if (!item) return false;
      items[index] = { ...item, ...updates } as T;
      if (updates.id !== undefined && updates.id !== id) {
        idToIndex.delete(id);
        idToIndex.set(updates.id, index);
      }
      // Re-render if visible
      const el = rendered.get(index);
      if (el) {
        applyTemplate(el, activeTemplate(items[index]!, index, itemState));
        el.dataset.id = String(items[index]!.id);
      }
      return true;
    },
    removeItem: (id: string | number) => {
      const index = idToIndex.get(id);
      if (index === undefined) return false;
      items.splice(index, 1);
      rebuildIdIndex();
      if (isInitialized) {
        heightCache.rebuild(virtualTotalFn());
        updateContentSize();
        ctx.updateCompressionMode();
        for (let i = 0; i < contentSizeHandlers.length; i++) {
          contentSizeHandlers[i]!();
        }
        forceRenderFn();
      }
      return true;
    },
    loadRange: async () => {},
    ensureRange: async () => {},
    loadInitial: async () => {},
    loadMore: async () => false,
    reload: async () => {},
    evictDistant: () => {},
    clear: () => {
      items = [];
      idToIndex.clear();
    },
    reset: () => {
      items = [];
      idToIndex.clear();
      if (isInitialized) {
        heightCache.rebuild(0);
        updateContentSize();
        forceRenderFn();
      }
    },
  };

  // ── Scroll controller proxy (plugins can replace) ───────────────
  // Minimal proxy — plugins like withCompression replace this.

  let scrollControllerProxy: any = {
    getScrollTop: () => scrollGetTop(),
    scrollTo: (pos: number) => {
      scrollSetTop(pos);
      lastScrollTop = pos;
      renderIfNeededFn();
    },
    scrollBy: (delta: number) => {
      const newPos = scrollGetTop() + delta;
      scrollSetTop(newPos);
      lastScrollTop = newPos;
      renderIfNeededFn();
    },
    isAtTop: () => lastScrollTop <= 2,
    isAtBottom: (threshold = 2) => scrollIsAtBottom(threshold),
    getScrollPercentage: () => {
      const total = heightCache.getTotalHeight();
      const maxScroll = Math.max(0, total - containerHeight);
      return maxScroll > 0 ? lastScrollTop / maxScroll : 0;
    },
    getVelocity: () => velocityTracker.velocity,
    isTracking: () => velocityTracker.sampleCount >= MIN_RELIABLE_SAMPLES,
    isScrolling: () => dom.root.classList.contains(`${classPrefix}--scrolling`),
    updateConfig: () => {},
    enableCompression: () => {},
    disableCompression: () => {},
    isCompressed: () => scrollIsCompressed,
    isWindowMode: () => false,
    updateContainerHeight: (h: number) => {
      containerHeight = h;
    },
    destroy: () => {},
  };

  // ── Run plugin setup ────────────────────────────────────────────

  // Check for method collisions
  const allMethodNames = new Map<string, string>();
  for (const plugin of sortedPlugins) {
    if (plugin.methods) {
      for (const method of plugin.methods) {
        const existing = allMethodNames.get(method);
        if (existing) {
          throw new Error(
            `[vlist/builder] Method "${method}" is registered by both "${existing}" and "${plugin.name}"`,
          );
        }
        allMethodNames.set(method, plugin.name);
      }
    }
  }

  for (const plugin of sortedPlugins) {
    plugin.setup(ctx);
  }

  // ── Mark initialized ────────────────────────────────────────────
  isInitialized = true;
  ctx.state.isInitialized = true;

  // ── Initial render ──────────────────────────────────────────────
  updateContentSize();
  renderIfNeededFn();

  // Reverse mode: scroll to bottom
  if (isReverse && items.length > 0) {
    const pos = getScrollToPos(
      items.length - 1,
      heightCache,
      containerHeight,
      items.length,
      "end",
    );
    scrollSetTop(pos);
    lastScrollTop = pos;
    renderIfNeededFn();
  }

  // ── Base data methods ───────────────────────────────────────────

  const setItems = (newItems: T[]): void => {
    ctx.dataManager.setItems(newItems, 0, newItems.length);
  };

  const appendItems = isReverse
    ? (newItems: T[]): void => {
        const wasAtBottom = scrollIsAtBottom(2);
        const currentTotal = items.length;
        ctx.dataManager.setItems(newItems, currentTotal);
        if (wasAtBottom && items.length > 0) {
          const pos = getScrollToPos(
            items.length - 1,
            heightCache,
            containerHeight,
            items.length,
            "end",
          );
          scrollSetTop(pos);
          lastScrollTop = pos;
          renderIfNeededFn();
        }
      }
    : (newItems: T[]): void => {
        const currentTotal = items.length;
        ctx.dataManager.setItems(newItems, currentTotal);
      };

  const prependItems = isReverse
    ? (newItems: T[]): void => {
        const scrollTop = scrollGetTop();
        const heightBefore = heightCache.getTotalHeight();
        const existingItems = [...items];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
        const heightAfter = heightCache.getTotalHeight();
        const delta = heightAfter - heightBefore;
        if (delta > 0) {
          scrollSetTop(scrollTop + delta);
          lastScrollTop = scrollTop + delta;
        }
      }
    : (newItems: T[]): void => {
        const existingItems = [...items];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
      };

  const updateItem = (id: string | number, updates: Partial<T>): void => {
    ctx.dataManager.updateItem(id, updates);
  };

  const removeItem = (id: string | number): void => {
    ctx.dataManager.removeItem(id);
  };

  const reload = async (): Promise<void> => {
    if ((ctx.dataManager as any).reload) {
      await (ctx.dataManager as any).reload();
    }
  };

  // ── Base scroll methods ─────────────────────────────────────────

  const cancelScroll = (): void => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const animateScroll = (from: number, to: number, duration: number): void => {
    cancelScroll();
    if (Math.abs(to - from) < 1) {
      scrollSetTop(to);
      lastScrollTop = to;
      renderIfNeededFn();
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      scrollSetTop(newPos);
      // Update lastScrollTop BEFORE rendering so range calculation uses correct value
      lastScrollTop = newPos;
      // Ensure rendering happens on each frame during smooth scroll
      renderIfNeededFn();
      if (t < 1) animationFrameId = requestAnimationFrame(tick);
      else animationFrameId = null;
    };
    animationFrameId = requestAnimationFrame(tick);
  };

  const scrollToIndex = (
    index: number,
    alignOrOptions?:
      | "start"
      | "center"
      | "end"
      | import("../types").ScrollToOptions,
  ): void => {
    const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);
    const total = virtualTotalFn();

    let idx = index;
    if (wrapEnabled && total > 0) {
      idx = ((idx % total) + total) % total;
    }

    const position = getScrollToPos(
      idx,
      heightCache,
      containerHeight,
      total,
      align,
    );

    if (behavior === "smooth") {
      animateScroll(scrollGetTop(), position, duration);
    } else {
      cancelScroll();
      scrollSetTop(position);
    }
  };

  const scrollToItem = (
    id: string | number,
    alignOrOptions?:
      | "start"
      | "center"
      | "end"
      | import("../types").ScrollToOptions,
  ): void => {
    const index = idToIndex.get(id) ?? ctx.dataManager.getIndexById(id);
    if (index >= 0) scrollToIndex(index, alignOrOptions);
  };

  const getScrollPosition = (): number => scrollGetTop();

  // ── Event subscription ──────────────────────────────────────────

  const on = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): Unsubscribe => {
    return emitter.on(event as string, handler);
  };

  const off = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): void => {
    emitter.off(event as string, handler);
  };

  // ── Destroy ─────────────────────────────────────────────────────

  const destroy = (): void => {
    if (isDestroyed) return;
    isDestroyed = true;
    ctx.state.isDestroyed = true;

    dom.items.removeEventListener("click", handleClick);
    dom.root.removeEventListener("keydown", handleKeydown);
    scrollTarget.removeEventListener("scroll", onScrollFrame);
    resizeObserver.disconnect();

    if (wheelHandler) {
      dom.viewport.removeEventListener("wheel", wheelHandler);
    }
    if (idleTimer) clearTimeout(idleTimer);

    for (let i = 0; i < destroyHandlers.length; i++) {
      destroyHandlers[i]!();
    }
    for (const plugin of sortedPlugins) {
      if (plugin.destroy) plugin.destroy();
    }

    cancelScroll();

    for (const [, element] of rendered) {
      element.remove();
      pool.release(element);
    }
    rendered.clear();
    pool.clear();
    emitter.clear();

    dom.root.remove();
  };

  // ── Assemble public API ─────────────────────────────────────────

  const api: BuiltVList<T> = {
    get element() {
      return dom.root;
    },
    get items() {
      // Check if a plugin (e.g., groups) provides a custom items getter
      if (methods.has("_getItems")) {
        return (methods.get("_getItems") as any)();
      }
      return items as readonly T[];
    },
    get total() {
      // Check if a plugin (e.g., groups) provides a custom total getter
      if (methods.has("_getTotal")) {
        return (methods.get("_getTotal") as any)();
      }
      return virtualTotalFn();
    },

    setItems: methods.has("setItems")
      ? (methods.get("setItems") as any)
      : setItems,
    appendItems: methods.has("appendItems")
      ? (methods.get("appendItems") as any)
      : appendItems,
    prependItems: methods.has("prependItems")
      ? (methods.get("prependItems") as any)
      : prependItems,
    updateItem: methods.has("updateItem")
      ? (methods.get("updateItem") as any)
      : updateItem,
    removeItem: methods.has("removeItem")
      ? (methods.get("removeItem") as any)
      : removeItem,
    reload: methods.has("reload") ? (methods.get("reload") as any) : reload,

    scrollToIndex: methods.has("scrollToIndex")
      ? (methods.get("scrollToIndex") as any)
      : scrollToIndex,
    scrollToItem: methods.has("scrollToItem")
      ? (methods.get("scrollToItem") as any)
      : scrollToItem,
    cancelScroll: methods.has("cancelScroll")
      ? (methods.get("cancelScroll") as any)
      : cancelScroll,
    getScrollPosition: methods.has("getScrollPosition")
      ? (methods.get("getScrollPosition") as any)
      : getScrollPosition,

    on,
    off,
    destroy,
  };

  // Merge plugin methods
  for (const [name, fn] of methods) {
    if (
      name === "setItems" ||
      name === "appendItems" ||
      name === "prependItems" ||
      name === "updateItem" ||
      name === "removeItem" ||
      name === "reload" ||
      name === "scrollToIndex" ||
      name === "scrollToItem" ||
      name === "cancelScroll" ||
      name === "getScrollPosition"
    ) {
      continue;
    }
    (api as any)[name] = fn;
  }

  return api;
}
