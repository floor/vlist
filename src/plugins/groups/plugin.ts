/**
 * vlist — Groups Plugin
 *
 * Adds grouped lists with sticky headers.
 * Priority 11 — after layout plugins (grid/masonry/table at 10) so it can
 * wrap the size cache and take over render regardless of array order;
 * before selection (50).
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
import { createScrollPaddingReader } from "../../utils/scroll-padding";

import {
  createGroupLayout,
} from "./layout";

import { createStickyHeader, createStickyContainer } from "./sticky";

import {
  type GroupLayout,
  type StickyHeader as StickyHeaderInstance,
} from "./types";

export interface GroupsPluginConfig<T extends VListItem = VListItem> extends GroupsConfig<T> {}

const itemState: ItemState = { selected: false, focused: false };

/** Methods the groups plugin adds to the list instance. */
export interface GroupsMethods<T extends VListItem = VListItem> {
  /** The current group layout: entries, boundaries and sticky state. */
  getGroupLayout(): GroupLayout<T>;
}

export function groups<T extends VListItem = VListItem>(
  config: GroupsPluginConfig<T>,
): VListPlugin<T, GroupsMethods<T>> {
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

  let layout: GroupLayout<T>;
  let stickyHeader: StickyHeaderInstance | null = null;
  let sizeCache: SizeCache;
  let engineState: EngineState;
  let scroll: PluginContext<T>["scroll"];
  let pool: ElementPool;
  let contentElement: HTMLElement;
  // Bounded-mode (RFC-012): route content sizing through ctx.render.contentSize so
  // the bounded scroll handler keeps vlist-content at the runway size instead of
  // the full virtual height (which would blow the browser's element cap on huge
  // lists). Null until setup; in native mode it just sets the style height.
  let updateContentSize: ((size: number) => void) | null = null;
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
  let isMasonry = false;
  let masonryItemSize: ((dataIndex: number) => number) | null = null;
  // The item accessor as it was before setSizeConfig replaced the cache with a
  // layout-indexed one. Masonry placement needs data-space heights, and reading
  // them back through the replaced cache asks it for a layout entry.
  let dataItemSize: ((dataIndex: number) => number) | null = null;

  const rendered = new Map<number, HTMLElement>();
  // Track which layout indices currently show placeholder content
  const placeholderIndices = new Set<number>();
  // Elements detached during boundary changes, keyed by data-id.
  // Reused in the next render pass to avoid pool round-trip (which clears innerHTML).
  const detached = new Map<string, HTMLElement>();
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  // Bounded mode (RFC-012): item transforms are `offset - baseOffset`. baseOffset
  // shifts when the runway rebases, so on a change every already-rendered item
  // must be repositioned — not just newly added ones. Tracks the last rendered
  // baseOffset to detect that. Stays 0 in native mode (no extra work).
  let lastRenderBaseOffset = 0;
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

    const wasLoaded = lastDataCount > 0;
    lastDataCount = dataCount;
    layout.rebuild(dataCount, getLoadedItem ?? ctxGetItem);
    origSizeCacheRebuild(layout.totalEntries);
    rebuildGridPositions();
    const totalSize = gridItemPositions ? getGridContentSize() : sizeCache.getTotalSize();
    updateContentSize?.(totalSize);
    if (stickyHeader) {
      stickyHeader.refresh();
      stickyHeader.update(scroll.getPixelEquivalent());
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
  let gridItemPositions: Map<number, { col: number; rowY: number; h?: number }> | null = null;
  // Parallel sorted array for O(log n) visible range lookup.
  // Each entry: [layoutIndex, rowY, rowY + itemHeight].
  let gridSorted: Array<[number, number, number]> | null = null;
  // Masonry only: per-group bottom Y (tallest lane). Used by scrollToIndex
  // align:end so the "scroll to last" reaches the true content bottom.
  let masonryGroupBottoms: number[] | null = null;

  function rebuildGridPositions(): void {
    if (gridColumns <= 0) { gridItemPositions = null; gridSorted = null; return; }
    const rawCross = engineState.crossSize || contentElement.clientWidth;
    const containerW = rawCross - gridCrossPadTotal;
    gridColWidth = (containerW - (gridColumns - 1) * gridGap) / gridColumns;
    gridItemPositions = new Map();

    const total = layout.totalEntries;
    const sorted: Array<[number, number, number]> = new Array(total);
    let sortedLen = 0;

    if (isMasonry) {
      // Masonry: shortest-lane placement per group.
      // Item heights come from the raw size spec (not sizeCache, which
      // stores fallback heights without the masonry context).
      // masonryItemSize is only set when the size spec is a function. With a
      // numeric item height it stayed null and this fell back to the size cache
      // — which groups had already replaced with a layout-indexed one, so a data
      // index read a layout entry, and index 0 read the sticky first header at
      // height 0. Every masonry height came back 0.
      const getItemH =
        masonryItemSize ?? dataItemSize ?? ((di: number) => sizeCache.getSize(di));
      const laneSizes = new Float64Array(gridColumns);
      const groupBottoms: number[] = [];
      let groupY = 0;
      let curGroupIdx = -1;

      for (let i = 0; i < total; i++) {
        const entry = layout.getEntry(i);
        if (entry.type === "header") {
          let tallest = 0;
          for (let c = 0; c < gridColumns; c++) {
            if (laneSizes[c]! > tallest) tallest = laneSizes[c]!;
          }
          if (curGroupIdx >= 0) groupBottoms[curGroupIdx] = groupY + tallest;
          groupY += tallest;
          const h = sizeCache.getSize(i);
          gridItemPositions.set(i, { col: -1, rowY: groupY });
          sorted[sortedLen++] = [i, groupY, groupY + h];
          groupY += h;
          laneSizes.fill(0);
          curGroupIdx = entry.group.groupIndex;
        } else {
          let lane = 0;
          let shortest = laneSizes[0]!;
          for (let c = 1; c < gridColumns; c++) {
            if (laneSizes[c]! < shortest) { shortest = laneSizes[c]!; lane = c; }
          }
          const h = getItemH(entry.dataIndex);
          const y = groupY + laneSizes[lane]!;
          gridItemPositions.set(i, { col: lane, rowY: y, h });
          sorted[sortedLen++] = [i, y, y + h];
          laneSizes[lane] = laneSizes[lane]! + h + gridGap;
        }
      }
      // Finalize the last group's bottom
      if (curGroupIdx >= 0) {
        let tallest = 0;
        for (let c = 0; c < gridColumns; c++) {
          if (laneSizes[c]! > tallest) tallest = laneSizes[c]!;
        }
        groupBottoms[curGroupIdx] = groupY + tallest;
      }
      masonryGroupBottoms = groupBottoms;
    } else {
      masonryGroupBottoms = null;
      // Grid: row-based placement per group
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
    }

    sorted.length = sortedLen;
    gridSorted = sorted;
  }

  function getGridContentSize(): number {
    if (!gridItemPositions || gridItemPositions.size === 0) return sizeCache.getTotalSize();
    const total = layout.totalEntries;

    if (isMasonry) {
      // Last group's bottom (tallest lane) is the content bottom — already
      // computed during rebuild. Fall back to the header bottom for an
      // empty trailing group.
      const lastBottom = masonryGroupBottoms?.[masonryGroupBottoms.length - 1];
      return lastBottom ?? 0;
    }

    // Grid: rows are aligned, last item bottom = content bottom.
    let maxY = 0;
    for (let i = total - 1; i >= 0; i--) {
      const pos = gridItemPositions.get(i);
      if (pos) { maxY = pos.rowY + (pos.h ?? sizeCache.getSize(i)); break; }
      const entry = layout.getEntry(i);
      if (entry.type === "header") { maxY = sizeCache.getOffset(i) + sizeCache.getSize(i); break; }
    }
    return maxY;
  }

  function buildTransform(layoutIndex: number, base: number): string {
    // RFC-012: subtract baseOffset so absolute virtual offsets map into the
    // bounded runway. baseOffset is 0 in native mode (byte-identical).
    if (gridItemPositions) {
      const pos = gridItemPositions.get(layoutIndex);
      if (pos) {
        const x = pos.col < 0 ? 0 : gridCrossPadStart + pos.col * (gridColWidth + gridGap);
        const y = pos.rowY - base;
        if (isX) return `translate(${Math.round(y)}px, ${Math.round(x)}px)`;
        return `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    }

    const offset = sizeCache.getOffset(layoutIndex) - base;
    if (isX) {
      return `translate(${Math.round(offset)}px, 0)`;
    }
    return `translate(0, ${Math.round(offset)}px)`;
  }

  function applySizeStyles(element: HTMLElement, layoutIndex: number): void {
    const pos = gridItemPositions?.get(layoutIndex);
    if (pos) {
      const size = pos.h ?? sizeCache.getSize(layoutIndex);
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
    const fallbackSize = sizeCache.getSize(layoutIndex);
    if (isX) {
      element.style.width = `${fallbackSize}px`;
    } else {
      element.style.height = `${fallbackSize}px`;
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
    // Listbox semantics, resolved on the render path: groups sets up at
    // priority 11, before a11y (55) and selection (50), so this cannot be
    // read during setup.
    //
    // Both a11y() and selection() call ctx.dom.enableListbox(), which marks
    // the content element. `_getSelectedIds` is only published by selection(),
    // so keying on it dropped listbox semantics for an a11y()-only list.
    if (interactive === null) {
      interactive = contentElement.getAttribute("role") === "listbox";
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

      if (isX && stickyHeader && entry.group.groupIndex === 0) {
        element.style.display = "none";
      } else {
        element.style.display = "";
        const content = headerTemplate(entry.group.key, entry.group.groupIndex);
        if (typeof content === "string") {
          element.innerHTML = content;
        } else {
          element.innerHTML = "";
          element.appendChild(content);
        }
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

    const isPlaceholder = (item as { _isPlaceholder?: boolean })._isPlaceholder === true;
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
    updateContentSize?.(totalSize);
    if (stickyHeader) {
      stickyHeader.refresh();
      stickyHeader.update(scroll.getPixelEquivalent());
    }
    forceNextRender = true;
  }

  function groupsRenderIfNeeded(): void {
    if (engineState.destroyed) return;

    syncLayoutIfNeeded();
    syncGridIfResized();

    const scrollPos = scroll.getPixelEquivalent();
    const cs = engineState.containerSize;
    const baseOffset = scroll.getRenderOrigin();
    const baseChanged = baseOffset !== lastRenderBaseOffset;

    if (!forceNextRender && scrollPos === lastScrollPosition && cs === lastContainerSize && !baseChanged) {
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

    if (renderStart === engineState.prevRangeStart && renderEnd === engineState.prevRangeEnd && !engineState.renderPending && !baseChanged) {
      return;
    }
    lastRenderBaseOffset = baseOffset;

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
          if (item && (item as { _isPlaceholder?: boolean })._isPlaceholder !== true) {
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
        element.style.transform = buildTransform(i, baseOffset);

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
          element.style.transform = buildTransform(i, baseOffset);
        } else if (baseChanged) {
          // Bounded mode (RFC-012): the runway rebased, so reposition the item
          // at its new offset - baseOffset (native mode never reaches here).
          element.style.transform = buildTransform(i, baseOffset);
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
    updateContentSize?.(totalSize);

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

    // When async data arrives, group boundaries may change. But forceRender is
    // also called at frame rate by animating plugins, so we must NOT run the
    // expensive layout.rebuild on every call. O(1) check: compare the loaded
    // item count — it only changes when the data plugin delivers new items.
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
        updateContentSize?.(totalSize);
        if (stickyHeader) {
          stickyHeader.refresh();
          stickyHeader.update(scroll.getPixelEquivalent());
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
    priority: 11,

    setup(ctx: PluginContext<T>): void {
      scroll = ctx.scroll;
      sizeCache = ctx.sizes.cache;
      engineState = ctx.getState();
      pool = ctx.pool;
      contentElement = ctx.dom.content;
      updateContentSize = ctx.render.contentSize.bind(ctx);
      rootElement = ctx.dom.root;
      userTemplate = ctx.template;
      isX = ctx.config.axis.primary === "x";
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      mainAxisPadding = ctx.config.mainAxisPadding;
      ctxGetItem = ctx.items.at.bind(ctx);
      resolveItemState = () => ctx.render.getStateFn();
      getMethod = ctx.hooks.get.bind(ctx);
      interactive = null;
      groupItemClass = `${classPrefix}-item`;
      groupHeaderClass = `${classPrefix}-group-header`;

      // Resolve raw storage accessor (async plugin) — returns undefined for
      // unloaded items without generating placeholder objects. Used in
      // buildGroups to skip unloaded items efficiently.
      // Layout plugins publish getGridLayout / getMasonryLayout at priority 10.
      // Groups is 11 so this read sees them even when the caller listed
      // groups first — wrapping the size cache and replacing render has to
      // happen after those plugins, or they overwrite both and headers vanish.
      const gridLayoutFn = getMethod?.("getGridLayout") as (() => { columns: number; gap: number }) | undefined;
      const masonryLayoutFn = getMethod?.("getMasonryLayout") as (() => { columns: number; gap: number; containerSize: number }) | undefined;
      if (gridLayoutFn) {
        const gl = gridLayoutFn();
        gridColumns = gl.columns;
        gridGap = gl.gap;
        gridCrossPadStart = ctx.config.crossPadStart;
        gridCrossPadTotal = ctx.config.crossAxisPadding;
      } else if (masonryLayoutFn) {
        const ml = masonryLayoutFn();
        gridColumns = ml.columns;
        gridGap = ml.gap;
        gridCrossPadStart = ctx.config.crossPadStart;
        gridCrossPadTotal = ctx.config.crossAxisPadding;
        isMasonry = true;
        const rawSpec = ctx.sizes.rawSpec;
        if (typeof rawSpec === "function") {
          masonryItemSize = (dataIndex: number) => {
            return rawSpec(dataIndex, { columnWidth: gridColWidth });
          };
        }
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
      dataItemSize = origGetSize;

      const groupedSizeFn = (layoutIndex: number): number => {
        const entry = layout.getEntry(layoutIndex);
        if (entry.type === "header") {
          if (config.sticky !== false && entry.group.groupIndex === 0) return 0;
          return getHeaderHeight(entry.group.groupIndex);
        }
        return origGetSize(entry.dataIndex);
      };

      // Data entries carry the gap the core spec baked in; headers do not. The
      // total must still drop the one trailing gap, which replacing the config
      // used to discard along with core's wrapper.
      ctx.sizes.setConfig(groupedSizeFn, ctx.config.gap);

      // Intercept sizeCache.rebuild so groups can map between data indices
      // and layout indices (which include group header pseudo-entries).
      let tableMode = false;
      let lastTableLoadedCount = -1;
      ctx.hooks.method("_setSizeCacheBase", (fn: (n: number) => void): void => {
        origSizeCacheRebuild = fn;
      });

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
            layout.rebuild(n, getLoadedItem ?? ((i: number) => ctx.items.all()[i] as T | undefined));
            engineState.totalItems = layout.totalEntries;
            if (stickyHeader) {
              stickyHeader.refresh();
              stickyHeader.update(scroll.getPixelEquivalent());
            }
          }
        }
        origSizeCacheRebuild(layout.totalEntries);
      };

      sizeCache.rebuild(layout.totalEntries);
      rebuildGridPositions();
      // The public list.total is the consumer-facing count, not the engine's
      // render count: engineState.totalItems carries the layout entries, and
      // carousel states the same split in its own setup. Reporting entries here
      // counted the group headers as items, so a grouped list of ten reported
      // twelve and getItemAt(10) and (11) came back undefined. This is the same
      // number _getTotal already publishes.
      ctx.items.setTotalFn(() => layout.totalEntries - layout.groupCount);

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
          stickyContainer,
          gridHeaderOffset,
        );

        stickyHeader.update(scroll.getPixelEquivalent());

        if (!isX) {
          // Vertical: relative container occupies a top row via block flow;
          // shrinking the viewport height lets it sit below.
          ctx.dom.viewport.style.height = `calc(100% - ${headerH}px)`;
        } else {
          // Horizontal: absolute container is a left-edge bar (out of flow);
          // shift the viewport right so it sits beside, not under, the bar.
          ctx.dom.viewport.style.width = `calc(100% - ${headerH}px)`;
          ctx.dom.viewport.style.marginLeft = `${headerH}px`;
        }
      }

      // Detect table plugin — if active, delegate rendering to table.
      // Groups provides layout index → item mapping via setGetItemFn.
      const hasTable = !!getMethod?.("_updateTableForGroups");
      tableMode = hasTable;

      if (hasTable) {
        // Deferred: data plugin (priority 20) runs after groups (priority 11)
        // and overwrites getItemFn. Table (priority 10) has already registered
        // _updateTableForGroups and called setSizeConfig; this microtask wires
        // the layout-index accessor after data has claimed getItemFn.
        queueMicrotask(() => {
          // Use _getItem (includes placeholders) rather than _getLoadedItem
          // (returns undefined for unloaded items). Placeholders let the
          // table renderer show shimmer rows while data loads.
          const asyncGetItem = (getMethod?.("_getItem") as ((i: number) => T | undefined)) ?? null;
          const rawItems = ctx.items.all.bind(ctx);

          const getItemAtLayout = (layoutIndex: number): T | undefined => {
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
          };
          ctx.items.setGetFn(getItemAtLayout);

          // In table mode this replaces the core item accessor with a layout-aware
          // one. Core resolves a click through the layout index but reports the
          // documented data index, so it needs a way to ask for an item by layout
          // index; without it, it falls back to getItemFn with a data index and
          // lands one header early — the first row of a group reports its header.
          ctx.hooks.method("_getItemAtLayout", getItemAtLayout);

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

          // The first render can land before this microtask, leaving rows whose
          // data-index is a data index and no header rows at all, while core
          // resolves clicks through the layout index space — so a click on the
          // first row of a group mapped to -1 and was dropped, permanently,
          // because nothing re-rendered afterwards.
          ctx.render.force();
        });
      } else {
        ctx.render.setFn(groupsRenderIfNeeded, groupsForceRender);
      }

      ctx.hooks.method("getGroupLayout", () => layout);

      // The engine total counts headers, because that is what the layout
      // renders. Anything asking how many *items* there are needs this
      // instead — selection's "is everything selected?" test compared a set
      // of item ids against entries and never matched. data() publishes the
      // same hook, and wins when both are present, which is correct: then the
      // data manager knows the real count.
      ctx.hooks.method("_getTotal", (): number => layout.totalEntries - layout.groupCount);

      ctx.hooks.method("_dataToLayoutIndex", (dataIndex: number): number =>
        layout.dataToLayoutIndex(dataIndex),
      );
      ctx.hooks.method("_layoutToDataIndex", (layoutIndex: number): number =>
        layout.layoutToDataIndex(layoutIndex),
      );
      ctx.hooks.method("_getRenderedElement", (layoutIndex: number): HTMLElement | null =>
        rendered.get(layoutIndex) ?? null,
      );
      ctx.hooks.method("_isGroupHeader", (layoutIndex: number): boolean => {
        const entry = layout.getEntry(layoutIndex);
        return entry.type === "header";
      });
      ctx.hooks.method("_getItemLane", (layoutIndex: number): number => {
        const pos = gridItemPositions?.get(layoutIndex);
        return pos ? pos.col : -1;
      });
      ctx.hooks.method("_getItemY", (layoutIndex: number): number => {
        const pos = gridItemPositions?.get(layoutIndex);
        return pos ? pos.rowY : -1;
      });
      ctx.hooks.method("_getItemH", (layoutIndex: number): number => {
        const pos = gridItemPositions?.get(layoutIndex);
        return pos?.h ?? -1;
      });

      const mainPadStart = ctx.config.startPadding;
      const mainPadEnd = mainAxisPadding - mainPadStart;

      // page() keeps a band of the window clear at each end. This hook and the
      // scrollToIndex one below replace page's, so they fold the band in;
      // without page it reads zero and the geometry is unchanged.
      const readScrollPadding = createScrollPaddingReader(ctx);

      ctx.hooks.method("_scrollItemIntoView", (layoutIndex: number): void => {
        if (layoutIndex < 0) return;
        const pos = gridItemPositions?.get(layoutIndex);
        const offset = pos ? pos.rowY : sizeCache.getOffset(layoutIndex);
        const size = pos?.h ?? sizeCache.getSize(layoutIndex);
        const cs = engineState.containerSize;
        const sp = scroll.getPixelEquivalent();
        const pagePad = readScrollPadding();
        const padStart = mainPadStart + pagePad.start;
        const padEnd = mainPadEnd + pagePad.end;
        // page() scrolls the window, so the list may legitimately sit below the
        // viewport top by the start band. Without page the floor stays 0.
        const minPos = pagePad.start > 0 ? -pagePad.start : 0;

        if (offset < sp + padStart) {
          ctx.scroll.to(Math.max(minPos, offset - padStart));
        } else if (offset + size + padEnd > sp + cs) {
          ctx.scroll.to(offset + size + padEnd - cs);
        }
      });

      // Core owns the public method: it holds a scroll requested before the
      // total is known, clamps the index and resolves the options, then calls
      // this hook. Returning false falls back to the core implementation.
      ctx.scroll.setToIndexFn((
        index: number,
        align: string,
        behavior?: string,
        duration?: number,
      ): void | false => {
        const layoutIndex = layout.dataToLayoutIndex(index);
        const totalLayout = layout.totalEntries;
        if (totalLayout === 0) return false;
        const clamped = Math.max(0, Math.min(layoutIndex, totalLayout - 1));
        const cs = engineState.containerSize;

        // Grid/masonry: use grid-aware Y positions and content size.
        // sizeCache offsets are per-item (wrong for column layouts).
        const gridPos = gridItemPositions?.get(clamped);
        const offset = gridPos ? gridPos.rowY : sizeCache.getOffset(clamped);
        const itemSize = gridPos
          ? (gridPos.h ?? sizeCache.getSize(clamped))
          : sizeCache.getSize(clamped);
        const totalSize = gridItemPositions
          ? getGridContentSize() + mainAxisPadding
          : sizeCache.getTotalSize();
        const maxScroll = Math.max(0, totalSize - cs);


        // Bottom padding to keep clear when aligning the last item to the end.
        const pagePad = readScrollPadding();
        const endPad = (gridItemPositions ? mainAxisPadding : 0) + pagePad.end;

        // Masonry: align:end targets the group's tallest-lane bottom, not the
        // target item's own bottom (which may be in a shorter lane). This lets
        // "scroll to last" reach the true content bottom.
        let endBottom = offset + itemSize;
        if (isMasonry && masonryGroupBottoms) {
          const gi = layout.getEntry(clamped).group.groupIndex;
          const gb = masonryGroupBottoms[gi];
          if (gb !== undefined) endBottom = gb;
        }

        let pos: number;
        switch (align) {
          case "center":
            pos = offset - pagePad.start - (cs - pagePad.start - pagePad.end - itemSize) / 2;
            break;
          case "end":
            pos = endBottom - cs + endPad;
            break;
          default:
            pos = offset - pagePad.start;
        }
        const minPos = pagePad.start > 0 ? -pagePad.start : 0;
        pos = Math.max(minPos, Math.min(pos, maxScroll + pagePad.end));

        if (behavior === "smooth" && duration && duration > 0) {
          ctx.scroll.smoothTo(pos, duration);
        } else {
          ctx.scroll.to(pos);
        }
      });

      ctx.hooks.onDestroy(() => {
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
        // Grid plugin's onResize runs first (priority 10, before groups at 11)
        // and updates its internal columnWidth. Now sizeCache sizes will
        // reflect the new column width. Rebuild positions and re-render.
        origSizeCacheRebuild(layout.totalEntries);
        lastCrossSize = engineState.crossSize;
        rebuildGridPositions();
        const totalSize = getGridContentSize();
        updateContentSize?.(totalSize);
        if (stickyHeader) {
          stickyHeader.refresh();
          stickyHeader.update(scroll.getPixelEquivalent());
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
