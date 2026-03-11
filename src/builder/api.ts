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
    ctx.dataManager.updateItem(index, updates);
  };

  const removeItem = (id: string | number): boolean => {
    const result = ctx.dataManager.removeItem(id);
    if (result) {
      emitter.emit("data:change", { type: "remove", id });
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