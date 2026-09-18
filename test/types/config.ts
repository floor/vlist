// Type tests for the adapter path.
//
// `createVListFromConfig` derives the list's methods from the config's feature
// fields, the same fields `resolvePlugins` turns into plugins. One type
// parameter, the config itself, so there is no partial-type-argument trap: the
// item type is read from `items` or the template.

import { createVListFromConfig, type ConfigMethods, type VListConfig } from "../../src/config";

interface Row {
  id: number;
  name: string;
}

declare const container: HTMLElement;
const base = { container, item: { height: 40, template: (row: Row) => row.name }, items: [{ id: 1, name: "a" }] as Row[] };

// ── The item type is inferred from the config ─────────────────────────────────

const plain = createVListFromConfig(base);
const first: Row | undefined = plain.getItemAt(0);
void first;
// @ts-expect-error the item type is Row, not any
const wrong: string = plain.getItemAt(0);
void wrong;
// @ts-expect-error a plain config wires no selection
plain.select(1);

// ── Each feature field brings its plugin's methods ────────────────────────────

const selectable = createVListFromConfig({ ...base, selection: { mode: "multiple" } });
selectable.select(1);
selectable.getSelected();

const gridded = createVListFromConfig({ ...base, layout: "grid", grid: { columns: 3 } });
gridded.getGridLayout();
// @ts-expect-error a grid list has no masonry layout
gridded.getMasonryLayout();

const masoned = createVListFromConfig({ ...base, layout: "masonry", masonry: { columns: 2 } });
masoned.getMasonryLayout();

const grouped = createVListFromConfig({ ...base, groups: { getGroupForIndex: () => "a" } });
grouped.getGroupLayout();

declare const adapter: VListConfig<Row>["adapter"] & {};
const loaded = createVListFromConfig({ container, item: base.item, adapter });
void loaded.reload();
// @ts-expect-error with no items, the template names the item type
const alsoWrong: string = loaded.getItemAt(0);
void alsoWrong;

const scrolled = createVListFromConfig({ ...base, scrollbar: true });
scrolled.refreshScrollbar();

const snapped = createVListFromConfig({ ...base, snapshots: true });
snapped.getScrollSnapshot();

const measured = createVListFromConfig({ container, items: base.items, item: { estimatedHeight: 40, template: (row: Row) => row.name } });
measured.remeasure();

// ── Off is off ────────────────────────────────────────────────────────────────

const off = createVListFromConfig({ ...base, scrollbar: "none", snapshots: false });
// @ts-expect-error scrollbar: "none" wires nothing
off.refreshScrollbar();
// @ts-expect-error snapshots: false wires nothing
off.getScrollSnapshot();

// ── A widened boolean is neither: the compiler cannot know, so it says so ────

declare const maybe: boolean;
const unsure = createVListFromConfig({ ...base, snapshots: maybe });
// @ts-expect-error snapshots may be off; narrow the config or spell it as a literal
unsure.getScrollSnapshot();

// ── The escape hatch keeps its methods too ────────────────────────────────────

import { search } from "../../src/plugins/search";
import { autosize } from "../../src/plugins/autosize";
import { selection } from "../../src/plugins/selection";
const searched = createVListFromConfig({ ...base, plugins: [search<Row>()] });
searched.openSearch();

// Default-generic plugins are accepted the same way as on createVList, whether
// the template is an identifier or the config is a spread.
const tplRow = (r: Row): string => r.name;
const measuredByPlugin = createVListFromConfig({
  container,
  items: base.items,
  item: { estimatedHeight: 40, template: tplRow },
  plugins: [autosize()],
});
measuredByPlugin.remeasure();

const selectedBySpread = createVListFromConfig({ ...base, plugins: [selection()] });
selectedBySpread.select(1);

// ── The type half and the runtime half are one mapping ───────────────────────
//
// Every field resolvePlugins reads has a ConfigMethods clause. This assertion
// is what fails when a field is added on one side only.
type Wired = "adapter" | "layout" | "groups" | "selection" | "scrollbar" | "snapshots" | "plugins" | "item";
type Reads<C extends VListConfig<Row>> = ConfigMethods<Row, C>;
const _wired: Wired extends keyof VListConfig<Row> ? true : never = true;
void _wired;
type _check = Reads<VListConfig<Row>>;
