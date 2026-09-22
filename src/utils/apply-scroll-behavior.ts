/**
 * vlist/utils — Scroll behavior
 *
 * Core animates `{ behavior: "smooth" }` with `SCROLL_DURATION` when the
 * caller omits `duration`, and it forwards `easing`. Layout plugins that
 * replace `scrollToIndex` have to do the same, or a smooth call with no
 * duration jumps.
 */

import { SCROLL_DURATION } from "../constants";

type ScrollTarget = {
  to(position: number): void;
  smoothTo(target: number, duration: number, easing?: (t: number) => number): void;
};

export function applyScrollBehavior(
  scroll: ScrollTarget,
  position: number,
  behavior?: string,
  duration?: number,
  easing?: (t: number) => number,
): void {
  if (behavior === "smooth") {
    scroll.smoothTo(position, duration ?? SCROLL_DURATION, easing);
  } else {
    scroll.to(position);
  }
}
