/**
 * vlist - Table Domain
 * Data table layout with columns, resizable headers, and cell rendering
 */

// v2 Plugin
export { table, type TablePluginConfig } from "./plugin";
export { columnPin, type ColumnPinPluginConfig, type ColumnPinMethods } from "./pin";

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
  TableSort,
  TableFillMode,
  TableLayout,
  TableHeader,
  TableRenderer,
  ResolvedColumn,
  ColumnResizeEvent,
  ColumnSortEvent,
  ColumnClickEvent,
  ColumnPinEvent,
} from "./types";
export type { TableMethods } from "./plugin";
