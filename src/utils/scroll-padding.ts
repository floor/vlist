/**
 * vlist/utils — Scroll Padding Protocol
 *
 * page() keeps a band of the window clear at each end of the main axis — a
 * sticky site header, a floating toolbar — and applies it to every scroll it
 * computes. Layout plugins take over those computations: groups() and
 * masonry() both override `_scrollItemIntoView` and install their own
 * `setToIndexFn`, because only they know where an entry actually sits.
 *
 * So the band is published through the `_getScrollPadding` hook rather than
 * baked into page's own scroll code alone, and the plugins that displace page
 * read it back and fold it into their geometry. Without the hook a caller's
 * `scrollPadding` silently disappeared as soon as either plugin was seated.
 */

import type { PluginContext } from "../core/types";
import type { VListItem } from "../types";

// =============================================================================
// Types
// =============================================================================

/** Band to keep clear at each end of the main axis, in pixels. */
export interface ScrollPadding {
  /** Top (vertical) or left (horizontal). */
  readonly start: number;
  /** Bottom (vertical) or right (horizontal). */
  readonly end: number;
}

/** Internal hook name carrying the band across plugins. */
export const SCROLL_PADDING_HOOK = "_getScrollPadding";

/** No padding — the shape every list without page() sees. */
export const NO_SCROLL_PADDING: ScrollPadding = { start: 0, end: 0 };

// =============================================================================
// Reader
// =============================================================================

/**
 * Read the published scroll padding, or zero when no plugin publishes one.
 *
 * The hook is resolved on first read instead of during setup: the publisher is
 * not guaranteed to be seated first. The band itself is read on every call,
 * since page() accepts functions that measure a sticky header each time.
 */
export function createScrollPaddingReader<T extends VListItem>(
  ctx: PluginContext<T>,
): () => ScrollPadding {
  let fn: (() => ScrollPadding) | null | undefined;

  return (): ScrollPadding => {
    if (fn === undefined) {
      fn = (ctx.hooks.get(SCROLL_PADDING_HOOK) as (() => ScrollPadding) | undefined) ?? null;
    }
    return fn ? fn() : NO_SCROLL_PADDING;
  };
}
