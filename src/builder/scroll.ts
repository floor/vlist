// src/builder/scroll.ts
/**
 * vlist/builder — Scroll Utilities
 * Easing function and scroll-argument resolution for smooth scrolling.
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
