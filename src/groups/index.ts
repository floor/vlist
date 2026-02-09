/**
 * vlist - Groups Domain
 * Sticky headers and grouped lists
 */

// Types
export type {
  GroupsConfig,
  GroupBoundary,
  LayoutEntry,
  GroupHeaderItem,
  GroupLayout,
  StickyHeader,
} from "./types";

export { isGroupHeader } from "./types";

// Layout
export {
  createGroupLayout,
  buildLayoutItems,
  createGroupedHeightFn,
} from "./layout";

// Sticky Header
export { createStickyHeader } from "./sticky";
