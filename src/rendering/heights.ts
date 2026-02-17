/**
 * vlist - Height Cache
 * Efficient height management for fixed and variable item heights
 *
 * Provides two implementations:
 * - Fixed: O(1) operations using multiplication (zero overhead, matches existing behavior)
 * - Variable: O(1) offset lookup via prefix sums, O(log n) binary search for index-at-offset
 *
 * The HeightCache abstraction allows all virtual scrolling and compression code
 * to work identically with both fixed and variable heights.
 */

// =============================================================================
// Types
// =============================================================================

/** Height cache for efficient offset/index lookups */
export interface HeightCache {
  /** Get offset (Y position) for an item index — O(1) */
  getOffset(index: number): number;

  /** Get height of a specific item */
  getHeight(index: number): number;

  /** Find item index at a scroll offset — O(1) fixed, O(log n) variable */
  indexAtOffset(offset: number): number;

  /** Total content height */
  getTotalHeight(): number;

  /** Current total item count */
  getTotal(): number;

  /** Rebuild cache (call when items change) */
  rebuild(totalItems: number): void;

  /** Whether heights are variable (false = fixed fast path) */
  isVariable(): boolean;
}

// =============================================================================
// Fixed Height Cache
// =============================================================================

/**
 * Create a fixed-height cache
 * All operations are O(1) using simple multiplication — zero overhead
 */
const createFixedHeightCache = (
  height: number,
  initialTotal: number,
): HeightCache => {
  let total = initialTotal;

  return {
    getOffset: (index: number): number => index * height,

    getHeight: (_index: number): number => height,

    indexAtOffset: (offset: number): number => {
      if (total === 0 || height === 0) return 0;
      return Math.max(0, Math.min(Math.floor(offset / height), total - 1));
    },

    getTotalHeight: (): number => total * height,

    getTotal: (): number => total,

    rebuild: (newTotal: number): void => {
      total = newTotal;
    },

    isVariable: (): boolean => false,
  };
};

// =============================================================================
// Variable Height Cache
// =============================================================================

/**
 * Create a variable-height cache using prefix sums
 *
 * Prefix sums array: prefixSums[i] = sum of heights for items 0..i-1
 *   prefixSums[0] = 0
 *   prefixSums[1] = height(0)
 *   prefixSums[n] = total height of all n items
 *
 * This enables:
 *   getOffset(i) = prefixSums[i]           — O(1)
 *   getTotalHeight() = prefixSums[n]       — O(1)
 *   indexAtOffset(y) = binary search        — O(log n)
 */
const createVariableHeightCache = (
  heightFn: (index: number) => number,
  initialTotal: number,
): HeightCache => {
  let total = initialTotal;
  let prefixSums: Float64Array = new Float64Array(0);

  /**
   * Build prefix sums from the height function
   * O(n) — only called on data changes, never on scroll
   */
  const build = (n: number): void => {
    total = n;
    prefixSums = new Float64Array(n + 1);
    prefixSums[0] = 0;
    for (let i = 0; i < n; i++) {
      prefixSums[i + 1] = prefixSums[i]! + heightFn(i);
    }
  };

  // Initial build
  build(initialTotal);

  /**
   * Binary search: find the largest index i where prefixSums[i] <= offset
   * This gives the item that contains the given scroll offset
   */
  const binarySearch = (offset: number): number => {
    if (total === 0) return 0;

    // Clamp to valid range
    if (offset <= 0) return 0;
    if (offset >= prefixSums[total]!) return total - 1;

    let lo = 0;
    let hi = total - 1;

    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (prefixSums[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return lo;
  };

  return {
    getOffset: (index: number): number => {
      if (index <= 0) return 0;
      if (index >= total) return prefixSums[total] as number;
      return prefixSums[index] as number;
    },

    getHeight: (index: number): number => heightFn(index),

    indexAtOffset: (offset: number): number => binarySearch(offset),

    getTotalHeight: (): number => (prefixSums[total] as number) ?? 0,

    getTotal: (): number => total,

    rebuild: (newTotal: number): void => build(newTotal),

    isVariable: (): boolean => true,
  };
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a height cache — returns fixed or variable implementation
 *
 * When height is a number, returns a zero-overhead fixed implementation.
 * When height is a function, builds a prefix-sum array for efficient lookups.
 */
export const createHeightCache = (
  height: number | ((index: number) => number),
  initialTotal: number,
): HeightCache => {
  if (typeof height === "number") {
    return createFixedHeightCache(height, initialTotal);
  }
  return createVariableHeightCache(height, initialTotal);
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Count how many items fit in a given container height starting from startIndex
 * Used for compressed mode visible range calculations
 *
 * For fixed heights: O(1) via division
 * For variable heights: O(k) where k = visible item count (typically 10-50)
 */
export const countVisibleItems = (
  heightCache: HeightCache,
  startIndex: number,
  containerHeight: number,
  totalItems: number,
): number => {
  if (totalItems === 0) return 0;

  if (!heightCache.isVariable()) {
    return Math.ceil(containerHeight / heightCache.getHeight(0));
  }

  let count = 0;
  let accumulated = 0;
  let idx = startIndex;

  while (idx < totalItems && accumulated < containerHeight) {
    accumulated += heightCache.getHeight(idx);
    count++;
    idx++;
  }

  return Math.max(1, count);
};

/**
 * Count how many items fit starting from the bottom of the list
 * Used for near-bottom interpolation in compressed mode
 *
 * For fixed heights: O(1) via division
 * For variable heights: O(k) where k = items fitting (typically 10-50)
 */
export const countItemsFittingFromBottom = (
  heightCache: HeightCache,
  containerHeight: number,
  totalItems: number,
): number => {
  if (totalItems === 0) return 0;

  if (!heightCache.isVariable()) {
    return Math.floor(containerHeight / heightCache.getHeight(0));
  }

  let count = 0;
  let accumulated = 0;

  for (let i = totalItems - 1; i >= 0; i--) {
    const h = heightCache.getHeight(i);
    if (accumulated + h > containerHeight) break;
    accumulated += h;
    count++;
  }

  return Math.max(count, 1);
};

/**
 * Calculate the pixel offset for a fractional virtual scroll index
 *
 * In compressed mode, the scroll position maps to a fractional item index
 * (e.g., 5.3 means 30% into item 5). This function calculates the actual
 * pixel offset for such a fractional position using variable heights.
 *
 * For fixed heights this reduces to: virtualIndex * itemHeight
 * For variable heights: offset(floor) + frac * height(floor)
 */
export const getOffsetForVirtualIndex = (
  heightCache: HeightCache,
  virtualIndex: number,
  totalItems: number,
): number => {
  if (totalItems === 0) return 0;

  const intPart = Math.floor(virtualIndex);
  const fracPart = virtualIndex - intPart;
  const safeInt = Math.max(0, Math.min(intPart, totalItems - 1));

  return (
    heightCache.getOffset(safeInt) + fracPart * heightCache.getHeight(safeInt)
  );
};
