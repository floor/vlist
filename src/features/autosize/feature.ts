/**
 * vlist/autosize — Auto-Size Measurement Feature
 *
 * Enables dynamic item measurement via ResizeObserver for items with
 * unknown sizes (Mode B). Items are rendered with no explicit main-axis
 * size, measured once by a ResizeObserver, and then pinned to their
 * measured size for all subsequent renders.
 *
 * Priority: 5 (runs before grid/masonry at 10 so the measured cache
 * is in place before layout features wrap it)
 *
 * Requires: `item.estimatedHeight` or `item.estimatedWidth` in config
 *
 * @example
 * ```ts
 * import { vlist, withAutoSize } from '@floor/vlist';
 *
 * vlist({
 *   container: '#app',
 *   item: { estimatedHeight: 60, template: (item) => `<div>${item.name}</div>` },
 *   items: data,
 * })
 *   .use(withAutoSize())
 *   .build();
 * ```
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";
import type { SizeCache } from "../../rendering/sizes";
import { createMeasuredSizeCache } from "../../rendering/measured";

/**
 * Create an auto-size measurement feature for items with unknown sizes.
 * Reads `estimatedHeight`/`estimatedWidth` from the builder config.
 */
export const withAutoSize = <T extends VListItem = VListItem>(): VListFeature<T> => {
  let observer: ResizeObserver | null = null;

  return {
    name: "withAutoSize",
    priority: 5,

    setup(ctx: BuilderContext<T>): void {
      const hz = ctx.config.horizontal;
      const rawItem = ctx.rawConfig.item;
      const ri = rawItem as unknown as Record<string, unknown>;
      const estimatedSize = (hz ? ri.estimatedWidth : ri.estimatedHeight) as number | undefined;

      if (estimatedSize == null || estimatedSize <= 0) {
        throw new Error(
          "[vlist/withAutoSize] Requires item.estimatedHeight (or item.estimatedWidth for horizontal)",
        );
      }

      const gap = (ri.gap as number) ?? 0;
      const total = ctx.getVirtualTotal();

      // Create measured size cache (wraps variable SizeCache with measurement tracking)
      const measuredCache = createMeasuredSizeCache(estimatedSize + gap, total);

      // Inject into builder via internal methods
      const setSizeCache = ctx.methods.get("_setSizeCache") as ((cache: SizeCache) => void);
      const setConstrainSize = ctx.methods.get("_setConstrainSize") as ((fn: ((index: number) => boolean) | null) => void);

      if (!setSizeCache || !setConstrainSize) {
        throw new Error("[vlist/withAutoSize] Incompatible builder version");
      }

      setSizeCache(measuredCache);
      setConstrainSize((index: number): boolean => measuredCache.isMeasured(index));

      // Measurement state
      const elementToIndex = new WeakMap<Element, number>();
      let pendingScrollDelta = 0;
      let pendingContentSizeUpdate = false;

      // Content size updater
      const updateContentSize = (): void => {
        const totalSize = measuredCache.getTotalSize();
        ctx.updateContentSize(totalSize);
      };

      // Flush deferred content size updates (called on scroll idle)
      const flush = (): void => {
        if (pendingContentSizeUpdate) {
          updateContentSize();
          pendingContentSizeUpdate = false;
        }
      };

      // ResizeObserver for measuring items
      observer = new ResizeObserver((entries) => {
        if (ctx.state.isDestroyed) return;

        let hasNewMeasurements = false;
        const firstVisible = ctx.state.viewportState.visibleRange.start;

        for (const entry of entries) {
          const index = elementToIndex.get(entry.target);
          if (index === undefined) continue;

          const newSize = hz
            ? entry.borderBoxSize[0]!.inlineSize
            : entry.borderBoxSize[0]!.blockSize;

          if (!measuredCache.isMeasured(index)) {
            const sizeWithGap = newSize + gap;
            const oldSize = measuredCache.getSize(index);
            measuredCache.setMeasuredSize(index, sizeWithGap);
            hasNewMeasurements = true;

            if (index < firstVisible && sizeWithGap !== oldSize) {
              pendingScrollDelta += sizeWithGap - oldSize;
            }

            observer!.unobserve(entry.target as Element);

            const el = entry.target as HTMLElement;
            if (hz) {
              el.style.width = `${newSize}px`;
            } else {
              el.style.height = `${newSize}px`;
            }
          }
        }

        if (!hasNewMeasurements) return;

        // Rebuild prefix sums
        measuredCache.rebuild(ctx.getVirtualTotal());
        setSizeCache(measuredCache);

        // Apply scroll correction immediately
        if (pendingScrollDelta !== 0) {
          const current = ctx.scrollController.getScrollTop();
          ctx.scrollController.scrollTo(current + pendingScrollDelta);
          pendingScrollDelta = 0;
        }

        // Defer content size updates during scrolling for scrollbar stability
        if (ctx.scrollController.isScrolling()) {
          pendingContentSizeUpdate = true;
        } else {
          updateContentSize();
          pendingContentSizeUpdate = false;
        }

        // Reposition items with corrected prefix sums
        ctx.forceRender();
      });

      // Observe newly rendered items
      ctx.afterRenderBatch.push(
        (items: ReadonlyArray<{ index: number; element: HTMLElement }>): void => {
          for (const { index, element } of items) {
            if (!measuredCache.isMeasured(index)) {
              elementToIndex.set(element, index);
              observer!.observe(element);
            }
          }
        },
      );

      // Flush deferred measurements on scroll idle
      ctx.idleHandlers.push(flush);

      // Cleanup
      ctx.destroyHandlers.push((): void => {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      });
    },

    destroy(): void {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
};
