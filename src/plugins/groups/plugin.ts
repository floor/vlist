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
import { neutralizeFocusable } from "../../core/dom";

import {
  createGroupLayout,
} from "./layout";

import { createStickyHeader, createStickyContainer } from "./sticky";

import {
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
  let getLoadedItem: ((index: number) => T | undefined) | null = null;
  let isX: boolean;
  let classPrefix: string;
  let overscan: number;
  let resolveItemState: (() => ItemStateFn | null) | null = null;
  let groupItemClass: string;
  let groupHeaderClass: string;
  let getMethod: ((name: string) => Function | undefined) | null = null;
  let interactive: boolean | null = null;
  let gridColumns = 0;
  let gridGap = 0;
  let gridCrossPadStart = 0;
  let gridCrossPadTotal = 0;
  let mainAxisPadding = 0;

  const rendered = new Map<number, HTMLElement>();
  // Track which layout indices currently show placeholder content
  const placeholderIndices = new Set<number>();
  // Elements detached during boundary changes, keyed by data-id.
  // Reused in the next render pass to avoid pool round-trip (which clears innerHTML).
  const detached = new Map<string, HTMLElement>();
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let forceNextRender = true;
  let lastDataCount = -1;
  let lastRebuildLoadedCount = 0;
  let getLoadedCount: (() => number) | null = null;
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
    layout.rebuild(dataCount, getLoadedItem ?? ctxGetItem);
    origSizeCacheRebuild(layout.totalEntries);
    rebuildGridPositions();
    const totalSize = gridItemPositions ? getGridContentSize() : sizeCache.getTotalSize();
    contentElement.style[isX ? "width" : "height"] = (totalSize + mainAxisPadding) + "px";
    if (stickyHeader) {
      stickyHeader.refresh();
      stickyHeader.update(engineState.scrollPosition);
    }

    // Layout indices shifted — detach elements (keyed by data-id) so the
    // render loop can reclaim them without a pool round-trip that clears innerHTML.
    if (wasLoaded) {
      detachAll();
    }

    const getSb = getMethod?.("_scrollbar:getInstance") as (() => { updateBounds(t: number, c: number): void }) | undefined;
    if (getSb) {
      const sb = getSb();
      sb?.updateBounds(totalSize, engineState.containerSize);
    }
  }

  let gridColWidth = 0;
  let gridItemPositions: Map<number, { col: number; rowY: number }> | null = null;
  // Parallel sorted array for O(log n) visible range lookup.
  // Each entry: [layoutIndex, rowY, rowY + itemHeight].
  let gridSorted: Array<[number, number, number]> | null = null;

  function rebuildGridPositions(): void {
    if (gridColumns <= 0) { gridItemPositions = null; gridSorted = null; return; }
    const rawCross = engineState.crossSize || contentElement.clientWidth;
    const containerW = rawCross - gridCrossPadTotal;
    gridColWidth = (containerW - (gridColumns - 1) * gridGap) / gridColumns;
    gridItemPositions = new Map();

    const total = layout.totalEntries;
    const sorted: Array<[number, number, number]> = new Array(total);
    let sortedLen = 0;
    let groupY = 0;
    let itemInGroup = 0;
    let rowH = 0;

    for (let i = 0; i < total; i++) {
      const entry = layout.getEntry(i);
      if (entry.type === "header") {
        if (itemInGroup > 0 && rowH > 0) groupY += rowH;
        const h = sizeCache.getSize(i);
        gridItemPositions.set(i, { col: -1, rowY: groupY });
        sorted[sortedLen++] = [i, groupY, groupY + h];
        groupY += h;
        itemInGroup = 0;
        rowH = 0;
      } else {
        const col = itemInGroup % gridColumns;
        const h = sizeCache.getSize(i);
        if (col === 0) {
          if (itemInGroup > 0 && rowH > 0) groupY += rowH + gridGap;
          rowH = h;
        } else {
          if (h > rowH) rowH = h;
        }
        gridItemPositions.set(i, { col, rowY: groupY });
        sorted[sortedLen++] = [i, groupY, groupY + h];
        itemInGroup++;
      }
    }
    sorted.length = sortedLen;
    gridSorted = sorted;
  }

  function getGridContentSize(): number {
    if (!gridItemPositions || gridItemPositions.size === 0) return sizeCache.getTotalSize();
    let maxY = 0;
    const total = layout.totalEntries;
    for (let i = total - 1; i >= 0; i--) {
      const pos = gridItemPositions.get(i);
      if (pos) { maxY = pos.rowY + sizeCache.getSize(i); break; }
      const entry = layout.getEntry(i);
      if (entry.type === "header") { maxY = sizeCache.getOffset(i) + sizeCache.getSize(i); break; }
    }
    return maxY;
  }

  function buildTransform(layoutIndex: number): string {
    if (gridItemPositions) {
      const pos = gridItemPositions.get(layoutIndex);
      if (pos) {
        const x = pos.col < 0 ? 0 : gridCrossPadStart + pos.col * (gridColWidth + gridGap);
        const y = pos.rowY;
        if (isX) return `translate(${Math.round(y)}px, ${Math.round(x)}px)`;
        return `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    }

    const offset = sizeCache.getOffset(layoutIndex);
    if (isX) {
      return `translate(${Math.round(offset)}px, 0)`;
    }
    return `translate(0, ${Math.round(offset)}px)`;
  }

  function applySizeStyles(element: HTMLElement, layoutIndex: number): void {
    const size = sizeCache.getSize(layoutIndex);
    const pos = gridItemPositions?.get(layoutIndex);
    if (pos) {
      if (pos.col < 0) {
        // Header: spans full width
        if (isX) {
          element.style.width = `${size}px`;
          element.style.height = "";
        } else {
          element.style.height = `${size}px`;
          element.style.width = "100%";
        }
      } else {
        if (isX) {
          element.style.width = `${size}px`;
          element.style.height = `${gridColWidth}px`;
        } else {
          element.style.height = `${size}px`;
          element.style.width = `${gridColWidth}px`;
        }
      }
      return;
    }
    if (isX) {
      element.style.width = `${size}px`;
    } else {
      element.style.height = `${size}px`;
    }
  }


  function detachAll(): void {
    rendered.forEach((element) => {
      element.remove();
      const id = element.getAttribute("data-id");
      if (id) {
        detached.set(id, element);
      } else {
        pool.release(element);
      }
    });
    rendered.clear();
    placeholderIndices.clear();
  }

  function drainDetached(): void {
    if (detached.size > 0) {
      detached.forEach((element) => pool.release(element));
      detached.clear();
    }
  }

  function renderItemContent(
    element: HTMLElement,
    entry: ReturnType<GroupLayout["getEntry"]>,
    isf: ItemStateFn | null,
    layoutIndex: number,
  ): boolean {
    if (interactive === null) {
      interactive = !!getMethod?.("_getSelectedIds");
    }
    if (entry.type === "header") {
      const headerId = `__group_header_${entry.group.groupIndex}`;
      if (element.getAttribute("data-id") === headerId) {
        return true;
      }

      element.className = groupHeaderClass;
      element.setAttribute("role", "presentation");
      element.removeAttribute("aria-selected");
      element.setAttribute("data-id", headerId);

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
    const dataIndex = entry.dataIndex;
    const item = ctxGetItem(dataIndex);

    if (!item) {
      element.innerHTML = "";
      return false;
    }

    const isPlaceholder = item._isPlaceholder === true;
    const itemId = String(item.id);

    // Element already shows this item with real content — skip template
    if (!isPlaceholder && element.getAttribute("data-id") === itemId) {
      if (interactive) {
        element.id = `${classPrefix}-item-${layoutIndex}`;
        element.setAttribute("aria-posinset", String(dataIndex + 1));
        element.setAttribute("aria-setsize", String(engineState.totalItems));
      }
      return true;
    }

    element.className = groupItemClass;
    element.setAttribute("role", interactive ? "option" : "listitem");
    element.setAttribute("data-id", itemId);
    if (interactive) {
      element.id = `${classPrefix}-item-${layoutIndex}`;
      element.setAttribute("aria-posinset", String(dataIndex + 1));
      element.setAttribute("aria-setsize", String(engineState.totalItems));
    }

    if (isPlaceholder) {
      element.classList.add(`${classPrefix}-item--placeholder`);
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
    neutralizeFocusable(element);
    return !isPlaceholder;
  }

  let lastCrossSize = 0;

  function syncGridIfResized(): void {
    if (gridColumns <= 0) return;
    const cross = engineState.crossSize;
    if (cross === lastCrossSize) return;
    lastCrossSize = cross;
    rebuildGridPositions();
    const totalSize = getGridContentSize();
    contentElement.style[isX ? "width" : "height"] = (totalSize + mainAxisPadding) + "px";
    if (stickyHeader) {
      stickyHeader.refresh();
      stickyHeader.update(engineState.scrollPosition);
    }
    forceNextRender = true;
  }

  function groupsRenderIfNeeded(): void {
    if (engineState.destroyed) return;

    syncLayoutIfNeeded();
    syncGridIfResized();

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

    let renderStart: number;
    let renderEnd: number;

    if (gridSorted) {
      // Grid mode: binary search the sorted position array for the
      // first entry whose bottom edge > scrollPos and the last entry
      // whose top edge < scrollPos + containerSize.
      const gs = gridSorted;
      const len = gs.length;
      let lo = 0, hi = len - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (gs[mid]![2] <= scrollPos) lo = mid + 1;
        else hi = mid;
      }
      const firstSorted = lo;
      hi = len - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (gs[mid]![1] >= scrollPos + cs) hi = mid - 1;
        else lo = mid;
      }
      const lastSorted = lo;

      let first = gs[firstSorted]![0];
      let last = gs[lastSorted]![0];
      // Include the group header preceding the first visible item
      for (let i = first - 1; i >= 0; i--) {
        if (layout.getEntry(i).type === "header") { first = i; break; }
      }
      const gridOverscan = overscan * gridColumns;
      renderStart = Math.max(0, first - gridOverscan);
      renderEnd = Math.min(totalItems - 1, last + gridOverscan);
    } else {
      let visStart = sizeCache.indexAtOffset(scrollPos);
      let visEnd = sizeCache.indexAtOffset(scrollPos + cs);
      if (visEnd < totalItems - 1) visEnd++;
      visStart = Math.max(0, visStart);
      visEnd = Math.min(totalItems - 1, Math.max(0, visEnd));
      renderStart = Math.max(0, visStart - overscan);
      renderEnd = Math.min(totalItems - 1, visEnd + overscan);
    }

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

    const isf = resolveItemState?.() ?? null;
    const selClass = isf ? `${classPrefix}-item--selected` : "";
    const focClass = isf ? `${classPrefix}-item--focused` : "";
    let fragment: DocumentFragment | null = null;

    for (let i = renderStart; i <= renderEnd; i++) {
      let element = rendered.get(i);
      let isHeader = false;

      if (element === undefined) {
        // ── New element ──
        const entry = layout.getEntry(i);
        isHeader = entry.type === "header";

        // Try to reclaim a detached element with matching data-id
        // (avoids pool round-trip that destroys innerHTML / images)
        let expectedId: string | undefined;
        if (entry.type === "header") {
          expectedId = `__group_header_${entry.group.groupIndex}`;
        } else {
          const item = ctxGetItem(entry.dataIndex);
          if (item && item._isPlaceholder !== true) {
            expectedId = String(item.id);
          }
        }
        if (expectedId !== undefined) {
          const reused = detached.get(expectedId);
          if (reused) {
            detached.delete(expectedId);
            element = reused;
          }
        }
        if (!element) {
          element = pool.acquire();
        }
        element.setAttribute("data-index", String(i));

        const hasContent = renderItemContent(element, entry, isf, i);
        if (hasContent) placeholderIndices.delete(i);
        else placeholderIndices.add(i);

        applySizeStyles(element, i);
        element.style.transform = buildTransform(i);

        rendered.set(i, element);
        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(element);

      } else if (isForced && placeholderIndices.has(i)) {
        // ── Existing placeholder — check if real data arrived ──
        const entry = layout.getEntry(i);
        if (entry.type === "item") {
          const hasContent = renderItemContent(element, entry, isf, i);
          if (hasContent) placeholderIndices.delete(i);
          else placeholderIndices.add(i);
        }
      } else {
        // ── Existing unchanged element — fast path ──
        isHeader = element.classList.contains(groupHeaderClass);
        if (isForced) {
          applySizeStyles(element, i);
          element.style.transform = buildTransform(i);
        }
      }

      if (!isHeader && isf) {
        isf(i, itemState);
        element!.classList.toggle(selClass, itemState.selected);
        element!.classList.toggle(focClass, itemState.focused);
        if (itemState.selected) element!.setAttribute("aria-selected", "true");
        else element!.removeAttribute("aria-selected");
      }
    }

    if (fragment) {
      contentElement.appendChild(fragment);
    }

    drainDetached();

    const totalSize = gridItemPositions ? getGridContentSize() : sizeCache.getTotalSize();
    contentElement.style[isX ? "width" : "height"] = (totalSize + mainAxisPadding) + "px";

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

  function groupsForceRender(): void {
    if (engineState.destroyed) return;
    syncGridIfResized();

    if (DEBUG) {
      console.log(`[groups] forceRender, placeholders: ${placeholderIndices.size}, rendered: ${rendered.size}`);
    }

    // When async data arrives, group boundaries may change. But forceRender
    // is also called on every scale-plugin lerp tick (60fps), so we must NOT
    // run the expensive layout.rebuild on every call. O(1) check: compare
    // loaded item count — only changes when async plugin delivers new data.
    const currentLoaded = getLoadedCount?.() ?? 0;
    if (currentLoaded !== lastRebuildLoadedCount) {
      lastRebuildLoadedCount = currentLoaded;

      const prevGroups = layout.groups;
      const prevGroupCount = prevGroups.length;
      layout.rebuild(lastDataCount, getLoadedItem ?? ctxGetItem);
      const newGroups = layout.groups;

      let boundariesChanged = newGroups.length !== prevGroupCount;
      if (!boundariesChanged) {
        for (let i = 0; i < prevGroupCount; i++) {
          if (newGroups[i]!.headerLayoutIndex !== prevGroups[i]!.headerLayoutIndex) {
            boundariesChanged = true;
            break;
          }
        }
      }

      if (boundariesChanged) {
        origSizeCacheRebuild(layout.totalEntries);
        rebuildGridPositions();
        const totalSize = gridItemPositions ? getGridContentSize() : sizeCache.getTotalSize();
        contentElement.style[isX ? "width" : "height"] = totalSize + "px";
        if (stickyHeader) {
          stickyHeader.refresh();
          stickyHeader.update(engineState.scrollPosition);
        }

        // Only clear DOM if the boundary shift affects the rendered range.
        // Preload-ahead data often creates new groups far from the viewport
        // — no reason to destroy visible elements for that.
        let firstShift = Infinity;
        const minG = Math.min(prevGroupCount, newGroups.length);
        for (let g = 0; g < minG; g++) {
          if (newGroups[g]!.headerLayoutIndex !== prevGroups[g]!.headerLayoutIndex) {
            firstShift = Math.min(newGroups[g]!.headerLayoutIndex, prevGroups[g]!.headerLayoutIndex);
            break;
          }
        }
        if (newGroups.length > prevGroupCount && minG < newGroups.length) {
          firstShift = Math.min(firstShift, newGroups[minG]!.headerLayoutIndex);
        } else if (prevGroupCount > newGroups.length && minG < prevGroupCount) {
          firstShift = Math.min(firstShift, prevGroups[minG]!.headerLayoutIndex);
        }

        if (firstShift <= engineState.prevRangeEnd) {
          detachAll();
        }

        const getSb = getMethod?.("_scrollbar:getInstance") as (() => { updateBounds(t: number, c: number): void }) | undefined;
        if (getSb) {
          const sb = getSb();
          sb?.updateBounds(totalSize, engineState.containerSize);
        }
      }
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
      isX = ctx.config.axis.primary === "x";
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      mainAxisPadding = ctx.config.mainAxisPadding;
      ctxGetItem = ctx.getItem.bind(ctx);
      resolveItemState = () => ctx.getItemStateFn();
      getMethod = ctx.getMethod.bind(ctx);
      interactive = null;
      groupItemClass = `${classPrefix}-item`;
      groupHeaderClass = `${classPrefix}-group-header`;

      // Resolve raw storage accessor (async plugin) — returns undefined for
      // unloaded items without generating placeholder objects. Used in
      // buildGroups to skip unloaded items efficiently.
      // Resolve grid info synchronously — grid runs at same priority (10)
      // but may be listed before groups in the plugin array
      const gridLayoutFn = getMethod?.("getGridLayout") as (() => { columns: number; gap: number }) | undefined;
      if (gridLayoutFn) {
        const gl = gridLayoutFn();
        gridColumns = gl.columns;
        gridGap = gl.gap;
        gridCrossPadStart = ctx.config.crossPadStart;
        gridCrossPadTotal = ctx.config.crossAxisPadding;
      }

      queueMicrotask(() => {
        const fn = getMethod?.("_getLoadedItem") as ((i: number) => T | undefined) | undefined;
        if (fn) getLoadedItem = fn;
        const countFn = getMethod?.("_getLoadedCount") as (() => number) | undefined;
        if (countFn) getLoadedCount = countFn;
      });

      const dataCount = engineState.totalItems;
      layout = createGroupLayout(dataCount, config, getLoadedItem ?? ctxGetItem);
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

      // Intercept sizeCache.rebuild so groups can map between data indices
      // and layout indices (which include group header pseudo-entries).
      // Called by: data plugin on total change, data plugin on items loaded,
      // snapshots plugin on scroll restore, scale plugin on compression change.
      let tableMode = false;
      let lastTableLoadedCount = -1;
      origSizeCacheRebuild = sizeCache.rebuild;
      sizeCache.rebuild = (n: number): void => {
        if (tableMode) {
          if (!getLoadedCount) {
            getLoadedCount = (getMethod?.("_getLoadedCount") as (() => number) | undefined) ?? null;
          }
          const loaded = getLoadedCount?.() ?? 0;
          if (n !== lastDataCount || loaded !== lastTableLoadedCount) {
            lastDataCount = n;
            lastTableLoadedCount = loaded;
            if (!getLoadedItem) {
              getLoadedItem = (getMethod?.("_getLoadedItem") as ((index: number) => T | undefined) | undefined) ?? null;
            }
            layout.rebuild(n, getLoadedItem ?? ((i: number) => ctx.getItems()[i] as T | undefined));
            engineState.totalItems = layout.totalEntries;
            if (stickyHeader) {
              stickyHeader.refresh();
              stickyHeader.update(engineState.scrollPosition);
            }
          }
        }
        origSizeCacheRebuild(layout.totalEntries);
      };

      sizeCache.rebuild(layout.totalEntries);
      rebuildGridPositions();
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
          isX,
          headerH,
        );

        const gridHeaderOffset = gridColumns > 0
          ? (headerLayoutIndex: number): number => {
              const pos = gridItemPositions?.get(headerLayoutIndex);
              return pos ? pos.rowY : sizeCache.getOffset(headerLayoutIndex);
            }
          : undefined;

        stickyHeader = createStickyHeader(
          rootElement,
          layout,
          sizeCache,
          renderInto,
          classPrefix,
          isX,
          0,
          undefined,
          stickyContainer,
          gridHeaderOffset,
        );

        stickyHeader.update(engineState.scrollPosition);

        if (!isX) {
          ctx.dom.viewport.style.height = `calc(100% - ${headerH}px)`;
        } else {
          ctx.dom.viewport.style.width = `calc(100% - ${headerH}px)`;
        }
      }

      // Detect table plugin — if active, delegate rendering to table.
      // Groups provides layout index → item mapping via setGetItemFn.
      const hasTable = !!getMethod?.("_updateTableForGroups");
      tableMode = hasTable;

      if (hasTable) {
        // Deferred: data plugin (priority 20) runs after groups (priority 10)
        // and overwrites getItemFn. Set ours in a microtask after all setups.
        queueMicrotask(() => {
          // Use _getItem (includes placeholders) rather than _getLoadedItem
          // (returns undefined for unloaded items). Placeholders let the
          // table renderer show shimmer rows while data loads.
          const asyncGetItem = (getMethod?.("_getItem") as ((i: number) => T | undefined)) ?? null;
          const rawItems = ctx.getItems.bind(ctx);

          ctx.setGetItemFn((layoutIndex: number): T | undefined => {
            const entry = layout.getEntry(layoutIndex);
            if (entry.type === "header") {
              return {
                id: `__group_header_${entry.group.groupIndex}`,
                __groupHeader: true,
                groupKey: entry.group.key,
                groupIndex: entry.group.groupIndex,
              } as unknown as T;
            }
            return asyncGetItem ? asyncGetItem(entry.dataIndex) : rawItems()[entry.dataIndex];
          });

          // Tell table renderer about group headers
          const tableGroupsFn = getMethod?.("_updateTableForGroups") as ((
            isHeaderFn: (item: T) => boolean,
            ht: (key: string, groupIndex: number) => HTMLElement | string,
          ) => void) | undefined;
          if (tableGroupsFn) {
            tableGroupsFn(
              (item: T) => !!(item as Record<string, unknown>).__groupHeader,
              headerTemplate,
            );
          }
        });
      } else {
        ctx.setRenderFn(groupsRenderIfNeeded, groupsForceRender);
      }

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

      const mainPadEnd = mainAxisPadding - ctx.config.startPadding;
      ctx.registerMethod("_scrollItemIntoView", (layoutIndex: number): void => {
        if (layoutIndex < 0) return;
        const pos = gridItemPositions?.get(layoutIndex);
        const offset = pos ? pos.rowY : sizeCache.getOffset(layoutIndex);
        const size = sizeCache.getSize(layoutIndex);
        const cs = engineState.containerSize;
        const sp = engineState.scrollPosition;

        if (offset < sp) {
          ctx.scrollTo(offset);
        } else if (offset + size + mainPadEnd > sp + cs) {
          ctx.scrollTo(offset + size + mainPadEnd - cs);
        }
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
      onResize(_w: number, _h: number): void {
        if (gridColumns <= 0) return;
        // Grid plugin's onResize runs first (same priority, earlier in array)
        // and updates its internal columnWidth. Now sizeCache sizes will
        // reflect the new column width. Rebuild positions and re-render.
        origSizeCacheRebuild(layout.totalEntries);
        lastCrossSize = engineState.crossSize;
        rebuildGridPositions();
        const totalSize = getGridContentSize();
        contentElement.style[isX ? "width" : "height"] = (totalSize + mainAxisPadding) + "px";
        if (stickyHeader) {
          stickyHeader.refresh();
          stickyHeader.update(engineState.scrollPosition);
        }
        forceNextRender = true;
        groupsRenderIfNeeded();
      },
    },

    destroy(): void {
      if (stickyHeader) {
        stickyHeader.destroy();
        stickyHeader = null;
      }
      rendered.clear();
      placeholderIndices.clear();
      detached.clear();
    },
  };
}
