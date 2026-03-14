/**
 * vlist - Lightweight Virtual List
 * High-performance virtual scrolling with zero dependencies
 * Builder-only API for optimal tree-shaking
 *
 * For low-level internals (size cache, renderers, selection state, etc.),
 * import from '@floor/vlist/internals' instead.
 *
 * @packageDocumentation
 */

// Main builder export
export { vlist } from "./builder";

// Features - tree-shakeable
export { withScale } from "./features/scale";
export { withAsync } from "./features/async";
export { withScrollbar } from "./features/scrollbar";
export { withPage } from "./features/page";
export { withGroups } from "./features/groups";
export { withGrid } from "./features/grid";
export { withMasonry } from "./features/masonry";
export { withSelection } from "./features/selection";
export { withSnapshots } from "./features/snapshots";
export { withTable } from "./features/table";

// Utils
export { createStats } from "./utils/stats";
export type { Stats, StatsConfig, StatsState } from "./utils/stats";

// Core Types
export type {
  // Core types
  VListItem,
  VListEvents,

  // Template
  ItemTemplate,
  ItemState,

  // Selection
  SelectionMode,
  SelectionConfig,
  SelectionState,

  // Scrollbar
  ScrollbarConfig,
  ScrollbarOptions,

  // Scroll
  ScrollConfig,
  ScrollToOptions,
  ScrollSnapshot,

  // Data adapter
  VListAdapter,
  AdapterParams,
  AdapterResponse,

  // Viewport
  Range,
  ViewportState,

  // Events
  EventHandler,
  Unsubscribe,

  // Grid (axis-neutral name + deprecated alias)
  GridSizeContext,
  GridHeightContext,
} from "./types";

// Builder types
export type {
  VListBuilder,
  VList,
  BuilderConfig,
  VListConfig,
  VListFeature,
  BuilderContext,
} from "./builder";