/** Shared scroll commits and animation for native and external sources. */
import { SCROLL_IDLE_TIMEOUT, SCROLL_EASING } from "../constants";
import type { ScrollHandler, ScrollHandlerConfig } from "./scroll";

export function createScrollSource(config: ScrollHandlerConfig): ScrollHandler & { commitScroll(pos?: number): void } {
  const { state, viewport, isX, onFrame, onIdle } = config;
  const idleTimeout = config.idleTimeout || SCROLL_IDLE_TIMEOUT;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let animationId: number | null = null;

  function commitScroll(pos = isX ? viewport.scrollLeft : viewport.scrollTop): void {
    state.prevScrollPosition = state.scrollPosition;
    state.scrollPosition = pos;
    state.scrollDirection = pos > state.prevScrollPosition ? 1 : pos < state.prevScrollPosition ? -1 : 0;

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

  function smoothScrollTo(
    targetOrFn: number | (() => number),
    duration: number,
    setFn?: (pos: number) => void,
    easing: (t: number) => number = SCROLL_EASING,
    onComplete?: () => void,
  ): void {
    cancelScroll();
    const from = state.scrollPosition;
    const getTarget = typeof targetOrFn === "function" ? targetOrFn : (): number => targetOrFn;
    let target = getTarget();

    if (Math.abs(target - from) < 1) {
      if (setFn) setFn(target);
      else if (isX) viewport.scrollLeft = target;
      else viewport.scrollTop = target;
      onComplete?.();
      return;
    }

    const start = performance.now();
    function tick(now: number): void {
      target = getTarget();
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const pos = from + (target - from) * easing(t);
      if (setFn) setFn(pos);
      else if (isX) viewport.scrollLeft = pos;
      else viewport.scrollTop = pos;
      if (!setFn) commitScroll(pos);
      if (t < 1) {
        animationId = requestAnimationFrame(tick);
      } else {
        animationId = null;
        onComplete?.();
      }
    }
    animationId = requestAnimationFrame(tick);
  }

  // ── Public interface ────────────────────────────────────────────

  return {
    attach(): void {},
    detach(): void {
      cancelScroll();
      if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
    },

    cancelScroll,
    smoothScrollTo,
    commitScroll,
  };
}
