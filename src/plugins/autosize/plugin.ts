/**
 * vlist v2 — Autosize Plugin
 *
 * Enables dynamic item measurement via ResizeObserver for items with
 * unknown sizes. Items are rendered without an explicit main-axis size,
 * measured once by ResizeObserver, then pinned to their measured size.
 *
 * Because a pinned item cannot grow, content that changes size after the
 * measurement (an image that loads or fails, a font swap, lazy content)
 * needs a fresh measurement. `load` and `error` events from descendants
 * trigger one automatically.
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

export function autosize<T extends VListItem = VListItem>(
  config?: AutosizePluginConfig,
): VListPlugin<T> {
  let gap = config?.gap ?? 0;

  let observer: ResizeObserver | null = null;
  let storedCtx: PluginContext<T> | null = null;
  let engineState: EngineState;
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
   * Queue a fresh measurement: the item is re-observed on the next commit and
   * its new size replaces the old one, correcting the scroll position by the
   * real delta.
   */
  function remeasure(index: number): void {
    if (!storedCtx || engineState.destroyed) return;
    if (!measuredSizes.has(index)) return;
    pendingRemeasure.add(index);
    storedCtx.forceRender();
  }

  // Maximum logical scroll position, derived from the size cache rather than
  // native scroll geometry. Under bounded mode (RFC-012) `viewport.scrollHeight`
  // reflects the runway, not the full virtual size, so reading it would treat
  // the runway edge as the list end. This matches the end-aligned scroll target
  // computed in `setScrollToIndexFn` below, and is mode-independent.
  function maxScrollPos(): number {
    return Math.max(
      0,
      storedCtx!.sizeCache.getTotalSize() + storedCtx!.config.mainAxisPadding - engineState.containerSize,
    );
  }

  function isAtEnd(): boolean {
    const maxScroll = maxScrollPos();
    return maxScroll > 0 && engineState.scrollPosition >= maxScroll - END_THRESHOLD;
  }

  function snapToEnd(): void {
    const maxScroll = maxScrollPos();
    if (maxScroll > engineState.scrollPosition) {
      storedCtx!.scrollTo(maxScroll);
    }
  }

  function updateContentSize(): void {
    storedCtx!.updateContentSize(storedCtx!.sizeCache.getTotalSize());
  }

  return {
    name: "autosize",
    priority: 5,

    setup(ctx: PluginContext<T>): void {
      storedCtx = ctx;
      engineState = ctx.getState();
      isX = ctx.config.axis.primary === "x";
      sizeProp = isX ? "width" : "height";
      if (gap === 0) gap = ctx.config.gap;

      // Read estimated size from the current sizeCache before replacing it.
      // The initial cache already has gap baked in — read the raw spec size.
      estimatedSize = typeof ctx.rawSizeSpec === "function"
        ? (ctx.rawSizeSpec as (i: number) => number)(0) + gap
        : (ctx.rawSizeSpec as number) + gap;

      // Replace the fixed sizeCache with a variable one backed by measurements
      ctx.setSizeConfig(sizeFn);
      if (gap > 0) {
        const orig = ctx.sizeCache.getTotalSize;
        ctx.sizeCache.getTotalSize = (): number => {
          const t = orig();
          return t > 0 ? t - gap : 0;
        };
      }

      // ResizeObserver for measuring items
      observer = new ResizeObserver((entries) => {
        if (engineState.destroyed || !storedCtx) return;

        let hasNewMeasurements = false;
        const firstVisible = ctx.sizeCache.indexAtOffset(engineState.scrollPosition);

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

          const boxSize = entry.borderBoxSize[0];
          if (!boxSize) continue;
          const newSize = isX ? boxSize.inlineSize : boxSize.blockSize;
          if (newSize <= 0) continue;

          const sizeWithGap = newSize + gap;
          // A remeasured item corrects by the delta from its previous
          // measurement, not from the estimate.
          const wasMeasured = measuredSizes.has(index);
          const oldSize = measuredSizes.get(index) ?? estimatedSize;

          measuredSizes.set(index, sizeWithGap);
          pendingRemeasure.delete(index);
          if (!wasMeasured || sizeWithGap !== oldSize) hasNewMeasurements = true;

          if (index < firstVisible && sizeWithGap !== oldSize) {
            pendingScrollDelta += sizeWithGap - oldSize;
          }

          observer!.unobserve(el);

          // Pin the element to its measured size
          el.style[sizeProp] = `${newSize}px`;
        }

        if (!hasNewMeasurements) return;

        const atEnd = isAtEnd();

        // Rebuild prefix sums with new measurements
        ctx.rebuildSizeCache();

        // Apply scroll correction for items above viewport
        if (pendingScrollDelta) {
          ctx.shiftScroll(pendingScrollDelta);
          pendingScrollDelta = 0;
        }

        const isScrolling = engineState.scrollDirection !== 0;
        const nearEnd = engineState.totalItems > 0
          && engineState.prevRangeEnd >= engineState.totalItems - 1;
        const shouldPin = pinnedToEnd && !animatingToEnd;

        if (shouldPin || atEnd || nearEnd || !isScrolling) {
          updateContentSize();
          pendingContentSizeUpdate = false;

          if (shouldPin || atEnd) {
            snapToEnd();
          }
        } else {
          pendingContentSizeUpdate = true;
        }

        ctx.forceRender();
      });

      // End-pinning with dynamic scroll target: when scrollToIndex targets
      // the last item with "end" alignment, use a dynamic target function so
      // the smooth scroll tracks the real maxScroll as measurements change it.
      // After the animation, pinnedToEnd keeps snapping on subsequent
      // measurements until the user scrolls away.
      ctx.setScrollToIndexFn((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number): void | false => {
        const isEndAligned = index >= engineState.totalItems - 1 && align === "end";
        pinnedToEnd = isEndAligned;
        animatingToEnd = false;

        if (!isEndAligned) return false;

        const mp = ctx.config.mainAxisPadding;
        const dynamicTarget = (): number => {
          const totalSize = ctx.sizeCache.getTotalSize();
          return Math.max(0, totalSize + mp - engineState.containerSize);
        };

        if (behavior === "smooth") {
          animatingToEnd = true;
          ctx.smoothScrollTo(dynamicTarget, duration ?? 300, easing, () => {
            animatingToEnd = false;
          });
        } else {
          ctx.scrollTo(dynamicTarget());
        }
      });

      const unpinOnUserScroll = (): void => { pinnedToEnd = false; };
      const viewport = ctx.dom.viewport;
      viewport.addEventListener("wheel", unpinOnUserScroll, { passive: true });
      viewport.addEventListener("touchstart", unpinOnUserScroll, { passive: true });

      ctx.registerDestroyHandler((): void => {
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

      ctx.registerDestroyHandler((): void => {
        content.removeEventListener("load", onMediaEvent, true);
        content.removeEventListener("error", onMediaEvent, true);
      });

      // Public methods
      ctx.registerMethod("isMeasured", isMeasured);

      ctx.registerMethod("setMeasuredSize", (index: number, size: number): void => {
        measuredSizes.set(index, size);
      });

      ctx.registerMethod("getMeasuredCount", (): number => measuredSizes.size);

      // Cleanup
      ctx.registerDestroyHandler((): void => {
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

          const el = storedCtx.getRenderedElement(idx);
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
          storedCtx.forceRender();
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
