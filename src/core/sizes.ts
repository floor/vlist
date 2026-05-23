/**
 * vlist v2 — Size Cache
 *
 * Float64Array prefix sums with O(1) offset lookups and O(log n) binary search.
 */

export {
  createSizeCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
} from "../rendering/sizes";

export type { SizeCache } from "../rendering/sizes";
