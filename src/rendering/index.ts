/**
 * vlist - Rendering Domain
 * Size cache and DOM sorting shared by the core engine and layout plugins.
 */

// Size Cache (dimension-agnostic for vertical/horizontal scrolling)
export {
  createSizeCache,
  countVisibleItems,
  countItemsFittingFromBottom,
  getOffsetForVirtualIndex,
  type SizeCache,
} from "./sizes";

// DOM Sort (accessibility — reorder children on scroll idle)
export { sortRenderedDOM } from "./sort";
