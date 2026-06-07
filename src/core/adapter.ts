/**
 * vlist — Logical Scroll Model (RFC-012)
 *
 * The scroll coordinate is logical, not a physical pixel offset into a giant
 * container: `{ index, offsetPx }` — the top visible item plus the pixel offset
 * within it. This is stable under variable and autosized items, because the
 * pixel offset stays physically meaningful when an item's measured size changes
 * (unlike a fraction, which silently shifts the visual position).
 *
 * The pixel equivalent (`index * itemSize + offsetPx` generalised over the size
 * cache) is derived only at the public API boundary, so existing consumers of
 * `getScrollPosition()` and scroll events keep seeing pixel values (RFC-012 G4).
 *
 * This module is pure: it owns no DOM and no engine state. It is the translation
 * layer the `ScrollAdapter` and the render pipeline build on.
 */

import type { SizeCache } from "../rendering/sizes";

// =============================================================================
// Types
// =============================================================================

/**
 * Logical scroll position: the top visible data item plus the pixel offset
 * scrolled past its leading edge.
 *
 * Invariant after {@link normalizeLogical}: `0 <= offsetPx < size(index)`
 * (except at the list end, where `offsetPx` may exceed the final item to
 * represent overscroll clamping).
 */
export interface LogicalScrollPosition {
  /** Index of the top visible item (integer, clamped to `[0, total - 1]`). */
  index: number;
  /** Pixel offset scrolled past the leading edge of `index`. */
  offsetPx: number;
}

/**
 * The migration boundary between the logical scroll model and the rest of the
 * engine and its plugins (RFC-012). Plugins read and write scroll position
 * through this adapter rather than touching `engineState.scrollPosition` or raw
 * DOM `scrollTop` / `scrollLeft` directly.
 *
 * It exposes both the logical primitive and a pixel-equivalent view so existing
 * pixel-based code paths keep working during migration.
 */
export interface ScrollAdapter {
  /** Current logical position, normalized. */
  getLogical(): LogicalScrollPosition;
  /** Move to a logical position. Out-of-range input is clamped. */
  setLogical(pos: LogicalScrollPosition): void;
  /** Pixel-equivalent of the current position (for public API / events). */
  getPixelEquivalent(): number;
  /** Move to a pixel-equivalent position. Out-of-range input is clamped. */
  setPixelEquivalent(px: number): void;
  /** Maximum scrollable pixel-equivalent (`totalSize - containerSize`, >= 0). */
  getMaxPixelEquivalent(): number;
  /** Advance the position by a pixel delta (used by native/wheel input). */
  scrollByPx(delta: number): void;
}

/** Dependencies an adapter needs to translate and apply scroll positions. */
export interface ScrollAdapterConfig {
  /** Source of item offsets and sizes. */
  readonly sizeCache: SizeCache;
  /** Read the current pixel-equivalent position from the active scroll source. */
  readonly getPixel: () => number;
  /** Write a (clamped) pixel-equivalent position to the active scroll source. */
  readonly setPixel: (px: number) => void;
  /** Current viewport size along the main axis. */
  readonly getContainerSize: () => number;
}

// =============================================================================
// Pure conversions
// =============================================================================

/**
 * Convert a pixel offset into a logical position. The returned position is
 * normalized: `index` is clamped to `[0, total - 1]` and `offsetPx` is the
 * remainder past that item's leading edge.
 */
export function pixelToLogical(sizeCache: SizeCache, pixel: number): LogicalScrollPosition {
  const total = sizeCache.getTotal();
  if (total <= 0) return { index: 0, offsetPx: 0 };

  const clampedPixel = pixel <= 0 ? 0 : pixel;
  const index = sizeCache.indexAtOffset(clampedPixel);
  const offsetPx = clampedPixel - sizeCache.getOffset(index);
  return { index, offsetPx: offsetPx > 0 ? offsetPx : 0 };
}

/**
 * Convert a logical position into a pixel offset. Input is normalized first,
 * so callers may pass an `offsetPx` that overflows its item.
 */
export function logicalToPixel(sizeCache: SizeCache, pos: LogicalScrollPosition): number {
  const norm = normalizeLogical(sizeCache, pos);
  return sizeCache.getOffset(norm.index) + norm.offsetPx;
}

/**
 * Canonicalize a logical position so that `0 <= offsetPx < size(index)` where
 * possible, carrying overflow/underflow across item boundaries. `index` is
 * clamped to `[0, total - 1]`. At the list end, any remaining `offsetPx` is
 * preserved (it represents scrolling past the start of the final item).
 */
export function normalizeLogical(sizeCache: SizeCache, pos: LogicalScrollPosition): LogicalScrollPosition {
  const total = sizeCache.getTotal();
  if (total <= 0) return { index: 0, offsetPx: 0 };

  let index = pos.index;
  let offsetPx = pos.offsetPx;

  if (index < 0) {
    // Below the start: collapse to the top.
    return { index: 0, offsetPx: 0 };
  }
  if (index > total - 1) {
    // Past the end: clamp index, preserve offset (represents end overscroll).
    index = total - 1;
  }

  // Carry positive overflow forward across items.
  while (offsetPx > 0 && index < total - 1) {
    const size = sizeCache.getSize(index);
    if (offsetPx < size) break;
    offsetPx -= size;
    index++;
  }

  // Borrow negative underflow backward across items.
  while (offsetPx < 0 && index > 0) {
    index--;
    offsetPx += sizeCache.getSize(index);
  }

  if (offsetPx < 0) offsetPx = 0;
  return { index, offsetPx };
}

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create a {@link ScrollAdapter} over an existing pixel-based scroll source.
 *
 * During migration the underlying source is still the native viewport scroll;
 * later phases can swap `getPixel` / `setPixel` for a bounded-proxy or
 * interception input strategy without changing any plugin that uses the adapter.
 */
export function createScrollAdapter(config: ScrollAdapterConfig): ScrollAdapter {
  const { sizeCache, getPixel, setPixel, getContainerSize } = config;

  function getMaxPixelEquivalent(): number {
    const max = sizeCache.getTotalSize() - getContainerSize();
    return max > 0 ? max : 0;
  }

  function clampPixel(px: number): number {
    if (px <= 0) return 0;
    const max = getMaxPixelEquivalent();
    return px > max ? max : px;
  }

  return {
    getLogical(): LogicalScrollPosition {
      return pixelToLogical(sizeCache, getPixel());
    },

    setLogical(pos: LogicalScrollPosition): void {
      setPixel(clampPixel(logicalToPixel(sizeCache, pos)));
    },

    getPixelEquivalent(): number {
      return getPixel();
    },

    setPixelEquivalent(px: number): void {
      setPixel(clampPixel(px));
    },

    getMaxPixelEquivalent,

    scrollByPx(delta: number): void {
      setPixel(clampPixel(getPixel() + delta));
    },
  };
}
