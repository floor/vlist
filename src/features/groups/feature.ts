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
 * - withAsync for grouped lists with async pagination
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

import { createAsyncGroupBridge, type AsyncGroupBridge } from "./async-bridge";

import { calculateScrollToIndex } from "../../rendering";
import { resolveScrollArgs, createSmoothScroll } from "../../builder/scroll";

// =============================================================================
// Feature Config
// =============================================================================

/** Groups feature configuration */
export interface GroupsFeatureConfig {
  /** Returns group key for item at index (required) */
  getGroupForIndex: (index: number, item?: any) => string;

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
 * import { vlist, withGroups } from 'vlist'
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

      const stickyEnabled = config.sticky !== false;
      const { template: headerTemplate } = config.header;

      // ── Add grouped CSS class ──
      dom.root.classList.add(`${classPrefix}--grouped`);

      // ── Expose sticky header height so scrollToFocus can offset ──
      if (stickyEnabled) {
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

      // ── scrollToIndex: shared by both paths ──
      const { animateScroll, cancelScroll } = createSmoothScroll(
        ctx.scrollController,
        ctx.renderIfNeeded,
      );

      // Mutable reference — updated by async path when bridge is ready
      let indexMapper: { dataToLayoutIndex: (i: number) => number } | null = null;

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
          const mapper = indexMapper ?? groupLayout;
          if (!mapper) return;

          const layoutIndex = mapper.dataToLayoutIndex(index);

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

      // ── Cleanup (shared) ──
      ctx.destroyHandlers.push(() => {
        cancelScroll();
        if (stickyHeader) {
          stickyHeader.destroy();
          stickyHeader = null;
        }
        dom.root.classList.remove(`${classPrefix}--grouped`);
      });

      // ── Register bridge placeholder for async detection ──
      // withAsync (priority 20) resolves this lazily during scroll to convert
      // layout-space renderRange to data-space indices for ensureRange.
      let bridge: AsyncGroupBridge | null = null;
      ctx.methods.set("_getGroupBridge", () => bridge);

      // ── Deferred: detect async and wire bridge ──────────────────
      // withGroups runs at priority 10, withAsync at priority 20. By the time
      // this microtask fires, all feature setups have completed synchronously
      // and _isAsync + _onItemsLoaded are registered.
      // The autoload microtask in withAsync fires AFTER this one (FIFO order),
      // so the bridge is wired before any data arrives.
      queueMicrotask(() => {
        const registerOnItemsLoaded = ctx.methods.get("_onItemsLoaded") as
          | ((cb: (items: T[], offset: number, total: number) => void) => void)
          | undefined;

        if (registerOnItemsLoaded) {
          setupAsyncPath(
            ctx, config, resolvedConfig, rawConfig, baseSize, stickyEnabled,
            headerTemplate, classPrefix, registerOnItemsLoaded,
            (b) => { bridge = b; indexMapper = b; },
            (s) => { stickyHeader = s; },
          );
        } else {
          // Static path was already set up below — nothing to do
        }
      });

      // ── Static path ────────────────────────────────────────────
      // When items exist, set up the traditional item-array transformation.
      // If async will be detected later, the static path produces an empty
      // layout (0 items) which is harmless — the async microtask overwrites it.
      setupStaticPath(
        ctx, config, resolvedConfig, rawConfig, baseSize, stickyEnabled,
        headerTemplate, classPrefix,
        () => {},
        () => {},
        (layout) => { groupLayout = layout; indexMapper = layout; },
        (s) => { stickyHeader = s; },
      );
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
// Static Path — transforms item array with header pseudo-items
// =============================================================================

function setupStaticPath<T extends VListItem>(
  ctx: BuilderContext<T>,
  config: GroupsFeatureConfig & { header: { height: number; template: (key: string, groupIndex: number) => HTMLElement | string } },
  resolvedConfig: { horizontal: boolean; classPrefix: string; ariaIdPrefix: string },
  rawConfig: { item: { height?: any; template: any; striped?: any }; items?: T[] },
  baseSize: number | ((index: number) => number),
  stickyEnabled: boolean,
  headerTemplate: (key: string, groupIndex: number) => HTMLElement | string,
  classPrefix: string,
  setOriginalItems: (items: T[]) => void,
  setLayoutItems: (items: Array<T | GroupHeaderItem>) => void,
  setGroupLayout: (layout: GroupLayout) => void,
  setStickyHeader: (s: StickyHeaderInstance) => void,
): void {
  const { dom } = ctx;
  let localStickyHeader: StickyHeaderInstance | null = null;

  // ── Store original items ──
  let originalItems = rawConfig.items ? [...rawConfig.items] : [];
  setOriginalItems(originalItems);
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

  const getOriginalItem = (index: number): T | undefined => originalItems[index];
  const groupLayout = createGroupLayout(total, groupsConfig, getOriginalItem);
  setGroupLayout(groupLayout);

  // ── Build layout items (items + headers) ──
  let layoutItems = buildLayoutItems(originalItems, groupLayout.groups);
  setLayoutItems(layoutItems);

  // ── Create grouped size function ──
  const groupedSizeFn = createGroupedSizeFn(groupLayout, baseSize, stickyEnabled);

  // ── Update size config and rebuild size cache ──
  ctx.setSizeConfig(groupedSizeFn);
  ctx.rebuildSizeCache(layoutItems.length);

  // ── Replace data manager items with layout items ──
  ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

  // ── Create unified template ──
  const userTemplate = rawConfig.item.template;

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
  if (getGridLayout && replaceGridRenderer && gridRendererFactory) {
    if (updateGridLayoutForGroups) {
      updateGridLayoutForGroups((index: number) => {
        const item = layoutItems[index];
        return !!(item && isGroupHeader(item));
      });
    }

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
    replaceGridRenderer(newGridRenderer);
  } else if (getTableLayout && updateTableForGroups) {
    updateTableForGroups(
      (item: any) => isGroupHeader(item),
      config.header.template,
    );
  } else {
    ctx.replaceTemplate(unifiedTemplate);
  }

  // ── Lazy sticky header creation ──
  // Deferred until groups actually exist. Avoids creating DOM elements
  // that would be immediately hidden (0 groups) or replaced by the async
  // path's own sticky header one microtask later.
  const ensureStickyHeader = (): void => {
    if (!stickyEnabled || localStickyHeader) return;
    if (groupLayout.groupCount === 0) return;

    const ht = config.header.template;
    const renderInto = (slot: HTMLElement, groupIndex: number): void => {
      const group = groupLayout.groups[groupIndex];
      if (!group) return;
      const result = ht(group.key, group.groupIndex);
      if (typeof result === "string") slot.innerHTML = result;
      else slot.replaceChildren(result);
    };

    const sticky = createStickyHeader(
      dom.root,
      groupLayout,
      ctx.sizeCache,
      renderInto,
      classPrefix,
      resolvedConfig.horizontal,
      0,
      () => ctx.getCachedCompression().ratio,
    );
    localStickyHeader = sticky;
    setStickyHeader(sticky);

    ctx.afterScroll.push(
      (scrollPosition: number, _direction: string): void => {
        sticky.update(scrollPosition);
      },
    );
    sticky.update(ctx.scrollController.getScrollTop());
  };
  ensureStickyHeader();

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

  rebuildStripeMap();

  // ── Helper: rebuild groups after data changes ──
  const rebuildGroups = (): void => {
    groupLayout.rebuild(originalItems.length, getOriginalItem);
    layoutItems = buildLayoutItems(originalItems, groupLayout.groups);
    setLayoutItems(layoutItems);

    ctx.rebuildSizeCache(layoutItems.length);

    ctx.dataManager.setItems(layoutItems as T[], 0, layoutItems.length);

    rebuildStripeMap();

    ensureStickyHeader();
    if (localStickyHeader) {
      localStickyHeader.refresh();
    }
  };

  // ── Override data methods to maintain group layout ──
  ctx.methods.set("setItems", (items: T[]): void => {
    originalItems = items.slice();
    setOriginalItems(originalItems);
    rebuildGroups();
  });

  ctx.methods.set("appendItems", (items: T[]): void => {
    originalItems.push(...items);
    setOriginalItems(originalItems);
    rebuildGroups();
  });

  ctx.methods.set("prependItems", (items: T[]): void => {
    originalItems.unshift(...items);
    setOriginalItems(originalItems);
    rebuildGroups();
  });

  ctx.methods.set("removeItem", (id: string | number): void => {
    originalItems = originalItems.filter((item) => item.id !== id);
    setOriginalItems(originalItems);
    rebuildGroups();
  });

  // ── Override items getter to return original items (without headers) ──
  ctx.methods.set("_getItems", () => originalItems as readonly T[]);
  ctx.methods.set("_getTotal", () => originalItems.length);
  ctx.methods.set("_isGroupHeader", (index: number): boolean => {
    const item = layoutItems[index];
    return !!(item && isGroupHeader(item));
  });
  ctx.methods.set("_layoutToDataIndex", (layoutIndex: number): number =>
    groupLayout.layoutToDataIndex(layoutIndex),
  );
  ctx.methods.set("_dataToLayoutIndex", (dataIndex: number): number =>
    groupLayout.dataToLayoutIndex(dataIndex),
  );
}

// =============================================================================
// Async Path — virtual group layer bridging async data + group headers
// =============================================================================

function setupAsyncPath<T extends VListItem>(
  ctx: BuilderContext<T>,
  config: GroupsFeatureConfig & { header: { height: number; template: (key: string, groupIndex: number) => HTMLElement | string } },
  resolvedConfig: { horizontal: boolean; classPrefix: string; ariaIdPrefix: string },
  rawConfig: { item: { height?: any; template: any; striped?: any }; items?: T[] },
  baseSize: number | ((index: number) => number),
  stickyEnabled: boolean,
  headerTemplate: (key: string, groupIndex: number) => HTMLElement | string,
  classPrefix: string,
  registerOnItemsLoaded: (cb: (items: T[], offset: number, total: number) => void) => void,
  setBridge: (bridge: AsyncGroupBridge) => void,
  setStickyHeader: (s: StickyHeaderInstance) => void,
): void {
  const { dom } = ctx;

  // Save reference to the async data manager before we wrap it
  const asyncDataManager = ctx.dataManager;

  // ── Create the bridge ──
  const bridge = createAsyncGroupBridge(
    {
      getGroupForIndex: config.getGroupForIndex,
      headerHeight: config.header.height,
    },
    (index: number) => asyncDataManager.getItem(index),
    (index: number) => asyncDataManager.isItemLoaded(index),
  );
  setBridge(bridge);

  // ── Size function for layout space ──
  const getItemSize =
    typeof baseSize === "number"
      ? (_dataIndex: number): number => baseSize
      : baseSize;

  const asyncGroupedSizeFn = (layoutIndex: number): number => {
    if (bridge.isHeader(layoutIndex)) {
      // Collapse first group's inline header when sticky (same as static path)
      if (stickyEnabled && bridge.getGroupAtLayoutIndex(layoutIndex).groupIndex === 0) return 0;
      return config.header.height;
    }
    const dataIndex = bridge.layoutToDataIndex(layoutIndex);
    return dataIndex >= 0 ? getItemSize(dataIndex) : getItemSize(layoutIndex);
  };

  ctx.setSizeConfig(asyncGroupedSizeFn);

  // ── Virtual total includes headers ──
  // Fall back to the async data manager's total when the bridge hasn't
  // processed items yet (e.g. between onStateChange and onItemsLoaded
  // during reload). This prevents a transient totalEntries=0 that causes
  // sizeCache.rebuild(0) → NaN in stats and an empty render.
  ctx.setVirtualTotalFn(() => bridge.totalEntries || asyncDataManager.getTotal());

  // ── Wrap data manager for layout-space access ──
  // The renderer iterates layout indices and calls getItem(layoutIndex).
  // We intercept to return header pseudo-items or real data items.
  const wrappedDataManager: typeof ctx.dataManager = {
    ...asyncDataManager,
    getTotal: () => bridge.totalEntries,
    getIndexById: (id: string | number): number => {
      const dataIndex = asyncDataManager.getIndexById(id);
      if (dataIndex < 0) return -1;
      return bridge.dataToLayoutIndex(dataIndex);
    },
    getItem: (layoutIndex: number) => {
      const headerItem = bridge.getHeaderItem(layoutIndex);
      if (headerItem) return headerItem as unknown as T;
      const dataIndex = bridge.layoutToDataIndex(layoutIndex);
      if (dataIndex >= 0) return asyncDataManager.getItem(dataIndex);
      return asyncDataManager.getItem(layoutIndex);
    },
    getItemsInRange: (start: number, end: number) => {
      const items: T[] = [];
      for (let i = start; i <= end; i++) {
        const item = wrappedDataManager.getItem(i);
        if (item !== undefined) items.push(item);
      }
      return items;
    },
    isItemLoaded: (layoutIndex: number) => {
      if (bridge.isHeader(layoutIndex)) return true;
      const dataIndex = bridge.layoutToDataIndex(layoutIndex);
      if (dataIndex >= 0) return asyncDataManager.isItemLoaded(dataIndex);
      return asyncDataManager.isItemLoaded(layoutIndex);
    },
    // Loading methods pass through — ensureRange receives data indices
    // (converted by getItemRangeFromRenderRange in withAsync)
    ensureRange: (start: number, end: number) => asyncDataManager.ensureRange(start, end),
    loadRange: (start: number, end: number) => asyncDataManager.loadRange(start, end),
    loadInitial: () => asyncDataManager.loadInitial(),
    loadMore: () => asyncDataManager.loadMore(),
    reload: () => {
      bridge.reset();
      return asyncDataManager.reload();
    },
    setTotal: (total: number) => asyncDataManager.setTotal(total),
    setItems: (items: T[], offset?: number, total?: number) => asyncDataManager.setItems(items, offset, total),
    removeItem: (id: string | number) => {
      const dataIndex = asyncDataManager.getIndexById(id);
      if (dataIndex >= 0) {
        bridge.removeAt(dataIndex);
      }
      return asyncDataManager.removeItem(id);
    },
    clear: () => { bridge.reset(); asyncDataManager.clear(); },
    reset: () => { bridge.reset(); asyncDataManager.reset(); },
  };

  ctx.replaceDataManager(wrappedDataManager);

  // ── Template: dispatch headers vs data items ──
  const userTemplate = rawConfig.item.template;

  // Table integration: tell the table renderer about group headers so it
  // renders them as full-width separator rows instead of regular cell rows.
  const updateTableForGroups = ctx.methods.get("_updateTableForGroups") as
    | ((
        isHeaderFn: (item: any) => boolean,
        headerTemplate: (key: string, groupIndex: number) => HTMLElement | string,
      ) => void)
    | undefined;

  if (updateTableForGroups) {
    updateTableForGroups(
      (item: any) => isGroupHeader(item),
      config.header.template,
    );
  }

  ctx.replaceTemplate(((
    item: T | GroupHeaderItem,
    layoutIndex: number,
    state: any,
  ) => {
    if (isGroupHeader(item)) {
      return headerTemplate(
        (item as GroupHeaderItem).groupKey,
        (item as GroupHeaderItem).groupIndex,
      );
    }
    return userTemplate(item as T, layoutIndex, state);
  }) as typeof userTemplate);

  // ── Sticky header for async path ──
  // Uses the bridge as a GroupLayout-compatible source. Created once,
  // refreshes when groups change (onItemsLoaded).
  let asyncStickyHeader: StickyHeaderInstance | null = null;

  if (stickyEnabled) {
    const ht = config.header.template;
    const renderInto = (slot: HTMLElement, groupIndex: number): void => {
      const group = bridge.groups[groupIndex];
      if (!group) return;
      const result = ht(group.key, group.groupIndex);
      if (typeof result === "string") slot.innerHTML = result;
      else slot.replaceChildren(result);
    };

    // Create a GroupLayout-compatible adapter for the bridge
    const bridgeAsLayout: GroupLayout = {
      get totalEntries() { return bridge.totalEntries; },
      get groupCount() { return bridge.groupCount; },
      get groups() { return bridge.groups; },
      getEntry: (layoutIndex: number) => {
        if (bridge.isHeader(layoutIndex)) {
          return { type: "header" as const, group: bridge.getGroupAtLayoutIndex(layoutIndex) };
        }
        const dataIndex = bridge.layoutToDataIndex(layoutIndex);
        return { type: "item" as const, dataIndex, group: bridge.getGroupAtLayoutIndex(layoutIndex) };
      },
      layoutToDataIndex: (i: number) => bridge.layoutToDataIndex(i),
      dataToLayoutIndex: (i: number) => bridge.dataToLayoutIndex(i),
      getGroupAtLayoutIndex: (i: number) => bridge.getGroupAtLayoutIndex(i),
      getGroupAtDataIndex: (i: number) => bridge.getGroupAtDataIndex(i),
      getHeaderHeight: (i: number) => bridge.getHeaderHeight(i),
      rebuild: () => {}, // No-op — bridge rebuilds via onItemsLoaded
    };

    asyncStickyHeader = createStickyHeader(
      dom.root,
      bridgeAsLayout,
      ctx.sizeCache,
      renderInto,
      classPrefix,
      resolvedConfig.horizontal,
      0,
      () => ctx.getCachedCompression().ratio,
    );
    setStickyHeader(asyncStickyHeader);

    const stickyRef = asyncStickyHeader;
    ctx.afterScroll.push(
      (scrollPosition: number, _direction: string): void => {
        stickyRef.update(scrollPosition);
      },
    );
  }

  // ── Subscribe to items loaded — rebuild groups incrementally ──
  registerOnItemsLoaded((items: T[], offset: number, total: number) => {
    const scrollBefore = ctx.scrollController.getScrollTop();
    const headerCountBefore = bridge.groupCount;

    // Capture the data item + fractional offset at the current scroll
    // position BEFORE rebuilding, so we can restore it after.
    let dataIndexAtScroll = 0;
    let fractionInItem = 0;
    if (scrollBefore > 0) {
      const layoutIndex = ctx.sizeCache.indexAtOffset(scrollBefore);
      const baseOffset = ctx.sizeCache.getOffset(layoutIndex);
      const itemSize = ctx.sizeCache.getSize(layoutIndex);
      fractionInItem = itemSize > 0 ? (scrollBefore - baseOffset) / itemSize : 0;
      dataIndexAtScroll = bridge.layoutToDataIndex(layoutIndex);
    }

    bridge.onItemsLoaded(items as VListItem[], offset, total);

    // Rebuild size cache in place — do NOT call setSizeConfig() here.
    // setSizeConfig() replaces $.hc with a new SizeCache object, which
    // invalidates the sticky header's captured reference (bound at
    // creation time). rebuildSizeCache() mutates the existing cache,
    // keeping all references valid.
    ctx.rebuildSizeCache(bridge.totalEntries);

    // Update content size
    const compression = ctx.getCachedCompression();
    ctx.updateContentSize(compression.virtualSize);

    // Adjust scroll position for newly discovered headers.
    // New headers shift items down — without correction the viewport
    // drifts to the wrong data items (especially with compression).
    const newHeaders = bridge.groupCount - headerCountBefore;
    if (newHeaders > 0 && scrollBefore > 0) {
      const newLayoutIndex = bridge.dataToLayoutIndex(dataIndexAtScroll);
      const newBaseOffset = ctx.sizeCache.getOffset(newLayoutIndex);
      const newItemSize = ctx.sizeCache.getSize(newLayoutIndex);
      const newScroll = newBaseOffset + fractionInItem * newItemSize;
      if (Math.abs(newScroll - scrollBefore) > 1) {
        ctx.scrollController.scrollTo(newScroll);
      }
    }

    // Refresh sticky header and update for current scroll position.
    // After a big scroll jump, items load at idle — refresh() rebuilds
    // caches from the new group boundaries, then update() re-renders
    // the header for the current viewport position.
    if (asyncStickyHeader) {
      asyncStickyHeader.refresh();
      asyncStickyHeader.update(ctx.scrollController.getScrollTop());
    }
  });

  // ── Override index mapping methods for async path ──
  ctx.methods.set("_isGroupHeader", (layoutIndex: number): boolean =>
    bridge.isHeader(layoutIndex),
  );
  ctx.methods.set("_layoutToDataIndex", (layoutIndex: number): number =>
    bridge.layoutToDataIndex(layoutIndex),
  );
  ctx.methods.set("_dataToLayoutIndex", (dataIndex: number): number =>
    bridge.dataToLayoutIndex(dataIndex),
  );
  // In async mode, _getTotal returns the data total (not layout total)
  ctx.methods.set("_getTotal", () => asyncDataManager.getTotal());

  // Clear the static removeItem override — in async mode, the base api.ts
  // removeItem delegates to ctx.dataManager (= wrappedDataManager) which
  // handles the bridge correctly. The static override filters empty
  // originalItems and zeros out the list.
  ctx.methods.delete("removeItem");

  // ── Stripe map for async path ──
  const stripedMode = rawConfig.item?.striped;
  if (stripedMode === "data" || stripedMode === "even" || stripedMode === "odd") {
    const stripeOffset = stripedMode === "odd" ? 1 : 0;
    ctx.setStripeIndexFn((layoutIndex: number): number => {
      if (bridge.isHeader(layoutIndex)) return -1;
      const dataIndex = bridge.layoutToDataIndex(layoutIndex);
      return dataIndex >= 0 ? dataIndex + stripeOffset : layoutIndex;
    });
  }
}
