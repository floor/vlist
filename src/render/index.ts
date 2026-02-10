/**
 * vlist - Render Domain
 * Rendering, virtualization, compression, DOM utilities, and element pooling
 */

// DOM Utilities (shared with core.ts)
export {
  createDOMStructure,
  updateContentHeight,
  updateContentSize,
  resolveContainer,
  getContainerDimensions,
  type DOMStructure,
} from "./dom";

// Element Pool (shared with core.ts)
export { createElementPool, type ElementPool } from "./pool";

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
  type Renderer,
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
