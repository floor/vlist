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
export { a11y } from "./plugins/a11y";
export { selection } from "./plugins/selection";
export type { SelectionPluginConfig } from "./plugins/selection";
export { page } from "./plugins/page";
export type { PagePluginConfig } from "./plugins/page";
export { snapshots } from "./plugins/snapshots";
export type { SnapshotsPluginConfig } from "./plugins/snapshots";
export { transition } from "./plugins/transition";
export type { TransitionPluginConfig } from "./plugins/transition";
export { autosize } from "./plugins/autosize";
export type { AutosizePluginConfig } from "./plugins/autosize";
export { masonry } from "./plugins/masonry";
export type { MasonryPluginConfig } from "./plugins/masonry";
export { async } from "./plugins/async";
export type { AsyncPluginConfig } from "./plugins/async";
export { groups } from "./plugins/groups";
export type { GroupsPluginConfig } from "./plugins/groups";
export { table } from "./plugins/table";
export type { TablePluginConfig } from "./plugins/table";
export { sortable } from "./plugins/sortable";
export type { SortablePluginConfig } from "./plugins/sortable";

// v1 builder API — disabled until features are migrated to v2 plugin interface
// export { withScale } from "./plugins/scale/feature";
// export { withAsync } from "./plugins/async";
// export { withScrollbar } from "./plugins/scrollbar/feature";
// export { withPage } from "./plugins/page";
// export { withGroups } from "./plugins/groups";
// export { withGrid } from "./plugins/grid/feature";
// export { withMasonry } from "./plugins/masonry";
// export { withSelection } from "./plugins/selection/feature";
// export { withSnapshots } from "./plugins/snapshots";
// export { withTable } from "./plugins/table";
// export { withSortable } from "./plugins/sortable";
// export { withAutoSize } from "./plugins/autosize";
// export { withTransition } from "./plugins/transition";

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