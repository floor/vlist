/**
 * vlist — Search Plugin Tests (RFC-008 Phase 1)
 *
 * Integration tests against a real createVList instance (happy-dom):
 * search bar injection, filter + navigate modes, highlighting, keyboard,
 * events, methods, template state, and cleanup.
 */

import { capturePrototypeGeometry } from "../../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import { search } from "../../../src/plugins/search/plugin";
import { selection } from "../../../src/plugins/selection/plugin";
import { groups } from "../../../src/plugins/groups/plugin";
import { data } from "../../../src/plugins/data";
import { tree } from "../../../src/plugins/tree";
import { createTestItems } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import type { VListItem, ItemState } from "../../../src/types";

interface Fruit extends VListItem {
  id: number;
  name: string;
  kind: string;
}

const FRUITS: Fruit[] = [
  { id: 1, name: "Apple", kind: "pome" },
  { id: 2, name: "Banana", kind: "berry" },
  { id: 3, name: "Cherry", kind: "drupe" },
  { id: 4, name: "Apricot", kind: "drupe" },
  { id: 5, name: "Grape", kind: "berry" },
];


let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 500; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});

afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

let lists: Array<VList<VListItem>> = [];
afterEach(() => {
  for (const l of lists) l.destroy();
  lists = [];
  document.body.innerHTML = "";
});

function makeList(
  searchConfig: Parameters<typeof search<Fruit>>[0] = {},
  template?: (item: Fruit, index: number, state: ItemState) => string,
): { list: VList<Fruit>; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const list = createVList<Fruit>(
    {
      container,
      items: FRUITS.slice(),
      item: { height: 30, template: template ?? ((item) => item.name) },
    },
    [search<Fruit>(searchConfig)],
  );
  lists.push(list);
  return { list, container };
}

const q = <T extends VList<Fruit>>(list: T, name: string): any => (list as any)[name];

// =============================================================================
// Search bar injection
// =============================================================================

describe("search bar", () => {
  it("injects a search bar at the top by default, before the viewport", () => {
    const { container } = makeList();
    const bar = container.querySelector(".vlist-search");
    const viewport = container.querySelector(".vlist-viewport");
    expect(bar).not.toBeNull();
    expect(bar!.classList.contains("vlist-search--top")).toBe(true);
    // Top bar precedes the viewport in DOM order.
    expect(bar!.compareDocumentPosition(viewport!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".vlist-search__input")).not.toBeNull();
  });

  it("uses the modular BEM structure (container / leading-icon / input / clear)", () => {
    const { container } = makeList();
    const bar = container.querySelector(".vlist-search")!;
    expect(bar.getAttribute("role")).toBe("search");
    expect(bar.classList.contains("vlist-search--bar")).toBe(true);
    expect(container.querySelector(".vlist-search__container")).not.toBeNull();
    expect(container.querySelector(".vlist-search__leading-icon")).not.toBeNull();
    expect(
      container.querySelector(".vlist-search__input-wrapper .vlist-search__input"),
    ).not.toBeNull();
    expect(container.querySelector(".vlist-search__clear-button")).not.toBeNull();
  });

  it("toggles the clear button --hidden based on the query", () => {
    const { container, list } = makeList();
    const clear = container.querySelector(".vlist-search__clear-button")!;
    expect(clear.classList.contains("vlist-search__clear-button--hidden")).toBe(true);
    q(list, "setQuery")("ap");
    expect(clear.classList.contains("vlist-search__clear-button--hidden")).toBe(false);
    q(list, "setQuery")("");
    expect(clear.classList.contains("vlist-search__clear-button--hidden")).toBe(true);
  });

  it("positions the bar at the bottom when configured", () => {
    const { container } = makeList({ position: "bottom" });
    const bar = container.querySelector(".vlist-search");
    expect(bar!.classList.contains("vlist-search--bottom")).toBe(true);
  });

  it("renders no bar in invisible mode", () => {
    const { container } = makeList({ position: "none" });
    expect(container.querySelector(".vlist-search")).toBeNull();
  });

  it("registers public methods", () => {
    const { list } = makeList();
    for (const m of ["openSearch", "closeSearch", "setQuery", "getQuery", "nextMatch", "prevMatch", "getMatches"]) {
      expect(typeof q(list, m)).toBe("function");
    }
  });

  it("removes the bar on destroy", () => {
    const { list, container } = makeList();
    q(list, "openSearch")();
    expect(container.querySelector(".vlist-search")).not.toBeNull();
    list.destroy();
    lists = lists.filter((l) => l !== list);
    expect(container.querySelector(".vlist-search")).toBeNull();
  });
});

// =============================================================================
// Externalized UI text (RFC-010)
// =============================================================================

describe("externalized text (RFC-010)", () => {
  it("renders the leading magnifier as a decorative, non-focusable element", () => {
    const { container } = makeList();
    const icon = container.querySelector(".vlist-search__leading-icon")!;
    expect(icon.tagName).toBe("SPAN"); // not a <button>
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.hasAttribute("tabindex")).toBe(false);
  });

  it("leaves the search landmark unnamed by default", () => {
    const { container } = makeList();
    const bar = container.querySelector(".vlist-search")!;
    expect(bar.getAttribute("role")).toBe("search");
    expect(bar.hasAttribute("aria-label")).toBe(false);
  });

  it("names the landmark only when text.region is provided", () => {
    const { container } = makeList({ text: { region: "Recherche" } });
    expect(container.querySelector(".vlist-search")!.getAttribute("aria-label")).toBe("Recherche");
  });

  it("uses consumer-supplied placeholder and button labels", () => {
    const { container } = makeList({
      mode: "navigate",
      text: { placeholder: "Filtrer…", clear: "Effacer", previous: "Précédent", next: "Suivant" },
    });
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    expect(input.placeholder).toBe("Filtrer…");
    expect(input.getAttribute("aria-label")).toBe("Filtrer…");
    expect(container.querySelector(".vlist-search__clear-button")!.getAttribute("aria-label")).toBe("Effacer");
    expect(container.querySelector(".vlist-search__nav-prev")!.getAttribute("aria-label")).toBe("Précédent");
    expect(container.querySelector(".vlist-search__nav-next")!.getAttribute("aria-label")).toBe("Suivant");
  });

  it("formats filter-mode counter text via consumer-supplied functions", () => {
    const { container, list } = makeList({
      text: { noResults: "Aucun résultat", results: (n) => `${n} trouvé${n === 1 ? "" : "s"}` },
    });
    q(list, "setQuery")("ap"); // 3 matches
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("3 trouvés");
    q(list, "setQuery")("zzz"); // none
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("Aucun résultat");
  });

  it("formats the navigate-mode position via text.position", () => {
    const { container, list } = makeList({
      mode: "navigate",
      text: { position: (c, t) => `${c}/${t}` },
    });
    q(list, "setQuery")("ap");
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("1/3");
  });
});

// =============================================================================
// Filter mode
// =============================================================================

describe("filter mode", () => {
  it("filters items to case-insensitive matches", () => {
    const { list } = makeList({ mode: "filter" });
    q(list, "setQuery")("ap");
    // "Apple", "Apricot", "Grape" all contain "ap" (case-insensitive)
    expect(list.total).toBe(3);
    expect(q(list, "getQuery")()).toBe("ap");
  });

  it("restores all items when the query is cleared", () => {
    const { list } = makeList({ mode: "filter" });
    q(list, "setQuery")("ap");
    expect(list.total).toBe(3);
    q(list, "setQuery")("");
    expect(list.total).toBe(5);
  });

  it("restores all items on closeSearch", () => {
    const { list } = makeList({ mode: "filter" });
    q(list, "setQuery")("cherry");
    expect(list.total).toBe(1);
    q(list, "closeSearch")();
    expect(list.total).toBe(5);
  });

  it("shows zero matches for a non-matching query", () => {
    const { list } = makeList({ mode: "filter" });
    q(list, "setQuery")("zzz");
    expect(list.total).toBe(0);
    expect(q(list, "getMatches")()).toEqual([]);
  });

  it("respects a specific field accessor", () => {
    const { list } = makeList({ field: "kind" });
    q(list, "setQuery")("berry"); // matches Banana + Grape by kind
    expect(list.total).toBe(2);
  });

  it("supports case-sensitive matching", () => {
    const { list } = makeList({ caseSensitive: true });
    q(list, "setQuery")("apple"); // lowercase — no match against "Apple"
    expect(list.total).toBe(0);
    q(list, "setQuery")("Apple");
    expect(list.total).toBe(1);
  });

  it("honors minLength", () => {
    const { list } = makeList({ minLength: 3 });
    q(list, "setQuery")("ap"); // below minLength — no filtering
    expect(list.total).toBe(5);
    q(list, "setQuery")("app");
    expect(list.total).toBe(1);
  });
});

// =============================================================================
// Navigate mode
// =============================================================================

describe("navigate mode", () => {
  it("keeps all items and exposes match indices", () => {
    const { list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    expect(list.total).toBe(5); // nothing hidden
    // Apple (0), Apricot (3), Grape (4) contain "ap"
    expect(q(list, "getMatches")()).toEqual([0, 3, 4]);
  });

  it("cycles through matches and emits search:match", () => {
    const { list } = makeList({ mode: "navigate" });
    const seen: number[] = [];
    list.on("search:match", (e: any) => seen.push(e.matchIndex));
    q(list, "setQuery")("ap"); // initial → matchIndex 0
    q(list, "nextMatch")(); // → 1
    q(list, "nextMatch")(); // → 2
    q(list, "nextMatch")(); // wraps → 0
    expect(seen).toEqual([0, 1, 2, 0]);
  });

  it("prevMatch wraps to the last match", () => {
    const { list } = makeList({ mode: "navigate" });
    const seen: number[] = [];
    list.on("search:match", (e: any) => seen.push(e.matchIndex));
    q(list, "setQuery")("ap"); // → 0
    q(list, "prevMatch")(); // wraps → 2
    expect(seen[seen.length - 1]).toBe(2);
  });
});

// =============================================================================
// Highlighting
// =============================================================================

describe("highlighting", () => {
  it("wraps matched text in <mark> in filter mode", () => {
    const { container, list } = makeList({ mode: "filter" });
    q(list, "setQuery")("err"); // "Cherry"
    const mark = container.querySelector(".vlist-search-match");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("err");
  });

  it("does not highlight when highlight: false", () => {
    const { container, list } = makeList({ highlight: false });
    q(list, "setQuery")("err");
    expect(container.querySelector(".vlist-search-match")).toBeNull();
  });

  it("removes marks when the query is cleared", () => {
    const { container, list } = makeList();
    q(list, "setQuery")("err");
    expect(container.querySelector(".vlist-search-match")).not.toBeNull();
    q(list, "setQuery")("");
    expect(container.querySelector(".vlist-search-match")).toBeNull();
  });

  it("scopes marks to highlight.within and leaves other fields unmarked", () => {
    // Template splits name and kind into separate elements. The query "err"
    // appears in both Cherry's name and the "berry" kind — but `within: .name`
    // should mark only the name.
    const tpl = (item: Fruit) =>
      `<span class="name">${item.name}</span><span class="kind">${item.kind}</span>`;
    const { container, list } = makeList({ highlight: { within: ".name" } }, tpl);
    q(list, "setQuery")("err");
    expect(container.querySelector(".name .vlist-search-match")).not.toBeNull();
    expect(container.querySelector(".kind .vlist-search-match")).toBeNull();
  });

  it("marks both fields without a scope (whole-row default)", () => {
    const tpl = (item: Fruit) =>
      `<span class="name">${item.name}</span><span class="kind">${item.kind}</span>`;
    const { container, list } = makeList({}, tpl);
    q(list, "setQuery")("err");
    expect(container.querySelector(".name .vlist-search-match")).not.toBeNull();
    expect(container.querySelector(".kind .vlist-search-match")).not.toBeNull();
  });

  it("progressive typing highlights the full query, not stale partial marks", () => {
    const { container, list } = makeList({ mode: "filter", field: "name" });

    // Simulate typing "cherry" one character at a time
    q(list, "setQuery")("c");
    q(list, "setQuery")("ch");
    q(list, "setQuery")("che");
    q(list, "setQuery")("cher");
    q(list, "setQuery")("cherr");
    q(list, "setQuery")("cherry");

    const marks = container.querySelectorAll(".vlist-search-match");
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe("Cherry");
  });

  it("clears stale marks when query changes to a different match", () => {
    const { container, list } = makeList({ mode: "filter", field: "name" });

    q(list, "setQuery")("app");
    let marks = container.querySelectorAll(".vlist-search-match");
    expect(marks.length).toBeGreaterThan(0);
    const firstMarkText = marks[0]!.textContent;
    expect(firstMarkText).toBe("App");

    q(list, "setQuery")("grape");
    marks = container.querySelectorAll(".vlist-search-match");
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe("Grape");
  });

  it("does not leave marks from a shorter query inside longer-match text", () => {
    const tpl = (item: Fruit) => `<span class="name">${item.name}</span>`;
    const { container, list } = makeList({ mode: "navigate", field: "name" }, tpl);

    q(list, "setQuery")("a");
    q(list, "setQuery")("ap");
    q(list, "setQuery")("apr");

    // "Apricot" matches "apr" — the mark should wrap "Apr", not have
    // leftover single-char marks from "a" or "ap" queries.
    const nameEl = container.querySelector(".name .vlist-search-match");
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent!.toLowerCase()).toBe("apr");

    const allMarks = container.querySelectorAll(".name .vlist-search-match");
    for (const m of Array.from(allMarks)) {
      expect(m.textContent!.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// =============================================================================
// Highlight invalidation — a commit that only moved the range rebuilds nothing
// =============================================================================

describe("highlight invalidation", () => {
  /** Map of data index → the row's first `<mark>`, for every marked row. */
  const markNodes = (root: HTMLElement): Map<string, Node> => {
    const map = new Map<string, Node>();
    const rows = root.querySelectorAll(".vlist-item");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const mark = row.querySelector(".vlist-search-match");
      if (mark) map.set(row.getAttribute("data-index")!, mark);
    }
    return map;
  };

  /** Rows marked in both snapshots whose `<mark>` nodes were re-created. */
  const rebuiltRows = (before: Map<string, Node>, after: Map<string, Node>): number => {
    let n = 0;
    for (const [index, mark] of after) {
      const prev = before.get(index);
      if (prev !== undefined && prev !== mark) n++;
    }
    return n;
  };

  const withScrollableList = (
    run: (list: VList<TestItem>, container: HTMLElement) => void,
    mode: "filter" | "navigate" = "filter",
  ): void => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(200),
        item: { height: 30, template: (row: TestItem) => row.name },
      },
      [search<TestItem>({ field: "name", mode })],
    );
    try {
      run(list, container);
    } finally {
      list.destroy();
      container.remove();
    }
  };

  it("rebuilds only the newly entered rows when the range moves", () => {
    withScrollableList((list, container) => {
      (list as any).setQuery("1");
      const before = markNodes(container);
      expect(before.size).toBeGreaterThan(0);

      list.scrollToIndex(3);
      const after = markNodes(container);

      // Rows that stayed in the range keep the exact <mark> nodes built for
      // them — the whole point: a range move is not a highlight invalidation.
      let retained = 0;
      for (const index of after.keys()) if (before.has(index)) retained++;
      expect(retained).toBeGreaterThan(0);
      expect(rebuiltRows(before, after)).toBe(0);

      // The rows that did enter are highlighted, so the marks are correct.
      for (const [, mark] of after) expect(mark.textContent).toBe("1");
    });
  });

  it("rebuilds every visible row when the query changes", () => {
    withScrollableList((list, container) => {
      (list as any).setQuery("1");
      const before = markNodes(container);
      (list as any).setQuery("11");
      const after = markNodes(container);
      expect(after.size).toBeGreaterThan(0);
      expect(rebuiltRows(before, after)).toBe(after.size);
      for (const [, mark] of after) expect(mark.textContent).toBe("11");
    });
  });

  it("re-highlights a row whose item was updated under an active query", () => {
    // Navigate mode keeps every row in place, so the update is the only thing
    // that changed: the marks must follow the new text, not the old stamp.
    withScrollableList((list, container) => {
      (list as any).setQuery("1");
      const row = container.querySelector('.vlist-item[data-index="1"]')!;
      expect(row.textContent).toBe("Item 2");
      expect(row.querySelector(".vlist-search-match")).toBeNull();

      list.updateItem(list.items[1]!.id, { name: "Item 101" } as Partial<TestItem>);

      const updated = container.querySelector('.vlist-item[data-index="1"]')!;
      expect(updated.textContent).toBe("Item 101");
      expect(updated.querySelectorAll(".vlist-search-match").length).toBe(2);
    }, "navigate");
  });

  it("re-highlights a row whose element template returned the same node again", () => {
    // An element template may keep one node per row and rewrite it in place.
    // The row's first child is then the same object before and after the
    // update, while everything the highlight pass built inside it is gone —
    // so node identity cannot stand in for "this row still holds its marks".
    const container = document.createElement("div");
    document.body.appendChild(container);
    const nodes = new Map<number, HTMLElement>();
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(200),
        item: {
          height: 30,
          template: (row: TestItem): HTMLElement => {
            let node = nodes.get(row.id);
            if (node === undefined) {
              node = document.createElement("span");
              nodes.set(row.id, node);
            }
            node.textContent = row.name;
            return node;
          },
        },
      },
      [search<TestItem>({ field: "name", mode: "navigate" })],
    );
    try {
      (list as any).setQuery("1");
      const row = container.querySelector('.vlist-item[data-index="1"]')!;
      expect(row.textContent).toBe("Item 2");
      expect(row.querySelector(".vlist-search-match")).toBeNull();
      const reused = row.firstChild;

      list.updateItem(list.items[1]!.id, { name: "Item 101" } as Partial<TestItem>);

      const updated = container.querySelector('.vlist-item[data-index="1"]')!;
      // The premise: the template really did hand back the same node object.
      expect(updated.firstChild).toBe(reused);
      expect(updated.textContent).toBe("Item 101");
      expect(updated.querySelectorAll(".vlist-search-match").length).toBe(2);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("re-highlights a row that left the range and came back", () => {
    withScrollableList((list, container) => {
      (list as any).setQuery("1");
      const before = markNodes(container);
      list.scrollToIndex(150);
      list.scrollToIndex(0);
      const after = markNodes(container);
      // Same indices, freshly rendered rows: the pool cleared their content,
      // so the marks must have been rebuilt rather than assumed still there.
      expect(after.size).toBe(before.size);
      for (const [index, mark] of after) {
        expect(before.has(index)).toBe(true);
        expect(mark.textContent).toBe("1");
      }
    });
  });
});

describe("navigate mode — current match", () => {
  const currentRow = (container: HTMLElement): string | null => {
    const mark = container.querySelector(".vlist-search-match--current");
    return mark ? mark.closest(".vlist-item")!.getAttribute("data-index") : null;
  };

  it("moves the --current class without rebuilding the marks", () => {
    // All five fruits fit the viewport, so nothing scrolls out: any change to
    // the <mark> nodes would be a rebuild the current-match move did not need.
    const { container, list } = makeList({ mode: "navigate", field: "name" });
    q(list, "setQuery")("a"); // Apple, Banana, Apricot, Grape

    const marks = Array.from(container.querySelectorAll(".vlist-search-match"));
    expect(marks.length).toBeGreaterThan(1);
    const first = currentRow(container);
    expect(first).not.toBeNull();

    q(list, "nextMatch")();

    // Node identity, not deep equality: the marks must be the very same nodes.
    const after = Array.from(container.querySelectorAll(".vlist-search-match"));
    expect(after.length).toBe(marks.length);
    for (let i = 0; i < after.length; i++) expect(after[i] === marks[i]).toBe(true);
    expect(currentRow(container)).not.toBe(first);
  });

  it("removes the marks when the query is cleared", () => {
    // Navigate mode keeps every item rendered, so no re-render sweeps the
    // marks away — the highlight pass has to clear them itself.
    const { container, list } = makeList({ mode: "navigate", field: "name" });
    q(list, "setQuery")("err");
    expect(container.querySelector(".vlist-search-match")).not.toBeNull();
    q(list, "setQuery")("");
    expect(container.querySelector(".vlist-search-match")).toBeNull();
    expect(container.textContent).toContain("Cherry");
  });
});

// =============================================================================
// Template state
// =============================================================================

describe("template state", () => {
  it("exposes state.search to the template (rendered/matched items)", () => {
    // Filter mode re-runs templates for the (changed) visible set, so matched
    // rows receive state.search. (Navigate mode keeps items, so its current
    // indicator comes from the highlight pass, not template re-runs.)
    const captured: Record<number, ItemState["search"]> = {};
    const { list } = makeList({ mode: "filter" }, (item, _index, state) => {
      captured[item.id] = state.search ? { ...state.search } : undefined;
      return item.name;
    });
    q(list, "setQuery")("err"); // only Cherry matches → it replaces Apple at index 0
    // Cherry (id 3) newly occupies a render slot → template re-runs with state.
    expect(captured[3]?.matched).toBe(true);
    expect(captured[3]?.query).toBe("err");
  });
});

// =============================================================================
// Events
// =============================================================================

describe("events", () => {
  it("emits search:change with query, matches, total", () => {
    const { list } = makeList();
    let payload: any = null;
    list.on("search:change", (e: any) => { payload = e; });
    q(list, "setQuery")("ap");
    expect(payload).toEqual({ query: "ap", matches: 3, total: 5 });
  });

  it("emits search:open and search:close", () => {
    const { list } = makeList();
    let opened = false;
    let closed = false;
    list.on("search:open", () => { opened = true; });
    list.on("search:close", () => { closed = true; });
    q(list, "openSearch")();
    expect(opened).toBe(true);
    q(list, "closeSearch")();
    expect(closed).toBe(true);
  });
});

// =============================================================================
// Search bar input + counter
// =============================================================================

describe("search bar input", () => {
  it("typing in the input filters and updates the counter", () => {
    const { container, list } = makeList({ mode: "filter" });
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    input.value = "ap";
    input.dispatchEvent(new Event("input"));
    expect(list.total).toBe(3);
    const counter = container.querySelector(".vlist-search__counter");
    expect(counter!.textContent).toBe("3 results");
  });

  it("shows 'No results' when nothing matches", () => {
    const { container, list } = makeList();
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    const counter = container.querySelector(".vlist-search__counter");
    expect(counter!.textContent).toBe("No results");
  });

  it("navigate-mode counter shows 'n of m'", () => {
    const { container, list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("1 of 3");
    q(list, "nextMatch")();
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("2 of 3");
  });
});

// =============================================================================
// Search bar buttons — what a pointer user reaches
// =============================================================================

describe("search bar buttons", () => {
  const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };

  // Serial: reads document.activeElement, which is one per process.
  it.serial("the clear button empties the query, brings every item back and returns focus to the input", () => {
    const { container, list } = makeList({ mode: "filter" });
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    const clear = container.querySelector(".vlist-search__clear-button")!;
    input.value = "ap";
    input.dispatchEvent(new Event("input"));
    expect(list.total).toBe(3);
    expect(clear.classList.contains("vlist-search__clear-button--hidden")).toBe(false);

    click(clear);

    expect(q(list, "getQuery")()).toBe("");
    expect(input.value).toBe("");
    expect(list.total).toBe(FRUITS.length);
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("");
    expect(container.querySelector("mark")).toBeNull();
    // The button hides itself once there is nothing left to clear.
    expect(clear.classList.contains("vlist-search__clear-button--hidden")).toBe(true);
    // The user clicked a button; typing must go on in the field, not the button.
    expect(document.activeElement).toBe(input);
  });

  it("the clear button announces the emptied query through search:change", () => {
    const { container, list } = makeList({ mode: "filter" });
    q(list, "setQuery")("ap");
    const changes: Array<{ query: string; matches: number; total: number }> = [];
    list.on("search:change" as any, (e: any) => changes.push(e));

    click(container.querySelector(".vlist-search__clear-button")!);

    expect(changes).toEqual([{ query: "", matches: 0, total: FRUITS.length }]);
  });

  it("the next and previous buttons step through the matches in navigate mode", () => {
    const { container, list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    const counter = container.querySelector(".vlist-search__counter")!;
    const matched: number[] = [];
    list.on("search:match" as any, (e: any) => matched.push(e.index));
    expect(counter.textContent).toBe("1 of 3");

    click(container.querySelector(".vlist-search__nav-next")!);
    expect(counter.textContent).toBe("2 of 3");
    click(container.querySelector(".vlist-search__nav-next")!);
    expect(counter.textContent).toBe("3 of 3");
    click(container.querySelector(".vlist-search__nav-prev")!);
    expect(counter.textContent).toBe("2 of 3");

    // Apple (0), Apricot (3) and Grape (4) match "ap"; the buttons walked 3 → 4 → 3.
    expect(matched).toEqual([3, 4, 3]);
  });

  it("the previous button wraps from the first match to the last", () => {
    const { container, list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    click(container.querySelector(".vlist-search__nav-prev")!);
    expect(container.querySelector(".vlist-search__counter")!.textContent).toBe("3 of 3");
  });

  it("shows the step buttons in navigate mode and hides them in filter mode", () => {
    const nav = makeList({ mode: "navigate" }).container;
    expect(nav.querySelector(".vlist-search__nav-prev")!.classList.contains("vlist-search__nav-prev--hidden")).toBe(false);
    expect(nav.querySelector(".vlist-search__nav-next")!.classList.contains("vlist-search__nav-next--hidden")).toBe(false);

    const filter = makeList({ mode: "filter" }).container;
    expect(filter.querySelector(".vlist-search__nav-prev")!.classList.contains("vlist-search__nav-prev--hidden")).toBe(true);
    expect(filter.querySelector(".vlist-search__nav-next")!.classList.contains("vlist-search__nav-next--hidden")).toBe(true);
  });

  // Serial: reads document.activeElement, which is one per process.
  it.serial("clicking the magnifier puts the caret in the input", () => {
    const { container } = makeList();
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    click(container.querySelector(".vlist-search__leading-icon")!);
    expect(document.activeElement).toBe(input);
  });

  it("typing into a destroyed bar no longer filters the list", () => {
    const { container, list } = makeList({ mode: "filter" });
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;

    list.destroy();
    lists = lists.filter((l) => l !== list);
    expect(list.total).toBe(FRUITS.length);

    // The node is detached but still reachable by whoever kept a reference.
    input.value = "ap";
    input.dispatchEvent(new Event("input"));
    expect(list.total).toBe(FRUITS.length);
  });
});

// =============================================================================
// Keys pressed while the caret is in the search input
// =============================================================================

describe("search bar keys", () => {
  /** A real, cancelable keydown; reports whether the plugin claimed it. */
  function pressIn(el: HTMLElement, key: string, opts: KeyboardEventInit = {}): boolean {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  }

  function openAndType(value: string) {
    const made = makeList({ mode: "navigate" });
    const input = made.container.querySelector(".vlist-search__input") as HTMLInputElement;
    const counter = made.container.querySelector(".vlist-search__counter")!;
    // Ctrl+F from the list opens search; the user then types in the field.
    pressIn(made.list.element, "f", { ctrlKey: true });
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { ...made, input, counter };
  }

  // Serial: reads document.activeElement, which is one per process.
  it.serial("Ctrl+F on the list moves the caret into the search field", () => {
    const { container, list } = makeList({ mode: "navigate" });
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    expect(pressIn(list.element, "f", { ctrlKey: true })).toBe(true);

    expect(document.activeElement).toBe(input);
    expect(list.element.classList.contains("vlist--search-open")).toBe(true);
  });

  it("Enter in the input steps exactly one match forward, Shift+Enter one back", () => {
    const { input, counter } = openAndType("ap");
    expect(counter.textContent).toBe("1 of 3");

    // The keydown also bubbles to the list root; it must not be counted twice.
    expect(pressIn(input, "Enter")).toBe(true);
    expect(counter.textContent).toBe("2 of 3");
    expect(pressIn(input, "Enter", { shiftKey: true })).toBe(true);
    expect(counter.textContent).toBe("1 of 3");
  });

  it("ArrowDown and ArrowUp in the input walk the matches instead of moving the caret", () => {
    const { input, counter } = openAndType("ap");

    expect(pressIn(input, "ArrowDown")).toBe(true);
    expect(counter.textContent).toBe("2 of 3");
    expect(pressIn(input, "ArrowUp")).toBe(true);
    expect(counter.textContent).toBe("1 of 3");
  });

  it("Escape in the input clears the query and closes search", () => {
    const { list, input } = openAndType("ap");
    expect(list.element.classList.contains("vlist--searching")).toBe(true);

    expect(pressIn(input, "Escape")).toBe(true);

    expect(q(list, "getQuery")()).toBe("");
    expect(input.value).toBe("");
    expect(list.element.classList.contains("vlist--searching")).toBe(false);
    expect(list.element.classList.contains("vlist--search-open")).toBe(false);
  });

  it("leaves every other key to the text field", () => {
    const { input, counter } = openAndType("ap");

    // Letters, Backspace and the horizontal arrows belong to the input: if the
    // plugin claimed them the user could not edit the query.
    for (const key of ["p", "Backspace", "ArrowLeft", "ArrowRight", "Home"]) {
      expect(pressIn(input, key)).toBe(false);
    }
    expect(counter.textContent).toBe("1 of 3");
  });

  it("the same keys work when the user simply clicked into the bar and typed", () => {
    const { container, list } = makeList({ mode: "navigate" });
    const input = container.querySelector(".vlist-search__input") as HTMLInputElement;
    const counter = container.querySelector(".vlist-search__counter")!;
    input.focus();
    input.value = "ap";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(counter.textContent).toBe("1 of 3");

    expect(pressIn(input, "Enter")).toBe(true);
    expect(counter.textContent).toBe("2 of 3");
    expect(list.element.classList.contains("vlist--searching")).toBe(true);
    expect(pressIn(input, "Escape")).toBe(true);
    expect(q(list, "getQuery")()).toBe("");
  });
});

// =============================================================================
// Keyboard handler
// =============================================================================

describe("keyboard", () => {
  function pressKey(root: HTMLElement, key: string, opts?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: opts?.ctrlKey ?? false,
      metaKey: opts?.metaKey ?? false,
      shiftKey: opts?.shiftKey ?? false,
    });
    (event as any).preventDefault = () => {};
    root.dispatchEvent(event);
  }

  const isOpen = (list: VList<Fruit>) => list.element.classList.contains("vlist--searching");

  it("openSearch/closeSearch toggle the searching class", () => {
    const { list } = makeList();
    q(list, "openSearch")();
    q(list, "setQuery")("a");
    expect(isOpen(list)).toBe(true);
    q(list, "closeSearch")();
    expect(isOpen(list)).toBe(false);
  });

  it("Enter steps to next match in navigate mode", () => {
    const { container, list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    const counter = container.querySelector(".vlist-search__counter");
    expect(counter!.textContent).toBe("1 of 3");
    pressKey(list.element, "Enter");
    expect(counter!.textContent).toBe("2 of 3");
  });

  it("Shift+Enter steps to previous match", () => {
    const { container, list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    q(list, "nextMatch")();
    const counter = container.querySelector(".vlist-search__counter");
    expect(counter!.textContent).toBe("2 of 3");
    pressKey(list.element, "Enter", { shiftKey: true });
    expect(counter!.textContent).toBe("1 of 3");
  });

  it("ArrowDown/ArrowUp step through matches when open", () => {
    const { container, list } = makeList({ mode: "navigate" });
    q(list, "setQuery")("ap");
    const counter = container.querySelector(".vlist-search__counter");
    pressKey(list.element, "ArrowDown");
    expect(counter!.textContent).toBe("2 of 3");
    pressKey(list.element, "ArrowUp");
    expect(counter!.textContent).toBe("1 of 3");
  });
});

// =============================================================================
// Cancel timeout
// =============================================================================

describe("cancelTimeout", () => {
  it("auto-closes search after timeout", async () => {
    const { list } = makeList({ cancelTimeout: 100 });
    q(list, "setQuery")("a");
    expect(list.element.classList.contains("vlist--searching")).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(list.element.classList.contains("vlist--searching")).toBe(false);
  });
});

// =============================================================================
// Type-ahead (position: "none")
// =============================================================================

describe("type-ahead (invisible mode)", () => {
  function pressKey(root: HTMLElement, key: string, opts?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: opts?.ctrlKey ?? false,
      metaKey: opts?.metaKey ?? false,
      shiftKey: opts?.shiftKey ?? false,
    });
    (event as any).preventDefault = () => {};
    root.dispatchEvent(event);
  }

  it("printable key opens search and applies query in position:none", () => {
    const { list } = makeList({ position: "none" as any, mode: "filter", field: "name" });
    const root = list.element;
    pressKey(root, "a");
    expect(q(list, "getQuery")()).toBe("a");
    expect(list.element.classList.contains("vlist--searching")).toBe(true);
  });

  it("Backspace removes last char and closes when empty", () => {
    const { list } = makeList({ position: "none" as any, mode: "filter", field: "name" });
    const root = list.element;
    pressKey(root, "c");
    pressKey(root, "h");
    expect(q(list, "getQuery")()).toBe("ch");
    pressKey(root, "Backspace");
    expect(q(list, "getQuery")()).toBe("c");
    pressKey(root, "Backspace");
    expect(q(list, "getQuery")()).toBe("");
  });
});


// =============================================================================
// search + data
// =============================================================================

describe("search — conflicts with data", () => {
  const adapter = { read: async () => ({ items: [] as Fruit[], total: 0 }) };

  it("declares the conflict", () => {
    expect(search<Fruit>().conflicts).toContain("data");
  });

  it("throws at creation in either plugin order", () => {
    // It used to build a list that then broke in two steps: matching read the
    // static items array, which an adapter leaves empty, so every query matched
    // nothing and filtered the list to zero; clearing the filter then reinstated
    // static item functions over the ones data() owns, so the total stayed zero.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const config = { container, item: { height: 48, template: (f: Fruit) => f.name } };
    try {
      expect(() =>
        createVList<Fruit>(config, [search<Fruit>(), data<Fruit>({ adapter })]),
      ).toThrow('Plugin "search" conflicts with "data"');
      // The name set is complete before conflicts are checked, so order is moot.
      expect(() =>
        createVList<Fruit>(config, [data<Fruit>({ adapter }), search<Fruit>()]),
      ).toThrow('Plugin "search" conflicts with "data"');
      expect(container.children.length).toBe(0);
    } finally {
      container.remove();
    }
  });
});


// =============================================================================
// search + selection (filtered index space)
// =============================================================================

describe("search + selection", () => {
  function fireKey(el: HTMLElement, key: string, opts: KeyboardEventInit = {}): void {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  }

  it("click, keyboard, and Ctrl+A select the rendered items on a filtered list", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(20),
        item: { height: 30, template: (item) => item.name },
      },
      [selection<TestItem>({ mode: "multiple" }), search<TestItem>({ field: "name" })],
    );
    lists.push(list);

    // "Item 9" and "Item 19" — first filtered row is original index 8, not 0.
    // The bug selected getItems()[0] (id=1) for a click on this row.
    (list as any).setQuery("9");
    expect(list.total).toBe(2);

    const row = container.querySelector<HTMLElement>("[data-index='0']");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Item 9");
    expect(row!.getAttribute("data-id")).toBe("9");

    let clickedId: string | number | undefined;
    list.on("item:click", ({ item }) => {
      clickedId = item.id;
    });
    let selectionIds: Array<string | number> = [];
    list.on("selection:change", ({ selected }) => {
      selectionIds = selected;
    });

    fireKey(list.element, "ArrowDown");
    fireKey(list.element, " ");
    expect((list as any).getSelected()).toEqual([9]);

    (list as any).clearSelection();
    expect((list as any).getSelected()).toEqual([]);

    row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clickedId).toBe(9);
    expect(selectionIds).toEqual([9]);
    expect((list as any).getSelected()).toEqual([9]);

    (list as any).clearSelection();
    fireKey(list.element, "a", { ctrlKey: true });
    expect((list as any).getSelected()).toEqual([9, 19]);
  });
});

describe("search + groups", () => {
  it("highlights the same rows with groups() as without, and never a header", () => {
    // "1" matches Item 1 and Item 10–19 — 11 rows, the measured ungrouped count.
    const items = createTestItems(20);
    const item = { height: 30, template: (row: TestItem) => row.name };
    const query = "1";
    const highlightedRows = (root: HTMLElement): number => {
      let n = 0;
      const rows = root.querySelectorAll(".vlist-item");
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.querySelector(".vlist-search-match")) n++;
      }
      return n;
    };

    const plainContainer = document.createElement("div");
    document.body.appendChild(plainContainer);
    const plain = createVList<TestItem>(
      { container: plainContainer, items: items.slice(), item },
      [search<TestItem>({ field: "name" })],
    );
    lists.push(plain);
    (plain as any).setQuery(query);
    const plainCount = highlightedRows(plainContainer);

    const groupedContainer = document.createElement("div");
    document.body.appendChild(groupedContainer);
    const grouped = createVList<TestItem>(
      { container: groupedContainer, items: items.slice(), item },
      [
        groups<TestItem>({
          getGroupForIndex: (index) => (index < 10 ? "A" : "B"),
          header: { height: 24, template: (key) => key },
        }),
        search<TestItem>({ field: "name" }),
      ],
    );
    lists.push(grouped);
    (grouped as any).setQuery(query);

    expect(plainCount).toBe(11);
    expect(highlightedRows(groupedContainer)).toBe(plainCount);
    expect(groupedContainer.querySelectorAll(".vlist-group-header .vlist-search-match").length).toBe(0);
    expect(groupedContainer.querySelectorAll(".vlist-group-header").length).toBeGreaterThan(0);
  });
});

describe("search — conflicts with tree", () => {
  it("declares the conflict", () => {
    expect(search<Fruit>().conflicts).toContain("tree");
  });

  it("throws at creation in either plugin order", () => {
    // tree() owns the layout index space but never implemented the filterTree
    // hook search delegates to, so filtering fell through to flat indices into
    // the source array: a 5-item tree reported 1, then 0, then 2 after clearing.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const config = { container, items: FRUITS, item: { height: 48, template: (f: Fruit) => f.name } };
    try {
      expect(() =>
        createVList<Fruit>(config, [search<Fruit>(), tree<Fruit>({ parentId: "parentId" })]),
      ).toThrow('Plugin "search" conflicts with "tree"');
      expect(() =>
        createVList<Fruit>(config, [tree<Fruit>({ parentId: "parentId" }), search<Fruit>()]),
      ).toThrow('Plugin "search" conflicts with "tree"');
      expect(container.children.length).toBe(0);
    } finally {
      container.remove();
    }
  });
});
