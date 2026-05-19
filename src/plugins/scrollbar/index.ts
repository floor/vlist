/**
 * vlist v2 — Scrollbar Plugin
 */

export { scrollbar, type ScrollbarPluginConfig } from "./plugin";
export {
  createScrollbar,
  type Scrollbar,
  type ScrollbarConfig,
  type ScrollCallback,
} from "./scrollbar";
export {
  createScrollController,
  rafThrottle,
  isAtBottom,
  isAtTop,
  getScrollPercentage,
  isRangeVisible,
  type ScrollController,
} from "./controller";
