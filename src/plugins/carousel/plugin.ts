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
 * mapped via modulo so virtual index 817 with 16 real items → item 1.
 * The scroll starts in the middle cycle. When approaching the edges,
 * the position is silently rebased to the middle cycle.
 *
 * Public API (list.total, ARIA, selection, click events) stays at the
 * real item count. The inflated virtual window is strictly internal.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";

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

  let animId: number | null = null;
  let initialScrollPending = false;

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

    const currentPos = engineState.scrollPosition;
    const currentVi = virtualIndexAtScroll(currentPos);
    const currentLogical = logicalIndexOf(currentVi);

    const forward = ((logicalTarget - currentLogical) % realTotal + realTotal) % realTotal;
    const backward = realTotal - forward;
    const delta = forward <= backward ? forward : -backward;
    const nearestPos = scrollPositionForVirtual(currentVi + delta);

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
      // Map virtual indices to real items via modulo. The render
      // pipeline sees virtualTotal items but public API stays at
      // realTotal. We hook getTotalSize and getOffset on the sizeCache
      // so content height reflects the virtual window, and we override
      // getItemFn so virtual indices resolve to real items.

      if (realTotal > 1) {
        ctx.setGetItemFn((i: number): T | undefined => {
          const logical = logicalIndexOf(i);
          return ctx.getItems()[logical];
        });

        // Hook sizeCache to report virtual dimensions without
        // changing engineState.totalItems (which stays at realTotal).
        const origGetTotalSize = sizeCache.getTotalSize;
        const origGetOffset = sizeCache.getOffset;
        const origGetSize = sizeCache.getSize;
        const origIndexAtOffset = sizeCache.indexAtOffset;
        const origGetTotal = sizeCache.getTotal;
        const origRebuild = sizeCache.rebuild;

        sizeCache.getTotalSize = (): number => virtualTotal * itemSize;
        sizeCache.getOffset = (index: number): number => index * itemSize;
        sizeCache.getSize = (_index: number): number => itemSize;
        sizeCache.indexAtOffset = (offset: number): number => {
          if (itemSize <= 0) return 0;
          return Math.max(0, Math.min(Math.floor(offset / itemSize), virtualTotal - 1));
        };
        sizeCache.getTotal = (): number => virtualTotal;

        // Don't hook rebuild — the engine may call rebuild(virtualTotal)
        // internally, and we don't want that to corrupt realTotal.
        // The hooked getters (getOffset, getSize, etc.) are stable
        // regardless of the internal prefix-sum state.

        // Engine needs virtualTotal for rendering at virtual indices.
        // Public API (list.total) returns realTotal via virtualTotalFn.
        engineState.totalItems = virtualTotal;
        ctx.setVirtualTotalFn(() => realTotal);

        initialScrollPending = true;
      }

      // ── next / prev / goTo ──────────────────────────────────────

      ctx.registerMethod("next", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        currentIndex = resolveIndex(currentIndex + s);
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        cancelAnim();
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
        currentIndex = resolveIndex(currentIndex - s);
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        cancelAnim();
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
          const delta = shortestPath(currentIndex, target,
            direction === "forward" ? "forward" : "backward");
          currentIndex = target;
          const currentPos = engineState.scrollPosition;
          const nearestPos = currentPos + delta * itemSize;

          if (smooth) {
            smoothScrollTo(nearestPos, dur);
          } else {
            storedCtx!.scrollTo(nearestPos);
            rebaseIfNeeded();
          }
        } else {
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
      onCommit(): void {
        if (!initialScrollPending || !storedCtx) return;
        initialScrollPending = false;

        const startPos = scrollPositionForVirtual(virtualIndexOf(currentIndex));
        engineState.scrollPosition = startPos;
        engineState.prevScrollPosition = startPos;
        const prop = isX ? "scrollLeft" : "scrollTop";
        void viewport.scrollHeight;
        (viewport as any)[prop] = startPos;

        // The first render used scrollPosition=0. Now that we've set
        // the real position, force a re-render at the correct offset.
        storedCtx.forceRender();
      },

      onAfterScroll(scrollPosition: number): void {
        if (realTotal <= 1 || initialScrollPending) return;
        const vi = virtualIndexAtScroll(scrollPosition);
        currentIndex = logicalIndexOf(vi);

        if (snapEnabled && animId === null) {
          rebaseIfNeeded();
        }
      },
    },
  };
}
