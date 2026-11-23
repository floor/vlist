/**
 * A join that a nested edit leaves and then rejoins must stay a single match.
 * The outer update records the row before the previous hook runs, and that
 * hook can splice the same row itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import type { VList, VListPlugin } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { search } from "../../../src/plugins/search/plugin";

interface Row extends VListItem {
  id: number;
  label: string;
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
    list.on("search:change", (event) => events.push(event.matches));
    list.setQuery("show");
    events.length = 0;

    list.updateItem(2, { label: "show" });

    const matches = list.getMatches();
    const counter = container.querySelector(".vlist-search__counter")?.textContent ?? "";
    const reported = events[events.length - 1];
    expect(matches).toEqual([0, 1, 2]);
    expect(new Set(matches).size).toBe(matches.length);
    expect(reported).toBe(matches.length);
    expect(counter).toBe(`${matches.length} results`);
    list.destroy();
    container.remove();
  });
});
