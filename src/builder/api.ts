// src/builder/api.ts
/**
 * vlist/builder — Public API Assembly
 *
 * Constructs the public VList API object, base data method wrappers,
 * scroll methods (cancelScroll, animateScroll, scrollToIndex), event
 * subscription (on/off), and the destroy teardown.
 *
 * Extracted from core.ts materialize() — pure wiring with no hot-path
 * implications. All mutable state accessed via the `$` refs bag.
 *
 * Uses positional parameters (not a deps object) so the minifier can
 * rename every argument — no long property-name strings in the bundle.
 */

import type {
  VListItem,
  VListEvents,
  EventHandler,
  Unsubscribe,
  ScrollToOptions,
} from "../types";

import type { Emitter } from "../events/emitter";
import type { DOMStructure } from "./dom";
import type { createElementPool } from "./pool";
import type {
  BuilderContext,
  VListFeature,
  VList,
} from "./types";
import type { MRefs } from "./materialize";
import { easeInOutQuad, resolveScrollArgs } from "./scroll";


// =============================================================================
// Factory
// =============================================================================

export const createApi = <T extends VListItem = VListItem>(
  $: MRefs<T>,
  dom: DOMStructure,
  emitter: Emitter<VListEvents<T>>,
  rendered: Map<number, HTMLElement>,
  pool: ReturnType<typeof createElementPool>,
  methods: Map<string, Function>,
  sortedFeatures: VListFeature<T>[],
  destroyHandlers: Array<() => void>,
  ctx: BuilderContext<T>,
  isReverse: boolean,
  wrapEnabled: boolean,
  handleClick: (event: MouseEvent) => void,
  handleDblClick: (event: MouseEvent) => void,
  handleKeydown: (event: KeyboardEvent) => void,
  onScrollFrame: () => void,
  resizeObserver: ResizeObserver,
  disconnectItemObserver: () => void,
  clearIdleTimer: () => void,
): VList<T> => {

  // ── Base data methods ─────────────────────────────────────────────

  const setItems = (newItems: T[]): void => {
    if (process.env.NODE_ENV !== "production") {
      if (!Array.isArray(newItems)) {
        console.warn('[vlist] setItems() expects an array, got:', typeof newItems);
        return;
      }
      if (newItems.length > 0 && newItems[0] && !('id' in newItems[0])) {
        console.warn('[vlist] Items must have an "id" property. First item:', newItems[0]);
      }
      // Check for duplicate IDs (#10d)
      const seen = new Set<string | number>();
      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        if (item && 'id' in item) {
          if (seen.has(item.id as string | number)) {
            console.warn(`[vlist] Duplicate item ID "${item.id}" at index ${i}. updateItem() and removeItem() will only match the first occurrence.`);
            break; // warn once
          }
          seen.add(item.id as string | number);
        }
      }
    }
    cancelScroll(); // #10a: cancel in-progress smooth scroll before updating data
    ctx.dataManager.setItems(newItems, 0, newItems.length);
  };

  const appendItems = isReverse
    ? (newItems: T[]): void => {
        const wasAtBottom = $.sab(2);
        const currentTotal = $.it.length;
        ctx.dataManager.setItems(newItems, currentTotal);
        if (wasAtBottom && $.it.length > 0) {
          const pos = $.gsp($.it.length - 1, $.hc, $.ch, $.it.length, "end");
          $.sst(pos);
          $.ls = pos;
          $.rfn();
        }
      }
    : (newItems: T[]): void => {
        const currentTotal = $.it.length;
        ctx.dataManager.setItems(newItems, currentTotal);
      };

  const prependItems = isReverse
    ? (newItems: T[]): void => {
        const scrollTop = $.sgt();
        const heightBefore = $.hc.getTotalSize();
        const existingItems = [...$.it];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
        const heightAfter = $.hc.getTotalSize();
        const delta = heightAfter - heightBefore;
        if (delta > 0) {
          $.sst(scrollTop + delta);
          $.ls = scrollTop + delta;
        }
      }
    : (newItems: T[]): void => {
        const existingItems = [...$.it];
        ctx.dataManager.clear();
        ctx.dataManager.setItems([...newItems, ...existingItems] as T[], 0);
      };

  const updateItem = (index: number, updates: Partial<T>): void => {
    if (process.env.NODE_ENV !== "production") {
      const total = $.vtf();
      if (index < 0 || index >= total) {
        console.warn(`[vlist] updateItem() index ${index} is out of range (0–${total - 1}).`);
      }
    }
    ctx.dataManager.updateItem(index, updates);
  };

  // Debounced ensureRange — coalesces multiple synchronous removeItem calls
  // into a single async fetch. Without this, deleting 5 items in a loop
  // fires 5 overlapping ensureRange requests (each clearing the previous
  // via activeLoads.clear). The microtask fires once after the synchronous
  // deletion loop completes.
  let ensureRangePending = false;

  const removeItem = (id: string | number): boolean => {
    // Capture the focused element's item index before removal for focus recovery (#13d)
    let focusedItemIndex = -1;
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      if (active && dom.items.contains(active)) {
        const idx = (active as HTMLElement).dataset?.index;
        if (idx !== undefined) focusedItemIndex = parseInt(idx, 10);
      }
    }

    const result = ctx.dataManager.removeItem(id);
    if (result) {
      emitter.emit("data:change", { type: "remove", id });
      // Force re-render: removeItem shifts all items after the deleted index
      // down by 1, so the same render range now contains different items.
      // renderIfNeeded (called via onStateChange) bails when the range
      // start/end haven't changed, leaving stale data in the DOM.
      ctx.forceRender();

      // Refill gaps: when a deletion shifts items across chunk boundaries,
      // the last slot(s) of the loaded range become empty (the item that
      // should fill them lives in an unloaded chunk). Debounce via microtask
      // so consecutive synchronous deletes produce a single fetch.
      if (!ensureRangePending) {
        const dm = ctx.dataManager as any;
        if (typeof dm.ensureRange === "function") {
          ensureRangePending = true;
          queueMicrotask(() => {
            ensureRangePending = false;
            const { start, end } = ctx.state.viewportState.renderRange;
            if (end >= start) {
              dm.ensureRange(start, end).catch(() => {});
            }
          });
        }
      }
    }
    if (!result && process.env.NODE_ENV !== "production") {
      console.warn(`[vlist] removeItem() could not find item with id "${id}".`);
    }

    // Focus recovery (#13d): when the focused item was removed, move focus
    // to the nearest remaining item.
    if (result && focusedItemIndex >= 0) {
      const total = $.vtf();
      if (total > 0) {
        const nextIndex = Math.min(focusedItemIndex, total - 1);
        const nextEl = rendered.get(nextIndex);
        if (nextEl && typeof nextEl.focus === "function") {
          nextEl.focus();
        }
      }
    }

    return result;
  };

  const reload = async (): Promise<void> => {
    if ((ctx.dataManager as any).reload) {
      await (ctx.dataManager as any).reload();
    }
  };

  // ── Scroll methods ────────────────────────────────────────────────

  let animationFrameId: number | null = null;

  const cancelScroll = (): void => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const animateScroll = (from: number, to: number, duration: number): void => {
    cancelScroll();
    if (Math.abs(to - from) < 1) {
      $.sst(to);
      $.ls = to;
      $.rfn();
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      $.sst(newPos);
      // Update lastScrollTop BEFORE rendering so range calculation uses correct value
      $.ls = newPos;
      // Ensure rendering happens on each frame during smooth scroll
      $.rfn();
      if (t < 1) animationFrameId = requestAnimationFrame(tick);
      else animationFrameId = null;
    };
    animationFrameId = requestAnimationFrame(tick);
  };

  const scrollToIndex = (
    index: number,
    alignOrOptions?: "start" | "center" | "end" | ScrollToOptions,
  ): void => {
    if (process.env.NODE_ENV !== "production") {
      const total = $.vtf();
      if (total > 0 && (index < 0 || index >= total)) {
        console.warn(`[vlist] scrollToIndex(${index}) is out of range (0–${total - 1}).`);
      }
    }
    const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);
    const total = $.vtf();

    let idx = index;
    if (wrapEnabled && total > 0) {
      idx = ((idx % total) + total) % total;
    }

    const position = $.gsp(idx, $.hc, $.ch, total, align);

    if (behavior === "smooth") {
      animateScroll($.sgt(), position, duration);
    } else {
      cancelScroll();
      $.sst(position);
    }
  };

  const getScrollPosition = (): number => $.sgt();

  // ── Event subscription ────────────────────────────────────────────

  const on = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): Unsubscribe => {
    return emitter.on(
      event,
      handler as EventHandler<VListEvents<T>[typeof event]>,
    );
  };

  const off = <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>,
  ): void => {
    emitter.off(event, handler as EventHandler<VListEvents<T>[typeof event]>);
  };

  // ── Destroy ───────────────────────────────────────────────────────

  const destroy = (): void => {
    if ($.id) return;
    $.id = true;
    ctx.state.isDestroyed = true;

    dom.items.removeEventListener("click", handleClick);
    dom.items.removeEventListener("dblclick", handleDblClick);
    dom.root.removeEventListener("keydown", handleKeydown);
    $.st.removeEventListener("scroll", onScrollFrame);
    resizeObserver.disconnect();
    disconnectItemObserver();

    if ($.wh) {
      dom.viewport.removeEventListener("wheel", $.wh);
    }
    clearIdleTimer();

    for (let i = 0; i < destroyHandlers.length; i++) {
      destroyHandlers[i]!();
    }
    for (const feature of sortedFeatures) {
      if (feature.destroy) feature.destroy();
    }

    cancelScroll();

    for (const [, element] of rendered) {
      element.remove();
      pool.release(element);
    }
    rendered.clear();
    pool.clear();
    emitter.emit("destroy", undefined);
    emitter.clear();

    dom.root.remove();
  };

  // ── Assemble public API ───────────────────────────────────────────

  const api: VList<T> = {
    get element() {
      return dom.root;
    },
    get items() {
      // Check if a feature (e.g., groups) provides a custom items getter
      if (methods.has("_getItems")) {
        return (methods.get("_getItems") as any)();
      }
      return $.it as readonly T[];
    },
    get total() {
      // Check if a feature (e.g., groups) provides a custom total getter
      if (methods.has("_getTotal")) {
        return (methods.get("_getTotal") as any)();
      }
      return $.vtf();
    },

    setItems: methods.has("setItems")
      ? (methods.get("setItems") as any)
      : setItems,
    appendItems: methods.has("appendItems")
      ? (methods.get("appendItems") as any)
      : appendItems,
    prependItems: methods.has("prependItems")
      ? (methods.get("prependItems") as any)
      : prependItems,
    updateItem: methods.has("updateItem")
      ? (methods.get("updateItem") as any)
      : updateItem,
    removeItem: methods.has("removeItem")
      ? (methods.get("removeItem") as any)
      : removeItem,
    reload: methods.has("reload") ? (methods.get("reload") as any) : reload,

    scrollToIndex: methods.has("scrollToIndex")
      ? (methods.get("scrollToIndex") as any)
      : scrollToIndex,
    cancelScroll: methods.has("cancelScroll")
      ? (methods.get("cancelScroll") as any)
      : cancelScroll,
    getScrollPosition: methods.has("getScrollPosition")
      ? (methods.get("getScrollPosition") as any)
      : getScrollPosition,

    on,
    off,
    destroy,
  };

  // Merge feature methods (skip internals and overridden base methods)
  for (const [name, fn] of methods) {
    if (
      name.charCodeAt(0) === 95 || // '_' — internal methods (e.g. _getSelectedIds)
      name === "setItems" ||
      name === "appendItems" ||
      name === "prependItems" ||
      name === "updateItem" ||
      name === "removeItem" ||
      name === "reload" ||
      name === "scrollToIndex" ||
      name === "scrollToItem" ||
      name === "cancelScroll" ||
      name === "getScrollPosition"
    ) {
      continue;
    }
    (api as any)[name] = fn;
  }

  return api;
};