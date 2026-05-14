/**
 * withTransition — FLIP-based enter/exit animations for addItem and removeItem.
 *
 * Opt-in feature that replaces the immediate add/remove with animated versions:
 * - removeItem: clone collapses via scaleY(0), siblings slide up
 * - addItem: new element expands in, siblings slide down
 *
 * Without this feature, add/remove are instantaneous.
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

// =============================================================================
// Config
// =============================================================================

export interface TransitionConfig {
  /** Animation duration in ms (default: 150) */
  duration?: number;
  /** CSS easing function (default: MD3 emphasized) */
  easing?: string;
}

// =============================================================================
// Feature factory
// =============================================================================

export function withTransition<T extends VListItem = VListItem>(
  config?: TransitionConfig,
): VListFeature<T> {
  const duration = config?.duration ?? 150;
  const easing = config?.easing ?? "cubic-bezier(0.2, 0, 0, 1)";

  // Pre-built transition strings — duration/easing are config-level constants
  const tTransform = `transform ${duration}ms ${easing}`;
  const tTransformOpacity = `${tTransform}, opacity ${duration}ms ${easing}`;

  let ctx: BuilderContext<T>;
  let removePending: (() => void) | null = null;
  let addPending: (() => void) | null = null;
  let ensureRangePending = false;

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

  const cleanTransitions = (container: HTMLElement): void => {
    const children = container.children;
    for (let i = 0; i < children.length; i++) {
      (children[i] as HTMLElement).style.transition = "";
    }
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

    const index = ctx.dataManager.getIndexById(id);
    const removedEl = index >= 0 ? getElement(index) : null;
    const itemSize = index >= 0 ? sc.getSize(index) : 0;
    const originalOffset = index >= 0 ? sc.getOffset(index) : 0;

    // Off-screen — immediate removal, no animation
    if (!removedEl || index < 0) {
      const result = ctx.dataManager.removeItem(id);
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

    // LAST — remove data + reconcile DOM
    const result = ctx.dataManager.removeItem(id);
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

    // Pin clone at original position
    exitClone.style.transition = "none";
    exitClone.style.transformOrigin = "top center";
    exitClone.style.transform = `${prop}(${Math.round(originalOffset)}px) scaleY(1)`;
    exitClone.style.zIndex = "1";
    dom.items.appendChild(exitClone);

    // Collect shifted items once — avoids duplicate parseInt + filtering
    const affected = collectAffected(dom.items, exitClone, (i) => i >= index);

    // INVERT — push shifted items back to old positions
    for (let i = 0; i < affected.length; i++) {
      const { el, idx } = affected[i]!;
      el.style.transition = "none";
      el.style.transform = `${prop}(${Math.round(sc.getOffset(idx) + itemSize)}px)`;
    }

    void dom.items.offsetHeight;

    // PLAY — clone collapses via scaleY, items slide to final positions
    exitClone.style.transition = tTransformOpacity;
    exitClone.style.transform = `${prop}(${Math.round(originalOffset)}px) scaleY(0)`;
    exitClone.style.opacity = "0";

    for (let i = 0; i < affected.length; i++) {
      const { el, idx } = affected[i]!;
      el.style.transition = tTransform;
      el.style.transform = `${prop}(${Math.round(sc.getOffset(idx))}px)`;
    }

    let settled = false;
    const finalize = (): void => {
      if (settled) return;
      settled = true;
      removePending = null;
      exitClone.remove();
      cleanTransitions(dom.items);
      if (focIdx >= 0) {
        const t = ctx.getVirtualTotal();
        if (t > 0) getElement(Math.min(focIdx, t - 1))?.focus();
      }
      emitter.emit("remove:end", { id });
    };

    removePending = finalize;
    exitClone.addEventListener(
      "transitionend",
      (e: TransitionEvent) => { if (e.target === exitClone) finalize(); },
      { once: true },
    );
    setTimeout(finalize, duration + 50);

    return true;
  };

  // ── Animated addItem ─────────────────────────────────────────────

  const addItem = (item: T, index?: number): void => {
    if (addPending) addPending();
    if (removePending) removePending();

    const { dom, sizeCache: sc, config: cfg, emitter } = ctx;
    const prop = cfg.horizontal ? "translateX" : "translateY";
    const insertIndex = index ?? 0;

    // FIRST — capture offsets before insertion (single pass)
    const preAffected = collectAffected(dom.items, null, (i) => i >= insertIndex);
    const oldOffsets = new Map<number, number>();
    for (let i = 0; i < preAffected.length; i++) {
      const { idx } = preAffected[i]!;
      oldOffsets.set(idx, sc.getOffset(idx));
    }

    // LAST — insert data + reconcile DOM
    ctx.dataManager.addItem(item, insertIndex);
    ctx.forceRender();
    emitter.emit("data:change", { type: "add", id: item.id });

    const newEl = getElement(insertIndex);
    if (!newEl) return;

    const newOffset = sc.getOffset(insertIndex);

    // INVERT — collapse new element via scaleY(0), push shifted items to old positions
    newEl.style.transition = "none";
    newEl.style.transformOrigin = "top center";
    newEl.style.transform = `${prop}(${Math.round(newOffset)}px) scaleY(0)`;
    newEl.style.opacity = "0";

    // Collect shifted items after DOM reconciliation
    const postAffected = collectAffected(dom.items, newEl, (i) => i > insertIndex);

    for (let i = 0; i < postAffected.length; i++) {
      const { el, idx } = postAffected[i]!;
      const oldOffset = oldOffsets.get(idx - 1);
      if (oldOffset !== undefined) {
        el.style.transition = "none";
        el.style.transform = `${prop}(${Math.round(oldOffset)}px)`;
      }
    }

    void dom.items.offsetHeight;

    // PLAY — expand new element via scaleY(1), slide shifted items to final positions
    newEl.style.transition = tTransformOpacity;
    newEl.style.transform = `${prop}(${Math.round(newOffset)}px) scaleY(1)`;
    newEl.style.opacity = "1";

    for (let i = 0; i < postAffected.length; i++) {
      const { el, idx } = postAffected[i]!;
      el.style.transition = tTransform;
      el.style.transform = `${prop}(${Math.round(sc.getOffset(idx))}px)`;
    }

    let settled = false;
    const finalize = (): void => {
      if (settled) return;
      settled = true;
      addPending = null;
      newEl.style.transition = "";
      newEl.style.transformOrigin = "";
      newEl.style.transform = `${prop}(${Math.round(newOffset)}px)`;
      newEl.style.opacity = "";
      cleanTransitions(dom.items);
    };

    addPending = finalize;
    newEl.addEventListener(
      "transitionend",
      (e: TransitionEvent) => { if (e.target === newEl) finalize(); },
      { once: true },
    );
    setTimeout(finalize, duration + 50);
  };

  // ── Feature definition ───────────────────────────────────────────

  return {
    name: "transition",
    priority: 45,
    setup(context: BuilderContext<T>): void {
      ctx = context;
      ctx.methods.set("removeItem", removeItem);
      ctx.methods.set("addItem", addItem);
    },
    destroy(): void {
      if (removePending) removePending();
      if (addPending) addPending();
    },
  };
}
