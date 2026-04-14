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
import { resolvePadding, mainAxisPaddingFrom } from "../../utils/padding";

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

      // Resolve main-axis padding so we can compute maxScroll accurately
      const resolvedPad = resolvePadding(ctx.rawConfig.padding);
      const mainAxisPadding = mainAxisPaddingFrom(resolvedPad, hz);

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

      // Bottom-snapping threshold (px). If scrollTop is within this distance
      // of the current maxScroll we consider the viewport "at the bottom".
      const BOTTOM_THRESHOLD = 2;

      /**
       * Check whether the viewport is currently scrolled to the bottom.
       * Uses the OLD totalSize (before a rebuild) so the check reflects
       * the state the user sees right now, not the post-measurement state.
       */
      const isAtBottom = (oldTotalSize: number): boolean => {
        const scrollTop = ctx.scrollController.getScrollTop();
        const containerSize = ctx.state.viewportState.containerSize;
        if (containerSize <= 0) return false;
        const maxScroll = Math.max(0, oldTotalSize + mainAxisPadding - containerSize);
        return scrollTop >= maxScroll - BOTTOM_THRESHOLD;
      };

      /**
       * Snap the scroll position to the true bottom (new maxScroll).
       * Called after content size has been updated so the browser allows
       * scrolling to the new extent.
       */
      const snapToBottom = (): void => {
        const newTotalSize = measuredCache.getTotalSize();
        const containerSize = ctx.state.viewportState.containerSize;
        if (containerSize <= 0) return;
        const newMaxScroll = Math.max(0, newTotalSize + mainAxisPadding - containerSize);
        const scrollTop = ctx.scrollController.getScrollTop();
        if (newMaxScroll > scrollTop) {
          ctx.scrollController.scrollTo(newMaxScroll);
        }
      };

      // Content size updater
      const updateContentSize = (): void => {
        const totalSize = measuredCache.getTotalSize();
        ctx.updateContentSize(totalSize);
      };

      // Flush deferred content size updates (called on scroll idle)
      const flush = (): void => {
        if (pendingContentSizeUpdate) {
          // Determine if the viewport was "at the bottom" before applying
          // the deferred content-size update.
          //
          // Primary check: scrollTop is at/near the DOM maxScroll (which
          // still reflects the OLD content height).
          //
          // Secondary check: during a smooth scroll animation toward the
          // bottom, early RO batches may update content size immediately
          // (isScrolling was still false), growing the DOM maxScroll AFTER
          // the animation target was computed.  The animation ends at the
          // stale target, landing short of the new DOM maxScroll.  To
          // catch this, we also check if the render range includes the
          // last item AND scrollTop is within the size-drift distance of
          // DOM maxScroll.  Size drift = |newCacheTotal − oldDOMTotal|.
          const viewport = ctx.dom.viewport as HTMLElement;
          const oldScrollHeight = viewport.scrollHeight;
          const currentMaxScroll = oldScrollHeight - viewport.clientHeight;
          const scrollTop = ctx.scrollController.getScrollTop();

          const atDomBottom = currentMaxScroll > 0 && scrollTop >= currentMaxScroll - BOTTOM_THRESHOLD;

          const totalItems = ctx.getVirtualTotal();
          const renderEnd = ctx.state.viewportState.renderRange.end;
          const nearEnd = totalItems > 0 && renderEnd >= totalItems - 1;
          const newContentHeight = measuredCache.getTotalSize() + mainAxisPadding;
          const sizeDrift = Math.abs(newContentHeight - oldScrollHeight);
          const atBottomWithDrift = nearEnd && currentMaxScroll > 0 &&
            scrollTop >= currentMaxScroll - sizeDrift - BOTTOM_THRESHOLD;

          const atBottom = atDomBottom || atBottomWithDrift;

          updateContentSize();
          pendingContentSizeUpdate = false;

          // If the user was at the bottom, keep them there after the
          // content height grows due to deferred measurement updates.
          if (atBottom) {
            // Force synchronous layout so the browser's scrollHeight reflects
            // the new content height. Without this, setting viewport.scrollTop
            // would be clamped to the OLD maxScroll.
            void viewport.scrollHeight;
            snapToBottom();
            ctx.forceRender();
          }
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

        // Capture old total BEFORE rebuild so the at-bottom check reflects
        // the size the user currently sees (estimated sizes for unmeasured items).
        const oldTotalSize = measuredCache.getTotalSize();

        // Rebuild prefix sums
        measuredCache.rebuild(ctx.getVirtualTotal());

        // Apply scroll correction immediately
        if (pendingScrollDelta !== 0) {
          const current = ctx.scrollController.getScrollTop();
          ctx.scrollController.scrollTo(current + pendingScrollDelta);
          pendingScrollDelta = 0;
        }

        // Check if viewport is at the bottom (using old total, before rebuild
        // changed the size). When at the bottom we must update content size
        // immediately — deferring would leave the scrollable area too short,
        // preventing the user from reaching the true end.
        const atBottom = isAtBottom(oldTotalSize);

        // Also skip deferral when the render range includes the last item.
        // During a smooth scroll toward the bottom the browser clamps
        // scrollTop to the current DOM maxScroll.  If content size is
        // deferred the animation can never reach the true bottom, causing
        // a visible snap when the flush finally applies the update.
        const totalItems = ctx.getVirtualTotal();
        const renderEnd = ctx.state.viewportState.renderRange.end;
        const nearEnd = totalItems > 0 && renderEnd >= totalItems - 1;

        // Capture DOM maxScroll BEFORE updating content size so we can
        // detect if the scroll position was clamped at the old bottom.
        const viewport = ctx.dom.viewport as HTMLElement;
        const preUpdateMaxScroll = viewport.scrollHeight - viewport.clientHeight;
        const currentScroll = ctx.scrollController.getScrollTop();
        const atDomBottom = preUpdateMaxScroll > 0 && currentScroll >= preUpdateMaxScroll - BOTTOM_THRESHOLD;

        if (atBottom || nearEnd || !ctx.scrollController.isScrolling()) {
          // Update content size immediately
          updateContentSize();
          pendingContentSizeUpdate = false;

          // Keep scroll pinned to the bottom when measurements grow the content.
          // Snap when:
          //  - atBottom: we were at the calculated bottom from prefix sums
          //  - nearEnd + atDomBottom: the last item is rendered and the scroll
          //    position was clamped at the DOM maxScroll (smooth scroll animation
          //    tried to go further but the browser wouldn't allow it)
          if (atBottom || (nearEnd && atDomBottom)) {
            // Force synchronous layout so the browser's scrollHeight reflects
            // the new content height. Without this, setting viewport.scrollTop
            // would be clamped to the OLD maxScroll.
            void viewport.scrollHeight;
            snapToBottom();
          }
        } else {
          // Defer content size updates during scrolling for scrollbar stability
          pendingContentSizeUpdate = true;
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