/**
 * vlist - Size Cache
 * Efficient size management for fixed and variable item sizes
 *
 * Provides two implementations:
 * - Fixed: O(1) operations using multiplication (zero overhead, matches existing behavior)
 * - Variable: O(1) offset lookup via prefix sums, O(log n) binary search for index-at-offset
 *
 * The SizeCache abstraction allows all virtual scrolling and compression code
 * to work identically with both fixed and variable sizes, for both vertical and horizontal scrolling.
 */

// =============================================================================
// Types
// =============================================================================

/** Size cache for efficient offset/index lookups (works for both vertical and horizontal) */
export interface SizeCache {
  /** Get offset (position along main axis) for an item index — O(1) */
  getOffset(index: number): number;

  /** Get size of a specific item (height for vertical, width for horizontal) */
  getSize(index: number): number;

  /** Find item index at a scroll offset — O(1) fixed, O(log n) variable */
  indexAtOffset(offset: number): number;

  /** Total content size (total height for vertical, total width for horizontal) */
  getTotalSize(): number;

  /** Current total item count */
  getTotal(): number;

  /** Rebuild cache (call when items change) */
  rebuild(totalItems: number): void;

  /** Whether sizes are variable (false = fixed fast path) */
  isVariable(): boolean;
}

// =============================================================================
// Fixed Size Cache
// =============================================================================

/**
 * Create a fixed-size cache
 * All operations are O(1) using simple multiplication — zero overhead
 */
const createFixedSizeCache = (
  size: number,
  initialTotal: number,
): SizeCache => {
  let total = initialTotal;

  return {
    getOffset: (index: number): number => index * size,

    getSize: (_index: number): number => size,

    indexAtOffset: (offset: number): number => {
      if (total === 0 || size === 0) return 0;
      return Math.max(0, Math.min(Math.floor(offset / size), total - 1));
    },

    getTotalSize: (): number => total * size,

    getTotal: (): number => total,

    rebuild: (newTotal: number): void => {
      total = newTotal;
    },

    isVariable: (): boolean => false,
  };
};

// =============================================================================
// Variable Size Cache
// =============================================================================

/**
 * Create a variable-size cache using prefix sums
 *
 * Prefix sums array: prefixSums[i] = sum of sizes for items 0..i-1
 *   prefixSums[0] = 0
 *   prefixSums[1] = size(0)
 *   prefixSums[n] = total size of all n items
 *
 * This enables:
 *   getOffset(i) = prefixSums[i]           — O(1)
 *   getTotalSize() = prefixSums[n]         — O(1)
 *   indexAtOffset(y) = binary search        — O(log n)
 */
const createVariableSizeCache = (
  sizeFn: (index: number) => number,
  initialTotal: number,
): SizeCache => {
  let total = initialTotal;
  let prefixSums: Float64Array = new Float64Array(0);

  /**
   * Build prefix sums from the size function
   * O(n) — only called on data changes, never on scroll
   */
  const build = (n: number): void => {
    total = n;
    prefixSums = new Float64Array(n + 1);
    prefixSums[0] = 0;
    for (let i = 0; i < n; i++) {
      prefixSums[i + 1] = prefixSums[i]! + sizeFn(i);
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

    getSize: (index: number): number => sizeFn(index),

    indexAtOffset: (offset: number): number => binarySearch(offset),

    getTotalSize: (): number => (prefixSums[total] as number) ?? 0,

    getTotal: (): number => total,

    rebuild: (newTotal: number): void => build(newTotal),

    isVariable: (): boolean => true,
  };
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a size cache — returns fixed or variable implementation
 *
 * When size is a number, returns a zero-overhead fixed implementation.
 * When size is a function, builds a prefix-sum array for efficient lookups.
 */
export const createSizeCache = (
  size: number | ((index: number) => number),
  initialTotal: number,
): SizeCache => {
  if (typeof size === "number") {
    return createFixedSizeCache(size, initialTotal);
  }
  return createVariableSizeCache(size, initialTotal);
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Count how many items fit in a given container size starting from startIndex
 * Used for compressed mode visible range calculations
 *
 * For fixed sizes: O(1) via division
 * For variable sizes: O(k) where k = visible item count (typically 10-50)
 */
export const countVisibleItems = (
  sizeCache: SizeCache,
  startIndex: number,
  containerSize: number,
  totalItems: number,
): number => {
  if (totalItems === 0) return 0;

  if (!sizeCache.isVariable()) {
    return Math.ceil(containerSize / sizeCache.getSize(0));
  }

  let count = 0;
  let accumulated = 0;
  let idx = startIndex;

  while (idx < totalItems && accumulated < containerSize) {
    accumulated += sizeCache.getSize(idx);
    count++;
    idx++;
  }

  return Math.max(1, count);
};

/**
 * Count how many items fit starting from the bottom of the list
 * Used for near-bottom interpolation in compressed mode
 *
 * For fixed sizes: O(1) via division
 * For variable sizes: O(k) where k = items fitting (typically 10-50)
 */
export const countItemsFittingFromBottom = (
  sizeCache: SizeCache,
  containerSize: number,
  totalItems: number,
): number => {
  if (totalItems === 0) return 0;

  if (!sizeCache.isVariable()) {
    return Math.floor(containerSize / sizeCache.getSize(0));
  }

  let count = 0;
  let accumulated = 0;

  for (let i = totalItems - 1; i >= 0; i--) {
    const s = sizeCache.getSize(i);
    if (accumulated + s > containerSize) break;
    accumulated += s;
    count++;
  }

  return Math.max(count, 1);
};

/**
 * Calculate the pixel offset for a fractional virtual scroll index
 *
 * In compressed mode, the scroll position maps to a fractional item index
 * (e.g., 5.3 means 30% into item 5). This function calculates the actual
 * pixel offset for such a fractional position using variable sizes.
 *
 * For fixed sizes this reduces to: virtualIndex * itemSize
 * For variable sizes: offset(floor) + frac * size(floor)
 */
export const getOffsetForVirtualIndex = (
  sizeCache: SizeCache,
  virtualIndex: number,
  totalItems: number,
): number => {
  if (totalItems === 0) return 0;

  const intPart = Math.floor(virtualIndex);
  const fracPart = virtualIndex - intPart;
  const safeInt = Math.max(0, Math.min(intPart, totalItems - 1));

  return sizeCache.getOffset(safeInt) + fracPart * sizeCache.getSize(safeInt);
};
