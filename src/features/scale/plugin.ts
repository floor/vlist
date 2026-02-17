/**
 * vlist/compression - Builder Plugin
 * Enables support for lists with 1M+ items by compressing the scroll space
 * when the total height exceeds the browser's ~16.7M pixel limit.
 *
 * Priority: 20 (runs before scrollbar, after grid/groups)
 *
 * What it wires:
 * - Scroll mode switch — transitions from native to compressed scrolling when needed
 * - Scroll position mapping — maps compressed scroll positions to item indices
 * - Item positioning — positions items relative to viewport in compressed mode
 * - Custom scrollbar fallback — forces custom scrollbar in compressed mode
 * - Near-bottom interpolation — smooth blending near the end of the list
 * - Cached compression state — recalculates only when total item count changes
 *
 * No configuration needed — compression activates automatically when the total
 * height exceeds the browser limit, and deactivates when items are removed.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, BuilderContext } from "../../builder/types";

import {
  getCompressionState,
  calculateCompressedVisibleRange,
  calculateCompressedScrollToIndex,
  calculateCompressedItemPosition,
} from "../../rendering/scale";
import type { Range } from "../../types";
import { createScrollbar, type Scrollbar } from "../scrollbar";

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create a compression plugin for the builder.
 *
 * Enables support for lists with 1M+ items. No configuration needed —
 * compression activates automatically when the total height exceeds
 * the browser's ~16.7M pixel limit.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withCompression } from 'vlist/compression'
 *
 * const list = vlist({
 *   container: '#app',
 *   item: { height: 48, template: renderItem },
 *   items: millionItems,
 * })
 * .use(withCompression())
 * .build()
 * ```
 */
export const withScale = <
  T extends VListItem = VListItem,
>(): VListPlugin<T> => {
  let scrollbar: Scrollbar | null = null;
  let virtualScrollTop = 0;
  let compressedModeActive = false;

  return {
    name: "withScale",
    priority: 20,

    setup(ctx: BuilderContext<T>): void {
      const { dom, config: resolvedConfig } = ctx;
      const { classPrefix, horizontal } = resolvedConfig;

      /**
       * Enhanced compression mode updater.
       *
       * When compression activates:
       * - Enables compressed scroll mode on the scroll controller
       * - Creates a custom scrollbar if one doesn't exist (native scrollbar
       *   can't represent the compressed space)
       *
       * When compression deactivates:
       * - Disables compressed scroll mode
       *
       * When compression state changes (e.g. total items changed):
       * - Updates the scroll controller's compression config
       */
      const enhancedUpdateCompressionMode = (): void => {
        const total = ctx.getVirtualTotal();
        const compression = getCompressionState(total, ctx.heightCache);

        if (compression.isCompressed && !compressedModeActive) {
          // Entering compressed mode
          compressedModeActive = true;
          ctx.scrollController.enableCompression(compression);

          // Set content size to virtual height (not actual height)
          // This is critical - the content div must match the virtual height
          // for scrolling and positioning to work correctly
          ctx.updateContentSize(compression.virtualHeight);

          // Replace scroll functions with virtual scroll position.
          // In compressed mode the total height exceeds the browser's DOM
          // scrollTop limit, so we store the position in a variable and
          // bypass native scroll entirely.
          ctx.setScrollFns(
            () => virtualScrollTop,
            (pos: number) => {
              virtualScrollTop = pos;
            },
          );

          // Install wheel handler for compressed scrolling
          const viewport = dom.viewport;
          const wheelHandler = (e: WheelEvent): void => {
            e.preventDefault();
            const maxScroll =
              compression.virtualHeight -
              ctx.state.viewportState.containerHeight;
            virtualScrollTop = Math.max(
              0,
              Math.min(virtualScrollTop + e.deltaY, maxScroll),
            );
            // setScrollFns wrapper calls onScrollFrame automatically
            ctx.scrollController.scrollTo(virtualScrollTop);
          };
          viewport.addEventListener("wheel", wheelHandler, { passive: false });
          ctx.destroyHandlers.push(() => {
            viewport.removeEventListener("wheel", wheelHandler);
          });

          // Force custom scrollbar if not already present
          // (native scrollbar can't represent compressed space)
          // Check if withScrollbar plugin already created one by looking for
          // the scrollbar track element
          const hasScrollbarTrack = dom.viewport.querySelector(
            `.${classPrefix}-scrollbar-track`,
          );

          if (!hasScrollbarTrack) {
            // Create a fallback scrollbar for compressed mode
            scrollbar = createScrollbar(
              dom.viewport,
              (position) => ctx.scrollController.scrollTo(position),
              {},
              classPrefix,
              horizontal,
            );

            // Ensure native scrollbar is hidden
            if (
              !dom.viewport.classList.contains(
                `${classPrefix}-viewport--custom-scrollbar`,
              )
            ) {
              dom.viewport.classList.add(
                `${classPrefix}-viewport--custom-scrollbar`,
              );
            }

            // Update scrollbar bounds
            scrollbar.updateBounds(
              compression.virtualHeight,
              ctx.state.viewportState.containerHeight,
            );

            // Wire scrollbar into afterScroll
            const scrollbarRef = scrollbar;
            ctx.afterScroll.push(
              (scrollTop: number, _direction: string): void => {
                if (scrollbarRef) {
                  scrollbarRef.updatePosition(scrollTop);
                  scrollbarRef.show();
                }
              },
            );

            // Wire resize handler for scrollbar
            ctx.resizeHandlers.push((_width: number, _height: number): void => {
              if (scrollbarRef) {
                const comp = ctx.getCachedCompression();
                scrollbarRef.updateBounds(
                  comp.virtualHeight,
                  ctx.state.viewportState.containerHeight,
                );
              }
            });
          }
        } else if (!compression.isCompressed && compressedModeActive) {
          // Leaving compressed mode
          compressedModeActive = false;
          ctx.scrollController.disableCompression();

          // Restore content size to actual height
          ctx.updateContentSize(compression.actualHeight);
        } else if (compression.isCompressed) {
          // Compression state changed (e.g. total items changed)
          ctx.scrollController.updateConfig({ compression });

          // Update content size to new virtual height
          ctx.updateContentSize(compression.virtualHeight);
        }

        // Update scrollbar bounds if we have a fallback scrollbar
        if (scrollbar) {
          scrollbar.updateBounds(
            compression.virtualHeight,
            ctx.state.viewportState.containerHeight,
          );
        }

        // Update cached compression
        ctx.state.cachedCompression = {
          state: compression,
          totalItems: total,
        };
      };

      // Replace the context's updateCompressionMode with our enhanced version
      (ctx as any).updateCompressionMode = enhancedUpdateCompressionMode;

      // Replace getCachedCompression to return actual cached state
      const originalGetCachedCompression = ctx.getCachedCompression.bind(ctx);
      ctx.getCachedCompression = () => {
        if (ctx.state.cachedCompression) {
          return ctx.state.cachedCompression.state;
        }
        return originalGetCachedCompression();
      };

      // ── Replace visible-range and scroll-to-index with compressed versions ──
      // These handle both compressed and non-compressed cases, so they're safe
      // to install unconditionally.

      ctx.setVisibleRangeFn(
        (
          scrollTop: number,
          containerHeight: number,
          hc: any,
          totalItems: number,
          out: Range,
        ): void => {
          const compression = getCompressionState(totalItems, hc);
          calculateCompressedVisibleRange(
            scrollTop,
            containerHeight,
            hc,
            totalItems,
            compression,
            out,
          );
        },
      );

      ctx.setScrollToPosFn(
        (
          index: number,
          hc: any,
          containerHeight: number,
          totalItems: number,
          align: "start" | "center" | "end",
        ): number => {
          const compression = getCompressionState(totalItems, hc);
          return calculateCompressedScrollToIndex(
            index,
            hc,
            containerHeight,
            totalItems,
            compression,
            align,
          );
        },
      );

      // ── Replace item positioning with compressed version ──
      // The builder core's positionElementFn uses simple heightCache offsets.
      // In compressed mode, items must be positioned relative to the viewport.
      // ── Replace item positioning with compressed version ──
      // The builder core's positionElementFn uses simple heightCache offsets.
      // In compressed mode, items must be positioned relative to the viewport.
      ctx.setPositionElementFn((el: HTMLElement, index: number): void => {
        const total = ctx.getVirtualTotal();
        const compression = getCompressionState(total, ctx.heightCache);

        if (compression.isCompressed) {
          const offset = Math.round(
            calculateCompressedItemPosition(
              index,
              ctx.scrollController.getScrollTop(),
              ctx.heightCache as any,
              total,
              ctx.state.viewportState.containerHeight,
              compression,
            ),
          );
          const horizontal = ctx.config.horizontal;
          el.style.transform = horizontal
            ? `translateX(${offset}px)`
            : `translateY(${offset}px)`;
        } else {
          const offset = Math.round(ctx.heightCache.getOffset(index));
          const horizontal = ctx.config.horizontal;
          el.style.transform = horizontal
            ? `translateX(${offset}px)`
            : `translateY(${offset}px)`;
        }
      });

      // Run initial compression check
      enhancedUpdateCompressionMode();

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        if (scrollbar) {
          scrollbar.destroy();
          scrollbar = null;
        }
      });
    },

    destroy(): void {
      if (scrollbar) {
        scrollbar.destroy();
        scrollbar = null;
      }
    },
  };
};
