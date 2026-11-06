/**
 * vlist/table - Header
 * Manages the sticky header row that sits above the scrolling viewport.
 *
 * The header is a positioned DOM element inserted into the vlist root
 * container (above the viewport, like the sticky group header). It contains
 * one cell per column, each showing the column label. Resize handles are
 * rendered at the right edge of each resizable column's header cell.
 *
 * Layout:
 *   .vlist (root, position: relative)
 *   ├── .vlist-table-header (position: absolute, top: 0, z-index: 5)
 *   │   ├── .vlist-table-header-cell [col 0]
 *   │   │   ├── .vlist-table-header-content (label)
 *   │   │   ├── .vlist-table-header-sort (sort indicator)
 *   │   │   └── .vlist-table-header-resize (drag handle)
 *   │   ├── .vlist-table-header-cell [col 1]
 *   │   │   └── ...
 *   │   └── ...
 *   └── .vlist-viewport (scrollable, top offset by headerHeight)
 *
 * Resize interaction:
 *   mousedown on handle → pointermove updates column width → pointerup commits
 *   During drag, a class is added to the root for cursor override.
 *
 * Sort interaction:
 *   click on a sortable header cell emits column:sort via the provided callback.
 *   The header renders a visual indicator (▲/▼) for the active sort column.
 *
 * Horizontal scroll sync:
 *   The header's scrollLeft is kept in sync with the viewport's scrollLeft
 *   via the `syncScroll` method, called from the feature's afterScroll hook.
 */

import type { VListItem } from "../../types";
import type {
  TableLayout,
  TableHeader,
  ResolvedColumn,
  ColumnSortEvent,
  ColumnClickEvent,
} from "./types";

// =============================================================================
// Constants
// =============================================================================

/**
 * The core's focusable set (src/core/dom.ts). An event that lands on one of
 * these inside a header cell belongs to it, not to the header: a caller's
 * button in a label opens its own menu instead of sorting the column.
 */
const INTERACTIVE = "a[href],button,input,select,textarea,[tabindex]";

/** Minimum drag distance (px) before resize is committed */
const MIN_DRAG_DELTA = 1;

/** Keyboard resize step in pixels */
const RESIZE_STEP = 10;

/** Sort indicator characters */
const SORT_ASC = "\u25B2"; // ▲
const SORT_DESC = "\u25BC"; // ▼

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a TableHeader instance.
 *
 * @param root - The vlist root element (.vlist)
 * @param headerHeight - Height of the header row in pixels
 * @param classPrefix - CSS class prefix (default: 'vlist')
 * @param onResize - Callback when a column is resized (receives column index and new width)
 * @param onSort - Callback when a sortable header is clicked
 * @param onClick - Callback when any header cell is clicked
 * @returns TableHeader instance
 */
export const createTableHeader = <T extends VListItem = VListItem>(
  root: HTMLElement,
  headerHeight: number,
  classPrefix: string,
  onResize: (columnIndex: number, newWidth: number) => void,
  onSort?: (event: ColumnSortEvent) => void,
  onClick?: (event: ColumnClickEvent) => void,
): TableHeader<T> => {
  // =========================================================================
  // DOM Setup
  // =========================================================================

  // Rowgroup wrapper — ensures the header row sits inside a proper
  // ARIA rowgroup within the grid (dom.root has role="grid").
  const rowgroup = document.createElement("div");
  rowgroup.setAttribute("role", "rowgroup");

  const element = document.createElement("div");
  element.className = `${classPrefix}-table-header`;
  element.setAttribute("role", "row");
  element.setAttribute("aria-rowindex", "1");

  // Only dynamic style — height comes from config
  element.style.height = `${headerHeight}px`;

  // Scroll container inside the header — this is what we scroll in sync
  // with the viewport for horizontal scrolling.
  const scrollContainer = document.createElement("div");
  scrollContainer.className = `${classPrefix}-table-header-scroll`;
  scrollContainer.setAttribute("role", "presentation");
  element.appendChild(scrollContainer);

  // Insert header rowgroup as first child of root (above viewport)
  rowgroup.appendChild(element);
  root.insertBefore(rowgroup, root.firstChild);

  // Expose the header height as a CSS variable on the root so the custom
  // scrollbar (if active) can offset its track below the header row.
  // The viewport layout is handled entirely by CSS flex — no inline style needed.
  root.style.setProperty('--vlist-table-header-height', `${headerHeight}px`);

  // =========================================================================
  // State
  // =========================================================================

  let cells: HTMLElement[] = [];
  let sortIndicators: (HTMLElement | null)[] = [];
  let currentSortKey: string | null = null;
  let currentSortDirection: "asc" | "desc" = "asc";
  let currentLayout: TableLayout<T> | null = null;

  // Drag state
  let isDragging = false;
  let dragColumnIndex = -1;
  let dragStartX = 0;
  let dragStartWidth = 0;

  // Keyboard focus state (roving tabindex)
  let focusedCellIndex = 0;

  const setTabStop = (index: number): void => {
    cells[focusedCellIndex]?.setAttribute("tabindex", "-1");
    focusedCellIndex = index;
    if (cells[index]) cells[index]!.tabIndex = 0;
  };

  const findCellIndex = (target: EventTarget | null): number => {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>("[data-column-key]");
    return cell ? cells.indexOf(cell) : -1;
  };

  // =========================================================================
  // Cell Creation
  // =========================================================================

  /**
   * Create a single header cell element for a resolved column.
   */
  const createCell = (col: ResolvedColumn<T>, colIndex: number): HTMLElement => {
    const cell = document.createElement("div");
    cell.className = `${classPrefix}-table-header-cell`;
    cell.setAttribute("role", "columnheader");
    cell.setAttribute("aria-colindex", String(colIndex + 1));
    cell.tabIndex = colIndex ? -1 : 0;
    cell.dataset.columnKey = col.def.key;

    // Alignment modifier class (left is the default — no class needed)
    const align = col.def.align;
    if (align === "center" || align === "right") {
      cell.classList.add(`${classPrefix}-table-header-cell--${align}`);
    }

    // Content wrapper
    const content = document.createElement("div");
    content.className = `${classPrefix}-table-header-content`;

    // Render label
    const label = col.def.header
      ? col.def.header(col.def)
      : col.def.label;

    if (typeof label === "string") {
      content.textContent = label;
    } else {
      content.appendChild(label);
    }
    cell.appendChild(content);

    // Sort indicator — only created for sortable columns (avoids unnecessary DOM nodes)
    if (col.def.sortable) {
      const sortIndicator = document.createElement("span");
      sortIndicator.className = `${classPrefix}-table-header-sort`;
      sortIndicator.setAttribute("aria-hidden", "true");
      cell.appendChild(sortIndicator);
      sortIndicators.push(sortIndicator);
      cell.classList.add(`${classPrefix}-table-header-cell--sortable`);
    } else {
      // Keep index alignment with columns array
      sortIndicators.push(null);
    }

    // Resize handle (at right edge)
    if (col.resizable) {
      const handle = document.createElement("div");
      handle.className = `${classPrefix}-table-header-resize`;
      handle.dataset.resizeIndex = String(colIndex);

      cell.appendChild(handle);
    }

    return cell;
  };

  // =========================================================================
  // Build / Rebuild
  // =========================================================================

  /**
   * Build all header cells from a layout.
   */
  const rebuild = (layout: TableLayout<T>): void => {
    currentLayout = layout;

    // Clear existing cells
    scrollContainer.textContent = "";
    cells = [];
    sortIndicators = [];
    // Rebuilt cells start with their one tab stop on the first column.
    focusedCellIndex = 0;

    const columns = layout.columns;

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!;
      const cell = createCell(col, i);
      cells.push(cell);
      scrollContainer.appendChild(cell);
    }

    // Apply widths and offsets
    update(layout);

    // Restore sort indicator if active
    if (currentSortKey) {
      updateSort(currentSortKey, currentSortDirection);
    }
  };

  // =========================================================================
  // Update (positions & widths)
  // =========================================================================

  /**
   * Update header cell widths to match the layout.
   * Called after layout.resolve() or after a resize.
   */
  const update = (layout: TableLayout<T>): void => {
    currentLayout = layout;
    const columns = layout.columns;

    // Set scroll container to total column width
    scrollContainer.style.width = `${layout.totalWidth}px`;

    for (let i = 0; i < cells.length && i < columns.length; i++) {
      const cell = cells[i]!;
      const col = columns[i]!;
      cell.style.width = `${col.width}px`;
    }
  };

  // =========================================================================
  // Sort Indicator
  // =========================================================================

  /**
   * Update the sort indicator on header cells.
   *
   * @param key - Column key to show sort on, or null to clear
   * @param direction - Sort direction
   */
  const updateSort = (key: string | null, direction: "asc" | "desc"): void => {
    currentSortKey = key;
    currentSortDirection = direction;

    if (!currentLayout) return;

    const columns = currentLayout.columns;

    for (let i = 0; i < sortIndicators.length && i < columns.length; i++) {
      const indicator = sortIndicators[i];
      if (!indicator) continue;

      const active = columns[i]!.def.key === key;
      indicator.textContent = active ? (direction === "asc" ? SORT_ASC : SORT_DESC) : "";
      indicator.style.opacity = active ? "0.7" : "0";
      if (active) {
        cells[i]!.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
      } else {
        cells[i]!.removeAttribute("aria-sort");
      }
    }
  };

  // =========================================================================
  // Horizontal Scroll Sync
  // =========================================================================

  /**
   * Synchronize header scroll position with the viewport.
   * Call this from the feature's scroll handler.
   */
  const syncScroll = (scrollLeft: number): void => {
    scrollContainer.style.transform = `translateX(${-scrollLeft}px)`;
  };

  // =========================================================================
  // Resize Interaction (Pointer Events)
  // =========================================================================

  const onPointerDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.dataset.resizeIndex) return;

    e.preventDefault();
    e.stopPropagation();

    dragColumnIndex = +target.dataset.resizeIndex!;
    const col = currentLayout?.getColumn(dragColumnIndex);
    if (!col?.resizable) return;

    isDragging = true;
    dragStartX = e.clientX;
    dragStartWidth = col.width;

    // Set cursor on the root to avoid flickering during drag
    root.classList.add(`${classPrefix}--col-resizing`);
    root.style.cursor = "col-resize";

    // Highlight the active resize handle
    target.classList.add(`${classPrefix}-table-header-resize--active`);

    // Capture pointer for tracking outside the element
    target.setPointerCapture(e.pointerId);

    // Bind move and up handlers
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging || !currentLayout) return;

    const delta = e.clientX - dragStartX;
    if (Math.abs(delta) < MIN_DRAG_DELTA) return;

    onResize(dragColumnIndex, Math.max(0, dragStartWidth + delta));
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!isDragging) return;

    const target = e.target as HTMLElement;

    // Remove move/up listeners
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);

    // Release pointer capture
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may have been released already
    }

    // Reset drag handle highlight
    target.classList.remove(`${classPrefix}-table-header-resize--active`);

    // Reset cursor
    root.classList.remove(`${classPrefix}--col-resizing`);
    root.style.cursor = "";

    isDragging = false;
    dragColumnIndex = -1;
  };

  // =========================================================================
  // Click & Sort Interaction
  // =========================================================================

  const emitSort = (col: ResolvedColumn<T> | undefined, index: number): boolean => {
    if (!col?.def.sortable || !onSort) return false;
    const key = col.def.key;
    const direction = currentSortKey === key
      ? (currentSortDirection === "asc" ? "desc" : null)
      : "asc";
    onSort({ key, index, direction });
    return true;
  };

  const onCellClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.dataset.resizeIndex || isDragging || !currentLayout) return;

    const colIndex = findCellIndex(target);
    if (colIndex === -1) return;

    // A control the caller supplied inside the cell (a button in the label)
    // owns its own clicks; only the cell itself, its text and our own
    // indicator sort the column.
    const control = target.closest(INTERACTIVE);
    if (control && control !== cells[colIndex]) return;

    const col = currentLayout.columns[colIndex]!;
    onClick?.({ key: col.def.key, index: colIndex, event: e });
    emitSort(col, colIndex);
  };

  // =========================================================================
  // Keyboard Navigation (roving tabindex on header cells)
  // =========================================================================

  // Focus can arrive without the arrow keys: a click focuses the clicked
  // cell (mousedown's default action on its tabindex), a programmatic
  // focus() does too, and a control inside a label takes focus into the
  // cell. Wherever focus lands the index follows it, so Enter, Space and
  // Ctrl+Arrow act on the cell the user is on (#348).
  const onFocusIn = (e: FocusEvent): void => {
    const idx = findCellIndex(e.target);
    if (idx >= 0) setTabStop(idx);
  };

  const moveFocusToCell = (index: number): void => {
    if (index < 0 || index >= cells.length) return;
    setTabStop(index);
    cells[index]!.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key;

    // Keys aimed at interactive content inside a cell are that content's own:
    // the header must not move focus or sort out from under a focused button.
    const control = (e.target as HTMLElement).closest(INTERACTIVE);
    if (control && !control.hasAttribute("data-column-key")) return;

    if (key === "ArrowRight" || key === "ArrowLeft") {
      const dir = key === "ArrowRight" ? 1 : -1;
      if (e.ctrlKey || e.metaKey) {
        const col = currentLayout?.getColumn(focusedCellIndex);
        if (col?.resizable) {
          onResize(focusedCellIndex, col.width + dir * RESIZE_STEP);
          e.preventDefault();
        }
      } else {
        const next = focusedCellIndex + dir;
        if (next >= 0 && next < cells.length) {
          moveFocusToCell(next);
          e.preventDefault();
        }
      }
      e.stopPropagation();
      return;
    }

    if (key === "Home" || key === "End") {
      moveFocusToCell(key === "Home" ? 0 : cells.length - 1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (key === "Enter" || key === " ") {
      if (emitSort(currentLayout?.getColumn(focusedCellIndex), focusedCellIndex)) {
        e.preventDefault();
      }
      e.stopPropagation();
      return;
    }

    if (key === "ArrowDown") {
      root.focus();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // =========================================================================
  // Event Binding
  // =========================================================================

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("click", onCellClick);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("focusin", onFocusIn);

  // =========================================================================
  // Visibility
  // =========================================================================

  const show = (): void => {
    element.style.display = "";
  };

  const hide = (): void => {
    element.style.display = "none";
  };

  // =========================================================================
  // Destroy
  // =========================================================================

  const destroy = (): void => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("click", onCellClick);
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("focusin", onFocusIn);

    // Clear the CSS variable set during setup
    root.style.removeProperty('--vlist-table-header-height');

    rowgroup.remove();

    cells = [];
    sortIndicators = [];
    currentLayout = null;
  };

  // =========================================================================
  // Return
  // =========================================================================

  return {
    element,
    update,
    updateSort,
    rebuild,
    show,
    hide,
    destroy,
    // Extra method exposed for scroll sync (not in interface — cast in feature)
    syncScroll,
  } as TableHeader<T> & { syncScroll: (scrollLeft: number) => void };
};
