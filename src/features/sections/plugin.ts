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
 *
 * Can be combined with:
 * - withGrid for grouped 2D layouts
 * - reverse: true (sticky header shows current section as you scroll up through history)
 * - direction: 'horizontal' (sticky headers stick to left edge, push left when next header approaches)
 */

import type { VListItem } from "../../types";
import type { VListPlugin, BuilderContext } from "../../builder/types";

import {
  createGroupLayout,
  buildLayoutItems,
  createGroupedSizeFn,
} from "./layout";

import { createStickyHeader } from "./sticky";

import {
  isGroupHeader,
  type GroupHeaderItem,
  type GroupLayout,
  type StickyHeader as StickyHeaderInstance,
} from "./types";

import { calculateScrollToIndex } from "../../rendering";

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
export const withSections = <T extends VListItem = VListItem>(
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
    name: "withSections",
    priority: 10,

    setup(ctx: BuilderContext<T>): void {
      const { dom, config: resolvedConfig, rawConfig } = ctx;
      const { classPrefix } = resolvedConfig;

      // Note: sticky headers work with both reverse mode and horizontal mode!
      // - reverse: true - as you scroll up through history, the current section header sticks at top
      // - horizontal: true - headers stick to left edge and push left when next header approaches

      // ── Get the base item size ──
      const itemConfig = rawConfig.item;
      const baseSize = itemConfig.height as
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
        sticky: config.sticky ?? false,
      };

      groupLayout = createGroupLayout(total, groupsConfig);

      // ── Build layout items (items + headers) ──
      layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

      // ── Create grouped size function ──
      const groupedSizeFn = createGroupedSizeFn(groupLayout, baseSize);

      // ── Update size config and rebuild size cache ──
      ctx.setSizeConfig(groupedSizeFn);

      ctx.rebuildSizeCache(layoutItems.length);

      // ── Replace data manager items with layout items ──
      ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

      // ── Create unified template ──
      const userTemplate = rawConfig.item.template;
      const { headerTemplate } = config;

      // Create unified template that handles both headers and items
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

      // ── Check if grid plugin has exposed its layout ──
      const getGridLayout = ctx.methods.get("_getGridLayout") as
        | (() => any)
        | undefined;
      const replaceGridRenderer = ctx.methods.get("_replaceGridRenderer") as
        | ((renderer: any) => void)
        | undefined;
      const updateGridLayoutForGroups = ctx.methods.get(
        "_updateGridLayoutForGroups",
      ) as ((isHeaderFn: (index: number) => boolean) => void) | undefined;

      if (getGridLayout && replaceGridRenderer) {
        // Grid renderer is active - make grid layout groups-aware
        if (updateGridLayoutForGroups) {
          // Update grid layout to handle full-width headers
          updateGridLayoutForGroups((index: number) => {
            const item = layoutItems[index];
            return !!(item && isGroupHeader(item));
          });
        }

        // Recreate grid renderer with unified template
        const { createGridRenderer } = require("../grid/renderer");
        const gridLayout = getGridLayout();

        const newGridRenderer = createGridRenderer(
          dom.items,
          unifiedTemplate,
          ctx.sizeCache,
          gridLayout,
          classPrefix,
          ctx.getContainerWidth(),
          () => ctx.dataManager.getTotal(),
          resolvedConfig.ariaIdPrefix,
        );

        // Use grid plugin's method to replace its renderer instance
        replaceGridRenderer(newGridRenderer);
      } else {
        // Replace the template with the unified version
        // This works with the materialize inlined renderer
        ctx.replaceTemplate(unifiedTemplate);
      }

      // ── Add grouped CSS class ──
      dom.root.classList.add(`${classPrefix}--grouped`);

      // ── Create sticky header (when sticky is enabled) ──
      if (config.sticky !== false) {
        stickyHeader = createStickyHeader(
          dom.root,
          groupLayout,
          ctx.sizeCache,
          { ...groupsConfig, sticky: groupsConfig.sticky ?? false },
          classPrefix,
          resolvedConfig.horizontal,
        );

        // Wire sticky header into afterScroll
        const stickyRef = stickyHeader;
        ctx.afterScroll.push(
          (scrollPosition: number, _direction: string): void => {
            stickyRef.update(scrollPosition);
          },
        );

        // Initialize sticky header
        stickyHeader.update(ctx.scrollController.getScrollTop());
      }

      // ── Helper: rebuild groups after data changes ──
      const rebuildGroups = (): void => {
        if (!groupLayout) return;

        groupLayout.rebuild(originalItems.length);
        layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

        const newGroupedSizeFn = createGroupedSizeFn(groupLayout, baseSize);
        ctx.setSizeConfig(newGroupedSizeFn);
        ctx.rebuildSizeCache(layoutItems.length);

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
      const { animateScroll, cancelScroll } = createSmoothScroll(
        ctx.scrollController,
        ctx.renderIfNeeded,
      );

      ctx.methods.set(
        "scrollToIndex",
        (
          index: number,
          alignOrOptions?:
            | "start"
            | "center"
            | "end"
            | {
                align?: "start" | "center" | "end";
                behavior?: "auto" | "smooth";
                duration?: number;
              },
        ): void => {
          // Convert data index to layout index
          const layoutIndex = groupLayout!.dataToLayoutIndex(index);

          const { align, behavior, duration } =
            resolveScrollArgs(alignOrOptions);
          const total = ctx.dataManager.getTotal();

          const position = calculateScrollToIndex(
            layoutIndex,
            ctx.sizeCache,
            ctx.state.viewportState.containerSize,
            total,
            align,
            ctx.getCachedCompression(),
          );

          if (behavior === "smooth") {
            animateScroll(
              ctx.scrollController.getScrollTop(),
              position,
              duration,
            );
          } else {
            cancelScroll();
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
        if (smoothScrollAnimationId !== null) {
          cancelAnimationFrame(smoothScrollAnimationId);
          smoothScrollAnimationId = null;
        }
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

// Smooth scroll animation helpers
const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

let smoothScrollAnimationId: number | null = null;

const createSmoothScroll = (scrollController: any, renderFn: () => void) => {
  const cancelScroll = (): void => {
    if (smoothScrollAnimationId !== null) {
      cancelAnimationFrame(smoothScrollAnimationId);
      smoothScrollAnimationId = null;
    }
  };

  const animateScroll = (from: number, to: number, duration: number): void => {
    cancelScroll();
    if (Math.abs(to - from) < 1) {
      scrollController.scrollTo(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const newPos = from + (to - from) * easeInOutQuad(t);
      scrollController.scrollTo(newPos);
      renderFn();
      if (t < 1) {
        smoothScrollAnimationId = requestAnimationFrame(tick);
      } else {
        smoothScrollAnimationId = null;
      }
    };
    smoothScrollAnimationId = requestAnimationFrame(tick);
  };

  return { animateScroll, cancelScroll };
};

const resolveScrollArgs = (
  alignOrOptions?:
    | "start"
    | "center"
    | "end"
    | {
        align?: "start" | "center" | "end";
        behavior?: "auto" | "smooth";
        duration?: number;
      },
): {
  align: "start" | "center" | "end";
  behavior: "auto" | "smooth";
  duration: number;
} => {
  if (typeof alignOrOptions === "string") {
    return {
      align: alignOrOptions as "start" | "center" | "end",
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
