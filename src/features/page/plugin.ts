/**
 * vlist/window - Window Scroll Mode Plugin
 *
 * Enables the list to scroll with the page instead of in its own container.
 * Useful for infinite feeds, full-page lists, and chat UIs that integrate
 * with page scroll.
 *
 * Priority: 5 (runs early, before other plugins that depend on scroll)
 *
 * What it does:
 * - Uses window as scroll target instead of viewport element
 * - Calculates scroll position relative to document
 * - Uses window.innerWidth/innerHeight for container dimensions
 * - Listens to window resize events instead of ResizeObserver
 * - Adjusts DOM styles (overflow: visible, height: auto)
 *
 * Bundle impact: ~0.3 KB gzipped when used
 */

import type { VListItem } from "../../types";
import type { VListPlugin, BuilderContext } from "../../builder/types";

/**
 * Create a window scroll mode plugin.
 *
 * Use this when you want your list to scroll with the page instead of
 * in a fixed-height container.
 *
 * @example
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withWindow } from 'vlist/window'
 *
 * const feed = vlist({
 *   container: '#infinite-feed',
 *   item: { height: 200, template: renderPost },
 *   items: posts
 * })
 * .use(withWindow())
 * .build()
 * ```
 *
 * @example Horizontal window scrolling
 * ```ts
 * const timeline = vlist({
 *   container: '#timeline',
 *   item: { height: 100, template: renderEvent },
 *   direction: 'horizontal'
 * })
 * .use(withWindow())
 * .build()
 * ```
 */
export const withPage = <
  T extends VListItem = VListItem,
>(): VListPlugin<T> => {
  let cleanupResize: (() => void) | null = null;

  return {
    name: "withPage",
    priority: 5, // Run early, before scroll/selection plugins

    setup(ctx: BuilderContext<T>): void {
      const { dom, state, config, emitter } = ctx;

      // ── 1. Modify DOM for window scroll ────────────────────────

      // Remove container overflow (list flows with page)
      dom.root.style.overflow = "visible";
      dom.root.style.height = "auto";

      // Don't hide scrollbar (window controls it)
      dom.viewport.classList.remove(
        `${config.classPrefix}-viewport--custom-scrollbar`,
      );

      // ── 2. Disable viewport ResizeObserver ─────────────────────
      // Viewport size reflects content, not visible area
      ctx.disableViewportResize();

      // ── 3. Set window as scroll target ─────────────────────────
      ctx.setScrollTarget(window);

      // ── 4. Override scroll position functions ──────────────────

      ctx.setScrollFns(
        // getTop - calculate scroll position relative to document
        (): number => {
          const rect = dom.viewport.getBoundingClientRect();
          if (config.horizontal) {
            // Horizontal: distance from left edge of viewport to left edge of document
            return Math.max(0, -rect.left);
          } else {
            // Vertical: distance from top edge of viewport to top edge of document
            return Math.max(0, -rect.top);
          }
        },

        // setTop - scroll window to position the list correctly
        (pos: number): void => {
          const rect = dom.viewport.getBoundingClientRect();
          if (config.horizontal) {
            // Calculate where the list is in the document
            const listDocumentLeft = rect.left + window.scrollX;
            // Scroll window to show the desired position (instant, no smooth)
            window.scrollTo(listDocumentLeft + pos, window.scrollY);
          } else {
            // Calculate where the list is in the document
            const listDocumentTop = rect.top + window.scrollY;
            // Scroll window to show the desired position (instant, no smooth)
            window.scrollTo(window.scrollX, listDocumentTop + pos);
          }
        },
      );

      // ── 5. Override container dimensions ───────────────────────

      ctx.setContainerDimensions({
        width: (): number => window.innerWidth,
        height: (): number => window.innerHeight,
      });

      // Update dimensions immediately
      state.viewportState.containerSize = window.innerHeight;

      // ── 6. Window resize handler ───────────────────────────────

      let previousHeight = window.innerHeight;
      let previousWidth = window.innerWidth;

      const handleResize = (): void => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        // Only process resize if change is > 1px (same as ResizeObserver in core)
        const mainAxis = config.horizontal ? newWidth : newHeight;
        const prevMainAxis = config.horizontal ? previousWidth : previousHeight;

        if (Math.abs(mainAxis - prevMainAxis) <= 1) {
          return; // Skip tiny changes
        }

        // Update tracking
        previousHeight = newHeight;
        previousWidth = newWidth;

        // Update state
        state.viewportState.containerSize = newHeight;

        // Emit resize event for listeners
        emitter.emit("resize", { width: newWidth, height: newHeight });

        // Notify resize handlers (other plugins may need this)
        for (let i = 0; i < ctx.resizeHandlers.length; i++) {
          ctx.resizeHandlers[i]!(newWidth, newHeight);
        }

        // Re-render with new dimensions
        ctx.renderIfNeeded();
      };

      window.addEventListener("resize", handleResize, { passive: true });

      // Store cleanup function
      cleanupResize = (): void => {
        window.removeEventListener("resize", handleResize);
      };

      // Register cleanup
      ctx.destroyHandlers.push(cleanupResize);
    },

    destroy(): void {
      // Clean up window resize listener
      if (cleanupResize) {
        cleanupResize();
        cleanupResize = null;
      }
    },
  };
};
