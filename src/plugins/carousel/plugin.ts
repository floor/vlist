/**
 * vlist v2 — Carousel Plugin (RFC-011)
 *
 * Infinite-loop scrolling with snap-to-item, focal scaling, and peek.
 * Uses a finite virtual scroll window with silent rebasing — the scroll
 * position wraps seamlessly without rewinding through the entire list.
 *
 * Priority 10 — layout tier (replaces scroll contract).
 *
 * Implementation: the content size is `lapSize * CYCLES`. Items are
 * mapped via modulo so virtual index 17 with 5 real items → item 2.
 * The scroll starts in the middle cycle. When approaching the edges,
 * the position is silently rebased to the middle cycle.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";
import { SCROLL_EASING, SCROLL_DURATION } from "../../constants";

// =============================================================================
// Config
// =============================================================================

export type CarouselVariant = "full" | "hero" | "multi" | "free";
export type CarouselDirection = "auto" | "forward" | "backward";

export interface CarouselPluginConfig {
  variant?: CarouselVariant;
  snap?: boolean;
  snapDuration?: number;
  peek?: number | string | "auto";
  focalScale?: number;
  focalOpacity?: number;
  visibleCount?: number;
  focalAlign?: "center" | "start";
  initialIndex?: number;
}

export interface CarouselState {
  index: number;
  progress: number;
  offset: number;
  scrollPosition: number;
}

// =============================================================================
// Constants
// =============================================================================

const CYCLES = 101;
const MIDDLE_CYCLE = 50;
const REBASE_THRESHOLD = 10;

// =============================================================================
// Factory
// =============================================================================

export function carousel<T extends VListItem = VListItem>(
  config?: CarouselPluginConfig,
): VListPlugin<T> {
  const variant: CarouselVariant = config?.variant ?? "full";
  const snapEnabled = config?.snap ?? (variant !== "free");
  const snapDuration = config?.snapDuration ?? 400;
  const initialIndex = config?.initialIndex ?? 0;

  let engineState: EngineState;
  let sizeCache: SizeCache;
  let storedCtx: PluginContext<T> | null = null;
  let viewport: HTMLElement;
  let isX: boolean;

  let currentIndex = initialIndex;
  let realTotal = 0;
  let itemSize = 0;
  let lapSize = 0;
  let virtualTotal = 0;

  // Smooth scroll state
  let animId: number | null = null;

  function resolveIndex(index: number): number {
    if (realTotal <= 0) return 0;
    return ((index % realTotal) + realTotal) % realTotal;
  }

  function shortestPath(from: number, to: number, direction: CarouselDirection): number {
    if (realTotal <= 1) return 0;
    const forward = ((to - from) % realTotal + realTotal) % realTotal;
    const backward = realTotal - forward;

    if (direction === "forward") return forward;
    if (direction === "backward") return -backward;
    return forward <= backward ? forward : -backward;
  }

  function virtualIndexOf(logicalIndex: number): number {
    return MIDDLE_CYCLE * realTotal + logicalIndex;
  }

  function logicalIndexOf(virtualIndex: number): number {
    if (realTotal <= 0) return 0;
    return ((virtualIndex % realTotal) + realTotal) % realTotal;
  }

  function currentVirtualIndex(): number {
    return virtualIndexOf(currentIndex);
  }

  function scrollPositionForVirtual(vi: number): number {
    return vi * itemSize;
  }

  function virtualIndexAtScroll(pos: number): number {
    if (itemSize <= 0) return 0;
    return Math.round(pos / itemSize);
  }

  function rebaseIfNeeded(): void {
    if (realTotal <= 0 || !storedCtx) return;
    const pos = engineState.scrollPosition;
    const currentVi = virtualIndexAtScroll(pos);
    const cycle = Math.floor(currentVi / realTotal);

    if (cycle < REBASE_THRESHOLD || cycle >= CYCLES - REBASE_THRESHOLD) {
      const logical = logicalIndexOf(currentVi);
      const targetVi = virtualIndexOf(logical);
      const offset = pos - currentVi * itemSize;
      const newPos = targetVi * itemSize + offset;

      engineState.scrollPosition = newPos;
      engineState.prevScrollPosition = newPos;
      const prop = isX ? "scrollLeft" : "scrollTop";
      (viewport as any)[prop] = newPos;
    }
  }

  function cancelAnim(): void {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function smoothScrollTo(target: number, duration: number): void {
    cancelAnim();
    if (!storedCtx) return;
    const from = engineState.scrollPosition;
    if (Math.abs(target - from) < 1) {
      storedCtx.scrollTo(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      storedCtx!.scrollTo(from + (target - from) * eased);
      if (t < 1) animId = requestAnimationFrame(tick);
      else { animId = null; rebaseIfNeeded(); }
    };
    animId = requestAnimationFrame(tick);
  }

  function navigateTo(logicalTarget: number, smooth: boolean, duration: number): void {
    if (!storedCtx) return;
    currentIndex = logicalTarget;

    if (realTotal <= 1) return;

    const targetVi = virtualIndexOf(logicalTarget);
    const targetPos = scrollPositionForVirtual(targetVi);

    // Find the nearest virtual position (could be in a different cycle)
    const currentPos = engineState.scrollPosition;
    const currentVi = virtualIndexAtScroll(currentPos);
    const currentLogical = logicalIndexOf(currentVi);

    // Calculate steps in item space — choose shortest path
    const forward = ((logicalTarget - currentLogical) % realTotal + realTotal) % realTotal;
    const backward = realTotal - forward;
    const delta = forward <= backward ? forward : -backward;
    const nearestTargetVi = currentVi + delta;
    const nearestPos = scrollPositionForVirtual(nearestTargetVi);

    if (smooth) {
      smoothScrollTo(nearestPos, duration);
    } else {
      storedCtx.scrollTo(nearestPos);
      rebaseIfNeeded();
    }
  }

  return {
    name: "carousel",
    priority: 10,
    conflicts: ["scale"],

    setup(ctx: PluginContext<T>): void {
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;
      storedCtx = ctx;
      viewport = ctx.dom.viewport;
      isX = ctx.config.axis.primary === "x";
      realTotal = engineState.totalItems;
      itemSize = realTotal > 0 ? sizeCache.getSize(0) : 0;
      lapSize = sizeCache.getTotalSize();
      virtualTotal = realTotal * CYCLES;
      currentIndex = resolveIndex(initialIndex);

      // ── Virtual scroll window ─────────────────────────────────────

      if (realTotal > 1) {
        ctx.setVirtualTotalFn(() => virtualTotal);
        ctx.setGetItemFn((i: number): T | undefined => {
          const logical = logicalIndexOf(i);
          return ctx.getItems()[logical];
        });

        // Start in the middle cycle
        const startPos = scrollPositionForVirtual(virtualIndexOf(currentIndex));
        engineState.scrollPosition = startPos;
        engineState.prevScrollPosition = startPos;

        // Set content size for the virtual window
        ctx.updateContentSize(virtualTotal * itemSize);

        // Set initial scroll position after render
        setTimeout(() => {
          if (!storedCtx) return;
          const prop = isX ? "scrollLeft" : "scrollTop";
          (viewport as any)[prop] = startPos;
        }, 0);
      }

      // ── Snap on idle ──────────────────────────────────────────────

      // (snap logic will be handled via hooks)

      // ── next / prev / goTo ──────────────────────────────────────

      ctx.registerMethod("next", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const target = resolveIndex(currentIndex + s);
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        // Navigate forward by delta — don't use shortest path, always go forward
        cancelAnim();
        currentIndex = target;
        const currentPos = engineState.scrollPosition;
        const nearestPos = currentPos + s * itemSize;

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scrollTo(nearestPos);
          rebaseIfNeeded();
        }
      });

      ctx.registerMethod("prev", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const target = resolveIndex(currentIndex - s);
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        cancelAnim();
        currentIndex = target;
        const currentPos = engineState.scrollPosition;
        const nearestPos = currentPos - s * itemSize;

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scrollTo(nearestPos);
          rebaseIfNeeded();
        }
      });

      ctx.registerMethod("goTo", (index: number, options?: {
        direction?: CarouselDirection;
        behavior?: string;
        duration?: number;
      }): void => {
        if (realTotal <= 0) return;
        const target = resolveIndex(index);
        const direction = options?.direction ?? "auto";
        const smooth = options?.behavior === "smooth";
        const dur = options?.duration ?? snapDuration;

        if (realTotal <= 1) {
          currentIndex = target;
          return;
        }

        cancelAnim();

        if (direction === "forward" || direction === "backward") {
          const currentPos = engineState.scrollPosition;
          const delta = shortestPath(currentIndex, target,
            direction === "forward" ? "forward" : "backward");
          currentIndex = target;
          const nearestPos = currentPos + delta * itemSize;

          if (smooth) {
            smoothScrollTo(nearestPos, dur);
          } else {
            storedCtx!.scrollTo(nearestPos);
            rebaseIfNeeded();
          }
        } else {
          currentIndex = target;
          navigateTo(target, smooth, dur);
        }
      });

      // ── getCarouselState ────────────────────────────────────────

      ctx.registerMethod("getCarouselState", (): CarouselState => {
        const pos = engineState.scrollPosition;
        const normalizedPos = realTotal > 0 && lapSize > 0
          ? ((pos % lapSize) + lapSize) % lapSize
          : 0;

        return {
          index: currentIndex,
          progress: 0,
          offset: 0,
          scrollPosition: normalizedPos,
        };
      });

      // ── Override scrollToIndex for wrap ──────────────────────────

      ctx.setScrollToIndexFn((index, align, behavior, duration, _easing): void | false => {
        if (realTotal <= 1) return false;
        const target = resolveIndex(index);
        const smooth = behavior === "smooth";
        const dur = duration ?? snapDuration;
        navigateTo(target, smooth, dur);
      });

      // ── Destroy handler ─────────────────────────────────────────

      ctx.registerDestroyHandler(() => {
        cancelAnim();
      });
    },

    destroy(): void {
      cancelAnim();
      storedCtx = null;
    },

    hooks: {
      onAfterScroll(scrollPosition: number): void {
        if (realTotal <= 1) return;
        const vi = virtualIndexAtScroll(scrollPosition);
        currentIndex = logicalIndexOf(vi);

        if (snapEnabled && animId === null) {
          rebaseIfNeeded();
        }
      },
    },
  };
}
