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
export { scrollbar } from "./plugins/scrollbar";
export type { ScrollbarPluginConfig } from "./plugins/scrollbar";
export { grid } from "./plugins/grid";
export type { GridPluginConfig } from "./plugins/grid";
export { a11y } from "./plugins/a11y";
export type { A11yPluginConfig } from "./plugins/a11y";
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
export { data } from "./plugins/data";
export type { DataPluginConfig } from "./plugins/data";
export { groups } from "./plugins/groups";
export type { GroupsPluginConfig } from "./plugins/groups";
export { table } from "./plugins/table";
export type { TablePluginConfig } from "./plugins/table";
export { sortable } from "./plugins/sortable";
export type { SortablePluginConfig } from "./plugins/sortable";
export { tree } from "./plugins/tree";
export type { TreePluginConfig, FlatNode } from "./plugins/tree";
export { search, DEFAULT_SEARCH_TEXT } from "./plugins/search";
export type { SearchPluginConfig, SearchText } from "./plugins/search";
export { carousel, registerPreset, getPreset, resolvePreset, full, hero, heroCenter, multi, uncontained } from "./plugins/carousel";
export type { CarouselPluginConfig, CarouselVariant, CarouselDirection, CarouselState, SlotConfig, SlotConfigResolver, TextFade } from "./plugins/carousel";

// Plugin method types: what each plugin adds to the list instance.
export type { AutosizeMethods } from "./plugins/autosize";
export type { CarouselMethods } from "./plugins/carousel";
export type { DataMethods } from "./plugins/data";
export type { GridMethods } from "./plugins/grid";
export type { GroupsMethods } from "./plugins/groups";
export type { MasonryMethods } from "./plugins/masonry";
export type { ScrollbarMethods } from "./plugins/scrollbar";
export type { SearchMethods } from "./plugins/search";
export type { SelectionMethods } from "./plugins/selection";
export type { SnapshotsMethods } from "./plugins/snapshots";
export type { SortableMethods } from "./plugins/sortable";
export type { TableMethods } from "./plugins/table";
export type { TreeMethods } from "./plugins/tree";

// Utils
export { createStats } from "./utils/stats";
export type { Stats, StatsConfig, StatsState } from "./utils/stats";
export { rebuild } from "./utils/rebuild";
export type { RebuildOptions } from "./utils/rebuild";

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

  // Tree
  TreeState,
} from "./types";

// v2 core types
export type {
  Axis,
  AxisConfig,
  VList,
  VListPlugin,
  PluginMethods,
  PluginContext,
  CreateVListConfig,
  CompiledHooks,
  ResolvedConfig,
  DOMStructure,
  ElementPool,
} from "./core/types";