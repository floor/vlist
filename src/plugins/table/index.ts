/**
 * vlist - Table Domain
 * Data table layout with columns, resizable headers, and cell rendering
 */

// Builder Feature
export { withTable, type TableFeatureConfig } from "./feature";

// Layout
export { createTableLayout } from "./layout";

// Header
export { createTableHeader } from "./header";

// Renderer
export { createTableRenderer, type TableRendererInstance } from "./renderer";

// Types
export type {
  TableConfig,
  TableColumn,
  TableLayout,
  TableHeader,
  TableRenderer,
  ResolvedColumn,
  ColumnResizeEvent,
  ColumnSortEvent,
  ColumnClickEvent,
} from "./types";