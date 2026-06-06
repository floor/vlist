/**
 * vlist v2 — Carousel Plugin (RFC-011)
 *
 * Infinite-loop scrolling with snap-to-item, focal scaling, and peek.
 * Uses a finite virtual scroll window with silent rebasing — the scroll
 * position wraps seamlessly without rewinding through the entire list.
 *
 * Priority 10 — layout tier (replaces scroll contract).
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

  let currentIndex = initialIndex;
  let realTotal = 0;
  let lapSize = 0;

  function getItemSize(): number {
    return realTotal > 0 ? sizeCache.getSize(0) : 0;
  }

  function updateLapSize(): void {
    lapSize = sizeCache.getTotalSize();
  }

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

  return {
    name: "carousel",
    priority: 10,
    conflicts: ["scale"],

    setup(ctx: PluginContext<T>): void {
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;
      storedCtx = ctx;
      realTotal = engineState.totalItems;
      updateLapSize();
      currentIndex = resolveIndex(initialIndex);

      // ── next / prev / goTo ──────────────────────────────────────

      ctx.registerMethod("next", (step?: number, _options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        currentIndex = resolveIndex(currentIndex + s);
        ctx.scrollTo(currentIndex * getItemSize());
        ctx.forceRender();
      });

      ctx.registerMethod("prev", (step?: number, _options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        currentIndex = resolveIndex(currentIndex - s);
        ctx.scrollTo(currentIndex * getItemSize());
        ctx.forceRender();
      });

      ctx.registerMethod("goTo", (index: number, options?: {
        direction?: CarouselDirection;
        behavior?: string;
        duration?: number;
      }): void => {
        if (realTotal <= 0) return;
        const target = resolveIndex(index);
        const direction = options?.direction ?? "auto";

        if (realTotal <= 1) {
          currentIndex = target;
          return;
        }

        const _delta = shortestPath(currentIndex, target, direction);
        currentIndex = target;
        ctx.scrollTo(currentIndex * getItemSize());
        ctx.forceRender();
      });

      // ── getCarouselState ────────────────────────────────────────

      ctx.registerMethod("getCarouselState", (): CarouselState => {
        return {
          index: currentIndex,
          progress: 0,
          offset: 0,
          scrollPosition: currentIndex * getItemSize(),
        };
      });
    },

    destroy(): void {
      storedCtx = null;
    },
  };
}
