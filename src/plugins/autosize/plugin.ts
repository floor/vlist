/**
 * vlist — Autosize Plugin
 *
 * Enables dynamic item measurement via ResizeObserver for items with
 * unknown sizes. Items are rendered without an explicit main-axis size,
 * measured once by ResizeObserver, then pinned to their measured size.
 *
 * Because a pinned item cannot grow, content that changes size after the
 * measurement (an image that loads or fails, a font swap, lazy content)
 * needs a fresh measurement. `load` and `error` events from descendants
 * trigger one automatically; `list.remeasure(index?)` does it on demand.
 *
 * Priority 5 — runs before grid/masonry (10) so the measured cache
 * is in place before layout plugins consume it.
 *
 * Requires: `item.estimatedHeight` or `item.estimatedWidth` in config
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";

// =============================================================================
// Config
// =============================================================================

export interface AutosizePluginConfig {
  gap?: number;
}

// =============================================================================
// Factory
// =============================================================================

/** Methods the autosize plugin adds to the list instance. */
export interface AutosizeMethods {
  /** Whether the item at `index` has been measured. */
  isMeasured(index: number): boolean;
  /** Drop the measurement for `index`, or for every item when omitted. */
  remeasure(index?: number): void;
  /** Record a measured size for `index`. */
  setMeasuredSize(index: number, size: number): void;
  /** How many items have been measured. */
  getMeasuredCount(): number;
}

export function autosize<T extends VListItem = VListItem>(
  config?: AutosizePluginConfig,
): VListPlugin<T, AutosizeMethods> {
  let gap = config?.gap ?? 0;

  let observer: ResizeObserver | null = null;
  let storedCtx: PluginContext<T> | null = null;
  let engineState: EngineState;
  let scroll: PluginContext<T>["scroll"];
  let isX: boolean;
  let sizeProp: "width" | "height";
  let estimatedSize: number;

  const measuredSizes = new Map<number, number>();
  // Measured items queued for a fresh measurement on the next commit.
  const pendingRemeasure = new Set<number>();
  const elementToIndex = new WeakMap<Element, number>();

  let pendingScrollDelta = 0;
  let pendingContentSizeUpdate = false;
  let pinnedToEnd = false;
  let animatingToEnd = false;

  const END_THRESHOLD = 2;

  function sizeFn(index: number): number {
    return measuredSizes.get(index) ?? estimatedSize;
  }

  function isMeasured(index: number): boolean {
    return measuredSizes.has(index) && !pendingRemeasure.has(index);
  }

  /**
   * Queue a fresh measurement. With an index, the item is re-observed on the
   * next commit and its new size replaces the old one, correcting the scroll
   * position by the real delta. Without an index, every measurement is
   * dropped and items are measured again as they render.
   *
   * @param index Zero-based item index; omit to invalidate all cached sizes.
   * Unknown or unmeasured indices are ignored. A single-item request keeps the
   * previous size for scroll correction until ResizeObserver supplies the new
   * measurement; a full reset immediately falls back to estimates, including
   * for offscreen items. Manual requests share the automatic load/error queue.
   */
  function remeasure(index?: number): void {
    if (!storedCtx || engineState.destroyed) return;
    if (index === undefined) {
      if (measuredSizes.size === 0) return;
      measuredSizes.clear();
      pendingRemeasure.clear();
      storedCtx.sizes.rebuild();
      updateContentSize();
    } else {
      if (!measuredSizes.has(index)) return;
      pendingRemeasure.add(index);
    }
    storedCtx.render.force();
  }

  // Maximum logical scroll position, derived from the size cache rather than
  // native scroll geometry. Under bounded mode (RFC-012) `viewport.scrollHeight`
  // reflects the runway, not the full virtual size, so reading it would treat
  // the runway edge as the list end. This matches the end-aligned scroll target
  // computed in `setScrollToIndexFn` below, and is mode-independent.
  function maxScrollPos(): number {
    return Math.max(
      0,
      storedCtx!.sizes.cache.getTotalSize() + storedCtx!.config.mainAxisPadding - engineState.containerSize,
    );
  }

  function isAtEnd(): boolean {
    const maxScroll = maxScrollPos();
    return maxScroll > 0 && scroll.getPixelEquivalent() >= maxScroll - END_THRESHOLD;
  }

  function snapToEnd(): void {
    const maxScroll = maxScrollPos();
    if (maxScroll > scroll.getPixelEquivalent()) {
      storedCtx!.scroll.to(maxScroll);
    }
  }

  function updateContentSize(): void {
    storedCtx!.render.contentSize(storedCtx!.sizes.cache.getTotalSize());
  }

  /**
   * Refresh the prefix sums over `low..high`, the indices a batch changed.
   *
   * A layout plugin (groups, grid) can replace the size cache with one keyed
   * by its own layout indices, where a data index names the wrong rows. Such a
   * plugin hooks `rebuild` to do the mapping, so that hook's presence is the
   * signal to fall back to the full rebuild — the only call that still lands
   * on the right entries.
   */
  function refreshSizes(low: number, high: number): void {
    const ctx = storedCtx!;
    if (ctx.hooks.get("_setSizeCacheBase")) ctx.sizes.rebuild();
    else ctx.sizes.cache.invalidate(low, high);
  }

  return {
    name: "autosize",
    priority: 5,

    setup(ctx: PluginContext<T>): void {
      scroll = ctx.scroll;
      storedCtx = ctx;
      engineState = ctx.getState();
      isX = ctx.config.axis.primary === "x";
      sizeProp = isX ? "width" : "height";
      if (gap === 0) gap = ctx.config.gap;

      // Read estimated size from the current sizeCache before replacing it.
      // The initial cache already has gap baked in — read the raw spec size.
      estimatedSize = typeof ctx.sizes.rawSpec === "function"
        ? (ctx.sizes.rawSpec as (i: number) => number)(0) + gap
        : (ctx.sizes.rawSpec as number) + gap;

      // Replace the fixed sizeCache with a variable one backed by measurements
      ctx.sizes.setConfig(sizeFn, gap);

      // ResizeObserver for measuring items
      observer = new ResizeObserver((entries) => {
        if (engineState.destroyed || !storedCtx) return;

        let hasNewMeasurements = false;
        // Lowest and highest index the batch changed. The size cache only
        // re-reads the blocks this range covers, so a handful of measured
        // rows no longer costs one Map lookup per item in the list.
        let changedLow = -1;
        let changedHigh = -1;
        const firstVisible = ctx.sizes.cache.indexAtOffset(scroll.getPixelEquivalent());

        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const index = elementToIndex.get(el);
          if (index === undefined) continue;

          // Verify element wasn't recycled to a different item
          if (el.getAttribute("data-index") !== String(index)) {
            observer!.unobserve(el);
            continue;
          }

          if (isMeasured(index)) continue;

          // borderBoxSize is missing on polyfills and on older WebKit, which
          // shipped ResizeObserver with contentRect only. contentRect is the
          // content box, so it undershoots a row that has padding or a border.
          const boxSize = entry.borderBoxSize?.[0];
          let newSize: number;
          if (boxSize) {
            newSize = isX ? boxSize.inlineSize : boxSize.blockSize;
          } else {
            const rect = el.getBoundingClientRect();
            newSize = isX ? rect.width : rect.height;
          }
          if (newSize <= 0) continue;

          const sizeWithGap = newSize + gap;
          // A remeasured item corrects by the delta from its previous
          // measurement, not from the estimate.
          const wasMeasured = measuredSizes.has(index);
          const oldSize = measuredSizes.get(index) ?? estimatedSize;

          measuredSizes.set(index, sizeWithGap);
          pendingRemeasure.delete(index);
          if (!wasMeasured || sizeWithGap !== oldSize) {
            hasNewMeasurements = true;
            if (changedLow < 0 || index < changedLow) changedLow = index;
            if (index > changedHigh) changedHigh = index;
          }

          if (index < firstVisible && sizeWithGap !== oldSize) {
            pendingScrollDelta += sizeWithGap - oldSize;
          }

          observer!.unobserve(el);

          // Pin the element to its measured size
          el.style[sizeProp] = `${newSize}px`;
        }

        if (!hasNewMeasurements) return;

        const atEnd = isAtEnd();

        // Refresh the prefix sums over the measured range only
        refreshSizes(changedLow, changedHigh);

        // Apply scroll correction for items above viewport
        if (pendingScrollDelta) {
          ctx.scroll.shiftBy(pendingScrollDelta);
          pendingScrollDelta = 0;
        }

        const isScrolling = engineState.scrollDirection !== 0;
        const nearEnd = engineState.totalItems > 0
          && engineState.prevRangeEnd >= engineState.totalItems - 1;
        const shouldPin = pinnedToEnd && !animatingToEnd;

        // A smooth jump to the end re-reads its target every frame, but the
        // browser clamps that write to the content element's current height.
        // Deferring the height until idle leaves the jump short of the items
        // measured along the way, which is the blank viewport on the second
        // jump. Publish the height while the jump is in flight; still don't
        // snap until the animation has finished, or the two fight.
        if (shouldPin || atEnd || nearEnd || animatingToEnd || !isScrolling) {
          updateContentSize();
          pendingContentSizeUpdate = false;

          if (shouldPin || atEnd) {
            snapToEnd();
          }
        } else {
          pendingContentSizeUpdate = true;
        }

        ctx.render.force();
      });

      // End-pinning with dynamic scroll target: when scrollToIndex targets
      // the last item with "end" alignment, use a dynamic target function so
      // the smooth scroll tracks the real maxScroll as measurements change it.
      // After the animation, pinnedToEnd keeps snapping on subsequent
      // measurements until the user scrolls away.
      ctx.scroll.setToIndexFn((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number): void | false => {
        const isEndAligned = index >= engineState.totalItems - 1 && align === "end";
        pinnedToEnd = isEndAligned;
        animatingToEnd = false;

        if (!isEndAligned) return false;

        const mp = ctx.config.mainAxisPadding;
        const dynamicTarget = (): number => {
          const totalSize = ctx.sizes.cache.getTotalSize();
          return Math.max(0, totalSize + mp - engineState.containerSize);
        };

        if (behavior === "smooth") {
          animatingToEnd = true;
          ctx.scroll.smoothTo(dynamicTarget, duration ?? 300, easing, () => {
            animatingToEnd = false;
            // Measurements taken on the last frames defer their height write
            // until this moment. Publish it, then land on the end it describes.
            if (pendingContentSizeUpdate) {
              updateContentSize();
              pendingContentSizeUpdate = false;
            }
            snapToEnd();
          });
        } else {
          ctx.scroll.to(dynamicTarget());
        }
      });

      const unpinOnUserScroll = (): void => { pinnedToEnd = false; };
      const viewport = ctx.dom.viewport;
      viewport.addEventListener("wheel", unpinOnUserScroll, { passive: true });
      viewport.addEventListener("touchstart", unpinOnUserScroll, { passive: true });

      ctx.hooks.onDestroy((): void => {
        viewport.removeEventListener("wheel", unpinOnUserScroll);
        viewport.removeEventListener("touchstart", unpinOnUserScroll);
      });

      // Late-sizing content: `load`/`error` from images, iframes and the like
      // do not bubble, but a capture listener on the content element sees
      // them. One listener pair per list, not per item. Unmeasured items are
      // still observed and need nothing here.
      const content = ctx.dom.content;
      const onMediaEvent = (event: Event): void => {
        const target = event.target as Element | null;
        if (!target || target === content) return;
        const item = target.closest("[data-index]");
        if (!item || item.parentNode !== content) return;
        const index = Number(item.getAttribute("data-index"));
        if (isMeasured(index)) remeasure(index);
      };
      content.addEventListener("load", onMediaEvent, true);
      content.addEventListener("error", onMediaEvent, true);

      ctx.hooks.onDestroy((): void => {
        content.removeEventListener("load", onMediaEvent, true);
        content.removeEventListener("error", onMediaEvent, true);
      });

      // Public methods
      ctx.hooks.method("isMeasured", isMeasured);
      ctx.hooks.method("remeasure", remeasure);

      ctx.hooks.method("setMeasuredSize", (index: number, size: number): void => {
        measuredSizes.set(index, size);
        refreshSizes(index, index);
      });

      ctx.hooks.method("getMeasuredCount", (): number => measuredSizes.size);

      // Cleanup
      ctx.hooks.onDestroy((): void => {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      });
    },

    hooks: {
      onCommit(state: EngineState): void {
        if (!observer || !storedCtx) return;

        for (let i = 0; i < state.visibleCount; i++) {
          const idx = state.visibleIndices[i]!;
          if (isMeasured(idx)) continue;

          const el = storedCtx.dom.renderedElement(idx);
          if (!el) continue;

          // Clear the explicit size set by phase2Commit so
          // ResizeObserver can measure the natural content size.
          el.style[sizeProp] = "";
          elementToIndex.set(el, idx);
          observer.observe(el);
        }
      },

      onIdle(): void {
        if (!storedCtx || !pendingContentSizeUpdate) return;

        const atEnd = isAtEnd();
        updateContentSize();
        pendingContentSizeUpdate = false;

        if (atEnd) {
          snapToEnd();
          storedCtx.render.force();
        }
      },
    },

    destroy(): void {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      measuredSizes.clear();
      pendingRemeasure.clear();
      pinnedToEnd = false;
      animatingToEnd = false;
      storedCtx = null;
    },
  };
}
