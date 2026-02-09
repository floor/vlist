/**
 * vlist - Group Types
 * Types for sticky headers and grouped lists
 */

import type { VListItem } from "../types";

// =============================================================================
// Configuration
// =============================================================================

/** Groups configuration for createVList */
export interface GroupsConfig {
  /**
   * Determine which group an item belongs to.
   * Called with the DATA index (index into the original items array).
   * Items with the same group key are grouped together.
   *
   * Items MUST be pre-sorted by group — the function is called in order
   * and a new header is inserted whenever the return value changes.
   */
  getGroupForIndex: (index: number) => string;

  /**
   * Height of group header elements in pixels.
   * - `number` — Fixed height for all headers
   * - `(group: string, groupIndex: number) => number` — Variable height per group
   */
  headerHeight: number | ((group: string, groupIndex: number) => number);

  /**
   * Template function to render a group header.
   * Receives the group key and the group's sequential index (0-based).
   */
  headerTemplate: (group: string, groupIndex: number) => string | HTMLElement;

  /**
   * Enable sticky headers (default: true).
   * When true, the current group's header "sticks" to the top of the
   * viewport and is pushed out by the next group's header approaching.
   */
  sticky?: boolean;
}

// =============================================================================
// Group Layout
// =============================================================================

/** A single group boundary */
export interface GroupBoundary {
  /** Group key (return value of getGroupForIndex) */
  key: string;

  /** Sequential group index (0-based) */
  groupIndex: number;

  /** Layout index of this group's header */
  headerLayoutIndex: number;

  /** Data index of the first item in this group */
  firstDataIndex: number;

  /** Number of data items in this group */
  count: number;
}

/** Entry type in the layout — either a group header or a data item */
export type LayoutEntry =
  | { type: "header"; group: GroupBoundary }
  | { type: "item"; dataIndex: number; group: GroupBoundary };

// =============================================================================
// Group Header Pseudo-Item
// =============================================================================

/**
 * Internal marker for group header pseudo-items inserted into the layout.
 * These are interleaved with real data items in the transformed items array.
 */
export interface GroupHeaderItem extends VListItem {
  /** Always `__group_header_{groupIndex}` */
  id: string;

  /** Discriminator flag */
  __groupHeader: true;

  /** The group key */
  groupKey: string;

  /** Sequential group index (0-based) */
  groupIndex: number;
}

/**
 * Type guard: check if an item is a group header pseudo-item
 */
export const isGroupHeader = (item: unknown): item is GroupHeaderItem => {
  return (
    item !== null &&
    typeof item === "object" &&
    (item as GroupHeaderItem).__groupHeader === true
  );
};

// =============================================================================
// Group Layout Instance
// =============================================================================

/** Group layout — maps between data indices and layout indices */
export interface GroupLayout {
  /** Total layout entries (data items + group headers) */
  readonly totalEntries: number;

  /** Number of groups */
  readonly groupCount: number;

  /** All group boundaries, in order */
  readonly groups: readonly GroupBoundary[];

  /** Get the layout entry at a layout index — O(log g) */
  getEntry: (layoutIndex: number) => LayoutEntry;

  /** Map layout index → data index, or -1 if it's a header — O(log g) */
  layoutToDataIndex: (layoutIndex: number) => number;

  /** Map data index → layout index — O(log g) */
  dataToLayoutIndex: (dataIndex: number) => number;

  /** Get the group boundary that contains a given layout index — O(log g) */
  getGroupAtLayoutIndex: (layoutIndex: number) => GroupBoundary;

  /** Get the group boundary that contains a given data index — O(log g) */
  getGroupAtDataIndex: (dataIndex: number) => GroupBoundary;

  /** Get header height for a group */
  getHeaderHeight: (groupIndex: number) => number;

  /**
   * Rebuild the layout from scratch.
   * Call when items change (setItems, append, prepend, remove, etc.)
   */
  rebuild: (itemCount: number) => void;
}

// =============================================================================
// Sticky Header Instance
// =============================================================================

/** Sticky header manager */
export interface StickyHeader {
  /** Update sticky header position and content based on scroll position */
  update: (scrollTop: number) => void;

  /** Force refresh the sticky header content (e.g. after items change) */
  refresh: () => void;

  /** Show the sticky header */
  show: () => void;

  /** Hide the sticky header */
  hide: () => void;

  /** Destroy and remove the sticky header DOM element */
  destroy: () => void;
}
