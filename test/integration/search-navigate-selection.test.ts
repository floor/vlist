/**
 * vlist — one key press, one owner: search() must not also step a handled key
 *
 * The core runs every plugin's keydown handler for one event
 * (src/core/create.ts, `onContentKeydown`) and never stops at
 * `defaultPrevented`. selection() and a11y() run first (priority 50/55) and
 * call `preventDefault` when they handle a key; search()'s `onKeydown` never
 * looks at the flag, so on a list that has one of them and an open search in
 * navigate mode, ArrowDown moves the list focus AND steps the current match.
 * The demo report: search, click a result, then Up/Down — the list jumps and
 * the match counter moves with it.
 *
 * These tests pin one owner per key press, and that search() alone still
 * steps its matches on the same keys.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, simpleTemplate, type TestItem } from "../helpers/factory";
import { selection } from "../../src/plugins/selection/plugin";
import { search } from "../../src/plugins/search/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const textOf = (el: Element | null): string =>
  (el?.textContent ?? "").trim().replace(/\s+/g, " ");

/** Five fruits; "ap" matches Apple, Apricot and Grape. */
const items = (): TestItem[] =>
  ["Apple", "Banana", "Apricot", "Grape", "Cherry"].map((name, i) => ({ id: i + 1, name })) as TestItem[];

interface SearchApi {
  setQuery(query: string): void;
  getMatches(): number[];
}

/** A built list owned by one test, so tests can run concurrently. */
interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** `focus:change` payloads seen so far. */
  readonly focuses: Array<{ index: number; id: string | number }>;
  /** `selection:change.selected` payloads seen so far. */
  readonly selections: Array<Array<string | number>>;
  /** Text of every row carrying `--focused`. */
  marked(cls: "focused" | "selected"): string[];
  /** Text of the search match counter, or "" when no bar is visible. */
  counter(): string;
  row(label: string): HTMLElement | undefined;
  press(key: string): void;
  dispose(): void;
}

async function build(plugins: VListPlugin<TestItem>[]): Promise<Fixture> {
  const container = createContainer({ width: 300, height: 400 });
  const list = createVList<TestItem>(
    { container, items: items(), item: { height: 40, template: simpleTemplate } },
    plugins,
  );
  await tick(0);
  await tick(50);

  const focuses: Array<{ index: number; id: string | number }> = [];
  const selections: Array<Array<string | number>> = [];
  list.on("focus:change", (e) => focuses.push({ index: e.index, id: e.id as string | number }));
  list.on("selection:change", (e) => selections.push([...e.selected]));

  const content = container.querySelector(".vlist-content") as HTMLElement;
  return {
    list,
    container,
    focuses,
    selections,
    marked(cls: "focused" | "selected"): string[] {
      return [...container.querySelectorAll(`.vlist-item--${cls}`)].map(textOf);
    },
    counter(): string {
      return container.querySelector(".vlist-search__counter")?.textContent?.trim() ?? "";
    },
    row(label: string): HTMLElement | undefined {
      const rows = [...container.querySelectorAll('[role="option"]')] as HTMLElement[];
      return rows.find((r) => textOf(r) === label);
    },
    press(key: string): void {
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("search() — a key another plugin handled", () => {
  // document.activeElement (the click path focuses the list) and the
  // HTMLElement.prototype geometry getters mocked in beforeAll are process
  // globals, so the tests run one at a time.
  it.serial("ArrowDown after a result click moves the list only", async () => {
    const f = await build([
      selection({ mode: "single" }),
      search<TestItem>({ mode: "navigate", field: "name" }),
    ]);
    try {
      (f.list as unknown as SearchApi).setQuery("ap");
      await tick(0);
      await tick(30);
      expect(f.counter()).toBe("1 of 3");

      const apricot = f.row("Apricot");
      expect(apricot).toBeDefined();
      apricot!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await tick(0);
      expect(f.selections[f.selections.length - 1]).toEqual([3]);

      f.press("ArrowDown");
      await tick(0);
      await tick(30);

      // The list owns Arrows once focus is in it: Grape is data index 3.
      expect(f.focuses[f.focuses.length - 1]).toEqual({ index: 3, id: 4 });
      expect(f.marked("focused")).toEqual(["Grape"]);
      // search() stepped too, from Apricot (1 of 3) to Grape (2 of 3), on the
      // same key press.
      expect(f.counter()).toBe("1 of 3");
    } finally {
      f.dispose();
    }
  });

  it.serial("ArrowDown still steps the match with no other focus owner", async () => {
    const f = await build([search<TestItem>({ mode: "navigate", field: "name" })]);
    try {
      (f.list as unknown as SearchApi).setQuery("ap");
      await tick(0);
      await tick(30);
      expect(f.counter()).toBe("1 of 3");

      f.press("ArrowDown");
      await tick(0);
      await tick(30);
      expect(f.counter()).toBe("2 of 3");

      f.press("ArrowDown");
      await tick(0);
      await tick(30);
      expect(f.counter()).toBe("3 of 3");

      f.press("ArrowUp");
      await tick(0);
      await tick(30);
      expect(f.counter()).toBe("2 of 3");
    } finally {
      f.dispose();
    }
  });
});
