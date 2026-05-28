/**
 * vlist v2 — Scale Plugin
 *
 * Enables support for 1M+ item lists by compressing the scroll space
 * when total content size exceeds the browser's ~16.7M pixel limit.
 *
 * Priority 20 — runs after layout plugins (10), before selection (50).
 *
 * When compressed:
 * - Native scroll is disabled (overflow: hidden)
 * - Custom wheel handler with lerp smooth scroll
 * - Custom touch handler with momentum
 * - Items positioned relative to viewport via onCalculate hook
 * - Fallback scrollbar created if no scrollbar plugin present
 *
 * Uses v1's rendering/scale.ts pure math functions directly.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";
import {
  getCompressionState,
  calculateCompressedVisibleRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  type CompressionState,
} from "../../rendering/scale";
import { createScrollbar, type Scrollbar } from "../scrollbar/scrollbar";
import { SCROLL_EASING, SCROLL_DURATION } from "../../constants";

// =============================================================================
// Config
// =============================================================================

export interface ScalePluginConfig {
  force?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const LERP_FACTOR = 0.65;
const SNAP_THRESHOLD = 0.5;
const SCROLL_SPEED_MULTIPLIER = 1.7;
const TOUCH_DECELERATION = 0.95;
const TOUCH_MIN_VELOCITY = 0.1;
const TOUCH_VELOCITY_SAMPLES = 5;
const TOUCH_VELOCITY_WINDOW = 100;

// =============================================================================
// Factory
// =============================================================================

export function scale<T extends VListItem = VListItem>(
  config?: ScalePluginConfig,
): VListPlugin<T> {
  const force = config?.force ?? false;

  let engineState: EngineState;
  let sizeCache: SizeCache;
  let viewport: HTMLElement;
  let isX: boolean;
  let overscan: number;

  let compression: CompressionState = {
    isCompressed: false,
    actualSize: 0,
    virtualSize: 0,
    ratio: 1,
  };
  let compressedActive = false;
  let slack = 0;
  let fallbackScrollbar: Scrollbar | null = null;
  let ownsScrollbar = false;

  // Virtual scroll state
  let virtualScrollPosition = 0;
  let targetScrollPosition = 0;
  let smoothScrollId: number | null = null;
  let easedScrollId: number | null = null;

  // Touch state
  let touchStartPos = 0;
  let touchScrollStart = 0;
  let momentumId: number | null = null;

  // Pre-allocated ring buffer for velocity sampling (zero-alloc hot path)
  const sampleTimes = new Float64Array(TOUCH_VELOCITY_SAMPLES);
  const samplePositions = new Float64Array(TOUCH_VELOCITY_SAMPLES);
  let sampleCount = 0;
  let sampleHead = 0;

  // Reusable range object for compressed visible range calc
  const compRange = { start: 0, end: -1 };

  // Track item count so onCalculate can detect data mutations
  let lastCheckedTotal = -1;
  let storedCtx: PluginContext<T> | null = null;

  function getMaxScroll(): number {
    return Math.max(0, compression.virtualSize + slack - engineState.containerSize);
  }

  function computeSlack(): number {
    if (compression.virtualSize <= 0) return 0;
    return Math.max(0, engineState.containerSize * (1 - compression.ratio));
  }

  function updateCompression(ctx: PluginContext<T>): void {
    const totalItems = engineState.totalItems;
    compression = getCompressionState(totalItems, sizeCache, force);

    if (compression.isCompressed && !compressedActive) {
      activateCompression(ctx);
    } else if (!compression.isCompressed && compressedActive) {
      deactivateCompression(ctx);
    }

    if (compression.isCompressed) {
      slack = computeSlack();
      engineState.isCompressed = true;
      engineState.compressionRatio = compression.ratio;
      ctx.updateContentSize(compression.virtualSize + slack);

      if (fallbackScrollbar) {
        fallbackScrollbar.updateBounds(
          compression.virtualSize + slack,
          engineState.containerSize,
        );
      }
    }
  }

  // Wheel/touch handlers — stored so we can remove them
  let wheelHandler: ((e: WheelEvent) => void) | null = null;
  let touchStartHandler: ((e: TouchEvent) => void) | null = null;
  let touchMoveHandler: ((e: TouchEvent) => void) | null = null;
  let touchEndHandler: ((e: TouchEvent) => void) | null = null;
  let nativeScrollReset: (() => void) | null = null;

  function applyVirtualScroll(pos: number): void {
    virtualScrollPosition = pos;
    targetScrollPosition = pos;
    engineState.prevScrollPosition = engineState.scrollPosition;
    engineState.scrollPosition = pos;
    engineState.scrollDirection = pos > engineState.prevScrollPosition ? 1 : -1;
    storedCtx!.forceRender();
  }

  function cancelAnimations(): void {
    if (smoothScrollId !== null) { cancelAnimationFrame(smoothScrollId); smoothScrollId = null; }
    if (easedScrollId !== null) { cancelAnimationFrame(easedScrollId); easedScrollId = null; }
  }

  function setVirtualPosition(pos: number): void {
    cancelAnimations();
    applyVirtualScroll(Math.max(0, Math.min(pos, getMaxScroll())));
  }

  function easedScrollTo(target: number, duration: number, easing: (t: number) => number = SCROLL_EASING): void {
    cancelAnimations();
    const clampedTarget = Math.max(0, Math.min(target, getMaxScroll()));
    const from = virtualScrollPosition;
    if (Math.abs(clampedTarget - from) < SNAP_THRESHOLD) {
      applyVirtualScroll(clampedTarget);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      applyVirtualScroll(from + (clampedTarget - from) * easing(t));
      if (t < 1) easedScrollId = requestAnimationFrame(tick);
      else easedScrollId = null;
    };
    easedScrollId = requestAnimationFrame(tick);
  }

  function activateCompression(ctx: PluginContext<T>): void {
    compressedActive = true;
    engineState.isCompressed = true;
    const scrollProp = isX ? "scrollLeft" : "scrollTop";
    const overflowProp = isX ? "overflowX" : "overflow";

    // Capture native position before disabling
    const nativePos = viewport[scrollProp as keyof HTMLElement] as number;
    (viewport.style as any)[overflowProp] = "hidden";
    (viewport as any)[scrollProp] = 0;

    if (nativePos > 0) {
      virtualScrollPosition = nativePos;
      targetScrollPosition = nativePos;
      engineState.scrollPosition = nativePos;
    }

    slack = computeSlack();

    // Lerp smooth scroll tick
    const smoothScrollTick = (): void => {
      const diff = targetScrollPosition - virtualScrollPosition;
      const maxScroll = getMaxScroll();

      if (Math.abs(diff) < SNAP_THRESHOLD) {
        virtualScrollPosition = Math.max(0, Math.min(targetScrollPosition, maxScroll));
        targetScrollPosition = virtualScrollPosition;
        smoothScrollId = null;
      } else {
        virtualScrollPosition += diff * LERP_FACTOR;
        virtualScrollPosition = Math.max(0, Math.min(virtualScrollPosition, maxScroll));
        smoothScrollId = requestAnimationFrame(smoothScrollTick);
      }

      engineState.prevScrollPosition = engineState.scrollPosition;
      engineState.scrollPosition = virtualScrollPosition;
      engineState.scrollDirection = virtualScrollPosition > engineState.prevScrollPosition ? 1 : -1;
      ctx.forceRender();
    };

    // Wheel handler
    wheelHandler = (e: WheelEvent): void => {
      e.preventDefault();
      const maxScroll = getMaxScroll();
      targetScrollPosition = Math.max(
        0,
        Math.min(
          targetScrollPosition + e.deltaY * compression.ratio * SCROLL_SPEED_MULTIPLIER,
          maxScroll,
        ),
      );
      if (smoothScrollId === null) {
        smoothScrollId = requestAnimationFrame(smoothScrollTick);
      }
    };
    viewport.addEventListener("wheel", wheelHandler, { passive: false });

    // Touch handlers
    const cancelMomentum = (): void => {
      if (momentumId !== null) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }
    };

    touchStartHandler = (e: TouchEvent): void => {
      cancelMomentum();
      if (smoothScrollId !== null) {
        cancelAnimationFrame(smoothScrollId);
        smoothScrollId = null;
      }
      const touch = e.touches[0];
      if (!touch) return;
      const y = isX ? touch.clientX : touch.clientY;
      touchStartPos = y;
      touchScrollStart = virtualScrollPosition;
      sampleCount = 1;
      sampleHead = 0;
      sampleTimes[0] = performance.now();
      samplePositions[0] = y;
    };

    touchMoveHandler = (e: TouchEvent): void => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const y = isX ? touch.clientX : touch.clientY;
      const now = performance.now();

      const slot = sampleCount < TOUCH_VELOCITY_SAMPLES ? sampleCount : sampleHead;
      sampleTimes[slot] = now;
      samplePositions[slot] = y;
      if (sampleCount < TOUCH_VELOCITY_SAMPLES) {
        sampleCount++;
      } else {
        sampleHead = (sampleHead + 1) % TOUCH_VELOCITY_SAMPLES;
      }

      const delta = touchStartPos - y;
      const maxScroll = getMaxScroll();
      const newPos = Math.max(
        0,
        Math.min(touchScrollStart + delta * compression.ratio * SCROLL_SPEED_MULTIPLIER, maxScroll),
      );

      virtualScrollPosition = newPos;
      targetScrollPosition = newPos;
      engineState.prevScrollPosition = engineState.scrollPosition;
      engineState.scrollPosition = newPos;
      engineState.scrollDirection = newPos > engineState.prevScrollPosition ? 1 : -1;
      ctx.forceRender();
    };

    touchEndHandler = (): void => {
      const now = performance.now();

      // Scan ring buffer for oldest/newest within velocity window (zero alloc)
      let oldestTime = Infinity, oldestPos = 0;
      let newestTime = -1, newestPos = 0;
      let recentCount = 0;

      for (let i = 0; i < sampleCount; i++) {
        const idx = (sampleHead + i) % TOUCH_VELOCITY_SAMPLES;
        const t = sampleTimes[idx]!;
        if (now - t >= TOUCH_VELOCITY_WINDOW) continue;
        recentCount++;
        const p = samplePositions[idx]!;
        if (t < oldestTime) { oldestTime = t; oldestPos = p; }
        if (t > newestTime) { newestTime = t; newestPos = p; }
      }

      let velocity = 0;
      if (recentCount >= 2) {
        const dt = newestTime - oldestTime;
        if (dt > 0) velocity = (oldestPos - newestPos) / dt;
      }
      sampleCount = 0;
      sampleHead = 0;

      if (Math.abs(velocity) < TOUCH_MIN_VELOCITY) return;

      let frameVelocity = velocity * 16;

      const momentumTick = (): void => {
        frameVelocity *= TOUCH_DECELERATION;
        if (Math.abs(frameVelocity) < 0.5) { momentumId = null; return; }

        const maxScroll = getMaxScroll();
        let newPos = virtualScrollPosition + frameVelocity;
        newPos = Math.max(0, Math.min(newPos, maxScroll));

        if ((newPos <= 0 && frameVelocity < 0) || (newPos >= maxScroll && frameVelocity > 0)) {
          virtualScrollPosition = newPos;
          targetScrollPosition = newPos;
          engineState.scrollPosition = newPos;
          ctx.forceRender();
          momentumId = null;
          return;
        }

        virtualScrollPosition = newPos;
        targetScrollPosition = newPos;
        engineState.prevScrollPosition = engineState.scrollPosition;
        engineState.scrollPosition = newPos;
        engineState.scrollDirection = newPos > engineState.prevScrollPosition ? 1 : -1;
        ctx.forceRender();
        momentumId = requestAnimationFrame(momentumTick);
      };

      momentumId = requestAnimationFrame(momentumTick);
    };

    viewport.addEventListener("touchstart", touchStartHandler, { passive: true });
    viewport.addEventListener("touchmove", touchMoveHandler, { passive: false });
    viewport.addEventListener("touchend", touchEndHandler, { passive: true });
    viewport.addEventListener("touchcancel", touchEndHandler, { passive: true });

    // Native scroll drift guard
    nativeScrollReset = (): void => {
      if ((viewport as any)[scrollProp] !== 0) {
        (viewport as any)[scrollProp] = 0;
      }
    };
    viewport.addEventListener("scroll", nativeScrollReset, { passive: true });

    // Scroll callback used by both existing scrollbar plugin and fallback
    const scrollbarCallback = (position: number): void => {
      virtualScrollPosition = position;
      targetScrollPosition = position;
      if (smoothScrollId !== null) {
        cancelAnimationFrame(smoothScrollId);
        smoothScrollId = null;
      }
      engineState.prevScrollPosition = engineState.scrollPosition;
      engineState.scrollPosition = position;
      engineState.scrollDirection = position > engineState.prevScrollPosition ? 1 : -1;
      ctx.forceRender();
    };

    // If scrollbar plugin exists, redirect its callback and use its instance.
    // Otherwise create a fallback scrollbar.
    const setCallback = ctx.getMethod("_scrollbar:setCallback") as ((cb: (pos: number) => void) => void) | undefined;
    const getInstance = ctx.getMethod("_scrollbar:getInstance") as (() => Scrollbar | null) | undefined;

    if (setCallback && getInstance) {
      setCallback(scrollbarCallback);
      const existing = getInstance();
      if (existing) {
        fallbackScrollbar = existing;
        ownsScrollbar = false;
        fallbackScrollbar.updateBounds(
          compression.virtualSize + slack,
          engineState.containerSize,
        );
      }
    } else if (!fallbackScrollbar) {
      const classPrefix = ctx.config.classPrefix;
      fallbackScrollbar = createScrollbar(
        viewport,
        scrollbarCallback,
        {},
        classPrefix,
        isX,
        ctx.dom.root,
      );
      ownsScrollbar = true;

      if (!viewport.classList.contains(`${classPrefix}-viewport--custom-scrollbar`)) {
        viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);
      }

      fallbackScrollbar.updateBounds(
        compression.virtualSize + slack,
        engineState.containerSize,
      );
    }
  }

  function deactivateCompression(ctx: PluginContext<T>): void {
    compressedActive = false;
    engineState.isCompressed = false;
    engineState.compressionRatio = 1;

    virtualScrollPosition = 0;
    targetScrollPosition = 0;
    sampleCount = 0;
    sampleHead = 0;

    cleanup();

    const overflowProp = isX ? "overflowX" : "overflow";
    (viewport.style as any)[overflowProp] = "auto";

    slack = 0;
    ctx.updateContentSize(sizeCache.getTotalSize());
  }

  function cleanup(): void {
    if (smoothScrollId !== null) { cancelAnimationFrame(smoothScrollId); smoothScrollId = null; }
    if (easedScrollId !== null) { cancelAnimationFrame(easedScrollId); easedScrollId = null; }
    if (momentumId !== null) { cancelAnimationFrame(momentumId); momentumId = null; }
    if (wheelHandler) { viewport.removeEventListener("wheel", wheelHandler); wheelHandler = null; }
    if (touchStartHandler) { viewport.removeEventListener("touchstart", touchStartHandler); touchStartHandler = null; }
    if (touchMoveHandler) { viewport.removeEventListener("touchmove", touchMoveHandler); touchMoveHandler = null; }
    if (touchEndHandler) {
      viewport.removeEventListener("touchend", touchEndHandler);
      viewport.removeEventListener("touchcancel", touchEndHandler);
      touchEndHandler = null;
    }
    if (nativeScrollReset) { viewport.removeEventListener("scroll", nativeScrollReset); nativeScrollReset = null; }
    if (fallbackScrollbar && ownsScrollbar) { fallbackScrollbar.destroy(); }
    fallbackScrollbar = null;
    ownsScrollbar = false;

    const scrollProp = isX ? "scrollLeft" : "scrollTop";
    if (viewport && (viewport as any)[scrollProp] !== 0) {
      (viewport as any)[scrollProp] = 0;
    }
  }

  return {
    name: "scale",
    priority: 20,

    setup(ctx: PluginContext<T>): void {
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;
      viewport = ctx.dom.viewport;
      isX = ctx.config.axis.primary === "x";
      overscan = ctx.config.overscan;

      storedCtx = ctx;

      ctx.registerMethod("_updateCompressionMode", () => updateCompression(ctx));
      ctx.registerMethod("_scale:getCompression", () => compression);
      ctx.registerMethod("_scale:easedScrollTo", (target: number, duration: number) => easedScrollTo(target, duration));

      // Register scroll get/set so scrollToIndex routes through us
      ctx.setScrollFns(
        () => virtualScrollPosition,
        (actualOffset: number) => {
          if (!compression.isCompressed || !compressedActive) {
            const prop = isX ? "scrollLeft" : "scrollTop";
            (viewport as any)[prop] = actualOffset;
            return;
          }
          cancelAnimations();
          if (momentumId !== null) { cancelAnimationFrame(momentumId); momentumId = null; }
          const virtualPos = actualOffset * compression.ratio;
          applyVirtualScroll(Math.max(0, Math.min(virtualPos, getMaxScroll())));
        },
      );

      ctx.setScrollToIndexFn((index, align, behavior, duration, easing): void | false => {
        if (!compression.isCompressed || !compressedActive) return false;
        const virtualPos = calculateCompressedScrollToIndex(
          index, sizeCache, engineState.containerSize, engineState.totalItems,
          compression, align as "start" | "center" | "end",
        );
        if (behavior === "smooth") {
          easedScrollTo(virtualPos, duration ?? SCROLL_DURATION, easing);
        } else {
          setVirtualPosition(virtualPos);
        }
      });

      // Initial compression check
      updateCompression(ctx);
      lastCheckedTotal = engineState.totalItems;

      ctx.registerDestroyHandler(cleanup);
    },

    hooks: {
      onCalculate(state: EngineState): void {
        // Re-check compression when item count changes (data mutation)
        if (state.totalItems !== lastCheckedTotal && storedCtx) {
          lastCheckedTotal = state.totalItems;
          updateCompression(storedCtx);
        }

        if (!compression.isCompressed || !compressedActive) return;

        // Override phase1's buffer contents with compressed positioning.
        // Phase1 ran with state.scrollPosition = virtualScrollPosition and
        // sizeCache in actual space, so its range calc may be off.
        // We recalculate using the compression-aware formula.

        const totalItems = state.totalItems;
        if (totalItems === 0 || state.containerSize <= 0) {
          state.visibleCount = 0;
          return;
        }

        // Calculate compressed visible range
        calculateCompressedVisibleRange(
          state.scrollPosition,
          state.containerSize,
          sizeCache,
          totalItems,
          compression,
          compRange,
        );

        // Apply overscan
        const renderStart = Math.max(0, compRange.start - overscan);
        const renderEnd = Math.min(totalItems - 1, compRange.end + overscan);

        // Fill buffers with compressed item positions
        const count = Math.min(renderEnd - renderStart + 1, state.capacity);
        state.visibleCount = count;
        state.startIndex = renderStart;

        for (let i = 0; i < count; i++) {
          const idx = renderStart + i;
          state.visibleIndices[i] = idx;
          state.visibleOffsets[i] = calculateCompressedItemPosition(
            idx,
            state.scrollPosition,
            sizeCache,
            totalItems,
            state.containerSize,
            compression,
          );
          state.visibleSizes[i] = sizeCache.getSize(idx);
        }


        state.prevRangeStart = renderStart;
        state.prevRangeEnd = renderEnd;
      },

      onAfterScroll(scrollPosition: number): void {
        if (fallbackScrollbar && compressedActive) {
          fallbackScrollbar.updatePosition(scrollPosition);
          fallbackScrollbar.show();
        }
      },

      onResize(): void {
        if (compressedActive) {
          slack = computeSlack();

          if (fallbackScrollbar) {
            fallbackScrollbar.updateBounds(
              compression.virtualSize + slack,
              engineState.containerSize,
            );
          }

          // Clamp virtual scroll to new bounds
          const maxScroll = getMaxScroll();
          if (virtualScrollPosition > maxScroll) {
            virtualScrollPosition = maxScroll;
            targetScrollPosition = maxScroll;
            engineState.scrollPosition = maxScroll;
          }
        }
      },
    },

    destroy(): void {
      cleanup();
    },
  };
}
