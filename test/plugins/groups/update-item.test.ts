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

interface Row extends VListItem {
  id: number;
  group: string;
  label?: string;
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
});
