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
} from "./renderer";

// Virtual Scrolling
export {
  createViewportState,
  updateViewportState,
  updateViewportSize,
  updateViewportItems,
  calculateVisibleRange,
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
  getCompressionState,
} from "./virtual";

// Compression
export {
  MAX_VIRTUAL_HEIGHT,
  getCompressionState as getCompression,
  needsCompression,
  getMaxItemsWithoutCompression,
  getCompressionInfo,
  calculateCompressedVisibleRange,
  calculateCompressedRenderRange,
  calculateCompressedItemPosition,
  calculateCompressedScrollToIndex,
  calculateIndexFromScrollPosition,
  type CompressionState,
} from "./compression";
