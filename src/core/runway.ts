/**
 * vlist — carousel runway (RFC-011, RFC-012)
 *
 * The carousel's infinite loop scrolls a native element that is only a few
 * viewports long: the *runway*. The logical position is `baseOffset +
 * scrollTop`; as scrollTop nears an edge of the runway, baseOffset and
 * scrollTop shift together by the same delta, so the logical position and
 * what is on screen stay put. The scroll event that shift triggers reads the
 * same logical position and is dropped by the "logical unchanged" guard. In
 * wrap mode the position also folds back by whole laps toward home.
 *
 * Engine code (it owns the scroll coordinates), but only `carousel()` imports
 * it: a list without it never bundles it.
 */

import type { LogicalScrollConfig, LogicalScrollHandler } from "./logical";
import { applyWrapFold, wrapLaps } from "./fold";
import { SCROLL_IDLE_TIMEOUT, WHEEL_SENSITIVITY, SCROLL_EASING } from "../constants";

/**
 * Runway size as a multiple of the viewport: the content element is
 * `containerSize × this` (capped at the total size), which gives the native
 * scrollbar room to move before a rebase shifts the logical origin.
 */
export const RUNWAY_FACTOR = 2;

/** Rebase back when scrollTop drops below this fraction of the runway (away from the logical start). */
export const RUNWAY_REBASE_LOW = 0.25;

/** Rebase forward when scrollTop rises above this fraction of the runway (away from the logical end). */
export const RUNWAY_REBASE_HIGH = 0.75;

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

export function createRunwayHandler(config: LogicalScrollConfig): LogicalScrollHandler {
  const { state, viewport, content, isX, wheelEnabled, onFrame, onIdle, mainAxisPadding } = config;
  const idleTimeout = config.idleTimeout || SCROLL_IDLE_TIMEOUT;
  const runwayFactor = config.runwayFactor ?? RUNWAY_FACTOR;
  const wrap = config.wrap ?? null;
  const isWrap = wrap !== null;
  const target: EventTarget = config.scrollTarget ?? viewport;

  // ── Derived runway geometry (recomputed by refresh) ──────────────
  let maxScrollTop = 0;
  let maxLogical = 0;
  let maxBaseOffset = 0;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let animationId: number | null = null;
  // Fold-along origin for an in-flight smooth scroll. wrapRebase shifts these
  // by the same delta as scrollPosition so a snap that crosses a lap does not
  // jump by a whole lap on the next tick (from/dest would otherwise stay in
  // the pre-fold coordinate space).
  let animFrom = 0;
  let animShift = 0;

  function getScrollTop(): number {
    return isX ? viewport.scrollLeft : viewport.scrollTop;
  }
  function setScrollTop(px: number): void {
    if (isX) viewport.scrollLeft = px;
    else viewport.scrollTop = px;
  }

  // ── Logical ↔ (baseOffset, scrollTop) split ──────────────────────
  // Position scrollTop near the runway centre so there is room to rebase in
  // either direction. At the extremes the clamps land scrollTop exactly on 0 or
  // maxScrollTop, so the logical start/end are reachable precisely.
  function applySplit(logicalPx: number): void {
    // Wrap mode never clamps the logical position (the loop is infinite) and
    // pins scrollTop to the runway centre, driving all motion through baseOffset.
    const clamped = isWrap ? logicalPx : clamp(logicalPx, 0, maxLogical);
    state.prevScrollPosition = state.scrollPosition;
    state.scrollPosition = clamped;
    state.scrollDirection = clamped > state.prevScrollPosition ? 1 : clamped < state.prevScrollPosition ? -1 : 0;

    const centre = maxScrollTop / 2;
    if (isWrap) {
      state.baseOffset = clamped - centre;
      setScrollTop(centre);
      wrapRebase();
      return;
    }
    const base = clamp(clamped - centre, 0, maxBaseOffset);
    state.baseOffset = base;
    setScrollTop(clamp(clamped - base, 0, maxScrollTop));
  }

  function setLogical(logicalPx: number): void {
    applySplit(logicalPx);
    onFrame();
    scheduleIdle();
  }

  // ── Native scroll (scrollbar drag, touch, trackpad momentum) ─────
  function onScrollEvent(): void {
    const top = getScrollTop();
    const logical = state.baseOffset + top;
    if (Math.abs(logical - state.scrollPosition) < 0.5) return; // catches synthetic rebase/setLogical events

    state.prevScrollPosition = state.scrollPosition;
    state.scrollPosition = logical;
    state.scrollDirection = logical > state.prevScrollPosition ? 1 : logical < state.prevScrollPosition ? -1 : 0;

    maybeRebase(top);
    if (isWrap) wrapRebase();
    onFrame();
    scheduleIdle();
  }

  // Shift baseOffset + scrollTop by the same delta (logical preserved) so the
  // native scrollbar moves back toward the runway centre, leaving headroom.
  function maybeRebase(top: number): void {
    const low = maxScrollTop * RUNWAY_REBASE_LOW;
    const high = maxScrollTop * RUNWAY_REBASE_HIGH;
    const centre = maxScrollTop / 2;

    if (isWrap) {
      // No virtual cap in wrap mode: recenter scrollTop whenever it leaves the
      // central band, absorbing the delta into baseOffset (logical unchanged).
      if (top >= low && top <= high) return;
      state.baseOffset = state.scrollPosition - centre;
      setScrollTop(centre);
      return;
    }

    if (maxBaseOffset <= 0) return;
    const base = state.baseOffset;
    const needsDown = top < low && base > 0;
    const needsUp = top > high && base < maxBaseOffset;
    if (!needsDown && !needsUp) return;

    const logical = state.scrollPosition;
    const newBase = clamp(logical - centre, 0, maxBaseOffset);
    if (newBase === base) return;
    state.baseOffset = newBase;
    setScrollTop(clamp(logical - newBase, 0, maxScrollTop));
  }

  // Fold the logical position back toward `home` by whole laps once it drifts
  // beyond the threshold. Shifting scrollPosition + baseOffset by the same whole
  // number of laps leaves scrollTop (and therefore every on-screen position)
  // untouched — the modulo index mapping resolves the shifted window to the same
  // real items, so the loop is seamless and the render window stays bounded.
  // applyWrapFold re-keys the mounted map by the same lap shift so phase 2
  // finds those nodes instead of releasing and re-creating the viewport.
  function wrapRebase(): void {
    const lap = wrap!.lapSize();
    if (lap <= 0) return;
    const drift = state.scrollPosition - wrap!.home();
    const laps = wrapLaps(drift / lap, wrap!.thresholdLaps);
    if (laps === 0) return;
    const shift = laps * lap;
    state.scrollPosition -= shift;
    state.prevScrollPosition -= shift;
    state.baseOffset -= shift;
    animFrom -= shift;
    animShift -= shift;
    applyWrapFold(wrap!, shift, state, content, config.rendered, config.classPrefix ?? "", config.oddClass);
    config.onFold?.(shift);
    wrap!.onFold?.(shift);
  }

  // ── Wheel (synchronous; driven entirely in logical space) ────────
  function onWheelEvent(event: WheelEvent): void {
    let delta: number;
    if (isX) {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        // Horizontal trackpad swipe on a horizontal list. In wrap mode
        // (carousel) we must intercept — native scroll is limited by the
        // runway's length and can't keep up with fast swipes.
        if (!isWrap) return;
        delta = event.deltaX;
      } else {
        delta = event.deltaY;
      }
    } else {
      const crossOverflow = viewport.scrollWidth > viewport.clientWidth;
      if (crossOverflow && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (crossOverflow && event.deltaX !== 0) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaX;
      }
      delta = event.deltaY;
    }

    const current = state.scrollPosition;
    const raw = current + delta * WHEEL_SENSITIVITY;
    const next = isWrap ? raw : clamp(raw, 0, maxLogical);
    if (Math.abs(next - current) < 1) return;

    event.preventDefault();
    applySplit(next);
    if (isWrap) wrapRebase();
    onFrame();
    scheduleIdle();
  }

  // ── Idle detection ───────────────────────────────────────────────
  function scheduleIdle(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      state.scrollDirection = 0;
      onIdle();
    }, idleTimeout);
  }

  // ── Smooth scroll (animates in logical space via setLogical) ─────
  function cancelScroll(): void {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function smoothScrollTo(
    targetOrFn: number | (() => number),
    duration: number,
    _setFn?: (pos: number) => void,
    easing: (t: number) => number = SCROLL_EASING,
    onComplete?: () => void,
  ): void {
    cancelScroll();
    animFrom = state.scrollPosition;
    animShift = 0;
    const getTarget = typeof targetOrFn === "function" ? targetOrFn : (): number => targetOrFn;
    let dest = getTarget();

    if (Math.abs(dest - animFrom) < 1) {
      setLogical(dest);
      onComplete?.();
      return;
    }

    const start = performance.now();
    function tick(now: number): void {
      dest = getTarget() + animShift;
      const t = Math.min((now - start) / duration, 1);
      applySplit(animFrom + (dest - animFrom) * easing(t));
      onFrame();
      if (t < 1) {
        animationId = requestAnimationFrame(tick);
      } else {
        animationId = null;
        scheduleIdle();
        onComplete?.();
      }
    }
    animationId = requestAnimationFrame(tick);
  }

  // ── Runway sizing ────────────────────────────────────────────────
  function refresh(totalSize: number): void {
    const cs = state.containerSize;
    const virtualTotal = totalSize + mainAxisPadding;
    const cap = cs * runwayFactor;
    // Wrap mode always uses the full runway (the loop is infinite, so there is no
    // virtual total to degenerate toward). Non-wrap caps the runway at the real
    // virtual size so short lists size their content natively.
    const contentSize = isWrap ? cap : Math.min(virtualTotal, cap);

    maxScrollTop = Math.max(0, contentSize - cs);
    maxLogical = Math.max(0, virtualTotal - cs);
    maxBaseOffset = Math.max(0, virtualTotal - contentSize);

    state.totalSize = totalSize;
    content.style[isX ? "width" : "height"] = contentSize + "px";

    // Re-derive base/top for the (possibly newly clamped) logical position.
    // No onFrame here — callers (syncContentSize → doForceRender) render next.
    applySplit(state.scrollPosition);
  }

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
    setLogical,
    getLogical(): number { return state.scrollPosition; },
    getMaxLogical(): number { return maxLogical; },
    refresh,
  };
}
