/**
 * vlist - Scroll Domain
 * Scroll controller and custom scrollbar
 */

// Builder Plugin
export { withScrollbar, type ScrollbarPluginConfig } from "./plugin";

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
