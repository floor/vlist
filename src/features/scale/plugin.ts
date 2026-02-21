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
 * - Smooth scroll interpolation — lerp-based wheel handling for cross-browser consistency
 * - Touch scroll support — finger tracking + momentum for iOS Safari / mobile browsers
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
// Smooth Scroll Constants
// =============================================================================

/**
 * Lerp factor for smooth scroll interpolation (0–1).
 *
 * Each animation frame moves this fraction of the remaining distance
 * toward the target scroll position. Higher values feel more responsive;
 * lower values feel smoother.
 *
 * At 0.65, ~88% of movement completes within 2 frames (~33ms at 60fps),
 * which feels immediate while still producing intermediate positions that
 * prevent the Firefox scroll-up stacking bug.
 *
 * The bug: Firefox mouse wheel scroll-up produces deltaY = -16px.
 * With a typical compression ratio of 4.5 (16M virtual / 72M actual),
 * this maps to exactly 72px of actual offset change — one full item height.
 * Items swap positions 1:1, creating a visual stacking effect where
 * nothing appears to move.
 *
 * By interpolating over multiple frames, each frame produces a non-aligned
 * offset (e.g. 46.8px, 16.4px, 5.7px…) instead of a single 72px jump,
 * breaking the alignment and producing smooth visual scrolling.
 */
const LERP_FACTOR = 0.65;

/** Snap to target when remaining distance is below this threshold (px). */
const SNAP_THRESHOLD = 0.5;

// =============================================================================
// Touch Scroll Constants
// =============================================================================

/**
 * Deceleration factor applied per animation frame during momentum scrolling.
 *
 * After the user lifts their finger, the scroll velocity is multiplied by
 * this factor each frame (~16ms at 60fps). Lower values stop faster.
 *
 * 0.95 gives a natural iOS-like feel: fast flicks travel far, gentle
 * flicks stop quickly. At 60fps the velocity halves in ~13 frames (~220ms).
 */
const TOUCH_DECELERATION = 0.95;

/**
 * Minimum velocity (px/ms) below which momentum animation stops.
 * Prevents the scroll from drifting imperceptibly for many frames.
 */
const TOUCH_MIN_VELOCITY = 0.1;

/**
 * Maximum number of recent touch samples used for velocity estimation.
 * Using only the last few samples (within a short time window) avoids
 * averaging in stale positions from a long hold before release.
 */
const TOUCH_VELOCITY_SAMPLES = 5;

/**
 * Maximum age (ms) of a touch sample to be included in velocity calculation.
 * Samples older than this are discarded — they represent a pause, not a flick.
 */
const TOUCH_VELOCITY_WINDOW = 100;

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

  // Smooth scroll state — shared across the plugin closure so that
  // external scroll position changes (scrollbar drag, scrollToIndex)
  // can cancel an in-flight animation and stay in sync.
  let targetScrollTop = 0;
  let smoothScrollId: number | null = null;

  // Touch scroll state — tracks finger position and velocity for
  // compressed-mode touch scrolling (iOS Safari, Android, etc.).
  let touchStartY = 0;
  let touchScrollStart = 0;
  let momentumId: number | null = null;
  let touchSamples: Array<{ time: number; y: number }> = [];

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
        const compression = getCompressionState(total, ctx.sizeCache);

        if (compression.isCompressed && !compressedModeActive) {
          // Entering compressed mode
          compressedModeActive = true;
          ctx.scrollController.enableCompression(compression);

          // Set content size to virtual height (not actual height)
          // This is critical - the content div must match the virtual height
          // for scrolling and positioning to work correctly
          ctx.updateContentSize(compression.virtualSize);

          // Replace scroll functions with virtual scroll position.
          // In compressed mode the total height exceeds the browser's DOM
          // scrollTop limit, so we store the position in a variable and
          // bypass native scroll entirely.
          //
          // The setter also keeps targetScrollTop in sync and cancels any
          // in-flight smooth scroll animation so that external position
          // changes (scrollbar drag, scrollToIndex) take effect immediately.
          ctx.setScrollFns(
            () => virtualScrollTop,
            (pos: number) => {
              virtualScrollTop = pos;
              targetScrollTop = pos;
              if (smoothScrollId !== null) {
                cancelAnimationFrame(smoothScrollId);
                smoothScrollId = null;
              }
            },
          );

          // ── Smooth scroll tick ──────────────────────────────────────────
          // Called on each animation frame while the scroll is converging
          // toward targetScrollTop. Produces intermediate positions that
          // prevent exact item-height-aligned jumps (the Firefox bug).
          const smoothScrollTick = (): void => {
            const diff = targetScrollTop - virtualScrollTop;

            if (Math.abs(diff) < SNAP_THRESHOLD) {
              // Close enough — snap to target and stop animating
              virtualScrollTop = targetScrollTop;
              smoothScrollId = null;
            } else {
              // Move a fraction of the remaining distance
              virtualScrollTop += diff * LERP_FACTOR;
              smoothScrollId = requestAnimationFrame(smoothScrollTick);
            }

            ctx.scrollController.scrollTo(virtualScrollTop);
          };

          // ── Wheel handler ───────────────────────────────────────────────
          // Instead of immediately applying deltaY to virtualScrollTop, we
          // accumulate it in targetScrollTop and let the lerp animation
          // converge over a few frames. This:
          //   1. Breaks exact item-height alignment (fixes Firefox bug)
          //   2. Coalesces multiple wheel events per frame (better perf)
          //   3. Produces smoother visual scrolling in all browsers
          const viewport = dom.viewport;
          const wheelHandler = (e: WheelEvent): void => {
            e.preventDefault();

            // Use latest compression state for accurate maxScroll
            const comp = ctx.getCachedCompression();
            const maxScroll =
              comp.virtualSize - ctx.state.viewportState.containerSize;

            targetScrollTop = Math.max(
              0,
              Math.min(targetScrollTop + e.deltaY, maxScroll),
            );

            // Start animation loop if not already running
            if (smoothScrollId === null) {
              smoothScrollId = requestAnimationFrame(smoothScrollTick);
            }
          };
          viewport.addEventListener("wheel", wheelHandler, { passive: false });

          // ── Touch handlers ────────────────────────────────────────────
          // On touch devices (iOS Safari, Android) wheel events never fire.
          // We track the finger directly during touchmove (1:1 mapping) and
          // apply momentum/inertial scrolling on touchend, mimicking native
          // scroll physics.

          const cancelMomentum = (): void => {
            if (momentumId !== null) {
              cancelAnimationFrame(momentumId);
              momentumId = null;
            }
          };

          const touchStartHandler = (e: TouchEvent): void => {
            // Cancel any in-flight animations
            cancelMomentum();
            if (smoothScrollId !== null) {
              cancelAnimationFrame(smoothScrollId);
              smoothScrollId = null;
            }

            const touch = e.touches[0];
            if (!touch) return;
            const y = horizontal ? touch.clientX : touch.clientY;

            touchStartY = y;
            touchScrollStart = virtualScrollTop;
            touchSamples = [{ time: performance.now(), y }];
          };

          const touchMoveHandler = (e: TouchEvent): void => {
            // Prevent native page scroll / iOS bounce
            e.preventDefault();

            const touch = e.touches[0];
            if (!touch) return;
            const y = horizontal ? touch.clientX : touch.clientY;
            const now = performance.now();

            // Record sample for velocity estimation (ring buffer)
            touchSamples.push({ time: now, y });
            if (touchSamples.length > TOUCH_VELOCITY_SAMPLES) {
              touchSamples.shift();
            }

            // Delta: finger moving UP (negative dy) should scroll DOWN (positive delta)
            const delta = touchStartY - y;
            const comp = ctx.getCachedCompression();
            const maxScroll =
              comp.virtualSize - ctx.state.viewportState.containerSize;

            const newPos = Math.max(
              0,
              Math.min(touchScrollStart + delta, maxScroll),
            );

            virtualScrollTop = newPos;
            targetScrollTop = newPos;
            ctx.scrollController.scrollTo(newPos);
          };

          const touchEndHandler = (_e: TouchEvent): void => {
            // Calculate flick velocity from recent samples
            const now = performance.now();

            // Filter samples within the velocity window
            const recent = touchSamples.filter(
              (s) => now - s.time < TOUCH_VELOCITY_WINDOW,
            );

            let velocity = 0; // px/ms, positive = scrolling down
            if (recent.length >= 2) {
              const first = recent[0]!;
              const last = recent[recent.length - 1]!;
              const dt = last.time - first.time;
              if (dt > 0) {
                // finger up (negative dy) → positive velocity (scroll down)
                velocity = (first.y - last.y) / dt;
              }
            }
            touchSamples = [];

            // Apply momentum if flick was fast enough
            if (Math.abs(velocity) < TOUCH_MIN_VELOCITY) return;

            // Convert velocity from px/ms to px/frame (~16ms at 60fps)
            let frameVelocity = velocity * 16;

            const momentumTick = (): void => {
              frameVelocity *= TOUCH_DECELERATION;

              if (Math.abs(frameVelocity) < 0.5) {
                momentumId = null;
                return;
              }

              const comp = ctx.getCachedCompression();
              const maxScroll =
                comp.virtualSize - ctx.state.viewportState.containerSize;

              let newPos = virtualScrollTop + frameVelocity;
              newPos = Math.max(0, Math.min(newPos, maxScroll));

              // Stop at edges
              if (
                (newPos <= 0 && frameVelocity < 0) ||
                (newPos >= maxScroll && frameVelocity > 0)
              ) {
                virtualScrollTop = newPos;
                targetScrollTop = newPos;
                ctx.scrollController.scrollTo(newPos);
                momentumId = null;
                return;
              }

              virtualScrollTop = newPos;
              targetScrollTop = newPos;
              ctx.scrollController.scrollTo(newPos);

              momentumId = requestAnimationFrame(momentumTick);
            };

            momentumId = requestAnimationFrame(momentumTick);
          };

          viewport.addEventListener("touchstart", touchStartHandler, {
            passive: true,
          });
          viewport.addEventListener("touchmove", touchMoveHandler, {
            passive: false,
          });
          viewport.addEventListener("touchend", touchEndHandler, {
            passive: true,
          });
          viewport.addEventListener("touchcancel", touchEndHandler, {
            passive: true,
          });

          ctx.destroyHandlers.push(() => {
            viewport.removeEventListener("wheel", wheelHandler);
            viewport.removeEventListener("touchstart", touchStartHandler);
            viewport.removeEventListener("touchmove", touchMoveHandler);
            viewport.removeEventListener("touchend", touchEndHandler);
            viewport.removeEventListener("touchcancel", touchEndHandler);
            cancelMomentum();
            if (smoothScrollId !== null) {
              cancelAnimationFrame(smoothScrollId);
              smoothScrollId = null;
            }
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
              compression.virtualSize,
              ctx.state.viewportState.containerSize,
            );

            // Wire scrollbar into afterScroll
            const scrollbarRef = scrollbar;
            ctx.afterScroll.push(
              (scrollPosition: number, _direction: string): void => {
                if (scrollbarRef) {
                  scrollbarRef.updatePosition(scrollPosition);
                  scrollbarRef.show();
                }
              },
            );

            // Wire resize handler for scrollbar
            ctx.resizeHandlers.push((_width: number, _height: number): void => {
              if (scrollbarRef) {
                const comp = ctx.getCachedCompression();
                scrollbarRef.updateBounds(
                  comp.virtualSize,
                  ctx.state.viewportState.containerSize,
                );
              }
            });
          }
        } else if (!compression.isCompressed && compressedModeActive) {
          // Leaving compressed mode
          compressedModeActive = false;
          ctx.scrollController.disableCompression();

          // Restore content size to actual height
          ctx.updateContentSize(compression.actualSize);
        } else if (compression.isCompressed) {
          // Compression state changed (e.g. total items changed)
          ctx.scrollController.updateConfig({ compression });

          // Update content size to new virtual height
          ctx.updateContentSize(compression.virtualSize);
        }

        // Update scrollbar bounds if we have a fallback scrollbar
        if (scrollbar) {
          scrollbar.updateBounds(
            compression.virtualSize,
            ctx.state.viewportState.containerSize,
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
          // Reset anchor before calculating new range (for relative positioning fix)
          firstItemPosition = null;
          firstItemIndex = null;

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
      // The builder core's positionElementFn uses simple sizeCache offsets.
      // In compressed mode, items must be positioned relative to the viewport.
      //
      // We calculate only the FIRST visible item's position using the
      // compression formula, then position all other items using FIXED
      // OFFSETS relative to the first item. This ensures consistent spacing
      // between items regardless of floating-point edge cases.
      let firstItemPosition: number | null = null;
      let firstItemIndex: number | null = null;

      ctx.setPositionElementFn((el: HTMLElement, index: number): void => {
        const total = ctx.getVirtualTotal();
        const compression = getCompressionState(total, ctx.sizeCache);

        if (compression.isCompressed) {
          const scrollTop = ctx.scrollController.getScrollTop();

          // Calculate first item position (anchor point)
          if (firstItemPosition === null || index < firstItemIndex!) {
            firstItemIndex = index;
            firstItemPosition = Math.round(
              calculateCompressedItemPosition(
                index,
                scrollTop,
                ctx.sizeCache as any,
                total,
                ctx.state.viewportState.containerSize,
                compression,
              ),
            );
          }

          // Position this item relative to the first item using fixed offsets
          const offset =
            firstItemPosition! +
            ctx.sizeCache.getOffset(index) -
            ctx.sizeCache.getOffset(firstItemIndex!);

          const horizontal = ctx.config.horizontal;
          el.style.transform = horizontal
            ? `translateX(${offset}px)`
            : `translateY(${offset}px)`;
        } else {
          const offset = Math.round(ctx.sizeCache.getOffset(index));
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
        if (smoothScrollId !== null) {
          cancelAnimationFrame(smoothScrollId);
          smoothScrollId = null;
        }
      });
    },

    destroy(): void {
      if (scrollbar) {
        scrollbar.destroy();
        scrollbar = null;
      }
      if (smoothScrollId !== null) {
        cancelAnimationFrame(smoothScrollId);
        smoothScrollId = null;
      }
      if (momentumId !== null) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }
    },
  };
};
