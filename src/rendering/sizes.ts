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

  /**
   * Re-read the sizes of `startIndex..endIndex`, an ascending in-range pair —
   * cost independent of the total item count.
   *
   * Use this instead of `rebuild` when a handful of item sizes changed but the
   * item count did not: a measurement batch from `autosize()`, say. The
   * variable cache re-reads the size function only for the blocks the range
   * touches, where `rebuild` re-reads every item. Out-of-range bounds are
   * ignored. On the fixed cache this is a no-op, since every item is the same
   * size.
   */
  invalidate(startIndex: number, endIndex?: number): void;

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
  gap: number,
): SizeCache => {
  let total = initialTotal;

  return {
    getOffset: (index: number): number => index * size,

    getSize: (_index: number): number => size,

    indexAtOffset: (offset: number): number => {
      if (total === 0 || size === 0) return 0;
      return Math.max(0, Math.min(Math.floor(offset / size), total - 1));
    },

    getTotalSize: (): number => {
      // One trailing gap: the last slot carries a gap that is spacing between
      // items, not content. Every caller used to correct this by hand.
      const t = total * size;
      return t > 0 ? t - gap : 0;
    },

    getTotal: (): number => total,

    rebuild: (newTotal: number): void => {
      total = newTotal;
    },

    // Every item is the same size, so nothing can go stale.
    invalidate: (): void => {},

    isVariable: (): boolean => false,
  };
};

// =============================================================================
// Variable Size Cache
// =============================================================================

/**
 * Items per block in the variable cache. A fixed 512 keeps an invalidation at
 * 512 size-function reads plus one addition per block, whatever the list
 * length. Lists shorter than this hold a single block and behave exactly as a
 * flat prefix-sum array did.
 */
const BLOCK_SHIFT = 9;
const BLOCK_SIZE = 1 << BLOCK_SHIFT;

/** Largest index in [lo, hi] whose entry in `arr` is <= target */
const lastAtMost = (
  arr: Float64Array,
  lo: number,
  hi: number,
  target: number,
): number => {
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (arr[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/**
 * Create a variable-size cache using two-level prefix sums
 *
 * A flat prefix-sum array answers offsets in O(1) but costs a pass over every
 * item whenever a single size changes — the measurement batches `autosize()`
 * emits while scrolling made that pass dominate. Splitting the sums in two
 * fixes it:
 *
 *   blockOffsets[b] = absolute offset of the first item in block b
 *   inner[i]        = offset of item i from the start of its own block
 *
 * A changed item only dirties its own block, so refreshing it re-reads one
 * block's worth of sizes and walks the block offsets, never the whole list.
 *
 *   getOffset(i) = blockOffsets[i >> 9] + inner[i]    — O(1)
 *   getTotalSize() = blockOffsets[blockCount]         — O(1)
 *   indexAtOffset(y) = two binary searches             — O(log n)
 *   invalidate(a, b) = the blocks it touches, and the
 *                      block offsets after them        — O(n / 512)
 */
const createVariableSizeCache = (
  sizeFn: (index: number) => number,
  initialTotal: number,
  gap: number,
): SizeCache => {
  let total = 0;
  let blockCount = 0;
  let inner: Float64Array = new Float64Array(0);
  let blockTotals: Float64Array = new Float64Array(0);
  let blockOffsets: Float64Array = new Float64Array(1);

  /** Re-read blocks `first..last`, then re-run the offsets from `first` on */
  const rebuildBlocks = (first: number, last: number): void => {
    for (let b = first; b < blockCount; b++) {
      if (b <= last) {
        const start = b << BLOCK_SHIFT;
        const end = Math.min(start + BLOCK_SIZE, total);
        let acc = 0;
        for (let i = start; i < end; i++) {
          inner[i] = acc;
          acc += sizeFn(i);
        }
        blockTotals[b] = acc;
      }
      blockOffsets[b + 1] = blockOffsets[b]! + blockTotals[b]!;
    }
  };

  /**
   * Build every block from the size function
   * O(n) — only called on data changes, never on scroll
   */
  const build = (n: number): void => {
    total = n;
    blockCount = Math.ceil(n / BLOCK_SIZE);
    inner = new Float64Array(n);
    blockTotals = new Float64Array(blockCount);
    blockOffsets = new Float64Array(blockCount + 1);
    rebuildBlocks(0, blockCount - 1);
  };

  // Initial build
  build(initialTotal);

  return {
    getOffset: (index: number): number => {
      if (index <= 0) return 0;
      if (index >= total) return blockOffsets[blockCount]!;
      return blockOffsets[index >>> BLOCK_SHIFT]! + inner[index]!;
    },

    getSize: (index: number): number => sizeFn(index),

    // The item containing `offset`: the largest index whose own offset is at
    // or before it. The first search picks the block, the second the item.
    indexAtOffset: (offset: number): number => {
      if (total === 0 || offset <= 0) return 0;
      if (offset >= blockOffsets[blockCount]!) return total - 1;

      const block = lastAtMost(blockOffsets, 0, blockCount - 1, offset);
      const start = block << BLOCK_SHIFT;
      return lastAtMost(
        inner,
        start,
        Math.min(start + BLOCK_SIZE, total) - 1,
        offset - blockOffsets[block]!,
      );
    },

    getTotalSize: (): number => {
      const t = blockOffsets[blockCount]!;
      return t > 0 ? t - gap : 0;
    },

    getTotal: (): number => total,

    rebuild: (newTotal: number): void => build(newTotal),

    invalidate: (startIndex: number, endIndex = startIndex): void => {
      // The bounds check also rejects NaN.
      if (startIndex >= 0 && endIndex < total) {
        rebuildBlocks(startIndex >>> BLOCK_SHIFT, endIndex >>> BLOCK_SHIFT);
      }
    },

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
 *
 * `gap` is the spacing already baked into each slot by the caller's size spec.
 * The cache subtracts one trailing gap from the total, because the space after
 * the last item is not content. Pass 0 when the spec carries no gap. Core,
 * autosize and grid each re-implemented this correction, and a plugin that
 * replaced the size config silently dropped whichever copy was installed.
 */
export const createSizeCache = (
  size: number | ((index: number) => number),
  initialTotal: number,
  gap = 0,
): SizeCache => {
  if (typeof size === "number") {
    return createFixedSizeCache(size, initialTotal, gap);
  }
  return createVariableSizeCache(size, initialTotal, gap);
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
