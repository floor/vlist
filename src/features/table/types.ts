/**
 * vlist/table - Types
 * Types for data table layout with columns, resizable headers, and cell rendering.
 *
 * A table transforms a flat list of items into rows of cells:
 * - Each row corresponds to one item (1:1 mapping, unlike grid)
 * - Each cell is positioned horizontally according to its column definition
 * - A sticky header row displays column labels and resize handles
 * - Columns can be resized by dragging header borders
 * - Variable row heights are supported (Mode A and Mode B)
 */

import type { VListItem } from "../../types";

// =============================================================================
// Column Definition
// =============================================================================

/** Definition for a single table column */
export interface TableColumn<T extends VListItem = VListItem> {
  /** Unique column key — used for identification and as default item property accessor */
  key: string;

  /** Header label — string or DOM element */
  label: string | HTMLElement;

  /**
   * Initial column width in pixels.
   * If omitted, remaining space is distributed equally among columns without a width.
   */
  width?: number;

  /** Minimum column width in pixels (default: 50) */
  minWidth?: number;

  /** Maximum column width in pixels (default: Infinity) */
  maxWidth?: number;

  /**
   * Whether this column can be resized (default: inherits from TableConfig.resizable).
   * Set to `false` to lock a specific column's width.
   */
  resizable?: boolean;

  /**
   * Cell template — renders the cell content for this column.
   *
   * If omitted, the cell displays `String(item[column.key])` as text content.
   *
   * @param item - The row's data item
   * @param column - This column definition (for context)
   * @param rowIndex - The flat item index in the data array
   * @returns HTML string or DOM element for the cell
   */
  cell?: (item: T, column: TableColumn<T>, rowIndex: number) => string | HTMLElement;

  /**
   * Header template — custom render for the header cell.
   *
   * If omitted, the header displays `column.label` (string or element).
   *
   * @param column - This column definition
   * @returns HTML string or DOM element for the header cell
   */
  header?: (column: TableColumn<T>) => string | HTMLElement;

  /** Text alignment within cells (default: 'left') */
  align?: "left" | "center" | "right";

  /**
   * Whether clicking this column's header emits a sort event (default: false).
   * The table feature does NOT sort data — it emits `column:sort` and the
   * consumer is responsible for reordering items via `setItems()`.
   */
  sortable?: boolean;

  /**
   * Pin this column to the left or right edge.
   * Pinned columns stay visible while the rest scroll horizontally.
   * (Reserved for future use — not implemented in v1.)
   */
  pin?: "left" | "right";
}

// =============================================================================
// Table Configuration
// =============================================================================

/** Configuration for the withTable feature */
export interface TableConfig<T extends VListItem = VListItem> {
  /** Column definitions (required, at least one column) */
  columns: TableColumn<T>[];

  /**
   * Row height in pixels (required).
   *
   * - `number` — Fixed height for all rows (fast path)
   * - `(index: number) => number` — Variable height per row
   *
   * For auto-measured variable heights, use `estimatedRowHeight` instead.
   */
  rowHeight: number | ((index: number) => number);

  /**
   * Estimated row height for auto-measurement (Mode B).
   *
   * When set, rows are rendered at this estimated height, then measured
   * via ResizeObserver and corrected. Takes precedence only when
   * `rowHeight` is a single number — if `rowHeight` is a function, this
   * is ignored.
   *
   * Use for tables with wrapping text or dynamic cell content.
   */
  estimatedRowHeight?: number;

  /** Header row height in pixels (default: same as rowHeight when fixed, or 40) */
  headerHeight?: number;

  /** Enable column resizing globally (default: true) */
  resizable?: boolean;

  /** Default minimum column width in pixels (default: 50) */
  minColumnWidth?: number;

  /** Default maximum column width in pixels (default: Infinity) */
  maxColumnWidth?: number;

  /** Show vertical borders between columns (default: false) */
  columnBorders?: boolean;

  /** Show horizontal borders between rows (default: true) */
  rowBorders?: boolean;

  /**
   * Sort indicator for a column.
   * The table renders an indicator in the header but does NOT sort data.
   * Update this and call the exposed `updateColumns()` method to reflect changes.
   */
  sort?: {
    /** Column key currently sorted by */
    key: string;
    /** Sort direction */
    direction: "asc" | "desc";
  };
}

// =============================================================================
// Resolved Column (internal — widths computed)
// =============================================================================

/** Column with resolved pixel width (internal use) */
export interface ResolvedColumn<T extends VListItem = VListItem> {
  /** Original column definition */
  def: TableColumn<T>;

  /** Index in the columns array */
  index: number;

  /** Resolved width in pixels */
  width: number;

  /** Resolved minimum width */
  minWidth: number;

  /** Resolved maximum width */
  maxWidth: number;

  /** Whether this column is resizable */
  resizable: boolean;

  /** Left offset in pixels (cumulative) */
  offset: number;
}

// =============================================================================
// Table Layout
// =============================================================================

/**
 * TableLayout — manages column widths, offsets, and resize operations.
 *
 * Columns are laid out left-to-right. When the total column width exceeds
 * the container width, the table scrolls horizontally. When columns fit
 * within the container, remaining space is distributed.
 */
export interface TableLayout<T extends VListItem = VListItem> {
  /** Current resolved columns (with computed widths and offsets) */
  readonly columns: readonly ResolvedColumn<T>[];

  /** Total width of all columns in pixels */
  readonly totalWidth: number;

  /** Resolve column widths given available container width */
  resolve: (containerWidth: number) => void;

  /** Update column definitions (e.g., after reorder or config change) */
  updateColumns: (columns: TableColumn<T>[]) => void;

  /**
   * Resize a column by index.
   * Clamps to min/max width. Recalculates offsets for subsequent columns.
   * Returns the actual new width after clamping.
   */
  resizeColumn: (columnIndex: number, newWidth: number) => number;

  /** Get the resolved column at a given index */
  getColumn: (index: number) => ResolvedColumn<T> | undefined;

  /** Get the column whose horizontal range contains `x` pixels from left */
  getColumnAtX: (x: number) => ResolvedColumn<T> | undefined;

  /** Get the X offset for a column */
  getColumnOffset: (columnIndex: number) => number;

  /** Get the width for a column */
  getColumnWidth: (columnIndex: number) => number;
}

// =============================================================================
// Table Header
// =============================================================================

/**
 * TableHeader — manages the sticky header row above the viewport.
 *
 * The header is a positioned DOM element containing one cell per column.
 * It stays fixed at the top while rows scroll beneath it. Resize handles
 * are rendered at column borders for drag-to-resize interaction.
 */
export interface TableHeader<T extends VListItem = VListItem> {
  /** The header DOM element */
  readonly element: HTMLElement;

  /** Update header cell positions and widths (call after layout.resolve) */
  update: (layout: TableLayout<T>) => void;

  /** Update sort indicator display */
  updateSort: (key: string | null, direction: "asc" | "desc") => void;

  /** Rebuild header cells (call after column definitions change) */
  rebuild: (layout: TableLayout<T>) => void;

  /** Show the header */
  show: () => void;

  /** Hide the header */
  hide: () => void;

  /** Destroy and remove header DOM */
  destroy: () => void;
}

// =============================================================================
// Table Renderer
// =============================================================================

/**
 * TableRenderer — renders virtualized rows with cell-based layout.
 *
 * Each row is an absolutely positioned element (like the list renderer),
 * containing child elements for each cell. Cells are sized and positioned
 * according to the resolved column layout.
 */
export interface TableRenderer<T extends VListItem = VListItem> {
  /** Render rows for a range, with cell-based layout */
  render: (
    items: T[],
    range: import("../../types").Range,
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
// Table Events (emitted via the vlist emitter)
// =============================================================================

/** Payload for column:resize event */
export interface ColumnResizeEvent {
  /** Column key */
  key: string;

  /** Column index */
  index: number;

  /** Previous width in pixels */
  previousWidth: number;

  /** New width in pixels */
  width: number;
}

/** Payload for column:sort event */
export interface ColumnSortEvent {
  /** Column key */
  key: string;

  /** Column index */
  index: number;

  /** Current sort direction (toggles on each click: null → asc → desc → null) */
  direction: "asc" | "desc" | null;
}

/** Payload for column:click event */
export interface ColumnClickEvent {
  /** Column key */
  key: string;

  /** Column index */
  index: number;

  /** Original mouse event */
  event: MouseEvent;
}