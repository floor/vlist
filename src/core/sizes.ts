/**
 * vlist v2 — Size Cache
 *
 * Re-exports v1 size cache. The v1 implementation already uses Float64Array
 * prefix sums with O(1) offset lookups and O(log n) binary search — exactly
 * what the v2 pipeline requires. No reason to rewrite.
 */

export {
  createSizeCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
} from "../rendering/sizes";

export type { SizeCache } from "../rendering/sizes";
