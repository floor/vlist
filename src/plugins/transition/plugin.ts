/**
 * vlist v2 — Transition Plugin
 *
 * FLIP-based enter/exit animations for insertItem and removeItem.
 * Without this plugin, insert/remove are instantaneous.
 *
 * Priority: 45 (before selection, after most layout plugins)
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";

// =============================================================================
// Config
// =============================================================================

export interface TransitionTiming {
  duration?: number;
  easing?: string;
}

export interface TransitionPluginConfig {
  duration?: number;
  easing?: string;
  insert?: TransitionTiming | false;
  remove?: TransitionTiming | false;
}

// =============================================================================
// Internals
// =============================================================================

interface ResolvedTiming {
  duration: number;
  easing: string;
}

const DEFAULT_DURATION = 200;
const MAX_DURATION = 1000;
const DEFAULT_EASING = "cubic-bezier(0.2, 0, 0, 1)";

function resolveTiming(
  base: { duration: number; easing: string },
  override?: TransitionTiming | false,
): ResolvedTiming | null {
  if (override === false) return null;
  return {
    duration: Math.min(override?.duration ?? base.duration, MAX_DURATION),
    easing: override?.easing ?? base.easing,
  };
}

// =============================================================================
// Factory
// =============================================================================

export function transition<T extends VListItem = VListItem>(
  config?: TransitionPluginConfig,
): VListPlugin<T> {
  const baseDuration = config?.duration ?? DEFAULT_DURATION;
  const baseEasing = config?.easing ?? DEFAULT_EASING;
  const base = { duration: baseDuration, easing: baseEasing };

  const removeTiming = resolveTiming(base, config?.remove);
  const insertTiming = resolveTiming(base, config?.insert);

  let removePending: (() => void) | null = null;
  let addPending: (() => void) | null = null;

  return {
    name: "transition",
    conflicts: ["grid", "table", "masonry"],
    priority: 45,

    setup(ctx: PluginContext<T>): void {
      const { sizeCache: sc, emitter } = ctx;
      const cfg = ctx.config;
      const dom = ctx.dom;
      const state = ctx.getState();
      const origin = cfg.reverse ? "bottom center" : "top center";
      const prop = cfg.horizontal ? "translateX" : "translateY";

      const toLayout = (ctx.getMethod("_dataToLayoutIndex") as ((i: number) => number)) ?? null;
      const dataToLayout = (dataIndex: number): number =>
        toLayout ? toLayout(dataIndex) : dataIndex;

      const findById = (id: string | number): { el: HTMLElement | null; layoutIndex: number } => {
        const eid = String(id).replace(/"/g, '\\"');
        const el = dom.content.querySelector(`[data-id="${eid}"]`) as HTMLElement | null;
        const layoutIndex = el ? parseInt(el.dataset.index ?? "-1", 10) : -1;
        return { el, layoutIndex };
      };

      const commitStyles = (): void => {
        const children = dom.content.children;
        for (let i = 0; i < children.length; i++) {
          (children[i] as HTMLElement).style.transition = "none";
        }
        dom.content.offsetHeight;
        for (let i = 0; i < children.length; i++) {
          (children[i] as HTMLElement).style.transition = "";
        }
      };

      // ── Animated removeItem ──────────────────────────────────

      if (removeTiming) {
        const removeItem = (id: string | number): boolean => {
          if (removePending) removePending();

          const active = typeof document !== "undefined" ? document.activeElement : null;
          const focIdx = active && dom.content.contains(active)
            ? parseInt((active as HTMLElement).dataset?.index ?? "-1", 10)
            : -1;

          const found = findById(id);
          const layoutIndex = found.layoutIndex;
          const removedEl = found.el;
          const itemSize = layoutIndex >= 0 ? sc.getSize(layoutIndex) : 0;
          const originalOffset = layoutIndex >= 0 ? sc.getOffset(layoutIndex) : 0;

          if (!removedEl || layoutIndex < 0) {
            const result = ctx.removeItemById(id);
            if (result < 0) return false;
            ctx.forceRender();
            commitStyles();
            emitter.emit("data:change", { type: "remove", id });
            if (focIdx >= 0) {
              const t = state.totalItems;
              if (t > 0) ctx.getRenderedElement(Math.min(focIdx, t - 1))?.focus();
            }
            emitter.emit("remove:end", { id });
            return true;
          }

          // FIRST — clone before removal
          const exitClone = removedEl.cloneNode(true) as HTMLElement;
          exitClone.style.pointerEvents = "none";
          exitClone.style.overflow = "hidden";
          exitClone.removeAttribute("data-index");
          exitClone.removeAttribute("data-id");
          exitClone.removeAttribute("id");
          exitClone.removeAttribute("aria-selected");
          exitClone.classList.remove(`${cfg.classPrefix}-item--selected`);

          const scrollProp = cfg.horizontal ? "scrollLeft" : "scrollTop";
          const oldScroll = dom.viewport[scrollProp];

          // LAST — remove data + reconcile
          const result = ctx.removeItemById(id);
          if (result < 0) return false;
          ctx.forceRender();
          commitStyles();
          emitter.emit("data:change", { type: "remove", id });

          const scrollDelta = oldScroll - dom.viewport[scrollProp];

          exitClone.style.zIndex = "1";
          dom.content.appendChild(exitClone);

          const rt = removeTiming;
          const animOptions: KeyframeAnimationOptions = { duration: rt.duration, easing: rt.easing };
          const animations: Animation[] = [];

          const cloneStart = Math.round(originalOffset - scrollDelta);
          animations.push(exitClone.animate([
            { transform: `${prop}(${cloneStart}px) scaleY(1)`, opacity: 1, transformOrigin: origin },
            { transform: `${prop}(${Math.round(originalOffset)}px) scaleY(0)`, opacity: 0, transformOrigin: origin },
          ], animOptions));

          const allOnClamp = scrollDelta > 0;
          const itemChildren = dom.content.children;
          for (let i = 0; i < itemChildren.length; i++) {
            const el = itemChildren[i] as HTMLElement;
            if (el === exitClone) continue;
            const idx = parseInt(el.dataset?.index ?? "-1", 10);
            if (idx < 0 || (!allOnClamp && idx < layoutIndex)) continue;
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
              const t = state.totalItems;
              if (t > 0) ctx.getRenderedElement(Math.min(focIdx, t - 1))?.focus();
            }
            emitter.emit("remove:end", { id });
          };

          removePending = finalize;
          Promise.all(animations.map(a => a.finished)).then(finalize, finalize);
          setTimeout(finalize, rt.duration + 50);

          return true;
        };

        // ── Batch removeItems ──────────────────────────────────

        const removeItems = (ids: ReadonlyArray<string | number>): number => {
          if (ids.length === 0) return 0;
          if (ids.length === 1) return removeItem(ids[0]!) ? 1 : 0;

          if (removePending) removePending();
          if (addPending) addPending();

          const active = typeof document !== "undefined" ? document.activeElement : null;
          const focIdx = active && dom.content.contains(active)
            ? parseInt((active as HTMLElement).dataset?.index ?? "-1", 10)
            : -1;

          const targets: Array<{
            id: string | number;
            layoutIndex: number;
            el: HTMLElement | null;
            size: number;
            offset: number;
          }> = [];

          for (const id of ids) {
            const found = findById(id);
            targets.push({
              id,
              layoutIndex: found.layoutIndex,
              el: found.el,
              size: found.layoutIndex >= 0 ? sc.getSize(found.layoutIndex) : 0,
              offset: found.layoutIndex >= 0 ? sc.getOffset(found.layoutIndex) : 0,
            });
          }

          targets.sort((a, b) => b.layoutIndex - a.layoutIndex);

          const clones: Array<{
            clone: HTMLElement;
            offset: number;
            size: number;
            layoutIndex: number;
          }> = [];

          for (const t of targets) {
            if (!t.el || t.layoutIndex < 0) continue;
            const clone = t.el.cloneNode(true) as HTMLElement;
            clone.style.pointerEvents = "none";
            clone.style.overflow = "hidden";
            clone.removeAttribute("data-index");
            clone.removeAttribute("data-id");
            clone.removeAttribute("id");
            clone.removeAttribute("aria-selected");
            clone.classList.remove(`${cfg.classPrefix}-item--selected`);
            clones.push({ clone, offset: t.offset, size: t.size, layoutIndex: t.layoutIndex });
          }

          const oldOffsetById = new Map<string, number>();
          const children = dom.content.children;
          for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            const elId = el.dataset?.id;
            const idx = parseInt(el.dataset?.index ?? "-1", 10);
            if (elId && idx >= 0) oldOffsetById.set(elId, sc.getOffset(idx));
          }

          const scrollProp = cfg.horizontal ? "scrollLeft" : "scrollTop";
          const oldScroll = dom.viewport[scrollProp];

          // Remove all items (descending order preserved)
          const removedIds: (string | number)[] = [];
          for (const t of targets) {
            const result = ctx.removeItemById(t.id);
            if (result >= 0) removedIds.push(t.id);
          }

          if (removedIds.length === 0) return 0;

          ctx.forceRender();
          commitStyles();

          for (const rid of removedIds) {
            emitter.emit("data:change", { type: "remove", id: rid });
          }

          if (clones.length === 0) {
            if (focIdx >= 0) {
              const t = state.totalItems;
              if (t > 0) ctx.getRenderedElement(Math.min(focIdx, t - 1))?.focus();
            }
            for (const rid of removedIds) emitter.emit("remove:end", { id: rid });
            return removedIds.length;
          }

          const scrollDelta = oldScroll - dom.viewport[scrollProp];
          const rt = removeTiming;
          const animOptions: KeyframeAnimationOptions = { duration: rt.duration, easing: rt.easing };
          const animations: Animation[] = [];

          clones.sort((a, b) => a.layoutIndex - b.layoutIndex);
          let removedSizeAbove = 0;
          for (const c of clones) {
            c.clone.style.zIndex = "1";
            dom.content.appendChild(c.clone);
            const cloneStart = Math.round(c.offset - scrollDelta);
            const shiftedEnd = Math.round(c.offset - removedSizeAbove);
            animations.push(c.clone.animate([
              { transform: `${prop}(${cloneStart}px) scaleY(1)`, opacity: 1, transformOrigin: origin },
              { transform: `${prop}(${shiftedEnd}px) scaleY(0)`, opacity: 0, transformOrigin: origin },
            ], animOptions));
            removedSizeAbove += c.size;
          }

          const cloneSet = new Set(clones.map(c => c.clone));
          const itemChildren = dom.content.children;
          for (let i = 0; i < itemChildren.length; i++) {
            const el = itemChildren[i] as HTMLElement;
            if (cloneSet.has(el)) continue;
            const elId = el.dataset?.id;
            const idx = parseInt(el.dataset?.index ?? "-1", 10);
            if (!elId || idx < 0) continue;
            const oldOffset = oldOffsetById.get(elId);
            if (oldOffset === undefined) continue;
            const newOffset = sc.getOffset(idx);
            const oldVisual = Math.round(oldOffset - scrollDelta);
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
            for (const { clone } of clones) clone.remove();
            for (const a of animations) {
              if (a.playState !== "finished") a.cancel();
            }
            if (focIdx >= 0) {
              const t = state.totalItems;
              if (t > 0) ctx.getRenderedElement(Math.min(focIdx, t - 1))?.focus();
            }
            for (const rid of removedIds) emitter.emit("remove:end", { id: rid });
          };

          removePending = finalize;
          Promise.all(animations.map(a => a.finished)).then(finalize, finalize);
          setTimeout(finalize, rt.duration + 50);

          return removedIds.length;
        };

        ctx.registerMethod("removeItem", removeItem);
        ctx.registerMethod("removeItems", removeItems);
      }

      // ── Animated insertItem ────────────────────────────────────

      if (insertTiming) {
        const insertItem = (item: T, index?: number): void => {
          if (addPending) addPending();
          if (removePending) removePending();

          const insertDataIndex = index ?? 0;

          const oldOffsetById = new Map<string, number>();
          const children = dom.content.children;
          for (let i = 0; i < children.length; i++) {
            const el = children[i] as HTMLElement;
            const id = el.dataset?.id;
            const idx = parseInt(el.dataset?.index ?? "-1", 10);
            if (id && idx >= 0) oldOffsetById.set(id, sc.getOffset(idx));
          }

          const scrollProp = cfg.horizontal ? "scrollLeft" : "scrollTop";
          const sizeProp = cfg.horizontal ? "scrollWidth" : "scrollHeight";
          const clientProp = cfg.horizontal ? "clientWidth" : "clientHeight";
          const oldScroll = dom.viewport[scrollProp];
          const oldMaxScroll = dom.viewport[sizeProp] - dom.viewport[clientProp];
          const wasAtEnd = oldScroll >= oldMaxScroll - 1;

          ctx.insertItemAt(item, insertDataIndex);
          ctx.forceRender();
          commitStyles();
          emitter.emit("data:change", { type: "insert", id: item.id });

          let scrollDelta = dom.viewport[scrollProp] - oldScroll;
          const postInsertLayoutIndex = dataToLayout(insertDataIndex);

          if (cfg.reverse && scrollDelta === 0 && wasAtEnd) {
            dom.viewport[scrollProp] = dom.viewport[sizeProp] - dom.viewport[clientProp];
            const bumped = dom.viewport[scrollProp];
            state.prevScrollPosition = state.scrollPosition;
            state.scrollPosition = bumped;
            scrollDelta = bumped - oldScroll;
            if (scrollDelta > 0) {
              ctx.forceRender();
              commitStyles();
            }
          }

          const newEl = ctx.getRenderedElement(postInsertLayoutIndex);
          const at = insertTiming;
          const animOptions: KeyframeAnimationOptions = { duration: at.duration, easing: at.easing };
          const animations: Animation[] = [];

          if (newEl) {
            const newOffset = sc.getOffset(postInsertLayoutIndex);
            animations.push(newEl.animate([
              { transform: `${prop}(${Math.round(newOffset)}px) scaleY(0)`, opacity: 0, transformOrigin: origin },
              { transform: `${prop}(${Math.round(newOffset)}px) scaleY(1)`, opacity: 1, transformOrigin: origin },
            ], animOptions));
          }

          const postChildren = dom.content.children;
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

        ctx.registerMethod("insertItem", insertItem);
      }
    },

    destroy(): void {
      if (removePending) removePending();
      if (addPending) addPending();
    },
  };
}
