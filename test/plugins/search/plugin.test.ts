/**
 * vlist — Search Plugin Tests (RFC-008 Phase 1)
 *
 * Integration tests against a real createVList instance (happy-dom):
 * search bar injection, filter + navigate modes, highlighting, keyboard,
 * events, methods, template state, and cleanup.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import { search } from "../../../src/plugins/search/plugin";
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

let heightDesc: PropertyDescriptor | undefined;
let widthDesc: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 500; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});

afterAll(() => {
  if (heightDesc) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDesc);
  if (widthDesc) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDesc);
  GlobalRegistrator.unregister();
});

let lists: VList<Fruit>[] = [];
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
