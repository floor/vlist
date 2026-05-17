/**
 * withTransition — FLIP-based enter/exit animations for insertItem and removeItem.
 *
 * Opt-in feature that replaces the immediate insert/remove with animated versions:
 * - removeItem: clone collapses via scaleY(0), siblings slide up
 * - insertItem: new element expands in, siblings slide down
 *
 * Without this feature, insert/remove are instantaneous.
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

// =============================================================================
// Config
// =============================================================================

/** Per-animation timing overrides. */
export interface TransitionTiming {
  /** Duration in ms */
  duration?: number;
  /** CSS easing function */
  easing?: string;
}

export interface TransitionConfig {
  /** Shared duration in ms (default: 150). Overridden by add/remove sub-configs. */
  duration?: number;
  /** Shared CSS easing (default: MD3 emphasized). Overridden by add/remove sub-configs. */
  easing?: string;
  /** Insert animation config, or `false` to disable. */
  insert?: TransitionTiming | false;
  /** Remove animation config, or `false` to disable. */
  remove?: TransitionTiming | false;
}

// =============================================================================
// Internals
// =============================================================================

interface ResolvedTiming {
  duration: number;
  easing: string;
  tTransform: string;
  tTransformOpacity: string;
}

const DEFAULT_DURATION = 200;
const DEFAULT_EASING = "cubic-bezier(0.2, 0, 0, 1)";

function resolveTiming(
  base: { duration: number; easing: string },
  override?: TransitionTiming | false,
): ResolvedTiming | null {
  if (override === false) return null;
  const d = override?.duration ?? base.duration;
  const e = override?.easing ?? base.easing;
  const t = `transform ${d}ms ${e}`;
  return { duration: d, easing: e, tTransform: t, tTransformOpacity: `${t}, opacity ${d}ms ${e}` };
}

// =============================================================================
// Feature factory
// =============================================================================

export function withTransition<T extends VListItem = VListItem>(
  config?: TransitionConfig,
): VListFeature<T> {
  const baseDuration = config?.duration ?? DEFAULT_DURATION;
  const baseEasing = config?.easing ?? DEFAULT_EASING;
  const base = { duration: baseDuration, easing: baseEasing };

  const removeTiming = resolveTiming(base, config?.remove);
  const insertTiming = resolveTiming(base, config?.insert);

  let ctx: BuilderContext<T>;
  let origin: string;
  let removePending: (() => void) | null = null;
  let addPending: (() => void) | null = null;
  let ensureRangePending = false;
  let toLayout: ((dataIndex: number) => number) | null = null;
  let baseInsertItem: ((item: T, index?: number) => void) | null = null;
  let baseRemoveItem: ((id: string | number) => boolean) | null = null;

  const scheduleEnsureRange = (): void => {
    if (ensureRangePending) return;
    const dm = ctx.dataManager as any;
    if (typeof dm.ensureRange !== "function") return;
    ensureRangePending = true;
    queueMicrotask(() => {
      ensureRangePending = false;
      const t = ctx.dataManager.getTotal();
      const { start, end } = ctx.state.viewportState.renderRange;
      if (t > 0 && end >= start) dm.ensureRange(start, end).catch(() => {});
    });
  };

  const getElement = (index: number): HTMLElement | null =>
    (ctx.renderer as any).getElement(index);

  /** Convert data index to layout index (accounts for group headers). */
  const dataToLayout = (dataIndex: number): number =>
    toLayout ? toLayout(dataIndex) : dataIndex;

  /** Collect DOM children matching a data-index predicate in a single pass. */
  const collectAffected = (
    container: HTMLElement,
    skip: HTMLElement | null,
    predicate: (idx: number) => boolean,
  ): Array<{ el: HTMLElement; idx: number }> => {
    const result: Array<{ el: HTMLElement; idx: number }> = [];
    const children = container.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      if (el === skip) continue;
      const idx = parseInt(el.dataset?.index ?? "-1", 10);
      if (idx >= 0 && predicate(idx)) result.push({ el, idx });
    }
    return result;
  };

  // ── Animated removeItem ──────────────────────────────────────────

  const removeItem = (id: string | number): boolean => {
    if (removePending) removePending();

    const { dom, sizeCache: sc, config: cfg, emitter } = ctx;
    const prop = cfg.horizontal ? "translateX" : "translateY";

    const active =
      typeof document !== "undefined" ? document.activeElement : null;
    const focIdx =
      active && dom.items.contains(active)
        ? parseInt((active as HTMLElement).dataset?.index ?? "-1", 10)
        : -1;

    const dataIndex = ctx.dataManager.getIndexById(id);
    const layoutIndex = dataIndex >= 0 ? dataToLayout(dataIndex) : -1;
    const removedEl = layoutIndex >= 0 ? getElement(layoutIndex) : null;
    const itemSize = layoutIndex >= 0 ? sc.getSize(layoutIndex) : 0;
    const originalOffset = layoutIndex >= 0 ? sc.getOffset(layoutIndex) : 0;

    // Off-screen — immediate removal, no animation
    if (!removedEl || layoutIndex < 0) {
      const result = baseRemoveItem ? baseRemoveItem(id) : ctx.dataManager.removeItem(id);
      if (!result) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[vlist] removeItem() could not find item with id "${id}".`,
          );
        }
        return false;
      }
      ctx.forceRender();
      emitter.emit("data:change", { type: "remove", id });
      scheduleEnsureRange();
      if (focIdx >= 0) {
        const t = ctx.getVirtualTotal();
        if (t > 0) getElement(Math.min(focIdx, t - 1))?.focus();
      }
      emitter.emit("remove:end", { id });
      return true;
    }

    // FIRST — clone element before removal destroys it
    const exitClone = removedEl.cloneNode(true) as HTMLElement;
    exitClone.style.pointerEvents = "none";
    exitClone.style.overflow = "hidden";
    exitClone.removeAttribute("data-index");
    exitClone.removeAttribute("data-id");
    exitClone.removeAttribute("id");
    exitClone.removeAttribute("aria-selected");
    exitClone.classList.remove(`${cfg.classPrefix}-item--selected`);

    // Capture scroll position before removal (for bottom-of-list compensation)
    const scrollProp = cfg.horizontal ? "scrollLeft" : "scrollTop";
    const oldScroll = dom.viewport[scrollProp];

    // LAST — remove data + reconcile DOM
    const result = baseRemoveItem ? baseRemoveItem(id) : ctx.dataManager.removeItem(id);
    if (!result) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[vlist] removeItem() could not find item with id "${id}".`,
        );
      }
      return false;
    }
    ctx.forceRender();
    emitter.emit("data:change", { type: "remove", id });
    scheduleEnsureRange();

    // Detect scroll clamp (content shrank, browser clamped scroll position)
    const scrollDelta = oldScroll - dom.viewport[scrollProp];

    // Pin clone at original position (adjusted for scroll shift)
    exitClone.style.transition = "none";
    exitClone.style.transformOrigin = origin;
    exitClone.style.transform = `${prop}(${Math.round(originalOffset - scrollDelta)}px) scaleY(1)`;
    exitClone.style.zIndex = "1";
    dom.items.appendChild(exitClone);

    const rt = removeTiming!;
    const animOptions: KeyframeAnimationOptions = { duration: rt.duration, easing: rt.easing };
    const animations: Animation[] = [];

    // Animate clone: scaleY(1→0), opacity(1→0)
    animations.push(exitClone.animate([
      { transform: `${prop}(${Math.round(originalOffset - scrollDelta)}px) scaleY(1)`, opacity: 1, transformOrigin: origin },
      { transform: `${prop}(${Math.round(originalOffset)}px) scaleY(0)`, opacity: 0, transformOrigin: origin },
    ], animOptions));

    // Animate siblings from old visual positions to new positions
    const affected = collectAffected(dom.items, exitClone,
      scrollDelta > 0 ? () => true : (i) => i >= layoutIndex);

    for (let i = 0; i < affected.length; i++) {
      const { el, idx } = affected[i]!;
      const newOffset = sc.getOffset(idx);
      const oldVisual = idx >= layoutIndex
        ? Math.round(newOffset + itemSize - scrollDelta)
        : Math.round(newOffset - scrollDelta);
      const newVisual = Math.round(newOffset);
      if (oldVisual === newVisual) continue;
      animations.push(el.animate([
        { transform: `${prop}(${oldVisual}px)` },
        { transform: `${prop}(${newVisual}px)` },
      ], animOptions));
    }

    let settled = false;
    const finalize = (): void => {
      if (settled) return;
      settled = true;
      removePending = null;
      exitClone.remove();
      for (const a of animations) {
        if (a.playState !== "finished") a.cancel();
      }
      if (focIdx >= 0) {
        const t = ctx.getVirtualTotal();
        if (t > 0) getElement(Math.min(focIdx, t - 1))?.focus();
      }
      emitter.emit("remove:end", { id });
    };

    removePending = finalize;
    Promise.all(animations.map(a => a.finished)).then(finalize, finalize);
    setTimeout(finalize, rt.duration + 50);

    return true;
  };

  // ── Animated insertItem (Web Animations API) ─────────────────────

  const insertItem = (item: T, index?: number): void => {
    if (addPending) addPending();
    if (removePending) removePending();

    const { dom, sizeCache: sc, config: cfg, emitter } = ctx;
    const prop = cfg.horizontal ? "translateX" : "translateY";
    const insertDataIndex = index ?? 0;

    // FIRST — capture ALL visible elements' offsets by item ID
    const oldOffsetById = new Map<string, number>();
    const children = dom.items.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      const id = el.dataset?.id;
      const idx = parseInt(el.dataset?.index ?? "-1", 10);
      if (id && idx >= 0) oldOffsetById.set(id, sc.getOffset(idx));
    }

    const scrollProp = cfg.horizontal ? "scrollLeft" : "scrollTop";
    const oldScroll = dom.viewport[scrollProp];

    // INSERT — mutate data + reconcile DOM
    if (baseInsertItem) {
      baseInsertItem(item, insertDataIndex);
    } else {
      ctx.dataManager.insertItem(item, insertDataIndex);
    }
    ctx.forceRender();
    emitter.emit("data:change", { type: "insert", id: item.id });
    scheduleEnsureRange();

    let scrollDelta = dom.viewport[scrollProp] - oldScroll;
    const postInsertLayoutIndex = dataToLayout(insertDataIndex);

    // Reverse mode: scroll to reveal new item
    if (cfg.reverse && scrollDelta === 0) {
      const maxScroll = dom.viewport[cfg.horizontal ? "scrollWidth" : "scrollHeight"]
        - dom.viewport[cfg.horizontal ? "clientWidth" : "clientHeight"];
      dom.viewport[scrollProp] = maxScroll;
      scrollDelta = dom.viewport[scrollProp] - oldScroll;
      if (scrollDelta > 0) ctx.forceRender();
    }

    const newEl = getElement(postInsertLayoutIndex);
    const at = insertTiming!;
    const animOptions: KeyframeAnimationOptions = { duration: at.duration, easing: at.easing };
    const animations: Animation[] = [];

    // Animate new element: scaleY(0→1), opacity(0→1)
    if (newEl) {
      const newOffset = sc.getOffset(postInsertLayoutIndex);
      animations.push(newEl.animate([
        { transform: `${prop}(${Math.round(newOffset)}px) scaleY(0)`, opacity: 0, transformOrigin: origin },
        { transform: `${prop}(${Math.round(newOffset)}px) scaleY(1)`, opacity: 1, transformOrigin: origin },
      ], animOptions));
    }

    // Animate existing items from old visual positions to new positions
    const postChildren = dom.items.children;
    for (let i = 0; i < postChildren.length; i++) {
      const el = postChildren[i] as HTMLElement;
      if (el === newEl) continue;
      const id = el.dataset?.id;
      const idx = parseInt(el.dataset?.index ?? "-1", 10);
      if (!id || idx < 0) continue;
      const oldOffset = oldOffsetById.get(id);
      if (oldOffset === undefined) continue;
      const newOffset = sc.getOffset(idx);
      const visualOld = Math.round(oldOffset + scrollDelta);
      const visualNew = Math.round(newOffset);
      if (visualOld === visualNew) continue;
      animations.push(el.animate([
        { transform: `${prop}(${visualOld}px)` },
        { transform: `${prop}(${visualNew}px)` },
      ], animOptions));
    }

    if (animations.length === 0) return;

    let settled = false;
    const finalize = (): void => {
      if (settled) return;
      settled = true;
      addPending = null;
      for (const a of animations) {
        if (a.playState !== "finished") a.cancel();
      }
    };
    addPending = finalize;
    Promise.all(animations.map(a => a.finished)).then(finalize, finalize);
    setTimeout(finalize, at.duration + 50);
  };

  // ── Feature definition ───────────────────────────────────────────

  return {
    name: "transition",
    conflicts: ["withGrid", "withTable"] as const,
    priority: 45,
    setup(context: BuilderContext<T>): void {
      ctx = context;
      origin = ctx.config.reverse ? "bottom center" : "top center";
      toLayout = (ctx.methods.get("_dataToLayoutIndex") as ((i: number) => number)) ?? null;
      baseInsertItem = (ctx.methods.get("insertItem") as ((item: T, index?: number) => void)) ?? null;
      baseRemoveItem = (ctx.methods.get("removeItem") as ((id: string | number) => boolean)) ?? null;
      if (removeTiming) ctx.methods.set("removeItem", removeItem);
      if (insertTiming) ctx.methods.set("insertItem", insertItem);
    },
    destroy(): void {
      if (removePending) removePending();
      if (addPending) addPending();
    },
  };
}
