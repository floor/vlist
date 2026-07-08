// vlist/config
/**
 * Convenience configuration layer shared by the framework adapters
 * (`vlist-react`, `vlist-vue`, `vlist-svelte`, `vlist-solidjs`).
 *
 * The core `createVList(config, plugins)` API is intentionally low-level: the
 * caller assembles the plugin array by hand. Framework users, however, expect a
 * single declarative config object (`{ layout: "grid", grid, selection, … }`).
 *
 * This module is the ONE place that translates that friendly config into the
 * plugin array — replacing the copy that previously lived, and drifted, inside
 * every adapter. Adding or changing a plugin's auto-wiring happens here once and
 * every framework inherits it.
 *
 * It is exposed as the `vlist/config` subpath so the core `vlist` entry stays
 * lean and tree-shakeable; only consumers that opt into the batteries-included
 * config (the adapters) pull in this module and, with it, every plugin it wires.
 */

import type { VListItem, ItemConfig, GroupsConfig, VListAdapter } from "./types";
import { createVList } from "./core/create";
import type { CreateVListConfig, VList, VListPlugin } from "./core/types";
import { page } from "./plugins/page";
import { autosize } from "./plugins/autosize";
import { data } from "./plugins/data";
import type { DataPluginConfig } from "./plugins/data";
import { grid } from "./plugins/grid";
import type { GridPluginConfig } from "./plugins/grid";
import { masonry } from "./plugins/masonry";
import type { MasonryPluginConfig } from "./plugins/masonry";
import { groups } from "./plugins/groups";
import { selection } from "./plugins/selection";
import type { SelectionPluginConfig } from "./plugins/selection";
import { scale } from "./plugins/scale";
import { scrollbar } from "./plugins/scrollbar";
import type { ScrollbarPluginConfig } from "./plugins/scrollbar";
import { snapshots } from "./plugins/snapshots";

/**
 * High-level, declarative vlist configuration accepted by the framework
 * adapters. It is the core `CreateVListConfig` (minus `container`, which the
 * adapter owns via a ref/node) plus the convenience "feature fields" that are
 * translated into plugins by {@link resolvePlugins}.
 */
export interface VListConfig<T extends VListItem = VListItem>
  extends Omit<CreateVListConfig<T>, "container"> {
  /** Layout mode. Wires the grid or masonry plugin from `grid`/`masonry`. */
  layout?: "grid" | "masonry";

  /** Grid layout options — applied when `layout: "grid"`. */
  grid?: GridPluginConfig;

  /** Masonry layout options — applied when `layout: "masonry"`. */
  masonry?: MasonryPluginConfig;

  /** Sticky group headers. */
  groups?: GroupsConfig;

  /** Row selection (single / multi). */
  selection?: SelectionPluginConfig;

  /** Custom scrollbar options, or `"none"` to disable the custom scrollbar. */
  scrollbar?: ScrollbarPluginConfig | "none";

  /** Async data source — enables the data plugin. */
  adapter?: VListAdapter<T>;

  /** Async loading tuning (used together with `adapter`). */
  loading?: DataPluginConfig<T>["loading"];

  /**
   * Escape hatch for custom or third-party plugins. These take precedence over
   * the convenience fields: a plugin whose `name` matches an auto-wired one
   * (e.g. passing `grid()` while `layout: "grid"` is set) replaces it rather
   * than duplicating; plugins with new names are appended.
   */
  plugins?: VListPlugin<T>[];
}

/**
 * Translate a {@link VListConfig} into the ordered plugin array that the core
 * `createVList` expects. Mirrors the adapters' historical behavior exactly:
 * `scale` and `snapshots` are always included, and `selection` is always
 * present (in `"none"` mode when unset) so its API is available. Any user
 * `plugins` are appended last as an escape hatch.
 */
export function resolvePlugins<T extends VListItem = VListItem>(
  config: VListConfig<T>,
): VListPlugin<T>[] {
  const plugins: VListPlugin<T>[] = [];

  // Window/document scrolling. Guard `window` so the resolver is SSR-safe.
  if (typeof window !== "undefined" && config.scroll?.element === window) {
    plugins.push(page<T>());
  }

  // Mode B — auto-measure items when only an estimate is provided.
  const item: ItemConfig<T> = config.item;
  const isHorizontal = config.orientation === "horizontal";
  const hasExplicitSize = isHorizontal ? item.width != null : item.height != null;
  const hasEstimate = isHorizontal
    ? item.estimatedWidth != null
    : item.estimatedHeight != null;
  if (!hasExplicitSize && hasEstimate) {
    plugins.push(autosize<T>());
  }

  // Async data source.
  if (config.adapter) {
    plugins.push(
      data<T>({
        adapter: config.adapter,
        ...(config.loading && { loading: config.loading }),
      }),
    );
  }

  // Layout.
  if (config.layout === "grid" && config.grid) {
    plugins.push(grid<T>(config.grid));
  }
  if (config.layout === "masonry" && config.masonry) {
    plugins.push(masonry<T>(config.masonry));
  }

  // Grouped headers.
  if (config.groups) {
    const groupsConfig = config.groups;
    const headerHeight =
      typeof groupsConfig.headerHeight === "function"
        ? groupsConfig.headerHeight("", 0)
        : groupsConfig.headerHeight;
    plugins.push(
      groups<T>({
        getGroupForIndex: groupsConfig.getGroupForIndex,
        ...(headerHeight !== undefined && { headerHeight }),
        ...(groupsConfig.headerTemplate !== undefined && {
          headerTemplate: groupsConfig.headerTemplate,
        }),
        ...(groupsConfig.sticky !== undefined && { sticky: groupsConfig.sticky }),
      }),
    );
  }

  // Selection is always registered so its API is available; `"none"` is inert.
  const selectionMode = config.selection?.mode || "none";
  if (selectionMode !== "none") {
    plugins.push(selection<T>(config.selection));
  } else {
    plugins.push(selection<T>({ mode: "none" }));
  }

  plugins.push(scale<T>());

  // Custom scrollbar. Skipped for "none" (no scrollbar) and "native" (use the
  // browser's native scrollbar) — core handles both without a plugin. Any other
  // value (or omitted) opts into vlist's custom overlay scrollbar.
  const scrollbarConfig = config.scroll?.scrollbar || config.scrollbar;
  if (scrollbarConfig !== "none" && scrollbarConfig !== "native") {
    const scrollbarOptions: ScrollbarPluginConfig =
      scrollbarConfig && typeof scrollbarConfig === "object" ? scrollbarConfig : {};
    plugins.push(scrollbar<T>(scrollbarOptions));
  }

  plugins.push(snapshots<T>());

  // Escape hatch: user-supplied plugins take precedence. A user plugin whose
  // name matches an auto-wired one REPLACES it (rather than duplicating — core
  // throws on duplicate plugin names), so the convenience fields act as defaults
  // that explicit plugins can override. Unmatched plugins are appended.
  if (config.plugins && config.plugins.length > 0) {
    const overridden = new Set(config.plugins.map((p) => p.name));
    const base = plugins.filter((p) => !overridden.has(p.name));
    return [...base, ...config.plugins];
  }

  return plugins;
}

/**
 * Create a vlist instance from a high-level {@link VListConfig}, resolving its
 * feature fields into plugins via {@link resolvePlugins}. This is the single
 * entry point every framework adapter delegates to.
 */
export function createVListFromConfig<T extends VListItem = VListItem>(
  config: VListConfig<T> & { container: HTMLElement | string },
): VList<T> {
  return createVList<T>(config, resolvePlugins(config));
}
