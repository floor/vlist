/**
 * vlist/groups - Builder Feature
 * Adds grouped lists with sticky headers.
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
 * - orientation: 'horizontal' (sticky headers stick to left edge, push left when next header approaches)
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

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
import { resolveScrollArgs, createSmoothScroll } from "../../builder/scroll";

// =============================================================================
// Feature Config
// =============================================================================

/** Groups feature configuration */
export interface GroupsFeatureConfig {
  /** Returns group key for item at index (required) */
  getGroupForIndex: (index: number) => string;

  /** Group header configuration — mirrors the `item` config shape */
  header?: {
    /** Header size in pixels — vertical scrolling (default) */
    height?: number;
    /** Header size in pixels — horizontal scrolling */
    width?: number;
    /** Render function for headers (required) */
    template: (key: string, groupIndex: number) => HTMLElement | string;
  };

  /** @deprecated Use `header.height` instead. */
  headerHeight?: number;
  /** @deprecated Use `header.template` instead. */
  headerTemplate?: (key: string, groupIndex: number) => HTMLElement | string;

  /** Enable sticky headers — iOS Contacts style (default: true) */
  sticky?: boolean;
}

/**
 * Normalize legacy flat config into the nested `header` shape.
 * Supports both `{ header: { height/width, template } }` (new)
 * and `{ headerHeight, headerTemplate }` (legacy).
 * Resolves `height` vs `width` based on orientation.
 */
const normalizeConfig = (
  raw: GroupsFeatureConfig,
  horizontal: boolean,
): GroupsFeatureConfig & { header: { height: number; template: (key: string, groupIndex: number) => HTMLElement | string } } => {
  if (raw.header) {
    // Resolve main-axis size: width for horizontal, height for vertical
    const size = horizontal ? (raw.header.width ?? raw.header.height) : (raw.header.height ?? raw.header.width);
    return { ...raw, header: { ...raw.header, height: size as number } } as any;
  }
  if (raw.headerHeight != null && raw.headerTemplate) {
    return { ...raw, header: { height: raw.headerHeight, template: raw.headerTemplate } };
  }
  return raw as any; // let validation catch missing fields
};

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a groups feature for the builder.
 *
 * Adds grouped lists with sticky section headers.
 *
 * ```ts
 * import { vlist, withGroups } from '@floor/vlist'
 *
 * const contacts = vlist({
 *   container: '#contacts',
 *   item: { height: 56, template: renderContact },
 *   items: sortedContacts,
 * })
 * .use(withGroups({
 *   getGroupForIndex: (i) => sortedContacts[i].lastName[0],
 *   header: {
 *     height: 32,
 *     template: (letter) => {
 *       const el = document.createElement('div')
 *       el.className = 'letter-header'
 *       el.textContent = letter
 *       return el
 *     },
 *   },
 * }))
 * .build()
 * ```
 */
export const withGroups = <T extends VListItem = VListItem>(
  groupsRawConfig: GroupsFeatureConfig,
): VListFeature<T> => {
  // Compat: normalize legacy flat fields into nested header object.
  // Orientation isn't known yet — resolved lazily in setup().
  // Validate eagerly using whichever size field is present.
  const hasHeader = groupsRawConfig.header;
  const earlySize = hasHeader
    ? (hasHeader.height ?? hasHeader.width)
    : groupsRawConfig.headerHeight;
  const earlyTemplate = hasHeader?.template ?? groupsRawConfig.headerTemplate;

  // Validate
  if (!groupsRawConfig.getGroupForIndex) {
    throw new Error("[vlist/builder] withGroups: getGroupForIndex is required");
  }
  if (earlySize == null || earlySize <= 0) {
    throw new Error(
      "[vlist/builder] withGroups: header.height must be a positive number",
    );
  }
  if (!earlyTemplate) {
    throw new Error("[vlist/builder] withGroups: header.template is required");
  }

  let groupLayout: GroupLayout | null = null;
  let stickyHeader: StickyHeaderInstance | null = null;
  let originalItems: T[] = [];
  let layoutItems: Array<T | GroupHeaderItem> = [];

  return {
    name: "withGroups",
    priority: 10,

    setup(ctx: BuilderContext<T>): void {
      const { dom, config: resolvedConfig, rawConfig } = ctx;
      const { classPrefix } = resolvedConfig;

      // Now that orientation is known, normalize with the correct axis
      const config = normalizeConfig(groupsRawConfig, resolvedConfig.horizontal);

      // Note: sticky headers work with both reverse mode and horizontal orientation!
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
        header: {
          height: config.header.height,
          template: config.header.template,
        },
        sticky: config.sticky ?? false,
      };

      groupLayout = createGroupLayout(total, groupsConfig);

      // ── Build layout items (items + headers) ──
      layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

      // ── Create grouped size function ──
      const stickyEnabled = config.sticky !== false;
      const groupedSizeFn = createGroupedSizeFn(groupLayout, baseSize, stickyEnabled);

      // ── Update size config and rebuild size cache ──
      ctx.setSizeConfig(groupedSizeFn);

      ctx.rebuildSizeCache(layoutItems.length);

      // ── Replace data manager items with layout items ──
      ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

      // ── Create unified template ──
      const userTemplate = rawConfig.item.template;
      const { template: headerTemplate } = config.header;

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

      // ── Check if grid or table feature has exposed its layout ──
      const getGridLayout = ctx.methods.get("_getGridLayout") as
        | (() => any)
        | undefined;
      const replaceGridRenderer = ctx.methods.get("_replaceGridRenderer") as
        | ((renderer: any) => void)
        | undefined;
      const updateGridLayoutForGroups = ctx.methods.get(
        "_updateGridLayoutForGroups",
      ) as ((isHeaderFn: (index: number) => boolean) => void) | undefined;
      const gridRendererFactory = ctx.methods.get("_createGridRenderer") as
        | ((...args: any[]) => any)
        | undefined;

      // Table integration hooks
      const getTableLayout = ctx.methods.get("_getTableLayout") as
        | (() => any)
        | undefined;
      const updateTableForGroups = ctx.methods.get("_updateTableForGroups") as
        | ((
            isHeaderFn: (item: any) => boolean,
            headerTemplate: (key: string, groupIndex: number) => HTMLElement | string,
          ) => void)
        | undefined;
      const getTableHeaderHeight = ctx.methods.get("_getTableHeaderHeight") as
        | (() => number)
        | undefined;

      if (getGridLayout && replaceGridRenderer && gridRendererFactory) {
        // Grid renderer is active - make grid layout groups-aware
        if (updateGridLayoutForGroups) {
          // Update grid layout to handle full-width headers
          updateGridLayoutForGroups((index: number) => {
            const item = layoutItems[index];
            return !!(item && isGroupHeader(item));
          });
        }

        // Recreate grid renderer with unified template
        const gridLayout = getGridLayout();

        const newGridRenderer = gridRendererFactory(
          dom.items,
          unifiedTemplate,
          ctx.sizeCache,
          gridLayout,
          classPrefix,
          ctx.getContainerWidth(),
          () => ctx.dataManager.getTotal(),
          resolvedConfig.ariaIdPrefix,
        );

        // Use grid feature's method to replace its renderer instance
        replaceGridRenderer(newGridRenderer);
      } else if (getTableLayout && updateTableForGroups) {
        // Table renderer is active — tell it about group headers.
        // The table renderer handles the rendering internally via
        // renderGroupHeaderRow(), so we just pass the check function
        // and the header template. No need to replace the renderer.
        updateTableForGroups(
          (item: any) => isGroupHeader(item),
          config.header.template,
        );
      } else {
        // Replace the template with the unified version
        // This works with the materialize inlined renderer
        ctx.replaceTemplate(unifiedTemplate);
      }

      // ── Store table header height for sticky offset ──
      const tableHeaderHeight = getTableHeaderHeight ? getTableHeaderHeight() : 0;

      // ── Add grouped CSS class ──
      dom.root.classList.add(`${classPrefix}--grouped`);

      // ── Expose sticky header height so scrollToFocus can offset ──
      // When sticky headers are active, items scrolled to the top edge
      // are obscured by the header. Selection and core baseline add this
      // value to startPadding so the scroll target lands below the header.
      if (config.sticky !== false) {
        ctx.methods.set(
          "_getStickyHeaderHeight",
          (): number => config.header.height,
        );

        // Shrink the viewport by the sticky header height so the
        // scrollbar and content don't extend behind the sticky header.
        if (!resolvedConfig.horizontal) {
          dom.viewport.style.height = `calc(100% - ${config.header.height}px)`;
        } else {
          dom.viewport.style.width = `calc(100% - ${config.header.height}px)`;
        }
      }

      // ── Create sticky header (when sticky is enabled) ──
      if (config.sticky !== false) {
        // Template-driven: the sticky header receives a renderInto callback
        // that works exactly like item rendering — it doesn't know about
        // string vs HTMLElement, headerTemplate, or any template details.
        const ht = config.header.template;
        const renderInto = (slot: HTMLElement, groupIndex: number): void => {
          const group = groupLayout!.groups[groupIndex];
          if (!group) return;
          const result = ht(group.key, group.groupIndex);
          if (typeof result === "string") slot.innerHTML = result;
          else slot.replaceChildren(result);
        };

        stickyHeader = createStickyHeader(
          dom.root,
          groupLayout,
          ctx.sizeCache,
          renderInto,
          classPrefix,
          resolvedConfig.horizontal,
          tableHeaderHeight,
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

      // ── Helper: rebuild stripe index map ──
      const stripedMode = rawConfig.item?.striped;
      const rebuildStripeMap = (): void => {
        if (stripedMode !== "data" && stripedMode !== "even" && stripedMode !== "odd") return;
        const stripeMap = new Int32Array(layoutItems.length);
        const offset = stripedMode === "odd" ? 1 : 0;
        let dataIndex = 0;
        for (let i = 0; i < layoutItems.length; i++) {
          if (isGroupHeader(layoutItems[i])) {
            stripeMap[i] = -1;
            // "even" and "odd" reset the counter after each header
            if (stripedMode === "even" || stripedMode === "odd") {
              dataIndex = 0;
            }
          } else {
            stripeMap[i] = dataIndex++ + offset;
          }
        }
        ctx.setStripeIndexFn((index: number): number => {
          if (index < 0 || index >= stripeMap.length) return index;
          return stripeMap[index] as number;
        });
      };

      // Initial stripe map build
      rebuildStripeMap();

      // ── Helper: rebuild groups after data changes ──
      const rebuildGroups = (): void => {
        if (!groupLayout) return;

        groupLayout.rebuild(originalItems.length);
        layoutItems = buildLayoutItems(originalItems, groupLayout.groups);

        const newGroupedSizeFn = createGroupedSizeFn(groupLayout, baseSize, stickyEnabled);
        ctx.setSizeConfig(newGroupedSizeFn);
        ctx.rebuildSizeCache(layoutItems.length);

        // Update data manager with new layout items
        ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

        // Rebuild stripe map after layout changes
        rebuildStripeMap();

        // Refresh sticky header content
        if (stickyHeader) {
          stickyHeader.refresh();
        }
      };

      // ── Override data methods to maintain group layout ──
      ctx.methods.set("setItems", (items: T[]): void => {
        originalItems = items.slice();
        rebuildGroups();
      });

      ctx.methods.set("appendItems", (items: T[]): void => {
        originalItems.push(...items);
        rebuildGroups();
      });

      ctx.methods.set("prependItems", (items: T[]): void => {
        originalItems.unshift(...items);
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

          const position = ctx.adjustScrollPosition(
            calculateScrollToIndex(
              layoutIndex,
              ctx.sizeCache,
              ctx.state.viewportState.containerSize,
              total,
              align,
              ctx.getCachedCompression(),
            ),
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
      ctx.methods.set("_isGroupHeader", (index: number): boolean => {
        const item = layoutItems[index];
        return !!(item && isGroupHeader(item));
      });

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        cancelScroll();
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
