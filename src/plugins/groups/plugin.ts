/**
 * vlist/groups - Builder Plugin
 * Adds grouped lists with sticky section headers.
 *
 * Priority: 10 (runs first — transforms item list and height function before rendering)
 *
 * What it wires:
 * - Transforms item list — inserts header items at group boundaries
 * - Replaces height function — headers use headerHeight, data items use configured item.height
 * - Unified template — dispatches to headerTemplate for headers, user template for items
 * - Sticky header DOM — creates a positioned header element that updates as you scroll
 * - Index mapping — translates between data indices and layout indices
 * - CSS class — adds .vlist--grouped to the root element
 *
 * Restrictions:
 * - Items must be pre-sorted by group
 * - Cannot be combined with withGrid
 * - Cannot be combined with direction: 'horizontal'
 * - Cannot be combined with reverse: true
 */

import type { VListItem } from "../../types";
import type { VListPlugin, BuilderContext } from "../../builder/types";

import {
  createGroupLayout,
  buildLayoutItems,
  createGroupedHeightFn,
} from "./layout";

import { createStickyHeader } from "./sticky";

import {
  isGroupHeader,
  type GroupHeaderItem,
  type GroupLayout,
  type StickyHeader as StickyHeaderInstance,
} from "./types";

import { calculateScrollToIndex, createRenderer } from "../../render";

// =============================================================================
// Plugin Config
// =============================================================================

/** Groups plugin configuration */
export interface GroupsPluginConfig {
  /** Returns group key for item at index (required) */
  getGroupForIndex: (index: number) => string;

  /** Height of group headers in pixels (required) */
  headerHeight: number;

  /** Render function for headers (required) */
  headerTemplate: (key: string, groupIndex: number) => HTMLElement | string;

  /** Enable sticky headers — iOS Contacts style (default: true) */
  sticky?: boolean;
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create a groups plugin for the builder.
 *
 * Adds grouped lists with sticky section headers.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withGroups } from 'vlist/groups'
 *
 * const contacts = vlist({
 *   container: '#contacts',
 *   item: { height: 56, template: renderContact },
 *   items: sortedContacts,
 * })
 * .use(withGroups({
 *   getGroupForIndex: (i) => sortedContacts[i].lastName[0],
 *   headerHeight: 32,
 *   headerTemplate: (letter) => {
 *     const el = document.createElement('div')
 *     el.className = 'letter-header'
 *     el.textContent = letter
 *     return el
 *   },
 * }))
 * .build()
 * ```
 */
export const withGroups = <T extends VListItem = VListItem>(
  config: GroupsPluginConfig,
): VListPlugin<T> => {
  // Validate
  if (!config.getGroupForIndex) {
    throw new Error("[vlist/builder] withGroups: getGroupForIndex is required");
  }
  if (config.headerHeight == null || config.headerHeight <= 0) {
    throw new Error(
      "[vlist/builder] withGroups: headerHeight must be a positive number",
    );
  }
  if (!config.headerTemplate) {
    throw new Error("[vlist/builder] withGroups: headerTemplate is required");
  }

  let groupLayout: GroupLayout | null = null;
  let stickyHeader: StickyHeaderInstance | null = null;
  let originalItems: T[] = [];
  let layoutItems: Array<T | GroupHeaderItem> = [];

  return {
    name: "withGroups",
    priority: 10,

    conflicts: ["withGrid"] as const,

    setup(ctx: BuilderContext<T>): void {
      const { dom, emitter, config: resolvedConfig, rawConfig } = ctx;
      const { classPrefix } = resolvedConfig;

      // Validate direction/reverse constraints
      if (resolvedConfig.horizontal) {
        throw new Error(
          "[vlist/builder] withGroups cannot be used with direction: 'horizontal'",
        );
      }
      if (resolvedConfig.reverse) {
        throw new Error(
          "[vlist/builder] withGroups cannot be used with reverse: true",
        );
      }

      // ── Get the base item height ──
      const itemConfig = rawConfig.item;
      const baseHeight = itemConfig.height as
        | number
        | ((index: number) => number);

      // ── Store original items ──
      originalItems = rawConfig.items ? [...rawConfig.items] : [];
      const total = originalItems.length;

      // ── Create group layout ──
      const groupsConfig = {
        getGroupForIndex: config.getGroupForIndex,
        headerHeight: config.headerHeight,
        headerTemplate: config.headerTemplate,
        sticky: config.sticky,
      };

      groupLayout = createGroupLayout(total, groupsConfig);

      // ── Build layout items (items + headers) ──
      layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

      // ── Create grouped height function ──
      const groupedHeightFn = createGroupedHeightFn(groupLayout, baseHeight);

      // ── Update height config and rebuild height cache ──
      ctx.setHeightConfig(groupedHeightFn);
      ctx.rebuildHeightCache(layoutItems.length);

      // ── Replace data manager items with layout items ──
      ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

      // ── Create unified template ──
      const userTemplate = rawConfig.item.template;
      const { headerTemplate } = config;

      // We need to override the renderer's template. We do this by creating
      // a new renderer with the unified template.
      const unifiedTemplate = ((
        item: T | GroupHeaderItem,
        index: number,
        state: any,
      ) => {
        if (isGroupHeader(item)) {
          return headerTemplate(
            (item as GroupHeaderItem).groupKey,
            (item as GroupHeaderItem).groupIndex,
          );
        }
        return userTemplate(item as T, index, state);
      }) as typeof userTemplate;

      // ── Replace renderer with one that uses the unified template ──
      const newRenderer = createRenderer<T>(
        dom.items,
        unifiedTemplate,
        ctx.heightCache,
        classPrefix,
        () => ctx.dataManager.getTotal(),
        resolvedConfig.ariaIdPrefix,
        false, // not horizontal
        undefined,
      );

      ctx.replaceRenderer(newRenderer);

      // ── Add grouped CSS class ──
      dom.root.classList.add(`${classPrefix}--grouped`);

      // ── Create sticky header (when sticky is enabled) ──
      if (config.sticky !== false) {
        stickyHeader = createStickyHeader(
          dom.root,
          groupLayout,
          ctx.heightCache,
          groupsConfig,
          classPrefix,
        );

        // Wire sticky header into afterScroll
        const stickyRef = stickyHeader;
        ctx.afterScroll.push((scrollTop: number, _direction: string): void => {
          stickyRef.update(scrollTop);
        });

        // Initialize sticky header
        stickyHeader.update(ctx.scrollController.getScrollTop());
      }

      // ── Helper: rebuild groups after data changes ──
      const rebuildGroups = (): void => {
        if (!groupLayout) return;

        groupLayout.rebuild(originalItems.length);
        layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

        const newGroupedHeightFn = createGroupedHeightFn(
          groupLayout,
          baseHeight,
        );
        ctx.setHeightConfig(newGroupedHeightFn);
        ctx.rebuildHeightCache(layoutItems.length);

        // Update data manager with new layout items
        ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

        // Refresh sticky header content
        if (stickyHeader) {
          stickyHeader.refresh();
        }
      };

      // ── Override data methods to maintain group layout ──
      ctx.methods.set("setItems", (items: T[]): void => {
        originalItems = [...items];
        rebuildGroups();
      });

      ctx.methods.set("appendItems", (items: T[]): void => {
        originalItems = [...originalItems, ...items];
        rebuildGroups();
      });

      ctx.methods.set("prependItems", (items: T[]): void => {
        originalItems = [...items, ...originalItems];
        rebuildGroups();
      });

      ctx.methods.set("removeItem", (id: string | number): void => {
        originalItems = originalItems.filter((item) => item.id !== id);
        rebuildGroups();
      });

      // ── Override scrollToIndex: convert data index → layout index ──
      ctx.methods.set(
        "scrollToIndex",
        (
          index: number,
          alignOrOptions?:
            | "start"
            | "center"
            | "end"
            | import("../types").ScrollToOptions,
        ): void => {
          // Convert data index to layout index
          const layoutIndex = groupLayout!.dataToLayoutIndex(index);

          const { align, behavior, duration } =
            resolveScrollArgs(alignOrOptions);
          const total = ctx.dataManager.getTotal();

          const position = calculateScrollToIndex(
            layoutIndex,
            ctx.heightCache,
            ctx.state.viewportState.containerHeight,
            total,
            align,
            ctx.getCachedCompression(),
          );

          if (behavior === "smooth") {
            ctx.scrollController.scrollTo(position);
          } else {
            ctx.scrollController.scrollTo(position);
          }
        },
      );

      // ── Override items getter to return original items (without headers) ──
      // We register special methods that the builder core will check
      ctx.methods.set("_getItems", () => originalItems as readonly T[]);
      ctx.methods.set("_getTotal", () => originalItems.length);

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        if (stickyHeader) {
          stickyHeader.destroy();
          stickyHeader = null;
        }
        dom.root.classList.remove(`${classPrefix}--grouped`);
      });
    },

    destroy(): void {
      if (stickyHeader) {
        stickyHeader.destroy();
        stickyHeader = null;
      }
    },
  };
};

// =============================================================================
// Helpers (duplicated to keep plugin self-contained)
// =============================================================================

const DEFAULT_SMOOTH_DURATION = 300;

const resolveScrollArgs = (
  alignOrOptions?:
    | "start"
    | "center"
    | "end"
    | import("../types").ScrollToOptions,
): {
  align: "start" | "center" | "end";
  behavior: "auto" | "smooth";
  duration: number;
} => {
  if (typeof alignOrOptions === "string") {
    return {
      align: alignOrOptions,
      behavior: "auto",
      duration: DEFAULT_SMOOTH_DURATION,
    };
  }
  if (alignOrOptions && typeof alignOrOptions === "object") {
    return {
      align: alignOrOptions.align ?? "start",
      behavior: alignOrOptions.behavior ?? "auto",
      duration: alignOrOptions.duration ?? DEFAULT_SMOOTH_DURATION,
    };
  }
  return {
    align: "start",
    behavior: "auto",
    duration: DEFAULT_SMOOTH_DURATION,
  };
};
