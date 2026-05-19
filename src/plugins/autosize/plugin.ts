/**
 * vlist v2 — Autosize Plugin
 *
 * Enables dynamic item measurement via ResizeObserver for items with
 * unknown sizes. Items are rendered without an explicit main-axis size,
 * measured once by ResizeObserver, then pinned to their measured size.
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
  const gap = config?.gap ?? 0;

  let observer: ResizeObserver | null = null;
  let storedCtx: PluginContext<T> | null = null;
  let engineState: EngineState;
  let hz: boolean;
  let sizeProp: "width" | "height";
  let estimatedSize: number;

  const measuredSizes = new Map<number, number>();
  const elementToIndex = new WeakMap<Element, number>();

  let pendingScrollDelta = 0;
  let pendingContentSizeUpdate = false;

  const BOTTOM_THRESHOLD = 2;

  function sizeFn(index: number): number {
    return measuredSizes.get(index) ?? estimatedSize;
  }

  function isAtBottom(): boolean {
    const viewport = storedCtx!.dom.viewport;
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    return maxScroll > 0 && engineState.scrollPosition >= maxScroll - BOTTOM_THRESHOLD;
  }

  function snapToBottom(): void {
    const viewport = storedCtx!.dom.viewport;
    void viewport.scrollHeight;
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
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
      hz = ctx.config.horizontal;
      sizeProp = hz ? "width" : "height";

      // Read estimated size from the current sizeCache before replacing it
      estimatedSize = ctx.sizeCache.getSize(0);
      if (gap > 0) estimatedSize += gap;

      // Replace the fixed sizeCache with a variable one backed by measurements
      ctx.setSizeConfig(sizeFn);

      // ResizeObserver for measuring items
      observer = new ResizeObserver((entries) => {
        if (engineState.destroyed || !storedCtx) return;

        let hasNewMeasurements = false;
        const firstVisible = engineState.startIndex;

        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const index = elementToIndex.get(el);
          if (index === undefined) continue;

          // Verify element wasn't recycled to a different item
          if (el.getAttribute("data-index") !== String(index)) {
            observer!.unobserve(el);
            continue;
          }

          if (measuredSizes.has(index)) continue;

          const boxSize = entry.borderBoxSize[0];
          if (!boxSize) continue;
          const newSize = hz ? boxSize.inlineSize : boxSize.blockSize;
          if (newSize <= 0) continue;

          const sizeWithGap = newSize + gap;
          const oldSize = estimatedSize;

          measuredSizes.set(index, sizeWithGap);
          hasNewMeasurements = true;

          if (index < firstVisible && sizeWithGap !== oldSize) {
            pendingScrollDelta += sizeWithGap - oldSize;
          }

          observer!.unobserve(el);

          // Pin the element to its measured size
          el.style[sizeProp] = `${newSize}px`;
        }

        if (!hasNewMeasurements) return;

        const atBottom = isAtBottom();

        // Rebuild prefix sums with new measurements
        ctx.rebuildSizeCache();

        // Apply scroll correction for items above viewport
        if (pendingScrollDelta) {
          ctx.scrollTo(engineState.scrollPosition + pendingScrollDelta);
          pendingScrollDelta = 0;
        }

        const isScrolling = engineState.scrollDirection !== 0;
        const nearEnd = engineState.totalItems > 0
          && engineState.prevRangeEnd >= engineState.totalItems - 1;

        if (atBottom || nearEnd || !isScrolling) {
          updateContentSize();
          pendingContentSizeUpdate = false;

          if (atBottom) {
            snapToBottom();
          }
        } else {
          pendingContentSizeUpdate = true;
        }

        ctx.forceRender();
      });

      // Public methods
      ctx.registerMethod("isMeasured", (index: number): boolean => measuredSizes.has(index));

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
          if (measuredSizes.has(idx)) continue;

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
        if (!pendingContentSizeUpdate || !storedCtx) return;

        const atBottom = isAtBottom();
        updateContentSize();
        pendingContentSizeUpdate = false;

        if (atBottom) {
          snapToBottom();
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
      storedCtx = null;
    },
  };
}
