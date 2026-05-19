// src/builder/scroll.ts
/**
 * vlist/builder — Scroll Utilities
 * Easing, scroll-argument resolution, and smooth scroll animation.
 */

import type { ScrollToOptions } from "../types";

// =============================================================================
// Easing
// =============================================================================

export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// =============================================================================
// Argument Resolution
// =============================================================================

export const resolveScrollArgs = (
  o?: "start" | "center" | "end" | ScrollToOptions,
): { align: "start" | "center" | "end"; behavior: "auto" | "smooth"; duration: number } => {
  const obj = typeof o === "object" && o ? o : null;
  return {
    align: typeof o === "string" ? o : obj?.align ?? "start",
    behavior: obj?.behavior ?? "auto",
    duration: obj?.duration ?? 300,
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
