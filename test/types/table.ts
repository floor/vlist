// Type tests for table(), TableColumn, and table features (columnPin, columnReorder).
// Compiled by tsconfig.types.json; `bun run typecheck` fails if an assertion breaks.

import {
  createVList,
  table,
  columnPin,
  columnReorder,
  type CreateVListConfig,
  type TableColumn,
} from "../../src";
import { type TableColumn as InternalsTableColumn } from "../../src/internals";
import { createVListFromConfig } from "../../src/config";

interface Row {
  id: number;
  name: string;
  role: string;
}

type IsAny<T> = 0 extends 1 & T ? true : false;

declare const container: HTMLElement;

// ── TableColumn is exported from both "vlist" and "vlist/internals" ──────────

const columns: TableColumn<Row>[] = [
  {
    key: "name",
    label: "Name",
    width: 160,
    pin: "left",
    cell: (row, col, index) => {
      type RowIsAny = IsAny<typeof row>;
      const notAny: RowIsAny = false;
      void notAny;
      const _col: TableColumn<Row> = col;
      const _idx: number = index;
      void _col;
      void _idx;
      return row.name;
    },
  },
  {
    key: "role",
    label: "Role",
    width: 120,
    reorderable: true,
    cell: (row) => row.role,
  },
];

const internalsCheck: InternalsTableColumn<Row> = columns[0]!;
void internalsCheck;

const items: Row[] = [{ id: 1, name: "Ada", role: "Engineer" }];
const baseConfig: CreateVListConfig<Row> = {
  container,
  items,
  item: { height: 40, template: (row) => row.name },
};

// ── Inferred table({ ... }) with columnPin() and columnReorder() ─────────────

const inferredBoth = createVList(baseConfig, [
  table({
    columns,
    rowHeight: 40,
    features: [columnPin(), columnReorder()],
  }),
]);
inferredBoth.setColumnPin("name", "left");
const inferredPins: Record<string, "left" | "right"> = inferredBoth.getColumnPins();
inferredBoth.moveColumn("role", 0);
const inferredOrder: string[] = inferredBoth.getColumnOrder();
inferredBoth.setSort("name", "asc");
const inferredWidths: Record<string, number> = inferredBoth.getColumnWidths();

const inferredViaConfig = createVListFromConfig({
  container,
  items,
  item: baseConfig.item,
  plugins: [
    table({
      columns,
      rowHeight: 40,
      features: [columnPin<Row>(), columnReorder<Row>()],
    }),
  ],
});
inferredViaConfig.setColumnPin("name", null);
inferredViaConfig.moveColumn(1, 0);

const inferredInlineColumns = createVList(baseConfig, [
  table({
    columns: [{ key: "name", label: "Name", cell: (row) => row.name }],
    rowHeight: 40,
    features: [columnPin(), columnReorder()],
  }),
]);
inferredInlineColumns.setColumnPin("name", "left");
inferredInlineColumns.moveColumn("name", 0);

// ── Explicit table<Row>({ ... }) keeps feature methods on the instance ───────

const explicitBoth = createVList(baseConfig, [
  table<Row>({
    columns,
    rowHeight: 40,
    features: [columnPin(), columnReorder()],
  }),
]);
explicitBoth.setColumnPin("name", "left");
const explicitPins: Record<string, "left" | "right"> = explicitBoth.getColumnPins();
explicitBoth.moveColumn("role", 0);
const explicitOrder: string[] = explicitBoth.getColumnOrder();
explicitBoth.setSort("name", "desc");
explicitBoth.updateColumns(columns);

const explicitTypedFeatures = createVListFromConfig({
  container,
  items,
  item: baseConfig.item,
  plugins: [
    table<Row>({
      columns,
      rowHeight: 40,
      features: [columnPin<Row>(), columnReorder<Row>()],
    }),
  ],
});
explicitTypedFeatures.setColumnPin("name", "right");
explicitTypedFeatures.moveColumn("role", 0);

const explicitReversed = createVList(baseConfig, [
  table<Row>({
    columns: [{ key: "name", label: "Name", cell: (row) => row.name }],
    rowHeight: 40,
    features: [columnReorder(), columnPin()],
  }),
]);
explicitReversed.setColumnPin("name", "left");
explicitReversed.moveColumn("role", 0);

// ── Single-feature tables expose only the mounted feature's methods ──────────

const explicitPinOnly = createVList(baseConfig, [
  table<Row>({
    columns,
    rowHeight: 40,
    features: [columnPin()],
  }),
]);
explicitPinOnly.setColumnPin("name", "left");
// @ts-expect-error columnReorder() was not passed to features
explicitPinOnly.moveColumn("role", 0);

const explicitReorderOnly = createVList(baseConfig, [
  table<Row>({
    columns,
    rowHeight: 40,
    features: [columnReorder()],
  }),
]);
explicitReorderOnly.moveColumn("role", 0);
// @ts-expect-error columnPin() was not passed to features
explicitReorderOnly.setColumnPin("name", "left");

const inferredPinOnly = createVList(baseConfig, [
  table({
    columns,
    rowHeight: 40,
    features: [columnPin()],
  }),
]);
inferredPinOnly.setColumnPin("name", "left");
// @ts-expect-error columnReorder() was not passed to features
inferredPinOnly.moveColumn("role", 0);

// ── Plain table<Row>({ ... }) without features exposes only TableMethods ─────

const explicitPlain = createVList(baseConfig, [
  table<Row>({
    columns,
    rowHeight: 40,
  }),
]);
explicitPlain.setSort("name", "asc");
// @ts-expect-error columnPin() was not passed to features
explicitPlain.setColumnPin("name", "left");
// @ts-expect-error columnReorder() was not passed to features
explicitPlain.moveColumn("role", 0);

export {
  inferredBoth,
  inferredPins,
  inferredOrder,
  inferredWidths,
  inferredViaConfig,
  explicitBoth,
  explicitPins,
  explicitOrder,
  explicitTypedFeatures,
  explicitReversed,
  explicitPinOnly,
  explicitReorderOnly,
  inferredPinOnly,
  explicitPlain,
};
