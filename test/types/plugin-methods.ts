// Type tests for plugin methods on the list instance.
//
// `createVList` infers both the item type and the plugin list, so a list exposes
// exactly the methods its plugins add. Inference needs the item type to come from
// the config (or its items), not from an explicit type argument: TypeScript does
// not allow a partial type argument list, so `createVList<Row>(config, plugins)`
// falls back to the plugin default and yields a plain `VList<Row>`.

import { createVList } from "../../src/core/create";
import type { CreateVListConfig } from "../../src/core/types";
import { selection } from "../../src/plugins/selection";
import { tree } from "../../src/plugins/tree";
import { table } from "../../src/plugins/table";
import { search } from "../../src/plugins/search";

interface Row {
  id: number;
  name: string;
}

declare const container: HTMLElement;
const config: CreateVListConfig<Row> = {
  container,
  item: { height: 40, template: (row) => row.name },
  items: [{ id: 1, name: "a" }],
};

// ── A list with plugins exposes their methods, typed ─────────────────────────

const selectable = createVList(config, [selection<Row>({ mode: "multiple" })]);
selectable.select(1, 2);
selectable.clearSelection();
const ids: Array<string | number> = selectable.getSelected();
const rows: Row[] = selectable.getSelectedItems();

const treeList = createVList(config, [tree<Row>()]);
treeList.expand(1);
const expanded: (string | number)[] = treeList.getExpanded();
const visible: number = treeList.getTreeLayout().totalVisible;

// Several plugins combine into one instance type.
const combined = createVList(config, [selection<Row>(), search<Row>({ field: "name" })]);
combined.select(1);
combined.setQuery("abc");
const matches: number[] = combined.getMatches();

const tableList = createVList(config, [table<Row>({ columns: [{ key: "name", label: "Name" }], rowHeight: 36 })]);
tableList.setSort("name", "desc");
const widths: Record<string, number> = tableList.getColumnWidths();

// Core methods keep working on a list with plugins.
const row: Row | undefined = selectable.getItemAt(0);
selectable.scrollToIndex(2, "center");

// ── A plain list exposes only the core API ───────────────────────────────────

const plain = createVList(config);
plain.scrollToIndex(3);

// @ts-expect-error select() needs the selection plugin
plain.select(1);

// @ts-expect-error expand() needs the tree plugin
plain.expand(1);

// @ts-expect-error the search plugin is not in this list
selectable.setQuery("abc");

// @ts-expect-error a mistyped plugin method does not compile
selectable.selectt(1);

// @ts-expect-error wrong argument type for a plugin method
treeList.expand({ id: 1 });

// @ts-expect-error wrong sort direction
tableList.setSort("name", "sideways");

// ── Documented caveat: an explicit item type argument skips plugin inference ──

const explicit = createVList<Row>(config, [selection<Row>()]);
explicit.scrollToIndex(0);

// @ts-expect-error explicit type argument means plugin methods are not inferred
explicit.select(1);

export { selectable, treeList, combined, tableList, plain, explicit, ids, rows, expanded, visible, matches, widths, row };
