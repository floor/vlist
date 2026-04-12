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
 * - Released elements removed from DOM immediately, pooled for reuse
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
import type { CompressionContext } from "../../rendering/renderer";
import { calculateCompressedItemPosition } from "../../rendering/scale";
import type { TableLayout, ResolvedColumn, TableColumn } from "./types";
import type { GroupHeaderItem } from "../groups/types";

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
    compressionCtx?: CompressionContext,
  ) => void;

  /** Update item positions (for compressed scrolling) */
  updatePositions: (compressionCtx: CompressionContext) => void;

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

const createElementPool = (): { acquire: () => HTMLElement; release: (el: HTMLElement) => void; clear: () => void } => {
  const pool: HTMLElement[] = [];
  return {
    acquire: (): HTMLElement => pool.pop() || document.createElement("div"),
    release: (el: HTMLElement): void => {
      el.parentNode?.removeChild(el);
      if (pool.length < 200) {
        el.className = "";
        el.removeAttribute("data-id");
        el.removeAttribute("data-index");
        el.removeAttribute("aria-selected");
        el.removeAttribute("aria-rowindex");
        el.removeAttribute("role");
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

  /** Cell elements within the row */
  cells: HTMLElement[];

  /** Item index in the data array */
  index: number;

  /** Whether this row is a group header (fast flag — avoids DOM queries) */
  isGroupHeader: boolean;

  /** Last rendered item ID (for change detection) */
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

  /** Toggle aria-selected attribute */
  const setAriaSelected = (el: HTMLElement, selected: boolean): void => {
    if (selected) el.setAttribute("aria-selected", "true");
    else el.removeAttribute("aria-selected");
  };

  /** Set common row data attributes */
  const setRowAttrs = (el: HTMLElement, role: string, id: string | number, index: number): void => {
    el.setAttribute("role", role);
    el.setAttribute("data-id", String(id));
    el.setAttribute("data-index", String(index));
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
  const cellCenterClass = `${classPrefix}-table-cell--center`;
  const cellRightClass = `${classPrefix}-table-cell--right`;
  const oddClass = `${classPrefix}-item--odd`;
  const placeholderClass = `${classPrefix}-item--placeholder`;
  const replacedClass = `${classPrefix}-item--replaced`;
  const groupHeaderRowClass = `${classPrefix}-item ${classPrefix}-table-row ${classPrefix}-table-group-header`;
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
      const result = col.def.cell(item, col.def, rowIndex);
      if (typeof result === "string") {
        cell.innerHTML = result;
      } else {
        cell.replaceChildren(result);
      }
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
      if (cachedStripeFn) {
        const si = cachedStripeFn(index);
        if (si >= 0 && (si & 1) === 1) className += ` ${oddClass}`;
      } else if ((index & 1) === 1) {
        className += ` ${oddClass}`;
      }
    }
    if (isPlaceholder) className += ` ${placeholderClass}`;
    if (isSelected) className += ` ${selectedClass}`;
    if (isFocused) className += ` ${focusedClass}`;
    element.className = className;
  };

  // =========================================================================
  // Row Positioning (compression-aware)
  // =========================================================================

  /**
   * Calculate the Y offset for a row.
   * Uses compression-aware positioning for large datasets (withScale).
   */
  const calculateRowOffset = (
    index: number,
    sc: SizeCache,
    compressionCtx?: CompressionContext,
  ): number => {
    if (compressionCtx?.compression?.isCompressed) {
      return Math.round(calculateCompressedItemPosition(
        index,
        compressionCtx.scrollPosition,
        sc,
        compressionCtx.totalItems,
        compressionCtx.containerSize,
        compressionCtx.compression,
        compressionCtx.rangeStart,
      ));
    }
    return sc.getOffset(index);
  };

  // =========================================================================
  // Cell Sizing & Positioning
  // =========================================================================

  /**
   * Apply alignment style to a cell based on column definition.
   */
  const applyCellAlign = (cell: HTMLElement, col: ResolvedColumn<T>): void => {
    const align = col.def.align;
    if (align === "center") {
      cell.classList.add(cellCenterClass);
      cell.classList.remove(cellRightClass);
    } else if (align === "right") {
      cell.classList.add(cellRightClass);
      cell.classList.remove(cellCenterClass);
    } else {
      cell.classList.remove(cellCenterClass, cellRightClass);
    }
  };

  // =========================================================================
  // Row Building
  // =========================================================================

  /**
   * Create or reuse cells for a row element, matching the current column count.
   */
  const ensureCells = (rowElement: HTMLElement, existingCells: HTMLElement[]): HTMLElement[] => {
    const cols = currentLayout.columns;
    const targetCount = cols.length;

    // Reuse existing cells where possible
    if (existingCells.length === targetCount) {
      return existingCells;
    }

    const cells: HTMLElement[] = [];

    for (let i = 0; i < targetCount; i++) {
      let cell: HTMLElement;
      if (i < existingCells.length) {
        cell = existingCells[i]!;
      } else {
        cell = document.createElement("div");
        cell.className = cellClass;
        rowElement.appendChild(cell);
      }
      cells.push(cell);
    }

    // Remove excess cells
    for (let i = targetCount; i < existingCells.length; i++) {
      existingCells[i]!.remove();
    }

    return cells;
  };

  /**
   * Render a group header row: full-width, no cells, custom template.
   */
  const renderGroupHeaderRow = (
    item: T,
    index: number,
    sc: SizeCache,
    compressionCtx?: CompressionContext,
  ): TrackedRow => {
    const element = pool.acquire();
    const headerItem = item as unknown as GroupHeaderItem;
    const height = sc.getSize(index);
    const offset = calculateRowOffset(index, sc, compressionCtx);

    // Set all styles in one operation (element was reset by pool.release)
    element.style.cssText = `width:${currentLayout.totalWidth}px;height:${height}px;transform:translateY(${offset}px)`;
    element.className = groupHeaderRowClass;

    // ARIA — group header is presentational, not a data row
    setRowAttrs(element, "presentation", item.id, index);
    element.removeAttribute("aria-selected");
    element.removeAttribute("aria-rowindex");

    // Clear any leftover cells from pooled element reuse
    element.replaceChildren();

    // Create the single content container
    const content = document.createElement("div");
    content.className = groupHeaderContentClass;

    if (groupHeaderTemplate) {
      const result = groupHeaderTemplate(headerItem.groupKey, headerItem.groupIndex);
      if (typeof result === "string") {
        content.innerHTML = result;
      } else {
        content.appendChild(result);
      }
    }

    element.appendChild(content);

    return {
      element,
      cells: [],  // No cells for group headers
      index,
      isGroupHeader: true,
      lastItemId: item.id,
      lastSelected: false,
      lastFocused: false,
      lastOffset: offset,
      lastHeight: height,
    };
  };

  /**
   * Render a full row: create element, set cells, apply state.
   * Returns a TrackedRow for the rendered map.
   */
  const renderRow = (
    item: T,
    index: number,
    isSelected: boolean,
    isFocused: boolean,
    sc: SizeCache,
    compressionCtx?: CompressionContext,
  ): TrackedRow => {
    const element = pool.acquire();
    const height = sc.getSize(index);
    const offset = calculateRowOffset(index, sc, compressionCtx);
    const isPlaceholder = isPH(item.id);

    // Set all row styles in one operation (element was reset by pool.release)
    element.style.cssText = `width:${currentLayout.totalWidth}px;height:${height}px;transform:translateY(${offset}px)`;

    applyRowClasses(element, index, isSelected, isFocused, isPlaceholder);

    // ARIA attributes
    setRowAttrs(element, "row", item.id, index);
    element.id = `${ariaIdPrefix}-${index}`;
    element.setAttribute("aria-rowindex", String(index + 2)); // +2: header is row 1

    setAriaSelected(element, isSelected);

    // Create cells
    const cells = ensureCells(element, []);
    const cols = currentLayout.columns;

    for (let i = 0; i < cells.length && i < cols.length; i++) {
      const cell = cells[i]!;
      const col = cols[i]!;

      cell.style.cssText = `left:${col.offset}px;width:${col.width}px`;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(i + 1));

      applyCellAlign(cell, col);
      applyCellTemplate(cell, item, col, index, isPlaceholder);
    }

    return {
      element,
      cells,
      index,
      isGroupHeader: false,
      lastItemId: item.id,
      lastSelected: isSelected,
      lastFocused: isFocused,
      lastOffset: offset,
      lastHeight: height,
    };
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
   * - Rows outside range: released after grace period
   */
  const render = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    compressionCtx?: CompressionContext,
  ): void => {
    // Release items outside the new range immediately.
    // Tables don't need a grace period — row hover is a simple background
    // change with no CSS transitions to preserve, and each graced row
    // carries N cell elements so the DOM cost is high.
    for (const [index, tracked] of rendered) {
      if (index < range.start || index > range.end) {
        pool.release(tracked.element);
        rendered.delete(index);
      }
    }

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
      const itemIndex = i - range.start;
      const item = items[itemIndex];
      if (!item) continue;

      const isSelected = selectedIds.has(item.id);
      const isFocused = i === focusedIndex;

      // ── Check if this item is a group header ──
      const isHeader = groupHeaderFn ? groupHeaderFn(item) : false;

      const existing = rendered.get(i);

      if (existing) {
        // ── Check if row type changed (data row ↔ group header) ──
        if (existing.isGroupHeader !== isHeader) {
          // Type changed — release old element, create new one
          pool.release(existing.element);
          rendered.delete(i);
          const tracked = isHeader
            ? renderGroupHeaderRow(item, i, sc, compressionCtx)
            : renderRow(item, i, isSelected, isFocused, sc, compressionCtx);
          rendered.set(i, tracked);
          if (!fragment) fragment = document.createDocumentFragment();
          fragment.appendChild(tracked.element);
          continue;
        }

        if (isHeader) {
          // ── Group header fast path ──
          const idChanged = existing.lastItemId !== item.id;
          if (idChanged) {
            // Different group header — re-render content
            const headerItem = item as unknown as GroupHeaderItem;
            const content = existing.element.firstElementChild as HTMLElement;
            if (content && groupHeaderTemplate) {
              const result = groupHeaderTemplate(headerItem.groupKey, headerItem.groupIndex);
              if (typeof result === "string") {
                content.innerHTML = result;
              } else {
                content.replaceChildren(result);
              }
            }
            existing.element.setAttribute("data-id", String(item.id));
            existing.lastItemId = item.id;
          }

          // Position update (compression-aware)
          const offset = calculateRowOffset(i, sc, compressionCtx);
          if (existing.lastOffset !== offset) {
            existing.lastOffset = offset;
            existing.element.style.transform = `translateY(${offset}px)`;
          }

          // Height update (only when changed)
          const height = sc.getSize(i);
          if (existing.lastHeight !== height) {
            existing.lastHeight = height;
            existing.element.style.height = `${height}px`;
          }

        } else {
          // ── Data row path (existing logic) ──
          const idChanged = existing.lastItemId !== item.id;
          const selectedChanged = existing.lastSelected !== isSelected;
          const focusedChanged = existing.lastFocused !== isFocused;

          if (idChanged) {
            // Different item at this index — full re-render of cells
            const wasPlaceholder = existing.lastItemId != null && isPH(existing.lastItemId);
            const isPlaceholder = isPH(item.id);

            const cols = currentLayout.columns;
            for (let c = 0; c < existing.cells.length && c < cols.length; c++) {
              applyCellTemplate(existing.cells[c]!, item, cols[c]!, i, isPlaceholder);
            }
            applyRowClasses(existing.element, i, isSelected, isFocused, isPlaceholder);
            existing.element.setAttribute("data-id", String(item.id));
            setAriaSelected(existing.element, isSelected);

            // Fade-in animation when placeholder is replaced with real data
            if (wasPlaceholder && !isPlaceholder) {
              existing.element.classList.add(replacedClass);
              setTimeout(() => {
                existing.element.classList.remove(replacedClass);
              }, 300);
            }

            existing.lastItemId = item.id;
            existing.lastSelected = isSelected;
            existing.lastFocused = isFocused;
          } else if (selectedChanged || focusedChanged) {
            // Same item — only update classes/aria if state changed
            applyRowClasses(existing.element, i, isSelected, isFocused, isPH(item.id));
            setAriaSelected(existing.element, isSelected);
            existing.lastSelected = isSelected;
            existing.lastFocused = isFocused;
          }

          // Position update only when offset changed (compression-aware)
          const offset = calculateRowOffset(i, sc, compressionCtx);
          if (existing.lastOffset !== offset) {
            existing.lastOffset = offset;
            existing.element.style.transform = `translateY(${offset}px)`;
          }

          // Update row height only when changed
          const height = sc.getSize(i);
          if (existing.lastHeight !== height) {
            existing.lastHeight = height;
            existing.element.style.height = `${height}px`;
          }

          // Update ARIA set size if changed
          if (setSizeChanged) {
            existing.element.setAttribute("aria-rowindex", String(i + 2));
          }

        }
      } else {
        // New row — create and collect in fragment for batched insertion
        const tracked = isHeader
          ? renderGroupHeaderRow(item, i, sc, compressionCtx)
          : renderRow(item, i, isSelected, isFocused, sc, compressionCtx);
        rendered.set(i, tracked);

        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(tracked.element);
      }
    }

    // Single DOM insertion for all new elements — minimizes reflows
    if (fragment) {
      container.appendChild(fragment);
    }
  };

  // =========================================================================
  // Position Update (compressed scrolling)
  // =========================================================================

  /**
   * Update positions of all rendered rows (for compressed scrolling).
   * Called when the scroll position changed but the visible range didn't —
   * in compressed mode, items are positioned relative to the viewport so
   * they must be repositioned on every scroll frame.
   */
  const updatePositions = (compressionCtx: CompressionContext): void => {
    const sc = getSizeCache();
    for (const [index, tracked] of rendered) {
      const offset = calculateRowOffset(index, sc, compressionCtx);
      if (tracked.lastOffset !== offset) {
        tracked.lastOffset = offset;
        tracked.element.style.transform = `translateY(${offset}px)`;
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
    if (!existing) return;

    // Group headers are not selectable — skip state updates
    if (existing.isGroupHeader) return;

    const cols = currentLayout.columns;
    for (let c = 0; c < existing.cells.length && c < cols.length; c++) {
      applyCellTemplate(existing.cells[c]!, item, cols[c]!, index);
    }
    existing.element.setAttribute("data-id", String(item.id));
    existing.lastItemId = item.id;

    applyRowClasses(existing.element, index, isSelected, isFocused);
    setAriaSelected(existing.element, isSelected);
    existing.lastSelected = isSelected;
    existing.lastFocused = isFocused;
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
    if (!existing) return;

    // Group headers are not selectable — skip state updates
    if (existing.isGroupHeader) return;

    const selectedChanged = existing.lastSelected !== isSelected;
    const focusedChanged = existing.lastFocused !== isFocused;

    if (selectedChanged || focusedChanged) {
      applyRowClasses(existing.element, index, isSelected, isFocused);
      setAriaSelected(existing.element, isSelected);
      existing.lastSelected = isSelected;
      existing.lastFocused = isFocused;
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
      if (tracked.cells.length > 0) {
        for (let i = 0; i < tracked.cells.length && i < cols.length; i++) {
          const cell = tracked.cells[i]!;
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
    updatePositions,
    updateItem,
    updateItemClasses,
    getElement,
    updateColumnLayout,
    setGroupHeaderFn,
    clear,
    destroy,
  };
};