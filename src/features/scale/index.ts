/**
 * vlist - Compression Sub-module
 * Re-exports compression utilities for tree-shakeable imports
 *
 * Usage: import { getCompressionInfo } from 'vlist/compression'
 * Usage: import { withScale } from 'vlist/compression'
 */

export {
  MAX_VIRTUAL_HEIGHT,
  getCompressionState,
  needsCompression,
  getMaxItemsWithoutCompression,
  getCompressionInfo,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  calculateIndexFromScrollPosition,
  type CompressionState,
} from "../../rendering/scale";

export { withScale } from "./feature";
