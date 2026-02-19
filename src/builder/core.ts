/**
 * vlist/builder — Composable virtual list builder
 *
 * Pure utilities (velocity, DOM, pool, range, scroll) live in sibling files.
 * Height cache and emitter are reused from rendering/ and events/ modules.
 * Bun.build inlines everything into a single bundle automatically.
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

// Extracted utilities — Bun.build inlines these into the single bundle
import {
  createVelocityTracker,
  updateVelocityTracker,
  MIN_RELIABLE_SAMPLES,
} from "./velocity";
import { createHeightCache } from "../rendering/heights";
import { createEmitter } from "../events/emitter";
import { resolveContainer, createDOMStructure } from "./dom";
import { createElementPool } from "./pool";
import { calcVisibleRange, applyOverscan, calcScrollToPosition } from "./range";
import { easeInOutQuad, resolveScrollArgs } from "./scroll";
import {
  createMaterializeCtx,
  createDefaultDataProxy,
  createDefaultScrollProxy,
} from "./materializectx";
import type { MRefs } from "./materializectx";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OVERSCAN = 3;
const DEFAULT_CLASS_PREFIX = "vlist";
const SCROLL_IDLE_TIMEOUT = 150;

// =============================================================================
// Module-level instance counter for unique ARIA element IDs
// =============================================================================

let builderInstanceId = 0;

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

  // ── Create core components ──────────────────────────────────────
  const emitter = createEmitter<VListEvents<T>>();
  const initialItemsCopy: T[] = initialItems ? [...initialItems] : [];
  const initialHeightCache = createHeightCache(
    mainAxisSizeConfig,
    initialItemsCopy.length,
  );
  const pool = createElementPool();

  // ── Shared mutable refs ($) ─────────────────────────────────────
  // All mutable state lives here so that extracted factories (ctx,
  // data proxy, scroll proxy) and core.ts read/write the same values.
  const $: MRefs<T> = {
    items: initialItemsCopy,
    heightCache: initialHeightCache,
    containerHeight: dom.viewport.clientHeight,
    containerWidth: dom.viewport.clientWidth,
    isDestroyed: false,
    isInitialized: false,
    lastScrollTop: 0,
    velocityTracker: createVelocityTracker(0),
    selectionSet: new Set<string | number>(),
    focusedIndex: -1,
    lastAriaSetSize: "",
    dataManagerProxy: null as any,
    scrollControllerProxy: null as any,
    virtualTotalFn: null as unknown as () => number,
    scrollGetTop: isHorizontal
      ? () => dom.viewport.scrollLeft
      : () => dom.viewport.scrollTop,
    scrollSetTop: isHorizontal
      ? (pos: number) => {
          dom.viewport.scrollLeft = pos;
        }
      : (pos: number) => {
          dom.viewport.scrollTop = pos;
        },
    scrollIsAtBottom: (threshold = 2) => {
      const total = $.heightCache.getTotalHeight();
      return $.lastScrollTop + $.containerHeight >= total - threshold;
    },
    scrollIsCompressed: false,
    renderIfNeededFn: null as unknown as () => void,
    forceRenderFn: null as unknown as () => void,
    getVisibleRange: (scrollTop, cHeight, hc, total, out) => {
      calcVisibleRange(scrollTop, cHeight, hc, total, out);
    },
    getScrollToPos: (index, hc, cHeight, total, align) => {
      return calcScrollToPosition(index, hc, cHeight, total, align);
    },
    positionElementFn: null as unknown as (
      element: HTMLElement,
      index: number,
    ) => void,
    activeTemplate: itemConfig.template as ItemTemplate<T>,
    viewportResizeEnabled: true,
    scrollTarget: dom.viewport as HTMLElement | Window,
    getContainerWidth: () => $.containerWidth,
    getContainerHeight: () => $.containerHeight,
  };

  // virtualTotalFn must reference $ after creation
  $.virtualTotalFn = () =>
    $.dataManagerProxy ? $.dataManagerProxy.getTotal() : $.items.length;

  // Local-only mutable state (not needed by extracted factories)
  let animationFrameId: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Reusable range objects (no allocation on scroll)
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };
  const lastRenderRange: Range = { start: -1, end: -1 };

  // Shared state object for plugins (defined early so core render can reference it)
  const sharedState: BuilderState = {
    viewportState: {
      scrollTop: 0,
      containerHeight: $.containerHeight,
      totalHeight: $.heightCache.getTotalHeight(),
      actualHeight: $.heightCache.getTotalHeight(),
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

  // ID → index map for fast lookups
  const idToIndex = new Map<string | number, number>();

  const rebuildIdIndex = (): void => {
    idToIndex.clear();
    for (let i = 0; i < $.items.length; i++) {
      const item = $.items[i];
      if (item) idToIndex.set(item.id, i);
    }
  };

  rebuildIdIndex();

  // ── Plugin extension points ─────────────────────────────────────
  const afterScroll: Array<(scrollTop: number, direction: string) => void> = [];
  const clickHandlers: Array<(event: MouseEvent) => void> = [];
  const keydownHandlers: Array<(event: KeyboardEvent) => void> = [];
  const resizeHandlers: Array<(width: number, height: number) => void> = [];
  const contentSizeHandlers: Array<() => void> = [];
  const destroyHandlers: Array<() => void> = [];
  const methods: Map<string, Function> = new Map();

  // ── Rendering ───────────────────────────────────────────────────

  const applyTemplate = (
    element: HTMLElement,
    result: string | HTMLElement,
  ): void => {
    if (typeof result === "string") element.innerHTML = result;
    else element.replaceChildren(result);
  };

  const positionElement = (element: HTMLElement, index: number): void => {
    const offset = Math.round($.heightCache.getOffset(index));
    if (isHorizontal) {
      element.style.transform = `translateX(${offset}px)`;
    } else {
      element.style.transform = `translateY(${offset}px)`;
    }
  };

  // Set initial position function on refs
  $.positionElementFn = positionElement;

  const renderItem = (index: number, item: T): HTMLElement => {
    const element = pool.acquire();
    element.className = baseClass;

    if (isHorizontal) {
      element.style.width = `${$.heightCache.getHeight(index)}px`;
      if (crossAxisSize != null) {
        element.style.height = `${crossAxisSize}px`;
      }
    } else {
      element.style.height = `${$.heightCache.getHeight(index)}px`;
    }

    element.dataset.index = String(index);
    element.dataset.id = String(item.id);
    element.ariaSelected = "false";
    element.id = `${ariaIdPrefix}-item-${index}`;
    $.lastAriaSetSize = String($.virtualTotalFn());
    element.setAttribute("aria-setsize", $.lastAriaSetSize);
    element.setAttribute("aria-posinset", String(index + 1));

    // Add placeholder class if this is a placeholder item
    const isPlaceholder = String(item.id).startsWith("__placeholder_");
    if (isPlaceholder) {
      element.classList.add(`${classPrefix}-item--placeholder`);
    }

    applyTemplate(element, $.activeTemplate(item, index, itemState));
    $.positionElementFn(element, index);
    return element;
  };

  const updateContentSize = (): void => {
    const size = `${$.heightCache.getTotalHeight()}px`;
    if (isHorizontal) {
      dom.content.style.width = size;
    } else {
      dom.content.style.height = size;
    }
  };

  // ── Main render function ────────────────────────────────────────
  // This is the hot path — called on every scroll-triggered range change.

  const coreRenderIfNeeded = (): void => {
    if ($.isDestroyed) return;

    const total = $.virtualTotalFn();
    $.getVisibleRange(
      $.lastScrollTop,
      $.containerHeight,
      $.heightCache,
      total,
      visibleRange,
    );
    applyOverscan(visibleRange, overscan, total, renderRange);

    if (
      renderRange.start === lastRenderRange.start &&
      renderRange.end === lastRenderRange.end
    ) {
      // In compressed mode, items must be repositioned even when range is unchanged
      // because their positions are relative to the viewport, not absolute
      if ($.scrollIsCompressed) {
        // Reposition all currently rendered items
        for (const [index, element] of rendered) {
          $.positionElementFn(element, index);
        }
      }
      return;
    }

    const currentSetSize = String(total);
    const setSizeChanged = currentSetSize !== $.lastAriaSetSize;
    $.lastAriaSetSize = currentSetSize;

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
        $.dataManagerProxy ? $.dataManagerProxy.getItem(i) : $.items[i]
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

          applyTemplate(existing, $.activeTemplate(item, i, itemState));
          existing.dataset.id = newId;
          if (isHorizontal) {
            existing.style.width = `${$.heightCache.getHeight(i)}px`;
          } else {
            existing.style.height = `${$.heightCache.getHeight(i)}px`;
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
        $.positionElementFn(existing, i);

        // Selection class updates
        const isSelected = $.selectionSet.has(item.id);
        const isFocused = i === $.focusedIndex;
        existing.classList.toggle(`${classPrefix}-item--selected`, isSelected);
        existing.classList.toggle(`${classPrefix}-item--focused`, isFocused);
        existing.ariaSelected = isSelected ? "true" : "false";

        if (setSizeChanged) {
          existing.setAttribute("aria-setsize", $.lastAriaSetSize);
        }
      } else {
        const element = renderItem(i, item);

        // Selection state for new elements
        const isSelected = $.selectionSet.has(item.id);
        const isFocused = i === $.focusedIndex;
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
    sharedState.viewportState.scrollTop = $.lastScrollTop;
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
    $.renderIfNeededFn();
  };

  // Initialize replaceable render function references
  $.renderIfNeededFn = coreRenderIfNeeded;
  $.forceRenderFn = coreForceRender;

  // ── Scroll handling ─────────────────────────────────────────────

  const onScrollFrame = (): void => {
    if ($.isDestroyed) return;

    const scrollTop = $.scrollGetTop();
    const direction: "up" | "down" =
      scrollTop >= $.lastScrollTop ? "down" : "up";

    // Update velocity tracker
    $.velocityTracker = updateVelocityTracker(
      $.velocityTracker as any,
      scrollTop,
    );

    if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
      dom.root.classList.add(`${classPrefix}--scrolling`);
    }

    $.lastScrollTop = scrollTop;
    $.renderIfNeededFn();

    emitter.emit("scroll", { scrollTop, direction });

    // Emit velocity change
    emitter.emit("velocity:change", {
      velocity: $.velocityTracker.velocity,
      reliable: $.velocityTracker.sampleCount >= MIN_RELIABLE_SAMPLES,
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
      $.velocityTracker.velocity = 0;
      $.velocityTracker.sampleCount = 0;
      emitter.emit("velocity:change", {
        velocity: 0,
        reliable: false,
      });
    }, scrollConfig?.idleTimeout ?? SCROLL_IDLE_TIMEOUT);
  };

  // Wheel handler (can be disabled via config)
  let wheelHandler: ((e: WheelEvent) => void) | null = null;

  // Attach scroll listener to initial target ($.scrollTarget set during $ init)
  $.scrollTarget.addEventListener("scroll", onScrollFrame, { passive: true });

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
          $.dataManagerProxy?.getItem(layoutIndex) ?? $.items[layoutIndex];
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
          $.dataManagerProxy?.getItem(layoutIndex) ?? $.items[layoutIndex];
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

  const resizeObserver = new ResizeObserver((entries) => {
    if ($.isDestroyed) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      const newWidth = entry.contentRect.width;
      const newMainAxis = isHorizontal ? newWidth : newHeight;

      // Always update dimensions (even before initialization)
      $.containerWidth = newWidth;

      if (Math.abs(newMainAxis - $.containerHeight) > 1) {
        $.containerHeight = newMainAxis;
        sharedState.viewportState.containerHeight = newMainAxis;

        // Only render if already initialized (plugins have run)
        if ($.isInitialized) {
          updateContentSize();
          $.renderIfNeededFn();
          emitter.emit("resize", { height: newHeight, width: newWidth });
        }
      }

      // Only call resize handlers if initialized
      if ($.isInitialized) {
        for (let i = 0; i < resizeHandlers.length; i++) {
          resizeHandlers[i]!(newWidth, newHeight);
        }
      }
    }
  });

  // Plugins can disable viewport resize observation
  if ($.viewportResizeEnabled) {
    resizeObserver.observe(dom.viewport);
  }

  // ── BuilderContext + proxies (extracted to materializectx.ts) ───

  const deps = {
    dom,
    emitter,
    resolvedConfig,
    rawConfig: config,
    rendered,
    pool,
    itemState,
    sharedState,
    idToIndex,
    renderRange,
    isHorizontal,
    classPrefix,
    contentSizeHandlers,
    afterScroll,
    clickHandlers,
    keydownHandlers,
    resizeHandlers,
    destroyHandlers,
    methods,
    onScrollFrame,
    resizeObserver,
    rebuildIdIndex,
    applyTemplate,
    updateContentSize,
  };

  const ctx: BuilderContext<T> = createMaterializeCtx($, deps);

  $.dataManagerProxy = createDefaultDataProxy($, deps, ctx);
  $.scrollControllerProxy = createDefaultScrollProxy($, deps);

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
  $.isInitialized = true;
  ctx.state.isInitialized = true;

  // ── Initial render ──────────────────────────────────────────────
  updateContentSize();
  $.renderIfNeededFn();

  // Reverse mode: scroll to bottom
  if (isReverse && $.items.length > 0) {
    const pos = $.getScrollToPos(
      $.items.length - 1,
      $.heightCache,
      $.containerHeight,
      $.items.length,
      "end",
    );
    $.scrollSetTop(pos);
    $.lastScrollTop = pos;
    $.renderIfNeededFn();
  }

  // ── Base data methods ───────────────────────────────────────────

  const setItems = (newItems: T[]): void => {
    ctx.dataManager.setItems(newItems, 0, newItems.length);
  };

  const appendItems = isReverse
    ? (newItems: T[]): void => {
        const wasAtBottom = $.scrollIsAtBottom(2);
        const currentTotal = $.items.length;
        ctx.dataManager.setItems(newItems, currentTotal);
        if (wasAtBottom && $.items.length > 0) {
          const pos = $.getScrollToPos(
            $.items.length - 1,
            $.heightCache,
            $.containerHeight,
            $.items.length,
            "end",
          );
          $.scrollSetTop(pos);
          $.lastScrollTop = pos;
          $.renderIfNeededFn();
        }
      }
    : (newItems: T[]): void => {
        const currentTotal = $.items.length;
        ctx.dataManager.setItems(newItems, currentTotal);
      };

  const prependItems = isReverse
    ? (newItems: T[]): void => {
        const scrollTop = $.scrollGetTop();
        const heightBefore = $.heightCache.getTotalHeight();
        const existingItems = [...$.items];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
        const heightAfter = $.heightCache.getTotalHeight();
        const delta = heightAfter - heightBefore;
        if (delta > 0) {
          $.scrollSetTop(scrollTop + delta);
          $.lastScrollTop = scrollTop + delta;
        }
      }
    : (newItems: T[]): void => {
        const existingItems = [...$.items];
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
      $.scrollSetTop(to);
      $.lastScrollTop = to;
      $.renderIfNeededFn();
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      $.scrollSetTop(newPos);
      // Update lastScrollTop BEFORE rendering so range calculation uses correct value
      $.lastScrollTop = newPos;
      // Ensure rendering happens on each frame during smooth scroll
      $.renderIfNeededFn();
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
    const total = $.virtualTotalFn();

    let idx = index;
    if (wrapEnabled && total > 0) {
      idx = ((idx % total) + total) % total;
    }

    const position = $.getScrollToPos(
      idx,
      $.heightCache,
      $.containerHeight,
      total,
      align,
    );

    if (behavior === "smooth") {
      animateScroll($.scrollGetTop(), position, duration);
    } else {
      cancelScroll();
      $.scrollSetTop(position);
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

  const getScrollPosition = (): number => $.scrollGetTop();

  // ── Event subscription ──────────────────────────────────────────

  const on = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): Unsubscribe => {
    return emitter.on(
      event,
      handler as EventHandler<VListEvents<T>[typeof event]>,
    );
  };

  const off = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): void => {
    emitter.off(event, handler as EventHandler<VListEvents<T>[typeof event]>);
  };

  // ── Destroy ─────────────────────────────────────────────────────

  const destroy = (): void => {
    if ($.isDestroyed) return;
    $.isDestroyed = true;
    ctx.state.isDestroyed = true;

    dom.items.removeEventListener("click", handleClick);
    dom.root.removeEventListener("keydown", handleKeydown);
    $.scrollTarget.removeEventListener("scroll", onScrollFrame);
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
      return $.items as readonly T[];
    },
    get total() {
      // Check if a plugin (e.g., groups) provides a custom total getter
      if (methods.has("_getTotal")) {
        return (methods.get("_getTotal") as any)();
      }
      return $.virtualTotalFn();
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
