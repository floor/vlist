/**
 * vlist — Selection Plugin Extended E2E Tests
 *
 * Integration tests that exercise selection behaviors through createVList
 * rather than mock plugin contexts. Each test creates its own isolated
 * VList instance to be safe under --concurrent.
 */

import { capturePrototypeGeometry } from "../../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import { selection, type SelectionMethods } from "../../../src/plugins/selection";
import { groups } from "../../../src/plugins/groups";
import type { VList } from "../../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================


let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

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
  return (vlist as unknown as Record<string, Function>)["getSelected"]!() as Array<string | number>;
}

type SelectableList = VList<TestItem> & SelectionMethods<TestItem>;

function asSelectable(vlist: VList<TestItem>): SelectableList {
  return vlist as SelectableList;
}

function selectedRow(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".vlist-item--selected");
}

function itemOffsetY(el: HTMLElement): number | null {
  const transform = el.style.transform;
  const yOnly = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(transform);
  if (yOnly) return Number(yOnly[1]);
  const xy = /translate\([^,]+,\s*(-?\d+(?:\.\d+)?)px\)/.exec(transform);
  return xy ? Number(xy[1]) : null;
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
  it("selectNext past the fold leaves the selected item in the viewport and rendered", () => {
    const itemSize = 50;
    const viewport = 500;
    const { list, container } = makeList(40, { mode: "single" });
    const sel = asSelectable(list);
    const visibleCount = Math.floor(viewport / itemSize);
    const steps = visibleCount + 5;

    for (let i = 0; i < steps; i++) sel.selectNext();

    const selected = getSelected(list);
    expect(selected.length).toBe(1);
    expect(selected).toContain(steps);

    const row = selectedRow(container);
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-id")).toBe(String(steps));
    expect(list.getScrollPosition()).toBeGreaterThan(0);

    const y = itemOffsetY(row!);
    expect(y).not.toBeNull();
    const visibleTop = y! - list.getScrollPosition();
    expect(visibleTop).toBeGreaterThanOrEqual(0);
    expect(visibleTop + itemSize).toBeLessThanOrEqual(viewport);

    const content = container.querySelector(".vlist-content");
    expect(content?.getAttribute("aria-activedescendant")).toBe(`vlist-item-${steps - 1}`);

    list.destroy();
    container.remove();
  });

  it("selectPrevious back to 0 returns scroll position to 0", () => {
    const itemSize = 50;
    const viewport = 500;
    const { list, container } = makeList(40, { mode: "single" });
    const sel = asSelectable(list);
    const steps = Math.floor(viewport / itemSize) + 5;

    for (let i = 0; i < steps; i++) sel.selectNext();
    expect(list.getScrollPosition()).toBeGreaterThan(0);

    for (let i = 0; i < steps; i++) sel.selectPrevious();

    expect(getSelected(list)).toEqual([1]);
    expect(list.getScrollPosition()).toBe(0);
    const row = selectedRow(container);
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-id")).toBe("1");

    list.destroy();
    container.remove();
  });

  it("selectNext does not scroll when the item is already fully visible", () => {
    const { list, container } = makeList(30, { mode: "single" });
    const sel = asSelectable(list);

    sel.selectNext(); // index 0
    sel.selectNext(); // index 1
    sel.selectNext(); // index 2

    expect(getSelected(list)).toEqual([3]);
    expect(list.getScrollPosition()).toBe(0);

    list.destroy();
    container.remove();
  });

  it("selectNext with groups leaves the item visible below the sticky header", () => {
    const itemSize = 40;
    const headerHeight = 30;
    const viewport = 500;
    const container = createContainer({ width: 300, height: viewport });
    const items = createTestItems(40);
    const list = createVList<TestItem>(
      {
        container,
        items,
        item: { height: itemSize, template: simpleTemplate },
      },
      [
        groups({
          getGroupForIndex: (index) => `G${Math.floor(index / 10)}`,
          header: {
            height: headerHeight,
            template: (key) => `<div class="group-header">${key}</div>`,
          },
        }),
        selection<TestItem>({ mode: "single" }),
      ],
    );
    const sel = asSelectable(list);
    const visibleCount = Math.floor(viewport / itemSize);
    const steps = visibleCount + 5;

    for (let i = 0; i < steps; i++) sel.selectNext();

    expect(getSelected(list).length).toBe(1);
    expect(list.getScrollPosition()).toBeGreaterThan(0);

    const sticky = container.querySelector(".vlist-sticky-header");
    expect(sticky).not.toBeNull();

    const row = selectedRow(container);
    expect(row).not.toBeNull();
    expect(row!.classList.contains("vlist-group-header")).toBe(false);

    const y = itemOffsetY(row!);
    expect(y).not.toBeNull();
    // Sticky header occupies a row above the viewport; the item sits in the
    // viewport below it, not under the header.
    const visibleTop = y! - list.getScrollPosition();
    expect(visibleTop).toBeGreaterThanOrEqual(0);
    expect(visibleTop + itemSize).toBeLessThanOrEqual(viewport);

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

    const selectFn = (list as unknown as Record<string, Function>).select as (...ids: Array<string | number>) => void;
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

    const selectFn = (list as unknown as Record<string, Function>).select as (...ids: Array<string | number>) => void;
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
