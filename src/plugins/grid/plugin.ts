/**
 * vlist v2 — Grid Plugin
 *
 * Switches from list layout to a 2D grid with configurable columns and gap.
 * Priority 10 — runs before selection (50) so layout is ready for other plugins.
 *
 * Architecture:
 * - Replaces the default 1D render pipeline with a grid-aware render
 * - Size cache operates in ROW space (each row has height = itemHeight + gap)
 * - Visible range is calculated in row space, then expanded to flat item indices
 * - Items are positioned with translate(colOffset, rowOffset)
 *
 * Restrictions:
 * - Cannot be combined with masonry or table plugins
 */

import type { VListItem, ItemTemplate, ItemState } from "../../types";
import type { VListPlugin, PluginContext, ElementPool } from "../../core/types";
import type { SizeCache } from "../../core/sizes";
import type { EngineState } from "../../core/state";
import { createGridLayout } from "./layout";
import type { GridLayout } from "./types";
type ItemStateFn = (index: number, state: ItemState) => void;

// =============================================================================
// Config
// =============================================================================

export interface GridPluginConfig {
  columns: number;
  gap?: number;
}

// =============================================================================
// Reusable state singleton — no allocation per frame
// =============================================================================

const itemState: ItemState = { selected: false, focused: false };

// =============================================================================
// Factory
// =============================================================================

export function grid<T extends VListItem = VListItem>(
  config: GridPluginConfig,
): VListPlugin<T> {
  if (!config.columns || config.columns < 1) {
    throw new Error("[vlist] grid: columns must be >= 1");
  }

  let layout: GridLayout;
  let sizeCache: SizeCache;
  let engineState: EngineState;
  let pool: ElementPool;
  let contentElement: HTMLElement;
  let template: ItemTemplate<T>;
  let getItem: (index: number) => T | undefined;
  let isX: boolean;
  let classPrefix: string;
  let overscan: number;
  let resolveItemState: (() => ItemStateFn | null) | null = null;

  let crossPadStart = 0;
  let crossPadTotal = 0;
  let mainPadStart = 0;
  let mainPadTotal = 0;

  interface TrackedElement { el: HTMLElement; lastItem: unknown; }
  const rendered = new Map<number, TrackedElement>();
  let containerWidth = 0;

  // Cached layout values — recomputed only on resize/config change, never per frame
  let columns = 0;
  let gap = 0;
  let columnWidth = 0;
  let isf: ItemStateFn | null = null;
  let isfResolved = false;

  // Hoisted class strings — built once in setup, not per frame
  let gridItemClass = "";
  let selClass = "";
  let focClass = "";

  // Mutable range objects — reused across frames
  const itemRange = { start: 0, end: -1 };
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let forceNextRender = true;
  let rebuildAsRows: (rowCount: number) => void = (n) => sizeCache.rebuild(n);

  // Recompute the cached column width — call on resize/config change.
  function recomputeColumnWidth(): void {
    const totalGap = (columns - 1) * gap;
    columnWidth = Math.max(0, (containerWidth - totalGap) / columns);
  }

  // Resolve the selection state fn once. Selection (priority 50) sets it
  // during setup, before grid's first render (priority 10 setup + rAF render).
  function resolveItemStateFn(): void {
    if (isfResolved) return;
    isfResolved = true;
    isf = resolveItemState?.() ?? null;
  }

  function getRowCount(): number {
    return layout.getTotalRows(engineState.totalItems);
  }

  function buildTransform(itemIndex: number): string {
    const row = (itemIndex / columns) | 0;
    const col = itemIndex - row * columns;
    const x = col * (columnWidth + gap) + crossPadStart;
    const y = sizeCache.getOffset(row) + mainPadStart;
    if (isX) {
      return `translate(${Math.round(y)}px, ${Math.round(x)}px)`;
    }
    return `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function applySizeStyles(element: HTMLElement, row: number): void {
    const rowHeight = sizeCache.getSize(row) - gap;
    if (isX) {
      element.style.width = `${rowHeight}px`;
      element.style.height = `${columnWidth}px`;
    } else {
      element.style.width = `${columnWidth}px`;
      element.style.height = `${rowHeight}px`;
    }
  }

  function applyTemplate(el: HTMLElement, item: T, index: number): void {
    if (isf) isf(index, itemState);
    else { itemState.selected = false; itemState.focused = false; }
    const result = template(item, index, itemState);
    if (typeof result === "string") {
      el.innerHTML = result;
    } else {
      el.innerHTML = "";
      el.appendChild(result);
    }
  }

  function gridRenderIfNeeded(): void {
    if (engineState.destroyed) return;

    const scrollPos = engineState.scrollPosition;
    const cs = engineState.containerSize;

    if (!forceNextRender && scrollPos === lastScrollPosition && cs === lastContainerSize) {
      return;
    }
    lastScrollPosition = scrollPos;
    lastContainerSize = cs;
    forceNextRender = false;

    const totalRows = getRowCount();
    if (cs <= 0 || totalRows === 0) return;

    // Visible row range
    resolveItemStateFn();
    let visStart = sizeCache.indexAtOffset(scrollPos);
    let visEnd = sizeCache.indexAtOffset(scrollPos + cs);
    if (visEnd < totalRows - 1) visEnd++;
    visStart = Math.max(0, visStart);
    visEnd = Math.min(totalRows - 1, Math.max(0, visEnd));
    const renderStart = Math.max(0, visStart - overscan);
    const renderEnd = Math.min(totalRows - 1, visEnd + overscan);

    // Range-unchanged fast path
    if (renderStart === engineState.prevRangeStart && renderEnd === engineState.prevRangeEnd && !engineState.renderPending) {
      return;
    }

    // Convert row range → flat item range (reuse object, no per-frame alloc)
    layout.fillItemRange(renderStart, renderEnd, engineState.totalItems, itemRange);
    const rangeStart = itemRange.start;
    const rangeEnd = itemRange.end;

    // Release items outside the new range
    for (const [idx, tracked] of rendered) {
      if (idx < rangeStart || idx > rangeEnd) {
        tracked.el.remove();
        pool.release(tracked.el);
        rendered.delete(idx);
      }
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      const item = getItem(i);
      if (!item) continue;

      // Row/col computed once — grid path has no group headers, so the
      // mapping is the simple sequential floor/mod.
      const row = (i / columns) | 0;
      const col = i - row * columns;

      let tracked = rendered.get(i);

      if (tracked === undefined) {
        const el = pool.acquire();
        el.className = gridItemClass;
        el.setAttribute("data-index", String(i));
        el.setAttribute("data-id", String(item.id));
        applyTemplate(el, item, i);
        tracked = { el, lastItem: item };
        rendered.set(i, tracked);
        contentElement.appendChild(el);
      } else if (tracked.lastItem !== item) {
        tracked.el.setAttribute("data-id", String(item.id));
        tracked.lastItem = item;
        applyTemplate(tracked.el, item, i);
      } else if (isf) {
        // Existing element, same item — refresh selection state only.
        isf(i, itemState);
      }

      if (isf) {
        // itemState was populated by applyTemplate or the refresh above.
        tracked.el.classList.toggle(selClass, itemState.selected);
        tracked.el.classList.toggle(focClass, itemState.focused);
        if (itemState.selected) tracked.el.setAttribute("aria-selected", "true");
        else tracked.el.removeAttribute("aria-selected");
      }

      applySizeStyles(tracked.el, row);

      const x = col * (columnWidth + gap) + crossPadStart;
      const y = sizeCache.getOffset(row) + mainPadStart;
      tracked.el.style.transform = isX
        ? `translate(${Math.round(y)}px, ${Math.round(x)}px)`
        : `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    const totalSize = sizeCache.getTotalSize() + mainPadTotal;
    contentElement.style[isX ? "width" : "height"] = totalSize + "px";
    engineState.totalSize = totalSize;

    // Update engine state for other hooks/plugins
    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    engineState.renderPending = false;

    // Fill EngineState buffers for plugins that read them
    const count = rangeEnd - rangeStart + 1;
    engineState.visibleCount = Math.min(count, engineState.capacity);
    engineState.startIndex = rangeStart;
    for (let i = 0; i < engineState.visibleCount; i++) {
      const idx = rangeStart + i;
      const row = (idx / columns) | 0;
      engineState.visibleIndices[i] = idx;
      engineState.visibleOffsets[i] = sizeCache.getOffset(row);
      engineState.visibleSizes[i] = sizeCache.getSize(row);
    }
  }

  function gridForceRender(): void {
    if (engineState.destroyed) return;
    rebuildAsRows(getRowCount());
    engineState.prevRangeStart = -1;
    engineState.prevRangeEnd = -1;
    engineState.renderPending = true;
    forceNextRender = true;
    gridRenderIfNeeded();
  }

  return {
    name: "grid",
    priority: 10,
    conflicts: ["masonry", "table"],

    setup(ctx: PluginContext<T>): void {
      columns = Math.max(1, Math.floor(config.columns));
      gap = config.gap ?? 0;

      layout = createGridLayout({ columns: config.columns, gap });
      sizeCache = ctx.sizeCache;
      engineState = ctx.getState();
      pool = ctx.pool;
      contentElement = ctx.dom.content;
      template = ctx.template;
      isX = ctx.config.axis.primary === "x";
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      getItem = ctx.getItem.bind(ctx);
      resolveItemState = () => ctx.getItemStateFn();

      // Hoist class strings — built once, reused every frame
      gridItemClass = `${classPrefix}-item ${classPrefix}-grid-item`;
      selClass = `${classPrefix}-item--selected`;
      focClass = `${classPrefix}-item--focused`;

      // Padding offsets for item positioning
      crossPadStart = ctx.config.crossPadStart;
      crossPadTotal = ctx.config.crossAxisPadding;
      mainPadStart = ctx.config.startPadding;
      mainPadTotal = ctx.config.mainAxisPadding;

      // Initialize container width (subtract cross-axis padding)
      containerWidth = engineState.crossSize - crossPadTotal;
      recomputeColumnWidth();

      // Size cache in ROW space: each row = itemHeight + gap
      // Inject grid context into dynamic height functions
      const rawSpec = ctx.rawSizeSpec;
      let baseRowSize: number;
      if (typeof rawSpec === "function") {
        const colWidth = layout.getColumnWidth(containerWidth);
        const gridCtx = { columnWidth: colWidth, columns: config.columns, gap };
        baseRowSize = (rawSpec as Function)(0, gridCtx);
        ctx.setSizeConfig((rowIndex: number): number => {
          gridCtx.columnWidth = layout.getColumnWidth(containerWidth);
          const firstItem = rowIndex * config.columns;
          return (rawSpec as Function)(firstItem, gridCtx) + gap;
        });
      } else {
        baseRowSize = rawSpec;
        if (gap > 0) {
          ctx.setSizeConfig(baseRowSize + gap);
        }
      }

      // Size cache must have rowCount entries, not totalItems.
      // Hook sizeCache.rebuild so that when the data plugin calls
      // rebuild(itemCount), it's converted to rebuild(rowCount).
      // Without this, data's onDataChange/onItemsLoaded overwrites
      // the row-based total with the raw item count.
      // Hook sizeCache.rebuild to convert item count → row count.
      // Must be re-installed after every setSizeConfig call (which
      // Object.assigns a new cache, destroying the hook).
      let currentHook: ((n: number) => void) | null = null;
      let baseRebuild: (n: number) => void = sizeCache.rebuild;
      function installRebuildHook(): void {
        if (sizeCache.rebuild === currentHook) return;
        baseRebuild = sizeCache.rebuild;
        rebuildAsRows = (rowCount: number): void => baseRebuild(rowCount);
        currentHook = (n: number): void => {
          rebuildAsRows(Math.ceil(n / columns));
        };
        sizeCache.rebuild = currentHook;
      }

      ctx.registerMethod("_setSizeCacheBase", (fn: (n: number) => void): void => {
        baseRebuild = fn;
        rebuildAsRows = (rowCount: number): void => baseRebuild(rowCount);
      });

      installRebuildHook();
      rebuildAsRows(getRowCount());

      // Fix trailing gap: last row's cached size includes gap that
      // shouldn't add empty space at the bottom.
      if (gap > 0) {
        const origGetTotalSize = sizeCache.getTotalSize;
        sizeCache.getTotalSize = (): number => {
          const t = origGetTotalSize();
          return t > 0 ? t - gap : 0;
        };
      }

      // Virtual total = row count (not item count)
      ctx.setVirtualTotalFn(() => getRowCount());

      // Add CSS class
      ctx.dom.root.classList.add(`${classPrefix}--grid`);

      // Replace render pipeline
      ctx.setRenderFn(gridRenderIfNeeded, gridForceRender);

      // ── Public methods ─────────────────────────────────────────

      ctx.registerMethod("getGridLayout", () => layout);
      ctx.registerMethod("_getRowGap", () => layout.gap);

      ctx.registerMethod("updateGrid", (newConfig: Partial<GridPluginConfig>) => {
        if (newConfig.columns !== undefined) {
          if (!Number.isInteger(newConfig.columns) || newConfig.columns < 1) {
            throw new Error("[vlist] updateGrid: columns must be >= 1");
          }
        }
        if (newConfig.gap !== undefined && newConfig.gap < 0) {
          throw new Error("[vlist] updateGrid: gap must be >= 0");
        }

        layout.update(newConfig);
        if (newConfig.columns !== undefined) columns = Math.max(1, Math.floor(newConfig.columns));
        if (newConfig.gap !== undefined) gap = newConfig.gap;

        if (newConfig.gap !== undefined || newConfig.columns !== undefined) {
          const newGap = layout.gap;
          if (typeof rawSpec === "function") {
            const gridCtx = { columnWidth: layout.getColumnWidth(containerWidth), columns: layout.columns, gap: newGap };
            ctx.setSizeConfig((rowIndex: number): number => {
              gridCtx.columnWidth = layout.getColumnWidth(containerWidth);
              const firstItem = rowIndex * layout.columns;
              return (rawSpec as Function)(firstItem, gridCtx) + newGap;
            });
          } else {
            ctx.setSizeConfig(baseRowSize + newGap);
          }
          installRebuildHook();
          rebuildAsRows(getRowCount());
        }

        if (newConfig.columns !== undefined) {
          ctx.setNavConfig({ ud: layout.columns });
        }

        containerWidth = engineState.crossSize - crossPadTotal;
        recomputeColumnWidth();
        gridForceRender();
      });

      // Override scrollToIndex: item index → row index
      ctx.registerMethod("scrollToIndex", (
        index: number,
        alignOrOptions: "start" | "center" | "end" | { align?: "start" | "center" | "end"; behavior?: "auto" | "smooth"; duration?: number } = "start",
      ) => {
        const rowIndex = layout.getRow(index);
        const totalRows = getRowCount();
        if (totalRows === 0) return;
        const safeRow = Math.max(0, Math.min(rowIndex, totalRows - 1));
        const offset = sizeCache.getOffset(safeRow) + mainPadStart;
        const rowHeight = sizeCache.getSize(safeRow);
        const cs = engineState.containerSize;
        const totalSize = sizeCache.getTotalSize() + mainPadTotal;
        const maxScroll = Math.max(0, totalSize - cs);

        const align = typeof alignOrOptions === "string" ? alignOrOptions : (alignOrOptions.align ?? "start");
        const behavior = typeof alignOrOptions === "object" ? alignOrOptions.behavior : undefined;
        const duration = typeof alignOrOptions === "object" ? alignOrOptions.duration : undefined;

        let pos: number;
        switch (align) {
          case "center":
            pos = offset - (cs - rowHeight) / 2;
            break;
          case "end":
            pos = offset - cs + rowHeight;
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

      // ── 2D keyboard navigation ─────────────────────────────────

      ctx.setNavConfig({
        total: () => engineState.totalItems,
        ud: config.columns,
        lr: 1,
        scrollIndex: (itemIndex: number) => layout.getRow(itemIndex),
      });

      // ── Cleanup ────────────────────────────────────────────────

      ctx.registerDestroyHandler(() => {
        for (const [, tracked] of rendered) {
          tracked.el.remove();
        }
        rendered.clear();
        ctx.dom.root.classList.remove(`${classPrefix}--grid`);
      });
    },

    hooks: {
      onResize(_width: number, _height: number): void {
        const newCross = engineState.crossSize - crossPadTotal;
        if (Math.abs(newCross - containerWidth) < 1) return;
        containerWidth = newCross;
        recomputeColumnWidth();

        for (const [index, tracked] of rendered) {
          const row = (index / columns) | 0;
          applySizeStyles(tracked.el, row);
          tracked.el.style.transform = buildTransform(index);
        }
      },
    },

    destroy(): void {
      rendered.clear();
    },
  };
}
