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
  let getItems: () => readonly T[];
  let horizontal: boolean;
  let classPrefix: string;
  let overscan: number;

  const rendered = new Map<number, HTMLElement>();
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let forceNextRender = true;

  function getLayoutItemCount(): number {
    return layout.totalEntries;
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

  function groupsRenderIfNeeded(): void {
    if (engineState.destroyed) return;

    const scrollPos = engineState.scrollPosition;
    const cs = engineState.containerSize;

    if (!forceNextRender && scrollPos === lastScrollPosition && cs === lastContainerSize) {
      return;
    }
    lastScrollPosition = scrollPos;
    lastContainerSize = cs;
    forceNextRender = false;

    const totalItems = getLayoutItemCount();
    if (cs <= 0 || totalItems === 0) return;

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

    const items = getItems();

    for (const [idx, element] of rendered) {
      if (idx < renderStart || idx > renderEnd) {
        element.remove();
        pool.release(element);
        rendered.delete(idx);
      }
    }

    const groupItemClass = `${classPrefix}-item ${classPrefix}-groups-item`;

    for (let i = renderStart; i <= renderEnd; i++) {
      let element = rendered.get(i);

      if (element === undefined) {
        element = pool.acquire();
        element.className = groupItemClass;
        element.setAttribute("data-index", String(i));

        const entry = layout.getEntry(i);
        let content: string | HTMLElement;

        if (entry.type === "header") {
          const headerItem: GroupHeaderItem = {
            id: `__group_header_${entry.group.groupIndex}`,
            __groupHeader: true,
            groupKey: entry.group.key,
            groupIndex: entry.group.groupIndex,
          };
          element.setAttribute("data-id", String(headerItem.id));

          content = headerTemplate(entry.group.key, entry.group.groupIndex);
        } else {
          const dataIndex = entry.dataIndex;
          const item = items[dataIndex];
          if (!item) continue;

          element.setAttribute("data-id", String(item.id));
          content = userTemplate(item, dataIndex, itemState);
        }

        if (typeof content === "string") {
          element.innerHTML = content;
        } else {
          element.innerHTML = "";
          element.appendChild(content);
        }

        rendered.set(i, element);
        contentElement.appendChild(element);
      }

      applySizeStyles(element, i);
      element.style.transform = buildTransform(i);
    }

    const totalSize = sizeCache.getTotalSize();
    contentElement.style[horizontal ? "width" : "height"] = totalSize + "px";

    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    engineState.renderPending = false;

    const count = renderEnd - renderStart + 1;
    engineState.visibleCount = Math.min(count, engineState.capacity);
    engineState.startIndex = renderStart;
    for (let i = 0; i < engineState.visibleCount; i++) {
      const idx = renderStart + i;
      engineState.visibleIndices[i] = idx;
      engineState.visibleOffsets[i] = sizeCache.getOffset(idx);
      engineState.visibleSizes[i] = sizeCache.getSize(idx);
    }
  }

  function groupsForceRender(): void {
    if (engineState.destroyed) return;
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
      getItems = ctx.getItems.bind(ctx);

      const originalItems = getItems();
      layout = createGroupLayout(originalItems.length, config, (i) => originalItems[i]);

      const getHeaderHeight =
        typeof headerHeightRaw === "number"
          ? (_groupIndex: number): number => headerHeightRaw
          : (groupIndex: number): number => {
              const group = layout.groups[groupIndex];
              if (!group) return 0;
              return (headerHeightRaw as Function)(group.key, groupIndex);
            };

      const origGetSize = sizeCache.getSize;
      const getItemSize = (dataIndex: number): number => origGetSize(dataIndex);

      const groupedSizeFn = (layoutIndex: number): number => {
        const entry = layout.getEntry(layoutIndex);
        if (entry.type === "header") {
          if (config.sticky !== false && entry.group.groupIndex === 0) return 0;
          return getHeaderHeight(entry.group.groupIndex);
        }
        return getItemSize(entry.dataIndex);
      };

      ctx.setSizeConfig(groupedSizeFn);
      ctx.setVirtualTotalFn(() => layout.totalEntries);

      rootElement.classList.add(`${classPrefix}--grouped`);

      if (config.sticky !== false && layout.groupCount > 0) {
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

        const stickyContainer = createStickyContainer(
          rootElement,
          classPrefix,
          horizontal,
          layout.getHeaderHeight(0),
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
      }

      ctx.setRenderFn(groupsRenderIfNeeded, groupsForceRender);

      ctx.registerMethod("getGroupLayout", () => layout);

      ctx.registerDestroyHandler(() => {
        for (const [, element] of rendered) {
          element.remove();
        }
        rendered.clear();
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
    },
  };
}