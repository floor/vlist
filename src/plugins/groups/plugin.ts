/**
 * vlist v2 — Groups Plugin
 *
 * Adds grouped lists with sticky headers.
 * Priority 10 — runs before selection (50).
 *
 * Architecture:
 * - Transforms items list: inserts group header pseudo-items at group boundaries
 * - Replaces size function: headers use header height, items use item height
 * - Replaces render pipeline: handles grouped layout rendering
 * - Sticky header: floating header that updates on scroll
 * - CSS class: adds .vlist--grouped to root
 *
 * Restrictions:
 * - Items must be pre-sorted by group
 */

import type { VListItem, GroupsConfig, ItemTemplate, ItemState } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
type ItemStateFn = (index: number, state: ItemState) => void;
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";
import type { ElementPool } from "../../core/types";

import {
  createGroupLayout,
} from "./layout";

import { createStickyHeader, createStickyContainer } from "./sticky";

import {
  type GroupHeaderItem,
  type GroupLayout,
  type StickyHeader as StickyHeaderInstance,
} from "./types";

export interface GroupsPluginConfig extends GroupsConfig {}

const itemState: ItemState = { selected: false, focused: false };

const DEBUG = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

export function groups<T extends VListItem = VListItem>(
  config: GroupsPluginConfig,
): VListPlugin<T> {
  if (!config.getGroupForIndex) {
    throw new Error("[vlist] groups: getGroupForIndex is required");
  }

  const headerHeightRaw = config.header?.height ?? config.header?.width ?? config.headerHeight;
  if (headerHeightRaw == null || (typeof headerHeightRaw === "number" && headerHeightRaw <= 0)) {
    throw new Error("[vlist] groups: header height/width must be a positive number or function");
  }

  const rawHeaderTemplate = config.header?.template ?? config.headerTemplate;
  if (!rawHeaderTemplate) {
    throw new Error("[vlist] groups: header.template is required");
  }
  const headerTemplate = rawHeaderTemplate;

  let layout: GroupLayout;
  let stickyHeader: StickyHeaderInstance | null = null;
  let sizeCache: SizeCache;
  let engineState: EngineState;
  let pool: ElementPool;
  let contentElement: HTMLElement;
  let rootElement: HTMLElement;
  let userTemplate: ItemTemplate<T>;
  let ctxGetItem: (index: number) => T | undefined;
  let horizontal: boolean;
  let classPrefix: string;
  let overscan: number;
  let resolveItemState: (() => ItemStateFn | null) | null = null;
  let groupItemClass: string;
  let groupHeaderClass: string;
  let getMethod: ((name: string) => Function | undefined) | null = null;

  const rendered = new Map<number, HTMLElement>();
  // Track which layout indices currently show placeholder content
  const placeholderIndices = new Set<number>();
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let forceNextRender = true;
  let lastDataCount = -1;
  let origSizeCacheRebuild: SizeCache["rebuild"];

  function getLayoutItemCount(): number {
    return layout.totalEntries;
  }

  // Only rebuilds layout when the data total changes (initial load, reload).
  // Item content updates (placeholder → real) are handled by the render loop
  // updating existing DOM elements in-place — no layout rebuild needed.
  function syncLayoutIfNeeded(): void {
    const dataCount = engineState.totalItems;
    if (dataCount === lastDataCount) return;

    if (DEBUG) {
      console.log(`[groups] syncLayout: ${lastDataCount} → ${dataCount}`);
    }

    const wasLoaded = lastDataCount > 0;
    lastDataCount = dataCount;
    layout.rebuild(dataCount, ctxGetItem);
    origSizeCacheRebuild(layout.totalEntries);
    const totalSize = sizeCache.getTotalSize();
    contentElement.style[horizontal ? "width" : "height"] = totalSize + "px";
    if (stickyHeader) {
      stickyHeader.refresh();
      stickyHeader.update(engineState.scrollPosition);
    }

    // Layout indices shifted (item added/removed) — rendered elements
    // are keyed by old layout indices and show stale content. Clear them
    // so the render loop recreates everything. Skip on initial load
    // (wasLoaded=false) to avoid a flash.
    if (wasLoaded) {
      rendered.forEach((element) => {
        element.remove();
        pool.release(element);
      });
      rendered.clear();
      placeholderIndices.clear();
    }

    const getSb = getMethod?.("_scrollbar:getInstance") as (() => { updateBounds(t: number, c: number): void }) | undefined;
    if (getSb) {
      const sb = getSb();
      sb?.updateBounds(totalSize, engineState.containerSize);
    }
  }

  function buildTransform(layoutIndex: number): string {
    const offset = sizeCache.getOffset(layoutIndex);
    if (horizontal) {
      return `translate(${Math.round(offset)}px, 0)`;
    }
    return `translate(0, ${Math.round(offset)}px)`;
  }

  function applySizeStyles(element: HTMLElement, layoutIndex: number): void {
    const size = sizeCache.getSize(layoutIndex);
    if (horizontal) {
      element.style.width = `${size}px`;
    } else {
      element.style.height = `${size}px`;
    }
  }

  function renderItemContent(
    element: HTMLElement,
    entry: ReturnType<GroupLayout["getEntry"]>,
    isf: ItemStateFn | null,
    layoutIndex: number,
  ): boolean {
    if (entry.type === "header") {
      element.className = groupHeaderClass;
      element.setAttribute("role", "presentation");
      element.removeAttribute("aria-selected");

      const headerItem: GroupHeaderItem = {
        id: `__group_header_${entry.group.groupIndex}`,
        __groupHeader: true,
        groupKey: entry.group.key,
        groupIndex: entry.group.groupIndex,
      };
      element.setAttribute("data-id", String(headerItem.id));

      const content = headerTemplate(entry.group.key, entry.group.groupIndex);
      if (typeof content === "string") {
        element.innerHTML = content;
      } else {
        element.innerHTML = "";
        element.appendChild(content);
      }
      return true;
    }

    // Data item
    element.className = groupItemClass;
    element.setAttribute("role", "option");

    const dataIndex = entry.dataIndex;
    const item = ctxGetItem(dataIndex);

    if (!item) {
      element.innerHTML = "";
      return false;
    }

    element.setAttribute("data-id", String(item.id));
    const isPlaceholder = item._isPlaceholder === true;

    if (isPlaceholder) {
      element.classList.add(`${classPrefix}-item--placeholder`);
    } else {
      element.classList.remove(`${classPrefix}-item--placeholder`);
    }

    if (isf) isf(layoutIndex, itemState);
    else { itemState.selected = false; itemState.focused = false; }
    const content = userTemplate(item, dataIndex, itemState);
    if (typeof content === "string") {
      element.innerHTML = content;
    } else {
      element.innerHTML = "";
      element.appendChild(content);
    }
    return !isPlaceholder;
  }

  function groupsRenderIfNeeded(): void {
    if (engineState.destroyed) return;

    syncLayoutIfNeeded();

    const scrollPos = engineState.scrollPosition;
    const cs = engineState.containerSize;

    if (!forceNextRender && scrollPos === lastScrollPosition && cs === lastContainerSize) {
      return;
    }
    lastScrollPosition = scrollPos;
    lastContainerSize = cs;
    const isForced = forceNextRender;
    forceNextRender = false;

    const totalItems = getLayoutItemCount();
    if (cs <= 0 || totalItems === 0) {
      if (rendered.size > 0) {
        rendered.forEach((element) => {
          element.remove();
          pool.release(element);
        });
        rendered.clear();
        placeholderIndices.clear();
      }
      return;
    }

    let visStart = sizeCache.indexAtOffset(scrollPos);
    let visEnd = sizeCache.indexAtOffset(scrollPos + cs);
    if (visEnd < totalItems - 1) visEnd++;
    visStart = Math.max(0, visStart);
    visEnd = Math.min(totalItems - 1, Math.max(0, visEnd));

    const renderStart = Math.max(0, visStart - overscan);
    const renderEnd = Math.min(totalItems - 1, visEnd + overscan);

    if (renderStart === engineState.prevRangeStart && renderEnd === engineState.prevRangeEnd && !engineState.renderPending) {
      return;
    }

    // Recycle elements outside the new range
    rendered.forEach((element, idx) => {
      if (idx < renderStart || idx > renderEnd) {
        element.remove();
        pool.release(element);
        rendered.delete(idx);
        placeholderIndices.delete(idx);
      }
    });

    const isf = resolveItemState?.();
    const selClass = isf ? `${classPrefix}-item--selected` : "";
    const focClass = isf ? `${classPrefix}-item--focused` : "";

    for (let i = renderStart; i <= renderEnd; i++) {
      let element = rendered.get(i);
      const entry = layout.getEntry(i);
      const isNew = element === undefined;

      // Check if existing placeholder element now has real data
      const needsUpdate = !isNew && isForced && placeholderIndices.has(i) && entry.type === "item";

      if (isNew || needsUpdate) {
        if (isNew) {
          element = pool.acquire();
          element.setAttribute("data-index", String(i));
        }

        const hasContent = renderItemContent(element!, entry, isf, i);

        if (hasContent) {
          placeholderIndices.delete(i);
        } else {
          placeholderIndices.add(i);
        }

        if (isNew) {
          rendered.set(i, element!);
          contentElement.appendChild(element!);
        }
      }

      if (entry.type !== "header" && isf) {
        isf(i, itemState);
        element!.classList.toggle(selClass, itemState.selected);
        element!.classList.toggle(focClass, itemState.focused);
        if (itemState.selected) element!.setAttribute("aria-selected", "true");
        else element!.removeAttribute("aria-selected");
      }

      applySizeStyles(element!, i);
      element!.style.transform = buildTransform(i);
    }

    const totalSize = sizeCache.getTotalSize();
    contentElement.style[horizontal ? "width" : "height"] = totalSize + "px";

    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    engineState.renderPending = false;

    // Fill engine state with DATA indices so the async plugin loads
    // the correct items (it reads startIndex/visibleCount as data indices).
    let dataFillCount = 0;
    let firstDataIndex = 0;
    let foundFirst = false;
    for (let i = renderStart; i <= renderEnd && dataFillCount < engineState.capacity; i++) {
      const entry = layout.getEntry(i);
      if (entry.type === "item") {
        if (!foundFirst) { firstDataIndex = entry.dataIndex; foundFirst = true; }
        engineState.visibleIndices[dataFillCount] = entry.dataIndex;
        engineState.visibleOffsets[dataFillCount] = sizeCache.getOffset(i);
        engineState.visibleSizes[dataFillCount] = sizeCache.getSize(i);
        dataFillCount++;
      }
    }
    engineState.visibleCount = dataFillCount;
    engineState.startIndex = firstDataIndex;
  }

  // v1 pattern: forceRender does NO layout rebuild and NO DOM clearing.
  // It just forces the render loop to run, which updates placeholder
  // elements in-place when real data has arrived.
  function groupsForceRender(): void {
    if (engineState.destroyed) return;

    if (DEBUG) {
      console.log(`[groups] forceRender, placeholders: ${placeholderIndices.size}, rendered: ${rendered.size}`);
    }

    engineState.prevRangeStart = -1;
    engineState.prevRangeEnd = -1;
    engineState.renderPending = true;
    forceNextRender = true;
    groupsRenderIfNeeded();
  }

  return {
    name: "groups",
    priority: 10,

    setup(ctx: PluginContext<T>): void {
      sizeCache = ctx.sizeCache;
      engineState = ctx.getState();
      pool = ctx.pool;
      contentElement = ctx.dom.content;
      rootElement = ctx.dom.root;
      userTemplate = ctx.template;
      horizontal = ctx.config.horizontal;
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      ctxGetItem = ctx.getItem.bind(ctx);
      resolveItemState = () => ctx.getItemStateFn();
      getMethod = ctx.getMethod.bind(ctx);
      groupItemClass = `${classPrefix}-item ${classPrefix}-groups-item`;
      groupHeaderClass = `${classPrefix}-group-header`;

      const dataCount = engineState.totalItems;
      layout = createGroupLayout(dataCount, config, ctxGetItem);
      lastDataCount = dataCount;

      const getHeaderHeight =
        typeof headerHeightRaw === "number"
          ? (_groupIndex: number): number => headerHeightRaw
          : (groupIndex: number): number => {
              const group = layout.groups[groupIndex];
              if (!group) return 0;
              return (headerHeightRaw as Function)(group.key, groupIndex);
            };

      const origGetSize = sizeCache.getSize;

      const groupedSizeFn = (layoutIndex: number): number => {
        const entry = layout.getEntry(layoutIndex);
        if (entry.type === "header") {
          if (config.sticky !== false && entry.group.groupIndex === 0) return 0;
          return getHeaderHeight(entry.group.groupIndex);
        }
        return origGetSize(entry.dataIndex);
      };

      ctx.setSizeConfig(groupedSizeFn);

      // Intercept sizeCache.rebuild: external callers (async plugin) pass
      // data count, but groups needs layout count. Always use layout.totalEntries
      // to keep prefix sums consistent with the grouped layout.
      origSizeCacheRebuild = sizeCache.rebuild;
      sizeCache.rebuild = (_n: number): void => {
        origSizeCacheRebuild(layout.totalEntries);
      };

      sizeCache.rebuild(layout.totalEntries);
      ctx.setVirtualTotalFn(() => layout.totalEntries);

      rootElement.classList.add(`${classPrefix}--grouped`);

      if (config.sticky !== false) {
        const renderInto = (slot: HTMLElement, groupIndex: number): void => {
          const group = layout.groups[groupIndex];
          if (!group) return;
          const result = headerTemplate(group.key, groupIndex);
          if (typeof result === "string") {
            slot.innerHTML = result;
          } else {
            slot.replaceChildren(result);
          }
        };

        const headerH = layout.getHeaderHeight(0);

        const stickyContainer = createStickyContainer(
          rootElement,
          classPrefix,
          horizontal,
          headerH,
        );

        stickyHeader = createStickyHeader(
          rootElement,
          layout,
          sizeCache,
          renderInto,
          classPrefix,
          horizontal,
          0,
          undefined,
          stickyContainer,
        );

        stickyHeader.update(engineState.scrollPosition);

        if (!horizontal) {
          ctx.dom.viewport.style.height = `calc(100% - ${headerH}px)`;
        } else {
          ctx.dom.viewport.style.width = `calc(100% - ${headerH}px)`;
        }
      }

      ctx.setRenderFn(groupsRenderIfNeeded, groupsForceRender);

      ctx.registerMethod("getGroupLayout", () => layout);

      ctx.registerMethod("_dataToLayoutIndex", (dataIndex: number): number =>
        layout.dataToLayoutIndex(dataIndex),
      );
      ctx.registerMethod("_layoutToDataIndex", (layoutIndex: number): number =>
        layout.layoutToDataIndex(layoutIndex),
      );
      ctx.registerMethod("_getRenderedElement", (layoutIndex: number): HTMLElement | null =>
        rendered.get(layoutIndex) ?? null,
      );
      ctx.registerMethod("_isGroupHeader", (layoutIndex: number): boolean => {
        const entry = layout.getEntry(layoutIndex);
        return entry.type === "header";
      });

      ctx.registerMethod("scrollToIndex", (
        index: number,
        alignOrOptions: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number } = "start",
      ) => {
        const layoutIndex = layout.dataToLayoutIndex(index);
        const totalLayout = layout.totalEntries;
        if (totalLayout === 0) return;
        const clamped = Math.max(0, Math.min(layoutIndex, totalLayout - 1));
        const offset = sizeCache.getOffset(clamped);
        const itemSize = sizeCache.getSize(clamped);
        const cs = engineState.containerSize;
        const totalSize = sizeCache.getTotalSize();
        const maxScroll = Math.max(0, totalSize - cs);

        const align = typeof alignOrOptions === "string" ? alignOrOptions : (alignOrOptions.align ?? "start");
        const behavior = typeof alignOrOptions === "object" ? alignOrOptions.behavior : undefined;
        const duration = typeof alignOrOptions === "object" ? alignOrOptions.duration : undefined;

        let pos: number;
        switch (align) {
          case "center":
            pos = offset - (cs - itemSize) / 2;
            break;
          case "end":
            pos = offset - cs + itemSize;
            break;
          default:
            pos = offset;
        }
        pos = Math.max(0, Math.min(pos, maxScroll));

        if (behavior === "smooth" && duration && duration > 0) {
          ctx.smoothScrollTo(pos, duration);
        } else {
          ctx.scrollTo(pos);
        }
      });

      ctx.registerDestroyHandler(() => {
        for (const [, element] of rendered) {
          element.remove();
        }
        rendered.clear();
        placeholderIndices.clear();
        if (stickyHeader) {
          stickyHeader.destroy();
          stickyHeader = null;
        }
        rootElement.classList.remove(`${classPrefix}--grouped`);
      });
    },

    hooks: {
      onAfterScroll(scrollPosition: number, _direction: number): void {
        if (stickyHeader) {
          stickyHeader.update(scrollPosition);
        }
      },
    },

    destroy(): void {
      if (stickyHeader) {
        stickyHeader.destroy();
        stickyHeader = null;
      }
      rendered.clear();
      placeholderIndices.clear();
    },
  };
}
