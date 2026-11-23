/**
 * Regression matrix for search membership against vlist 3.8.10 (f140c9d).
 *
 * Expected snapshots are what that commit does, except the cases tagged in
 * the test name:
 * a. a join regroups once
 * b. a throw from the group callback or an earlier hook leaves the previous
 *    filter, count/layout/ARIA/counter agree, the error reaches the caller,
 *    and a retry applies the edit (FLO-1508)
 * c. the first match created by an edit in navigate mode is revealed and
 *    emits search:match
 *
 * A throw from header.height is excluded (FLO-1509). search() rejects data().
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { registerDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createContainer } from "../../helpers/factory";
import { scoped } from "../../helpers/scope";
import { createVList } from "../../../src/core/create";
import type { VList, VListPlugin } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { data } from "../../../src/plugins/data";
import { groups } from "../../../src/plugins/groups/plugin";
import { search } from "../../../src/plugins/search/plugin";
import { table } from "../../../src/plugins/table";

registerDOM();

let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 800; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
});
afterAll(() => geometry.assertRestored());

interface Row extends VListItem {
  id: number;
  group: string;
  label: string;
  note?: string;
}

type Api = VList<Row> & {
  setQuery(query: string): void;
  getMatches(): number[];
  getGroupLayout(): { totalEntries: number; groups: Array<{ key: string; count: number }> };
};

type Op = "updateItem" | "setItems" | "prependItems" | "insertItem" | "nested";
type Dir = "join" | "leave" | "stays-in" | "stays-out" | "same" | "other" | "reversal" | "join-leave";
type Mode = "filter" | "navigate";
type Surface = "plain" | "table";
type ThrowKind = "none" | "group" | "earlier";
type Tag = "a" | "b" | "c";

interface Case {
  id: string;
  op: Op;
  dir: Dir;
  mode: Mode;
  surface: Surface;
  throwKind: ThrowKind;
  tag?: Tag;
}

interface Snap {
  matches: number[];
  total: number;
  entries: number;
  keys: string;
  aria: string | null;
  counter: string;
  rendered: string;
  focused: string | null;
  events: string[];
  scroll: number;
}

const RECORD = process.env.MATRIX_RECORD === "1";
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function baseRows(): Row[] {
  return [
    { id: 1, group: "A", label: "hide" },
    { id: 2, group: "B", label: "show" },
    { id: 3, group: "C", label: "show" },
    { id: 4, group: "D", label: "hide" },
  ];
}

function patched(dir: Dir): Row[] {
  const rows = baseRows();
  if (dir === "join") rows[0] = { ...rows[0]!, label: "show" };
  if (dir === "leave") rows[1] = { ...rows[1]!, label: "hide" };
  if (dir === "stays-in") rows[1] = { ...rows[1]!, note: "kept" };
  if (dir === "stays-out") rows[3] = { ...rows[3]!, note: "kept" };
  return rows;
}

function patchOf(dir: Dir): { id: number; updates: Partial<Row> } {
  if (dir === "join") return { id: 1, updates: { label: "show" } };
  if (dir === "leave") return { id: 2, updates: { label: "hide" } };
  if (dir === "stays-in") return { id: 2, updates: { note: "kept" } };
  return { id: 4, updates: { note: "kept" } };
}

function added(dir: Dir): Row {
  return { id: 5, group: "Z", label: dir === "join" ? "show" : "hide" };
}

const cases: Case[] = [];

function add(op: Op, dir: Dir, mode: Mode, surface: Surface, throwKind: ThrowKind, tag?: Tag): void {
  cases.push({
    id: `${op}/${dir}/${mode}/${surface}/${throwKind}`,
    op,
    dir,
    mode,
    surface,
    throwKind,
    tag,
  });
}

for (const mode of ["filter", "navigate"] as const) {
  for (const surface of ["plain", "table"] as const) {
    for (const dir of ["join", "leave", "stays-in", "stays-out"] as const) {
      const joinOnce = mode === "filter" && dir === "join" ? "a" : undefined;
      add("updateItem", dir, mode, surface, "none", joinOnce);
      add("setItems", dir, mode, surface, "none");
      if (dir === "join" || dir === "stays-out") {
        add("prependItems", dir, mode, surface, "none");
        add("insertItem", dir, mode, surface, "none");
      }
      if (dir !== "stays-out") add("updateItem", dir, mode, surface, "group", "b");
      add("updateItem", dir, mode, surface, "earlier", "b");
      add("setItems", dir, mode, surface, "group");
    }
    for (const dir of ["same", "other", "reversal", "join-leave"] as const) {
      add("nested", dir, mode, surface, "none");
      add("nested", dir, mode, surface, "group");
      add("nested", dir, mode, surface, "earlier");
    }
  }
}

function snapOf(list: Api, container: HTMLElement, events: string[]): Snap {
  const layout = list.getGroupLayout();
  const root = container.querySelector(".vlist") as HTMLElement;
  const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
  const tableRows = [...container.querySelectorAll(".vlist-table-row")];
  const nodes = tableRows.length
    ? tableRows
    : [...container.querySelectorAll(".vlist-group-header, .vlist-item")];
  const rendered = nodes
    .sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")))
    .map((el) => el.getAttribute("data-id") ?? "")
    .join(",");
  const mark = container.querySelector(".vlist-search-match--current");
  const focused = mark?.closest(".vlist-table-row, .vlist-item")?.getAttribute("data-id") ?? null;
  return {
    matches: list.getMatches(),
    total: list.total,
    entries: layout.totalEntries,
    keys: layout.groups.map((group) => `${group.key}:${group.count}`).join(","),
    aria: root.getAttribute("aria-rowcount"),
    counter: container.querySelector(".vlist-search__counter")?.textContent ?? "",
    rendered,
    focused,
    events: [...events],
    scroll: viewport.scrollTop,
  };
}

function earlierPlugin(
  listRef: { list: Api | null },
  spec: Case,
  arm: { throw: boolean },
): VListPlugin<Row> {
  return {
    name: "earlier-hook",
    priority: 40,
    setup(ctx) {
      const prev = ctx.hooks.get("_onItemUpdate") as ((id: string | number, updates: Partial<Row>) => void) | undefined;
      ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
        if (arm.throw && spec.throwKind === "earlier") {
          arm.throw = false;
          throw new Error("earlier");
        }
        if (spec.op === "nested" && id === 1) {
          const inner = spec.dir === "same"
            ? { id: 1, updates: { note: "meta" } as Partial<Row> }
            : spec.dir === "other"
              ? { id: 4, updates: { note: "meta" } as Partial<Row> }
              : spec.dir === "reversal"
                ? { id: 4, updates: { label: "show" } as Partial<Row> }
                : { id: 1, updates: { label: "hide" } as Partial<Row> };
          if ((updates.label === "show" || updates.note === undefined) && listRef.list) {
            const current = listRef.list;
            listRef.list = null;
            current.updateItem(inner.id, inner.updates);
            listRef.list = current;
          }
        }
        prev?.(id, updates);
      });
    },
  };
}

async function mount(spec: Case, arm: { throw: boolean }, calls: number[]): Promise<{ list: Api; container: HTMLElement }> {
  const listRef: { list: Api | null } = { list: null };
  const container = createContainer({ width: 300, height: 800 });
  const plugins: Array<VListPlugin<Row>> = [];
  if (spec.surface === "table") {
    plugins.push(table<Row>({ columns: [{ key: "label", label: "Label", width: 120 }], rowHeight: 40, headerHeight: 32 }));
  }
  plugins.push(groups<Row>({
    getGroupForIndex: (index, item) => {
      calls.push(index);
      if (arm.throw && spec.throwKind === "group") {
        arm.throw = false;
        throw new Error("group");
      }
      return item?.group ?? "";
    },
    header: { height: 32, template: (key) => key },
    sticky: false,
  }));
  plugins.push(earlierPlugin(listRef, spec, arm));
  plugins.push(search<Row>({ mode: spec.mode, field: "label" }));
  const list = createVList<Row>(
    {
      container,
      items: baseRows(),
      item: { height: 40, template: (item) => item.label },
    },
    plugins,
  ) as Api;
  listRef.list = list;
  await tick();
  list.setQuery("show");
  await tick();
  return { list, container };
}

function act(list: Api, spec: Case): void {
  if (spec.op === "updateItem" || spec.op === "nested") {
    const patch = spec.op === "nested" ? { id: 1, updates: { label: "show" } as Partial<Row> } : patchOf(spec.dir);
    list.updateItem(patch.id, patch.updates);
    return;
  }
  if (spec.op === "setItems") {
    list.setItems(patched(spec.dir));
    return;
  }
  const row = added(spec.dir);
  if (spec.op === "prependItems") list.prependItems([row]);
  else list.insertItem(row, 0);
}

describe("search join matrix against 3.8.10", () => {
  for (const spec of cases) {
    const title = spec.tag ? `${spec.id} [${spec.tag}]` : spec.id;
    it(title, scoped(async (scope) => {
      const arm = { throw: false };
      const calls: number[] = [];
      const { list, container } = await mount(spec, arm, calls);
      scope.own(list, container);
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      const before = snapOf(list, container, events);
      calls.length = 0;
      arm.throw = spec.throwKind !== "none";
      let threw: string | null = null;
      try {
        act(list, spec);
      } catch (error) {
        threw = (error as Error).message;
      }
      await tick();
      const afterThrow = snapOf(list, container, events);
      const groupIdx = [...calls];
      if (spec.throwKind !== "none") {
        try {
          act(list, spec);
        } catch (error) {
          threw = `${threw ?? ""}|retry:${(error as Error).message}`;
        }
        await tick();
      }
      const after = snapOf(list, container, events);

      if (RECORD) {
        console.log(JSON.stringify({ id: spec.id, tag: spec.tag ?? "", threw, groupIdx, before, afterThrow, after }));
        return;
      }

      if (spec.tag === "b") {
        // b. a throw leaves the previous filter; count, layout, ARIA and the
        // counter still agree; the error reaches the caller; a retry applies.
        expect(threw, spec.id).toBe(spec.throwKind === "group" ? "group" : "earlier");
        expect(afterThrow, spec.id).toEqual(before);
        const cleanId = spec.id.replace(`/${spec.throwKind}`, "/none");
        expect(after, spec.id).toEqual(EXPECTED[cleanId]);
        return;
      }

      if (spec.tag === "a") {
        // a. a join regroups once: one pass over the filtered rows, not the
        // previous count and then the next.
        expect(groupIdx, spec.id).toEqual([0, 1, 2]);
      }

      expect(after, spec.id).toEqual(EXPECTED[spec.id]);
    }));
  }

  for (const mode of ["filter", "navigate"] as const) {
    it(`data/${mode} rejects search`, () => {
      const container = createContainer({ width: 300, height: 800 });
      try {
        expect(() => createVList<Row>(
          { container, item: { height: 40, template: (item) => item.label } },
          [
            data<Row>({ adapter: { read: async () => ({ items: [], total: 0 }) }, total: 0 }),
            search<Row>({ mode, field: "label" }),
          ],
        )).toThrow('[vlist] Plugin "search" conflicts with "data"');
      } finally {
        container.remove();
      }
    });
  }

  for (const surface of ["plain", "table"] as const) {
    // c. the first match created by an edit in navigate mode is revealed and
    // emits search:match.
    it(`navigate/first-match/${surface} [c]`, scoped(async (scope) => {
      const items: Row[] = [];
      for (let id = 1; id <= 30; id++) items.push({ id, group: "A", label: "hide" });
      const container = createContainer({ width: 300, height: 800 });
      const plugins: Array<VListPlugin<Row>> = [];
      if (surface === "table") {
        plugins.push(table<Row>({ columns: [{ key: "label", label: "Label", width: 120 }], rowHeight: 40, headerHeight: 32 }));
      }
      plugins.push(groups<Row>({
        getGroupForIndex: (_index, item) => item?.group ?? "",
        header: { height: 32, template: (key) => key },
        sticky: false,
      }));
      plugins.push(search<Row>({ mode: "navigate", field: "label" }));
      const list = createVList<Row>(
        { container, items, item: { height: 40, template: (item) => item.label } },
        plugins,
      ) as Api;
      scope.own(list, container);
      await tick();
      list.setQuery("show");
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.updateItem(21, { label: "show" });
      await tick();
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      if (RECORD) {
        console.log(JSON.stringify({
          id: `navigate/first-match/${surface}`,
          events,
          scroll: viewport.scrollTop,
          matches: list.getMatches(),
        }));
        return;
      }
      expect(events, surface).toEqual(FIRST_MATCH[surface].events);
      expect(viewport.scrollTop, surface).toBe(FIRST_MATCH[surface].scroll);
      expect(list.getMatches(), surface).toEqual([20]);
    }));
  }
});

const EXPECTED: Record<string, Snap> = {
  "updateItem/join/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/filter/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/filter/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/join/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/join/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/plain/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/filter/plain/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/plain/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3,__group_header_1,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/plain/earlier": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,3,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/leave/filter/plain/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/filter/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/filter/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/filter/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/same/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/plain/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/filter/plain/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:2",
      "change:3"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/filter/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/filter/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/join/filter/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/join/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/table/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": "3",
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/filter/table/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": "3",
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/table/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "2",
    "counter": "2 results",
    "rendered": "__group_header_0",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/leave/filter/table/earlier": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,3,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/leave/filter/table/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": "3",
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/filter/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/filter/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/filter/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/same/filter/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/table/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/filter/table/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/table/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/navigate/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/navigate/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/join/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/plain/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/navigate/plain/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/plain/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "updateItem/leave/navigate/plain/earlier": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "setItems/leave/navigate/plain/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/navigate/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/navigate/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/same/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/plain/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/navigate/plain/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/navigate/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/navigate/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/join/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/join/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/table/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/navigate/table/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/table/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "updateItem/leave/navigate/table/earlier": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "setItems/leave/navigate/table/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/navigate/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/navigate/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/same/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/table/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/navigate/table/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2"
    ],
    "scroll": 0
  }
};

const FIRST_MATCH: Record<"plain" | "table", { events: string[]; scroll: number }> = {
  "plain": {
    "events": [
      "match:20",
      "change:1"
    ],
    "scroll": 72
  },
  "table": {
    "events": [
      "match:20",
      "change:1"
    ],
    "scroll": 72
  }
};
