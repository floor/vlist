/**
 * vlist — Selection Plugin Edge Paths
 *
 * The keyboard and restore branches of selection() that only show up next to
 * another plugin, driven through a real createVList: left/right arrows (a no-op
 * in a plain vertical list, a cell step in a grid, the main axis in a horizontal
 * list), PageUp/PageDown across group headers, a range that reaches rows the
 * data plugin has not loaded yet, and a single-selection list restored from a
 * snapshot.
 */

import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { advanceTimers } from "../../helpers/timers";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { CreateVListConfig, VList, VListPlugin } from "../../../src/core/types";
import type { VListAdapter, VListItem } from "../../../src/types";
import { selection, type SelectionMethods } from "../../../src/plugins/selection";
import { grid } from "../../../src/plugins/grid";
import { groups } from "../../../src/plugins/groups";
import { data } from "../../../src/plugins/data";
import { snapshots } from "../../../src/plugins/snapshots";
import { tree } from "../../../src/plugins/tree";

// =============================================================================
// DOM Setup
// =============================================================================

const WIDTH = 300;
const HEIGHT = 500;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
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

type SelectableList = VList<TestItem> & SelectionMethods<TestItem>;

let open: Array<{ list: VList<TestItem>; container: HTMLElement }> = [];
afterEach(() => {
  for (const { list, container } of open) {
    list.destroy();
    container.remove();
  }
  open = [];
});

function makeList(
  config: Omit<CreateVListConfig<TestItem>, "container">,
  plugins: Array<VListPlugin<TestItem, any>>,
): { list: SelectableList; container: HTMLElement; content: HTMLElement } {
  const container = createContainer({ width: WIDTH, height: HEIGHT });
  const list = createVList<TestItem>({ container, ...config }, plugins);
  open.push({ list, container });
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  return { list: list as SelectableList, container, content };
}

/** Dispatch a key the way a browser does and report whether the list claimed it. */
function press(el: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}): { claimed: boolean } {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(event);
  return { claimed: event.defaultPrevented };
}

/** The id of the row the focus ring is on, read from the DOM. */
function focusedId(container: HTMLElement): number | null {
  const el = container.querySelector<HTMLElement>(".vlist-item--focused");
  return el ? Number(el.getAttribute("data-id")) : null;
}

function selectedIdsInDom(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>(".vlist-item--selected")]
    .map((el) => Number(el.getAttribute("data-id")))
    .sort((a, b) => a - b);
}

// =============================================================================
// mode: "none" — the API stays, nothing can be selected
// =============================================================================

describe('selection — mode "none"', () => {
  it("keeps every method callable and inert, so a consumer can switch modes without guarding calls", () => {
    const { list, container, content } = makeList(
      { items: createTestItems(40), item: { height: 50, template: simpleTemplate } },
      [selection<TestItem>({ mode: "none" })],
    );
    const changes: unknown[] = [];
    list.on("selection:change", (event) => changes.push(event));

    list.select(1, 2);
    list.toggleSelect(3);
    list.selectAll();
    list.selectNext();
    list.selectNext();
    list.selectPrevious();
    list.deselect(1);
    list.clearSelection();
    container.querySelector<HTMLElement>('[data-id="4"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    press(content, "ArrowDown");
    press(content, " ");

    expect(list.getSelected()).toEqual([]);
    expect(list.getSelectedItems()).toEqual([]);
    expect(changes).toEqual([]);
    expect(selectedIdsInDom(container)).toEqual([]);
    expect(focusedId(container)).toBeNull();
    // selectNext reveals the row it selects; with nothing to select it must not scroll.
    expect(list.getScrollPosition()).toBe(0);
  });
});

// =============================================================================
// ArrowLeft / ArrowRight
// =============================================================================

describe("selection — left and right arrows", () => {
  it("leaves them alone in a plain vertical list, so the page can still use them", () => {
    const { container, content } = makeList(
      { items: createTestItems(20), item: { height: 50, template: simpleTemplate } },
      [selection<TestItem>()],
    );
    press(content, "Home");
    expect(focusedId(container)).toBe(1);

    const right = press(content, "ArrowRight");
    const left = press(content, "ArrowLeft");

    // No second axis: the focus stays put and the default action is not eaten.
    expect(focusedId(container)).toBe(1);
    expect(right.claimed).toBe(false);
    expect(left.claimed).toBe(false);
  });

  it("step one cell sideways in a grid, where up and down step a whole row", () => {
    const { container, content } = makeList(
      { items: createTestItems(20), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4 }), selection<TestItem>()],
    );
    press(content, "Home");

    expect(press(content, "ArrowRight").claimed).toBe(true);
    expect(focusedId(container)).toBe(2);
    press(content, "ArrowRight");
    expect(focusedId(container)).toBe(3);
    press(content, "ArrowDown");
    expect(focusedId(container)).toBe(7);
    expect(press(content, "ArrowLeft").claimed).toBe(true);
    expect(focusedId(container)).toBe(6);
  });

  it("stop at the first cell instead of wrapping to the previous row", () => {
    const { container, content } = makeList(
      { items: createTestItems(20), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4 }), selection<TestItem>()],
    );
    press(content, "Home");

    press(content, "ArrowLeft");

    expect(focusedId(container)).toBe(1);
  });

  it("extend a multiple selection cell by cell with Shift held", () => {
    const { list, container, content } = makeList(
      { items: createTestItems(20), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4 }), selection<TestItem>({ mode: "multiple" })],
    );
    press(content, "Home");
    press(content, " ");
    expect(list.getSelected()).toEqual([1]);

    press(content, "ArrowRight", { shiftKey: true });
    press(content, "ArrowRight", { shiftKey: true });

    expect(list.getSelected()).toEqual([1, 2, 3]);
    expect(selectedIdsInDom(container)).toEqual([1, 2, 3]);

    // Shift+arrow toggles the cell it lands on, sideways as it does vertically.
    press(content, "ArrowLeft", { shiftKey: true });
    expect(list.getSelected()).toEqual([1, 3]);
  });

  it("walk the items of a horizontal list, where up and down have nothing to do", () => {
    const { container, content } = makeList(
      {
        items: createTestItems(20),
        orientation: "horizontal",
        item: { width: 100, height: HEIGHT, template: simpleTemplate },
      },
      [selection<TestItem>()],
    );
    press(content, "Home");

    expect(press(content, "ArrowRight").claimed).toBe(true);
    expect(focusedId(container)).toBe(2);
    press(content, "ArrowRight");
    expect(focusedId(container)).toBe(3);
    expect(press(content, "ArrowLeft").claimed).toBe(true);
    expect(focusedId(container)).toBe(2);

    const down = press(content, "ArrowDown");
    const up = press(content, "ArrowUp");
    expect(focusedId(container)).toBe(2);
    expect(down.claimed).toBe(false);
    expect(up.claimed).toBe(false);
  });

  it("step a whole column in a horizontal grid, where up and down step one lane", () => {
    const { container, content } = makeList(
      {
        items: createTestItems(20),
        orientation: "horizontal",
        item: { width: 100, height: HEIGHT, template: simpleTemplate },
      },
      [grid({ columns: 2 }), selection<TestItem>()],
    );
    press(content, "Home");

    // Two lanes: items 1 and 2 share the first column, 3 and 4 the second.
    press(content, "ArrowRight");
    expect(focusedId(container)).toBe(3);
    press(content, "ArrowDown");
    expect(focusedId(container)).toBe(4);
    press(content, "ArrowLeft");
    expect(focusedId(container)).toBe(2);
    press(content, "ArrowUp");
    expect(focusedId(container)).toBe(1);
  });
});

// =============================================================================
// PageUp / PageDown across group headers
// =============================================================================

describe("selection + groups — PageUp and PageDown", () => {
  const ITEM = 50;

  function groupedList(count: number) {
    return makeList(
      { items: createTestItems(count), item: { height: ITEM, template: simpleTemplate } },
      [
        groups({
          getGroupForIndex: (index) => `G${Math.floor(index / 4)}`,
          header: { height: ITEM, template: (key) => `<div class="group-header">${key}</div>` },
        }),
        selection<TestItem>(),
      ],
    );
  }

  it("PageDown moves a page of items, not a page of rows that headers ate into", () => {
    const { container, content } = groupedList(60);
    press(content, "Home");
    expect(focusedId(container)).toBe(1);

    expect(press(content, "PageDown").claimed).toBe(true);

    // 500px of 50px rows is a page of ten: item 1 → item 11. Counting layout
    // rows instead would have stopped at item 9, two headers short.
    expect(focusedId(container)).toBe(11);
    const focused = container.querySelector<HTMLElement>(".vlist-item--focused")!;
    expect(focused.classList.contains("vlist-group-header")).toBe(false);
  });

  it("PageUp takes the same page back", () => {
    const { container, content } = groupedList(60);
    press(content, "Home");
    press(content, "PageDown");
    press(content, "PageDown");
    expect(focusedId(container)).toBe(21);

    press(content, "PageUp");

    expect(focusedId(container)).toBe(11);
  });

  it("PageDown stops on the last item and PageUp on the first", () => {
    const { container, content } = groupedList(14);
    press(content, "Home");

    press(content, "PageDown");
    press(content, "PageDown");
    expect(focusedId(container)).toBe(14);

    press(content, "PageUp");
    press(content, "PageUp");
    expect(focusedId(container)).toBe(1);
  });
});

// =============================================================================
// A range that reaches rows the data plugin has not loaded
// =============================================================================

describe("selection + data — a range over rows that are not loaded yet", () => {
  const TOTAL = 200;

  function adapter(): VListAdapter<TestItem> {
    return {
      read: mock(async ({ offset, limit }) => {
        const items: TestItem[] = [];
        const end = Math.min(offset + limit, TOTAL);
        for (let i = offset; i < end; i++) {
          items.push({ id: i + 1, name: `Item ${i + 1}`, value: (i + 1) * 10 });
        }
        return { items, total: TOTAL, hasMore: end < TOTAL };
      }),
    };
  }

  it("Ctrl+Shift+End holds the unloaded rows and hands them to the real items once they load", async () => {
    const { list, container, content } = makeList(
      { item: { height: 50, template: simpleTemplate } },
      [data<TestItem>({ adapter: adapter() }), selection<TestItem>({ mode: "multiple" })],
    );
    await advanceTimers(50);
    press(content, "Home");

    press(content, "End", { ctrlKey: true, shiftKey: true });

    // Every row is selected the moment the key is pressed, loaded or not.
    expect(list.getSelected().length).toBe(TOTAL);
    expect(list.getSelected()).toContain(1);
    expect(list.getSelected()).toContain(`__placeholder_${TOTAL - 1}`);

    // The key also scrolled to the end; let that page load and render.
    await advanceTimers(300);

    const last = container.querySelector<HTMLElement>(`[data-id="${TOTAL}"]`);
    expect(last).not.toBeNull();
    expect(last!.classList.contains("vlist-item--selected")).toBe(true);
    expect(last!.getAttribute("aria-selected")).toBe("true");

    // The stand-in id is gone; the real one took its place, once.
    const selected = list.getSelected();
    expect(selected).toContain(TOTAL);
    expect(selected).not.toContain(`__placeholder_${TOTAL - 1}`);
    expect(selected.length).toBe(TOTAL);
    // And the consumer can read the item back, not just its id.
    expect(list.getSelectedItems().some((item) => item.id === TOTAL)).toBe(true);
  });

  it("Shift+Space does the same for a keyboard range", async () => {
    const { list, container, content } = makeList(
      { item: { height: 50, template: simpleTemplate } },
      [data<TestItem>({ adapter: adapter() }), selection<TestItem>({ mode: "multiple" })],
    );
    await advanceTimers(50);
    press(content, "Home");
    press(content, " ");
    expect(list.getSelected()).toEqual([1]);

    // End moves the focus to a row that has no item yet; Shift+Space then
    // selects everything between the anchor and it.
    press(content, "End");
    press(content, " ", { shiftKey: true });
    expect(list.getSelected().length).toBe(TOTAL);

    await advanceTimers(300);

    const last = container.querySelector<HTMLElement>(`[data-id="${TOTAL}"]`);
    expect(last).not.toBeNull();
    expect(last!.classList.contains("vlist-item--selected")).toBe(true);
    expect(list.getSelected()).toContain(TOTAL);
    expect(list.getSelected().length).toBe(TOTAL);
  });
});

// =============================================================================
// A single-selection list restored from a snapshot
// =============================================================================

describe("selection + snapshots — restoring a single selection", () => {
  it("shows the saved row as selected on the first render, without announcing a change", async () => {
    const changes: unknown[] = [];
    const { list, container } = makeList(
      { items: createTestItems(40), item: { height: 50, template: simpleTemplate } },
      [
        selection<TestItem>({ mode: "single" }),
        snapshots({ restore: { index: 0, offsetInItem: 0, total: 40, selectedIds: [3] } }),
      ],
    );
    list.on("selection:change", (event) => changes.push(event));

    // Before any microtask: the row must not flash unselected first.
    expect(selectedIdsInDom(container)).toEqual([3]);
    expect(list.getSelected()).toEqual([3]);

    await advanceTimers(20);
    expect(selectedIdsInDom(container)).toEqual([3]);
    expect(changes).toEqual([]);
  });

  it("refuses a snapshot that carries several ids — a single-selection list cannot hold them", async () => {
    const { list, container } = makeList(
      { items: createTestItems(40), item: { height: 50, template: simpleTemplate } },
      [
        selection<TestItem>({ mode: "single" }),
        snapshots({ restore: { index: 0, offsetInItem: 0, total: 40, selectedIds: [3, 5] } }),
      ],
    );

    expect(list.getSelected()).toEqual([]);
    await advanceTimers(20);
    // Nothing is picked at random from the two, now or once the restore settles.
    expect(list.getSelected()).toEqual([]);
    expect(selectedIdsInDom(container)).toEqual([]);
  });
});

// =============================================================================
// tree() asks selection whether focus carries the selection with it
// =============================================================================

describe("selection + tree — followFocus", () => {
  interface TreeItem extends VListItem {
    id: string;
    name: string;
    children: TreeItem[];
  }

  const nodes = (): TreeItem[] => [
    { id: "src", name: "src", children: [
      { id: "core", name: "core", children: [{ id: "create", name: "create.ts", children: [] }] },
      { id: "plugins", name: "plugins", children: [] },
    ] },
    { id: "readme", name: "README.md", children: [] },
  ];

  let made: Array<{ list: VList<TreeItem>; container: HTMLElement }> = [];
  afterEach(() => {
    for (const { list, container } of made) {
      list.destroy();
      container.remove();
    }
    made = [];
  });

  async function treeList(followFocus: boolean) {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = createVList<TreeItem>(
      { container, items: nodes(), item: { height: 32, template: (item) => item.name } },
      [tree<TreeItem>({ expanded: ["src"] }), selection<TreeItem>({ mode: "single", followFocus })],
    );
    made.push({ list, container });
    // tree() looks for a focus owner on the microtask after setup.
    await advanceTimers(5);
    const content = container.querySelector<HTMLElement>(".vlist-content")!;
    return { list: list as VList<TreeItem> & SelectionMethods<TreeItem>, container, content };
  }

  it("ArrowRight into an open folder selects the child when selection follows focus", async () => {
    const { list, content } = await treeList(true);
    press(content, "Home");
    expect(list.getSelected()).toEqual(["src"]);

    // "src" is already open, so ArrowRight steps onto its first child.
    expect(press(content, "ArrowRight").claimed).toBe(true);

    expect(list.getSelected()).toEqual(["core"]);
  });

  it("ArrowRight into an open folder leaves the selection alone when it does not", async () => {
    const { list, content } = await treeList(false);
    list.select("readme");
    press(content, "Home");

    expect(press(content, "ArrowRight").claimed).toBe(true);

    expect(list.getSelected()).toEqual(["readme"]);
  });

  // BUG (reported with FLO-168, not fixed here): tree() moves focus through
  // selection's _focusById, which sets focusVisible to `focusOnClick` (false by
  // default). The focus ring disappears, aria-activedescendant stays on the old
  // row, _getFocusedIndex answers -1, and tree() ignores every further
  // ArrowRight / ArrowLeft until an up/down key revives the focus.
  it.todo("the focus ring follows the tree's own arrow moves, and the next arrow still works", async () => {
    const { list, container, content } = await treeList(true);
    press(content, "Home");
    press(content, "ArrowRight");

    const focused = container.querySelector<HTMLElement>(".vlist-item--focused");
    expect(focused?.getAttribute("data-id")).toBe("core");
    expect(content.getAttribute("aria-activedescendant")).toBe(focused!.id);

    // "core" is a closed folder: a second ArrowRight opens it.
    expect(press(content, "ArrowRight").claimed).toBe(true);
    expect(list.total).toBe(5);
  });
});
