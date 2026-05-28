/**
 * vlist v2 — Scroll Handling
 *
 * Wheel interception for synchronous rendering, scroll idle detection,
 * and smooth scroll animation.
 */

import type { EngineState } from "./state";
import { SCROLL_IDLE_TIMEOUT, WHEEL_SENSITIVITY, SCROLL_EASING } from "../constants";

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
  /** Animate to a target scroll position */
  smoothScrollTo(target: number, duration: number, setFn?: (pos: number) => void, easing?: (t: number) => number): void;
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

export function createScrollHandler(config: ScrollHandlerConfig): ScrollHandler {
  const { state, viewport, isX, wheelEnabled, onFrame, onIdle } = config;
  const idleTimeout = config.idleTimeout || SCROLL_IDLE_TIMEOUT;
  const target: EventTarget = config.scrollTarget ?? viewport;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let animationId: number | null = null;

  // ── Scroll event (passive, for native/touch scrolling) ──────────

  function onScrollEvent(): void {
    const pos = isX ? viewport.scrollLeft : viewport.scrollTop;
    if (Math.abs(pos - state.scrollPosition) < 0.5) return;

    state.prevScrollPosition = state.scrollPosition;
    state.scrollPosition = pos;
    state.scrollDirection = pos > state.prevScrollPosition ? 1 : pos < state.prevScrollPosition ? -1 : 0;

    onFrame();
    scheduleIdle();
  }

  // ── Wheel event (non-passive, synchronous rendering) ────────────

  function onWheelEvent(event: WheelEvent): void {
    if (state.isCompressed) return;

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

    state.prevScrollPosition = state.scrollPosition;
    state.scrollPosition = next;
    state.scrollDirection = next > state.prevScrollPosition ? 1 : -1;

    onFrame();
    scheduleIdle();
  }

  // ── Idle detection ──────────────────────────────────────────────

  function scheduleIdle(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      state.scrollDirection = 0;
      onIdle();
    }, idleTimeout);
  }

  // ── Smooth scroll animation ─────────────────────────────────────

  function cancelScroll(): void {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function smoothScrollTo(target: number, duration: number, setFn?: (pos: number) => void, easing: (t: number) => number = SCROLL_EASING): void {
    cancelScroll();
    const from = state.scrollPosition;
    if (Math.abs(target - from) < 1) {
      if (setFn) setFn(target);
      else if (isX) viewport.scrollLeft = target;
      else viewport.scrollTop = target;
      return;
    }

    const start = performance.now();
    function tick(now: number): void {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const pos = from + (target - from) * easing(t);
      if (setFn) setFn(pos);
      else if (isX) viewport.scrollLeft = pos;
      else viewport.scrollTop = pos;
      if (!setFn) state.scrollPosition = pos;
      onFrame();
      if (t < 1) {
        animationId = requestAnimationFrame(tick);
      } else {
        animationId = null;
      }
    }
    animationId = requestAnimationFrame(tick);
  }

  // ── Public interface ────────────────────────────────────────────

  return {
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
      cancelScroll();
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    },

    cancelScroll,
    smoothScrollTo,
  };
}
