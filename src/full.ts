/**
 * vlist/full - Legacy Monolithic API
 *
 * This entry point provides the original createVList implementation that includes
 * all features bundled together. It's larger but simpler for quick prototyping.
 *
 * For production use, prefer the default 'vlist' entry point (builder-based) which
 * results in smaller bundles by only including the features you actually use.
 *
 * @example
 * ```ts
 * import { createVList } from 'vlist/full';
 *
 * const list = createVList({
 *   container: '#app',
 *   item: { height: 48, template: renderItem },
 *   items: data,
 * });
 * ```
 *
 * @packageDocumentation
 */

// Export the full monolithic implementation
export { createVList } from "./vlist-full";

// Re-export types for convenience
export type {
  VList,
  VListConfig,
  VListItem,
  VListEvents,
  ItemTemplate,
  ItemState,
  SelectionMode,
  SelectionConfig,
  GridConfig,
  GroupsConfig,
  ScrollConfig,
  ScrollToOptions,
  ScrollSnapshot,
  VListAdapter,
  Range,
} from "./types";
