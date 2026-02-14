/**
 * vlist - Virtual List (Builder-based)
 *
 * This is the new default entry point that uses the builder pattern internally.
 * It provides full backwards compatibility with the monolithic API while maintaining
 * modularity and smaller bundle sizes through automatic plugin application.
 *
 * For the legacy monolithic implementation, use 'vlist/full' instead.
 */

import { vlist as builderVlist } from "./builder";
import { withGrid } from "./grid/plugin";
import { withGroups } from "./groups/plugin";
import { withSelection } from "./selection/plugin";
import { withScrollbar } from "./scroll/plugin";
import { withCompression } from "./compression/plugin";
import { withSnapshots } from "./snapshots/plugin";
import { withData } from "./data/plugin";

import type { VListConfig, VListItem, VList } from "./types";

/**
 * Create a virtual list instance.
 *
 * This is a convenience wrapper around the builder pattern that automatically
 * includes plugins based on the configuration provided, maintaining full backwards
 * compatibility with the monolithic API.
 *
 * @example Basic list
 * ```ts
 * import { createVList } from 'vlist';
 *
 * const list = createVList({
 *   container: '#app',
 *   item: { height: 48, template: renderItem },
 *   items: data,
 * });
 * ```
 *
 * @example Grid layout with dynamic aspect ratio
 * ```ts
 * const gallery = createVList({
 *   container: '#gallery',
 *   layout: 'grid',
 *   grid: { columns: 4, gap: 8 },
 *   item: {
 *     height: (index, context) => context.columnWidth * 0.75,
 *     template: renderPhoto,
 *   },
 *   items: photos,
 * });
 *
 * // Update grid configuration
 * gallery.updateGrid({ columns: 2 });
 * ```
 *
 * @example Grouped list with sticky headers
 * ```ts
 * const list = createVList({
 *   container: '#list',
 *   item: { height: 48, template: renderItem },
 *   groups: {
 *     getGroupForIndex: (index) => items[index].category,
 *     headerHeight: 32,
 *     headerTemplate: (group) => `<h3>${group}</h3>`,
 *   },
 *   items: data,
 * });
 * ```
 *
 * @example Infinite scroll with adapter
 * ```ts
 * const list = createVList({
 *   container: '#list',
 *   item: { height: 48, template: renderItem },
 *   adapter: {
 *     read: async ({ offset, limit }) => {
 *       const response = await fetch(`/api/items?offset=${offset}&limit=${limit}`);
 *       const data = await response.json();
 *       return { items: data.items, total: data.total };
 *     },
 *   },
 * });
 * ```
 *
 * @param config - Virtual list configuration
 * @returns Virtual list instance with full API
 */
export const createVList = <T extends VListItem = VListItem>(
  config: VListConfig<T>,
): VList<T> => {
  // Start with builder
  let builder = builderVlist(config);

  // Auto-apply data plugin if adapter provided (must be first for data loading)
  if (config.adapter) {
    builder = builder.use(
      withData({
        adapter: config.adapter,
        loading: config.loading,
      }),
    );
  }

  // Auto-apply groups plugin if groups config provided
  // Note: Groups and grid are mutually exclusive
  if (config.groups) {
    builder = builder.use(
      withGroups({
        getGroupForIndex: config.groups.getGroupForIndex,
        headerHeight: config.groups.headerHeight,
        headerTemplate: config.groups.headerTemplate,
        stickyHeaders: config.groups.stickyHeaders ?? true,
      }),
    );
  }
  // Auto-apply grid plugin if layout is 'grid'
  else if (config.layout === "grid" && config.grid) {
    builder = builder.use(
      withGrid({
        columns: config.grid.columns,
        gap: config.grid.gap,
      }),
    );
  }

  // Auto-apply selection plugin if selection config provided
  if (config.selection && config.selection.mode !== "none") {
    builder = builder.use(
      withSelection({
        mode: config.selection.mode || "single",
        initial: config.selection.initial,
      }),
    );
  }

  // Auto-apply compression plugin (always beneficial for large lists)
  builder = builder.use(withCompression());

  // Auto-apply scrollbar plugin based on scrollbar config
  const scrollbarConfig = config.scroll?.scrollbar || config.scrollbar;
  if (scrollbarConfig !== "none") {
    const scrollbarOptions =
      typeof scrollbarConfig === "object" ? scrollbarConfig : {};
    builder = builder.use(withScrollbar(scrollbarOptions));
  }

  // Auto-apply snapshots plugin (always include for scroll save/restore)
  builder = builder.use(withSnapshots());

  // Build and return
  const instance = builder.build();

  // Return with full VList interface
  // The built instance already has most methods from plugins
  return {
    ...instance,

    // Add update() method for backwards compatibility
    update: (updateConfig) => {
      // If grid config changed, use updateGrid from plugin
      if (updateConfig.grid && (instance as any).updateGrid) {
        (instance as any).updateGrid(updateConfig.grid);
      }

      // If selection mode changed
      if (
        updateConfig.selectionMode !== undefined &&
        (instance as any).setSelectionMode
      ) {
        (instance as any).setSelectionMode(updateConfig.selectionMode);
      }

      // Note: itemHeight updates not yet supported in builder
      if (updateConfig.itemHeight !== undefined) {
        console.warn(
          "[vlist] Updating itemHeight via update() is not yet supported with the builder pattern. " +
            "Please recreate the instance or use the full API from 'vlist/full'.",
        );
      }

      // Overscan updates not yet supported
      if (updateConfig.overscan !== undefined) {
        console.warn(
          "[vlist] Updating overscan via update() is not yet supported with the builder pattern.",
        );
      }
    },
  } as VList<T>;
};
