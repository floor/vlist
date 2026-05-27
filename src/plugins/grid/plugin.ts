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
  let horizontal: boolean;
  let classPrefix: string;
  let overscan: number;
  let resolveItemState: (() => ItemStateFn | null) | null = null;

  interface TrackedElement { el: HTMLElement; lastId: string | number; }
  const rendered = new Map<number, TrackedElement>();
  let containerWidth = 0;

  // Mutable range objects — reused across frames
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let forceNextRender = true;

  function getRowCount(): number {
    return layout.getTotalRows(engineState.totalItems);
  }

  function buildTransform(itemIndex: number): string {
    const row = layout.getRow(itemIndex);
    const col = layout.getCol(itemIndex);
    const x = layout.getColumnOffset(col, containerWidth);
    const y = sizeCache.getOffset(row);
    if (horizontal) {
      return `translate(${Math.round(y)}px, ${Math.round(x)}px)`;
    }
    return `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function applySizeStyles(element: HTMLElement, itemIndex: number): void {
    const row = layout.getRow(itemIndex);
    const colWidth = layout.getColumnWidth(containerWidth);
    const rowHeight = sizeCache.getSize(row) - layout.gap;
    if (horizontal) {
      element.style.width = `${rowHeight}px`;
      element.style.height = `${colWidth}px`;
    } else {
      element.style.width = `${colWidth}px`;
      element.style.height = `${rowHeight}px`;
    }
  }

  function applyTemplate(el: HTMLElement, item: T, index: number, isf: ItemStateFn | null): void {
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
    let visStart = sizeCache.indexAtOffset(scrollPos);
    let visEnd = sizeCache.indexAtOffset(scrollPos + cs);
    if (visEnd < totalRows - 1) visEnd++;
    visStart = Math.max(0, visStart);
    visEnd = Math.min(totalRows - 1, Math.max(0, visEnd));

    // Overscan in row space
    const renderStart = Math.max(0, visStart - overscan);
    const renderEnd = Math.min(totalRows - 1, visEnd + overscan);

    // Range-unchanged fast path
    if (renderStart === engineState.prevRangeStart && renderEnd === engineState.prevRangeEnd && !engineState.renderPending) {
      return;
    }

    // Convert row range → flat item range
    const itemRange = layout.getItemRange(renderStart, renderEnd, engineState.totalItems);

    // Release items outside the new range
    rendered.forEach((tracked, idx) => {
      if (idx < itemRange.start || idx > itemRange.end) {
        tracked.el.remove();
        pool.release(tracked.el);
        rendered.delete(idx);
      }
    });

    // Render items in range
    const gridItemClass = `${classPrefix}-item ${classPrefix}-grid-item`;
    const isf = resolveItemState?.() ?? null;
    const selClass = isf ? `${classPrefix}-item--selected` : "";
    const focClass = isf ? `${classPrefix}-item--focused` : "";

    for (let i = itemRange.start; i <= itemRange.end; i++) {
      const item = getItem(i);
      if (!item) continue;

      let tracked = rendered.get(i);

      if (tracked === undefined) {
        const el = pool.acquire();
        el.className = gridItemClass;
        el.setAttribute("data-index", String(i));
        el.setAttribute("data-id", String(item.id));
        applyTemplate(el, item, i, isf);
        tracked = { el, lastId: item.id };
        rendered.set(i, tracked);
        contentElement.appendChild(el);
      } else if (tracked.lastId !== item.id) {
        tracked.el.setAttribute("data-id", String(item.id));
        tracked.lastId = item.id;
        applyTemplate(tracked.el, item, i, isf);
      }

      if (isf) {
        isf(i, itemState);
        tracked.el.classList.toggle(selClass, itemState.selected);
        tracked.el.classList.toggle(focClass, itemState.focused);
        if (itemState.selected) tracked.el.setAttribute("aria-selected", "true");
        else tracked.el.removeAttribute("aria-selected");
      }

      applySizeStyles(tracked.el, i);
      tracked.el.style.transform = buildTransform(i);
    }

    // Update content size for scrollbar
    const totalSize = sizeCache.getTotalSize();
    contentElement.style[horizontal ? "width" : "height"] = totalSize + "px";

    // Update engine state for other hooks/plugins
    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    engineState.renderPending = false;

    // Fill EngineState buffers for plugins that read them
    const count = itemRange.end - itemRange.start + 1;
    engineState.visibleCount = Math.min(count, engineState.capacity);
    engineState.startIndex = itemRange.start;
    for (let i = 0; i < engineState.visibleCount; i++) {
      const idx = itemRange.start + i;
      const row = layout.getRow(idx);
      engineState.visibleIndices[i] = idx;
      engineState.visibleOffsets[i] = sizeCache.getOffset(row);
      engineState.visibleSizes[i] = sizeCache.getSize(row);
    }
  }

  function gridForceRender(): void {
    if (engineState.destroyed) return;
    sizeCache.rebuild(getRowCount());
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
      const gap = config.gap ?? 0;

      layout = createGridLayout({ columns: config.columns, gap });
      sizeCache = ctx.sizeCache;
      engineState = ctx.getState();
      pool = ctx.pool;
      contentElement = ctx.dom.content;
      template = ctx.template;
      horizontal = ctx.config.horizontal;
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      getItem = ctx.getItem.bind(ctx);
      resolveItemState = () => ctx.getItemStateFn();

      // Initialize container width
      containerWidth = engineState.crossSize;

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
      // setSizeConfig creates with state.totalItems — fix immediately.
      sizeCache.rebuild(getRowCount());

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
          sizeCache.rebuild(getRowCount());
        }

        if (newConfig.columns !== undefined) {
          ctx.setNavConfig({ ud: layout.columns });
        }

        containerWidth = engineState.crossSize;
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
        const offset = sizeCache.getOffset(safeRow);
        const rowHeight = sizeCache.getSize(safeRow);
        const cs = engineState.containerSize;
        const totalSize = sizeCache.getTotalSize();
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
        const newCross = engineState.crossSize;
        if (Math.abs(newCross - containerWidth) < 1) return;
        containerWidth = newCross;

        rendered.forEach((tracked, index) => {
          applySizeStyles(tracked.el, index);
          tracked.el.style.transform = buildTransform(index);
        });
      },
    },

    destroy(): void {
      rendered.clear();
    },
  };
}
