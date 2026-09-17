/**
 * vlist — Grid Plugin
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
 * - Cannot be combined with autosize: it measures items, while this size cache
 *   is indexed by row. A row's height is a question about the row's cells, and
 *   answering it belongs to whichever plugin owns the layout. Give grid lists a
 *   fixed `item.height` (or `item.width` when horizontal).
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

/** Methods the grid plugin adds to the list instance. */
export interface GridMethods {
  /** The current grid layout. */
  getGridLayout(): GridLayout;
  /** Change columns, gap or aspect ratio at runtime. */
  updateGrid(config: Partial<GridPluginConfig>): void;
}

export function grid<T extends VListItem = VListItem>(
  config: GridPluginConfig,
): VListPlugin<T, GridMethods> {
  if (!config.columns || config.columns < 1) {
    throw new Error("[vlist] grid: columns must be >= 1");
  }

  let layout: GridLayout;
  let sizeCache: SizeCache;
  let engineState: EngineState;
  let scroll: PluginContext<T>["scroll"];
  let lastOrigin = 0;
  let pool: ElementPool;
  let storedCtx: PluginContext<T> | null = null;
  /** null until the render path resolves it; a11y() or selection() may enable it. */
  let interactive: boolean | null = null;
  let lastAriaTotal = -1;
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
  let lastContentTotalSize = -1;
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

  // Listbox semantics, resolved on the same schedule and for the same reason:
  // grid sets up at priority 10, before a11y (55) and selection (50), so this
  // cannot be read during setup.
  //
  // Both a11y() and selection() call ctx.dom.enableListbox(), which marks the
  // content element, and core renders role="option" with aria-posinset and
  // aria-setsize for either. Reading that marker keeps an a11y()-only list
  // right; `_getSelectedIds` is only published by selection().
  function resolveInteractive(): void {
    if (interactive !== null || storedCtx === null) return;
    interactive = storedCtx.dom.content.getAttribute("role") === "listbox";
  }

  function getRowCount(): number {
    return layout.getTotalRows(engineState.totalItems);
  }

  function buildTransform(itemIndex: number, origin: number): string {
    const row = (itemIndex / columns) | 0;
    const col = itemIndex - row * columns;
    const x = col * (columnWidth + gap) + crossPadStart;
    // Map logical item offsets into content coordinates using the adapter origin.
    const y = sizeCache.getOffset(row) - origin + mainPadStart;
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

    const origin = scroll.getRenderOrigin();
    const scrollPos = scroll.getPixelEquivalent();
    const cs = engineState.containerSize;

    if (!forceNextRender && scrollPos === lastScrollPosition && cs === lastContainerSize && origin === lastOrigin) {
      return;
    }
    lastScrollPosition = scrollPos;
    lastContainerSize = cs;
    forceNextRender = false;

    const totalRows = getRowCount();
    if (cs <= 0 || totalRows === 0) return;

    // Visible row range
    resolveItemStateFn();
    resolveInteractive();
    let visStart = sizeCache.indexAtOffset(scrollPos);
    let visEnd = sizeCache.indexAtOffset(scrollPos + cs);
    if (visEnd < totalRows - 1) visEnd++;
    visStart = Math.max(0, visStart);
    visEnd = Math.min(totalRows - 1, Math.max(0, visEnd));
    const renderStart = Math.max(0, visStart - overscan);
    const renderEnd = Math.min(totalRows - 1, visEnd + overscan);

    // An origin move must still commit even when the range stays unchanged
    // (issue 025). The renderer owns the origin of its last committed frame.
    if (renderStart === engineState.prevRangeStart && renderEnd === engineState.prevRangeEnd && !engineState.renderPending && origin === lastOrigin) {
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

    // aria-setsize is the same for every row, so it only needs rewriting when
    // the total moves — appending items must not leave the rendered rows
    // announcing the old count.
    if (interactive && engineState.totalItems !== lastAriaTotal) {
      lastAriaTotal = engineState.totalItems;
      const setSize = String(engineState.totalItems);
      for (const [, tracked] of rendered) tracked.el.setAttribute("aria-setsize", setSize);
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
        // Core sets role on every item and the position attributes only for an
        // interactive list. Grid replaces the render pipeline, so none of that
        // reached a grid row: they carried no role at all.
        el.setAttribute("role", interactive ? "option" : "listitem");
        if (interactive) {
          el.id = `${classPrefix}-item-${i}`;
          el.setAttribute("aria-posinset", String(i + 1));
          el.setAttribute("aria-setsize", String(engineState.totalItems));
        }
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
      // Map logical item offsets into content coordinates using the adapter origin.
      const y = sizeCache.getOffset(row) - origin + mainPadStart;
      tracked.el.style.transform = isX
        ? `translate(${Math.round(y)}px, ${Math.round(x)}px)`
        : `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    // Route content sizing through the engine so bounded mode caps the content
    // element to the runway (RFC-013). Only resize when the total changes — the
    // bounded handler's refresh() re-derives the split, so calling it per frame
    // would be wasteful. Core re-refreshes centrally on resize.
    const totalSize = sizeCache.getTotalSize();
    if (totalSize !== lastContentTotalSize) {
      lastContentTotalSize = totalSize;
      storedCtx?.render.contentSize(totalSize);
    }

    // Update engine state for other hooks/plugins
    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    lastOrigin = origin;
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
    lastContentTotalSize = -1;
    engineState.prevRangeStart = -1;
    engineState.prevRangeEnd = -1;
    engineState.renderPending = true;
    forceNextRender = true;
    gridRenderIfNeeded();
  }

  return {
    name: "grid",
    priority: 10,
    // autosize measures individual items; this plugin's size cache is indexed
    // by row. With a numeric estimate and no gap the two combine silently and
    // wrongly: the cache is rebuilt in row space while autosize's item-space
    // size function stays installed, so row n takes item n's measurement —
    // twenty items in two columns, two cells measured at 200, came to 800px
    // where 650px is right. With a gap or a function spec the measurements are
    // dropped instead. A row's height is a question about the row's cells, and
    // answering it belongs to whichever plugin owns the layout.
    conflicts: ["masonry", "table", "autosize"],

    setup(ctx: PluginContext<T>): void {
      scroll = ctx.scroll;
      columns = Math.max(1, Math.floor(config.columns));
      gap = config.gap ?? 0;

      layout = createGridLayout({ columns: config.columns, gap });
      sizeCache = ctx.sizes.cache;
      engineState = ctx.getState();
      pool = ctx.pool;
      storedCtx = ctx;
      contentElement = ctx.dom.content;
      template = ctx.template;
      isX = ctx.config.axis.primary === "x";
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      getItem = ctx.items.at.bind(ctx);
      resolveItemState = () => ctx.render.getStateFn();

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
      const rawSpec = ctx.sizes.rawSpec;
      let baseRowSize: number;
      if (typeof rawSpec === "function") {
        const colWidth = layout.getColumnWidth(containerWidth);
        const gridCtx = { columnWidth: colWidth, columns: config.columns, gap };
        baseRowSize = (rawSpec as Function)(0, gridCtx);
        ctx.sizes.setConfig((rowIndex: number): number => {
          gridCtx.columnWidth = layout.getColumnWidth(containerWidth);
          const firstItem = rowIndex * config.columns;
          return (rawSpec as Function)(firstItem, gridCtx) + gap;
        }, gap);
      } else {
        baseRowSize = rawSpec;
        if (gap > 0) {
          ctx.sizes.setConfig(baseRowSize + gap, gap);
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

      ctx.hooks.method("_setSizeCacheBase", (fn: (n: number) => void): void => {
        baseRebuild = fn;
        rebuildAsRows = (rowCount: number): void => baseRebuild(rowCount);
      });

      installRebuildHook();
      rebuildAsRows(getRowCount());

      // The engine renders rows, so engineState.totalItems stays the row-space
      // count that the size cache and the range math use. The public total is a
      // different question — how many items a consumer has — and it is the item
      // count. groups() and carousel() already publish it this way; grid was
      // reporting 34 for a hundred items in three columns, while getItemAt(99)
      // returned item 100 and items.length was 100.
      ctx.items.setTotalFn(() => engineState.totalItems);
      // Plugins ask through _getTotal rather than the public getter: selection,
      // snapshots and the aria resolvers all read it. groups() and carousel()
      // publish it; grid never did, so consumers fell back to the row count.
      ctx.hooks.method("_getTotal", (): number => engineState.totalItems);

      // Add CSS class
      ctx.dom.root.classList.add(`${classPrefix}--grid`);

      // Replace render pipeline
      ctx.render.setFn(gridRenderIfNeeded, gridForceRender);

      // ── Public methods ─────────────────────────────────────────

      ctx.hooks.method("getGridLayout", () => layout);
      ctx.hooks.method("_getRowGap", () => layout.gap);

      ctx.hooks.method("updateGrid", (newConfig: Partial<GridPluginConfig>) => {
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
            ctx.sizes.setConfig((rowIndex: number): number => {
              gridCtx.columnWidth = layout.getColumnWidth(containerWidth);
              const firstItem = rowIndex * layout.columns;
              return (rawSpec as Function)(firstItem, gridCtx) + newGap;
            }, newGap);
          } else {
            ctx.sizes.setConfig(baseRowSize + newGap, newGap);
          }
          installRebuildHook();
          rebuildAsRows(getRowCount());
        }

        if (newConfig.columns !== undefined) {
          ctx.nav.set({ ud: layout.columns });
        }

        containerWidth = engineState.crossSize - crossPadTotal;
        recomputeColumnWidth();
        gridForceRender();
      });

      // Override scrollToIndex: item index → row index
      // Core owns the public method: it holds a scroll requested before the
      // total is known, clamps the index and resolves the options, then calls
      // this hook. Returning false falls back to the core implementation.
      ctx.scroll.setToIndexFn((
        index: number,
        align: string,
        behavior?: string,
        duration?: number,
      ): void | false => {
        const rowIndex = layout.getRow(index);
        const totalRows = getRowCount();
        if (totalRows === 0) return false;
        const safeRow = Math.max(0, Math.min(rowIndex, totalRows - 1));
        const offset = sizeCache.getOffset(safeRow) + mainPadStart;
        const rowHeight = sizeCache.getSize(safeRow);
        const cs = engineState.containerSize;
        const totalSize = sizeCache.getTotalSize() + mainPadTotal;
        const maxScroll = Math.max(0, totalSize - cs);


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
          ctx.scroll.smoothTo(pos, duration);
        } else {
          ctx.scroll.to(pos);
        }
      });

      // ── 2D keyboard navigation ─────────────────────────────────

      ctx.nav.set({
        total: () => engineState.totalItems,
        ud: config.columns,
        lr: 1,
        scrollIndex: (itemIndex: number) => layout.getRow(itemIndex),
      });

      // ── Cleanup ────────────────────────────────────────────────

      ctx.hooks.onDestroy(() => {
        for (const [, tracked] of rendered) {
          tracked.el.remove();
        }
        rendered.clear();
        interactive = null;
        lastAriaTotal = -1;
        ctx.dom.root.classList.remove(`${classPrefix}--grid`);
      });
    },

    hooks: {
      onResize(_width: number, _height: number): void {
        const newCross = engineState.crossSize - crossPadTotal;
        if (Math.abs(newCross - containerWidth) < 1) return;
        containerWidth = newCross;
        recomputeColumnWidth();

        const origin = scroll.getRenderOrigin();
        for (const [index, tracked] of rendered) {
          const row = (index / columns) | 0;
          applySizeStyles(tracked.el, row);
          tracked.el.style.transform = buildTransform(index, origin);
        }
      },
    },

    destroy(): void {
      rendered.clear();
    },
  };
}
