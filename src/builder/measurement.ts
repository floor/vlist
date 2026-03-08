// src/builder/measurement.ts
/**
 * vlist/builder — Mode B Measurement Subsystem
 *
 * Handles dynamic item measurement via ResizeObserver for estimated-size mode:
 * - Creates and manages the item ResizeObserver
 * - Tracks scroll correction deltas for above-viewport items
 * - Defers content size updates during active scrolling for scrollbar stability
 * - Pins scroll position to the end when the user was already there
 *
 * Extracted from core.ts materialize() — all mutable state lives in the
 * returned MeasurementState object or is accessed via the `$` refs bag.
 */

import type { VListItem, Range } from "../types";
import type { MeasuredSizeCache } from "../rendering/measured";
import type { DOMStructure } from "./dom";
import type { MRefs } from "./materialize";

// =============================================================================
// Types
// =============================================================================

/**
 * Short keys survive minification as object property names, so we use
 * 1–2 char keys to keep the bundle small:
 *
 * | Key | Meaning          |
 * |-----|------------------|
 * | ob  | observer         |
 * | ei  | elementToIndex   |
 * | mc  | measuredCache    |
 * | fl  | flush            |
 * | se  | stayAtEnd        |
 */
export interface MeasurementState {
  /** observer */
  ob: ResizeObserver | null;
  /** elementToIndex */
  ei: WeakMap<Element, number> | null;
  /** measuredCache */
  mc: MeasuredSizeCache | null;
  /** flush */
  fl: () => void;
  /** stayAtEnd */
  se: (scrollBefore: number, rerender?: boolean) => boolean;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Uses positional parameters (not a deps object) so the minifier can
 * rename every argument — no long property-name strings in the bundle.
 */
export const createMeasurement = <T extends VListItem>(
  $: MRefs<T>,
  dom: DOMStructure,
  isHorizontal: boolean,
  visibleRange: Range,
  lastRenderRange: Range,
  isScrollingFn: () => boolean,
  updateContentSize: () => void,
  measuredCache: MeasuredSizeCache | null,
  measurementEnabled: boolean,
): MeasurementState => {

  // ── stayAtEnd — reusable by both measurement and other content-size changes ──

  const stayAtEnd = (scrollBefore: number, rerender = false): boolean => {
    const maxBefore = isHorizontal
      ? dom.viewport.scrollWidth - dom.viewport.clientWidth
      : dom.viewport.scrollHeight - dom.viewport.clientHeight;
    if (maxBefore <= 0 || scrollBefore < maxBefore - 2) return false;

    const newMax = Math.max(0, $.hc.getTotalSize() - (isHorizontal ? $.cw : $.ch));
    if (newMax > scrollBefore) {
      $.sst(newMax);
      $.ls = newMax;
      if (rerender) $.rfn();
      return true;
    }
    return false;
  };

  // ── Early exit for Mode A (fixed sizes) ──

  if (!measurementEnabled || !measuredCache) {
    return {
      ob: null,
      ei: null,
      mc: null,
      fl: () => {},
      se: stayAtEnd,
    };
  }

  // ── Mode B state ──

  const elementToIndex = new WeakMap<Element, number>();
  let pendingScrollDelta = 0;
  let pendingContentSizeUpdate = false;

  // Keep a stable reference so the ResizeObserver callback can call unobserve
  let observer: ResizeObserver | null = null;

  // ── flushMeasurements — called on scroll idle ──

  const flush = (): void => {
    if (pendingContentSizeUpdate) {
      const scroll = $.sgt();
      updateContentSize();
      pendingContentSizeUpdate = false;
      stayAtEnd(scroll, true);
    }
  };

  // ── Item ResizeObserver ──

  observer = new ResizeObserver((entries) => {
    if ($.id) return;

    let hasNewMeasurements = false;
    const firstVisible = visibleRange.start;

    for (const entry of entries) {
      const index = elementToIndex.get(entry.target);
      if (index === undefined) continue;

      const newSize = isHorizontal
        ? entry.borderBoxSize[0]!.inlineSize
        : entry.borderBoxSize[0]!.blockSize;

      if (!measuredCache.isMeasured(index)) {
        const oldSize = measuredCache.getSize(index);
        measuredCache.setMeasuredSize(index, newSize);
        hasNewMeasurements = true;

        // Track scroll correction for above-viewport items
        if (index < firstVisible && newSize !== oldSize) {
          pendingScrollDelta += newSize - oldSize;
        }

        // Stop observing — size is now known
        observer!.unobserve(entry.target as Element);

        // Set explicit size on the element now that it's measured
        const el = entry.target as HTMLElement;
        if (isHorizontal) {
          el.style.width = `${newSize}px`;
        } else {
          el.style.height = `${newSize}px`;
        }
      }
    }

    if (!hasNewMeasurements) return;

    // Rebuild prefix sums so item positions are correct
    measuredCache.rebuild($.vtf());
    $.hc = measuredCache;

    // Direction C: always apply scroll correction immediately.
    // Per-batch corrections are small (one batch of items) and masked by
    // the user's own scroll motion during active scrolling.  This avoids
    // the glitch caused by accumulating a large delta and applying it all
    // at once on scroll idle.
    if (pendingScrollDelta !== 0) {
      const currentScroll = $.sgt();
      $.sst(currentScroll + pendingScrollDelta);
      $.ls = currentScroll + pendingScrollDelta;
      pendingScrollDelta = 0;
    }

    // Content size: defer during scrolling for scrollbar stability
    // (changing content height while the user drags the scrollbar thumb
    // causes the thumb proportions to shift under their finger).
    if (isScrollingFn()) {
      pendingContentSizeUpdate = true;
    } else {
      const scrollBeforeResize = $.sgt();
      updateContentSize();
      pendingContentSizeUpdate = false;
      stayAtEnd(scrollBeforeResize);
    }

    // Reposition items with corrected prefix sums
    lastRenderRange.start = -1;
    lastRenderRange.end = -1;
    $.rfn();
  });

  return {
    ob: observer,
    ei: elementToIndex,
    mc: measuredCache,
    fl: flush,
    se: stayAtEnd,
  };
};