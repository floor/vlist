/**
 * vlist - Constants
 * All default values and magic numbers in one place
 */

// =============================================================================
// Core
// =============================================================================

/** Default number of extra items to render outside viewport */
export const OVERSCAN = 3;

/** Default CSS class prefix */
export const CLASS_PREFIX = "vlist";

// =============================================================================
// Async Loading
// =============================================================================

/** Distance from bottom (in pixels) to trigger infinite scroll */
export const LOAD_THRESHOLD = 200;

/** Default number of items to load per request */
export const INITIAL_LOAD_SIZE = 50;

/** Default load size for data manager */
export const LOAD_SIZE = 50;

/** Number of extra items to preload ahead of scroll direction */
export const PRELOAD_AHEAD = 50;

/**
 * Velocity threshold for preloading (px/ms)
 * When scrolling faster than this but slower than LOAD_VELOCITY_THRESHOLD,
 * we preload extra items in the scroll direction to reduce placeholder flashing.
 */
export const PRELOAD_VELOCITY_THRESHOLD = 2;

/**
 * Velocity threshold above which data loading is cancelled (px/ms)
 * Above this: skip loading, show placeholders, defer to idle.
 */
export const LOAD_VELOCITY_THRESHOLD = 15;

/** Maximum concurrent chunk requests (0 = unlimited) */
export const MAX_CONCURRENT_LOADS = 6;

/** Initial delay before auto-retrying a failed load (ms) */
export const LOAD_RETRY_BASE_DELAY = 2000;

/** Maximum delay between auto-retries of a failed load (ms) — caps the
 *  exponential backoff so recovery stays responsive once the network returns */
export const LOAD_RETRY_MAX_DELAY = 30000;

// =============================================================================
// Scale
// =============================================================================

/**
 * Maximum virtual size in pixels along the main axis
 * Most browsers support ~16.7M pixels, we use 16M for safety margin
 */
export const MAX_VIRTUAL_SIZE = 16_000_000;

// =============================================================================
// Scrolling
// =============================================================================

/** Idle timeout for scroll detection (ms) */
export const SCROLL_IDLE_TIMEOUT = 150;

/** Default wheel sensitivity multiplier */
export const WHEEL_SENSITIVITY = 1;

/** Default easing for smooth scroll animations */
export const SCROLL_EASING = (t: number): number => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** Default smooth scroll duration (ms) */
export const SCROLL_DURATION = 300;

// =============================================================================
// Bounded Logical Scroll (RFC-012)
// =============================================================================

/**
 * Runway size as a multiple of the viewport. The bounded content element is
 * sized to `containerSize × this` (capped at total size), giving the native
 * scrollbar room to move before a rebase shifts the logical origin.
 */
export const BOUNDED_RUNWAY_FACTOR = 2;

/**
 * Minimum runway multiple. The runway must exceed the viewport so native scroll
 * and touch/trackpad momentum have room before a rebase; below this there would
 * be little-to-no native scrollable range. User-supplied `scroll.runway` values
 * are clamped up to this floor.
 *
 * 1.5 keeps a half-viewport of native scroll travel — enough for the native
 * scrollbar and most touch gestures. The wheel/trackpad path is already fully
 * synthetic (driven in logical space), so it is unaffected by the runway size;
 * a small runway only risks interrupting native touch momentum at the edges.
 */
export const BOUNDED_RUNWAY_MIN = 1.5;

/**
 * Lower rebase trigger: when native scrollTop drops below this fraction of the
 * runway (and we are not already at the logical start), shift the origin back.
 */
export const BOUNDED_REBASE_LOW = 0.25;

/**
 * Upper rebase trigger: when native scrollTop rises above this fraction of the
 * runway (and we are not already at the logical end), shift the origin forward.
 */
export const BOUNDED_REBASE_HIGH = 0.75;

// =============================================================================
// Scrollbar
// =============================================================================

/** Default auto-hide behavior */
export const SCROLLBAR_AUTO_HIDE = true;

/** Default auto-hide delay in milliseconds */
export const SCROLLBAR_AUTO_HIDE_DELAY = 1000;

/** Default minimum thumb size in pixels */
export const SCROLLBAR_MIN_THUMB_SIZE = 30;

// =============================================================================
// Sparse Storage
// =============================================================================

/** Default chunk size for sparse storage */
export const CHUNK_SIZE = 100;

/** Default maximum cached items before eviction */
export const MAX_CACHED_ITEMS = 10_000;

/** Buffer for eviction (keep extra items around visible range) */
export const EVICTION_BUFFER = 500;

// =============================================================================
// Placeholder
// =============================================================================

/** Default character used for masking text in placeholders */
export const MASK_CHARACTER = "x";

/** Maximum items to sample for placeholder structure analysis */
export const MAX_SAMPLE_SIZE = 20;

/** Internal flag to identify placeholder items */
export const PLACEHOLDER_FLAG = "_isPlaceholder";

/** Prefix for placeholder item IDs */
export const PLACEHOLDER_ID_PREFIX = "__placeholder_";
