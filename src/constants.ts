/**
 * vlist - Constants
 * All default values and magic numbers in one place
 */

// =============================================================================
// Virtual Scrolling
// =============================================================================

/** Default number of extra items to render outside viewport */
export const OVERSCAN = 3;

/** Default CSS class prefix */
export const CLASS_PREFIX = "vlist";

// =============================================================================
// Data Loading
// =============================================================================

/** Distance from bottom (in pixels) to trigger infinite scroll */
export const LOAD_THRESHOLD = 200;

/** Default number of items to load per request */
export const INITIAL_LOAD_SIZE = 50;

/** Default load size for data manager */
export const LOAD_SIZE = 50;

// =============================================================================
// Velocity-Based Loading
// =============================================================================

/**
 * Velocity threshold above which data loading is cancelled (px/ms)
 * When scrolling faster than this, we skip loading data since the user
 * is likely scrolling quickly past content they don't want to see.
 */
export const LOAD_VELOCITY_THRESHOLD = 5;

/**
 * Velocity threshold for preloading (px/ms)
 * When scrolling faster than this but slower than LOAD_VELOCITY_THRESHOLD,
 * we preload extra items in the scroll direction to reduce placeholder flashing.
 */
export const PRELOAD_VELOCITY_THRESHOLD = 2;

/**
 * Number of extra items to preload ahead of scroll direction
 * Only applies when velocity is between PRELOAD_VELOCITY_THRESHOLD and
 * LOAD_VELOCITY_THRESHOLD.
 */
export const PRELOAD_AHEAD = 50;

// =============================================================================
// Compression (Large Lists)
// =============================================================================

/**
 * Maximum virtual size in pixels along the main axis
 * Most browsers support ~16.7M pixels, we use 16M for safety margin
 */
export const MAX_VIRTUAL_SIZE = 16_000_000;

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
// Scroll
// =============================================================================

/** Idle timeout for scroll detection (ms) */
export const SCROLL_IDLE_TIMEOUT = 150;

/** Default wheel sensitivity multiplier */
export const WHEEL_SENSITIVITY = 1;