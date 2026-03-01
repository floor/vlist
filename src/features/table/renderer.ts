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
import type { TableLayout, ResolvedColumn, TableColumn } from "./types";

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

  /** Clear all rendered rows */
  clear: () => void;

  /** Destroy renderer and cleanup */
  destroy: () => void;
}

// =============================================================================
// Element Pool (row-level)
// =============================================================================

interface ElementPool {
  acquire: () => HTMLElement;
  release: (element: HTMLElement) => void;
  clear: () => void;
}

const createElementPool = (maxSize: number = 200): ElementPool => {
  const pool: HTMLElement[] = [];

  const acquire = (): HTMLElement => {
    const element = pool.pop();
    if (element) {
      return element;
    }
    return document.createElement("div");
  };

  const release = (element: HTMLElement): void => {
    // Remove from DOM immediately
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }

    if (pool.length < maxSize) {
      // Reset for reuse — clear dynamic attributes and child elements.
      // Child clearing is critical: when column count changes, reused
      // elements must not carry stale cells from a previous layout.
      element.className = "";
      element.removeAttribute("data-id");
      element.removeAttribute("data-index");
      element.removeAttribute("aria-selected");
      element.removeAttribute("aria-rowindex");
      element.removeAttribute("role");
      element.style.cssText = "";
      element.textContent = "";
      pool.push(element);
    }
  };

  const clear = (): void => {
    pool.length = 0;
  };

  return { acquire, release, clear };
};

// =============================================================================
// Constants
// =============================================================================

/** Grace period frames before a released element is returned to the pool */
const RELEASE_GRACE = 2;

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

  /** Last rendered item ID (for change detection) */
  lastItemId: string | number;

  /** Last selected state */
  lastSelected: boolean;

  /** Last focused state */
  lastFocused: boolean;

  /** Last translateY offset in pixels (numeric for fast comparison) */
  lastOffset: number;

  /** Frame counter when last seen in render range */
  lastSeenFrame: number;
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
  sizeCache: SizeCache,
  layout: TableLayout<T>,
  _columns: TableColumn<T>[],
  classPrefix: string,
  ariaIdPrefix: string,
  getTotalItems: () => number,
): TableRendererInstance<T> => {
  const pool = createElementPool();
  const rendered = new Map<number, TrackedRow>();

  let frameCounter = 0;
  let lastAriaSetSize = -1;
  let currentLayout = layout;

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Toggle aria-selected attribute — avoids repeating the pattern 5 times */
  const setAriaSelected = (el: HTMLElement, selected: boolean): void => {
    if (selected) el.setAttribute("aria-selected", "true");
    else el.removeAttribute("aria-selected");
  };

  // =========================================================================
  // CSS Classes (precomputed)
  // =========================================================================

  const rowClass = `${classPrefix}-item ${classPrefix}-table-row`;
  const selectedClass = `${classPrefix}-item--selected`;
  const focusedClass = `${classPrefix}-item--focused`;
  const cellClass = `${classPrefix}-table-cell`;
  const cellCenterClass = `${classPrefix}-table-cell--center`;
  const cellRightClass = `${classPrefix}-table-cell--right`;

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
      cell.textContent = value != null ? String(value) : "";
    }
  };

  /**
   * Apply CSS classes to a row element based on state.
   */
  const applyRowClasses = (
    element: HTMLElement,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    let className = rowClass;
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
   * Render a full row: create element, set cells, apply state.
   * Returns a TrackedRow for the rendered map.
   */
  const renderRow = (
    item: T,
    index: number,
    isSelected: boolean,
    isFocused: boolean,
  ): TrackedRow => {
    const element = pool.acquire();

    // Dynamic row styles (width, height, transform are per-row)
    element.style.width = `${currentLayout.totalWidth}px`;

    // Row height from size cache
    const height = sizeCache.getSize(index);
    element.style.height = `${height}px`;

    // Apply classes
    applyRowClasses(element, isSelected, isFocused);

    // ARIA attributes
    element.setAttribute("role", "row");
    element.setAttribute("data-id", String(item.id));
    element.setAttribute("data-index", String(index));
    element.id = `${ariaIdPrefix}-${index}`;
    element.setAttribute("aria-rowindex", String(index + 2)); // +2: header is row 1

    const total = getTotalItems();
    if (total !== lastAriaSetSize) {
      lastAriaSetSize = total;
    }

    setAriaSelected(element, isSelected);

    // Create cells
    const cells = ensureCells(element, []);
    const cols = currentLayout.columns;

    for (let i = 0; i < cells.length && i < cols.length; i++) {
      const cell = cells[i]!;
      const col = cols[i]!;

      // Dynamic per-column styles (position and size)
      cell.style.left = `${col.offset}px`;
      cell.style.width = `${col.width}px`;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(i + 1));

      // Alignment (CSS class toggle)
      applyCellAlign(cell, col);

      // Content
      applyCellTemplate(cell, item, col, index);
    }

    // Position row via translateY from size cache
    const offset = sizeCache.getOffset(index);
    element.style.transform = `translateY(${offset}px)`;

    return {
      element,
      cells,
      index,
      lastItemId: item.id,
      lastSelected: isSelected,
      lastFocused: isFocused,
      lastOffset: offset,
      lastSeenFrame: frameCounter,
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
  ): void => {
    frameCounter++;

    // Release items outside the new range, with grace period to prevent
    // boundary thrashing (hover blink, CSS transition replay).
    for (const [index, tracked] of rendered) {
      if (index >= range.start && index <= range.end) {
        tracked.lastSeenFrame = frameCounter;
      } else if (frameCounter - tracked.lastSeenFrame > RELEASE_GRACE) {
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

    // Render each item in range
    for (let i = range.start; i <= range.end; i++) {
      // Items array is 0-indexed relative to range.start
      const itemIndex = i - range.start;
      const item = items[itemIndex];
      if (!item) continue;

      const isSelected = selectedIds.has(item.id);
      const isFocused = i === focusedIndex;

      const existing = rendered.get(i);

      if (existing) {
        // ── Fast path: skip work when nothing changed ──
        const idChanged = existing.lastItemId !== item.id;
        const selectedChanged = existing.lastSelected !== isSelected;
        const focusedChanged = existing.lastFocused !== isFocused;

        if (idChanged) {
          // Different item at this index — full re-render of cells
          const cols = currentLayout.columns;
          for (let c = 0; c < existing.cells.length && c < cols.length; c++) {
            applyCellTemplate(existing.cells[c]!, item, cols[c]!, i);
          }
          applyRowClasses(existing.element, isSelected, isFocused);
          existing.element.setAttribute("data-id", String(item.id));
          setAriaSelected(existing.element, isSelected);
          existing.lastItemId = item.id;
          existing.lastSelected = isSelected;
          existing.lastFocused = isFocused;
        } else if (selectedChanged || focusedChanged) {
          // Same item — only update classes/aria if state changed
          applyRowClasses(existing.element, isSelected, isFocused);
          setAriaSelected(existing.element, isSelected);
          existing.lastSelected = isSelected;
          existing.lastFocused = isFocused;
        }

        // Position update only when offset changed (numeric comparison — no string allocation)
        const offset = sizeCache.getOffset(i);
        if (existing.lastOffset !== offset) {
          existing.lastOffset = offset;
          existing.element.style.transform = `translateY(${offset}px)`;
        }

        // Update row height (variable heights may have changed)
        const height = sizeCache.getSize(i);
        existing.element.style.height = `${height}px`;

        // Update row width if layout changed
        existing.element.style.width = `${currentLayout.totalWidth}px`;

        // Update ARIA set size if changed
        if (setSizeChanged) {
          existing.element.setAttribute("aria-rowindex", String(i + 2));
        }

        existing.lastSeenFrame = frameCounter;
      } else {
        // New row — create and collect in fragment for batched insertion
        const tracked = renderRow(item, i, isSelected, isFocused);
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
  // Single Item Update
  // =========================================================================

  /**
   * Update a single row (e.g., after data change).
   */
  const updateItem = (
    index: number,
    item: T,
    isSelected: boolean,
    isFocused: boolean,
  ): void => {
    const existing = rendered.get(index);
    if (!existing) return;

    const idChanged = existing.lastItemId !== item.id;
    const selectedChanged = existing.lastSelected !== isSelected;
    const focusedChanged = existing.lastFocused !== isFocused;

    if (idChanged || selectedChanged || focusedChanged) {
      if (idChanged) {
        const cols = currentLayout.columns;
        for (let c = 0; c < existing.cells.length && c < cols.length; c++) {
          applyCellTemplate(existing.cells[c]!, item, cols[c]!, index);
        }
        existing.element.setAttribute("data-id", String(item.id));
        existing.lastItemId = item.id;
      }

      applyRowClasses(existing.element, isSelected, isFocused);
      setAriaSelected(existing.element, isSelected);
      existing.lastSelected = isSelected;
      existing.lastFocused = isFocused;
    }
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

    const selectedChanged = existing.lastSelected !== isSelected;
    const focusedChanged = existing.lastFocused !== isFocused;

    if (selectedChanged || focusedChanged) {
      applyRowClasses(existing.element, isSelected, isFocused);
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
      // Update row width
      tracked.element.style.width = `${layout.totalWidth}px`;

      // Update each cell's position and width
      for (let i = 0; i < tracked.cells.length && i < cols.length; i++) {
        const cell = tracked.cells[i]!;
        const col = cols[i]!;
        cell.style.left = `${col.offset}px`;
        cell.style.width = `${col.width}px`;
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
    frameCounter = 0;
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
    clear,
    destroy,
  };
};