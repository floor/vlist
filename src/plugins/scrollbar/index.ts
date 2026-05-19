/**
 * vlist - Scroll Domain
 * Scroll controller and custom scrollbar
 */

// Builder Feature
export { withScrollbar, type ScrollbarFeatureConfig } from "./feature";

// Scroll Controller
export {
  createScrollController,
  rafThrottle,
  isAtBottom,
  isAtTop,
  getScrollPercentage,
  isRangeVisible,
  type ScrollController,
  type ScrollControllerConfig,
  type ScrollEventData,
  type ScrollDirection,
} from "./controller";

// Custom Scrollbar
export {
  createScrollbar,
  type Scrollbar,
  type ScrollbarConfig,
  type ScrollCallback,
} from "./scrollbar";
