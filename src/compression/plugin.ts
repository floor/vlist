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

import type { VListItem } from "../types";
import type { VListPlugin, BuilderContext } from "../builder/types";

import { getCompressionState } from "../render/compression";
import { createScrollbar, type Scrollbar } from "../scroll";

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
export const withCompression = <T extends VListItem = VListItem>(): VListPlugin<T> => {
  let scrollbar: Scrollbar | null = null;

  return {
    name: "withCompression",
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
      const originalUpdateCompressionMode = ctx.updateCompressionMode.bind(ctx);

      const enhancedUpdateCompressionMode = (): void => {
        const total = ctx.getVirtualTotal();
        const compression = getCompressionState(total, ctx.heightCache);

        if (compression.isCompressed && !ctx.scrollController.isCompressed()) {
          // Entering compressed mode
          ctx.scrollController.enableCompression(compression);

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
            ctx.resizeHandlers.push(
              (_width: number, _height: number): void => {
                if (scrollbarRef) {
                  const comp = ctx.getCachedCompression();
                  scrollbarRef.updateBounds(
                    comp.virtualHeight,
                    ctx.state.viewportState.containerHeight,
                  );
                }
              },
            );
          }
        } else if (
          !compression.isCompressed &&
          ctx.scrollController.isCompressed()
        ) {
          // Leaving compressed mode
          ctx.scrollController.disableCompression();
        } else if (compression.isCompressed) {
          // Compression state changed (e.g. total items changed)
          ctx.scrollController.updateConfig({ compression });
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
