/**
 * vlist v2 — Tree Plugin Types
 */

import type { VListItem } from "../../types";

// =============================================================================
// Configuration
// =============================================================================

export interface TreePluginConfig<T extends VListItem = VListItem> {
  /** Property name or accessor returning child items (nested mode). Default: "children". */
  children?: string | ((item: T) => T[]);

  /** Property name or accessor returning parent ID (flat mode). */
  parentId?: string | ((item: T) => string | number | null);

  /** Property name or accessor returning a text label for type-ahead and ARIA. */
  label?: string | ((item: T) => string);

  /** Indent per depth level in pixels. Default: 24. */
  indent?: number;

  /** Initial expand state: false (all collapsed), true (all expanded), ID array, or predicate. */
  expanded?: boolean | (string | number)[] | ((item: T) => boolean);

  /** Toggle expand/collapse on item click. Default: false. */
  expandOnClick?: boolean;

  /** Show tree connector lines. Requires vlist-tree.css. Default: false. */
  connectorLines?: boolean;

  /** Async child loader — called when expanding a node with no loaded children. */
  loadChildren?: (item: T) => Promise<T[]>;
}

// =============================================================================
// FlatNode — one visible entry in the flattened tree
// =============================================================================

export interface FlatNode<T> {
  item: T;
  id: string | number;
  depth: number;
  parentId: string | number | null;
  hasChildren: boolean;
  expanded: boolean;
  childCount: number;
  siblingCount: number;
  positionInSiblings: number;
  isLastChild: boolean;
  loading: boolean;
}
