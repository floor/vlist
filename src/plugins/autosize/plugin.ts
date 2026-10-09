/**
 * vlist — Autosize Plugin
 *
 * Enables dynamic item measurement via ResizeObserver for items with
 * unknown sizes. Items are rendered without an explicit main-axis size,
 * measured once by ResizeObserver, then pinned to their measured size.
 *
 * Because a pinned item cannot grow, content that changes size after the
 * measurement (an image that loads or fails, a font swap, lazy content)
 * needs a fresh measurement. `load` and `error` events from descendants
 * trigger one automatically; `list.remeasure(index?)` does it on demand.
 *
 * Priority 5 — runs before grid/masonry (10) so the measured cache
 * is in place before layout plugins consume it.
 *
 * Requires: `item.estimatedHeight` or `item.estimatedWidth` in config
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";

// =============================================================================
// Config
// =============================================================================

export interface AutosizePluginConfig {
  gap?: number;
}

// =============================================================================
// Factory
// =============================================================================

/** Methods the autosize plugin adds to the list instance. */
export interface AutosizeMethods {
  /** Whether the item at `index` has been measured. */
  isMeasured(index: number): boolean;
  /** Drop the measurement for `index`, or for every item when omitted. */
  remeasure(index?: number): void;
  /** Record a measured size for `index`. */
  setMeasuredSize(index: number, size: number): void;
  /** How many items have been measured. */
  getMeasuredCount(): number;
}

export function autosize<T extends VListItem = VListItem>(
  config?: AutosizePluginConfig,
): VListPlugin<T, AutosizeMethods> {
  let gap = config?.gap ?? 0;

  let observer: ResizeObserver | null = null;
  // Lists this instance is installed on. A scroll-mode switch rebuilds the
  // list with the same plugin instances, so for a moment the instance is on
  // two lists; the old one's teardown must not take the new one's observer
  // and measurements with it (as masonry, carousel and table learned in
  // #292-#294). Measured on the social feed: after the switch every row that
  // scrolled into view was the 160 px estimate against 590 px of content.
  let installs = 0;
  let storedCtx: PluginContext<T> | null = null;
  let engineState: EngineState;
  let scroll: PluginContext<T>["scroll"];
  let isX: boolean;
  let sizeProp: "width" | "height";
  let estimatedSize: number;

  const measured = new Map<string | number, [number, unknown]>();
  // Measured items queued for a fresh measurement on the next commit.
  const pendingRemeasure = new Set<string | number>();
  const elementToIndex = new WeakMap<Element, number>();

  /**
   * Index-space translators (#363). The measurements here are keyed and read
   * back in the DATA space (a grouped size cache calls sizeFn with
   * entry.dataIndex), but a layout plugin keys its rendered-element map and
   * stamps `data-index` in the LAYOUT space — groups() counts the headers.
   * Resolve the hooks per call: a layout plugin (groups at priority 11) sets
   * up after this one (priority 5), so they are not registered yet at setup.
   * Without a layout plugin the spaces coincide and the lookups are identity.
   */
  const toLayoutIndex = (i: number): number =>
    (storedCtx?.hooks.get("_dataToLayoutIndex") as ((x: number) => number) | undefined)?.(i) ?? i;
  const toDataIndex = (i: number): number =>
    (storedCtx?.hooks.get("_layoutToDataIndex") as ((x: number) => number) | undefined)?.(i) ?? i;

  let pendingScrollDelta = 0;
  let pendingContentSizeUpdate = false;
  let pinnedToEnd = false;
  let animatingToEnd = false;

  const END_THRESHOLD = 2;

  const getItemId = (index: number): string | number => storedCtx?.items.at(index)?.id ?? index;

  function sizeFn(index: number): number {
    return measured.get(getItemId(index))?.[0] ?? estimatedSize;
  }

  function isMeasured(index: number): boolean {
    const item = storedCtx?.items.at(index);
    if (!item) return false;
    const id = item.id ?? index;
    if (pendingRemeasure.has(id)) return false;
    const m = measured.get(id);
    if (!m) return false;
    return Boolean((item as Record<string, unknown>)._isPlaceholder) || m[1] === item;
  }

  /**
   * Queue a fresh measurement. With an index, the item is re-observed on the
   * next commit and its new size replaces the old one, correcting the scroll
   * position by the real delta. Without an index, every measurement is
   * dropped and items are measured again as they render.
   *
   * @param index Zero-based item index; omit to invalidate all cached sizes.
   * Unknown or unmeasured indices are ignored. A single-item request keeps the
   * previous size for scroll correction until ResizeObserver supplies the new
   * measurement; a full reset immediately falls back to estimates, including
   * for offscreen items. Manual requests share the automatic load/error queue.
   */
  function remeasure(index?: number): void {
    if (!storedCtx || engineState.destroyed) return;
    if (index === undefined) {
      if (measured.size === 0) return;
      measured.clear();
      pendingRemeasure.clear();
      storedCtx.sizes.rebuild();
      updateContentSize();
    } else {
      const id = getItemId(index);
      if (!measured.has(id)) return;
      pendingRemeasure.add(id);
    }
    storedCtx.render.force();
  }

  // Maximum logical scroll position, derived from the size cache rather than
  // native scroll geometry. With a logical handler (RFC-012)
  // `viewport.scrollHeight` is the content element's own size, not the full
  // virtual size, so reading it would treat that edge as the list end. This matches the end-aligned scroll target
  // computed in `setScrollToIndexFn` below, and is mode-independent.
  function maxScrollPos(): number {
    return Math.max(
      0,
      storedCtx!.sizes.cache.getTotalSize() + storedCtx!.config.mainAxisPadding - engineState.containerSize,
    );
  }

  function isAtEnd(): boolean {
    const maxScroll = maxScrollPos();
    return maxScroll > 0 && scroll.getPixelEquivalent() >= maxScroll - END_THRESHOLD;
  }

  function snapToEnd(): void {
    const maxScroll = maxScrollPos();
    if (maxScroll > scroll.getPixelEquivalent()) {
      storedCtx!.scroll.to(maxScroll);
    }
  }

  function updateContentSize(): void {
    storedCtx!.render.contentSize(storedCtx!.sizes.cache.getTotalSize());
  }

  /**
   * Refresh the prefix sums over `low..high`, the indices a batch changed.
   *
   * A layout plugin (groups, grid) can replace the size cache with one keyed
   * by its own layout indices, where a data index names the wrong rows. Such a
   * plugin hooks `rebuild` to do the mapping, so that hook's presence is the
   * signal to fall back to the full rebuild — the only call that still lands
   * on the right entries.
   */
  function refreshSizes(low: number, high: number): void {
    const ctx = storedCtx!;
    if (ctx.hooks.get("_setSizeCacheBase")) ctx.sizes.rebuild();
    else ctx.sizes.cache.invalidate(low, high);
  }

  return {
    name: "autosize",
    priority: 5,

    setup(ctx: PluginContext<T>): void {
      installs++;
      scroll = ctx.scroll;
      storedCtx = ctx;
      engineState = ctx.getState();
      isX = ctx.config.axis.primary === "x";
      sizeProp = isX ? "width" : "height";
      if (gap === 0) gap = ctx.config.gap;

      // Read estimated size from the current sizeCache before replacing it.
      // The initial cache already has gap baked in — read the raw spec size.
      estimatedSize = typeof ctx.sizes.rawSpec === "function"
        ? (ctx.sizes.rawSpec as (i: number) => number)(0) + gap
        : (ctx.sizes.rawSpec as number) + gap;

      // Replace the fixed sizeCache with a variable one backed by measurements
      ctx.sizes.setConfig(sizeFn, gap);

      // ResizeObserver for measuring items
      const own = new ResizeObserver((entries) => {
        if (engineState.destroyed || !storedCtx) return;

        let hasNewMeasurements = false;
        // Lowest and highest index the batch changed. The size cache only
        // re-reads the blocks this range covers, so a handful of measured
        // rows no longer costs one Map lookup per item in the list.
        let changedLow = -1;
        let changedHigh = -1;
        const firstVisible = ctx.sizes.cache.indexAtOffset(scroll.getPixelEquivalent());

        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const index = elementToIndex.get(el);
          if (index === undefined) continue;

          if (el.getAttribute("data-index") !== String(toLayoutIndex(index))) {
            own.unobserve(el);
            continue;
          }

          const item = storedCtx.items.at(index);
          if (!item) {
            own.unobserve(el);
            continue;
          }
          const id = item.id ?? index;

          if (isMeasured(index)) continue;

          // borderBoxSize is missing on polyfills and on older WebKit, which
          // shipped ResizeObserver with contentRect only. contentRect is the
          // content box, so it undershoots a row that has padding or a border.
          const boxSize = entry.borderBoxSize?.[0];
          let newSize: number;
          if (boxSize) {
            newSize = isX ? boxSize.inlineSize : boxSize.blockSize;
          } else {
            const rect = el.getBoundingClientRect();
            newSize = isX ? rect.width : rect.height;
          }
          if (newSize <= 0) continue;

          const sizeWithGap = newSize + gap;
          // A remeasured item corrects by the delta from its previous
          // measurement, not from the estimate.
          const wasMeasured = measured.has(id);
          const oldSize = measured.get(id)?.[0] ?? estimatedSize;

          measured.set(id, [sizeWithGap, item]);
          pendingRemeasure.delete(id);
          const pid = `__placeholder_${index}`;
          if (id !== pid) {
            measured.delete(pid);
            pendingRemeasure.delete(pid);
          }
          if (!wasMeasured || sizeWithGap !== oldSize) {
            hasNewMeasurements = true;
            if (changedLow < 0 || index < changedLow) changedLow = index;
            if (index > changedHigh) changedHigh = index;
          }

          // firstVisible comes from the size cache, which a layout plugin
          // keys by layout index — compare positions in that same space.
          if (toLayoutIndex(index) < firstVisible && sizeWithGap !== oldSize) {
            pendingScrollDelta += sizeWithGap - oldSize;
          }

          own.unobserve(el);

          // Pin the element to its measured size
          el.style[sizeProp] = `${newSize}px`;
        }

        if (!hasNewMeasurements) return;

        const atEnd = isAtEnd();

        // Refresh the prefix sums over the measured range only
        refreshSizes(changedLow, changedHigh);

        // Apply scroll correction for items above viewport
        if (pendingScrollDelta) {
          ctx.scroll.shiftBy(pendingScrollDelta);
          pendingScrollDelta = 0;
        }

        const isScrolling = engineState.scrollDirection !== 0;
        const nearEnd = engineState.totalItems > 0
          && engineState.prevRangeEnd >= engineState.totalItems - 1;
        const shouldPin = pinnedToEnd && !animatingToEnd;

        // A smooth jump to the end re-reads its target every frame, but the
        // browser clamps that write to the content element's current height.
        // Deferring the height until idle leaves the jump short of the items
        // measured along the way, which is the blank viewport on the second
        // jump. Publish the height while the jump is in flight; still don't
        // snap until the animation has finished, or the two fight.
        if (shouldPin || atEnd || nearEnd || animatingToEnd || !isScrolling) {
          updateContentSize();
          pendingContentSizeUpdate = false;

          if (shouldPin || atEnd) {
            snapToEnd();
          }
        } else {
          pendingContentSizeUpdate = true;
        }

        ctx.render.force();
      });
      observer = own;

      // End-pinning with dynamic scroll target: when scrollToIndex targets
      // the last item with "end" alignment, use a dynamic target function so
      // the smooth scroll tracks the real maxScroll as measurements change it.
      // After the animation, pinnedToEnd keeps snapping on subsequent
      // measurements until the user scrolls away.
      ctx.scroll.setToIndexFn((index: number, align: string, behavior?: string, duration?: number, easing?: (t: number) => number): void | false => {
        const isEndAligned = index >= engineState.totalItems - 1 && align === "end";
        pinnedToEnd = isEndAligned;
        animatingToEnd = false;

        if (!isEndAligned) return false;

        const mp = ctx.config.mainAxisPadding;
        const dynamicTarget = (): number => {
          const totalSize = ctx.sizes.cache.getTotalSize();
          return Math.max(0, totalSize + mp - engineState.containerSize);
        };

        if (behavior === "smooth") {
          animatingToEnd = true;
          ctx.scroll.smoothTo(dynamicTarget, duration ?? 300, easing, () => {
            animatingToEnd = false;
            // Measurements taken on the last frames defer their height write
            // until this moment. Publish it, then land on the end it describes.
            if (pendingContentSizeUpdate) {
              updateContentSize();
              pendingContentSizeUpdate = false;
            }
            snapToEnd();
          });
        } else {
          ctx.scroll.to(dynamicTarget());
        }
      });

      const unpinOnUserScroll = (): void => { pinnedToEnd = false; };
      const viewport = ctx.dom.viewport;
      viewport.addEventListener("wheel", unpinOnUserScroll, { passive: true });
      viewport.addEventListener("touchstart", unpinOnUserScroll, { passive: true });

      const content = ctx.dom.content;
      const onMediaEvent = (event: Event): void => {
        const target = event.target as Element | null;
        if (!target || target === content) return;
        const item = target.closest("[data-index]");
        if (!item || item.parentNode !== content) return;
        const index = toDataIndex(Number(item.getAttribute("data-index")));
        if (index >= 0 && isMeasured(index)) remeasure(index);
      };
      content.addEventListener("load", onMediaEvent, true);
      content.addEventListener("error", onMediaEvent, true);

      // Public methods
      ctx.hooks.method("isMeasured", isMeasured);
      ctx.hooks.method("remeasure", remeasure);

      ctx.hooks.method("setMeasuredSize", (index: number, size: number): void => {
        const id = getItemId(index);
        measured.set(id, [size, storedCtx?.items.at(index)]);
        pendingRemeasure.delete(id);
        refreshSizes(index, index);
      });

      ctx.hooks.method("getMeasuredCount", (): number => measured.size);

      // Cleanup
      ctx.hooks.onDestroy((): void => {
        viewport.removeEventListener("wheel", unpinOnUserScroll);
        viewport.removeEventListener("touchstart", unpinOnUserScroll);
        content.removeEventListener("load", onMediaEvent, true);
        content.removeEventListener("error", onMediaEvent, true);
        own.disconnect();
        if (observer === own) observer = null;
      });
    },

    hooks: {
      onCommit(state: EngineState): void {
        if (!observer || !storedCtx) return;

        for (let i = 0; i < state.visibleCount; i++) {
          const idx = state.visibleIndices[i]!;
          if (isMeasured(idx)) continue;

          // state.visibleIndices carries DATA indices (groups fills it that
          // way, headers skipped); a layout plugin's rendered-element map is
          // keyed by LAYOUT index. Look the element up in its own space, or a
          // header's measurement lands under the first row of its group (#363).
          const el = storedCtx.dom.renderedElement(toLayoutIndex(idx));
          if (!el) continue;

          // Clear the explicit size set by phase2Commit so
          // ResizeObserver can measure the natural content size.
          el.style[sizeProp] = "";
          elementToIndex.set(el, idx);
          observer.observe(el);
        }
      },

      onIdle(): void {
        if (!storedCtx || !pendingContentSizeUpdate) return;

        const atEnd = isAtEnd();
        updateContentSize();
        pendingContentSizeUpdate = false;

        if (atEnd) {
          snapToEnd();
          storedCtx.render.force();
        }
      },
    },

    destroy(): void {
      installs = Math.max(0, installs - 1);
      // The measurements and the context belong to the newest install now.
      if (installs > 0) return;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      measured.clear();
      pendingRemeasure.clear();
      pinnedToEnd = false;
      animatingToEnd = false;
      storedCtx = null;
    },
  };
}
