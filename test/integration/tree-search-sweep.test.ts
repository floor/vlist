import { beforeAll, afterAll, describe, it, expect } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { search, type SearchMethods } from "../../src/plugins/search/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { table } from "../../src/plugins/table/plugin";
import { selection, type SelectionMethods } from "../../src/plugins/selection/plugin";
import { autosize, type AutosizeMethods } from "../../src/plugins/autosize/plugin";
import { snapshots, type SnapshotsMethods } from "../../src/plugins/snapshots/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";
import { tree, type TreeMethods } from "../../src/plugins/tree/plugin";
import type { VListPlugin } from "../../src/core/types";
import type { VList } from "../../src/core/types";

interface Row { id: number; name: string; group?: string; }
let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
});
afterAll(() => { geometry.restore(); teardownDOM(); geometry.assertRestored(); });

function searchable(mode: "filter" | "navigate") {
  const container = createContainer();
  const list = createVList({ container,
    items: [{ id: 1, name: "match first" }, { id: 2, name: "other" }, { id: 3, name: "match last" }],
    item: { height: 40, template: (item: Row) => item.name },
  }, [search<Row>({ mode, position: "none", field: "name" })]) as VList<Row> & SearchMethods;
  const events: Array<{ index: number; id: number | undefined }> = [];
  list.on("search:match", event => events.push({ index: event.index, id: event.item?.id }));
  list.setQuery("match");
  return { list, container, events, dispose(): void { list.destroy(); container.remove(); } };
}
for (const mode of ["filter", "navigate"] as const) {
  describe(`search ${mode} — active query after collection changes`, () => {
    it("setItems replaces matches and cannot retain rows from the old array", () => {
      const f = searchable(mode);
      try {
        f.list.setItems([{ id: 4, name: "new other" }, { id: 5, name: "match replacement" }]);
        expect(f.list.getQuery()).toBe("match");
        expect(f.list.getMatches()).toEqual([1]);
        if (mode === "filter") {
          expect(f.list.total).toBe(1);
          expect(f.list.getItemAt(0)?.id).toBe(5);
          expect(f.container.textContent).toContain("match replacement");
          expect(f.container.textContent).not.toContain("match first");
        } else {
          f.list.nextMatch();
          expect(f.events[f.events.length - 1]).toEqual({ index: 1, id: 5 });
        }
      } finally { f.dispose(); }
    });
    it("appendItems includes newly matching rows", () => {
      const f = searchable(mode);
      try {
        f.list.appendItems([{ id: 4, name: "match appended" }]);
        expect(f.list.getMatches()).toEqual([0, 2, 3]);
        if (mode === "filter") {
          expect(f.list.total).toBe(3);
          expect(f.list.getItemAt(2)?.id).toBe(4);
        } else {
          f.list.nextMatch(); f.list.nextMatch();
          expect(f.events[f.events.length - 1]).toEqual({ index: 3, id: 4 });
        }
      } finally { f.dispose(); }
    });
    it("removing the current match cannot navigate to a non-match", () => {
      const f = searchable(mode);
      try {
        f.list.removeItem(1);
        expect(f.list.getMatches()).toEqual([1]);
        if (mode === "filter") {
          expect(f.list.total).toBe(1);
          expect(f.list.getItemAt(0)?.id).toBe(3);
        } else {
          f.list.nextMatch();
          expect(f.events[f.events.length - 1]).toEqual({ index: 1, id: 3 });
        }
      } finally { f.dispose(); }
    });
    it("empty replacement clears stale matches and rows", () => {
      const f = searchable(mode);
      try {
        f.list.setItems([]);
        expect(f.list.getMatches()).toEqual([]);
        expect(f.list.total).toBe(0);
        expect(f.container.querySelectorAll(".vlist-content [data-id]").length).toBe(0);
      } finally { f.dispose(); }
    });
  });
}

it("search navigate — appending matches retains the current match position", () => {
  const f = searchable("navigate");
  try {
    f.list.nextMatch();
    expect(f.events[f.events.length - 1]?.id).toBe(3);
    f.list.appendItems([{ id: 4, name: "match appended" }]);
    expect(f.events[f.events.length - 1]?.id).toBe(3);
    f.list.nextMatch();
    expect(f.events[f.events.length - 1]?.id).toBe(4);
  } finally { f.dispose(); }
});


interface TreeRow { id: string; name: string; children: TreeRow[]; height: number; }
function treeRows(count = 60): TreeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `root-${index}`, name: `Root ${index}`, height: 40,
    children: [0, 1].map(child => ({ id: `child-${index}-${child}`, name: `Child ${index}.${child}`, height: 40, children: [] })),
  }));
}
function treeList(horizontal = false, extra: VListPlugin<TreeRow>[] = []) {
  const container = createContainer();
  const list = createVList({ container, items: treeRows(),
    orientation: horizontal ? "horizontal" : "vertical",
    item: { height: 40, width: 40, template: (item: TreeRow) => item.name },
  }, [tree<TreeRow>(), ...extra]) as VList<TreeRow> & TreeMethods<TreeRow>;
  return { list, container,
    row(id: string): HTMLElement | null { return container.querySelector<HTMLElement>(`[data-id="${id}"]`); },
    dispose(): void { list.destroy(); container.remove(); },
  };
}
for (const horizontal of [false, true]) {
  for (const action of ["expand", "collapse"] as const) {
    it(`tree ${horizontal ? "horizontal" : "vertical"} — ${action} above the viewport preserves the visible anchor`, () => {
      const f = treeList(horizontal);
      try {
        if (action === "collapse") f.list.expand("root-0");
        f.list.scrollToIndex(f.list.getIndexById("root-20"));
        const before = f.list.getScrollPosition();
        const beforeIndex = f.list.getIndexById("root-20");
        const screenOffset = beforeIndex * 40 - before;
        f.list[action]("root-0");
        const afterIndex = f.list.getIndexById("root-20");
        expect(afterIndex).toBe(beforeIndex + (action === "expand" ? 2 : -2));
        expect(afterIndex * 40 - f.list.getScrollPosition()).toBe(screenOffset);
        expect(f.row("root-20")).not.toBeNull();
      } finally { f.dispose(); }
    });
  }
}


for (const owner of ["standalone", "selection", "a11y"] as const) {
  for (const action of ["expand", "collapse", "collapse-focused-child"] as const) {
    // Serial: the focus owners use document.activeElement during keyboard input.
    it.serial(`tree + ${owner} — ${action} keeps the focus ring and announcement on the same item`, async () => {
      const plugins: VListPlugin<TreeRow>[] = owner === "standalone" ? [] : [owner === "selection" ? selection() : a11y()];
      const f = treeList(false, plugins);
      try {
        await Promise.resolve();
        const content = f.container.querySelector<HTMLElement>(".vlist-content")!;
        const press = (key: string): void => { content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
        if (action !== "expand") f.list.expand("root-0");
        press("Home");
        if (action === "collapse-focused-child") press("ArrowRight");
        else press("End");
        const expected = action === "collapse-focused-child" ? "root-0" : "root-59";
        const before = f.container.querySelector<HTMLElement>(".vlist-item--focused")!;
        expect(before?.dataset.id).toBe(action === "collapse-focused-child" ? "child-0-0" : expected);
        if (action === "expand") f.list.expand("root-0");
        else f.list.collapse("root-0");
        const focused = f.container.querySelector<HTMLElement>(".vlist-item--focused")!;
        expect(focused?.dataset.id).toBe(expected);
        expect(content.getAttribute("aria-activedescendant")).toBe(focused.id);
      } finally { f.dispose(); }
    });
  }
}

it("tree — an empty tree forgets its previous sub-item anchor offset", () => {
  const f = treeList();
  try {
    f.list.scrollToIndex(20);
    const viewport = f.container.querySelector<HTMLElement>(".vlist-viewport")!;
    viewport.scrollTop = 805;
    viewport.dispatchEvent(new Event("scroll"));
    f.list.setItems([]);
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
    f.list.addChild(null, { id: "root-20", name: "Replacement", height: 40, children: [] });
    expect(f.list.getScrollPosition()).toBe(0);
  } finally { f.dispose(); }
});


function layoutSearch(layout: "groups" | "table" | "table-groups", mode: "filter" | "navigate", rows?: Row[]) {
  const container = createContainer();
  const items = rows ?? Array.from({ length: 100 }, (_, index) => ({ id: index + 1,
    name: index === 70 || index === 90 ? `match ${index}` : `other ${index}`,
    group: `G${Math.floor(index / 2)}`,
  }));
  const plugins: VListPlugin<Row>[] = [];
  if (layout.includes("table")) plugins.push(table({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 20 }));
  if (layout.includes("groups")) plugins.push(groups<Row>({ getGroupForIndex: (_index, item) => item?.group ?? "?",
    header: { height: 40, template: key => `match header ${key}` },
  }));
  plugins.push(search<Row>({ mode, position: "none", field: "name" }));
  const list = createVList({ container, items, item: { height: 40, template: (item: Row) => item.name } }, plugins) as VList<Row> & SearchMethods;
  const events: Array<{ index: number; id: number | undefined }> = [];
  list.on("search:match", event => events.push({ index: event.index, id: event.item?.id }));
  return { container, list, events, dispose(): void { list.destroy(); container.remove(); } };
}
for (const layout of ["groups", "table", "table-groups"] as const) {
  it(`search navigate + ${layout} — the current match is mounted inside the viewport`, async () => {
    const f = layoutSearch(layout, "navigate");
    try {
      await Promise.resolve();
      f.list.setQuery("match");
      expect(f.list.getMatches()).toEqual([70, 90]);
      const row = f.container.querySelector<HTMLElement>('[data-id="71"]');
      expect(row).not.toBeNull();
      const numbers = row!.style.transform.match(/-?\d+(?:\.\d+)?px/g)!;
      const offset = parseFloat(numbers[numbers.length - 1]!);
      expect(offset - f.list.getScrollPosition()).toBeGreaterThanOrEqual(0);
      expect(offset + 40 - f.list.getScrollPosition()).toBeLessThanOrEqual(500);
    } finally { f.dispose(); }
  });
  it(`search navigate + ${layout} — match events report the source item at their data index`, async () => {
    const f = layoutSearch(layout, "navigate");
    try {
      await Promise.resolve();
      f.list.setQuery("match");
      expect(f.events[0]).toEqual({ index: 70, id: 71 });
      f.list.nextMatch();
      expect(f.events[f.events.length - 1]).toEqual({ index: 90, id: 91 });
    } finally { f.dispose(); }
  });
  it(`search filter + ${layout} — the filtered source is the rendered source`, async () => {
    const f = layoutSearch(layout, "filter");
    try {
      await Promise.resolve();
      f.list.setQuery("match");
      expect(f.list.getMatches()).toEqual([70, 90]);
      expect(f.list.total).toBe(2);
      expect(f.list.getItemAt(0)?.id).toBe(71);
      expect(f.list.getItemAt(1)?.id).toBe(91);
      expect(f.container.querySelector('[data-id="71"]')).not.toBeNull();
      expect(f.container.querySelector('[data-id="91"]')).not.toBeNull();
      expect(f.container.querySelectorAll(".vlist-group-header .vlist-search-match, .vlist-table-group-header .vlist-search-match").length).toBe(0);
    } finally { f.dispose(); }
  });
}
for (const layout of ["groups", "table-groups"] as const) {
  it(`search filter + ${layout} — a same-count query change rebuilds group keys`, async () => {
    const f = layoutSearch(layout, "filter", [
      { id: 1, name: "pear one", group: "A" }, { id: 2, name: "pear two", group: "A" },
      { id: 3, name: "plum one", group: "B" }, { id: 4, name: "plum two", group: "B" },
    ]);
    try {
      await Promise.resolve();
      f.list.setQuery("pear");
      f.list.setQuery("plum");
      expect(f.list.total).toBe(2);
      expect(f.container.querySelector(".vlist-sticky-header")?.textContent).toContain("B");
      expect(f.container.querySelector(".vlist-sticky-header")?.textContent).not.toContain("A");
    } finally { f.dispose(); }
  });
}

it("search — minLength zero does not apply a query before search opens", () => {
  const container = createContainer();
  const list = createVList({ container, items: [{ id: 1, name: "one" }, { id: 2, name: "two" }],
    item: { height: 40, template: (item: Row) => item.name },
  }, [search<Row>({ minLength: 0, position: "none" })]);
  try {
    expect(list.total).toBe(2);
    expect(list.getItemAt(1)?.id).toBe(2);
    expect(list.getMatches()).toEqual([]);
  } finally { list.destroy(); container.remove(); }
});

for (const owner of ["standalone", "selection", "a11y"] as const) {
  for (const action of ["expandAll", "collapseAll", "siblings"] as const) {
    // Serial: keyboard focus owners read document.activeElement.
    it.serial(`tree + ${owner} — ${action} retains the focused root identity`, async () => {
      const plugins: VListPlugin<TreeRow>[] = owner === "standalone" ? [] : [owner === "selection" ? selection() : a11y()];
      const f = treeList(false, plugins);
      try {
        await Promise.resolve();
        const content = f.container.querySelector<HTMLElement>(".vlist-content")!;
        if (action === "collapseAll") f.list.expandAll();
        content.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
        content.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
        if (action === "siblings") content.dispatchEvent(new KeyboardEvent("keydown", { key: "*", bubbles: true, cancelable: true }));
        else f.list[action]();
        // Expanding between the viewport anchor and focus can move the ring offscreen.
        f.list.scrollToIndex(f.list.getIndexById("root-59"));
        expect(f.container.querySelector<HTMLElement>(".vlist-item--focused")?.dataset.id).toBe("root-59");
        const focused = f.row("root-59")!;
        expect(content.getAttribute("aria-activedescendant")).toBe(focused.id);
      } finally { f.dispose(); }
    });
  }
}

for (const kind of ["variable", "autosize"] as const) {
  it(`tree + ${kind} — measured rows preserve the scrolled anchor through expansion`, () => {
    const container = createContainer();
    let current: (VList<TreeRow> & TreeMethods<TreeRow>) | undefined;
    const rows = treeRows();
    rows[5]!.height = 90;
    rows[0]!.children[0]!.height = 75;
    rows[0]!.children[1]!.height = 95;
    const list = createVList({ container, items: rows, item: {
      ...(kind === "variable" ? { height: (index: number): number => (current?.getItemAt(index) ?? rows[index])?.height ?? 40 } : { estimatedHeight: 40 }),
      template: (item: TreeRow) => item.name,
    } }, [tree<TreeRow>(), ...(kind === "autosize" ? [autosize<TreeRow>()] : [])]) as VList<TreeRow> & TreeMethods<TreeRow> & AutosizeMethods;
    current = list;
    try {
      if (kind === "autosize") list.setMeasuredSize(5, 90);
      list.scrollToIndex(list.getIndexById("root-20"));
      const before = list.getScrollPosition();
      list.expand("root-0");
      expect(list.getScrollPosition()).toBe(before + (kind === "variable" ? 170 : 80));
      list.collapse("root-0");
      expect(list.getScrollPosition()).toBe(before);
      if (kind === "autosize") {
        list.scrollToIndex(list.getIndexById("root-6"));
        expect(list.getScrollPosition()).toBe(290);
      }
    } finally { list.destroy(); container.remove(); }
  });
}

it("tree + snapshots — an unchanged expanded layout restores its exact position", async () => {
  const f = treeList(false, [snapshots()]);
  const list = f.list as typeof f.list & SnapshotsMethods;
  try {
    list.expand("root-0");
    list.scrollToIndex(list.getIndexById("root-20"));
    const snapshot = list.getScrollSnapshot();
    list.scrollToIndex(0);
    await list.restoreScroll(snapshot);
    expect(list.getScrollPosition()).toBe(snapshot.scrollTop!);
    expect(f.row("root-20")).not.toBeNull();
  } finally { f.dispose(); }
});

it("tree — replacing an expanded tree removes its previous descendants", () => {
  const f = treeList();
  try {
    f.list.expandAll();
    f.list.setItems([{ id: "replacement", name: "Replacement", height: 40, children: [] }]);
    expect(f.list.total).toBe(1);
    expect(f.list.getItemAt(0)?.id).toBe("replacement");
    expect(f.list.getIndexById("child-0-0")).toBe(-1);
    expect(f.container.textContent).not.toContain("Child");
    expect(() => { f.list.expand("absent"); f.list.collapse("absent"); f.list.toggle("absent"); }).not.toThrow();
  } finally { f.dispose(); }
});

it("tree + a11y — deep descendants retain tree ARIA metadata", async () => {
  const container = createContainer();
  let node: TreeRow = { id: "deep-63", name: "Deep 63", height: 40, children: [] };
  for (let depth = 62; depth >= 0; depth--) node = { id: `deep-${depth}`, name: `Deep ${depth}`, height: 40, children: [node] };
  const list = createVList({ container, items: [node], item: { height: 40, template: (item: TreeRow) => item.name } }, [tree<TreeRow>({ expanded: true }), a11y()]);
  try {
    await Promise.resolve();
    list.scrollToIndex(63);
    const row = container.querySelector<HTMLElement>('[data-id="deep-63"]')!;
    expect(row.getAttribute("aria-level")).toBe("64");
    expect(row.getAttribute("aria-setsize")).toBe("1");
    expect(row.getAttribute("aria-posinset")).toBe("1");
    expect(row.hasAttribute("aria-expanded")).toBe(false);
  } finally { list.destroy(); container.remove(); }
});

for (const mode of ["filter", "navigate"] as const) {
  it(`search ${mode} — literal regex text, wrapping, empty query and destroy are safe`, () => {
    const container = createContainer();
    const list = createVList({ container, items: [{ id: 1, name: "[a.* first" }, { id: 2, name: "other" }, { id: 3, name: "[a.* last" }],
      item: { height: 40, template: (item: Row) => item.name },
    }, [search<Row>({ mode, position: "none", field: "name" })]);
    const ids: Array<number | undefined> = [];
    list.on("search:match", event => ids.push(event.item?.id));
    try {
      list.setQuery("[a.*");
      expect(list.getMatches()).toEqual([0, 2]);
      if (mode === "navigate") {
        list.prevMatch(); list.nextMatch(); list.nextMatch(); list.nextMatch();
        expect(ids).toEqual([1, 3, 1, 3, 1]);
      }
      list.setQuery("");
      expect(list.getMatches()).toEqual([]);
      expect(list.total).toBe(3);
      expect(container.querySelectorAll(".vlist-search-match").length).toBe(0);
      list.setQuery("[a.*");
      list.destroy();
      expect(container.querySelector(".vlist")).toBeNull();
    } finally { list.destroy(); container.remove(); }
  });
}

it("tree + selection — selection follows IDs across branch layout changes", () => {
  const f = treeList(false, [selection({ mode: "multiple" })]);
  const list = f.list as typeof f.list & SelectionMethods<TreeRow>;
  try {
    list.select("root-20");
    list.expand("root-0");
    expect(list.getSelected()).toEqual(["root-20"]);
    expect(list.getSelectedItems().map(item => item.id)).toEqual(["root-20"]);
    list.collapse("root-0");
    expect(list.getSelectedItems().map(item => item.id)).toEqual(["root-20"]);
  } finally { f.dispose(); }
});

for (const reversed of [false, true]) {
  it(`search + tree — the documented conflict refuses cleanly (${reversed ? "reversed" : "normal"} order)`, () => {
    const container = createContainer();
    try {
      const plugins: VListPlugin<TreeRow>[] = [search<TreeRow>(), tree<TreeRow>()];
      if (reversed) plugins.reverse();
      expect(() => createVList({ container, items: treeRows(), item: { height: 40, template: (item: TreeRow) => item.name } }, plugins)).toThrow('Plugin "search" conflicts with "tree"');
      expect(container.childElementCount).toBe(0);
    } finally { container.remove(); }
  });
}

for (const horizontal of [false, true]) {
  for (const view of [0, 20, 59]) {
    for (const branch of [0, 20, 59]) {
      for (const action of ["expand", "collapse"] as const) {
        it(`tree ${horizontal ? "horizontal" : "vertical"} — ${action} root ${branch} preserves root ${view} at the top, middle or end`, () => {
          const f = treeList(horizontal);
          try {
            if (action === "collapse") f.list.expand(`root-${branch}`);
            f.list.scrollToIndex(f.list.getIndexById(`root-${view}`));
            const before = f.list.getIndexById(`root-${view}`) * 40 - f.list.getScrollPosition();
            f.list[action](`root-${branch}`);
            const after = f.list.getIndexById(`root-${view}`) * 40 - f.list.getScrollPosition();
            expect(after).toBe(before);
          } finally { f.dispose(); }
        });
      }
    }
  }
}

for (const horizontal of [false, true]) {
  for (const action of ["expand", "collapse"] as const) {
    // Serial: this test owns the process-wide animation-frame scheduler.
    it.serial(`tree ${horizontal ? "horizontal" : "vertical"} — ${action} during smooth scrolling finishes at the requested visible index`, () => {
      const originalRequest = globalThis.requestAnimationFrame;
      const originalCancel = globalThis.cancelAnimationFrame;
      const callbacks = new Map<number, FrameRequestCallback>();
      let nextId = 0;
      globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => { callbacks.set(++nextId, callback); return nextId; };
      globalThis.cancelAnimationFrame = (id: number): void => { callbacks.delete(id); };
      const f = treeList(horizontal);
      try {
        if (action === "collapse") f.list.expand("root-0");
        const now = performance.now();
        const frame = (timestamp: number): void => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(timestamp); };
        f.list.scrollToIndex(40, { behavior: "smooth", duration: 10000, easing: value => value });
        frame(now + 5000);
        f.list[action]("root-0");
        frame(now + 20000);
        expect(f.list.getScrollPosition()).toBe(1600);
        expect(f.list.getItemAt(40)).toBeDefined();
      } finally { f.dispose(); globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel; }
    });
  }
}
