/**
 * vlist/builder — Composable virtual list builder
 *
 * Pure utilities (velocity, DOM, pool, range, scroll) live in sibling files.
 * Size cache and emitter are reused from rendering/ and events/ modules.
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
import { createSizeCache } from "../rendering/sizes";
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

  const isHorizontal = config.orientation === "horizontal";
  const mainAxisProp = isHorizontal ? "width" : "height";
  const mainAxisValue = isHorizontal ? config.item.width : config.item.height;

  if (mainAxisValue == null) {
    throw new Error(
      `[vlist/builder] item.${mainAxisProp} is required${isHorizontal ? " when orientation is 'horizontal'" : ""}`,
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

  // Detect mobile devices once at creation time - preserve native touch scrolling
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
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
        "[vlist/builder] withGrid cannot be used with orientation: 'horizontal'",
      );
    }
    // Note: withGroups/withSections DOES support horizontal orientation
    // (sticky headers stick to left edge instead of top)
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

  // Use items array by reference (memory-optimized)
  const initialItemsArray: T[] = initialItems || [];

  const initialSizeCache = createSizeCache(
    mainAxisSizeConfig,
    initialItemsArray.length,
  );
  const pool = createElementPool();

  // ── Shared mutable refs ($) ─────────────────────────────────────
  // All mutable state lives here so that extracted factories (ctx,
  // data proxy, scroll proxy) and core.ts read/write the same values.
  const $: MRefs<T> = {
    it: initialItemsArray,
    hc: initialSizeCache,
    ch: dom.viewport.clientHeight,
    cw: dom.viewport.clientWidth,
    id: false,
    ii: false,
    ls: 0,
    vt: createVelocityTracker(0),
    ss: new Set<string | number>(),
    fi: -1,
    la: "",
    dm: null as any,
    sc: null as any,
    vtf: null as unknown as () => number,
    sgt: isHorizontal
      ? () => dom.viewport.scrollLeft
      : () => dom.viewport.scrollTop,
    sst: isHorizontal
      ? (pos: number) => {
          dom.viewport.scrollLeft = pos;
        }
      : (pos: number) => {
          dom.viewport.scrollTop = pos;
        },
    sab: (threshold = 2) => {
      const total = $.hc.getTotalSize();
      return $.ls + $.ch >= total - threshold;
    },
    sic: false,
    rfn: null as unknown as () => void,
    ffn: null as unknown as () => void,
    gvr: (scrollTop, cHeight, hc, total, out) => {
      calcVisibleRange(scrollTop, cHeight, hc, total, out);
    },
    gsp: (index, hc, cHeight, total, align) => {
      return calcScrollToPosition(index, hc, cHeight, total, align);
    },
    pef: null as unknown as (element: HTMLElement, index: number) => void,
    at: itemConfig.template as ItemTemplate<T>,
    vre: true,
    st: dom.viewport as HTMLElement | Window,
    gcw: () => $.cw,
    gch: () => $.ch,
  };

  // virtualTotalFn must reference $ after creation
  $.vtf = () => ($.dm ? $.dm.getTotal() : $.it.length);

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
      scrollPosition: 0,
      containerSize: $.ch,
      totalSize: $.hc.getTotalSize(),
      actualSize: $.hc.getTotalSize(),
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

  // No ID → index map (removed for memory efficiency)
  // Users can implement their own Map if needed for O(1) lookups

  // ── Plugin extension points ─────────────────────────────────────
  const afterScroll: Array<
    (scrollPosition: number, direction: string) => void
  > = [];
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
    const offset = Math.round($.hc.getOffset(index));
    if (isHorizontal) {
      element.style.transform = `translateX(${offset}px)`;
    } else {
      element.style.transform = `translateY(${offset}px)`;
    }
  };

  // Set initial position function on refs
  $.pef = positionElement;

  const renderItem = (index: number, item: T): HTMLElement => {
    const element = pool.acquire();
    element.className = baseClass;

    if (isHorizontal) {
      element.style.width = `${$.hc.getSize(index)}px`;
      if (crossAxisSize != null) {
        element.style.height = `${crossAxisSize}px`;
      }
    } else {
      element.style.height = `${$.hc.getSize(index)}px`;
    }

    element.dataset.index = String(index);
    element.dataset.id = String(item.id);
    element.ariaSelected = "false";
    element.id = `${ariaIdPrefix}-item-${index}`;
    $.la = String($.vtf());
    element.setAttribute("aria-setsize", $.la);
    element.setAttribute("aria-posinset", String(index + 1));

    // Add placeholder class if this is a placeholder item
    const isPlaceholder = String(item.id).startsWith("__placeholder_");
    if (isPlaceholder) {
      element.classList.add(`${classPrefix}-item--placeholder`);
    }

    applyTemplate(element, $.at(item, index, itemState));
    $.pef(element, index);
    return element;
  };

  const updateContentSize = (): void => {
    const size = `${$.hc.getTotalSize()}px`;
    if (isHorizontal) {
      dom.content.style.width = size;
    } else {
      dom.content.style.height = size;
    }
  };

  // ── Main render function ────────────────────────────────────────
  // This is the hot path — called on every scroll-triggered range change.

  const coreRenderIfNeeded = (): void => {
    if ($.id) return;

    const total = $.vtf();
    $.gvr($.ls, $.ch, $.hc, total, visibleRange);
    applyOverscan(visibleRange, overscan, total, renderRange);

    if (
      renderRange.start === lastRenderRange.start &&
      renderRange.end === lastRenderRange.end
    ) {
      // In compressed mode, items must be repositioned even when range is unchanged
      // because their positions are relative to the viewport, not absolute
      if ($.sic) {
        // Reposition all currently rendered items
        for (const [index, element] of rendered) {
          $.pef(element, index);
        }
      }
      return;
    }

    const currentSetSize = String(total);
    const setSizeChanged = currentSetSize !== $.la;
    $.la = currentSetSize;

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
      const item = ($.dm ? $.dm.getItem(i) : $.it[i]) as T | undefined;
      if (!item) continue;

      const existing = rendered.get(i);
      if (existing) {
        const existingId = existing.dataset.id;
        const newId = String(item.id);
        if (existingId !== newId) {
          // Check if we're replacing a placeholder (ID starts with __placeholder_)
          const wasPlaceholder = existingId?.startsWith("__placeholder_");
          const isPlaceholder = newId.startsWith("__placeholder_");

          applyTemplate(existing, $.at(item, i, itemState));
          existing.dataset.id = newId;
          if (isHorizontal) {
            existing.style.width = `${$.hc.getSize(i)}px`;
          } else {
            existing.style.height = `${$.hc.getSize(i)}px`;
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
        $.pef(existing, i);

        // Selection class updates
        const isSelected = $.ss.has(item.id);
        const isFocused = i === $.fi;
        existing.classList.toggle(`${classPrefix}-item--selected`, isSelected);
        existing.classList.toggle(`${classPrefix}-item--focused`, isFocused);
        existing.ariaSelected = isSelected ? "true" : "false";

        if (setSizeChanged) {
          existing.setAttribute("aria-setsize", $.la);
        }
      } else {
        const element = renderItem(i, item);

        // Selection state for new elements
        const isSelected = $.ss.has(item.id);
        const isFocused = i === $.fi;
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
    sharedState.viewportState.scrollPosition = $.ls;
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
    $.rfn();
  };

  // Initialize replaceable render function references
  $.rfn = coreRenderIfNeeded;
  $.ffn = coreForceRender;

  // ── Scroll handling ─────────────────────────────────────────────

  const onScrollFrame = (): void => {
    if ($.id) return;

    const scrollTop = $.sgt();
    const direction: "up" | "down" = scrollTop >= $.ls ? "down" : "up";

    // Update velocity tracker
    $.vt = updateVelocityTracker($.vt as any, scrollTop);

    if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
      dom.root.classList.add(`${classPrefix}--scrolling`);
    }

    $.ls = scrollTop;
    $.rfn();

    emitter.emit("scroll", { scrollPosition: scrollTop, direction });

    // Emit velocity change
    emitter.emit("velocity:change", {
      velocity: $.vt.velocity,
      reliable: $.vt.sampleCount >= MIN_RELIABLE_SAMPLES,
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
      $.vt.velocity = 0;
      $.vt.sampleCount = 0;
      emitter.emit("velocity:change", {
        velocity: 0,
        reliable: false,
      });
    }, scrollConfig?.idleTimeout ?? SCROLL_IDLE_TIMEOUT);
  };

  // Wheel handler (can be disabled via config)
  let wheelHandler: ((e: WheelEvent) => void) | null = null;

  // Attach scroll listener to initial target ($.st set during $ init)
  $.st.addEventListener("scroll", onScrollFrame, { passive: true });

  // Setup wheel handling for consistent synchronous rendering
  // Intercept wheel events and render before scroll position updates
  // This prevents blank areas during fast scrolling on desktop browsers
  // Skip on mobile to preserve native touch scrolling with momentum/bounce
  if (wheelEnabled && !isHorizontal && !isMobile) {
    // Intercept wheel events and handle scroll manually
    wheelHandler = (event: WheelEvent): void => {
      event.preventDefault();

      // Get current scroll position
      const currentScroll = $.sgt();
      const delta = event.deltaY;

      // Calculate new scroll position
      const newScroll = Math.max(
        0,
        Math.min(currentScroll + delta, $.hc.getTotalSize() - $.ch),
      );

      // Update scroll position
      $.sst(newScroll);

      // Trigger scroll frame handler immediately (synchronous rendering)
      $.ls = newScroll;
      $.vt = updateVelocityTracker($.vt as any, newScroll);
      $.rfn();

      // Emit scroll event
      const direction: "up" | "down" =
        newScroll >= currentScroll ? "down" : "up";
      emitter.emit("scroll", { scrollPosition: newScroll, direction });

      // Update scrolling class
      if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
        dom.root.classList.add(`${classPrefix}--scrolling`);
      }

      // Idle detection
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        dom.root.classList.remove(`${classPrefix}--scrolling`);
        $.vt.velocity = 0;
        $.vt.sampleCount = 0;
        emitter.emit("velocity:change", { velocity: 0, reliable: false });
      }, scrollConfig?.idleTimeout ?? SCROLL_IDLE_TIMEOUT);
    };
    dom.viewport.addEventListener("wheel", wheelHandler, { passive: false });
  } else if (isHorizontal && wheelEnabled) {
    // Horizontal mode: convert vertical wheel to horizontal scroll
    wheelHandler = (event: WheelEvent): void => {
      if (event.deltaX) return; // native horizontal scroll handles it
      event.preventDefault();
      dom.viewport.scrollLeft += event.deltaY;
    };
    dom.viewport.addEventListener("wheel", wheelHandler, { passive: false });
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
        const item = $.dm?.getItem(layoutIndex) ?? $.it[layoutIndex];
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
        const item = $.dm?.getItem(layoutIndex) ?? $.it[layoutIndex];
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
    if ($.id) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      const newWidth = entry.contentRect.width;
      const newMainAxis = isHorizontal ? newWidth : newHeight;

      // Always update dimensions (even before initialization)
      $.cw = newWidth;

      if (Math.abs(newMainAxis - $.ch) > 1) {
        $.ch = newMainAxis;
        sharedState.viewportState.containerSize = newMainAxis;

        // Only render if already initialized (plugins have run)
        if ($.ii) {
          updateContentSize();
          $.rfn();
          emitter.emit("resize", { height: newHeight, width: newWidth });
        }
      }

      // Only call resize handlers if initialized
      if ($.ii) {
        for (let i = 0; i < resizeHandlers.length; i++) {
          resizeHandlers[i]!(newWidth, newHeight);
        }
      }
    }
  });

  // Plugins can disable viewport resize observation
  if ($.vre) {
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
    applyTemplate,
    updateContentSize,
  };

  const ctx: BuilderContext<T> = createMaterializeCtx($, deps);

  $.dm = createDefaultDataProxy($, deps, ctx);
  $.sc = createDefaultScrollProxy($, deps);

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
  $.ii = true;
  ctx.state.isInitialized = true;

  // ── Initial render ──────────────────────────────────────────────
  updateContentSize();
  $.rfn();

  // Reverse mode: scroll to bottom
  if (isReverse && $.it.length > 0) {
    const pos = $.gsp($.it.length - 1, $.hc, $.ch, $.it.length, "end");
    $.sst(pos);
    $.ls = pos;
    $.rfn();
  }

  // ── Base data methods ───────────────────────────────────────────

  const setItems = (newItems: T[]): void => {
    ctx.dataManager.setItems(newItems, 0, newItems.length);
  };

  const appendItems = isReverse
    ? (newItems: T[]): void => {
        const wasAtBottom = $.sab(2);
        const currentTotal = $.it.length;
        ctx.dataManager.setItems(newItems, currentTotal);
        if (wasAtBottom && $.it.length > 0) {
          const pos = $.gsp($.it.length - 1, $.hc, $.ch, $.it.length, "end");
          $.sst(pos);
          $.ls = pos;
          $.rfn();
        }
      }
    : (newItems: T[]): void => {
        const currentTotal = $.it.length;
        ctx.dataManager.setItems(newItems, currentTotal);
      };

  const prependItems = isReverse
    ? (newItems: T[]): void => {
        const scrollTop = $.sgt();
        const heightBefore = $.hc.getTotalSize();
        const existingItems = [...$.it];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
        const heightAfter = $.hc.getTotalSize();
        const delta = heightAfter - heightBefore;
        if (delta > 0) {
          $.sst(scrollTop + delta);
          $.ls = scrollTop + delta;
        }
      }
    : (newItems: T[]): void => {
        const existingItems = [...$.it];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
      };

  const updateItem = (index: number, updates: Partial<T>): void => {
    ctx.dataManager.updateItem(index, updates);
  };

  const removeItem = (index: number): void => {
    ctx.dataManager.removeItem(index);
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
      $.sst(to);
      $.ls = to;
      $.rfn();
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      $.sst(newPos);
      // Update lastScrollTop BEFORE rendering so range calculation uses correct value
      $.ls = newPos;
      // Ensure rendering happens on each frame during smooth scroll
      $.rfn();
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
    const total = $.vtf();

    let idx = index;
    if (wrapEnabled && total > 0) {
      idx = ((idx % total) + total) % total;
    }

    const position = $.gsp(idx, $.hc, $.ch, total, align);

    if (behavior === "smooth") {
      animateScroll($.sgt(), position, duration);
    } else {
      cancelScroll();
      $.sst(position);
    }
  };

  // scrollToItem removed - use scrollToIndex instead
  // Users can maintain their own id→index map if needed

  const getScrollPosition = (): number => $.sgt();

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
    if ($.id) return;
    $.id = true;
    ctx.state.isDestroyed = true;

    dom.items.removeEventListener("click", handleClick);
    dom.root.removeEventListener("keydown", handleKeydown);
    $.st.removeEventListener("scroll", onScrollFrame);
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
      return $.it as readonly T[];
    },
    get total() {
      // Check if a plugin (e.g., groups) provides a custom total getter
      if (methods.has("_getTotal")) {
        return (methods.get("_getTotal") as any)();
      }
      return $.vtf();
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
