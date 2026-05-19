/**
 * vlist - Lightweight Virtual List
 * High-performance virtual scrolling with zero dependencies
 * Builder-only API for optimal tree-shaking
 *
 * For low-level internals (size cache, renderers, selection state, etc.),
 * import from 'vlist/internals' instead.
 *
 * @packageDocumentation
 */

// v2 factory + plugins
export { createVList } from "./core/create";
export { scale } from "./plugins/scale";
export type { ScalePluginConfig } from "./plugins/scale";
export { scrollbar } from "./plugins/scrollbar";
export type { ScrollbarPluginConfig } from "./plugins/scrollbar";
export { grid } from "./plugins/grid";
export { selection } from "./plugins/selection";
export type { SelectionPluginConfig } from "./plugins/selection";

// v1 builder API — disabled until features are migrated to v2 plugin interface
// export { withScale } from "./plugins/scale/feature";
// export { withAsync } from "./features/async";
// export { withScrollbar } from "./plugins/scrollbar/feature";
// export { withPage } from "./features/page";
// export { withGroups } from "./features/groups";
// export { withGrid } from "./plugins/grid/feature";
// export { withMasonry } from "./features/masonry";
// export { withSelection } from "./plugins/selection/feature";
// export { withSnapshots } from "./features/snapshots";
// export { withTable } from "./features/table";
// export { withSortable } from "./features/sortable";
// export { withAutoSize } from "./features/autosize";
// export { withTransition } from "./features/transition";

// Utils
export { createStats } from "./utils/stats";
export type { Stats, StatsConfig, StatsState } from "./utils/stats";

// Core Types
export type {
  // Core types
  VListItem,
  VListEvents,

  // Template
  ItemConfig,
  ItemTemplate,
  ItemState,

  // Selection
  SelectionMode,
  SelectionConfig,
  SelectionState,

  // Scrollbar
  ScrollbarConfig,
  ScrollbarPadding,
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

  // Grid / Masonry / Groups config
  GridConfig,
  MasonryConfig,
  GroupsConfig,
  GroupHeaderConfig,

  // Grid (axis-neutral name + deprecated alias)
  GridSizeContext,
  GridHeightContext,
} from "./types";

// v2 core types
export type {
  VList,
  VListPlugin,
  PluginContext,
  CreateVListConfig,
  CompiledHooks,
  ResolvedConfig,
  DOMStructure,
  ElementPool,
} from "./core/types";