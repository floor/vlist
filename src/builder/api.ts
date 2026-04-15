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
  ReloadOptions,
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
      // Cap at 10K to avoid O(n) cost on large datasets — duplicates in the
      // first 10K items are enough to surface the warning during development.
      const scanLimit = Math.min(newItems.length, 10_000);
      const seen = new Set<string | number>();
      for (let i = 0; i < scanLimit; i++) {
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

  const appendItems = (newItems: T[]): void => {
    const wasAtBottom = isReverse && $.sab(2);
    ctx.dataManager.setItems(newItems, $.it.length);
    if (wasAtBottom && $.it.length > 0) {
      const pos = $.gsp($.it.length - 1, $.hc, $.ch, $.it.length, "end");
      $.sst(pos);
      $.ls = pos;
      $.rfn();
    }
  };

  const prependItems = (newItems: T[]): void => {
    const scrollBefore = isReverse ? $.sgt() : 0;
    const sizeBefore = isReverse ? $.hc.getTotalSize() : 0;
    const existing = [...$.it];
    ctx.dataManager.clear();
    ctx.dataManager.setItems([...newItems, ...existing] as T[], 0);
    if (isReverse) {
      const delta = $.hc.getTotalSize() - sizeBefore;
      if (delta > 0) { $.sst(scrollBefore + delta); $.ls = scrollBefore + delta; }
    }
  };

  // ── Cached method getters for updateItem ──
  // Resolved lazily on first call (features register these during setup).
  // Caching avoids three Map.get() lookups on every updateItem call.
  let updateRenderedFn: ((idx: number, it: T, sel: boolean, foc: boolean) => void) | null = null;
  let selectionIdsFn: (() => Set<string | number>) | null = null;
  let focusedIndexFn: (() => number) | null = null;
  let updateItemGettersResolved = false;

  const resolveUpdateItemGetters = (): void => {
    if (updateItemGettersResolved) return;
    updateItemGettersResolved = true;
    updateRenderedFn = (methods.get("_updateRenderedItem") as typeof updateRenderedFn) ?? null;
    selectionIdsFn = (methods.get("_getSelectedIds") as typeof selectionIdsFn) ?? null;
    focusedIndexFn = (methods.get("_getFocusedIndex") as typeof focusedIndexFn) ?? null;
  };

  const updateItem = (index: number, updates: Partial<T>): void => {
    if (process.env.NODE_ENV !== "production") {
      const total = $.vtf();
      if (index < 0 || index >= total) {
        console.warn(`[vlist] updateItem() index ${index} is out of range (0–${total - 1}).`);
      }
    }

    ctx.dataManager.updateItem(index, updates);

    // Re-apply the template for the updated element.
    // The scroll-driven render loops (core, grid, table) skip re-templating
    // when the item id hasn't changed. But updateItem() is an explicit API
    // call signalling that data changed (e.g. new cover image), so we must
    // force the template to re-apply.
    //
    // Core registers a default "_updateRenderedItem" that uses the inline
    // rendered Map. Grid and table features override it with their own
    // renderer's updateItem (which owns the rendered Map in those modes).
    resolveUpdateItemGetters();

    if (!updateRenderedFn) return;

    const item = ctx.dataManager.getItem(index);
    if (item) {
      const selectedIds = selectionIdsFn ? selectionIdsFn() : $.ss;
      const isSelected = selectedIds.has(item.id);
      const isFocused = (focusedIndexFn ? focusedIndexFn() : $.fi) === index;
      updateRenderedFn(index, item, isSelected, isFocused);
    }
  };

  // Debounced ensureRange — coalesces multiple synchronous removeItem calls
  // into a single async fetch. Without this, deleting 5 items in a loop
  // fires 5 overlapping ensureRange requests (each clearing the previous
  // via activeLoads.clear). The microtask fires once after the synchronous
  // deletion loop completes.
  let ensureRangePending = false;

  const removeItem = (id: string | number): boolean => {
    // Capture focused item index before removal for focus recovery (#13d)
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const focIdx = active && dom.items.contains(active)
      ? parseInt((active as HTMLElement).dataset?.index ?? "-1", 10)
      : -1;

    const result = ctx.dataManager.removeItem(id);
    if (!result) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[vlist] removeItem() could not find item with id "${id}".`);
      }
      return false;
    }

    emitter.emit("data:change", { type: "remove", id });
    ctx.forceRender();

    // Refill gaps via debounced ensureRange (coalesces consecutive deletes)
    if (!ensureRangePending) {
      const dm = ctx.dataManager as any;
      if (typeof dm.ensureRange === "function") {
        ensureRangePending = true;
        queueMicrotask(() => {
          ensureRangePending = false;
          const t = ctx.dataManager.getTotal();
          const { start, end } = ctx.state.viewportState.renderRange;
          if (t > 0 && end >= start) dm.ensureRange(start, end).catch(() => {});
        });
      }
    }

    // Focus recovery (#13d)
    if (focIdx >= 0) {
      const t = $.vtf();
      if (t > 0) rendered.get(Math.min(focIdx, t - 1))?.focus();
    }

    return true;
  };

  const getItemAt = (index: number): T | undefined => {
    return ctx.dataManager.getItem(index);
  };

  const getIndexById = (id: string | number): number => {
    return (ctx.dataManager as any).getIndexById?.(id) ?? -1;
  };

  const reload = async (_options?: ReloadOptions): Promise<void> => {
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

  const animateScroll = (from: number, to: number, duration: number, toFn?: () => number): void => {
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
      // When a dynamic target function is provided, recalculate the
      // target each frame so the animation adapts to measurement
      // changes (e.g. autoSize updating prefix sums mid-scroll).
      const currentTo = toFn ? toFn() : to;
      const newPos = from + (currentTo - from) * easeInOutQuad(t);
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
      // Pass a dynamic target function so the animation adapts when
      // autoSize measurements change the size cache during scrolling.
      const targetIdx = idx;
      const targetAlign = align;
      animateScroll($.sgt(), position, duration, () =>
        $.gsp(targetIdx, $.hc, $.ch, $.vtf(), targetAlign),
      );
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

    const destroyErrors: Error[] = [];
    for (let i = 0; i < destroyHandlers.length; i++) {
      try {
        destroyHandlers[i]!();
      } catch (err) {
        destroyErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    for (const feature of sortedFeatures) {
      if (feature.destroy) {
        try {
          feature.destroy();
        } catch (err) {
          destroyErrors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    cancelScroll();

    for (const [, element] of rendered) {
      element.remove();
      pool.release(element);
    }
    rendered.clear();
    pool.clear();
    emitter.emit("destroy", undefined);
    // Emit any errors collected during destroy (before clearing the emitter)
    for (const error of destroyErrors) {
      emitter.emit("error", { error, context: "destroy" });
    }
    emitter.clear();

    dom.root.remove();
  };

  // ── Assemble public API ───────────────────────────────────────────

  /** Return the feature override for a method name, or the default. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (name: string, def: any): any =>
    methods.has(name) ? methods.get(name) : def;

  const api: VList<T> = {
    get element() { return dom.root; },
    get items() {
      const fn = methods.get("_getItems") as (() => readonly T[]) | undefined;
      return fn ? fn() : $.it as readonly T[];
    },
    get total() {
      const fn = methods.get("_getTotal") as (() => number) | undefined;
      return fn ? fn() : $.vtf();
    },

    setItems: m("setItems", setItems),
    appendItems: m("appendItems", appendItems),
    prependItems: m("prependItems", prependItems),
    updateItem: m("updateItem", updateItem),
    removeItem: m("removeItem", removeItem),
    reload: m("reload", reload),
    getItemAt,
    getIndexById,

    scrollToIndex: m("scrollToIndex", scrollToIndex),
    cancelScroll: m("cancelScroll", cancelScroll),
    getScrollPosition: m("getScrollPosition", getScrollPosition),

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