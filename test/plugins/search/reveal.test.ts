/**
 * searchReveal() — a typed letter shows the search bar.
 *
 * Serial: every test builds into the one document and several read
 * document.activeElement. describe.serial is not honoured by Bun 1.4.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import { search } from "../../../src/plugins/search/plugin";
import { searchReveal } from "../../../src/plugins/search/reveal";
import { selection } from "../../../src/plugins/selection/plugin";
import type { SearchMethods } from "../../../src/plugins/search/plugin";
import type { VListItem } from "../../../src/types";

interface Fruit extends VListItem {
  id: number;
  name: string;
}

const FRUITS: Fruit[] = [
  { id: 1, name: "Apple" },
  { id: 2, name: "Banana" },
  { id: 3, name: "Cherry" },
  { id: 4, name: "Apricot" },
];

type List = VList<Fruit> & SearchMethods;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 500; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 300; },
    configurable: true,
  });
});

afterAll(() => {
  geometry.restore();
});
afterAll(() => geometry.assertRestored());

function make(
  plugins: Parameters<typeof createVList<Fruit>>[1],
): { list: List; container: HTMLElement; bar: HTMLElement | null } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const list = createVList<Fruit>(
    {
      container,
      items: FRUITS.slice(),
      item: { height: 30, template: (item) => item.name },
    },
    plugins,
  ) as List;
  return { list, container, bar: container.querySelector<HTMLElement>(".vlist-search") };
}

function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

describe("searchReveal", () => {
  it.serial("a letter does nothing without searchReveal", () => {
    const { list, bar } = make([search<Fruit>()]);
    try {
      expect(bar!.classList.contains("vlist-search--hidden")).toBe(false);
      press(list.element, "a");
      expect(list.getQuery()).toBe("");
      expect(document.activeElement === bar!.querySelector("input")).toBe(false);
    } finally {
      list.destroy();
      bar?.remove();
    }
  });

  it.serial("a letter opens, focuses, and queries that letter", () => {
    const { list, container, bar } = make([search<Fruit>(), searchReveal()]);
    try {
      const input = container.querySelector<HTMLInputElement>(".vlist-search__input")!;
      const counter = container.querySelector(".vlist-search__counter")!;
      expect(bar!.classList.contains("vlist-search--hidden")).toBe(true);
      list.element.focus();
      const changes: string[] = [];
      list.on("search:change", (event) => { changes.push(event.query); });
      press(list.element, "a");
      expect(bar!.classList.contains("vlist-search--hidden")).toBe(false);
      expect(document.activeElement === input).toBe(true);
      expect(list.getQuery()).toBe("a");
      expect(input.value).toBe("a");
      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(1);
      expect(changes).toEqual(["a"]);
      expect(counter.getAttribute("aria-live")).toBe("polite");
      expect(counter.textContent).toBe("3 results");
    } finally {
      list.destroy();
    }
  });

  it.serial("the next letter appends", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    try {
      const input = container.querySelector<HTMLInputElement>(".vlist-search__input")!;
      press(list.element, "a");
      input.value = "ab";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(list.getQuery()).toBe("ab");
    } finally {
      list.destroy();
    }
  });

  it.serial("a digit opens", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "4");
      expect(list.getQuery()).toBe("4");
    } finally {
      list.destroy();
    }
  });

  it.serial("é opens", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "é");
      expect(list.getQuery()).toBe("é");
    } finally {
      list.destroy();
    }
  });

  it.serial("ж opens", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "ж");
      expect(list.getQuery()).toBe("ж");
    } finally {
      list.destroy();
    }
  });

  it.serial("Space still toggles selection", () => {
    const { list, container } = make([
      search<Fruit>(),
      searchReveal(),
      selection<Fruit>({ mode: "single" }),
    ]);
    try {
      press(list.element, "ArrowDown");
      press(list.element, " ");
      expect(list.getQuery()).toBe("");
      expect(container.querySelector(".vlist-search")!.classList.contains("vlist-search--hidden")).toBe(true);
      const selected = (list as List & { getSelected(): Array<string | number> }).getSelected();
      expect(selected.length).toBe(1);
    } finally {
      list.destroy();
    }
  });

  it.serial("arrows do not open", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "ArrowDown");
      expect(list.getQuery()).toBe("");
    } finally {
      list.destroy();
    }
  });

  it.serial("Ctrl+F still opens", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    try {
      const input = container.querySelector<HTMLInputElement>(".vlist-search__input")!;
      list.element.focus();
      press(list.element, "f", { ctrlKey: true });
      expect(document.activeElement === input).toBe(true);
      expect(list.getQuery()).toBe("");
      expect(container.querySelector(".vlist-search")!.classList.contains("vlist-search--hidden")).toBe(false);
    } finally {
      list.destroy();
    }
  });

  it.serial("a modified letter does not open", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "e", { ctrlKey: true });
      press(list.element, "e", { metaKey: true });
      expect(list.getQuery()).toBe("");
    } finally {
      list.destroy();
    }
  });

  it.serial("Option-produced letters open and Ctrl+Alt letters open", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "æ", { altKey: true });
      expect(list.getQuery()).toBe("æ");
      list.closeSearch();
      press(list.element, "é", { altKey: true, ctrlKey: true });
      expect(list.getQuery()).toBe("é");
    } finally {
      list.destroy();
    }
  });

  it.serial("isComposing does not open", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "a", { isComposing: true });
      expect(list.getQuery()).toBe("");
    } finally {
      list.destroy();
    }
  });

  it.serial("keyCode 229 does not open", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
      Object.defineProperty(event, "keyCode", { get: () => 229 });
      list.element.dispatchEvent(event);
      expect(list.getQuery()).toBe("");
    } finally {
      list.destroy();
    }
  });

  it.serial("a field key does not open", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    try {
      const field = document.createElement("input");
      const area = document.createElement("textarea");
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      container.append(field, area, editable);
      press(field, "a");
      press(area, "b");
      press(editable, "c");
      expect(list.getQuery()).toBe("");
    } finally {
      list.destroy();
    }
  });

  it.serial("defaultPrevented does not open", () => {
    const { list } = make([search<Fruit>(), searchReveal()]);
    try {
      list.element.addEventListener("keydown", (event) => { event.preventDefault(); }, true);
      press(list.element, "a");
      expect(list.getQuery()).toBe("");
    } finally {
      list.destroy();
    }
  });

  it.serial("Escape hides, clears, and restores focus", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    try {
      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      const input = container.querySelector<HTMLInputElement>(".vlist-search__input")!;
      const bar = container.querySelector(".vlist-search")!;
      viewport.focus();
      const order: string[] = [];
      list.on("search:change", () => { order.push("change"); });
      list.on("search:close", () => { order.push("close"); });
      press(list.element, "a");
      expect(document.activeElement === input).toBe(true);
      press(input, "Escape");
      expect(list.getQuery()).toBe("");
      expect(bar.classList.contains("vlist-search--hidden")).toBe(true);
      expect(document.activeElement === viewport).toBe(true);
      expect(order).toEqual(["change", "change", "close"]);
    } finally {
      list.destroy();
    }
  });

  it.serial("a gone return target focuses the tab stop", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    try {
      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      outside.focus();
      press(list.element, "a");
      outside.remove();
      press(container.querySelector<HTMLElement>(".vlist-search__input")!, "Escape");
      expect(document.activeElement === viewport).toBe(true);
    } finally {
      list.destroy();
    }
  });

  it.serial("X hides and clears the filter", () => {
    const { list: live, container: box } = make([search<Fruit>({ mode: "filter" }), searchReveal()]);
    try {
      press(live.element, "a");
      expect(live.total).toBe(3);
      const clear = box.querySelector<HTMLButtonElement>(".vlist-search__clear-button")!;
      expect(clear.getAttribute("aria-label")).toBe("Close search");
      expect(clear.type).toBe("button");
      clear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(live.getQuery()).toBe("");
      expect(live.total).toBe(FRUITS.length);
      expect(box.querySelector(".vlist-search")!.classList.contains("vlist-search--hidden")).toBe(true);
    } finally {
      live.destroy();
    }
  });

  it.serial("Visible X clears without search:close", () => {
    const { list, container } = make([search<Fruit>()]);
    try {
      let closed = false;
      list.on("search:close", () => { closed = true; });
      list.setQuery("a");
      const clear = container.querySelector<HTMLButtonElement>(".vlist-search__clear-button")!;
      clear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(list.getQuery()).toBe("");
      expect(closed).toBe(false);
      expect(container.querySelector(".vlist-search")!.classList.contains("vlist-search--hidden")).toBe(false);
    } finally {
      list.destroy();
    }
  });

  it.serial("position none is refused", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    let list: List | undefined;
    try {
      list = createVList<Fruit>(
        { container, items: FRUITS.slice(), item: { height: 30, template: (item) => item.name } },
        [search<Fruit>({ position: "none" }), searchReveal()],
      ) as List;
      press(list.element, "a");
      expect(list.getQuery()).toBe("a");
      expect(container.querySelector(".vlist-search")).toBeNull();
      expect(logged.some((args) => args.map(String).join(" ").includes("requires search() with a bar"))).toBe(true);
    } finally {
      console.error = original;
      list?.destroy();
      container.remove();
    }
  });

  it.serial("the counter live region gets the result text", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    try {
      press(list.element, "a");
      const counter = container.querySelector(".vlist-search__counter")!;
      expect(counter.getAttribute("aria-live")).toBe("polite");
      expect(counter.textContent!.length).toBeGreaterThan(0);
    } finally {
      list.destroy();
    }
  });

  it.serial("destroy drops the bar", () => {
    const { list, container } = make([search<Fruit>(), searchReveal()]);
    list.destroy();
    expect(container.querySelector(".vlist-search")).toBeNull();
  });

  it.serial("the stylesheet hides the modifier", async () => {
    const css = await Bun.file(new URL("../../../src/styles/vlist-search.css", import.meta.url)).text();
    expect(css).toContain(".vlist-search.vlist-search--hidden");
    expect(css).toContain("display: none");
  });
});
