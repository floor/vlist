import { beforeAll, afterAll, describe, it, expect } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { search, type SearchMethods } from "../../src/plugins/search/plugin";
import type { VList } from "../../src/core/types";

interface Row { id: number; name: string; }
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
          expect(f.events.at(-1)).toEqual({ index: 1, id: 5 });
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
          expect(f.events.at(-1)).toEqual({ index: 3, id: 4 });
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
          expect(f.events.at(-1)).toEqual({ index: 1, id: 3 });
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
