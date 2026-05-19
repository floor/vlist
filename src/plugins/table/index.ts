/**
 * vlist - Table Domain
 * Data table layout with columns, resizable headers, and cell rendering
 */

// v2 Plugin
export { table, type TablePluginConfig } from "./plugin";

// Builder Feature (v1 — deprecated)
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