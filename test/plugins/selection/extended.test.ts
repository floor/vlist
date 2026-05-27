/**
 * vlist v2 -- Selection Plugin Extended E2E Tests
 *
 * Integration tests that exercise selection behaviors through createVList
 * rather than mock plugin contexts. Each test creates its own isolated
 * VList instance to be safe under --concurrent.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import { selection } from "../../../src/plugins/selection";
import type { VList } from "../../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

function fireKey(el: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

function makeList(
  count: number,
  selectionConfig: Parameters<typeof selection>[0] = {},
): { list: VList<TestItem>; content: HTMLElement; container: HTMLElement } {
  const container = createContainer({ width: 300, height: 500 });
  const items = createTestItems(count);
  const list = createVList<TestItem>(
    {
      container,
      items,
      item: { height: 50, template: simpleTemplate },
    },
    [selection<TestItem>(selectionConfig)],
  );
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  return { list, content, container };
}

function getSelected(vlist: VList<TestItem>): Array<string | number> {
  return (vlist as unknown as Record<string, Function>)["getSelected"]() as Array<string | number>;
}

// =============================================================================
// Shift+Arrow extended selection
// =============================================================================

describe("selection -- Shift+Arrow extended", () => {
  it("Shift+ArrowDown toggles destination item", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 2, toggle 2

    const selected = getSelected(list);
    expect(selected).toContain(3);
    expect(selected.length).toBe(1);

    list.destroy();
    container.remove();
  });

  it("Shift+ArrowDown multiple times extends selection", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 1, toggle 1
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 2, toggle 2
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 3, toggle 3

    const selected = getSelected(list);
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected.length).toBe(3);

    list.destroy();
    container.remove();
  });

  it("Shift+ArrowUp toggles destination item upward", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown"); // focus -> 2
    fireKey(content, "ArrowDown"); // focus -> 3
    fireKey(content, "ArrowUp", { shiftKey: true }); // focus -> 2, toggle 2

    const selected = getSelected(list);
    expect(selected).toContain(3);
    expect(selected.length).toBe(1);

    list.destroy();
    container.remove();
  });

  it("Shift+ArrowDown then Shift+ArrowUp detoggles items", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 2, toggle ON
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 3, toggle ON

    let selected = getSelected(list);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected.length).toBe(2);

    fireKey(content, "ArrowUp", { shiftKey: true }); // focus -> 2, toggle OFF

    selected = getSelected(list);
    expect(selected).not.toContain(3);
    expect(selected).toContain(4);
    expect(selected.length).toBe(1);

    list.destroy();
    container.remove();
  });

  it("Shift+Arrow preserves earlier Space toggles", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, " "); // toggle item 0 (id=1)
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown"); // focus -> 2
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 3, toggle 3

    const selected = getSelected(list);
    expect(selected).toContain(1);
    expect(selected).toContain(4);
    expect(selected.length).toBe(2);

    list.destroy();
    container.remove();
  });

  it("Shift+Arrow after Space continues from new position", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown"); // focus -> 2
    fireKey(content, " "); // toggle item 2 (id=3)
    fireKey(content, "ArrowDown"); // focus -> 3
    fireKey(content, "ArrowDown", { shiftKey: true }); // focus -> 4, toggle 4

    const selected = getSelected(list);
    expect(selected).toContain(3);
    expect(selected).toContain(5);
    expect(selected.length).toBe(2);

    list.destroy();
    container.remove();
  });

  it("Ctrl+A selects all in multiple mode", () => {
    const { list, content, container } = makeList(10, { mode: "multiple" });

    fireKey(content, "ArrowDown");
    fireKey(content, "a", { ctrlKey: true });

    const selected = getSelected(list);
    expect(selected.length).toBe(10);

    list.destroy();
    container.remove();
  });

  it("Ctrl+A is no-op in single mode", () => {
    const { list, content, container } = makeList(10, { mode: "single" });

    fireKey(content, "ArrowDown");
    fireKey(content, "a", { ctrlKey: true });

    const selected = getSelected(list);
    expect(selected.length).toBe(0);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// Shift+Space range selection
// =============================================================================

describe("selection -- Shift+Space range", () => {
  it("Shift+Space selects range from last selected to current focus", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, " "); // toggle index 1 (id=2), sets lastSelectedIndex=1
    fireKey(content, "ArrowDown"); // focus -> 2
    fireKey(content, "ArrowDown"); // focus -> 3
    fireKey(content, "ArrowDown"); // focus -> 4
    fireKey(content, " ", { shiftKey: true }); // Shift+Space: range 1..4

    const selected = getSelected(list);
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected.length).toBe(4);

    list.destroy();
    container.remove();
  });

  it("Space sets lastSelectedIndex for subsequent Shift+Space", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown"); // focus -> 2
    fireKey(content, " "); // toggle index 2, sets lastSelectedIndex=2
    fireKey(content, "ArrowDown"); // focus -> 3
    fireKey(content, "ArrowDown"); // focus -> 4
    fireKey(content, "ArrowDown"); // focus -> 5
    fireKey(content, "ArrowDown"); // focus -> 6
    fireKey(content, " ", { shiftKey: true }); // Shift+Space: range 2..6

    const selected = getSelected(list);
    for (let id = 3; id <= 7; id++) {
      expect(selected).toContain(id);
    }
    expect(selected.length).toBe(5);

    list.destroy();
    container.remove();
  });

  it("Shift+Space with no previous selection is a no-op", () => {
    const { list, content, container } = makeList(20, { mode: "multiple" });

    fireKey(content, "ArrowDown"); // focus -> 0
    fireKey(content, "ArrowDown"); // focus -> 1
    fireKey(content, "ArrowDown"); // focus -> 2
    fireKey(content, " ", { shiftKey: true });

    const selected = getSelected(list);
    expect(selected.length).toBe(0);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// followFocus option
// =============================================================================

describe("selection -- followFocus", () => {
  it("followFocus auto-selects on ArrowDown in single mode", () => {
    const { list, content, container } = makeList(10, { mode: "single", followFocus: true });

    fireKey(content, "ArrowDown"); // focus -> 0, auto-select

    let selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(1);

    fireKey(content, "ArrowDown"); // focus -> 1, auto-select replaces

    selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(2);

    list.destroy();
    container.remove();
  });

  it("followFocus does not auto-select in multiple mode", () => {
    const { list, content, container } = makeList(10, { mode: "multiple", followFocus: true });

    fireKey(content, "ArrowDown"); // focus -> 0

    const selected = getSelected(list);
    expect(selected.length).toBe(0);

    list.destroy();
    container.remove();
  });

  it("followFocus replaces selection on each movement", () => {
    const { list, content, container } = makeList(10, { mode: "single", followFocus: true });

    fireKey(content, "ArrowDown"); // focus -> 0, select id=1
    fireKey(content, "ArrowDown"); // focus -> 1, select id=2
    fireKey(content, "ArrowDown"); // focus -> 2, select id=3

    let selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(3);

    fireKey(content, "ArrowUp"); // focus -> 1, select id=2
    selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(2);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// Scroll alignment on focus move
// =============================================================================

describe("selection -- scroll on focus move", () => {
  it("selectNext scrolls when item is below viewport", () => {
    const { list, container } = makeList(30, { mode: "single" });

    const selNext = (list as Record<string, Function>).selectNext as () => void;
    for (let i = 0; i <= 12; i++) selNext();

    const selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(13);

    list.destroy();
    container.remove();
  });

  it("selectPrevious scrolls when item is above viewport", () => {
    const { list, container } = makeList(30, { mode: "single" });

    const selNext = (list as Record<string, Function>).selectNext as () => void;
    const selPrev = (list as Record<string, Function>).selectPrevious as () => void;
    for (let i = 0; i < 15; i++) selNext();
    selPrev();

    const selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(14);

    list.destroy();
    container.remove();
  });

  it("no scroll when focused item is within viewport", () => {
    const { list, container } = makeList(30, { mode: "single" });

    const selNext = (list as Record<string, Function>).selectNext as () => void;
    selNext(); // index 0
    selNext(); // index 1
    selNext(); // index 2

    const selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(3);
    expect(list.getScrollPosition()).toBe(0);

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// Delete/Backspace event emission
// =============================================================================

describe("selection -- Delete/Backspace", () => {
  it("Delete emits delete event with selected items", () => {
    const { list, content, container } = makeList(10, { mode: "multiple" });

    const selectFn = (list as Record<string, Function>).select as (...ids: Array<string | number>) => void;
    selectFn(2, 4);

    const deleteEvents: Array<{ selected: Array<string | number>; items: TestItem[] }> = [];
    list.on("delete", (e: { selected: Array<string | number>; items: TestItem[] }) => {
      deleteEvents.push({ selected: [...e.selected], items: [...e.items] });
    });

    fireKey(content, "Delete");

    expect(deleteEvents.length).toBe(1);
    expect(deleteEvents[0]!.selected).toContain(2);
    expect(deleteEvents[0]!.selected).toContain(4);
    expect(deleteEvents[0]!.items.length).toBe(2);

    list.destroy();
    container.remove();
  });

  it("Backspace emits delete event with selected items", () => {
    const { list, content, container } = makeList(10, { mode: "multiple" });

    const selectFn = (list as Record<string, Function>).select as (...ids: Array<string | number>) => void;
    selectFn(3);

    const deleteEvents: Array<{ selected: Array<string | number> }> = [];
    list.on("delete", (e: { selected: Array<string | number> }) => {
      deleteEvents.push({ selected: [...e.selected] });
    });

    fireKey(content, "Backspace");

    expect(deleteEvents.length).toBe(1);
    expect(deleteEvents[0]!.selected).toContain(3);

    list.destroy();
    container.remove();
  });

  it("Delete is no-op when nothing is selected", () => {
    const { list, content, container } = makeList(10, { mode: "multiple" });

    const deleteEvents: Array<unknown> = [];
    list.on("delete", (e) => deleteEvents.push(e));

    fireKey(content, "Delete");

    expect(deleteEvents.length).toBe(0);

    list.destroy();
    container.remove();
  });
});
