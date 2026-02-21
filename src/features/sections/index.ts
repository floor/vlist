/**
 * vlist - Groups Domain
 * Sticky headers and grouped lists
 */

// Builder Feature
export { withSections, type GroupsFeatureConfig } from "./feature";

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
  createGroupedSizeFn,
} from "./layout";

// Sticky Header
export { createStickyHeader } from "./sticky";
