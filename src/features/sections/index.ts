/**
 * vlist - Groups Domain
 * Sticky headers and grouped lists
 */

// Builder Plugin
export { withSections, type GroupsPluginConfig } from "./plugin";

// Types
export type {
  GroupsConfig,
  GroupBoundary,
  LayoutEntry,
  GroupHeaderItem,
  GroupLayout,
  StickyHeader,
} from "./types";

export { isGroupHeader, isGroupHeader as isSectionHeader } from "./types";

// Layout
export {
  createGroupLayout,
  buildLayoutItems,
  createGroupedHeightFn,
} from "./layout";

// Sticky Header
export { createStickyHeader } from "./sticky";
