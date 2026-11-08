/**
 * vlist/table - Renderer
 * Renders virtualized rows with cell-based layout within the virtual scroll container.
 *
 * Each row is an absolutely positioned element (like the list renderer),
 * containing child elements for each cell. Cells are sized and positioned
 * according to the resolved column layout from TableLayout.
 *
 * Key design decisions:
 * - Rows are the unit of virtualization (same as list mode — 1:1 with items)
 * - Each row contains N cell elements (one per column)
 * - Row positioning is translateY-based (from the size cache)
 * - Cell positioning uses absolute left + width from the column layout
 * - Element pooling avoids createElement cost (row-level pooling)
 * - Change tracking skips template re-evaluation when data + state unchanged
 * - Release grace period prevents boundary thrashing (hover blink, transition replay)
 * - DocumentFragment batched insertion for new elements
 *
 * Performance:
 * - O(1) Set-based visibility diffing (not O(n) .some())
 * - Template re-evaluation skipped when item id + selection/focus state unchanged
 * - Position update skipped when coordinates unchanged (position tracking)
 * - Cell widths are only updated when column layout changes (not every scroll frame)
 * - Stale elements released after new ones are in the DOM (no single-frame gaps)
 *
 * DOM structure per row:
 *   .vlist-item.vlist-table-row (position: absolute, translateY)
 *   ├── .vlist-table-cell [col 0] (position: absolute, left, width)
 *   ├── .vlist-table-cell [col 1]
 *   └── ...
 */

import type {
  VListItem,
  Range,
} from "../../types";

import type { SizeCache } from "../../rendering/sizes";
import { claimPlaceholderSelection } from "../../plugins/selection/state";
import type { TableLayout, ResolvedColumn, TableColumn } from "./types";
import type { GroupHeaderItem } from "../groups/types";
import { rowContentWritten, type StampableRow } from "../../core/dom";

// =============================================================================
// Types
// =============================================================================

/** Table renderer instance */
export interface TableRendererInstance<T extends VListItem = VListItem> {
  /** Render rows for a range, with cell-based layout */
  render: (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    /** Reuse the plugin commit's origin; standalone renders read the callback once. */
    origin?: number,
  ) => void;

  /** Update a single row (e.g., after selection change) */
  updateItem: (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ) => void;

  /** Update only CSS classes on a rendered row */
  updateItemClasses: (
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ) => void;

  /** Get rendered row element by item index */
  getElement: (index: number) => HTMLElement | undefined;

  /** Update cell positions and widths after column resize */
  updateColumnLayout: (layout: TableLayout<T>) => void;

  /** Set the group header check function (called by withGroups integration) */
  setGroupHeaderFn: (
    fn: ((item: T) => boolean) | null,
    template: ((key: string, groupIndex: number) => HTMLElement | string) | null,
  ) => void;

  /** Clear all rendered rows */
  clear: () => void;

  /** Destroy renderer and cleanup */
  destroy: () => void;
}

// =============================================================================
// Element Pool (row-level)
// =============================================================================

const RESET_ATTRS = ["data-id", "data-index", "aria-selected", "aria-rowindex", "role"];

const createElementPool = (): { acquire: () => HTMLElement; release: (el: HTMLElement) => void; clear: () => void } => {
  const pool: HTMLElement[] = [];
  return {
    acquire: (): HTMLElement => pool.pop() || document.createElement("div"),
    release: (el: HTMLElement): void => {
      el.remove();
      if (pool.length < 200) {
        el.className = "";
        for (let i = 0; i < RESET_ATTRS.length; i++) el.removeAttribute(RESET_ATTRS[i]!);
        el.style.cssText = "";
        el.textContent = "";
        pool.push(el);
      }
    },
    clear: (): void => { pool.length = 0; },
  };
};

// =============================================================================
// Tracked Row
// =============================================================================

/** Internal tracking data for a rendered row */
interface TrackedRow {
  /** The row DOM element */
  element: HTMLElement;

  /** Item index in the data array */
  index: number;

  /** Whether this row is a group header (fast flag — avoids DOM queries) */
  isGroupHeader: boolean;

  /** Last rendered item reference (for change detection) */
  _lastItem: unknown;

  /** Last rendered item ID (for data-id attribute and placeholder transitions) */
  lastItemId: string | number;

  /** Last selected state */
  lastSelected: boolean;

  /** Last focused state */
  lastFocused: boolean;

  /** Last translateY offset in pixels (numeric for fast comparison) */
  lastOffset: number;

  /** Last height in pixels (for change detection) */
  lastHeight: number;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a TableRenderer instance.
 *
 * @param container - The .vlist-items container element
 * @param sizeCache - Size cache for row offset lookups
 * @param layout - Table layout for column widths/offsets
 * @param columns - Column definitions (for cell templates)
 * @param classPrefix - CSS class prefix
 * @param ariaIdPrefix - Prefix for ARIA IDs
 * @param columnBorders - Whether to show vertical borders between cells
 * @param rowBorders - Whether to show horizontal borders between rows
 * @param getTotalItems - Function to get total item count (for ARIA)
 * @returns TableRendererInstance
 */
export const createTableRenderer = <T extends VListItem = VListItem>(
  container: HTMLElement,
  getSizeCache: () => SizeCache,
  layout: TableLayout<T>,
  _columns: TableColumn<T>[],
  classPrefix: string,
  ariaIdPrefix: string,
  getTotalItems: () => number,
  striped?: boolean | "data" | "even" | "odd",
  stripeIndexFn?: () => (index: number) => number,
  // RFC-012: absolute row offsets are shifted into the content element by
  // subtracting baseOffset. Returns 0 in native mode (transforms unchanged).
  getBaseOffset: () => number = () => 0,
): TableRendererInstance<T> => {
  const pool = createElementPool();
  const rendered = new Map<number, TrackedRow>();

  let lastAriaSetSize = -1;
  let currentLayout = layout;

  // Cached stripe index function — resolved once per render frame, not per row
  let cachedStripeFn: ((index: number) => number) | null = null;

  // ── Group header support ──
  // When groups are active, the renderer needs to handle group header
  // pseudo-items differently: full-width row, no cells, custom template.
  let groupHeaderFn: ((item: T) => boolean) | null = null;
  let groupHeaderTemplate: ((key: string, groupIndex: number) => HTMLElement | string) | null = null;

  const setGroupHeaderFn = (
    fn: ((item: T) => boolean) | null,
    template: ((key: string, groupIndex: number) => HTMLElement | string) | null,
  ): void => {
    groupHeaderFn = fn;
    groupHeaderTemplate = template;
  };

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Write a string (innerHTML) or DOM node (replaceChildren) into a container */
  const setHtmlOrChild = (el: HTMLElement, result: HTMLElement | string): void => {
    if (typeof result === "string") {
      el.innerHTML = result;
    } else {
      el.replaceChildren(result);
    }
  };

  /** Check if an item id represents a placeholder (async loading) */
  const isPH = (id: string | number): boolean => String(id).startsWith("__placeholder_");

  // =========================================================================
  // CSS Classes (precomputed)
  // =========================================================================

  const rowClass = `${classPrefix}-item ${classPrefix}-table-row`;
  const selectedClass = `${classPrefix}-item--selected`;
  const focusedClass = `${classPrefix}-item--focused`;
  const cellClass = `${classPrefix}-table-cell`;
  const cellSkeletonClass = `${classPrefix}-table-cell-skeleton`;
  const oddClass = `${classPrefix}-item--odd`;
  const placeholderClass = `${classPrefix}-item--placeholder`;
  const replacedClass = `${classPrefix}-item--replaced`;
  const groupHeaderRowClass = `${classPrefix}-table-row ${classPrefix}-table-group-header`;
  const groupHeaderContentClass = `${classPrefix}-table-group-header-content`;

  // =========================================================================
  // Cell Template Application
  // =========================================================================

  /**
   * Render a cell's content using the column's cell template or default accessor.
   */
  const applyCellTemplate = (
    cell: HTMLElement,
    item: T,
    col: ResolvedColumn<T>,
    rowIndex: number,
    isPlaceholder: boolean = false,
  ): void => {
    if (col.def.cell) {
      setHtmlOrChild(cell, col.def.cell(item, col.def, rowIndex));
    } else {
      // Default: show item[column.key] as text
      const value = (item as Record<string, unknown>)[col.def.key];
      const text = value != null ? String(value) : "";
      if (isPlaceholder && text) {
        // Wrap in <span> so CSS skeleton styling can target the element
        // (bare text nodes can't be styled with background/border-radius)
        cell.innerHTML = `<span>${text}</span>`;
      } else {
        cell.textContent = text;
      }
    }

    // Placeholder skeleton invariant: a cell must contain an element for the
    // skeleton CSS to target. When a cell template returns an empty string (a
    // common "no data yet" path) or the default accessor has no value, the
    // cell would be a bare leaf — and the generic placeholder rule paints the
    // whole fixed-width cell as a solid box. Inject a skeleton bar so every
    // placeholder cell renders a clean, consistent loading bar instead.
    if (isPlaceholder && cell.firstElementChild === null) {
      cell.replaceChildren();
      const bar = document.createElement("span");
      bar.className = cellSkeletonClass;
      cell.appendChild(bar);
    }
    rowContentWritten(cell);
    const row = cell.parentElement as StampableRow | null;
    if (row) row._stamp = 0;
  };

  /**
   * Apply CSS classes to a row element based on state.
   */
  const applyRowClasses = (
    element: HTMLElement,
    index: number,
    isSelected: boolean,
    isFocused: boolean,
    isPlaceholder: boolean = false,
  ): void => {
    let className = rowClass;
    if (striped) {
      const si = cachedStripeFn ? cachedStripeFn(index) : index;
      if (si >= 0 && (si & 1) === 1) className += ` ${oddClass}`;
    }
    if (isPlaceholder) className += ` ${placeholderClass}`;
    if (isSelected) className += ` ${selectedClass}`;
    if (isFocused) className += ` ${focusedClass}`;
    element.className = className;
  };

  /** Sync a tracked row's selection and focus classes/ARIA */
  const syncRowState = (
    tracked: TrackedRow,
    index: number,
    isSelected: boolean,
    isFocused: boolean,
    isPlaceholder: boolean = false,
  ): void => {
    applyRowClasses(tracked.element, index, isSelected, isFocused, isPlaceholder);
    isSelected
      ? tracked.element.setAttribute("aria-selected", "true")
      : tracked.element.removeAttribute("aria-selected");
    tracked.lastSelected = isSelected;
    tracked.lastFocused = isFocused;
  };

  const setTrackedItem = (tracked: TrackedRow, item: T): void => {
    tracked.element.setAttribute("data-id", String(item.id));
    tracked._lastItem = item;
    tracked.lastItemId = item.id;
  };

  /** Re-render all cells and sync state for a tracked data row */
  const syncRowItem = (
    tracked: TrackedRow,
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
    isPlaceholder: boolean = false,
  ): void => {
    const cols = currentLayout.columns;
    const cells = tracked.element.children;
    for (let c = 0; c < cells.length && c < cols.length; c++) {
      applyCellTemplate(cells[c] as HTMLElement, item, cols[c]!, index, isPlaceholder);
    }
    setTrackedItem(tracked, item);
    syncRowState(tracked, index, isSelected, isFocused, isPlaceholder);
  };

  // =========================================================================
  // Row Building
  // =========================================================================

  const mountRow = (
    item: T,
    index: number,
    isHeader: boolean,
    isSelected: boolean,
    isFocused: boolean,
    sc: SizeCache,
    origin: number,
  ): TrackedRow => {
    const element = pool.acquire();
    const height = sc.getSize(index);
    const offset = sc.getOffset(index) - origin;
    const tracked: TrackedRow = {
      element,
      index,
      isGroupHeader: isHeader,
      _lastItem: item,
      lastItemId: item.id,
      lastSelected: false,
      lastFocused: false,
      lastOffset: offset,
      lastHeight: height,
    };

    element.style.cssText = `width:${currentLayout.totalWidth}px;height:${height}px;transform:translateY(${offset}px)`;
    element.setAttribute("role", isHeader ? "presentation" : "row");
    element.setAttribute("data-index", String(index));

    if (isHeader) {
      const headerItem = item as unknown as GroupHeaderItem;
      element.className = groupHeaderRowClass;
      setTrackedItem(tracked, item);
      const content = document.createElement("div");
      content.className = groupHeaderContentClass;
      if (groupHeaderTemplate) {
        setHtmlOrChild(content, groupHeaderTemplate(headerItem.groupKey, headerItem.groupIndex));
      }
      element.appendChild(content);
      rowContentWritten(element);
    } else {
      element.id = `${ariaIdPrefix}-item-${index}`;
      element.setAttribute("aria-rowindex", String(index + 2));

      const cols = currentLayout.columns;
      for (let i = 0; i < cols.length; i++) {
        const cell = document.createElement("div");
        const col = cols[i]!;
        const align = col.def.align;
        cell.className =
          align === "center" || align === "right" ? `${cellClass} ${cellClass}--${align}` : cellClass;
        cell.style.cssText = `left:${col.offset}px;width:${col.width}px`;
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-colindex", String(i + 1));
        element.appendChild(cell);
      }
      syncRowItem(tracked, index, item, isSelected, isFocused, isPH(item.id));
    }

    return tracked;
  };

  // =========================================================================
  // Main Render
  // =========================================================================

  /**
   * Render rows for a range of items.
   *
   * Called by the feature's tableRenderIfNeeded() on each scroll frame.
   *
   * Performs incremental updates:
   * - New rows: created and positioned
   * - Existing rows with same item: state/position update only
   * - Existing rows with different item: full template re-evaluation
   * - Rows outside range: released after new rows are in the DOM
   */
  const render = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    origin = getBaseOffset(),
  ): void => {
    // Check if aria-setsize changed
    let setSizeChanged = false;
    const total = getTotalItems();
    if (total !== lastAriaSetSize) {
      lastAriaSetSize = total;
      setSizeChanged = true;
    }

    // DocumentFragment for batched DOM insertion of new elements
    let fragment: DocumentFragment | null = null;

    // Resolve size cache and stripe function once per frame (not per item)
    const sc = getSizeCache();
    cachedStripeFn = (typeof striped === "string" && stripeIndexFn) ? stripeIndexFn() : null;

    // Render each item in range
    for (let i = range.start; i <= range.end; i++) {
      // Items array is 0-indexed relative to range.start
      const item = items[i - range.start];
      if (!item) continue;

      let isSelected = selectedIds.has(item.id);
      const isFocused = i === focusedIndex;

      // ── Check if this item is a group header ──
      const isHeader = groupHeaderFn ? groupHeaderFn(item) : false;

      let existing = rendered.get(i);
      const wasExisting = !!existing;

      // ── Check if row type changed (data row ↔ group header) ──
      if (existing && existing.isGroupHeader !== isHeader) {
        pool.release(existing.element);
        rendered.delete(i);
        existing = undefined;
      }

      if (existing) {
        if (isHeader) {
          // ── Group header fast path ──
          if (existing._lastItem !== item) {
            const headerItem = item as unknown as GroupHeaderItem;
            const content = existing.element.firstElementChild as HTMLElement;
            if (content && groupHeaderTemplate) {
              setHtmlOrChild(content, groupHeaderTemplate(headerItem.groupKey, headerItem.groupIndex));
              rowContentWritten(existing.element);
            }
            setTrackedItem(existing, item);
          }
        } else {
          // ── Data row path ──
          if (existing._lastItem !== item) {
            const wasPlaceholder = existing.lastItemId != null && isPH(existing.lastItemId);
            const isPlaceholder = isPH(item.id);

            // Transfer selection from placeholder → real item ID (async loading)
            if (!isPlaceholder && claimPlaceholderSelection(selectedIds, i, item.id)) {
              isSelected = true;
            }

            syncRowItem(existing, i, item, isSelected, isFocused, isPlaceholder);

            // Fade-in animation when placeholder is replaced with real data
            if (wasPlaceholder && !isPlaceholder) {
              existing.element.classList.add(replacedClass);
              setTimeout(() => {
                existing!.element.classList.remove(replacedClass);
              }, 300);
            }
          } else if (existing.lastSelected !== isSelected || existing.lastFocused !== isFocused) {
            syncRowState(existing, i, isSelected, isFocused, isPH(item.id));
          }

          if (setSizeChanged) {
            existing.element.setAttribute("aria-rowindex", String(i + 2));
          }
        }

        // Position and height update (only when changed)
        const offset = sc.getOffset(i) - origin;
        if (existing.lastOffset !== offset) {
          existing.lastOffset = offset;
          existing.element.style.transform = `translateY(${offset}px)`;
        }

        const height = sc.getSize(i);
        if (existing.lastHeight !== height) {
          existing.lastHeight = height;
          existing.element.style.height = `${height}px`;
        }
      } else {
        // Transfer selection from placeholder → real item ID (async loading)
        if (!wasExisting && claimPlaceholderSelection(selectedIds, i, item.id)) {
          isSelected = true;
        }

        // New row — create and collect in fragment for batched insertion
        const tracked = mountRow(item, i, isHeader, isSelected, isFocused, sc, origin);
        rendered.set(i, tracked);

        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(tracked.element);
      }
    }

    // Single DOM insertion for all new elements — minimizes reflows
    if (fragment) {
      container.appendChild(fragment);
    }

    // Release rows outside the new range AFTER new elements are in the DOM.
    // This matches the core pipeline's approach: new elements are visible
    // before stale ones are removed, preventing single-frame gaps during
    // native scrollbar drag (compositor scrolls ahead of main-thread JS).
    for (const [index, tracked] of rendered) {
      if (index < range.start || index > range.end) {
        pool.release(tracked.element);
        rendered.delete(index);
      }
    }
  };

  // =========================================================================
  // Single Item Update
  // =========================================================================

  /**
   * Update a single row (explicit API call).
   * Always re-applies cell templates because the caller signals that the item
   * data has changed — even when the id stays the same (e.g. cover update).
   * Updates TrackedItem fields so subsequent scroll frames skip redundant work.
   */
  const updateItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing || existing.isGroupHeader) return;
    syncRowItem(existing, index, item, isSelected, isFocused);
  };

  /**
   * Update only CSS classes on a rendered row (no template re-evaluation).
   */
  const updateItemClasses = (
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing || existing.isGroupHeader) return;
    if (existing.lastSelected !== isSelected || existing.lastFocused !== isFocused) {
      syncRowState(existing, index, isSelected, isFocused);
    }
  };

  // =========================================================================
  // Column Layout Update
  // =========================================================================

  /**
   * Update cell positions and widths for all rendered rows.
   * Called after column resize or layout change.
   */
  const updateColumnLayout = (layout: TableLayout<T>): void => {
    currentLayout = layout;
    const cols = layout.columns;

    for (const [, tracked] of rendered) {
      // Update row width (applies to both data rows and group headers)
      tracked.element.style.width = `${layout.totalWidth}px`;

      // Update each cell's position and width (skip group headers — no cells)
      if (!tracked.isGroupHeader) {
        const cells = tracked.element.children;
        for (let i = 0; i < cells.length && i < cols.length; i++) {
          const cell = cells[i] as HTMLElement;
          const col = cols[i]!;
          cell.style.left = `${col.offset}px`;
          cell.style.width = `${col.width}px`;
        }
      }
    }
  };

  // =========================================================================
  // Accessors
  // =========================================================================

  /**
   * Get a rendered row element by item index.
   */
  const getElement = (index: number): HTMLElement | undefined => {
    return rendered.get(index)?.element;
  };

  // =========================================================================
  // Clear & Destroy
  // =========================================================================

  /**
   * Clear all rendered rows — return them to the pool.
   */
  const clear = (): void => {
    for (const [, tracked] of rendered) {
      pool.release(tracked.element);
    }
    rendered.clear();
    lastAriaSetSize = -1;
  };

  /**
   * Destroy renderer and cleanup all resources.
   */
  const destroy = (): void => {
    clear();
    pool.clear();
  };

  // =========================================================================
  // Return
  // =========================================================================

  return {
    render,
    updateItem,
    updateItemClasses,
    getElement,
    updateColumnLayout,
    setGroupHeaderFn,
    clear,
    destroy,
  };
};
