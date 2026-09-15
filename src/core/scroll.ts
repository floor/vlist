/**
 * vlist v2 — Scroll Handling
 *
 * Wheel interception for synchronous rendering, scroll idle detection,
 * and smooth scroll animation.
 */

import { createScrollSource } from "./scroll-source";
import type { EngineState } from "./state";
import { WHEEL_SENSITIVITY } from "../constants";

// =============================================================================
// Scroll Handler — wires scroll/wheel events to the pipeline
// =============================================================================

export interface ScrollHandler {
  /** Attach scroll and wheel listeners */
  attach(): void;
  /** Detach all listeners */
  detach(): void;
  /** Cancel smooth scroll animation */
  cancelScroll(): void;
  /** Animate to a target scroll position (target may be a function for dynamic tracking) */
  smoothScrollTo(target: number | (() => number), duration: number, setFn?: (pos: number) => void, easing?: (t: number) => number, onComplete?: () => void): void;
}

export interface ScrollHandlerConfig {
  readonly state: EngineState;
  readonly viewport: HTMLElement;
  readonly isX: boolean;
  readonly wheelEnabled: boolean;
  readonly idleTimeout: number;
  /** Override the event target for scroll/wheel listeners (default: viewport) */
  readonly scrollTarget?: EventTarget;
  /** Called synchronously on scroll — triggers the 2-phase pipeline */
  readonly onFrame: () => void;
  /** Called when scrolling becomes idle */
  readonly onIdle: () => void;
}

export function createScrollHandler(config: ScrollHandlerConfig): ScrollHandler & { commitScroll(pos?: number): void } {
  const { state, viewport, isX, wheelEnabled } = config;
  const target: EventTarget = config.scrollTarget ?? viewport;

  const source = createScrollSource(config);
  const commitScroll = source.commitScroll;

  // ── Scroll event (passive, for native/touch scrolling) ──────────

  // Explicit writes also commit subpixel changes; DOM events keep the dedupe guard.
  function onScrollEvent(): void {
    const pos = isX ? viewport.scrollLeft : viewport.scrollTop;
    if (Math.abs(pos - state.scrollPosition) < 0.5) return;

    commitScroll(pos);
  }

  // ── Wheel event (non-passive, synchronous rendering) ────────────

  function onWheelEvent(event: WheelEvent): void {
    let next: number;

    if (isX) {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      const current = viewport.scrollLeft;
      const max = viewport.scrollWidth - viewport.clientWidth;
      next = Math.max(0, Math.min(current + event.deltaY * WHEEL_SENSITIVITY, max));
      if (Math.abs(next - current) < 1) return;

      event.preventDefault();
      viewport.scrollLeft = next;
    } else {
      const crossOverflow = viewport.scrollWidth > viewport.clientWidth;
      if (crossOverflow && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      if (crossOverflow && event.deltaX !== 0) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaX;
      }

      const current = viewport.scrollTop;
      const max = viewport.scrollHeight - viewport.clientHeight;
      next = Math.max(0, Math.min(current + event.deltaY * WHEEL_SENSITIVITY, max));
      if (Math.abs(next - current) < 1) return;

      event.preventDefault();
      viewport.scrollTop = next;
    }

    commitScroll(next);
  }

  // ── Public interface ────────────────────────────────────────────

  return {
    ...source,
    attach(): void {
      target.addEventListener("scroll", onScrollEvent as EventListener, { passive: true });
      if (wheelEnabled) {
        target.addEventListener("wheel", onWheelEvent as EventListener, { passive: false });
      }
    },

    detach(): void {
      target.removeEventListener("scroll", onScrollEvent as EventListener);
      if (wheelEnabled) {
        target.removeEventListener("wheel", onWheelEvent as EventListener);
      }
      source.detach();
    },

  };
}
