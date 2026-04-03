/**
 * vlist/builder — Composable virtual list builder
 *
 * Pure utilities (velocity, DOM, pool, range, scroll) live in sibling files.
 * Size cache and emitter are reused from rendering/ and events/ modules.
 * Bun.build inlines everything into a single bundle automatically.
 *
 * Features compose functionality *around* the hot path via extension points:
 * afterScroll, clickHandlers, keydownHandlers, resizeHandlers, destroyHandlers,
 * and the methods Map for public API extension.
 */

import type {
  VListItem,
  VListEvents,
  ItemTemplate,
  ItemState,
  Range,
  ErrorViewportSnapshot,
} from "../types";

import type { ScrollConfig } from "../types";

import type {
  BuilderConfig,
  BuilderContext,
  BuilderState,
  ResolvedBuilderConfig,
  VListFeature,
  VListBuilder,
  VList,
} from "./types";

// Re-export CompressionState type from viewport for features that need it
export type { CompressionState } from "../rendering/viewport";

// Extracted utilities — Bun.build inlines these into the single bundle
import {
  createVelocityTracker,
  updateVelocityTracker,
  MIN_RELIABLE_SAMPLES,
} from "./velocity";
import { createSizeCache } from "../rendering/sizes";
import { createMeasuredSizeCache, type MeasuredSizeCache } from "../rendering/measured";
import { createEmitter } from "../events/emitter";
import { resolveContainer, createDOMStructure } from "./dom";
import { createElementPool } from "./pool";
import { calcVisibleRange, applyOverscan, calcScrollToPosition } from "./range";
import { resolvePadding, mainAxisPaddingFrom } from "../utils/padding";
import { sortRenderedDOM } from "../rendering/sort";
import {
  createMaterializeCtx,
  createDefaultDataProxy,
  createDefaultScrollProxy,
} from "./materialize";
import type { MRefs } from "./materialize";
import { createMeasurement } from "./measurement";
import { createApi } from "./api";
import {
  OVERSCAN,
  CLASS_PREFIX,
  SCROLL_IDLE_TIMEOUT,
} from "../constants";

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
  const estimatedProp = isHorizontal ? "estimatedWidth" : "estimatedHeight";
  const mainAxisValue = isHorizontal ? config.item.width : config.item.height;
  const estimatedSize = isHorizontal
    ? config.item.estimatedWidth
    : config.item.estimatedHeight;

  // Mode priority: explicit size (Mode A) > estimated size (Mode B)
  if (mainAxisValue == null && estimatedSize == null) {
    throw new Error(
      `[vlist/builder] item.${mainAxisProp} or item.${estimatedProp} is required${isHorizontal ? " when orientation is 'horizontal'" : ""}`,
    );
  }
  if (mainAxisValue != null) {
    // Mode A validation
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
  } else if (estimatedSize != null) {
    // Mode B validation
    if (typeof estimatedSize !== "number" || estimatedSize <= 0) {
      throw new Error(
        `[vlist/builder] item.${estimatedProp} must be a positive number`,
      );
    }
  }
  if (!config.item.template) {
    throw new Error("[vlist/builder] item.template is required");
  }
  if (isHorizontal && config.reverse) {
    throw new Error(
      "[vlist/builder] horizontal direction cannot be combined with reverse mode",
    );
  }

  // ── Store features ───────────────────────────────────────────────
  const features: Map<string, VListFeature<T>> = new Map();
  let built = false;

  const builder: VListBuilder<T> = {
    use(feature: VListFeature<T>): VListBuilder<T> {
      if (built) {
        throw new Error("[vlist/builder] Cannot call .use() after .build()");
      }
      features.set(feature.name, feature);
      return builder;
    },

    build(): VList<T> {
      if (built) {
        throw new Error("[vlist/builder] .build() can only be called once");
      }
      built = true;
      return materialize(
        config,
        features,
        isHorizontal,
        mainAxisValue as (number | ((index: number) => number) | null),
        estimatedSize ?? null,
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
  features: Map<string, VListFeature<T>>,
  isHorizontal: boolean,
  mainAxisValue: number | ((index: number) => number) | null,
  estimatedSizeValue: number | null,
): VList<T> {
  // ── Resolve config ──────────────────────────────────────────────
  const {
    item: itemConfig,
    items: initialItems,
    overscan = OVERSCAN,
    classPrefix = CLASS_PREFIX,
    ariaLabel,
    padding: paddingConfig,
    reverse: reverseMode = false,
    scroll: scrollConfig,
    accessible: accessibleMode = true,
  } = config;

  const scrollCfg: ScrollConfig | undefined = scrollConfig;

  const wheelEnabled = scrollCfg?.wheel ?? true;
  const wrapEnabled = scrollCfg?.wrap ?? false;
  const isReverse = reverseMode;
  const ariaIdPrefix = `${classPrefix}-${builderInstanceId++}`;
  // Grid and masonry features manage their own gap — ignore item.gap when active
  const gap = (features.has("withGrid") || features.has("withMasonry"))
    ? 0
    : (itemConfig.gap ?? 0);
  const mainAxisSizeConfig = mainAxisValue ?? estimatedSizeValue!;
  const measurementEnabled = mainAxisValue == null && estimatedSizeValue != null;

  // Detect touch-primary devices once at creation time — preserve native touch
  // scrolling with momentum/bounce. Uses capability detection (pointer: coarse)
  // instead of UA sniffing: works on foldables, touch laptops, Chrome OS tablets,
  // and doesn't break when browsers freeze/reduce the UA string.
  const isMobile =
    typeof matchMedia === "function" &&
    matchMedia("(pointer: coarse)").matches &&
    !matchMedia("(pointer: fine)").matches;
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
    accessible: accessibleMode,
  };

  // ── Sort and validate features ───────────────────────────────────
  const sortedFeatures = Array.from(features.values()).sort(
    (a, b) => (a.priority ?? 50) - (b.priority ?? 50),
  );

  const featureNames = new Set(sortedFeatures.map((p) => p.name));
  for (const feature of sortedFeatures) {
    if (feature.conflicts) {
      for (const conflict of feature.conflicts) {
        if (featureNames.has(conflict)) {
          throw new Error(
            `[vlist/builder] ${feature.name} and ${conflict} cannot be combined`,
          );
        }
      }
    }
  }

  if (isHorizontal) {
    // Note: withGrid and withGroups both support horizontal orientation
    // - withGrid: items use vertical positioning (TODO: add axis swapping for optimization)
    // - withGroups: sticky headers stick to left edge instead of top
  }
  if (isReverse) {
    if (featureNames.has("withGrid")) {
      throw new Error(
        "[vlist/builder] withGrid cannot be used with reverse: true",
      );
    }
    // Note: withGroups validation moved to feature itself
    // (allows sticky: false with reverse mode for chat UIs)
  }

  // ── Create DOM ──────────────────────────────────────────────────
  const containerElement = resolveContainer(config.container);
  const dom = createDOMStructure(
    containerElement,
    classPrefix,
    ariaLabel,
    isHorizontal,
    accessibleMode,
  );

  // ── Apply scroll config to viewport ─────────────────────────────
  // Handle scroll.wheel: false - disable mouse wheel scrolling
  if (scrollCfg?.wheel === false) {
    if (isHorizontal) {
      dom.viewport.style.overflowX = "hidden";
    } else {
      dom.viewport.style.overflow = "hidden";
    }
  }

  // Handle scroll.scrollbar: "none" - hide scrollbar completely
  if (scrollCfg?.scrollbar === "none") {
    dom.viewport.classList.add(`${classPrefix}-viewport--no-scrollbar`);
  }

  // ── Apply padding to content element ────────────────────────────
  // Works like CSS padding — adds inset space around items.
  // Uses border-box so cross-axis padding (e.g. left/right in vertical
  // mode) doesn't cause overflow on the 100%-wide content element.
  // Main-axis padding is compensated by adding it to the explicit size.
  const pad = resolvePadding(paddingConfig);
  const mainAxisPadding = mainAxisPaddingFrom(pad, isHorizontal);
  if (pad.top || pad.right || pad.bottom || pad.left) {
    dom.content.style.boxSizing = "border-box";
    dom.content.style.padding =
      `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
  }

  // ── Create core components ──────────────────────────────────────
  const emitter = createEmitter<VListEvents<T>>();

  // Use items array by reference (memory-optimized)
  const initialItemsArray: T[] = initialItems || [];

  // When grid or masonry features are active and the size config is a function,
  // skip the initial build (total=0). These features replace the size cache in
  // setup() with a wrapped function that injects grid context. Building the
  // initial cache with the raw user function would crash because it expects
  // context (e.g. columnWidth) that only the feature provides.
  const featureReplacesSizeCache =
    typeof mainAxisSizeConfig === "function" &&
    (features.has("withGrid") || features.has("withMasonry"));

  // ── Gap support ─────────────────────────────────────────────────
  // When gap > 0, wrap the size config so each slot = itemSize + gap.
  // The gap is subtracted from the DOM element height at render time,
  // leaving consistent spacing between items (same pattern as grid/masonry).
  const effectiveSizeConfig: number | ((index: number) => number) =
    gap > 0
      ? typeof mainAxisSizeConfig === "function"
        ? (index: number) =>
            (mainAxisSizeConfig as (index: number) => number)(index) + gap
        : (mainAxisSizeConfig as number) + gap
      : mainAxisSizeConfig;

  const initialSizeCache = measurementEnabled
    ? createMeasuredSizeCache(
        estimatedSizeValue! + gap,
        initialItemsArray.length,
      )
    : createSizeCache(
        effectiveSizeConfig,
        featureReplacesSizeCache ? 0 : initialItemsArray.length,
      );

  // Fix trailing gap: the last item's slot includes a gap that shouldn't
  // add empty space at the bottom of the list.
  if (gap > 0) {
    const origGetTotalSize = initialSizeCache.getTotalSize;
    initialSizeCache.getTotalSize = (): number => {
      const total = origGetTotalSize();
      return total > 0 ? total - gap : 0;
    };
  }
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
      return calcScrollToPosition(index, hc, cHeight, total, align, $.mp);
    },
    pef: null as unknown as (element: HTMLElement, index: number) => void,
    at: itemConfig.template as ItemTemplate<T>,
    vre: true,
    st: dom.viewport as HTMLElement | Window,
    wh: null,
    gcw: () => $.cw,
    gch: () => $.ch,
    gp: gap,
    mp: mainAxisPadding,
    sif: (index: number) => index,
  };

  // virtualTotalFn must reference $ after creation
  $.vtf = () => ($.dm ? $.dm.getTotal() : $.it.length);

  // Local-only mutable state (not needed by extracted factories)
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let isScrolling = false;

  // Reusable range objects (no allocation on scroll)
  const visibleRange: Range = { start: 0, end: 0 };
  const renderRange: Range = { start: 0, end: 0 };
  const lastRenderRange: Range = { start: -1, end: -1 };

  // Shared state object for features (defined early so core render can reference it)
  const sharedState: BuilderState = {
    viewportState: {
      scrollPosition: 0,
      containerSize: isHorizontal ? $.cw : $.ch,
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

  // ── Error reporting helper ──────────────────────────────────────
  const snapshotViewport = (): ErrorViewportSnapshot => ({
    scrollPosition: sharedState.viewportState.scrollPosition,
    containerSize: sharedState.viewportState.containerSize,
    visibleRange: { ...sharedState.viewportState.visibleRange },
    renderRange: { ...sharedState.viewportState.renderRange },
    totalItems: $.vtf(),
    isCompressed: sharedState.viewportState.isCompressed,
  });

  // Rendered item tracking
  const rendered = new Map<number, HTMLElement>();

  /**
   * Reorder DOM children so they follow logical data-index order.
   * Called on scroll idle for accessibility — screen readers traverse
   * DOM order, not visual (transform) order. Since items are
   * position:absolute, this has zero visual impact.
   */
  const sortDOMChildren = (): void => {
    sortRenderedDOM(
      dom.items,
      rendered.keys(),
      (key) => rendered.get(key),
    );
  };

  // ── Content size helper (needed by measurement + render) ────────

  const updateContentSize = (): void => {
    const size = `${$.hc.getTotalSize() + mainAxisPadding}px`;
    if (isHorizontal) {
      dom.content.style.width = size;
    } else {
      dom.content.style.height = size;
    }
  };

  // ── Mode B: Measurement tracking ───────────────────────────────
  const measuredCache = measurementEnabled
    ? (initialSizeCache as MeasuredSizeCache)
    : null;

  const measurement = createMeasurement(
    $,
    dom,
    isHorizontal,
    visibleRange,
    lastRenderRange,
    () => isScrolling,
    updateContentSize,
    measuredCache,
    measurementEnabled,
    gap,
  );

  const itemState: ItemState = { selected: false, focused: false };
  const baseClass = `${classPrefix}-item`;
  const stripedMode = itemConfig.striped;
  const striped = !!stripedMode;
  const stripedFn = stripedMode === "data" || stripedMode === "even" || stripedMode === "odd";
  const oddClass = `${classPrefix}-item--odd`;

  // No ID → index map (removed for memory efficiency)
  // Users can implement their own Map if needed for O(1) lookups

  // ── Feature extension points ─────────────────────────────────────
  const afterScroll: Array<
    (scrollPosition: number, direction: string) => void
  > = [];
  const idleHandlers: Array<() => void> = [];
  const clickHandlers: Array<(event: MouseEvent) => void> = [];
  const keydownHandlers: Array<(event: KeyboardEvent) => void> = [];
  const resizeHandlers: Array<(width: number, height: number) => void> = [];
  const contentSizeHandlers: Array<() => void> = [];
  const destroyHandlers: Array<() => void> = [];
  const methods: Map<string, Function> = new Map();

  // ── Cached selection getter references ──
  // Resolved lazily on first render frame. The selection feature registers
  // _getSelectedIds / _getFocusedIndex on ctx.methods at priority 50,
  // which runs before the initial render. Caching the function references
  // avoids a Map.get() on every scroll frame.
  let selectionIdsGetter: (() => Set<string | number>) | null = null;
  let selectionFocusGetter: (() => number) | null = null;
  let selectionGettersResolved = false;

  const resolveSelectionGetters = (): void => {
    if (selectionGettersResolved) return;
    selectionGettersResolved = true;
    selectionIdsGetter = (methods.get("_getSelectedIds") as (() => Set<string | number>)) ?? null;
    selectionFocusGetter = (methods.get("_getFocusedIndex") as (() => number)) ?? null;
  };

  // ── Rendering ───────────────────────────────────────────────────

  const applyTemplate = (
    element: HTMLElement,
    result: string | HTMLElement,
    index?: number,
  ): void => {
    if (process.env.NODE_ENV !== "production") {
      if (!result) {
        console.warn(`[vlist] Template returned falsy value${index !== undefined ? ` for item at index ${index}` : ''}. The element will render as blank.`);
      } else if (typeof result === "string" && result === "") {
        console.warn(`[vlist] Template returned empty string${index !== undefined ? ` for item at index ${index}` : ''}. The element will render as blank.`);
      }
    }
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

    // Mode B: unmeasured items get no explicit size so ResizeObserver can
    // measure the real content height. Measured items use their known size.
    const shouldConstrainSize =
      !measurementEnabled ||
      (measurement.mc && measurement.mc.isMeasured(index));

    if (isHorizontal) {
      if (shouldConstrainSize) {
        element.style.width = `${$.hc.getSize(index) - gap}px`;
      } else {
        element.style.width = "";
      }
      if (crossAxisSize != null) {
        element.style.height = `${crossAxisSize}px`;
      }
    } else {
      if (shouldConstrainSize) {
        element.style.height = `${$.hc.getSize(index) - gap}px`;
      } else {
        element.style.height = "";
      }
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

    // Striped: toggle odd class based on logical index (not DOM order)
    // String modes ("data"/"even"/"odd"): use $.sif to map layout index → stripe index
    if (striped) {
      if (stripedFn) {
        const si = $.sif(index);
        if (si < 0) element.classList.remove(oddClass);
        else element.classList.toggle(oddClass, (si & 1) === 1);
      } else {
        element.classList.toggle(oddClass, (index & 1) === 1);
      }
    }

    try {
      applyTemplate(element, $.at(item, index, itemState), index);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      emitter.emit("error", {
        error,
        context: `template(index=${index}, id=${item.id})`,
        viewport: snapshotViewport(),
      });
      element.textContent = "";
    }
    $.pef(element, index);
    return element;
  };

  // ── Main render function ────────────────────────────────────────
  // This is the hot path — called on every scroll-triggered range change.

  const coreRenderIfNeeded = (): void => {
    if ($.id) return;

    // #10b: Skip render when container has zero main-axis size (e.g. collapsed
    // accordion, display:none parent). calcVisibleRange would produce a
    // degenerate range and items would be positioned at offset 0, causing a
    // visual flash when the container expands. The ResizeObserver callback
    // will call $.rfn() once the container gets a real size.
    const containerSize = isHorizontal ? $.cw : $.ch;
    if (containerSize <= 0) return;

    // Resolve selection getters lazily (selection feature registers them at setup)
    resolveSelectionGetters();
    const selectedIds = selectionIdsGetter ? selectionIdsGetter() : $.ss;
    const focusedIndex = selectionFocusGetter ? selectionFocusGetter() : $.fi;

    const total = $.vtf();
    $.gvr($.ls, containerSize, $.hc, total, visibleRange);
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
    const newlyRenderedForMeasurement: Array<{
      index: number;
      element: HTMLElement;
    }> = [];

    for (let i = renderRange.start; i <= renderRange.end; i++) {
      const item = ($.dm ? $.dm.getItem(i) : $.it[i]) as T | undefined;
      if (item === undefined) continue;

      const existing = rendered.get(i);
      if (existing) {
        const existingId = existing.dataset.id;
        const newId = String(item.id);
        if (existingId !== newId) {
          // Check if we're replacing a placeholder (ID starts with __placeholder_)
          const wasPlaceholder = existingId?.startsWith("__placeholder_");
          const isPlaceholder = newId.startsWith("__placeholder_");

          try {
            applyTemplate(existing, $.at(item, i, itemState), i);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            emitter.emit("error", {
              error,
              context: `template(index=${i}, id=${item.id})`,
              viewport: snapshotViewport(),
            });
            existing.textContent = "";
          }
          existing.dataset.id = newId;
          // Mode B: unconstrain unmeasured items for ResizeObserver measurement
          const shouldConstrain =
            !measurementEnabled ||
            (measurement.mc && measurement.mc.isMeasured(i));
          if (isHorizontal) {
            existing.style.width = shouldConstrain
              ? `${$.hc.getSize(i) - gap}px`
              : "";
          } else {
            existing.style.height = shouldConstrain
              ? `${$.hc.getSize(i) - gap}px`
              : "";
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
        const isSelected = selectedIds.has(item.id);
        const isFocused = i === focusedIndex;
        existing.classList.toggle(`${classPrefix}-item--selected`, isSelected);
        existing.classList.toggle(`${classPrefix}-item--focused`, isFocused);
        existing.ariaSelected = isSelected ? "true" : "false";

        if (setSizeChanged) {
          existing.setAttribute("aria-setsize", $.la);
        }
      } else {
        const element = renderItem(i, item);
        newlyRenderedForMeasurement.push({ index: i, element });

        // Selection state for new elements
        const isSelected = selectedIds.has(item.id);
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

    // Mode B: observe newly rendered items for auto-measurement immediately.
    // ResizeObserver fires asynchronously; the callback defers content size
    // updates and scroll correction until scroll idle for scrollbar stability.
    if (
      measurementEnabled &&
      measurement.ob &&
      measurement.mc &&
      measurement.ei
    ) {
      for (const { index, element } of newlyRenderedForMeasurement) {
        if (!measurement.mc.isMeasured(index)) {
          measurement.ei.set(element, index);
          measurement.ob.observe(element);
        }
      }
    }

    lastRenderRange.start = renderRange.start;
    lastRenderRange.end = renderRange.end;

    // Sync shared state for features that use it
    sharedState.lastRenderRange.start = renderRange.start;
    sharedState.lastRenderRange.end = renderRange.end;

    // Update viewport state with current scroll position and calculated ranges
    // This is critical for features (especially compression + scrollbar) that rely
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

  /** Shared scroll-idle callback — resets state, flushes measurements, notifies features. */
  const onScrollIdle = (): void => {
    dom.root.classList.remove(`${classPrefix}--scrolling`);
    isScrolling = false;
    $.vt.velocity = 0;
    $.vt.sampleCount = 0;
    emitter.emit("velocity:change", { velocity: 0, reliable: false });
    measurement.fl();
    sortDOMChildren();
    for (let i = 0; i < idleHandlers.length; i++) idleHandlers[i]!();
    emitter.emit("scroll:idle", { scrollPosition: $.ls });
  };

  const scheduleIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onScrollIdle, scrollCfg?.idleTimeout ?? SCROLL_IDLE_TIMEOUT);
  };

  const onScrollFrame = (): void => {
    if ($.id) return;

    const scrollTop = $.sgt();

    // Guard: skip when position hasn't changed. This prevents the native
    // `scroll` event (fired after the wheel handler programmatically sets
    // scrollTop) from doing redundant work — the wheel handler already
    // called onScrollFrame directly with the new position.
    if (scrollTop === $.ls && isScrolling) return;

    const direction: "up" | "down" = scrollTop >= $.ls ? "down" : "up";

    // Update velocity tracker
    $.vt = updateVelocityTracker($.vt as any, scrollTop);

    if (!dom.root.classList.contains(`${classPrefix}--scrolling`)) {
      dom.root.classList.add(`${classPrefix}--scrolling`);
    }
    isScrolling = true;

    $.ls = scrollTop;
    $.rfn();

    emitter.emit("scroll", { scrollPosition: scrollTop, direction });

    // Emit velocity change
    emitter.emit("velocity:change", {
      velocity: $.vt.velocity,
      reliable: $.vt.sampleCount >= MIN_RELIABLE_SAMPLES,
    });

    // Feature post-scroll actions
    for (let i = 0; i < afterScroll.length; i++) {
      afterScroll[i]!(scrollTop, direction);
    }

    scheduleIdle();
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
    // Intercept wheel events for synchronous rendering — prevents blank
    // areas during fast desktop scrolling. We preventDefault, compute the
    // clamped position, set scrollTop, then call onScrollFrame directly so
    // velocity tracking, event emission, afterScroll hooks, and idle
    // scheduling all go through one code path. The guard in onScrollFrame
    // skips the redundant native `scroll` event that fires after we set
    // scrollTop programmatically.
    wheelHandler = (event: WheelEvent): void => {
      // When compression is active (withScale), the scale feature has its
      // own wheel handler that manages virtual scroll position with smooth
      // interpolation. The core handler must not run — it would compute
      // maxScroll from DOM dimensions (much smaller than the virtual space)
      // and reset the scroll position to near-zero.
      if (sharedState.viewportState.isCompressed) return;

      // When the viewport has horizontal overflow (e.g. table with wide
      // columns) and the user is scrolling horizontally (trackpad or
      // shift+wheel), let the browser handle it natively so horizontal
      // scrolling works. Only intercept predominantly-vertical gestures.
      const hasHorizontalOverflow = dom.viewport.scrollWidth > dom.viewport.clientWidth;
      if (hasHorizontalOverflow && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      event.preventDefault();

      // Forward any horizontal delta to the viewport so trackpad diagonal
      // gestures still move the content sideways (table horizontal scroll).
      if (hasHorizontalOverflow && event.deltaX !== 0) {
        dom.viewport.scrollLeft += event.deltaX;
      }

      const currentScroll = $.sgt();
      const maxScroll = dom.viewport.scrollHeight - dom.viewport.clientHeight;
      const newScroll = Math.max(0, Math.min(currentScroll + event.deltaY, maxScroll));

      // Clamped at boundary — nothing moved, skip.
      if (Math.abs(newScroll - currentScroll) < 1) return;

      // Set scroll position then run onScrollFrame synchronously.
      // onScrollFrame reads $.sgt() which returns the new scrollTop,
      // computes direction from the delta vs $.ls, and handles everything:
      // velocity, render, events, afterScroll, idle scheduling.
      $.sst(newScroll);
      onScrollFrame();
    };
    $.wh = wheelHandler;
    dom.viewport.addEventListener("wheel", wheelHandler, { passive: false });
  } else if (isHorizontal && wheelEnabled) {
    // Horizontal mode: convert vertical wheel to horizontal scroll
    wheelHandler = (event: WheelEvent): void => {
      if (event.deltaX) return; // native horizontal scroll handles it
      event.preventDefault();
      dom.viewport.scrollLeft += event.deltaY;
    };
    $.wh = wheelHandler;
    dom.viewport.addEventListener("wheel", wheelHandler, { passive: false });
  }

  // Note: The custom-scrollbar class is added by withScrollbar feature when used
  // Native scrollbars are visible by default

  // ── Click & keydown handlers (delegate to features) ──────────────

  /** Resolve the item under a mouse event, skipping group headers. */
  const findClickTarget = (event: MouseEvent): { item: T; index: number } | null => {
    const itemEl = (event.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
    if (!itemEl) return null;
    const index = parseInt(itemEl.dataset.index ?? "-1", 10);
    if (index < 0) return null;
    const item = ($.dm?.getItem(index) ?? $.it[index]) as T | undefined;
    if (!item || (item as any).__groupHeader) return null;
    return { item, index };
  };

  const handleClick = (event: MouseEvent): void => {
    const hit = findClickTarget(event);
    if (hit) emitter.emit("item:click", { item: hit.item, index: hit.index, event });

    for (let i = 0; i < clickHandlers.length; i++) {
      clickHandlers[i]!(event);
    }
  };

  const handleDblClick = (event: MouseEvent): void => {
    const hit = findClickTarget(event);
    if (hit) emitter.emit("item:dblclick", { item: hit.item, index: hit.index, event });
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    for (let i = 0; i < keydownHandlers.length; i++) {
      keydownHandlers[i]!(event);
    }
  };

  dom.items.addEventListener("click", handleClick);
  dom.items.addEventListener("dblclick", handleDblClick);
  dom.root.addEventListener("keydown", handleKeydown);

  // ── ARIA live region: announce visible range changes (#13b) ─────
  // Debounced to ~300ms so fast scrolling doesn't spam screen readers.
  let liveRegionTimer: ReturnType<typeof setTimeout> | null = null;
  const updateLiveRegion = (data: { range: { start: number; end: number } }): void => {
    if (liveRegionTimer) clearTimeout(liveRegionTimer);
    liveRegionTimer = setTimeout(() => {
      liveRegionTimer = null;
      if ($.id) return;
      const total = $.vtf();
      const { start, end } = data.range;
      dom.liveRegion.textContent = `Showing items ${start + 1} to ${Math.min(end + 1, total)} of ${total}`;
    }, 300);
  };
  emitter.on("range:change", updateLiveRegion);
  destroyHandlers.push(() => {
    if (liveRegionTimer) clearTimeout(liveRegionTimer);
    emitter.off("range:change", updateLiveRegion);
  });

  // ── ResizeObserver ──────────────────────────────────────────────

  const resizeObserver = new ResizeObserver((entries) => {
    if ($.id) return;

    for (const entry of entries) {
      const newHeight = entry.contentRect.height;
      const newWidth = entry.contentRect.width;
      const newMainAxis = isHorizontal ? newWidth : newHeight;
      const prevMainAxis = isHorizontal ? $.cw : $.ch;

      // Always update dimensions (even before initialization)
      $.cw = newWidth;
      $.ch = newHeight;

      if (Math.abs(newMainAxis - prevMainAxis) > 1) {
        sharedState.viewportState.containerSize = newMainAxis;

        // Only render if already initialized (features have run)
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

  // Features can disable viewport resize observation
  if ($.vre) {
    resizeObserver.observe(dom.viewport);
  }

  // ── BuilderContext + proxies (extracted to materialize.ts) ───

  const deps: import("./materialize").MDeps<T> = {
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
    idleHandlers,
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

  // ── Default _updateRenderedItem for list mode ────────────────────
  // Re-applies the template for a single item after data changes.
  // Grid and table features override this with their own renderer's
  // updateItem (which owns the rendered Map in those modes).
  methods.set(
    "_updateRenderedItem",
    (index: number, item: T, isSelected: boolean, isFocused: boolean): void => {
      const element = rendered.get(index);
      if (!element) return;

      const state: import("../types").ItemState = { selected: isSelected, focused: isFocused };
      try {
        const result = $.at(item, index, state);
        applyTemplate(element, result, index);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        emitter.emit("error", {
          error,
          context: `template(index=${index}, id=${item.id})`,
          viewport: snapshotViewport(),
        });
      }
      element.dataset.id = String(item.id);
      element.classList.toggle(`${classPrefix}-item--selected`, isSelected);
      element.classList.toggle(`${classPrefix}-item--focused`, isFocused);
      element.ariaSelected = isSelected ? "true" : "false";
    },
  );

  // ── Run feature setup ────────────────────────────────────────────

  // Check for method collisions
  const allMethodNames = new Map<string, string>();
  for (const feature of sortedFeatures) {
    if (feature.methods) {
      for (const method of feature.methods) {
        const existing = allMethodNames.get(method);
        if (existing) {
          throw new Error(
            `[vlist/builder] Method "${method}" is registered by both "${existing}" and "${feature.name}"`,
          );
        }
        allMethodNames.set(method, feature.name);
      }
    }
  }

  for (const feature of sortedFeatures) {
    try {
      feature.setup(ctx);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (process.env.NODE_ENV !== "production") {
        console.error(`[vlist] Feature "${feature.name}" setup failed:`, error);
      }
      emitter.emit("error", {
        error,
        context: `feature.setup(${feature.name})`,
        viewport: snapshotViewport(),
      });
    }
  }

  // ── Baseline keyboard navigation (when no selection feature) ────
  // Provides Tab-to-focus-first-item and Arrow/Home/End focus movement
  // as required by the WAI-ARIA listbox pattern. When withSelection is
  // present it registers _getFocusedIndex and owns all focus behaviour.

  if (accessibleMode && !methods.has("_getFocusedIndex")) {
    let coreFocus = -1;
    const focusedClass = `${classPrefix}-item--focused`;

    const moveFocus = (prev: number, next: number): void => {
      const total = $.vtf();
      if (next < 0 || next >= total) return;
      coreFocus = next;

      dom.root.setAttribute("aria-activedescendant", `${ariaIdPrefix}-item-${next}`);

      // Scroll into view + re-render
      const size = isHorizontal ? $.cw : $.ch;
      $.sst($.gsp(next, $.hc, size, total, "center"));
      $.ls = $.sgt();
      $.rfn();

      // Swap focused class via rendered map (no DOM query)
      if (prev >= 0 && prev !== next) rendered.get(prev)?.classList.remove(focusedClass);
      rendered.get(next)?.classList.add(focusedClass);
    };

    // Tab into list → activate first (or last-focused) item
    const onFocusIn = (): void => {
      if ($.id) return;
      if (!dom.root.matches(":focus-visible")) return;
      const total = $.vtf();
      if (total === 0) return;
      moveFocus(-1, coreFocus >= 0 ? Math.min(coreFocus, total - 1) : 0);
    };
    dom.root.addEventListener("focusin", onFocusIn);

    // Blur — clear focus ring when focus leaves the list
    const onFocusOut = (e: FocusEvent): void => {
      if ($.id) return;
      const related = e.relatedTarget as Node | null;
      if (related && dom.root.contains(related)) return;

      if (coreFocus >= 0) {
        rendered.get(coreFocus)?.classList.remove(focusedClass);
      }
      dom.root.removeAttribute("aria-activedescendant");
    };
    dom.root.addEventListener("focusout", onFocusOut);

    keydownHandlers.push((event: KeyboardEvent): void => {
      if ($.id) return;
      const total = $.vtf();
      if (total === 0) return;
      const p = coreFocus;
      let n = p;
      switch (event.key) {
        case "ArrowUp":   n = p <= 0 ? total - 1 : p - 1; break;
        case "ArrowDown": n = p >= total - 1 ? 0 : p + 1; break;
        case "Home":      n = 0; break;
        case "End":       n = total - 1; break;
        default: return;
      }
      event.preventDefault();
      moveFocus(p, n);
    });

    destroyHandlers.push(() => {
      dom.root.removeEventListener("focusin", onFocusIn);
      dom.root.removeEventListener("focusout", onFocusOut);
    });
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

  // ── Assemble public API (extracted to api.ts) ───────────────────

  return createApi(
    $,
    dom,
    emitter,
    rendered,
    pool,
    methods,
    sortedFeatures,
    destroyHandlers,
    ctx,
    isReverse,
    wrapEnabled,
    handleClick,
    handleDblClick,
    handleKeydown,
    onScrollFrame,
    resizeObserver,
    () => {
      if (measurement.ob) {
        measurement.ob.disconnect();
      }
    },
    () => {
      if (idleTimer) clearTimeout(idleTimer);
    },
  );
}
