// Type tests for the public item constraint. Compiled by tsconfig.types.json under
// the library's strict settings; `bun run typecheck` fails if an assertion breaks.

import { createVList } from "../../src/core/create";
import type { VListItem } from "../../src/types";

// An ordinary interface satisfies VListItem: no index signature required.
interface Row {
  id: number;
  name: string;
}

// A type alias with the same shape works too.
type RowAlias = { id: string; label: string };

declare const container: HTMLElement;
const template = (item: Row): string => item.name;

const list = createVList<Row>({ container, item: { height: 40, template }, items: [{ id: 1, name: "a" }] });
const aliasList = createVList<RowAlias>({ container, item: { height: 40, template: (i) => i.label } });

// Core methods keep their types.
const first: Row | undefined = list.getItemAt(0);
const position: number = list.getScrollPosition();
aliasList.destroy();

// @ts-expect-error a mistyped core method must not compile
list.scrollToIndexx(0);

// @ts-expect-error an item without an id does not satisfy the constraint
const bad = createVList<{ name: string }>({ container, item: { height: 40, template: (i) => i.name } });

// @ts-expect-error reading an undeclared field off an item is a type error
const missing: string = first?.missingField;

export type { Row, RowAlias };
export { list, aliasList, first, position, bad, missing };
