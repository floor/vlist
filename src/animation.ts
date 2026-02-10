/**
 * vlist - Animation Utilities
 * Shared scroll animation helpers used by both the full vlist (methods.ts)
 * and the lightweight core. Zero dependencies on other vlist internals.
 */

// =============================================================================
// Constants
// =============================================================================

/** Default smooth scroll duration in ms */
export const DEFAULT_SMOOTH_DURATION = 300;

// =============================================================================
// Easing
// =============================================================================

/**
 * Ease-in-out quadratic easing function
 * t in [0, 1] → eased value in [0, 1]
 */
export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// =============================================================================
// Scroll Argument Resolution
// =============================================================================

/** Minimal scroll options shape accepted by resolveScrollArgs */
interface ScrollOptions {
  align?: "start" | "center" | "end";
  behavior?: "auto" | "smooth";
  duration?: number;
}

/** Resolved scroll arguments with all defaults applied */
export interface ResolvedScrollArgs {
  align: "start" | "center" | "end";
  behavior: "auto" | "smooth";
  duration: number;
}

/**
 * Parse an align-or-options argument into resolved scroll arguments.
 *
 * Accepts three forms:
 *   - A string alignment: `"start"`, `"center"`, `"end"`
 *   - An options object: `{ align?, behavior?, duration? }`
 *   - `undefined` — returns defaults
 *
 * Used by both `scrollToIndex` in the full vlist and in the core.
 */
export const resolveScrollArgs = (
  alignOrOptions?: "start" | "center" | "end" | ScrollOptions,
): ResolvedScrollArgs => {
  if (typeof alignOrOptions === "string") {
    return {
      align: alignOrOptions,
      behavior: "auto",
      duration: DEFAULT_SMOOTH_DURATION,
    };
  }
  if (alignOrOptions && typeof alignOrOptions === "object") {
    return {
      align: alignOrOptions.align ?? "start",
      behavior: alignOrOptions.behavior ?? "auto",
      duration: alignOrOptions.duration ?? DEFAULT_SMOOTH_DURATION,
    };
  }
  return {
    align: "start",
    behavior: "auto",
    duration: DEFAULT_SMOOTH_DURATION,
  };
};

// =============================================================================
// Scroll Position Calculation (non-compressed)
// =============================================================================

/** Height cache interface (minimal shape needed by this module) */
interface HeightLookup {
  getOffset(index: number): number;
  getHeight(index: number): number;
  getTotalHeight(): number;
}

/**
 * Calculate scroll position to bring an index into view.
 *
 * This is the non-compressed version used by the lightweight core.
 * The full vlist uses `calculateScrollToIndex` from `render/virtual.ts`
 * which delegates to the compression-aware implementation.
 */
export const calculateScrollToPosition = (
  index: number,
  heightCache: HeightLookup,
  containerHeight: number,
  totalItems: number,
  align: "start" | "center" | "end",
): number => {
  if (totalItems === 0) return 0;

  const clamped = Math.max(0, Math.min(index, totalItems - 1));
  const offset = heightCache.getOffset(clamped);
  const itemHeight = heightCache.getHeight(clamped);
  const maxScroll = Math.max(0, heightCache.getTotalHeight() - containerHeight);

  let position: number;
  switch (align) {
    case "center":
      position = offset - (containerHeight - itemHeight) / 2;
      break;
    case "end":
      position = offset - containerHeight + itemHeight;
      break;
    default:
      position = offset;
  }

  return Math.max(0, Math.min(position, maxScroll));
};
