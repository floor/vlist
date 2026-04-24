/**
 * vlist/window - Window Scroll Mode Feature
 *
 * Enables the list to scroll with the page instead of in its own container.
 * Useful for infinite feeds, full-page lists, and chat UIs that integrate
 * with page scroll.
 *
 * Priority: 5 (runs early, before other features that depend on scroll)
 *
 * What it does:
 * - Uses window as scroll target instead of viewport element
 * - Calculates scroll position relative to document
 * - Uses window.innerWidth/innerHeight for container dimensions
 * - Listens to window resize events instead of ResizeObserver
 * - Adjusts DOM styles (overflow: visible, height: auto)
 * - Optionally accounts for fixed/sticky chrome via scrollPadding
 *
 * Bundle impact: ~0.3 KB gzipped when used
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

/**
 * Options for the window scroll mode feature.
 */
export interface WithPageOptions {
  /**
   * Scroll padding — insets from the viewport edges where fixed/sticky
   * elements (headers, footers, toolbars) live.
   *
   * When keyboard focus moves an item behind a sticky bar, the list
   * auto-scrolls to keep it within the visible (unobstructed) area.
   *
   * Mirrors CSS `scroll-padding` semantics: defines the optimal viewing
   * region within the scrollport.
   *
   * Values can be numbers (pixels) or functions that return pixels
   * (useful when the sticky element's height is dynamic).
   *
   * @example
   * ```ts
   * withPage({
   *   scrollPadding: { top: 60, bottom: 50 }
   * })
   * ```
   *
   * @example Dynamic values
   * ```ts
   * withPage({
   *   scrollPadding: {
   *     top: () => document.getElementById('sticky-header')!.offsetHeight,
   *     bottom: 50
   *   }
   * })
   * ```
   */
  scrollPadding?: {
    top?: number | (() => number);
    bottom?: number | (() => number);
    left?: number | (() => number);
    right?: number | (() => number);
  };
}

/** Resolve a padding value — number or function returning number. */
const resolvePad = (v: number | (() => number) | undefined): number =>
  v == null ? 0 : typeof v === "function" ? v() : v;

/**
 * Create a window scroll mode feature.
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
 * @example With scroll padding for sticky chrome
 * ```ts
 * const feed = vlist({
 *   container: '#infinite-feed',
 *   item: { height: 200, template: renderPost },
 *   items: posts
 * })
 * .use(withPage({ scrollPadding: { top: 60, bottom: 50 } }))
 * .build()
 * ```
 *
 * @example Horizontal window scrolling
 * ```ts
 * const timeline = vlist({
 *   container: '#timeline',
 *   item: { height: 100, template: renderEvent },
 *   orientation: 'horizontal'
 * })
 * .use(withWindow())
 * .build()
 * ```
 */
export const withPage = <
  T extends VListItem = VListItem,
>(options?: WithPageOptions): VListFeature<T> => {
  let cleanupResize: (() => void) | null = null;
  const scrollPadding = options?.scrollPadding;

  return {
    name: "withPage",
    priority: 5, // Run early, before scroll/selection features

    setup(ctx: BuilderContext<T>): void {
      const { dom, state, config, emitter } = ctx;

      // ── 1. Modify DOM for window scroll ────────────────────────

      // Remove container overflow (list flows with page)
      dom.root.style.overflow = "visible";
      dom.root.style.height = "auto";

      // CRITICAL: Remove viewport overflow to prevent double scrolling
      // The viewport was set to "overflow: auto" during DOM creation,
      // which causes both window AND viewport to handle scroll events
      if (config.horizontal) {
        dom.viewport.style.overflowX = "visible";
        dom.viewport.style.overflowY = "visible";
      } else {
        dom.viewport.style.overflow = "visible";
      }

      // Don't hide scrollbar (window controls it)
      dom.viewport.classList.remove(
        `${config.classPrefix}-viewport--custom-scrollbar`,
      );

      // ── 2. Disable viewport ResizeObserver ─────────────────────
      // Viewport size reflects content, not visible area
      ctx.disableViewportResize();

      // ── 2b. Disable wheel handler ──────────────────────────────
      // CRITICAL: Remove wheel handler to prevent scroll conflicts
      // The wheel handler intercepts wheel events on viewport and manually
      // updates scroll position, which conflicts with window scroll mode
      // where we want native browser scrolling behavior
      ctx.disableWheelHandler();

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

      // ── 6. Scroll padding — scroll-into-view with insets ───────
      // When scrollPadding is provided, register a custom
      // _scrollItemIntoView that keeps focused items inside the
      // visible area (viewport minus the padded insets), so they
      // are never hidden behind fixed/sticky chrome.

      if (scrollPadding) {
        const hz = config.horizontal;
        const itemToScrollIndex = ctx.getItemToScrollIndexFn();

        // ── 6a. Override scrollToIndex position calculator ────────
        // Wrap the default calcScrollToPosition so that align "start",
        // "center", and "end" land items inside the padded safe area
        // instead of at the raw viewport edges.
        // Note: when padding resolves to 0 the math is identical to
        // the default calculator — no special-case needed.

        ctx.setScrollToPosFn(
          (index, sc, containerHeight, totalItems, align) => {
            const startPad = resolvePad(hz ? scrollPadding.left : scrollPadding.top);
            const endPad = resolvePad(hz ? scrollPadding.right : scrollPadding.bottom);

            if (totalItems === 0) return 0;
            const clamped = Math.max(0, Math.min(index, totalItems - 1));
            const offset = sc.getOffset(clamped);
            const itemH = sc.getSize(clamped);
            const totalSize = sc.getTotalSize();
            const maxScroll = Math.max(0, totalSize - containerHeight + endPad);

            let pos: number;
            switch (align) {
              case "start":
                // Item top sits just below the start inset
                pos = offset - startPad;
                break;
              case "center": {
                // Item centered within the effective (padded) area
                const effectiveH = containerHeight - startPad - endPad;
                pos = offset - startPad - (effectiveH - itemH) / 2;
                break;
              }
              case "end":
                // Item bottom sits just above the end inset
                pos = offset - containerHeight + itemH + endPad;
                break;
            }
            return Math.max(-startPad, Math.min(pos, maxScroll));
          },
        );

        // ── 6b. Override keyboard-focus scroll-into-view ─────────

        ctx.methods.set("_scrollItemIntoView", (index: number): void => {
          const si = itemToScrollIndex(index);
          const scrollPos = state.viewportState.scrollPosition;
          const containerSize = hz ? window.innerWidth : window.innerHeight;

          const startPad = resolvePad(hz ? scrollPadding.left : scrollPadding.top);
          const endPad = resolvePad(hz ? scrollPadding.right : scrollPadding.bottom);

          const itemOffset = ctx.sizeCache.getOffset(si);
          const itemSize = ctx.sizeCache.getSize(si);
          const itemEnd = itemOffset + itemSize;

          // Visible region = [scrollPos + startPad, scrollPos + containerSize - endPad]
          const visibleStart = scrollPos + startPad;
          const visibleEnd = scrollPos + containerSize - endPad;

          let newScroll = scrollPos;

          if (itemOffset < visibleStart) {
            // Item is above/before the visible area — scroll so item
            // sits just below the start inset.
            newScroll = Math.max(-startPad, itemOffset - startPad);
          } else if (itemEnd > visibleEnd) {
            // Item is below/after the visible area — scroll so item's
            // bottom edge sits just above the end inset.
            newScroll = itemEnd + endPad - containerSize;
          }

          if (newScroll !== scrollPos) {
            ctx.scrollController.scrollTo(newScroll);
          }
        });
      }

      // ── 7. Window resize handler ───────────────────────────────

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

        // Notify resize handlers (other features may need this)
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