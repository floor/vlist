/**
 * vlist/table - Renderer (flow mode)
 * Renders virtualized rows in normal document flow with padding-based positioning.
 *
 * Rows are rendered in DOM order with paddingTop/paddingBottom on the container
 * to create the illusion of the full content height. This eliminates the blank
 * frame problem during native scrollbar drag — rows are physically at their
 * correct document position, so the browser compositor shows them naturally.
 *
 * Key design decisions:
 * - Rows are in document flow (position: relative), not absolute + translateY
 * - Container paddingTop = offset of first rendered row
 * - Container paddingBottom = totalSize - end of last rendered row
 * - DOM children are kept in index order (reordered on range change)
 * - Cells are still absolutely positioned within each row
 * - Element pooling avoids createElement cost (row-level pooling)
 * - Change tracking skips template re-evaluation when data + state unchanged
 *
 * Performance:
 * - Template re-evaluation skipped when item id + selection/focus state unchanged
 * - Cell widths are only updated when column layout changes (not every scroll frame)
 * - DOM reorder only when visible range changes (not every scroll frame)
 * - Released elements removed from DOM immediately, pooled for reuse
 *
 * DOM structure per row:
 *   .vlist-item.vlist-table-row (position: relative, in document flow)
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
import { claimPlaceholderSelection } from "../../plugins/selection/state";
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

  /** Last rendered item reference (for change detection) */
  _lastItem: unknown;

  /** Last rendered item ID (for data-id attribute and placeholder transitions) */
  lastItemId: string | number;

  /** Last selected state */
  lastSelected: boolean;

  /** Last focused state */
  lastFocused: boolean;

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
    selected ? el.setAttribute("aria-selected", "true") : el.removeAttribute("aria-selected");
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
  ): TrackedRow => {
    const element = pool.acquire();
    const headerItem = item as unknown as GroupHeaderItem;
    const height = sc.getSize(index);

    element.style.cssText = `width:${currentLayout.totalWidth}px;height:${height}px`;
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
      cells: [],
      index,
      isGroupHeader: true,
      _lastItem: item,
      lastItemId: item.id,
      lastSelected: false,
      lastFocused: false,
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
  ): TrackedRow => {
    const element = pool.acquire();
    const height = sc.getSize(index);
    const isPlaceholder = isPH(item.id);

    element.style.cssText = `width:${currentLayout.totalWidth}px;height:${height}px`;

    applyRowClasses(element, index, isSelected, isFocused, isPlaceholder);

    // ARIA attributes
    setRowAttrs(element, "row", item.id, index);
    element.id = `${ariaIdPrefix}-item-${index}`;
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
      _lastItem: item,
      lastItemId: item.id,
      lastSelected: isSelected,
      lastFocused: isFocused,
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
    _compressionCtx?: CompressionContext,
  ): void => {
    // Release items outside the new range
    let needsReorder = false;
    for (const [index, tracked] of rendered) {
      if (index < range.start || index > range.end) {
        pool.release(tracked.element);
        rendered.delete(index);
        needsReorder = true;
      }
    }

    // Check if aria-setsize changed
    let setSizeChanged = false;
    const total = getTotalItems();
    if (total !== lastAriaSetSize) {
      lastAriaSetSize = total;
      setSizeChanged = true;
    }

    // Resolve size cache and stripe function once per frame (not per item)
    const sc = getSizeCache();
    cachedStripeFn = (typeof striped === "string" && stripeIndexFn) ? stripeIndexFn() : null;

    // Render each item in range
    for (let i = range.start; i <= range.end; i++) {
      const itemIndex = i - range.start;
      const item = items[itemIndex];
      if (!item) continue;

      let isSelected = selectedIds.has(item.id);
      const isFocused = i === focusedIndex;

      const isHeader = groupHeaderFn ? groupHeaderFn(item) : false;

      const existing = rendered.get(i);

      if (existing) {
        // ── Check if row type changed (data row ↔ group header) ──
        if (existing.isGroupHeader !== isHeader) {
          pool.release(existing.element);
          rendered.delete(i);
          const tracked = isHeader
            ? renderGroupHeaderRow(item, i, sc)
            : renderRow(item, i, isSelected, isFocused, sc);
          rendered.set(i, tracked);
          needsReorder = true;
          continue;
        }

        if (isHeader) {
          // ── Group header fast path ──
          const itemChanged = existing._lastItem !== item;
          if (itemChanged) {
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
            existing._lastItem = item;
            existing.lastItemId = item.id;
          }

          const height = sc.getSize(i);
          if (existing.lastHeight !== height) {
            existing.lastHeight = height;
            existing.element.style.height = `${height}px`;
          }

        } else {
          // ── Data row path ──
          const itemChanged = existing._lastItem !== item;
          const selectedChanged = existing.lastSelected !== isSelected;
          const focusedChanged = existing.lastFocused !== isFocused;

          if (itemChanged) {
            const wasPlaceholder = existing.lastItemId != null && isPH(existing.lastItemId);
            const isPlaceholder = isPH(item.id);

            if (!isPlaceholder && claimPlaceholderSelection(selectedIds, i, item.id)) {
              isSelected = true;
            }

            const cols = currentLayout.columns;
            for (let c = 0; c < existing.cells.length && c < cols.length; c++) {
              applyCellTemplate(existing.cells[c]!, item, cols[c]!, i, isPlaceholder);
            }
            applyRowClasses(existing.element, i, isSelected, isFocused, isPlaceholder);
            existing.element.setAttribute("data-id", String(item.id));
            setAriaSelected(existing.element, isSelected);

            if (wasPlaceholder && !isPlaceholder) {
              existing.element.classList.add(replacedClass);
              setTimeout(() => {
                existing.element.classList.remove(replacedClass);
              }, 300);
            }

            existing._lastItem = item;
            existing.lastItemId = item.id;
            existing.lastSelected = isSelected;
            existing.lastFocused = isFocused;
          } else if (selectedChanged || focusedChanged) {
            applyRowClasses(existing.element, i, isSelected, isFocused, isPH(item.id));
            setAriaSelected(existing.element, isSelected);
            existing.lastSelected = isSelected;
            existing.lastFocused = isFocused;
          }

          const height = sc.getSize(i);
          if (existing.lastHeight !== height) {
            existing.lastHeight = height;
            existing.element.style.height = `${height}px`;
          }

          if (setSizeChanged) {
            existing.element.setAttribute("aria-rowindex", String(i + 2));
          }
        }
      } else {
        if (claimPlaceholderSelection(selectedIds, i, item.id)) {
          isSelected = true;
        }

        const tracked = isHeader
          ? renderGroupHeaderRow(item, i, sc)
          : renderRow(item, i, isSelected, isFocused, sc);
        rendered.set(i, tracked);
        needsReorder = true;
      }
    }

    // ── Flow positioning: padding + DOM order ──
    // Update container padding to position rows at correct scroll offsets.
    // paddingTop + visible row heights + paddingBottom = totalSize
    const totalSize = sc.getTotalSize();
    const paddingTop = range.end >= range.start ? sc.getOffset(range.start) : 0;
    const lastEnd = range.end >= range.start
      ? sc.getOffset(range.end) + sc.getSize(range.end)
      : 0;
    const paddingBottom = Math.max(0, totalSize - lastEnd);

    container.style.paddingTop = paddingTop + "px";
    container.style.paddingBottom = paddingBottom + "px";

    // Reorder DOM children to match index order when elements changed.
    // Rows are in document flow, so DOM order = visual order.
    if (needsReorder) {
      const frag = document.createDocumentFragment();
      for (let i = range.start; i <= range.end; i++) {
        const tracked = rendered.get(i);
        if (tracked) frag.appendChild(tracked.element);
      }
      container.appendChild(frag);
    }
  };

  // =========================================================================
  // Position Update (compressed scrolling)
  // =========================================================================

  // Flow rendering positions rows via container padding, not per-element
  // transforms. Compressed scrolling (scale plugin) is not compatible with
  // flow mode — positions would need to change on every scroll frame,
  // causing layout shifts. This is a no-op.
  const updatePositions = (_compressionCtx: CompressionContext): void => {};

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
    existing._lastItem = item;
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
    container.style.paddingTop = "";
    container.style.paddingBottom = "";
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
