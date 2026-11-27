/**
 * A join that a nested edit leaves and then rejoins must stay a single match.
 * The outer update records the row before the previous hook runs, and that
 * hook can splice the same row itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import type { PluginContext, VList, VListPlugin } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { groups } from "../../../src/plugins/groups/plugin";
import { search } from "../../../src/plugins/search/plugin";
import { table } from "../../../src/plugins/table/plugin";

interface Row extends VListItem {
  id: number;
  label: string;
  group?: string;
  note?: string;
}

interface Api extends VList<Row> {
  setQuery(query: string): void;
  getMatches(): number[];
  getGroupLayout(): { totalEntries: number; groups: Array<{ key: string }> };
}

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 500; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

describe("search nested rejoin", () => {
  it("does not splice a row twice when a nested edit leaves and rejoins it", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const listRef: { list: VList<Row> | null } = { list: null };
    let nested = false;
    const earlier: VListPlugin<Row> = {
      name: "earlier-hook",
      priority: 40,
      setup(ctx) {
        const prev = ctx.hooks.get("_onItemUpdate") as ((id: string | number, updates: Partial<Row>) => void) | undefined;
        ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
          if (!nested && id === 2 && updates.label === "show" && listRef.list) {
            nested = true;
            const list = listRef.list;
            list.updateItem(2, { label: "hide" });
            list.updateItem(2, { label: "show" });
          }
          prev?.(id, updates);
        });
      },
    };
    const list = createVList<Row>(
      {
        container,
        items: [
          { id: 1, label: "show" },
          { id: 2, label: "hide" },
          { id: 3, label: "show" },
        ],
        item: { height: 30, template: (item) => item.label },
      },
      [earlier, search<Row>({ field: "label" })],
    );
    listRef.list = list;
    const events: number[] = [];
    const api = list as Api;
    list.on("search:change", (event) => events.push(event.matches));
    api.setQuery("show");
    events.length = 0;

    list.updateItem(2, { label: "show" });

    const matches = api.getMatches();
    const counter = container.querySelector(".vlist-search__counter")?.textContent ?? "";
    const reported = events[events.length - 1];
    expect(matches).toEqual([0, 1, 2]);
    expect(new Set(matches).size).toBe(matches.length);
    expect(reported).toBe(matches.length);
    expect(counter).toBe(`${matches.length} results`);
    list.destroy();
    container.remove();
  });

  function rows(label: string): Row[] {
    return [
      { id: 1, group: "A", label: "show" },
      { id: 2, group: "B", label },
      { id: 3, group: "C", label: "show" },
      { id: 4, group: "D", label: "hide" },
    ];
  }

  function mount(
    kind: "bare" | "list" | "table",
    source: Row[],
    earlier?: (list: Api, id: string | number, updates: Partial<Row>) => void,
  ): {
    list: Api;
    container: HTMLElement;
    engine: () => number;
    commits: string[];
    headers: string[];
    close: () => void;
  } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const commits: string[] = [];
    const headers: string[] = [];
    let ctx: PluginContext<Row> | null = null;
    const listRef: { list: Api | null } = { list: null };
    const plugins: Array<VListPlugin<Row>> = [];
    if (kind === "table") {
      plugins.push(table<Row>({ columns: [{ key: "group", label: "Group", width: 150 }], rowHeight: 40 }));
    }
    if (kind !== "bare") {
      plugins.push(groups<Row>({
        getGroupForIndex: (_index, item) => item?.group ?? "",
        header: { height: 32, template: (key) => { headers.push(key); return key; } },
        sticky: false,
      }));
    }
    plugins.push({
      name: "earlier-hook",
      priority: 40,
      setup(pluginCtx) {
        const prev = pluginCtx.hooks.get("_onItemUpdate") as ((id: string | number, updates: Partial<Row>) => void) | undefined;
        pluginCtx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
          if (listRef.list && earlier) earlier(listRef.list, id, updates);
          prev?.(id, updates);
        });
      },
    });
    plugins.push(search<Row>({ mode: "filter", field: "label" }));
    plugins.push({
      name: "watch",
      priority: 70,
      setup(pluginCtx) { ctx = pluginCtx; },
      hooks: { onCommit: () => { commits.push("commit"); } },
    });
    const list = createVList<Row>(
      { container, items: source, item: { height: 40, template: (item) => item.label } },
      plugins,
    ) as Api;
    listRef.list = list;
    list.on("search:change", (event) => { commits.push(`change:${event.matches}`); });
    return {
      list,
      container,
      engine: () => ctx!.getState().totalItems,
      commits,
      headers,
      close: () => { list.destroy(); container.remove(); },
    };
  }

  function view(list: Api, container: HTMLElement, engine: number): {
    matches: number[];
    total: number;
    engine: number;
    entries: number;
    keys: string[];
    aria: string | null;
    counter: string;
    ids: number[];
  } {
    const layout = list.getGroupLayout();
    const content = container.querySelector(".vlist-content");
    const ids = [...(content?.querySelectorAll("[data-id]") ?? [])]
      .filter((node) => !node.getAttribute("data-id")!.startsWith("__group_header_"))
      .sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")))
      .map((node) => Number(node.getAttribute("data-id")));
    return {
      matches: list.getMatches(),
      total: list.total,
      engine,
      entries: layout.totalEntries,
      keys: layout.groups.map((group) => group.key),
      aria: container.querySelector(".vlist")?.getAttribute("aria-rowcount") ?? null,
      counter: container.querySelector(".vlist-search__counter")?.textContent ?? "",
      ids,
    };
  }

  function expectAgreed(list: Api, container: HTMLElement, engine: number, rendered: number[]): void {
    const snap = view(list, container, engine);
    const n = snap.matches.length;
    expect(new Set(snap.matches).size).toBe(n);
    expect(snap.total).toBe(n);
    expect(snap.engine).toBe(snap.entries);
    expect(snap.entries).toBe(n + snap.keys.length);
    expect(snap.aria).toBe(String(snap.entries + 1));
    expect(snap.counter).toBe(`${n} results`);
    expect(snap.ids).toEqual(rendered);
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  for (const variant of ["join", "leave"] as const) {
    it(`keeps a committed nested rejoin when the outer ${variant} throws`, async () => {
      let once = true;
      const mounted = mount("table", rows(variant === "join" ? "hide" : "show"), (list, id) => {
        if (!once || id !== 2) return;
        once = false;
        if (variant === "join") list.updateItem(2, { label: "hide" });
        list.updateItem(2, { label: "show" });
        throw new Error("outer after rejoin");
      });
      mounted.list.setQuery("show");
      await flush();
      let error = "";
      try {
        mounted.list.updateItem(2, { label: variant === "join" ? "show" : "hide" });
      } catch (err) {
        error = (err as Error).message;
      }
      await flush();
      expect(error).toBe("outer after rejoin");
      expect(mounted.list.getMatches()).toEqual([0, 1, 2]);
      expectAgreed(mounted.list, mounted.container, mounted.engine(), [1, 2, 3]);

      mounted.list.updateItem(4, { note: "side edit" });
      await flush();
      expect(mounted.list.getMatches()).toEqual([0, 1, 2]);
      expectAgreed(mounted.list, mounted.container, mounted.engine(), [1, 2, 3]);

      mounted.list.updateItem(2, { label: "hide" });
      await flush();
      expect(mounted.list.getMatches()).toEqual([0, 2]);
      expectAgreed(mounted.list, mounted.container, mounted.engine(), [1, 3]);
      mounted.close();
    });
  }

  for (const variant of ["join", "leave"] as const) {
    it(`stays consistent when a nested join of another row completes and the outer ${variant} throws`, async () => {
      let once = true;
      const mounted = mount("table", rows(variant === "join" ? "hide" : "show"), (list, id) => {
        if (!once || id !== 2) return;
        once = false;
        list.updateItem(4, { label: "show" });
        throw new Error("outer after other");
      });
      mounted.list.setQuery("show");
      await flush();
      let error = "";
      try {
        mounted.list.updateItem(2, { label: variant === "join" ? "show" : "hide" });
      } catch (err) {
        error = (err as Error).message;
      }
      await flush();
      expect(error).toBe("outer after other");
      expect(mounted.list.getMatches()).toEqual([0, 2, 3]);
      expectAgreed(mounted.list, mounted.container, mounted.engine(), [1, 3, 4]);

      mounted.list.updateItem(1, { note: "side" });
      await flush();
      expect(mounted.list.getMatches()).toEqual([0, 2, 3]);
      expectAgreed(mounted.list, mounted.container, mounted.engine(), [1, 3, 4]);

      mounted.list.updateItem(2, { label: variant === "join" ? "show" : "hide" });
      await flush();
      const retried = variant === "join" ? [0, 1, 2, 3] : [0, 2, 3];
      const retriedIds = variant === "join" ? [1, 2, 3, 4] : [1, 3, 4];
      expect(mounted.list.getMatches()).toEqual(retried);
      expectAgreed(mounted.list, mounted.container, mounted.engine(), retriedIds);
      mounted.close();
    });
  }

  it("reports one match count for a nested join", () => {
    let once = true;
    const seen: number[][] = [];
    const mounted = mount("table", rows("hide"), (list, id) => {
      if (once && id === 2) {
        once = false;
        list.updateItem(4, { label: "show" });
      }
    });
    const agreed: boolean[] = [];
    mounted.list.on("search:change", (event) => {
      const matches = mounted.list.getMatches();
      const counter = mounted.container.querySelector(".vlist-search__counter")?.textContent ?? "";
      agreed.push(event.matches === matches.length && mounted.list.total === matches.length && counter === `${matches.length} results`);
      seen.push(matches);
    });
    mounted.list.setQuery("show");
    seen.length = 0;
    mounted.list.updateItem(2, { label: "show" });
    expect(agreed.every(Boolean)).toBe(true);
    expect(seen[0]).toEqual([0, 1, 2, 3]);
    expect(seen[seen.length - 1]).toEqual([0, 1, 2, 3]);
    mounted.close();
  });

  it("reports the settled count once when a nested join is followed by an outer throw", async () => {
    let once = true;
    const mounted = mount("table", rows("hide"), (list, id) => {
      if (!once || id !== 2) return;
      once = false;
      list.updateItem(4, { label: "show" });
      throw new Error("outer after other");
    });
    mounted.list.setQuery("show");
    await flush();
    const events: number[] = [];
    mounted.list.on("search:change", (event) => {
      const matches = mounted.list.getMatches();
      const counter = mounted.container.querySelector(".vlist-search__counter")?.textContent ?? "";
      expect(event.matches).toBe(matches.length);
      expect(mounted.list.total).toBe(matches.length);
      expect(counter).toBe(`${matches.length} results`);
      events.push(event.matches);
    });
    let error = "";
    try {
      mounted.list.updateItem(2, { label: "show" });
    } catch (err) {
      error = (err as Error).message;
    }
    await flush();
    expect(error).toBe("outer after other");
    expect(mounted.list.getMatches()).toEqual([0, 2, 3]);
    expect(events).toEqual([3]);
    mounted.close();
  });

  it("commits a filter join once and a grouped table leave twice", async () => {
    const join = mount("table", rows("hide"));
    join.list.setQuery("show");
    await flush();
    join.commits.length = 0;
    join.headers.length = 0;
    join.list.updateItem(2, { label: "show" });
    await flush();
    expect(join.commits.filter((entry) => entry === "commit")).toEqual(["commit"]);
    expect(join.headers).toEqual(["A", "B", "C"]);
    join.close();

    const leave = mount("table", rows("show"));
    leave.list.setQuery("show");
    await flush();
    leave.commits.length = 0;
    leave.headers.length = 0;
    leave.list.updateItem(2, { label: "hide" });
    await flush();
    expect(leave.commits.filter((entry) => entry === "commit")).toEqual(["commit", "commit"]);
    expect(leave.headers).toEqual(["A", "C"]);
    leave.close();

    const list = mount("list", rows("hide"));
    list.list.setQuery("show");
    await flush();
    list.commits.length = 0;
    list.headers.length = 0;
    list.list.updateItem(2, { label: "show" });
    await flush();
    expect(list.commits.filter((entry) => entry === "commit")).toEqual(["commit"]);
    const shown = [...list.container.querySelectorAll(".vlist-group-header")].map((node) => node.textContent);
    expect(shown).toEqual(["A", "B", "C"]);
    expect(new Set(list.headers).size).toBe(list.headers.length);
    list.close();

    const bare = mount("bare", rows("hide"));
    bare.list.setQuery("show");
    await flush();
    bare.commits.length = 0;
    bare.list.updateItem(2, { label: "show" });
    await flush();
    expect(bare.commits.filter((entry) => entry === "commit")).toEqual(["commit"]);
    bare.close();
  });
});
