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

import type { VListItem, ItemConfig, GroupsConfig, VListAdapter, ScrollConfig } from "./types";
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
import { a11y } from "./plugins/a11y";
import type { A11yPluginConfig } from "./plugins/a11y";
import { scrollbar } from "./plugins/scrollbar";
import type { ScrollbarPluginConfig } from "./plugins/scrollbar";
import { snapshots } from "./plugins/snapshots";

/** List creation function injected by an adapter consumer. */
export type VListFactory<T extends VListItem = VListItem> = typeof createVList<T>;

/**
 * High-level, declarative vlist configuration accepted by the framework
 * adapters. It is the core `CreateVListConfig` (minus `container`, which the
 * adapter owns via a ref/node) plus the convenience "feature fields" that are
 * translated into plugins by {@link resolvePlugins}.
 */
export interface VListConfig<T extends VListItem = VListItem>
  extends Omit<CreateVListConfig<T>, "container" | "scroll"> {
  /** Scroll options; select synthetic input with a factory from vlist/synthetic. */
  scroll?: ScrollConfig;
  /** List factory; defaults to core createVList. Fixed for this instance. */
  factory?: VListFactory<T>;

  /** Layout mode. Wires the grid or masonry plugin from `grid`/`masonry`. */
  layout?: "grid" | "masonry";

  /** Grid layout options — applied when `layout: "grid"`. */
  grid?: GridPluginConfig;

  /** Masonry layout options — applied when `layout: "masonry"`. */
  masonry?: MasonryPluginConfig;

  /** Sticky group headers. */
  groups?: GroupsConfig;

  /**
   * Row selection (single / multi). Omit it for a display-only list: nothing
   * is wired then, so the list keeps `role="list"` and stays out of the tab
   * order, exactly like a core list created without the plugin.
   */
  selection?: SelectionPluginConfig;

  /**
   * Keyboard navigation, focus management and the WAI-ARIA listbox roles.
   * Off by default, as in core: pass `true` for the defaults or an object to
   * tune it. A selection mode other than `"none"` already provides both, so a
   * list with one does not need this as well.
   */
  a11y?: A11yPluginConfig | boolean;

  /**
   * Custom overlay scrollbar. Off by default, as in core, which leaves the
   * browser's native scrollbar in place: pass `true` for the defaults or an
   * object to tune them. `"none"` is accepted for symmetry with
   * `scroll.scrollbar` and wires nothing.
   */
  scrollbar?: ScrollbarPluginConfig | "none" | boolean;

  /**
   * Scroll position save/restore (`saveScroll` / `restoreScroll`).
   * Off by default, as in core.
   */
  snapshots?: boolean;

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
 * `createVList` expects. Every plugin comes from a field the caller set, so a
 * config with no feature fields resolves to no plugins and an adapter list
 * behaves like a core list given the same options. Any user `plugins` are
 * appended last as an escape hatch.
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
    // This layer assembles the pair itself, so the core conflict would name two
    // plugins the caller never mentioned. Name the fields they did write.
    if (config.layout === "grid") {
      throw new Error(
        '[vlist] config: layout: "grid" needs a fixed item size. An estimate wires ' +
          "autosize(), which grid() cannot combine with: grid indexes its size cache by " +
          "row, autosize measures items. Use item.height (item.width when horizontal).",
      );
    }
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

  // Layout. Without its options a layout used to resolve to a plain list, so
  // a typo in the options field read as "the grid quietly did nothing".
  if (config.layout === "grid") {
    if (!config.grid) {
      throw new Error(
        '[vlist] config: layout: "grid" requires a `grid` option, e.g. { columns: 3 }',
      );
    }
    plugins.push(grid<T>(config.grid));
  }
  if (config.layout === "masonry") {
    if (!config.masonry) {
      throw new Error(
        '[vlist] config: layout: "masonry" requires a `masonry` option, e.g. { columns: 3 }',
      );
    }
    plugins.push(masonry<T>(config.masonry));
  }

  // Grouped headers. The plugin takes this config as it stands, `header` shape
  // included. Rebuilding it field by field dropped `header` — the documented
  // shape — so those configs threw, and it called a function `headerHeight`
  // once with `("", 0)`, giving every group the first group's height.
  if (config.groups) {
    plugins.push(groups<T>(config.groups));
  }

  // Selection, only when asked for. An always-on `selection({ mode: "none" })`
  // gave every adapter list the listbox and option roles and `tabindex="0"`
  // with no keyboard handler behind them: focusable, announced as a listbox,
  // and inert under the arrow keys.
  if (config.selection) {
    plugins.push(selection<T>(config.selection));
  }

  // Keyboard navigation and ARIA, opt-in as in core. A real selection mode
  // brings both, and a11y() steps aside when it finds the item state taken.
  if (config.a11y) {
    plugins.push(config.a11y === true ? a11y<T>() : a11y<T>(config.a11y));
  }

  // Custom overlay scrollbar, opt-in as in core: with nothing wired the
  // browser's own scrollbar stays, which is what `createVList` gives for the
  // same options. The `scroll.scrollbar` strings belong to core (it hides the
  // native scrollbar for "none"), so they pass through untouched.
  const scrollbarConfig = config.scroll?.scrollbar ?? config.scrollbar;
  if (scrollbarConfig === true) {
    plugins.push(scrollbar<T>({}));
  } else if (scrollbarConfig && typeof scrollbarConfig === "object") {
    plugins.push(scrollbar<T>(scrollbarConfig));
  }

  if (config.snapshots) {
    plugins.push(snapshots<T>());
  }

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
  const { factory, ...options } = config;
  return (factory ?? createVList<T>)(options as CreateVListConfig<T>, resolvePlugins(config));
}
