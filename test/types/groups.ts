// Type tests for groups.getGroupForIndex.
//
// The callback's item is the list's item type, not `any`. Compiled by
// tsconfig.types.json; `bun run typecheck` fails if an assertion breaks.

import { createVListFromConfig } from "../../src/config";
import { createVList } from "../../src/core/create";
import { groups, createGroupLayout } from "../../src/plugins/groups";
import type { GroupsConfig, ItemConfig } from "../../src/types";

interface Row {
  id: number;
  name: string;
  category: string;
}

type IsAny<T> = 0 extends 1 & T ? true : false;

declare const container: HTMLElement;
const items: Row[] = [{ id: 1, name: "a", category: "A" }];
const item: ItemConfig<Row> = { height: 40, template: (row) => row.name };

// ── createVListFromConfig: inline callback receives the inferred item ────────

createVListFromConfig({
  container,
  items,
  item,
  groups: {
    getGroupForIndex: (_index, row) => {
      type ItemIsAny = IsAny<typeof row>;
      const notAny: ItemIsAny = false;
      const category: string = row!.category;
      void notAny;
      void category;
      return row!.category;
    },
  },
});

createVListFromConfig({
  container,
  items,
  item,
  groups: {
    // @ts-expect-error a callback typed for a different item is rejected
    getGroupForIndex: (_index: number, row?: { nope: string }) => row?.nope ?? "",
  },
});

createVListFromConfig({
  container,
  items,
  item,
  groups: {
    getGroupForIndex: (_index, row) => {
      // @ts-expect-error the item is Row, which has no `missing`
      return row!.missing;
    },
  },
});

// ── createVListFromConfig: optional `groups` on the input type is checked ────

declare const optionalWrong: {
  container: HTMLElement;
  items: Row[];
  item: ItemConfig<Row>;
  groups?: GroupsConfig<{ id: number; nope: string }>;
};
// @ts-expect-error optional groups still have to match the inferred item
createVListFromConfig(optionalWrong);

declare const optionalRight: {
  container: HTMLElement;
  items: Row[];
  item: ItemConfig<Row>;
  groups?: GroupsConfig<Row>;
};
createVListFromConfig(optionalRight);

// ── groups(): T flows into the callback ──────────────────────────────────────

groups<Row>({
  getGroupForIndex: (_index, row) => {
    type ItemIsAny = IsAny<typeof row>;
    const notAny: ItemIsAny = false;
    void notAny;
    return row!.category;
  },
  header: { height: 20, template: (key) => key },
});

groups<Row>({
  // @ts-expect-error a callback typed for a different item is rejected
  getGroupForIndex: (_index: number, row?: { nope: string }) => row?.nope ?? "",
  header: { height: 20, template: (key) => key },
});

// ── createGroupLayout / rebuild: getItem is T, not any ───────────────────────

const layout = createGroupLayout<Row>(
  items.length,
  {
    getGroupForIndex: (_index, row) => {
      type ItemIsAny = IsAny<typeof row>;
      const notAny: ItemIsAny = false;
      void notAny;
      return row!.category;
    },
    header: { height: 20, template: (key) => key },
  },
  (index) => items[index],
);

layout.rebuild(items.length, (index) => items[index]);
// @ts-expect-error rebuild's accessor must return Row
layout.rebuild(items.length, (_index): { nope: string } => ({ nope: "x" }));

// ── createVList + groups() keeps the item on the list ────────────────────────

const list = createVList({ container, items, item }, [
  groups<Row>({
    getGroupForIndex: (_index, row) => row!.category,
    header: { height: 20, template: (key) => key },
  }),
]);
const first: Row | undefined = list.getItemAt(0);
void first;
const groupLayout = list.getGroupLayout();
groupLayout.rebuild(items.length, (index) => items[index]);

// ── items wins over a wider template (inline and identifier) ─────────────────

interface Entity {
  id: number;
  name: string;
}

const entityTemplate = (entity: Entity): string => entity.name;

const fromIdentifier = createVListFromConfig({
  container,
  items,
  item: { height: 40, template: entityTemplate },
  groups: { getGroupForIndex: (_index, row) => row!.category },
});
const fromIdentifierItem: Row | undefined = fromIdentifier.getItemAt(0);
void fromIdentifierItem;

const fromInline = createVListFromConfig({
  container,
  items,
  item: { height: 40, template: (entity: Entity) => entity.name },
  groups: { getGroupForIndex: (_index, row) => row!.category },
});
const fromInlineItem: Row | undefined = fromInline.getItemAt(0);
void fromInlineItem;

// ── Partial type argument is still rejected ──────────────────────────────────

// @ts-expect-error createVListFromConfig<Row> requires both type parameters
createVListFromConfig<Row>({ container, items, item });
