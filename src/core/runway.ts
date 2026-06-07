/**
 * vlist — Bounded Logical Scroll Handler (RFC-012)
 *
 * An alternative to the native scroll handler ({@link createScrollHandler}) that
 * decouples the native scrollable size from the virtual content size.
 *
 * The content element is sized to a bounded *runway* (a multiple of the
 * viewport, capped at the real virtual size) instead of `totalItems × itemSize`.
 * This sidesteps the browser's ~16.7M px element-size limit without the scale
 * plugin's compression — no compression ratio leaks into offsets or hit-testing.
 *
 * Coordinates:
 *   logical = baseOffset + scrollTop        (absolute virtual pixel position)
 *
 *   - `state.scrollPosition` always holds the *logical* (absolute) position, so
 *     the render pipeline's `indexAtOffset(scrollPosition)` keeps working over
 *     the full size cache, and the public pixel-equivalent surface is unchanged.
 *   - `state.baseOffset` is the virtual offset that maps to native scrollTop=0.
 *     The pipeline renders each item at `getOffset(index) - baseOffset`, so items
 *     land inside the bounded runway. baseOffset is 0 for small lists (native).
 *
 * Rebasing: as native scrollTop approaches a runway edge we shift baseOffset and
 * scrollTop together by the same delta, preserving `logical`. The synthetic
 * scroll event this triggers reads the same logical position and is dropped by
 * the "logical unchanged" guard — no suppress flag needed. The repositioning of
 * items (their transforms depend on baseOffset) is committed by the explicit
 * render that the rebasing scroll frame performs.
 */

import type { EngineState } from "./state";
import {
  SCROLL_IDLE_TIMEOUT,
  WHEEL_SENSITIVITY,
  SCROLL_EASING,
  BOUNDED_RUNWAY_FACTOR,
  BOUNDED_REBASE_LOW,
  BOUNDED_REBASE_HIGH,
} from "../constants";
import type { ScrollHandler } from "./scroll";

export interface BoundedScrollHandler extends ScrollHandler {
  /** Move to an absolute logical (virtual pixel) position; renders + schedules idle. */
  setLogical(logicalPx: number): void;
  /** Current absolute logical position (== state.scrollPosition). */
  getLogical(): number;
  /** Maximum scrollable logical position (`virtualTotal - containerSize`, >= 0). */
  getMaxLogical(): number;
  /** Recompute runway/derived values and resize the content element. */
  refresh(totalSize: number): void;
}

/**
 * Infinite-loop (wrap) configuration for the bounded handler (carousel, RFC-011).
 *
 * In wrap mode the logical position is never clamped to a maximum: instead it is
 * periodically folded back toward {@link home} by whole laps once it drifts more
 * than {@link thresholdLaps} laps away. Because the consumer maps virtual indices
 * to real items via `index % realTotal`, shifting the logical position (and
 * baseOffset) by a whole lap leaves the rendered items and their on-screen
 * positions unchanged — the loop is seamless. The content element is sized to the
 * runway exactly as in non-wrap mode, so large item counts never blow the
 * browser's element-size limit.
 */
export interface WrapConfig {
  /** Current lap period in virtual px (`realTotal × stepSize`). */
  readonly lapSize: () => number;
  /** Logical position to fold back toward (e.g. the middle cycle). */
  readonly home: () => number;
  /** Fold the logical position back toward `home` once it drifts this many laps away. */
  readonly thresholdLaps: number;
}

export interface BoundedScrollConfig {
  readonly state: EngineState;
  readonly viewport: HTMLElement;
  readonly content: HTMLElement;
  readonly isX: boolean;
  readonly wheelEnabled: boolean;
  readonly idleTimeout: number;
  readonly scrollTarget?: EventTarget;
  /** Main-axis padding folded into the virtual total (matches native content sizing). */
  readonly mainAxisPadding: number;
  /** Runway size as a multiple of the viewport (defaults to BOUNDED_RUNWAY_FACTOR). */
  readonly runwayFactor?: number;
  /** Infinite-loop config (carousel). When set, the logical position wraps by
   *  whole laps toward `home` instead of clamping to a maximum. */
  readonly wrap?: WrapConfig;
  /** Called synchronously per frame — triggers the 2-phase pipeline. */
  readonly onFrame: () => void;
  /** Called when scrolling becomes idle. */
  readonly onIdle: () => void;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

export function createBoundedScrollHandler(config: BoundedScrollConfig): BoundedScrollHandler {
  const { state, viewport, content, isX, wheelEnabled, onFrame, onIdle, mainAxisPadding } = config;
  const idleTimeout = config.idleTimeout || SCROLL_IDLE_TIMEOUT;
  const runwayFactor = config.runwayFactor ?? BOUNDED_RUNWAY_FACTOR;
  const wrap = config.wrap ?? null;
  const isWrap = wrap !== null;
  const target: EventTarget = config.scrollTarget ?? viewport;

  // ── Derived runway geometry (recomputed by refresh) ──────────────
  let maxScrollTop = 0;
  let maxLogical = 0;
  let maxBaseOffset = 0;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let animationId: number | null = null;

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
    const low = maxScrollTop * BOUNDED_REBASE_LOW;
    const high = maxScrollTop * BOUNDED_REBASE_HIGH;
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
  function wrapRebase(): void {
    const lap = wrap!.lapSize();
    if (lap <= 0) return;
    const drift = state.scrollPosition - wrap!.home();
    const laps = Math.trunc(drift / lap);
    if (Math.abs(laps) < wrap!.thresholdLaps) return;
    const shift = laps * lap;
    state.scrollPosition -= shift;
    state.prevScrollPosition -= shift;
    state.baseOffset -= shift;
  }

  // ── Wheel (synchronous; driven entirely in logical space) ────────
  function onWheelEvent(event: WheelEvent): void {
    let delta: number;
    if (isX) {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        // Horizontal trackpad swipe on a horizontal list. In wrap mode
        // (carousel) we must intercept — native scroll is limited by the
        // bounded runway and can't keep up with fast swipes.
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
    setLogical(next);
    if (isWrap) wrapRebase();
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
    const from = state.scrollPosition;
    const getTarget = typeof targetOrFn === "function" ? targetOrFn : (): number => targetOrFn;
    let dest = getTarget();

    if (Math.abs(dest - from) < 1) {
      setLogical(dest);
      onComplete?.();
      return;
    }

    const start = performance.now();
    function tick(now: number): void {
      dest = getTarget();
      const t = Math.min((now - start) / duration, 1);
      applySplit(from + (dest - from) * easing(t));
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
