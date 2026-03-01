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

/** Minimum drag distance (px) before resize is committed */
const MIN_DRAG_DELTA = 1;

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
 * @param viewport - The vlist viewport element (for scroll sync)
 * @param headerHeight - Height of the header row in pixels
 * @param classPrefix - CSS class prefix (default: 'vlist')
 * @param onResize - Callback when a column is resized (receives column index and new width)
 * @param onSort - Callback when a sortable header is clicked
 * @param onClick - Callback when any header cell is clicked
 * @returns TableHeader instance
 */
export const createTableHeader = <T extends VListItem = VListItem>(
  root: HTMLElement,
  viewport: HTMLElement,
  headerHeight: number,
  classPrefix: string,
  onResize: (columnIndex: number, newWidth: number) => void,
  onSort?: (event: ColumnSortEvent) => void,
  onClick?: (event: ColumnClickEvent) => void,
): TableHeader<T> => {
  // =========================================================================
  // DOM Setup
  // =========================================================================

  const element = document.createElement("div");
  element.className = `${classPrefix}-table-header`;
  element.setAttribute("role", "row");
  element.setAttribute("aria-rowindex", "1");

  // Positioning
  element.style.position = "absolute";
  element.style.top = "0";
  element.style.left = "0";
  element.style.right = "0";
  element.style.zIndex = "5";
  element.style.height = `${headerHeight}px`;
  element.style.overflow = "hidden";
  element.style.display = "flex";
  element.style.alignItems = "stretch";
  element.style.boxSizing = "border-box";
  element.style.willChange = "scroll-position";
  element.style.contain = "layout style";

  // Scroll container inside the header — this is what we scroll in sync
  // with the viewport for horizontal scrolling.
  const scrollContainer = document.createElement("div");
  scrollContainer.className = `${classPrefix}-table-header-scroll`;
  scrollContainer.style.position = "relative";
  scrollContainer.style.display = "flex";
  scrollContainer.style.alignItems = "stretch";
  scrollContainer.style.height = "100%";
  scrollContainer.style.minWidth = "100%";
  scrollContainer.style.flexShrink = "0";
  element.appendChild(scrollContainer);

  // Insert header as first child of root (above viewport)
  root.insertBefore(element, root.firstChild);

  // Offset the viewport so content starts below the header.
  // Use position: absolute with insets so sizing works even when the
  // root's height comes from min-height / max-height (where height: 100%
  // on a static child would resolve to auto and break containment).
  viewport.style.position = "absolute";
  viewport.style.top = `${headerHeight}px`;
  viewport.style.left = "0";
  viewport.style.right = "0";
  viewport.style.bottom = "0";

  // =========================================================================
  // State
  // =========================================================================

  let cells: HTMLElement[] = [];
  let resizeHandles: HTMLElement[] = [];
  let sortIndicators: HTMLElement[] = [];
  let isVisible = true;
  let currentSortKey: string | null = null;
  let currentSortDirection: "asc" | "desc" = "asc";
  let currentLayout: TableLayout<T> | null = null;

  // Drag state
  let isDragging = false;
  let dragColumnIndex = -1;
  let dragStartX = 0;
  let dragStartWidth = 0;

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
    cell.dataset.columnKey = col.def.key;

    // Flex layout for content + sort indicator
    cell.style.position = "relative";
    cell.style.display = "flex";
    cell.style.alignItems = "center";
    cell.style.height = "100%";
    cell.style.boxSizing = "border-box";
    cell.style.overflow = "hidden";
    cell.style.flexShrink = "0";
    cell.style.userSelect = "none";

    // Text alignment
    const align = col.def.align ?? "left";
    if (align === "center") {
      cell.style.justifyContent = "center";
    } else if (align === "right") {
      cell.style.justifyContent = "flex-end";
    }

    // Content wrapper
    const content = document.createElement("div");
    content.className = `${classPrefix}-table-header-content`;
    content.style.overflow = "hidden";
    content.style.textOverflow = "ellipsis";
    content.style.whiteSpace = "nowrap";
    content.style.flex = "1";
    content.style.minWidth = "0";

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

    // Sort indicator (hidden by default)
    const sortIndicator = document.createElement("span");
    sortIndicator.className = `${classPrefix}-table-header-sort`;
    sortIndicator.style.marginLeft = "4px";
    sortIndicator.style.flexShrink = "0";
    sortIndicator.style.opacity = "0";
    sortIndicator.style.fontSize = "0.7em";
    sortIndicator.style.transition = "opacity 0.15s ease";
    sortIndicator.setAttribute("aria-hidden", "true");
    cell.appendChild(sortIndicator);
    sortIndicators.push(sortIndicator);

    // Sortable cursor
    if (col.def.sortable) {
      cell.style.cursor = "pointer";
      cell.classList.add(`${classPrefix}-table-header-cell--sortable`);
    }

    // Resize handle (at right edge)
    if (col.resizable) {
      const handle = document.createElement("div");
      handle.className = `${classPrefix}-table-header-resize`;
      handle.style.position = "absolute";
      handle.style.top = "0";
      handle.style.right = "0";
      handle.style.bottom = "0";
      handle.style.width = "6px";
      handle.style.cursor = "col-resize";
      handle.style.zIndex = "2";
      handle.style.touchAction = "none";
      // Visible affordance line
      handle.style.borderRight = "2px solid transparent";
      handle.style.transition = "border-color 0.15s ease";
      handle.dataset.resizeIndex = String(colIndex);

      cell.appendChild(handle);
      resizeHandles.push(handle);
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
    resizeHandles = [];
    sortIndicators = [];

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
      const indicator = sortIndicators[i]!;
      const col = columns[i]!;

      if (col.def.key === key && key !== null) {
        indicator.textContent = direction === "asc" ? SORT_ASC : SORT_DESC;
        indicator.style.opacity = "0.7";
        cells[i]!.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
      } else {
        indicator.textContent = "";
        indicator.style.opacity = "0";
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

    dragColumnIndex = parseInt(target.dataset.resizeIndex!, 10);
    if (!currentLayout) return;

    const col = currentLayout.getColumn(dragColumnIndex);
    if (!col || !col.resizable) return;

    isDragging = true;
    dragStartX = e.clientX;
    dragStartWidth = col.width;

    // Set cursor on the root to avoid flickering during drag
    root.classList.add(`${classPrefix}--col-resizing`);
    root.style.cursor = "col-resize";

    // Highlight the active resize handle
    target.style.borderColor = "var(--vlist-border-selected, #3b82f6)";

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

    const newWidth = Math.max(0, dragStartWidth + delta);
    onResize(dragColumnIndex, newWidth);
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
    target.style.borderColor = "transparent";

    // Reset cursor
    root.classList.remove(`${classPrefix}--col-resizing`);
    root.style.cursor = "";

    isDragging = false;
    dragColumnIndex = -1;
  };

  // =========================================================================
  // Click Interaction (Sort + General)
  // =========================================================================

  const onCellClick = (e: MouseEvent): void => {
    // Ignore clicks on resize handles
    const target = e.target as HTMLElement;
    if (target.dataset.resizeIndex !== undefined) return;
    if (isDragging) return;

    // Walk up to find the header cell
    let cell: HTMLElement | null = target;
    while (cell && !cell.dataset.columnKey) {
      cell = cell.parentElement;
      // Don't walk outside the header
      if (cell === element || cell === null) return;
    }
    if (!cell || !cell.dataset.columnKey) return;

    const key = cell.dataset.columnKey;
    if (!currentLayout) return;

    // Find the column
    const columns = currentLayout.columns;
    let colIndex = -1;
    for (let i = 0; i < columns.length; i++) {
      if (columns[i]!.def.key === key) {
        colIndex = i;
        break;
      }
    }
    if (colIndex === -1) return;

    const col = columns[colIndex]!;

    // Emit general click
    if (onClick) {
      onClick({ key, index: colIndex, event: e });
    }

    // Emit sort event for sortable columns
    if (col.def.sortable && onSort) {
      let direction: "asc" | "desc" | null;

      if (currentSortKey === key) {
        // Cycle: asc → desc → null
        if (currentSortDirection === "asc") {
          direction = "desc";
        } else {
          direction = null;
        }
      } else {
        direction = "asc";
      }

      onSort({ key, index: colIndex, direction });
    }
  };

  // =========================================================================
  // Event Binding
  // =========================================================================

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("click", onCellClick);

  // =========================================================================
  // Visibility
  // =========================================================================

  const show = (): void => {
    if (isVisible) return;
    isVisible = true;
    element.style.display = "";
  };

  const hide = (): void => {
    if (!isVisible) return;
    isVisible = false;
    element.style.display = "none";
  };

  // =========================================================================
  // Destroy
  // =========================================================================

  const destroy = (): void => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("click", onCellClick);

    // Reset viewport positioning
    viewport.style.position = "";
    viewport.style.top = "";
    viewport.style.left = "";
    viewport.style.right = "";
    viewport.style.bottom = "";

    element.remove();

    cells = [];
    resizeHandles = [];
    sortIndicators = [];
    currentLayout = null;
    isVisible = false;
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