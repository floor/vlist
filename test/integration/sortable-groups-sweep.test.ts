import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import { createContainer } from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { sortable } from "../../src/plugins/sortable/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import type { VListItem } from "../../src/types";

interface GroupedItem extends VListItem {
  id: number;
  name: string;
  group: string;
}

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 400;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 300;
    },
    configurable: true,
  });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function buildGroupedSortable() {
  const container = createContainer({ width: 300, height: 400 });
  let currentItems: GroupedItem[] = [
    { id: 1, name: "A1", group: "Group A" },
    { id: 2, name: "A2", group: "Group A" },
    { id: 3, name: "B1", group: "Group B" },
    { id: 4, name: "B2", group: "Group B" },
    { id: 5, name: "C1", group: "Group C" },
    { id: 6, name: "C2", group: "Group C" },
  ];

  const events: Array<{ type: string; payload: any }> = [];
  const list = createVList<GroupedItem>(
    {
      container,
      items: currentItems,
      item: {
        height: 40,
        template: (item) => `<div class="row">${item.name}</div>`,
      },
    },
    [
      groups<GroupedItem>({
        getGroupForIndex: (i) => currentItems[i]?.group ?? "",
        sticky: false,
        header: {
          height: 32,
          template: (key) => `<div class="hdr">${key}</div>`,
        },
      }),
      selection<GroupedItem>({ mode: "single" }),
      sortable<GroupedItem>({ shiftDuration: 0 }),
    ],
  );

  for (const type of ["sort:start", "sort:move", "sort:end", "sort:cancel"] as const) {
    list.on(type as any, (payload: any) => events.push({ type, payload: { ...payload } }));
  }

  const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
  const content = container.querySelector(".vlist-content") as HTMLElement;
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 300, 400);
  content.getBoundingClientRect = () => new DOMRect(0, 0, 300, 400);

  const firePointer = (target: EventTarget, type: string, y: number): void => {
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: 50,
      clientY: y,
    } as any);
    target.dispatchEvent(ev);
  };

  return {
    list,
    container,
    content,
    events,
    firePointer,
    setCurrentItems(next: GroupedItem[]) {
      currentItems = next;
      list.setItems(next);
    },
    dispose() {
      list.destroy();
      container.remove();
    },
  };
}

describe("sortable() + groups() — drag across a group header", () => {
  it.serial("emits data indices (not layout indices) when dragging an item across a group header", async () => {
    const f = buildGroupedSortable();
    try {
      // Data item 0 ("A1") sits at layout data-index="1" (y = 32..72).
      // Group B header sits at layout data-index="3" (y = 112..144).
      // Data item 2 ("B1") sits at layout data-index="4" (y = 144..184).
      const itemA1 = f.content.querySelector('[data-index="1"]') as HTMLElement;
      itemA1.getBoundingClientRect = () => new DOMRect(0, 32, 300, 40);

      f.firePointer(itemA1, "pointerdown", 52);
      f.firePointer(f.content, "pointermove", 65);
      f.firePointer(f.content, "pointermove", 164);
      f.firePointer(f.content, "pointerup", 164);
      await tick(250);

      const startEvt = f.events.find((e) => e.type === "sort:start");
      const endEvt = f.events.find((e) => e.type === "sort:end");
      expect(startEvt?.payload).toEqual({ index: 0 });
      expect(endEvt?.payload).toEqual({ fromIndex: 0, toIndex: 2 });

      // Drag B1 (data index 2, layout data-index="4", y = 144..184) upward across Group B header to A1 (data index 0, y = 32..72).
      f.events.length = 0;
      const itemB1 = f.content.querySelector('[data-index="4"]') as HTMLElement;
      itemB1.getBoundingClientRect = () => new DOMRect(0, 144, 300, 40);

      f.firePointer(itemB1, "pointerdown", 164);
      f.firePointer(f.content, "pointermove", 150);
      f.firePointer(f.content, "pointermove", 45);
      f.firePointer(f.content, "pointerup", 45);
      await tick(250);

      expect(f.events.find((e) => e.type === "sort:start")?.payload).toEqual({ index: 2 });
      expect(f.events.find((e) => e.type === "sort:end")?.payload).toEqual({ fromIndex: 2, toIndex: 0 });
    } finally {
      f.dispose();
    }
  });

  it.serial("allows dragging downward to the last data item without clamping short by groupCount", async () => {
    const f = buildGroupedSortable();
    try {
      // Layout has 9 entries (3 headers + 6 items); last item C2 (data index 5) is at layout index 8 (y = 296..336).
      const itemA1 = f.content.querySelector('[data-index="1"]') as HTMLElement;
      itemA1.getBoundingClientRect = () => new DOMRect(0, 32, 300, 40);

      f.firePointer(itemA1, "pointerdown", 52);
      f.firePointer(f.content, "pointermove", 65);
      f.firePointer(f.content, "pointermove", 330);
      f.firePointer(f.content, "pointerup", 330);
      await tick(250);

      const endEvt = f.events.find((e) => e.type === "sort:end");
      expect(endEvt?.payload).toEqual({ fromIndex: 0, toIndex: 5 });
    } finally {
      f.dispose();
    }
  });

  it.serial("does not treat .vlist-group-header elements as draggable sortable items", async () => {
    const f = buildGroupedSortable();
    try {
      const headerB = f.content.querySelector('[data-index="3"]') as HTMLElement;
      expect(headerB.classList.contains("vlist-group-header")).toBe(true);
      expect(headerB.getAttribute("aria-roledescription")).toBeNull();
      expect(headerB.getAttribute("aria-describedby")).toBeNull();

      headerB.getBoundingClientRect = () => new DOMRect(0, 112, 300, 32);
      f.firePointer(headerB, "pointerdown", 128);
      f.firePointer(f.content, "pointermove", 145);
      f.firePointer(f.content, "pointermove", 200);
      f.firePointer(f.content, "pointerup", 200);
      await tick(250);

      expect(f.events).toHaveLength(0);
    } finally {
      f.dispose();
    }
  });

  it.serial("rebuilds group layout on setItems() when an item is dragged across a group header with unchanged total count", () => {
    const f = buildGroupedSortable();
    try {
      // Move A1 into Group B so group sizes change from (2, 2, 2) to (1, 3, 2) while total stays 6.
      f.setCurrentItems([
        { id: 2, name: "A2", group: "Group A" },
        { id: 1, name: "A1-in-B", group: "Group B" },
        { id: 3, name: "B1", group: "Group B" },
        { id: 4, name: "B2", group: "Group B" },
        { id: 5, name: "C1", group: "Group C" },
        { id: 6, name: "C2", group: "Group C" },
      ]);

      const rows = [...f.content.children].map((el) => ({
        isHeader: el.classList.contains("vlist-group-header"),
        text: (el.textContent ?? "").trim(),
      }));

      // Layout entry 0: Group A header; entry 1: A2; entry 2: Group B header; entry 3: A1-in-B
      expect(rows.slice(0, 4)).toEqual([
        { isHeader: true, text: "Group A" },
        { isHeader: false, text: "A2" },
        { isHeader: true, text: "Group B" },
        { isHeader: false, text: "A1-in-B" },
      ]);
    } finally {
      f.dispose();
    }
  });
});
