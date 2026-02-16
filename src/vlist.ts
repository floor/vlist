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
import { withGrid } from "./plugins/grid/plugin";
import { withGroups } from "./plugins/groups/plugin";
import { withSelection } from "./plugins/selection/plugin";
import { withScrollbar } from "./plugins/scroll/plugin";
import { withCompression } from "./plugins/compression/plugin";
import { withSnapshots } from "./plugins/snapshots/plugin";
import { withData } from "./plugins/data/plugin";
import { withWindow } from "./plugins/window/plugin";

import type { VListConfig, VListItem, VList } from "./types";

/**
 * Create a virtual list instance.
 *
 * This is a convenience wrapper around the builder pattern that automatically
 * includes plugins based on the configuration provided, maintaining full backwards
 * compatibility with the monolithic API.
 *
 * @param config - Virtual list configuration
 * @returns Virtual list instance with full API
 */
export const createVList = <T extends VListItem = VListItem>(
  config: VListConfig<T>,
): VList<T> => {
  // Start with builder
  let builder = builderVlist(config);

  // Auto-apply window plugin if scroll.element is window (must be first)
  if (config.scroll?.element === window) {
    builder = builder.use(withWindow());
  }

  // Auto-apply data plugin if adapter provided (must be first for data loading)
  if (config.adapter) {
    builder = builder.use(
      withData({
        adapter: config.adapter,
        ...(config.loading && { loading: config.loading }),
      }),
    );
  }

  // Auto-apply grid plugin if layout is 'grid' or grid config provided
  if (config.layout === "grid" && config.grid) {
    const gridConfig: { columns: number; gap?: number } = {
      columns: config.grid.columns,
    };
    if (config.grid.gap !== undefined) {
      gridConfig.gap = config.grid.gap;
    }
    builder = builder.use(withGrid(gridConfig));
  }

  // Auto-apply groups plugin if groups config provided
  // Works together with grid for grouped 2D layouts
  if (config.groups) {
    const groupsConfig: {
      getGroupForIndex: (index: number) => string;
      headerHeight: number;
      headerTemplate: (
        group: string,
        groupIndex: number,
      ) => string | HTMLElement;
      sticky?: boolean;
    } = {
      getGroupForIndex: config.groups.getGroupForIndex,
      headerHeight:
        typeof config.groups.headerHeight === "function"
          ? config.groups.headerHeight("", 0) // Call with dummy values to get height
          : config.groups.headerHeight,
      headerTemplate: config.groups.headerTemplate,
    };
    if (config.groups.sticky !== undefined) {
      groupsConfig.sticky = config.groups.sticky;
    }
    builder = builder.use(withGroups(groupsConfig));
  }

  // Auto-apply selection plugin if selection config provided
  if (config.selection && config.selection.mode !== "none") {
    const selectionConfig: {
      mode: "single" | "multiple";
      initial?: Array<string | number>;
    } = {
      mode: config.selection.mode || "single",
    };
    if (config.selection.initial !== undefined) {
      selectionConfig.initial = config.selection.initial;
    }
    builder = builder.use(withSelection(selectionConfig));
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
