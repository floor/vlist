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

export type CarouselVariant = "static" | "full" | "hero" | "hero-center" | "multi" | "uncontained" | "multi-aspect" | "free";
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
  let isX: boolean;

  let currentIndex = initialIndex;
  let realTotal = 0;
  let stepSize = 0;
  let lapSize = 0;
  let virtualTotal = 0;

  let initialScrollPending = false;
  let prefix = "vlist";
  let intendedVi = -1;

  let stepSizes: number[] = [];
  let stepOffsets: number[] = [];
  let isVariableWidth = false;
  const gapPx = config?.gap ?? 0;

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

  function buildStepCache(sizes: number[]): void {
    stepSizes = sizes;
    const n = sizes.length;
    stepOffsets = new Array(n + 1) as number[];
    stepOffsets[0] = 0;
    for (let i = 0; i < n; i++) {
      stepOffsets[i + 1] = stepOffsets[i]! + sizes[i]!;
    }
    lapSize = n > 0 ? stepOffsets[n]! : 0;
  }

  function decomposeScroll(pos: number): { vi: number; frac: number } {
    if (realTotal <= 0 || lapSize <= 0) return { vi: 0, frac: 0 };
    const cycle = Math.floor(pos / lapSize);
    let rem = pos - cycle * lapSize;
    if (rem < 0) rem = 0;

    if (!isVariableWidth) {
      const s = stepSizes[0]!;
      const idx = Math.min(Math.floor(rem / s), realTotal - 1);
      return { vi: cycle * realTotal + idx, frac: s > 0 ? (rem / s) - idx : 0 };
    }

    let lo = 0;
    let hi = realTotal - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (stepOffsets[mid]! <= rem) lo = mid;
      else hi = mid - 1;
    }
    const start = stepOffsets[lo]!;
    const size = stepSizes[lo]!;
    const frac = size > 0 ? Math.max(0, Math.min((rem - start) / size, 1)) : 0;
    return { vi: cycle * realTotal + lo, frac };
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
    if (realTotal <= 0 || lapSize <= 0) return 0;
    const cycle = Math.floor(vi / realTotal);
    const within = ((vi % realTotal) + realTotal) % realTotal;
    return cycle * lapSize + (stepOffsets[within] ?? 0);
  }

  function virtualIndexAtScroll(pos: number): number {
    const { vi, frac } = decomposeScroll(pos);
    return frac >= 0.5 ? vi + 1 : vi;
  }

  function getBaseVi(): number {
    if (intendedVi >= 0) return intendedVi;
    return virtualIndexAtScroll(engineState.scrollPosition);
  }

  // Rebasing (folding the logical position back toward the middle cycle) and the
  // smooth-scroll animation both live in the bounded scroll handler now — the
  // carousel only computes targets and lets the handler do the scrolling.
  function smoothScrollTo(target: number, duration: number): void {
    storedCtx?.smoothScrollTo(target, duration);
  }

  let layoutEngine: ReturnType<typeof createLayoutEngine> | null = null;

  function syncItemCount(): void {
    if (!storedCtx) return;
    const currentTotal = storedCtx.getItems().length;
    if (currentTotal === realTotal) return;
    const savedIndex = currentIndex;
    realTotal = currentTotal;
    if (isVariableWidth) {
      const rawSpec = storedCtx.rawSizeSpec;
      const getSz = typeof rawSpec === "function"
        ? (i: number) => (rawSpec as (index: number) => number)(i) + gapPx
        : () => (rawSpec as number) + gapPx;
      buildStepCache(Array.from({ length: realTotal }, (_, i) => getSz(i)));
    } else {
      buildStepCache(Array.from({ length: realTotal }, () => stepSizes[0] ?? stepSize));
    }
    virtualTotal = realTotal * CYCLES;
    engineState.totalItems = virtualTotal;
    if (realTotal > 1) {
      const safeIndex = savedIndex < realTotal ? savedIndex : 0;
      currentIndex = safeIndex;
      storedCtx.scrollTo(scrollPositionForVirtual(MIDDLE_CYCLE * realTotal + safeIndex));
    }
  }

  function updateItemLayout(): void {
    if (!storedCtx || realTotal <= 0) return;
    if (!layoutEngine && !isVariableWidth) return;

    const content = storedCtx.dom.content;
    const children = content.children;
    const pos = engineState.scrollPosition;
    const baseOffset = engineState.baseOffset;
    const prop = isX ? "width" : "height";
    const { vi: focalVi, frac } = decomposeScroll(pos);
    const baseCycle = focalVi - ((focalVi % realTotal + realTotal) % realTotal);

    if (layoutEngine) {
      const anchor = pos + layoutEngine.getAnchorOffset(focalVi, frac);

      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const idx = el.dataset.index;
        if (idx === undefined) continue;
        const logical = parseInt(idx, 10);
        let vi = baseCycle + logical;
        if (vi - focalVi > realTotal / 2) vi -= realTotal;
        if (focalVi - vi > realTotal / 2) vi += realTotal;

        const layout = layoutEngine.getItemLayout(vi, focalVi, frac, anchor);
        const roundedSize = Math.max(0, Math.round(layout.size));
        const roundedOffset = Math.round(layout.offset - baseOffset);

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
    } else {
      const containerSz = engineState.containerSize;
      const focalLogIdx = logicalIndexOf(focalVi);
      const nextLogIdx = logicalIndexOf(focalVi + 1);
      const focalStep = stepSizes[focalLogIdx] ?? 0;
      const nextStep = stepSizes[nextLogIdx] ?? 0;
      const interpItem = (focalStep + frac * (nextStep - focalStep)) - gapPx;
      const centerShift = (containerSz - Math.max(0, interpItem)) / 2;

      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const idx = el.dataset.index;
        if (idx === undefined) continue;
        const logical = parseInt(idx, 10);
        let vi = baseCycle + logical;
        if (vi - focalVi > realTotal / 2) vi -= realTotal;
        if (focalVi - vi > realTotal / 2) vi += realTotal;

        const logIdx = logicalIndexOf(vi);
        const itemSize = Math.max(0, Math.round((stepSizes[logIdx] ?? 0) - gapPx));
        const absOffset = scrollPositionForVirtual(vi);
        const roundedOffset = Math.round(absOffset - baseOffset + centerShift);

        if (itemSize <= 0) {
          el.style.display = "none";
        } else {
          el.style.display = "";
          el.style[prop] = itemSize + "px";
          el.style.transform = isX
            ? `translateX(${roundedOffset}px)`
            : `translateY(${roundedOffset}px)`;
        }

        const relOffset = vi - focalVi;
        const progress = Math.min(1, Math.abs(relOffset) + (relOffset === 0 ? frac : 0));
        el.style.setProperty("--vlist-carousel-progress", progress.toFixed(3));
        el.style.setProperty("--vlist-carousel-offset", String(relOffset));
        el.style.setProperty("--vlist-carousel-role", "large");
        el.style.setProperty("--vlist-carousel-width", itemSize + "px");
      }
    }
  }

  function navigateTo(logicalTarget: number, smooth: boolean, duration: number): void {
    if (!storedCtx) return;
    currentIndex = logicalTarget;

    if (realTotal <= 1) return;

    const baseVi = getBaseVi();
    const currentLogical = logicalIndexOf(baseVi);

    const forward = ((logicalTarget - currentLogical) % realTotal + realTotal) % realTotal;
    const backward = realTotal - forward;
    const delta = forward <= backward ? forward : -backward;
    const targetVi = baseVi + delta;
    intendedVi = targetVi;
    const nearestPos = scrollPositionForVirtual(targetVi);

    if (smooth) {
      smoothScrollTo(nearestPos, duration);
    } else {
      storedCtx.scrollTo(nearestPos);
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
          gap: gapPx,
        });
        stepSize = layoutEngine.stepSize;
        buildStepCache(Array.from({ length: Math.max(1, realTotal) }, () => stepSize));
        isVariableWidth = false;
      } else if (typeof ctx.rawSizeSpec === "function") {
        const rawFn = ctx.rawSizeSpec as (index: number) => number;
        buildStepCache(Array.from({ length: realTotal }, (_, i) => rawFn(i) + gapPx));
        stepSize = stepSizes[0] ?? baseItemSize;
        isVariableWidth = true;
      } else {
        stepSize = baseItemSize;
        buildStepCache(Array.from({ length: Math.max(1, realTotal) }, () => stepSize));
        isVariableWidth = false;
      }
      virtualTotal = realTotal * CYCLES;
      currentIndex = resolveIndex(initialIndex);

      // ── Virtual scroll window ─────────────────────────────────────

      if (realTotal > 1) {
        ctx.setGetItemFn((i: number): T | undefined => {
          const logical = logicalIndexOf(i);
          return ctx.getItems()[logical];
        });

        sizeCache.getTotalSize = (): number => lapSize * CYCLES;
        sizeCache.getOffset = (index: number): number => scrollPositionForVirtual(index);
        sizeCache.getSize = (index: number): number => {
          const logical = logicalIndexOf(index);
          return stepSizes[logical] ?? stepSizes[0] ?? 0;
        };
        sizeCache.indexAtOffset = (offset: number): number => {
          if (lapSize <= 0) return 0;
          const cycle = Math.floor(offset / lapSize);
          const rem = offset - cycle * lapSize;
          if (!isVariableWidth) {
            const s = stepSizes[0] ?? 1;
            return Math.max(0, Math.min(cycle * realTotal + Math.floor(rem / s), virtualTotal - 1));
          }
          let lo = 0;
          let hi = realTotal - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (stepOffsets[mid]! <= rem) lo = mid;
            else hi = mid - 1;
          }
          return Math.max(0, Math.min(cycle * realTotal + lo, virtualTotal - 1));
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

        // Route scroll through the bounded handler in wrap mode: the logical
        // position never clamps, and the handler folds it back toward the
        // middle cycle by whole laps once it drifts far enough. The carousel's
        // modulo getItemFn maps the shifted virtual indices to identical real
        // items at identical paint positions, so the fold is seamless.
        ctx.setBoundedWrap({
          lapSize: () => lapSize,
          home: () => MIDDLE_CYCLE * lapSize,
          thresholdLaps: MIDDLE_CYCLE - REBASE_THRESHOLD,
        });

        initialScrollPending = true;
      }

      // ── next / prev / goTo ──────────────────────────────────────

      ctx.registerMethod("next", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const prevIndex = currentIndex;
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        storedCtx!.cancelScroll();
        const baseVi = getBaseVi();
        const targetVi = baseVi + s;
        intendedVi = targetVi;
        currentIndex = logicalIndexOf(targetVi);
        const nearestPos = scrollPositionForVirtual(targetVi);

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scrollTo(nearestPos);
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
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        storedCtx!.cancelScroll();
        const baseVi = getBaseVi();
        const targetVi = baseVi - s;
        intendedVi = targetVi;
        currentIndex = logicalIndexOf(targetVi);
        const nearestPos = scrollPositionForVirtual(targetVi);

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scrollTo(nearestPos);
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

        storedCtx!.cancelScroll();

        if (direction === "forward" || direction === "backward") {
          const delta = shortestPath(currentIndex, target,
            direction === "forward" ? "forward" : "backward");
          currentIndex = target;
          const baseVi = getBaseVi();
          const targetVi = baseVi + delta;
          intendedVi = targetVi;
          const nearestPos = scrollPositionForVirtual(targetVi);

          if (smooth) {
            smoothScrollTo(nearestPos, dur);
          } else {
            storedCtx!.scrollTo(nearestPos);
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
        storedCtx?.cancelScroll();
      });
    },

    destroy(): void {
      storedCtx?.cancelScroll();
      storedCtx = null;
    },

    hooks: {
      onCommit(): void {
        if (!initialScrollPending || !storedCtx) return;
        initialScrollPending = false;

        // The first render used scrollPosition=0. Seed the real start
        // position through the handler so baseOffset/scrollTop stay
        // consistent, then re-render at the correct offset.
        const startPos = scrollPositionForVirtual(virtualIndexOf(currentIndex));
        storedCtx.scrollTo(startPos);
        storedCtx.forceRender();
        updateItemLayout();
      },

      onAfterScroll(_scrollPosition: number): void {
        if (initialScrollPending || !storedCtx) return;
        syncItemCount();
        if (realTotal <= 1) return;

        if (intendedVi < 0) {
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
        }

        updateItemLayout();
      },

      // Snap-to-item once scrolling stops. The bounded handler fires onIdle
      // after the idle timeout, replacing the old setTimeout(200) dance.
      onIdle(): void {
        intendedVi = -1;
        if (!snapEnabled || !storedCtx || realTotal <= 1) return;
        const p = engineState.scrollPosition;
        const nearestVi = virtualIndexAtScroll(p);
        const snapTarget = scrollPositionForVirtual(nearestVi);
        if (Math.abs(p - snapTarget) > 1) {
          currentIndex = logicalIndexOf(nearestVi);
          smoothScrollTo(snapTarget, snapDuration);
        }
      },
    },
  };
}
