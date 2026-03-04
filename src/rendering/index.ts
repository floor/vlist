/**
 * vlist - Rendering Domain
 * Rendering, virtualization, and scaling for large datasets
 */

// Size Cache (dimension-agnostic for vertical/horizontal scrolling)
export {
  createSizeCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
  type SizeCache,
} from "./sizes";

// Measured Size Cache (auto-measurement for Mode B)
export {
  createMeasuredSizeCache,
  type MeasuredSizeCache,
} from "./measured";

// DOM Sort (accessibility — reorder children on scroll idle)
export { sortRenderedDOM } from "./sort";

// Renderer
export {
  createRenderer,
  createDOMStructure,
  updateContentHeight,
  updateContentWidth,
  resolveContainer,
  getContainerDimensions,
  type Renderer,
  type DOMStructure,
  type CompressionContext,
  type CompressedPositionFn,
  type CompressionStateFn,
} from "./renderer";

// Viewport Scrolling
export {
  createViewportState,
  updateViewportState,
  updateViewportSize,
  updateViewportItems,
  calculateRenderRange,
  calculateTotalSize,
  calculateActualSize,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  getScrollDirection,
  rangesEqual,
  isInRange,
  getRangeCount,
  rangeToIndices,
  diffRanges,
  getSimpleCompressionState,
  simpleVisibleRange,
  simpleScrollToIndex,
  NO_COMPRESSION,
  type CompressionState,
  type VisibleRangeFn,
  type ScrollToIndexFn,
} from "./viewport";

// Scale (large dataset handling - used by withScale feature)
export {
  MAX_VIRTUAL_SIZE,
  MAX_VIRTUAL_HEIGHT,
  getCompressionState,
  getCompressionState as getCompression,
  needsCompression,
  getMaxItemsWithoutCompression,
  getCompressionInfo,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  calculateIndexFromScrollPosition,
} from "./scale";
