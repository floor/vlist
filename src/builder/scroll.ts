// src/builder/scroll.ts
/**
 * vlist/builder — Scroll Utilities
 * Easing, scroll-argument resolution, and smooth scroll animation.
 *
 * Shared by builder/core.ts, grid feature, and groups feature to
 * avoid duplicating ~70 lines of scroll helpers in each consumer.
 */

import type { ScrollToOptions } from "../types";

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_SMOOTH_DURATION = 300;

// =============================================================================
// Easing
// =============================================================================

export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// =============================================================================
// Argument Resolution
// =============================================================================

export const resolveScrollArgs = (
  alignOrOptions?:
    | "start"
    | "center"
    | "end"
    | ScrollToOptions,
): {
  align: "start" | "center" | "end";
  behavior: "auto" | "smooth";
  duration: number;
} => {
  if (typeof alignOrOptions === "string")
    return {
      align: alignOrOptions,
      behavior: "auto",
      duration: DEFAULT_SMOOTH_DURATION,
    };
  if (alignOrOptions && typeof alignOrOptions === "object")
    return {
      align: alignOrOptions.align ?? "start",
      behavior: alignOrOptions.behavior ?? "auto",
      duration: alignOrOptions.duration ?? DEFAULT_SMOOTH_DURATION,
    };
  return {
    align: "start",
    behavior: "auto",
    duration: DEFAULT_SMOOTH_DURATION,
  };
};

// =============================================================================
// Smooth Scroll Animation
// =============================================================================

/** Scroll controller interface — minimal surface needed by the animation. */
export interface ScrollController {
  scrollTo: (position: number) => void;
  getScrollTop: () => number;
}

/**
 * Create a smooth scroll animator with its own animation state.
 *
 * Each call returns an independent { animateScroll, cancelScroll } pair
 * with a private animationFrameId — multiple consumers won't stomp each
 * other's animations.
 *
 * @param scrollController - Object with scrollTo() method
 * @param renderFn - Called after each scroll step to update the viewport
 */
export const createSmoothScroll = (
  scrollController: ScrollController,
  renderFn: () => void,
): {
  animateScroll: (from: number, to: number, duration: number) => void;
  cancelScroll: () => void;
} => {
  let animationId: number | null = null;

  const cancelScroll = (): void => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  };

  const animateScroll = (from: number, to: number, duration: number): void => {
    cancelScroll();
    if (Math.abs(to - from) < 1) {
      scrollController.scrollTo(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      scrollController.scrollTo(newPos);
      renderFn();
      if (t < 1) {
        animationId = requestAnimationFrame(tick);
      } else {
        animationId = null;
      }
    };
    animationId = requestAnimationFrame(tick);
  };

  return { animateScroll, cancelScroll };
};
