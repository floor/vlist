/**
 * vlist - Table Domain
 * Data table layout with columns, resizable headers, and cell rendering
 */

// v2 Plugin
export { table, type TablePluginConfig } from "./plugin";
export { columnPin, type ColumnPinConfig, type ColumnPinMethods } from "./pin";
export { columnReorder, type ColumnReorderConfig, type ColumnReorderMethods } from "./reorder";
export { rowAttributes } from "./rowAttributes";
export type { TableFeature, TableFeatureMethods } from "./feature";

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
  RowAttributes,
  TableFillMode,
  TableLayout,
  TableHeader,
  TableRenderer,
  ResolvedColumn,
  ColumnResizeEvent,
  ColumnSortEvent,
  ColumnClickEvent,
  ColumnPinEvent,
  ColumnReorderEvent,
} from "./types";
export type { TableMethods } from "./plugin";
