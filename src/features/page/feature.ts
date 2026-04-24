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
 * - Uses behavior: "instant" on all scrollTo calls to override CSS
 *   scroll-behavior: smooth that may be set on the page
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
   * Also affects `scrollToIndex` alignment (start/center/end).
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
    priority: 5,

    setup(ctx: BuilderContext<T>): void {
      const { dom, state, config, emitter } = ctx;

      // ── 1. Modify DOM for window scroll ────────────────────────

      dom.root.style.overflow = "visible";
      dom.root.style.height = "auto";

      // Remove viewport overflow to prevent double scrolling.
      // The viewport was set to "overflow: auto" during DOM creation,
      // which causes both window AND viewport to handle scroll events.
      if (config.horizontal) {
        dom.viewport.style.overflowX = "visible";
        dom.viewport.style.overflowY = "visible";
      } else {
        dom.viewport.style.overflow = "visible";
      }

      dom.viewport.classList.remove(
        `${config.classPrefix}-viewport--custom-scrollbar`,
      );

      // ── 2. Disable viewport ResizeObserver & wheel handler ─────

      ctx.disableViewportResize();
      ctx.disableWheelHandler();

      // ── 3. Set window as scroll target ─────────────────────────

      ctx.setScrollTarget(window);

      // ── 4. Override scroll position functions ──────────────────
      //
      // During rapid keyboard navigation the browser may not have
      // painted the last window.scrollTo yet, so DOM reads can be
      // stale.  _scrollItemIntoView tracks an intended target in
      // `targetScroll` and computes from that — but getTop always
      // reads the DOM so the render range follows the actual
      // browser position (keeping visible items rendered).
      //
      // All scrollTo calls use behavior:"instant" to override any
      // CSS scroll-behavior:smooth on the page.

      let targetScroll: number | null = null;

      ctx.setScrollFns(
        // getTop — list-relative scroll position from DOM
        (): number => {
          const rect = dom.viewport.getBoundingClientRect();
          return Math.max(0, config.horizontal ? -rect.left : -rect.top);
        },

        // setTop — scroll window to position the list correctly
        (pos: number): void => {
          const rect = dom.viewport.getBoundingClientRect();
          if (config.horizontal) {
            const docLeft = rect.left + window.scrollX;
            window.scrollTo({ left: docLeft + pos, top: window.scrollY, behavior: "instant" });
          } else {
            const docTop = rect.top + window.scrollY;
            window.scrollTo({ left: window.scrollX, top: docTop + pos, behavior: "instant" });
          }
        },
      );

      // ── 5. Override container dimensions ───────────────────────

      ctx.setContainerDimensions({
        width: (): number => window.innerWidth,
        height: (): number => window.innerHeight,
      });

      state.viewportState.containerSize = window.innerHeight;

      // ── 6. Scroll padding ─────────────────────────────────────
      //
      // When scrollPadding is provided:
      //   6a — override scrollToIndex so align "start"/"center"/"end"
      //        land items inside the padded safe area.
      //   6b — register _scrollItemIntoView so keyboard focus
      //        navigation keeps items clear of sticky chrome.

      if (scrollPadding) {
        const hz = config.horizontal;
        const itemToScrollIndex = ctx.getItemToScrollIndexFn();

        // ── 6a. scrollToIndex position calculator ────────────────

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
                pos = offset - startPad;
                break;
              case "center": {
                const effectiveH = containerHeight - startPad - endPad;
                pos = offset - startPad - (effectiveH - itemH) / 2;
                break;
              }
              case "end":
                pos = offset - containerHeight + itemH + endPad;
                break;
            }
            return Math.max(-startPad, Math.min(pos, maxScroll));
          },
        );

        // ── 6b. Keyboard-focus scroll-into-view ─────────────────
        //
        // Uses absolute document coordinates so rapid key repeat
        // never accumulates errors from stale DOM reads.
        // `targetScroll` tracks the intended window scroll position
        // across keydowns; cleared implicitly when the next call
        // reads a fresh domScroll that matches.

        ctx.methods.set("_scrollItemIntoView", (index: number): void => {
          const si = itemToScrollIndex(index);
          const containerSize = hz ? window.innerWidth : window.innerHeight;

          const startPad = resolvePad(hz ? scrollPadding.left : scrollPadding.top);
          const endPad = resolvePad(hz ? scrollPadding.right : scrollPadding.bottom);

          const rect = dom.viewport.getBoundingClientRect();
          const domScroll = hz ? window.scrollX : window.scrollY;
          const listDocPos = (hz ? rect.left : rect.top) + domScroll;
          const effectiveScroll = targetScroll ?? domScroll;
          const listScreenPos = listDocPos - effectiveScroll;

          const itemOffset = ctx.sizeCache.getOffset(si);
          const itemSize = ctx.sizeCache.getSize(si);
          const itemScreenStart = listScreenPos + itemOffset;
          const itemScreenEnd = itemScreenStart + itemSize;

          const safeStart = startPad;
          const safeEnd = containerSize - endPad;

          let newTarget = effectiveScroll;

          if (itemScreenStart < safeStart) {
            newTarget = listDocPos + itemOffset - safeStart;
          } else if (itemScreenEnd > safeEnd) {
            newTarget = listDocPos + itemOffset + itemSize - safeEnd;
          }

          if (newTarget !== effectiveScroll) {
            targetScroll = newTarget;
            if (hz) {
              window.scrollTo({ left: newTarget, top: window.scrollY, behavior: "instant" });
            } else {
              window.scrollTo({ left: window.scrollX, top: newTarget, behavior: "instant" });
            }
          }
        });
      }

      // ── 7. Window resize handler ───────────────────────────────

      let previousHeight = window.innerHeight;
      let previousWidth = window.innerWidth;

      const handleResize = (): void => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        const mainAxis = config.horizontal ? newWidth : newHeight;
        const prevMainAxis = config.horizontal ? previousWidth : previousHeight;

        if (Math.abs(mainAxis - prevMainAxis) <= 1) return;

        previousHeight = newHeight;
        previousWidth = newWidth;
        state.viewportState.containerSize = newHeight;

        emitter.emit("resize", { width: newWidth, height: newHeight });

        for (let i = 0; i < ctx.resizeHandlers.length; i++) {
          ctx.resizeHandlers[i]!(newWidth, newHeight);
        }

        ctx.renderIfNeeded();
      };

      window.addEventListener("resize", handleResize, { passive: true });

      cleanupResize = (): void => {
        window.removeEventListener("resize", handleResize);
      };

      ctx.destroyHandlers.push(cleanupResize);
    },

    destroy(): void {
      if (cleanupResize) {
        cleanupResize();
        cleanupResize = null;
      }
    },
  };
};