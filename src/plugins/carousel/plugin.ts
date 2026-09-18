/**
 * vlist — Carousel Plugin (RFC-011)
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
 *
 * Restrictions:
 * - Cannot be combined with `groups()`: an infinite wrap has no sections to
 *   group, and mechanically groups' `setSizeConfig` replaces the size cache
 *   methods this plugin installs directly.
 * - `page()` is rejected by core, since bounded page-mode scrolling does not
 *   exist: document scrolling cannot wrap.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";
import { createBoundedScrollHandler } from "../../core/runway";
import { createLayoutEngine } from "./engine";
import type { SlotConfig, SlotConfigResolver, TextFade } from "./presets";
import { resolvePreset, hasSlots } from "./presets";

// =============================================================================
// Config
// =============================================================================

export type CarouselVariant = "static" | "full" | "hero" | "hero-center" | "multi" | "uncontained" | "multi-aspect" | "free" | (string & {});
export type CarouselDirection = "auto" | "forward" | "backward";

export interface CarouselPluginConfig {
  variant?: CarouselVariant | SlotConfig | SlotConfigResolver;
  snap?: boolean;
  /** Snap in the user's scroll direction instead of to the nearest item. */
  snapDirection?: boolean;
  snapDuration?: number;
  /** Custom easing function for snap animation. Receives t in [0,1], returns eased value. */
  snapEasing?: (t: number) => number;
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
// Variant normalisation
// =============================================================================

interface NormalizedVariant {
  variant: string;
  resolveSlots: SlotConfigResolver;
}

function normalizeVariant(
  input: CarouselVariant | SlotConfig | SlotConfigResolver,
): NormalizedVariant {
  if (typeof input === "function") {
    return { variant: "custom", resolveSlots: input };
  }
  if (typeof input === "object") {
    const slots = input as SlotConfig;
    return { variant: "custom", resolveSlots: () => slots };
  }
  return {
    variant: input,
    resolveSlots: (containerSize, peek) => resolvePreset(input, containerSize, peek),
  };
}

// =============================================================================
// Factory
// =============================================================================

/** Methods the carousel plugin adds to the list instance. */
export interface CarouselMethods {
  /** Move forward by `step` slides (default 1). */
  next(step?: number, options?: { behavior?: string; duration?: number }): void;
  /** Move back by `step` slides (default 1). */
  prev(step?: number, options?: { behavior?: string; duration?: number }): void;
  /** Move to a slide index. */
  goTo(index: number, options?: { direction?: CarouselDirection; behavior?: string; duration?: number }): void;
  /** Current index, progress, offset and focal role. */
  getCarouselState(): CarouselState;
}

export function carousel<T extends VListItem = VListItem>(
  config?: CarouselPluginConfig,
): VListPlugin<T, CarouselMethods> {
  const variantConfig = config?.variant ?? "full";
  const { variant, resolveSlots } = normalizeVariant(variantConfig);
  const snapEnabled = variant === "full" || (config?.snap ?? (variant !== "free"));
  const snapDirectional = config?.snapDirection ?? true;
  const snapDuration = config?.snapDuration ?? 400;
  const snapEasing = config?.snapEasing;
  const initialIndex = config?.initialIndex ?? 0;
  const peekConfig = config?.peek ?? "auto";

  let engineState: EngineState;
  let scroll: PluginContext<T>["scroll"];
  let sizeCache: SizeCache;
  let storedCtx: PluginContext<T> | null = null;
  let isX: boolean;

  let currentIndex = initialIndex;
  let realTotal = 0;
  /**
   * Under data(), the total is 0 when this plugin sets up: it sits at priority
   * 10 and the adapter at 20, and items arrive later still. So the virtual
   * window — the modulo accessor, the inflated total, the wrapping scroll —
   * cannot be installed in setup(); it is installed when the total first
   * becomes known, and it composes with the accessor data() put in place.
   */
  let windowInstalled = false;
  let upstreamTotal: (() => number) | null = null;
  let upstreamGet: ((index: number) => T | undefined) | null = null;
  let upstreamResolved = false;
  const ownGetTotal = (): number => realTotal;
  let stepSize = 0;
  let layoutContainerSize = 0;
  let lapSize = 0;
  let virtualTotal = 0;

  let initialScrollPending = false;
  let prefix = "vlist";
  let intendedVi = -1;
  /**
   * When the current programmatic snap is due to finish.
   *
   * The engine can report idle while that snap is still running — selection()
   * renders on every focus change, and an idle arrives between frames. onIdle
   * then dropped `intendedVi`, onAfterScroll recomputed the index from a
   * position halfway between two items, and the next key moved from there:
   * three presses inside one snap advanced two items. A deadline rather than a
   * flag, so an interrupted animation cannot leave the carousel wedged.
   */
  let snapUntil = 0;
  let lastDirection = 0;

  let stepSizes: number[] = [];
  let stepOffsets: number[] = [];
  let isVariableWidth = false;
  let textFade: TextFade = "role";
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
    return virtualIndexAtScroll(scroll.getPixelEquivalent());
  }

  // Rebasing (folding the logical position back toward the middle cycle) and the
  // smooth-scroll animation both live in the bounded scroll handler now — the
  // carousel only computes targets and lets the handler do the scrolling.
  function smoothScrollTo(target: number, duration: number): void {
    // Every programmatic snap passes here, so this is where its deadline is set.
    snapUntil = performance.now() + duration;
    storedCtx?.scroll.smoothTo(target, duration, snapEasing);
  }

  let layoutEngine: ReturnType<typeof createLayoutEngine> | null = null;

  /** The virtual window: the wrap that makes this a carousel. Once, when the total is known. */
  function installWindow(): void {
    if (windowInstalled || !storedCtx || realTotal <= 1) return;
    const ctx = storedCtx;
    windowInstalled = true;
      // The accessor in place before this one — data()'s, under an adapter —
      // answers in data space; this one only folds the virtual index first.
      const inner = upstreamGet ?? ((index: number): T | undefined => ctx.items.all()[index]);
      ctx.items.setGetFn((i: number): T | undefined => inner(logicalIndexOf(i)));

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
      ctx.items.setTotalFn(() => realTotal);
      ctx.items.setIndexMapFn(logicalIndexOf);
      ctx.hooks.method("_layoutToDataIndex", logicalIndexOf);
      // The engine total is the inflated virtual one (101 laps), which is
      // what rendering needs and what any plugin asking "how many items are
      // there" must not use. data() publishes the same answer the same way.
      ctx.hooks.method("_getTotal", ownGetTotal);

      // Route scroll through the bounded handler in wrap mode: the logical
      // position never clamps, and the handler folds it back toward the
      // middle cycle by whole laps once it drifts far enough. The carousel's
      // modulo getItemFn maps the shifted virtual indices to identical real
      // items at identical paint positions, so the fold is seamless.
      ctx.scroll.setBoundedWrap({
        lapSize: () => lapSize,
        home: () => MIDDLE_CYCLE * lapSize,
        thresholdLaps: MIDDLE_CYCLE - REBASE_THRESHOLD,
        onFold(shift: number) {
          if (intendedVi >= 0) intendedVi -= Math.round(shift / lapSize) * realTotal;
        },
      }, createBoundedScrollHandler);

      initialScrollPending = true;
  }

  /**
   * Where the item count really lives. data() publishes `_getTotal` and
   * `_getItem` after this plugin sets up, so both are read once on the render
   * path — never this plugin's own `_getTotal`, which it publishes on install.
   */
  function resolveUpstream(): void {
    if (upstreamResolved || !storedCtx) return;
    upstreamResolved = true;
    const total = storedCtx.hooks.get("_getTotal") as (() => number) | undefined;
    if (total && total !== ownGetTotal) upstreamTotal = total;
    const get = storedCtx.hooks.get("_getItem") as ((index: number) => T | undefined) | undefined;
    if (get) upstreamGet = get;
  }

  function currentTotal(): number {
    if (!storedCtx) return 0;
    return upstreamTotal ? upstreamTotal() : storedCtx.items.all().length;
  }

  function syncItemCount(): void {
    if (!storedCtx) return;
    resolveUpstream();
    const total = currentTotal();
    if (total === realTotal) return;
    const savedIndex = currentIndex;
    realTotal = total;
    // With no items at setup there was no size to measure; a fixed spec still
    // says what one is, and a slot preset already knows its step.
    if (stepSize <= 0 && !isVariableWidth) {
      const rawSpec = storedCtx.sizes.rawSpec;
      stepSize = layoutEngine ? layoutEngine.stepSize : typeof rawSpec === "number" ? rawSpec : 0;
      if (stepSize <= 0) return;
      stepSizes = [];
    }
    if (isVariableWidth) {
      const rawSpec = storedCtx.sizes.rawSpec;
      const getSz = typeof rawSpec === "function"
        ? (i: number) => (rawSpec as (index: number) => number)(i) + gapPx
        : () => (rawSpec as number) + gapPx;
      buildStepCache(Array.from({ length: realTotal }, (_, i) => getSz(i)));
    } else {
      buildStepCache(Array.from({ length: realTotal }, () => stepSizes[0] ?? stepSize));
    }
    virtualTotal = realTotal * CYCLES;
    if (!windowInstalled) {
      // The window brings the inflated total and the seeding of the start
      // position (initialScrollPending) with it; the commit that follows does
      // the rest, as it does for a static list.
      installWindow();
      return;
    }
    engineState.totalItems = virtualTotal;
    if (realTotal > 1) {
      const safeIndex = savedIndex < realTotal ? savedIndex : 0;
      currentIndex = safeIndex;
      storedCtx.scroll.to(scrollPositionForVirtual(MIDDLE_CYCLE * realTotal + safeIndex));
    }
  }

  function updateItemLayout(): void {
    if (!storedCtx || realTotal <= 0) return;
    if (!layoutEngine && !isVariableWidth && realTotal <= 1) return;

    const content = storedCtx.dom.content;
    const children = content.children;
    const pos = scroll.getPixelEquivalent();
    const baseOffset = scroll.getRenderOrigin();
    const scrollTop = Math.round(pos - baseOffset);
    const prop = isX ? "width" : "height";
    const { vi: focalVi, frac } = decomposeScroll(pos);
    const baseCycle = focalVi - ((focalVi % realTotal + realTotal) % realTotal);

    const focalWidth = layoutEngine ? (layoutEngine.slotWidths[layoutEngine.focalSlot] ?? 0) : 0;

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

        let roleWeight: number;
        if (textFade === "size") {
          const maxSize = layoutEngine!.slotWidths[layoutEngine!.focalSlot] ?? 1;
          roleWeight = Math.min(1, Math.max(0, roundedSize / maxSize));
        } else if (textFade === "viewport") {
          const vpOffset = roundedOffset - scrollTop;
          const vStart = Math.max(0, vpOffset);
          const vEnd = Math.min(engineState.containerSize, vpOffset + roundedSize);
          const vRatio = roundedSize > 0 ? Math.max(0, (vEnd - vStart) / roundedSize) : 0;
          roleWeight = Math.min(1, vRatio);
        } else {
          roleWeight = layout.role === "large" ? 1 - layout.progress : 0;
        }
        el.style.setProperty("--vlist-carousel-progress", layout.progress.toFixed(3));
        el.style.setProperty("--vlist-carousel-offset", String(layout.relOffset));
        el.style.setProperty("--vlist-carousel-role", layout.role);
        el.style.setProperty("--vlist-carousel-role-weight", roleWeight.toFixed(3));
        el.style.setProperty("--vlist-carousel-width", roundedSize + "px");
        el.style.setProperty("--vlist-carousel-focal-width", focalWidth + "px");
      }
    } else {
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
        const roundedOffset = Math.round(absOffset - baseOffset);

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
        let roleWeight: number;
        if (textFade === "viewport" || textFade === "size") {
          const vpOffset = roundedOffset - scrollTop;
          const vStart = Math.max(0, vpOffset);
          const vEnd = Math.min(engineState.containerSize, vpOffset + itemSize);
          const vRatio = itemSize > 0 ? Math.max(0, (vEnd - vStart) / itemSize) : 0;
          roleWeight = Math.min(1, vRatio);
        } else {
          roleWeight = 1 - progress;
        }
        el.style.setProperty("--vlist-carousel-progress", progress.toFixed(3));
        el.style.setProperty("--vlist-carousel-offset", String(relOffset));
        el.style.setProperty("--vlist-carousel-role", "large");
        el.style.setProperty("--vlist-carousel-role-weight", roleWeight.toFixed(3));
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
      storedCtx.scroll.to(nearestPos);
      updateItemLayout();
    }
  }

  /**
   * Bring an already-clamped logical index into view in the current virtual
   * lap. `navigateTo` takes the shortest path, which wraps; selectNext /
   * selectPrevious clamp via moveFocus and must not jump 50 laps to the
   * hard start of the window or travel the long way around at an end.
   *
   * Instant: a player's Next button has to show the track, and the
   * keyboard path still owns the snap animation through next()/navigate().
   */
  function revealInCurrentLap(logicalTarget: number): void {
    if (!storedCtx) return;
    const target = realTotal <= 0 ? 0 : Math.max(0, Math.min(logicalTarget, realTotal - 1));
    currentIndex = target;
    if (realTotal <= 1) {
      storedCtx.render.force();
      return;
    }
    storedCtx.scroll.cancel();
    const baseVi = getBaseVi();
    const currentLogical = logicalIndexOf(baseVi);
    const targetVi = baseVi + (target - currentLogical);
    intendedVi = targetVi;
    storedCtx.scroll.to(scrollPositionForVirtual(targetVi));
    storedCtx.render.force();
    updateItemLayout();
  }

  return {
    name: "carousel",
    priority: 10,
    // Layout tier, like groups. They used to share priority 10 — so setup
    // order was array order and the pair broke differently depending on which
    // the caller wrote first. This plugin assigns its size-cache methods
    // directly; groups calls setSizeConfig, which Object.assigns a fresh
    // cache over them.
    conflicts: ["groups"],

    setup(ctx: PluginContext<T>): void {
      scroll = ctx.scroll;
      engineState = ctx.getState();
      sizeCache = ctx.sizes.cache;
      storedCtx = ctx;
      isX = ctx.config.axis.primary === "x";
      prefix = ctx.config.classPrefix;
      realTotal = engineState.totalItems;
      const baseItemSize = realTotal > 0 ? sizeCache.getSize(0) : 0;
      const containerSize = engineState.containerSize;
      layoutContainerSize = containerSize;
      const peekResolved = resolvePeekSize(containerSize);
      const presetResult = resolveSlots(containerSize, peekResolved);
      if (hasSlots(presetResult)) {
        textFade = presetResult.textFade ?? "role";
        layoutEngine = createLayoutEngine({
          slots: presetResult.slots,
          focalSlot: presetResult.focalSlot,
          containerSize,
          gap: gapPx,
        });
        stepSize = layoutEngine.stepSize;
        buildStepCache(Array.from({ length: Math.max(1, realTotal) }, () => stepSize));
        isVariableWidth = false;
      } else if (typeof ctx.sizes.rawSpec === "function") {
        textFade = presetResult?.textFade ?? "viewport";
        const rawFn = ctx.sizes.rawSpec as (index: number) => number;
        buildStepCache(Array.from({ length: realTotal }, (_, i) => rawFn(i) + gapPx));
        stepSize = stepSizes[0] ?? baseItemSize;
        isVariableWidth = true;
      } else {
        textFade = presetResult?.textFade ?? "viewport";
        stepSize = baseItemSize;
        buildStepCache(Array.from({ length: Math.max(1, realTotal) }, () => stepSize));
        isVariableWidth = false;
      }
      virtualTotal = realTotal * CYCLES;
      currentIndex = resolveIndex(initialIndex);

      // ── Virtual scroll window ─────────────────────────────────────

      if (realTotal > 1) installWindow();

      // ── next / prev / goTo ──────────────────────────────────────

      ctx.hooks.method("next", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const prevIndex = currentIndex;
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        storedCtx!.scroll.cancel();
        const baseVi = getBaseVi();
        const targetVi = baseVi + s;
        intendedVi = targetVi;
        currentIndex = logicalIndexOf(targetVi);
        const nearestPos = scrollPositionForVirtual(targetVi);

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scroll.to(nearestPos);
          updateItemLayout();
        }
        if (currentIndex !== prevIndex) {
          storedCtx!.emitter.emit("carousel:change" as any, { index: currentIndex, scrollPosition: scroll.getPixelEquivalent() });
        }
      });

      ctx.hooks.method("prev", (step?: number, options?: { behavior?: string; duration?: number }): void => {
        if (realTotal <= 1) return;
        const s = step ?? 1;
        const prevIndex = currentIndex;
        const smooth = options?.behavior !== "auto";
        const dur = options?.duration ?? snapDuration;

        storedCtx!.scroll.cancel();
        const baseVi = getBaseVi();
        const targetVi = baseVi - s;
        intendedVi = targetVi;
        currentIndex = logicalIndexOf(targetVi);
        const nearestPos = scrollPositionForVirtual(targetVi);

        if (smooth) {
          smoothScrollTo(nearestPos, dur);
        } else {
          storedCtx!.scroll.to(nearestPos);
          updateItemLayout();
        }
        if (currentIndex !== prevIndex) {
          storedCtx!.emitter.emit("carousel:change" as any, { index: currentIndex, scrollPosition: scroll.getPixelEquivalent() });
        }
      });

      ctx.hooks.method("goTo", (index: number, options?: {
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

        storedCtx!.scroll.cancel();

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
            storedCtx!.scroll.to(nearestPos);
            updateItemLayout();
          }
        } else {
          navigateTo(target, smooth, dur);
        }
      });

      // ── getCarouselState ────────────────────────────────────────

      ctx.hooks.method("getCarouselState", (): CarouselState => {
        const pos = scroll.getPixelEquivalent();
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

      ctx.scroll.setToIndexFn((index, _align, behavior, duration, _easing): void | false => {
        if (realTotal <= 1) return false;
        const target = resolveIndex(index);
        const smooth = behavior === "smooth";
        const dur = duration ?? snapDuration;
        navigateTo(target, smooth, dur);
      });

      // ── Keyboard nav integration with selection ─────────────────

      // One key, two handlers: this plugin's runs first and starts the snap,
      // then selection() asks nav.navigate where focus goes. Answering by
      // moving as well jumped the list to the target and back within a frame,
      // and moved from selection's focus rather than from where the carousel
      // was — so quick presses left the two an item apart. While a key is being
      // handled here, navigate only reports the index this carousel is already
      // going to, and focus follows it.
      //
      // The flag is cleared in a microtask: core dispatches every keydown
      // handler synchronously, so all of them have run by the time it fires.
      let handlingKey = false;
      const holdKey = (): void => {
        handlingKey = true;
        queueMicrotask(() => { handlingKey = false; });
      };

      ctx.nav.set({
        total: () => realTotal,
        reveal: revealInCurrentLap,
        navigate: (current: number, key: string, total: number): number => {
          if (handlingKey) return currentIndex;
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
            storedCtx?.render.force();
            updateItemLayout();
          }
          return target;
        },
      });

      // ── Built-in keyboard navigation ──────────────────────────

      if (!ctx.dom.content.getAttribute("tabindex")) {
        ctx.dom.content.setAttribute("tabindex", "0");
      }

      const navNext = ctx.hooks.get("next") as Function;
      const navPrev = ctx.hooks.get("prev") as Function;
      const navGoTo = ctx.hooks.get("goTo") as Function;

      ctx.hooks.onKeydown((event: KeyboardEvent): void => {
        const key = event.key;
        if (key === "ArrowRight" || key === "ArrowDown") {
          event.preventDefault();
          holdKey();
          navNext(1, { behavior: "smooth", duration: snapDuration });
        } else if (key === "ArrowLeft" || key === "ArrowUp") {
          event.preventDefault();
          holdKey();
          navPrev(1, { behavior: "smooth", duration: snapDuration });
        } else if (key === "Home") {
          event.preventDefault();
          holdKey();
          navGoTo(0, { behavior: "smooth", duration: snapDuration });
        } else if (key === "End") {
          event.preventDefault();
          holdKey();
          navGoTo(realTotal - 1, { behavior: "smooth", duration: snapDuration });
        }
      });

      // ── Destroy handler ─────────────────────────────────────────

      ctx.hooks.onDestroy(() => {
        storedCtx?.scroll.cancel();
      });
    },

    destroy(): void {
      storedCtx?.scroll.cancel();
      storedCtx = null;
    },

    hooks: {
      onResize(): void {
        if (!storedCtx) return;
        const containerSize = engineState.containerSize;
        if (Math.abs(containerSize - layoutContainerSize) < 1) return;
        layoutContainerSize = containerSize;
        const preset = resolveSlots(containerSize, resolvePeekSize(containerSize));
        if (!hasSlots(preset)) return;

        layoutEngine = createLayoutEngine({
          slots: preset.slots, focalSlot: preset.focalSlot, containerSize, gap: gapPx,
        });
        textFade = preset.textFade ?? "role";
        stepSize = layoutEngine.stepSize;
        buildStepCache(Array.from({ length: Math.max(1, realTotal) }, () => stepSize));
        isVariableWidth = false;

        // Re-anchor in the middle lap using the new step widths. Mark the
        // target before refreshing the runway so intermediate commits cannot
        // interpret old pixels as a different focal item.
        intendedVi = virtualIndexOf(currentIndex);
        lastDirection = 0;
        storedCtx.render.contentSize(sizeCache.getTotalSize());
        storedCtx.scroll.to(scrollPositionForVirtual(intendedVi));
        storedCtx.render.force();
        updateItemLayout();
        intendedVi = -1;
      },

      onCommit(): void {
        if (!storedCtx) return;
        // Under an adapter the total arrives through a render, not a scroll.
        syncItemCount();
        if (!initialScrollPending) return;
        initialScrollPending = false;

        // The first render used scrollPosition=0. Seed the real start
        // position through the handler so baseOffset/scrollTop stay
        // consistent, then re-render at the correct offset.
        const startPos = scrollPositionForVirtual(virtualIndexOf(currentIndex));
        storedCtx.scroll.to(startPos);
        storedCtx.render.force();
        updateItemLayout();
      },

      onAfterScroll(_scrollPosition: number): void {
        if (initialScrollPending || !storedCtx) return;
        syncItemCount();
        if (realTotal <= 1) return;

        if (engineState.scrollDirection !== 0) lastDirection = engineState.scrollDirection;

        if (intendedVi < 0) {
          const pos = scroll.getPixelEquivalent();
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

      onIdle(): void {
        // Still snapping: the destination is already known, and forgetting it
        // here is what loses a key press. But an animation can land a hair
        // early, with an idle arriving inside the deadline: then the snap
        // below is what settles the last 0.001px, so it must run.
        if (snapUntil > performance.now() && intendedVi >= 0
          && Math.abs(scroll.getPixelEquivalent() - scrollPositionForVirtual(intendedVi)) > 0.5) return;
        snapUntil = 0;
        const dir = lastDirection;
        intendedVi = -1;
        lastDirection = 0;
        if (!snapEnabled || !storedCtx || realTotal <= 1) return;
        const p = scroll.getPixelEquivalent();
        const { vi, frac } = decomposeScroll(p);

        let snapVi: number;
        if (snapDirectional && dir !== 0 && frac > 0.02 && frac < 0.98) {
          snapVi = dir > 0 ? vi + 1 : vi;
        } else {
          snapVi = frac >= 0.5 ? vi + 1 : vi;
        }

        const snapTarget = scrollPositionForVirtual(snapVi);
        if (Math.abs(p - snapTarget) > 1) {
          currentIndex = logicalIndexOf(snapVi);
          smoothScrollTo(snapTarget, snapDuration);
        }
      },
    },
  };
}
