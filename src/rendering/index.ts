/**
 * vlist - Render Domain
 * Rendering, virtualization, and compression
 */

// Height Cache
export {
  createHeightCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
  type HeightCache,
} from "./heights";

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

// Virtual Scrolling
export {
  createViewportState,
  updateViewportState,
  updateViewportSize,
  updateViewportItems,
  calculateRenderRange,
  calculateTotalHeight,
  calculateActualHeight,
  calculateItemOffset,
  calculateScrollToIndex,
  clampScrollPosition,
  getScrollDirection,
  rangesEqual,
  isInRange,
  getRangeCount,
  diffRanges,
  getSimpleCompressionState,
  simpleVisibleRange,
  simpleScrollToIndex,
  NO_COMPRESSION,
  type CompressionState,
  type VisibleRangeFn,
  type ScrollToIndexFn,
} from "./virtual";

// Compression (full module — used by monolithic factory and withCompression plugin)
export {
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
} from "./compression";
