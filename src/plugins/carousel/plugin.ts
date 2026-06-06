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
import { createLayoutEngine } from "./engine";
import type { SlotConfig } from "./presets";
import { resolvePreset } from "./presets";

// =============================================================================
// Config
// =============================================================================

export type CarouselVariant = "static" | "full" | "hero" | "hero-center" | "multi" | "uncontained" | "free";
export type CarouselDirection = "auto" | "forward" | "backward";

export interface CarouselPluginConfig {
  variant?: CarouselVariant | SlotConfig;
  snap?: boolean;
  snapDuration?: number;
  peek?: number | string | "auto";
  largeItemMaxWidth?: number | "auto";
  parallax?: number;
  visibleCount?: number;
  focalAlign?: "center" | "start";
  initialIndex?: number;
  cornerRadius?: number;
  gap?: number;
}

export interface CarouselState {
  index: number;
  progress: number;
  offset: number;
  scrollPosition: number;
  role: "large" | "medium" | "small";
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
  const variantConfig = config?.variant ?? "full";
  const isCustomPreset = typeof variantConfig === "object";
  const variant: string = isCustomPreset ? "custom" : variantConfig;
  const customSlots: SlotConfig | null = isCustomPreset ? variantConfig : null;
  const snapEnabled = config?.snap ?? (variant !== "free");
  const snapDuration = config?.snapDuration ?? 400;
  const initialIndex = config?.initialIndex ?? 0;
  const peekConfig = config?.peek ?? "auto";

  let engineState: EngineState;
  let sizeCache: SizeCache;
  let storedCtx: PluginContext<T> | null = null;
  let viewport: HTMLElement;
  let isX: boolean;

  let currentIndex = initialIndex;
  let realTotal = 0;
  let stepSize = 0;
  let lapSize = 0;
  let virtualTotal = 0;

  let animId: number | null = null;
  let snapTimerId: ReturnType<typeof setTimeout> | null = null;
  let initialScrollPending = false;
  let prefix = "vlist";

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

  function resolvePeekSize(containerSize: number): number {
    if (variant === "full") return 0;
    if (typeof peekConfig === "number") return peekConfig;
    if (typeof peekConfig === "string" && peekConfig.endsWith("%")) {
      return Math.round(containerSize * parseFloat(peekConfig) / 100);
    }
    return Math.max(40, Math.min(Math.round(containerSize * 0.15), 120));
  }

  function scrollPositionForVirtual(vi: number): number {
    return vi * stepSize;
  }

  function virtualIndexAtScroll(pos: number): number {
    if (stepSize <= 0) return 0;
    return Math.round(pos / stepSize);
  }

  function rebaseIfNeeded(): void {
    if (realTotal <= 0 || !storedCtx) return;
    const pos = engineState.scrollPosition;
    const currentVi = virtualIndexAtScroll(pos);
    const cycle = Math.floor(currentVi / realTotal);

    if (cycle < REBASE_THRESHOLD || cycle >= CYCLES - REBASE_THRESHOLD) {
      const logical = logicalIndexOf(currentVi);
      const targetVi = virtualIndexOf(logical);
      const offset = pos - currentVi * stepSize;
      const newPos = targetVi * stepSize + offset;

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
    if (snapTimerId !== null) {
      clearTimeout(snapTimerId);
      snapTimerId = null;
    }
  }

  function smoothScrollTo(target: number, duration: number): void {
    cancelAnim();
    if (!storedCtx) return;
    const from = engineState.scrollPosition;
    if (Math.abs(target - from) < 1) {
      storedCtx.scrollTo(target);
      updateItemLayout();
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      storedCtx!.scrollTo(from + (target - from) * eased);
      updateItemLayout();
      if (t < 1) animId = requestAnimationFrame(tick);
      else { animId = null; rebaseIfNeeded(); storedCtx!.forceRender(); updateItemLayout(); }
    };
    animId = requestAnimationFrame(tick);
  }

  let layoutEngine: ReturnType<typeof createLayoutEngine> | null = null;

  function syncItemCount(): void {
    if (!storedCtx) return;
    const currentTotal = storedCtx.getItems().length;
    if (currentTotal === realTotal) return;
    const savedIndex = currentIndex;
    realTotal = currentTotal;
    virtualTotal = realTotal * CYCLES;
    lapSize = stepSize * realTotal;
    engineState.totalItems = virtualTotal;
    if (realTotal > 1) {
      const safeIndex = savedIndex < realTotal ? savedIndex : 0;
      currentIndex = safeIndex;
      const targetVi = MIDDLE_CYCLE * realTotal + safeIndex;
      const newPos = targetVi * stepSize;
      engineState.scrollPosition = newPos;
      engineState.prevScrollPosition = newPos;
      (viewport as any)[isX ? "scrollLeft" : "scrollTop"] = newPos;
    }
  }

  function updateItemLayout(): void {
    if (!storedCtx || realTotal <= 0 || !layoutEngine) return;
    const content = storedCtx.dom.content;
    const children = content.children;
    const pos = engineState.scrollPosition;
    const focalVi = Math.floor(pos / stepSize);
    const frac = stepSize > 0 ? (pos / stepSize) - focalVi : 0;
    const prop = isX ? "width" : "height";
    const anchor = pos + layoutEngine!.getAnchorOffset(focalVi, frac);

    const baseCycle = focalVi - (focalVi % realTotal);

    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      const idx = el.dataset.index;
      if (idx === undefined) continue;
      const logical = parseInt(idx, 10);
      let vi = baseCycle + logical;
      if (vi - focalVi > realTotal / 2) vi -= realTotal;
      if (focalVi - vi > realTotal / 2) vi += realTotal;

      const layout = layoutEngine!.getItemLayout(vi, focalVi, frac, anchor);
      const roundedSize = Math.max(0, Math.round(layout.size));
      const roundedOffset = Math.round(layout.offset);

      if (roundedSize <= 0) {
        el.style.display = "none";
        el.classList.remove(`${prefix}-item--focused`, `${prefix}-item--selected`);
        el.removeAttribute("aria-selected");
      } else {
        el.style.display = "";
        el.style[prop] = roundedSize + "px";
        el.style.transform = isX
          ? `translateX(${roundedOffset}px)`
          : `translateY(${roundedOffset}px)`;
      }

      el.style.setProperty("--vlist-carousel-progress", layout.progress.toFixed(3));
      el.style.setProperty("--vlist-carousel-offset", String(layout.relOffset));
      el.style.setProperty("--vlist-carousel-role", layout.role);
      el.style.setProperty("--vlist-carousel-width", roundedSize + "px");
    }
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
      updateItemLayout();
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
      prefix = ctx.config.classPrefix;
      realTotal = engineState.totalItems;
      const baseItemSize = realTotal > 0 ? sizeCache.getSize(0) : 0;
      const containerSize = engineState.containerSize;
      const peekResolved = resolvePeekSize(containerSize);
      const variantSlots = customSlots ?? resolvePreset(variant, containerSize, peekResolved);
      if (variantSlots) {
        layoutEngine = createLayoutEngine({
          slots: variantSlots.slots,
          focalSlot: variantSlots.focalSlot,
          containerSize,
          gap: config?.gap ?? 0,
        });
        stepSize = layoutEngine.stepSize;
      } else {
        stepSize = baseItemSize;
      }
      lapSize = stepSize * realTotal;
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

        sizeCache.getTotalSize = (): number => virtualTotal * stepSize;
        sizeCache.getOffset = (index: number): number => index * stepSize;
        sizeCache.getSize = (_index: number): number => stepSize;
        sizeCache.indexAtOffset = (offset: number): number => {
          if (stepSize <= 0) return 0;
          return Math.max(0, Math.min(Math.floor(offset / stepSize), virtualTotal - 1));
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
        ctx.setIndexMapFn(logicalIndexOf);
        ctx.registerMethod("_layoutToDataIndex", logicalIndexOf);

        // Normalize getScrollPosition to return within one lap
        ctx.setScrollFns(
          () => {
            const raw = engineState.scrollPosition;
            return lapSize > 0 ? ((raw % lapSize) + lapSize) % lapSize : 0;
          },
          (pos: number) => {
            engineState.scrollPosition = pos;
            (viewport as any)[isX ? "scrollLeft" : "scrollTop"] = pos;
          },
        );

        initialScrollPending = true;
      }

      // ── next / prev / goTo ──────────────────────────────────────

      ctx.registerMethod("next", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const prevIndex = currentIndex;
        currentIndex = resolveIndex(currentIndex + s);
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        cancelAnim();
        const currentSnap = Math.round(engineState.scrollPosition / stepSize) * stepSize;
        const nearestPos = currentSnap + s * stepSize;

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scrollTo(nearestPos);
          rebaseIfNeeded();
          updateItemLayout();
        }
        if (currentIndex !== prevIndex) {
          storedCtx!.emitter.emit("carousel:change" as any, { index: currentIndex, scrollPosition: engineState.scrollPosition });
        }
      });

      ctx.registerMethod("prev", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const prevIndex = currentIndex;
        currentIndex = resolveIndex(currentIndex - s);
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        cancelAnim();
        const currentSnap = Math.round(engineState.scrollPosition / stepSize) * stepSize;
        const nearestPos = currentSnap - s * stepSize;

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scrollTo(nearestPos);
          rebaseIfNeeded();
          updateItemLayout();
        }
        if (currentIndex !== prevIndex) {
          storedCtx!.emitter.emit("carousel:change" as any, { index: currentIndex, scrollPosition: engineState.scrollPosition });
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
          const nearestPos = currentPos + delta * stepSize;

          if (smooth) {
            smoothScrollTo(nearestPos, dur);
          } else {
            storedCtx!.scrollTo(nearestPos);
            rebaseIfNeeded();
            updateItemLayout();
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
          role: "large",
        };
      });

      // ── Override scrollToIndex for wrap ──────────────────────────

      ctx.setScrollToIndexFn((index, _align, behavior, duration, _easing): void | false => {
        if (realTotal <= 1) return false;
        const target = resolveIndex(index);
        const smooth = behavior === "smooth";
        const dur = duration ?? snapDuration;
        navigateTo(target, smooth, dur);
      });

      // ── Keyboard nav integration with selection ─────────────────

      ctx.setNavConfig({
        total: () => realTotal,
        navigate: (current: number, key: string, total: number): number => {
          let target = current;
          if (key === "ArrowRight" || key === "ArrowDown") {
            target = (current + 1) % total;
          } else if (key === "ArrowLeft" || key === "ArrowUp") {
            target = (current - 1 + total) % total;
          } else if (key === "Home") {
            target = 0;
          } else if (key === "End") {
            target = total - 1;
          }
          if (target !== current) {
            navigateTo(target, false, 0);
            storedCtx?.forceRender();
            updateItemLayout();
          }
          return target;
        },
      });

      // ── Built-in keyboard navigation ──────────────────────────

      if (!ctx.dom.content.getAttribute("tabindex")) {
        ctx.dom.content.setAttribute("tabindex", "0");
      }

      const navNext = ctx.getMethod("next") as Function;
      const navPrev = ctx.getMethod("prev") as Function;
      const navGoTo = ctx.getMethod("goTo") as Function;

      ctx.registerKeydownHandler((event: KeyboardEvent): void => {
        const key = event.key;
        if (key === "ArrowRight" || key === "ArrowDown") {
          event.preventDefault();
          navNext(1, { behavior: "smooth", duration: snapDuration });
        } else if (key === "ArrowLeft" || key === "ArrowUp") {
          event.preventDefault();
          navPrev(1, { behavior: "smooth", duration: snapDuration });
        } else if (key === "Home") {
          event.preventDefault();
          navGoTo(0, { behavior: "smooth", duration: snapDuration });
        } else if (key === "End") {
          event.preventDefault();
          navGoTo(realTotal - 1, { behavior: "smooth", duration: snapDuration });
        }
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
        updateItemLayout();
      },

      onAfterScroll(_scrollPosition: number): void {
        if (initialScrollPending || !storedCtx) return;
        syncItemCount();
        if (realTotal <= 1) return;
        const pos = engineState.scrollPosition;
        const vi = virtualIndexAtScroll(pos);
        const newIndex = logicalIndexOf(vi);

        if (newIndex !== currentIndex) {
          currentIndex = newIndex;
          storedCtx.emitter.emit("carousel:change" as any, {
            index: currentIndex,
            scrollPosition: pos,
          });
        }

        updateItemLayout();
        rebaseIfNeeded();

        if (snapEnabled && animId === null) {
          if (snapTimerId !== null) clearTimeout(snapTimerId);
          snapTimerId = setTimeout(() => {
            snapTimerId = null;
            if (animId !== null || !storedCtx || realTotal <= 1) return;
            const p = engineState.scrollPosition;
            const nearestVi = Math.round(p / stepSize);
            const snapTarget = nearestVi * stepSize;
            if (Math.abs(p - snapTarget) > 1) {
              currentIndex = logicalIndexOf(nearestVi);
              smoothScrollTo(snapTarget, snapDuration);
            }
          }, 200);
        }
      },
    },
  };
}
