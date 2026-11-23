/**
 * updateItem that changes an item's group key rebuilds the group layout.
 * An update that keeps the key leaves the headers where they are.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createContainer } from "../../helpers/factory";
import { scoped, waitFor } from "../../helpers/scope";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import type { VListAdapter, VListItem } from "../../../src/types";
import { groups } from "../../../src/plugins/groups/plugin";
import { data } from "../../../src/plugins/data";
import { table } from "../../../src/plugins/table";
import { search } from "../../../src/plugins/search/plugin";
import { selection } from "../../../src/plugins/selection";

interface Row extends VListItem {
  id: number;
  group: string;
  label?: string;
  note?: string;
}

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 800; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function rows(spec: Array<[string, number]>, startId = 1): Row[] {
  const out: Row[] = [];
  let id = startId;
  for (const [group, count] of spec) {
    for (let n = 0; n < count; n++) out.push({ id: id++, group });
  }
  return out;
}

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function sequence(container: HTMLElement): string[] {
  const content = container.querySelector(".vlist-content");
  if (!content) return [];
  return [...content.children].map((el) => {
    const kind = el.classList.contains("vlist-group-header") ? "H" : "I";
    return `${kind}:${textOf(el)}#${el.getAttribute("data-id")}`;
  });
}

function tableSequence(container: HTMLElement): string[] {
  // Rows are absolutely positioned, so visual order is data-index, not DOM order.
  return [...container.querySelectorAll(".vlist-table-row")]
    .sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")))
    .map((el) => {
      const header = el.classList.contains("vlist-table-group-header");
      const node = header ? el.querySelector(".vlist-table-group-header-content") ?? el : el;
      const kind = header ? "H" : "I";
      return `${kind}:${textOf(node)}#${el.getAttribute("data-id")}`;
    });
}

const tableColumns = [{ key: "group", label: "Group", width: 120 }];

function stickyTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".sticky-group")]
    .map((el) => textOf(el))
    .filter((text) => text.length > 0);
}

function mount(
  spec: Array<[string, number]>,
  sticky: boolean,
): { list: VList<Row>; container: HTMLElement; dispose: () => void } {
  const container = createContainer({ width: 300, height: 800 });
  const list = createVList<Row>(
    {
      container,
      items: rows(spec),
      item: { height: 40, template: (item) => item.label ?? item.group },
    },
    [
      groups<Row>({
        getGroupForIndex: (_index, item) => item?.group ?? "",
        header: { height: 32, template: (key) => key },
        sticky,
      }),
    ],
  );
  return {
    list,
    container,
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("groups() updateItem group key", () => {
  it("moves an item into the following group", async () => {
    const f = mount([["A", 2], ["B", 2]], false);
    try {
      await tick();
      f.list.updateItem(2, { group: "B" });
      await tick();
      expect(sequence(f.container)).toEqual([
        "H:A#__group_header_0",
        "I:A#1",
        "H:B#__group_header_1",
        "I:B#2",
        "I:B#3",
        "I:B#4",
      ]);
    } finally {
      f.dispose();
    }
  });

  it("opens a new group where the item sits", async () => {
    const f = mount([["A", 2], ["B", 2]], false);
    try {
      await tick();
      f.list.updateItem(2, { group: "C" });
      await tick();
      expect(sequence(f.container)).toEqual([
        "H:A#__group_header_0",
        "I:A#1",
        "H:C#__group_header_1",
        "I:C#2",
        "H:B#__group_header_2",
        "I:B#3",
        "I:B#4",
      ]);
    } finally {
      f.dispose();
    }
  });

  it("drops a group when its last item leaves", async () => {
    const f = mount([["A", 1], ["B", 3]], false);
    try {
      await tick();
      f.list.updateItem(1, { group: "B" });
      await tick();
      expect(sequence(f.container)).toEqual([
        "H:B#__group_header_0",
        "I:B#1",
        "I:B#2",
        "I:B#3",
        "I:B#4",
      ]);
    } finally {
      f.dispose();
    }
  });

  it("updates the sticky title when the current group changes", async () => {
    const f = mount([["A", 2], ["B", 20]], true);
    try {
      await tick();
      expect(stickyTexts(f.container)).toEqual(["A"]);
      f.list.updateItem(1, { group: "Z" });
      await tick();
      expect(stickyTexts(f.container)).toEqual(["Z"]);
      expect(sequence(f.container)[0]).toBe("H:Z#__group_header_0");
    } finally {
      f.dispose();
    }
  });

  it("keeps the header nodes when the group key stays", async () => {
    const f = mount([["A", 2], ["B", 2]], false);
    try {
      await tick();
      const header = f.container.querySelector(".vlist-group-header");
      f.list.updateItem(1, { label: "edited" });
      await tick();
      expect(f.container.querySelector(".vlist-group-header")).toBe(header);
      expect(sequence(f.container)[1]).toBe("I:edited#1");
      expect(sequence(f.container).filter((row) => row.startsWith("H:")).length).toBe(2);
    } finally {
      f.dispose();
    }
  });

  it("moves an item loaded through data()", scoped(async (scope) => {
    const source = rows([["A", 2], ["B", 2]]);
    const adapter: VListAdapter<Row> = {
      read: async ({ offset, limit }) => ({
        items: source.slice(offset, offset + limit),
        total: source.length,
      }),
    };
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        item: { height: 40, template: (item) => item.group },
      },
      [
        data<Row>({ adapter, total: source.length }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
      ],
    );
    scope.own(list, container);
    await waitFor(
      () => sequence(container).includes("I:A#1"),
      "the loaded rows to render",
    );
    list.updateItem(2, { group: "C" });
    await tick();
    expect(sequence(container)).toEqual([
      "H:A#__group_header_0",
      "I:A#1",
      "H:C#__group_header_1",
      "I:C#2",
      "H:B#__group_header_2",
      "I:B#3",
      "I:B#4",
    ]);
  }));

  const regrouped = [
    "H:A#__group_header_0",
    "I:A#1",
    "H:C#__group_header_1",
    "I:C#2",
    "H:B#__group_header_2",
    "I:B#3",
    "I:B#4",
  ];

  it("rebuilds a grouped table when updateItem changes the group", async () => {
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: rows([["A", 2], ["B", 2]]),
        item: { height: 40, template: (item) => item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
      ],
    );
    try {
      await tick();
      list.updateItem(2, { group: "C" });
      await tick();
      expect(tableSequence(container)).toEqual(regrouped);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("rebuilds a grouped table loaded through data()", scoped(async (scope) => {
    const source = rows([["A", 2], ["B", 2]]);
    const adapter: VListAdapter<Row> = {
      read: async ({ offset, limit }) => ({
        items: source.slice(offset, offset + limit),
        total: source.length,
      }),
    };
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        item: { height: 40, template: (item) => item.group },
      },
      [
        data<Row>({ adapter, total: source.length }),
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
      ],
    );
    scope.own(list, container);
    await waitFor(
      () => tableSequence(container).some((row) => row === "I:A#1"),
      "the table rows to render",
    );
    list.updateItem(2, { group: "C" });
    await tick();
    expect(tableSequence(container)).toEqual(regrouped);
  }));

  it("regroups an item under an active search filter", async () => {
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: [
          { id: 1, group: "A", label: "hide" },
          { id: 2, group: "A", label: "show" },
          { id: 3, group: "B", label: "show" },
        ],
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "filter", field: "label", position: "none" }),
      ],
    );
    try {
      await tick();
      (list as VList<Row> & { setQuery(query: string): void }).setQuery("show");
      await tick();
      list.updateItem(3, { group: "C" });
      await tick();
      expect(sequence(container)).toEqual([
        "H:A#__group_header_0",
        "I:show#2",
        "H:C#__group_header_1",
        "I:show#3",
      ]);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("keeps the focused row as the active descendant after it changes group", async () => {
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: rows([["A", 2], ["B", 2]]),
        item: { height: 40, template: (item) => item.group },
      },
      [
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        selection<Row>({ mode: "single", followFocus: true }),
      ],
    );
    try {
      await tick();
      const root = container.querySelector(".vlist") as HTMLElement;
      const content = container.querySelector(".vlist-content") as HTMLElement;
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-2");
      list.updateItem(2, { group: "C" });
      await tick();
      const active = content.getAttribute("aria-activedescendant");
      expect(active).toBe("vlist-item-3");
      const named = container.querySelector(`[id="${active}"]`);
      expect(named?.getAttribute("data-id")).toBe("2");
      expect(named?.classList.contains("vlist-group-header")).toBe(false);
      for (const header of container.querySelectorAll(".vlist-group-header")) {
        expect(header.hasAttribute("id")).toBe(false);
        expect(header.hasAttribute("aria-posinset")).toBe(false);
        expect(header.hasAttribute("aria-setsize")).toBe(false);
      }
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("keeps the trailing rows when a grouped table edit keeps the group", scoped(async (scope) => {
    const source = rows([["A", 2], ["B", 2]]).map((row) => ({ ...row, label: row.group }));
    const adapter: VListAdapter<Row> = {
      read: async ({ offset, limit }) => ({
        items: source.slice(offset, offset + limit),
        total: source.length,
      }),
    };
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        data<Row>({ adapter, total: source.length }),
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
      ],
    );
    scope.own(list, container);
    await waitFor(
      () => tableSequence(container).some((row) => row === "I:A#1"),
      "the table rows to render",
    );
    const root = container.querySelector(".vlist") as HTMLElement;
    expect(root.getAttribute("aria-rowcount")).toBe("7");
    list.updateItem(2, { label: "edited" });
    await tick();
    expect(root.getAttribute("aria-rowcount")).toBe("7");
    expect(tableSequence(container)).toEqual([
      "H:A#__group_header_0",
      "I:A#1",
      "I:A#2",
      "H:B#__group_header_1",
      "I:B#3",
      "I:B#4",
    ]);
  }));

  it("regroups once when an edit leaves the active table filter", async () => {
    let groupingCalls = 0;
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: [
          { id: 1, group: "A", label: "show" },
          { id: 2, group: "B", label: "show" },
          { id: 3, group: "B", label: "show" },
        ],
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => {
            groupingCalls += 1;
            return item?.group ?? "";
          },
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "filter", field: "label", position: "none" }),
      ],
    );
    try {
      await tick();
      (list as VList<Row> & { setQuery(query: string): void }).setQuery("show");
      await tick();
      groupingCalls = 0;
      list.updateItem(3, { group: "C", label: "hide" });
      expect(groupingCalls).toBe(2);
      await tick();
      expect(tableSequence(container)).toEqual([
        "H:A#__group_header_0",
        "I:A#1",
        "H:B#__group_header_1",
        "I:B#2",
      ]);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("regroups once when an edit joins the active table filter", async () => {
    let groupingCalls = 0;
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: [
          { id: 1, group: "A", label: "hide" },
          { id: 2, group: "B", label: "show" },
          { id: 3, group: "C", label: "show" },
          { id: 4, group: "D", label: "show" },
        ],
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => {
            groupingCalls += 1;
            return item?.group ?? "";
          },
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "filter", field: "label", position: "none" }),
      ],
    );
    const announced = list as VList<Row> & {
      setQuery(query: string): void;
      getGroupLayout(): { groups: Array<{ key: string }> };
    };
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      groupingCalls = 0;
      let keys = "";
      list.on("search:change", () => {
        keys = announced.getGroupLayout().groups.map((group) => group.key).join(",");
      });
      list.updateItem(1, { label: "show" });
      expect(groupingCalls).toBe(4);
      expect(keys).toBe("A,B,C,D");
      await tick();
      expect(tableSequence(container)).toEqual([
        "H:A#__group_header_0",
        "I:A#1",
        "H:B#__group_header_1",
        "I:B#2",
        "H:C#__group_header_2",
        "I:C#3",
        "H:D#__group_header_3",
        "I:D#4",
      ]);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  const shownRows = [
    { id: 1, group: "A", label: "hide" },
    { id: 2, group: "B", label: "show" },
    { id: 3, group: "C", label: "show" },
    { id: 4, group: "D", label: "show" },
  ];
  const filteredThree = [
    "H:B#__group_header_0",
    "I:B#2",
    "H:C#__group_header_1",
    "I:C#3",
    "H:D#__group_header_2",
    "I:D#4",
  ];
  const filteredFour = [
    "H:A#__group_header_0",
    "I:A#1",
    "H:B#__group_header_1",
    "I:B#2",
    "H:C#__group_header_2",
    "I:C#3",
    "H:D#__group_header_3",
    "I:D#4",
  ];

  type Announced = VList<Row> & {
    setQuery(query: string): void;
    getMatches(): number[];
    getGroupLayout(): { totalEntries: number; groupCount: number };
  };

  // Count, layout, ARIA and the counter describe the same filter.
  const agreed = (
    list: Announced,
    container: HTMLElement,
    matches: number[],
    rows: string[],
    aria: string,
    counter: string | null,
  ): void => {
    const layout = list.getGroupLayout();
    const root = container.querySelector(".vlist") as HTMLElement;
    expect(list.getMatches()).toEqual(matches);
    expect(list.total).toBe(matches.length);
    expect(layout.groupCount).toBe(rows.filter((row) => row.startsWith("H:")).length);
    expect(layout.totalEntries).toBe(rows.length);
    expect(root.getAttribute("aria-rowcount")).toBe(aria);
    if (counter !== null) {
      expect(container.querySelector(".vlist-search__counter")?.textContent).toBe(counter);
    }
    expect(tableSequence(container)).toEqual(rows);
  };

  it("keeps the table in agreement when grouping throws during a join", async () => {
    let throwOnce = true;
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: shownRows.map((row) => ({ ...row })),
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => {
            if (throwOnce && item?.id === 1 && item.label === "show") {
              throwOnce = false;
              throw new Error("group");
            }
            return item?.group ?? "";
          },
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "filter", field: "label" }),
      ],
    );
    const announced = list as Announced;
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      expect(() => list.updateItem(1, { label: "show" })).toThrow("group");
      agreed(announced, container, [1, 2, 3], filteredThree, "7", "3 results");
      list.updateItem(4, { note: "later" });
      await tick();
      agreed(announced, container, [1, 2, 3], filteredThree, "7", "3 results");
      list.updateItem(1, { label: "show" });
      await tick();
      agreed(announced, container, [0, 1, 2, 3], filteredFour, "9", "4 results");
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("retries a join after an earlier hook throws and shows every match", async () => {
    let throwOnce = true;
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: shownRows.map((row) => ({ ...row })),
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        {
          name: "join-throw",
          priority: 30,
          setup(ctx) {
            const prev = ctx.hooks.get("_onItemUpdate") as
              ((id: string | number, updates: Partial<Row>) => void) | undefined;
            ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
              if (throwOnce && id === 1) {
                throwOnce = false;
                throw new Error("group");
              }
              prev?.(id, updates);
            });
          },
        },
        search<Row>({ mode: "filter", field: "label" }),
      ],
    );
    const announced = list as Announced;
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      expect(() => list.updateItem(1, { label: "show" })).toThrow("group");
      agreed(announced, container, [1, 2, 3], filteredThree, "7", "3 results");
      list.updateItem(1, { label: "show" });
      await tick();
      agreed(announced, container, [0, 1, 2, 3], filteredFour, "9", "4 results");
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("keeps the outer join hidden when an earlier hook updates another row", async () => {
    let groupingCalls = 0;
    let nest = true;
    let list: VList<Row> | null = null;
    const container = createContainer({ width: 300, height: 800 });
    list = createVList<Row>(
      {
        container,
        items: shownRows.map((row) => ({ ...row })),
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => {
            groupingCalls += 1;
            return item?.group ?? "";
          },
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        {
          name: "nested-update",
          priority: 30,
          setup(ctx) {
            const prev = ctx.hooks.get("_onItemUpdate") as
              ((id: string | number, updates: Partial<Row>) => void) | undefined;
            ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
              if (nest && id === 1) {
                nest = false;
                list?.updateItem(2, { note: "nested" });
              }
              prev?.(id, updates);
            });
          },
        },
        search<Row>({ mode: "filter", field: "label", position: "none" }),
      ],
    );
    const announced = list as Announced;
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      groupingCalls = 0;
      list.updateItem(1, { label: "show" });
      // The nested edit checks its own row once. The join itself rebuilds the
      // four matches once; it does not also rebuild the previous three.
      expect(groupingCalls).toBe(5);
      await tick();
      agreed(announced, container, [0, 1, 2, 3], filteredFour, "9", null);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("regroups a filtered edit issued in the same task as the query", async () => {
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: [
          { id: 1, group: "A", label: "hide" },
          { id: 2, group: "A", label: "show" },
        ],
        item: { height: 40, template: (item) => item.group },
      },
      [
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "filter", field: "label", position: "none" }),
      ],
    );
    try {
      (list as VList<Row> & { setQuery(query: string): void }).setQuery("show");
      list.updateItem(2, { group: "C" });
      await tick();
      expect(sequence(container)).toEqual([
        "H:C#__group_header_0",
        "I:C#2",
      ]);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("regroups before navigate mode announces the next match", async () => {
    const items: Row[] = [];
    for (let id = 1; id <= 24; id++) {
      items.push({ id, group: "A", label: id === 2 || id === 21 ? "show" : "hide" });
    }
    const container = createContainer({ width: 300, height: 100 });
    const list = createVList<Row>(
      {
        container,
        items,
        item: { height: 40, template: (item) => item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "navigate", field: "label", position: "none" }),
      ],
    );
    const announced = list as VList<Row> & {
      setQuery(query: string): void;
      getGroupLayout(): { groups: Array<{ key: string }> };
    };
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      let keys = "";
      list.on("search:change", () => {
        keys = announced.getGroupLayout().groups.map((group) => group.key).join(",");
      });
      list.updateItem(2, { group: "C", label: "hide" });
      expect(keys).toBe("A,C,A");
      const row = container.querySelector('[data-id="21"]') as HTMLElement;
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      const top = Number.parseFloat(row.style.transform.slice(11)) || 0;
      const bottom = top + 40 - viewport.scrollTop;
      expect(bottom).toBeGreaterThan(0);
      expect(bottom).toBeLessThanOrEqual(viewport.clientHeight);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("reveals the first navigate match when an edit creates it", async () => {
    const items: Row[] = [];
    for (let id = 1; id <= 24; id++) items.push({ id, group: "A", label: "hide" });
    const container = createContainer({ width: 300, height: 100 });
    const list = createVList<Row>(
      {
        container,
        items,
        item: { height: 40, template: (item) => item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        search<Row>({ mode: "navigate", field: "label", position: "none" }),
      ],
    );
    const announced = list as VList<Row> & { setQuery(query: string): void };
    const events: string[] = [];
    list.on("search:match", () => { events.push("match"); });
    list.on("search:change", () => { events.push("change"); });
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      events.length = 0;
      list.updateItem(21, { label: "show" });
      await tick();
      expect(events).toEqual(["match", "change"]);
      const row = container.querySelector('[data-id="21"]') as HTMLElement;
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      const top = Number.parseFloat(row.style.transform.slice(11)) || 0;
      const bottom = top + 40 - viewport.scrollTop;
      expect(bottom).toBeGreaterThan(0);
      expect(bottom).toBeLessThanOrEqual(viewport.clientHeight);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("keeps nested joins in order and removes the row that leaves", async () => {
    let nest = true;
    let list: VList<Row> | null = null;
    const container = createContainer({ width: 300, height: 800 });
    const slots = [
      { id: 1, group: "A", label: "hide" },
      { id: 2, group: "B", label: "hide" },
      { id: 3, group: "C", label: "show" },
      { id: 4, group: "D", label: "show" },
    ];
    list = createVList<Row>(
      {
        container,
        items: slots,
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        {
          name: "nest-earlier",
          priority: 30,
          setup(ctx) {
            const prev = ctx.hooks.get("_onItemUpdate") as
              ((id: string | number, updates: Partial<Row>) => void) | undefined;
            ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
              if (nest && id === 2) {
                nest = false;
                list?.updateItem(1, { label: "show" });
              }
              prev?.(id, updates);
            });
          },
        },
        search<Row>({ mode: "filter", field: "label" }),
      ],
    );
    const announced = list as Announced;
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      list.updateItem(2, { label: "show" });
      await tick();
      agreed(announced, container, [0, 1, 2, 3], filteredFour, "9", "4 results");
      list.updateItem(1, { label: "hide" });
      await tick();
      agreed(announced, container, [1, 2, 3], filteredThree, "7", "3 results");
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("does not list a row twice when the join updates it again", async () => {
    let nest = true;
    let list: VList<Row> | null = null;
    const container = createContainer({ width: 300, height: 800 });
    const slots = [
      { id: 1, group: "A", label: "hide" },
      { id: 2, group: "B", label: "hide" },
      { id: 3, group: "C", label: "show" },
      { id: 4, group: "D", label: "show" },
    ];
    list = createVList<Row>(
      {
        container,
        items: slots,
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
        {
          name: "nest-same",
          priority: 30,
          setup(ctx) {
            const prev = ctx.hooks.get("_onItemUpdate") as
              ((id: string | number, updates: Partial<Row>) => void) | undefined;
            ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
              if (nest && id === 2) {
                nest = false;
                list?.updateItem(2, { note: "again" });
              }
              prev?.(id, updates);
            });
          },
        },
        search<Row>({ mode: "filter", field: "label" }),
      ],
    );
    const announced = list as Announced;
    try {
      await tick();
      announced.setQuery("show");
      await tick();
      list.updateItem(2, { label: "show" });
      await tick();
      agreed(announced, container, [1, 2, 3], filteredThree, "7", "3 results");
      expect(container.querySelectorAll('[data-id="2"]').length).toBe(1);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("restores a plain table after a shorter setItems and an edit", scoped(async (scope) => {
    const source = rows([["A", 4]]).map((row) => ({ ...row, label: row.group }));
    const adapter: VListAdapter<Row> = {
      read: async ({ offset, limit }) => ({
        items: source.slice(offset, offset + limit),
        total: source.length,
      }),
    };
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        data<Row>({ adapter, total: source.length }),
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
      ],
    );
    scope.own(list, container);
    await waitFor(
      () => container.querySelectorAll(".vlist-table-row").length === 4,
      "the four rows to render",
    );
    const root = container.querySelector(".vlist") as HTMLElement;
    list.setItems([{ id: 1, group: "A", label: "A" }]);
    expect(root.getAttribute("aria-rowcount")).toBe("2");
    list.updateItem(2, { label: "edited" });
    await tick();
    expect(root.getAttribute("aria-rowcount")).toBe("5");
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(4);
  }));

  it("restores a plain table after a longer setItems and an edit", scoped(async (scope) => {
    const source = rows([["A", 4]]).map((row) => ({ ...row, label: row.group }));
    const adapter: VListAdapter<Row> = {
      read: async ({ offset, limit }) => ({
        items: source.slice(offset, offset + limit),
        total: source.length,
      }),
    };
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        item: { height: 40, template: (item) => item.label ?? item.group },
      },
      [
        data<Row>({ adapter, total: source.length }),
        table<Row>({ columns: tableColumns, rowHeight: 40, headerHeight: 32 }),
      ],
    );
    scope.own(list, container);
    await waitFor(
      () => container.querySelectorAll(".vlist-table-row").length === 4,
      "the four rows to render",
    );
    const root = container.querySelector(".vlist") as HTMLElement;
    list.setItems(rows([["A", 6]]).map((row) => ({ ...row, label: row.group })));
    expect(root.getAttribute("aria-rowcount")).toBe("7");
    list.updateItem(2, { label: "edited" });
    await tick();
    expect(root.getAttribute("aria-rowcount")).toBe("5");
    expect(container.querySelectorAll(".vlist-table-row").length).toBe(4);
  }));
});
